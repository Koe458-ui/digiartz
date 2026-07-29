/* ═══════════════════════════════════════════════════════════════════
   Cloudflare Pages middleware — runs on every route.

   index.html is a single-file SPA. Everything it shows comes from JS,
   which means anything that DOESN'T run JS — Googlebot's first pass,
   AI crawlers, and every social scraper (WhatsApp, Discord, Twitter,
   Facebook, Slack, iMessage) — sees only the raw shell. This file goes
   to Supabase first and hands over a finished page instead.

   Three jobs:

   1. PRERENDER (/)         60 newest approved artworks as real <a> cards
                            + the ImageGallery ld+json block.

   2. PER-PAGE METADATA     /artwork/<id> and /profile/<name> ship with
                            the site-wide defaults baked into index.html:
                            every artwork URL said "DigiArtz — The Digital
                            Art Community" and pointed og:image at a
                            background file. So every shared link previewed
                            as the generic site card, and Google saw 33
                            URLs with identical titles (= duplicate
                            content). Now <title>, description, canonical,
                            og:*, twitter:* and an ImageObject/Person
                            ld+json block are rewritten from the real row.

   3. SOFT-404 GUARD        A deleted or renamed /profile/<name> still
                            answered 200 (the SPA rewrite serves
                            index.html), so Google held it as a soft 404.
                            Gone → real 404 + noindex.

   The row fetched for (3) is the same row (2) needs, so both come from a
   single Supabase lookup.

   REQUIRES, in Pages → Settings → Environment variables (Production AND
   Preview):
     SB_URL   https://tmqzqlrpjpydiftlrzmj.supabase.co
     SB_KEY   the publishable/anon key (same one in config.js)
   Without them every job no-ops and the page passes through untouched.
   ═══════════════════════════════════════════════════════════════════ */

const SITE = 'https://digiartz.net';
const DIT  = 'https://d1l8dn7jegdgem.cloudfront.net';
const DIT_HOST = new URL(DIT).hostname;
const CACHE_SECONDS = 300;   // homepage feed, held at the edge
const ROW_CACHE_SECONDS = 60;   // single artwork/profile rows

/* Mirrors imgResize() in index.html. Supabase Storage objects can't be
   read by the resizer (it reads from the S3 source bucket), so those
   URLs are left alone. */
function resize(url, width, quality, format) {
  if (!url || typeof url !== 'string') return url;
  let u;
  try { u = new URL(url); } catch { return url; }
  if (u.hostname === DIT_HOST) return url;
  if (u.hostname.endsWith('.supabase.co')) return url;
  const key = u.pathname.replace(/^\/+/, '');
  if (!key) return url;
  return `${DIT}/fit-in/${width}x0/filters:format(${format}):quality(${quality})/${key}`;
}
const thumb = (url) => resize(url, 300, 55, 'webp');
/* Social scrapers are fussy: several still don't render WebP, and a
   full-size PNG can blow past Twitter's 5MB / Facebook's 8MB ceiling.
   A 1200px JPEG is the safe intersection. */
const ogImage = (url) => resize(url, 1200, 80, 'jpeg');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Meta descriptions get truncated by search engines around 160 chars. */
function clamp(s, n = 160) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s\S*$/, '') + '…';
}

/* ── Supabase ───────────────────────────────────────────────────── */

async function sbGet(env, query, ttl) {
  const res = await fetch(`${env.SB_URL}/rest/v1/${query}`, {
    headers: { apikey: env.SB_KEY, authorization: `Bearer ${env.SB_KEY}` },
    cf: { cacheTtl: ttl, cacheEverything: true }
  });
  if (!res.ok) throw new Error('sb ' + res.status);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('sb shape');
  return rows;
}

async function fetchArtworks(env) {
  if (!env || !env.SB_URL || !env.SB_KEY) return [];
  try {
    return await sbGet(env,
      'artworks?select=id,name,image_url,created_at' +
      '&status=eq.approved&kind=eq.art&order=created_at.desc&limit=60',
      CACHE_SECONDS);
  } catch { return []; }
}

/* ── Route resolution ───────────────────────────────────────────── */

const PROFILE_RE = /^\/profile\/([^/]+)\/?$/;
const ARTWORK_RE = /^\/artwork\/([^/]+)\/?$/;

/* Usernames the app issues are letters/digits/._- . Rejecting anything
   else early also keeps PostgREST's filter syntax (* , . ") out of the
   query string. */
