// pages middleware, seo at the edge

const SITE = 'https://digiartz.net';
const CACHE_SECONDS = 300;   // homepage feed, held at the edge
const ROW_CACHE_SECONDS = 60;   // single artwork/profile rows

// mirrors imgResize in js/app-core.js. Every image is a Supabase Storage
// object now and each size is its own object, identified by a filename suffix
// (__t300 / __t600 / __v1000 / __f1600), so picking a size is a suffix swap
// rather than an on-the-fly resize. A url carrying no suffix is handed back
// untouched: there is nothing to swap, and no resizer left to ask.
const SB_SIZE_RE = /__(?:t300|t600|v1000|f1600)\.webp$/;

function resize(url, width) {
  if (!url || typeof url !== 'string') return url;
  if (!SB_SIZE_RE.test(url)) return url;
  const suffix = width <= 300 ? '__t300.webp' : width <= 1000 ? '__v1000.webp' : '__f1600.webp';
  return url.replace(SB_SIZE_RE, suffix);
}
const thumb = (url) => resize(url, 300);
const t600 = (url) => (SB_SIZE_RE.test(url || '') ? url.replace(SB_SIZE_RE, '__t600.webp') : url);

// srcset for the homepage cards this worker renders. Mirrors dzThumbAttrs in
// js/app-core.js, minus the device-pixel-ratio cap: there is no DPR to read at
// the edge, so the browser applies its own and picks from what it is offered.
//
// Gated on T600_READY for the same reason as the client — t600 exists only for
// images uploaded after the tier was added, and a srcset candidate that 404s
// breaks the image rather than falling back. Unset, this emits exactly the
// single-src markup it always did.
function thumbAttrs(url, env) {
  const src = `src="${esc(thumb(url))}"`;
  if (!env || !env.T600_READY || !SB_SIZE_RE.test(url || '')) return src;
  const set = `${esc(thumb(url))} 300w, ${esc(t600(url))} 600w, ${esc(resize(url, 1000))} 1000w`;
  return `${src} srcset="${set}" ` +
         `sizes="(min-width:1280px) 25vw, (min-width:700px) 33.33vw, 50vw"`;
}
const ogImage = (url) => resize(url, 1200);
// schema.org contentUrl. Never the stored original: koe-originals is private,
// and a contentUrl that 403s drops the image out of Google Images. The largest
// public derivative is the honest answer.
const fullImage = (url) => resize(url, 1600);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// clamp for search snippets
function clamp(s, n = 160) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s\S*$/, '') + '…';
}

// supabase

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

// route resolution

const PROFILE_RE = /^\/profile\/([^/]+)\/?$/;
const ARTWORK_RE = /^\/artwork\/([^/]+)\/?$/;

// safe username charset
const SAFE_NAME = /^[\p{L}\p{N}._-]{1,40}$/u;
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// resolve a path
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
      // case insensitive lookup
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
    // approved rows only
    const rows = await sbGet(env,
      'artworks?select=id,name,description,image_url,created_at,category,software,user_id' +
      `&id=eq.${raw}&status=eq.approved&kind=eq.art&limit=1`,
      ROW_CACHE_SECONDS);
    if (!rows.length) return { type, status: 'gone' };
    const row = rows[0];

    // artist needs its own lookup
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

// metadata builders

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
    contentUrl: fullImage(row.image_url),
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

// rewrite head tags in place
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

  // client looks this up by id
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

// entry point

export async function onRequest(context) {
  const { env, request, next } = context;

  // run the rest of the pipeline
  const origin = await next();

  // non html passes through
  const ct = origin.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return origin;

  let pathname = '/';
  try { pathname = new URL(request.url).pathname; } catch { /* keep slash */ }

  const hit = await resolve(env, pathname);

  // gone, real 404 and noindex
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

  if (!arts.length && !meta) return origin;   // nothing to say, pass through

  let rw = new HTMLRewriter();

  if (arts.length) {
    const cards = arts.map((a) =>
      `<a class="awCard" href="/artwork/${esc(a.id)}"><div class="awImgWrap">` +
      `<img loading="lazy" decoding="async" ${thumbAttrs(a.image_url, env)} ` +
      `alt="${esc(a.name)} — digital artwork on DigiArtz"></div></a>`
    ).join('');

    const galleryLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ImageGallery',
      name: 'DigiArtz — Digital Art Gallery', url: `${SITE}/`,
      hasPart: arts.map((a, i) => ({
        '@type': 'ImageObject', position: i + 1, name: a.name,
        contentUrl: fullImage(a.image_url), thumbnailUrl: thumb(a.image_url),
        url: `${SITE}/artwork/${a.id}`,
        datePublished: (a.created_at || '').slice(0, 10)
      }))
    }).replace(/<\//g, '<\\/');

    rw = rw
      .on('div#awGrid', {
        element(el) { el.setInnerContent(cards, { html: true }); }
      })
      // overwrite, never append
      .on('script#ldGallery', {
        element(el) { el.setInnerContent(galleryLd, { html: true }); }
      });
  }

  if (meta) rw = applyMeta(rw, meta);

  return rw.transform(origin);
}