const SAFE_NAME = /^[\p{L}\p{N}._-]{1,40}$/u;
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* → { type, status, row, artist }
     type   'artwork' | 'profile' | 'other'
     status 'found' | 'gone' | 'unknown'

   'unknown' means we couldn't tell — no key, network error, non-2xx,
   malformed response. It NEVER produces a 404 and never rewrites meta.
   Wrongly 404ing a live artist's page would deindex real work, which is
   far worse than one soft 404 lingering, so every uncertainty fails open. */
async function resolve(env, pathname) {
  const pm = pathname.match(PROFILE_RE);
  const am = pathname.match(ARTWORK_RE);
  if (!pm && !am) return { type: 'other', status: 'found' };

  const type = pm ? 'profile' : 'artwork';
  if (!env || !env.SB_URL || !env.SB_KEY) return { type, status: 'unknown' };

  let raw;
  try { raw = decodeURIComponent(pm ? pm[1] : am[1]); } catch { return { type, status: 'gone' }; }

  if (type === 'profile') {
    if (!SAFE_NAME.test(raw)) return { type, status: 'gone' };
    try {
      /* ilike — mirrors the app's own case-insensitive lookup, so
         /profile/SEKIRO resolves rather than 404ing. */
      const rows = await sbGet(env,
        'profiles?select=id,username,display_name,bio,avatar_url,banner_url' +
        `&username=ilike.${encodeURIComponent(raw)}&limit=1`,
        ROW_CACHE_SECONDS);
      if (!rows.length) return { type, status: 'gone' };
      return { type, status: 'found', row: rows[0] };
    } catch { return { type, status: 'unknown' }; }
  }

  if (!UUID_RE.test(raw)) return { type, status: 'gone' };
  try {
    /* Approved art only — a pending or rejected id must never be indexed. */
    const rows = await sbGet(env,
      'artworks?select=id,name,description,image_url,created_at,category,software,user_id' +
      `&id=eq.${raw}&status=eq.approved&kind=eq.art&limit=1`,
      ROW_CACHE_SECONDS);
    if (!rows.length) return { type, status: 'gone' };
    const row = rows[0];

    /* artworks.user_id FKs to auth.users, not public.profiles, so
       PostgREST can't embed the artist — it needs its own lookup. A
       missing artist is not fatal: the page still gets full metadata,
       just without a byline. */
    let artist = null;
    if (row.user_id) {
      try {
        const p = await sbGet(env,
          `profiles?select=username,display_name&id=eq.${row.user_id}&limit=1`,
          ROW_CACHE_SECONDS);
        artist = p[0] || null;
      } catch { /* byline is optional */ }
    }
    return { type, status: 'found', row, artist };
  } catch { return { type, status: 'unknown' }; }
}

/* ── Metadata builders ──────────────────────────────────────────── */

function artworkMeta(row, artist) {
  const name = row.name || 'Untitled artwork';
  const by   = artist ? (artist.display_name || artist.username) : null;
  const url  = `${SITE}/artwork/${row.id}`;
  const img  = ogImage(row.image_url) || '';

  const title = by ? `${name} by ${by} — DigiArtz` : `${name} — DigiArtz`;
  const desc  = clamp(
    row.description ||
    [`${name} —`, by ? `digital artwork by ${by}` : 'digital artwork',
     row.category ? `in ${row.category}` : '',
     row.software ? `made in ${row.software}` : '',
     'on DigiArtz.'].filter(Boolean).join(' ')
  );

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    name,
    description: desc,
    contentUrl: row.image_url,
    thumbnailUrl: thumb(row.image_url),
    url,
    datePublished: (row.created_at || '').slice(0, 10),
    ...(by ? { creator: { '@type': 'Person', name: by,
                          url: `${SITE}/profile/${encodeURIComponent(artist.username)}` } } : {})
  };

  return { title, desc, url, img, imgAlt: name, ogType: 'article', ld, ldId: 'ldArtwork' };
}

function profileMeta(row) {
  const name = row.display_name || row.username;
  const url  = `${SITE}/profile/${encodeURIComponent(row.username)}`;
  const img  = ogImage(row.banner_url || row.avatar_url) || '';

  return {
    title: `${name} — DigiArtz`,
    desc: clamp(row.bio || `Digital artwork by ${name} on DigiArtz.`),
    url,
    img,
    imgAlt: `${name} on DigiArtz`,
    ogType: 'profile',
    ld: {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'Person',
        name,
        alternateName: row.username,
        url,
        ...(row.bio ? { description: clamp(row.bio, 300) } : {}),
        ...(row.avatar_url ? { image: ogImage(row.avatar_url) } : {})
      }
    },
    ldId: 'ldProfile'
  };
}

/* Rewrites the site-wide defaults in <head> in place. Every tag it
   targets already exists in index.html, so nothing is appended and no
   tag can end up duplicated. */
function applyMeta(rw, m) {
  const set = (sel, val) => rw.on(sel, {
    element(el) { el.setAttribute('content', val); }
  });

  rw.on('title', { element(el) { el.setInnerContent(m.title); } });
  set('meta[name="description"]', m.desc);
  rw.on('link[rel="canonical"]', {
    element(el) { el.setAttribute('href', m.url); }
  });

  set('meta[property="og:type"]', m.ogType);
  set('meta[property="og:title"]', m.title);
  set('meta[property="og:description"]', m.desc);
  set('meta[property="og:url"]', m.url);
  if (m.img) {
    set('meta[property="og:image"]', m.img);
    set('meta[name="twitter:image"]', m.img);
  }
  set('meta[property="og:image:alt"]', m.imgAlt);

  set('meta[name="twitter:title"]', m.title);
  set('meta[name="twitter:description"]', m.desc);

  /* The client's updateArtworkSEO() looks this element up by id and
     overwrites it, so appending here can't produce a second block. */
  const json = JSON.stringify(m.ld).replace(/<\//g, '<\\/');
  rw.on('head', {
    element(el) {
      el.append(
        `<script type="application/ld+json" id="${m.ldId}">${json}</script>`,
        { html: true }
      );
    }
  });
  return rw;
}

/* ── entry point ────────────────────────────────────────────────── */

export async function onRequest(context) {
  const { env, request, next } = context;

  /* next() runs the rest of the pipeline — the sitemap.xml Function on
     that route, the static asset (or the /artwork/* rewrite to
     index.html) everywhere else. */
  const origin = await next();

  /* Anything that isn't an HTML document — sw.js, config.js, images,
     sitemap.xml — is returned exactly as-is. Critically this means the
     service worker keeps its application/javascript content-type. */
  const ct = origin.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return origin;

  let pathname = '/';
  try { pathname = new URL(request.url).pathname; } catch { /* keep '/' */ }

  const hit = await resolve(env, pathname);

  /* Dead profile or artwork → same shell, real 404, noindex. The body is
     still the app, so a human following a stale link sees the site
     rather than a bare error page. */
  if (hit.status === 'gone') {
    const gone = new HTMLRewriter()
      .on('head', {
        element(el) {
          el.append('<meta name="robots" content="noindex, follow">', { html: true });
        }
      })
      .transform(origin);
    return new Response(gone.body, { status: 404, headers: gone.headers });
  }

  const arts = await fetchArtworks(env);
  const meta = hit.status === 'found' && hit.type === 'artwork' ? artworkMeta(hit.row, hit.artist)
             : hit.status === 'found' && hit.type === 'profile' ? profileMeta(hit.row)
             : null;

  if (!arts.length && !meta) return origin;   // nothing to say — pass through

  let rw = new HTMLRewriter();

  if (arts.length) {
    const cards = arts.map((a) =>
      `<a class="awCard" href="/artwork/${esc(a.id)}"><div class="awImgWrap">` +
      `<img loading="lazy" decoding="async" src="${esc(thumb(a.image_url))}" ` +
      `alt="${esc(a.name)} — digital artwork on DigiArtz"></div></a>`
    ).join('');

    const galleryLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ImageGallery',
      name: 'DigiArtz — Digital Art Gallery', url: `${SITE}/`,
      hasPart: arts.map((a, i) => ({
        '@type': 'ImageObject', position: i + 1, name: a.name,
        contentUrl: a.image_url, thumbnailUrl: thumb(a.image_url),
        url: `${SITE}/artwork/${a.id}`,
        datePublished: (a.created_at || '').slice(0, 10)
      }))
    }).replace(/<\//g, '<\\/');

    rw = rw
      .on('div#awGrid', {
        element(el) { el.setInnerContent(cards, { html: true }); }
      })
      /* Overwrite the canonical block in index.html rather than appending.
         Appending gave the page a SECOND ImageGallery declaration — and
         since injectGallerySEO() looks the element up by id and would
         have created a THIRD, a JS-executing crawler saw three competing
         galleries. One element, three writers, last one wins. */
      .on('script#ldGallery', {
        element(el) { el.setInnerContent(galleryLd, { html: true }); }
      });
  }

  if (meta) rw = applyMeta(rw, meta);

  return rw.transform(origin);
}
