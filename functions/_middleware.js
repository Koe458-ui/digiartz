/* ═══════════════════════════════════════════════════════════════════
   Cloudflare Pages middleware — runs on every route.

   Two jobs:

   1. PRERENDER. index.html is a single-file SPA: #awGrid is empty until
      JS runs, so crawlers that don't execute JS see nothing. Inject the
      60 newest approved artworks as real <a href> cards plus an
      ImageGallery ld+json block, server-side, at the edge.

   2. SOFT-404 GUARD. /profile/<name> and /artwork/<id> are SPA routes —
      _redirects rewrites them to index.html, so a DELETED or RENAMED one
      still answers 200 and the app merely toasts "Profile not found".
      Google reads that as a soft 404 and keeps the URL indexed. Resolve
      the target here instead: if it's gone, serve the same shell with a
      real 404 status and <meta name="robots" content="noindex">.

   REQUIRES two Pages environment variables (Settings → Environment
   variables → Production AND Preview):
     SB_URL   https://tmqzqlrpjpydiftlrzmj.supabase.co
     SB_KEY   the publishable/anon key (same one in config.js)
   Without them both jobs no-op and the page passes through untouched.
   ═══════════════════════════════════════════════════════════════════ */

const DIT = 'https://d1l8dn7jegdgem.cloudfront.net';
const CACHE_SECONDS = 300;   // Supabase feed held at the edge for 5 min

function thumb(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.supabase.co') || u.hostname === new URL(DIT).hostname) return url;
    return `${DIT}/fit-in/300x0/filters:format(webp):quality(55)/${u.pathname.replace(/^\/+/, '')}`;
  } catch { return url; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function fetchArtworks(env) {
  if (!env || !env.SB_URL || !env.SB_KEY) return [];   // unset vars → pass through
  const url = `${env.SB_URL}/rest/v1/artworks` +
    `?select=id,name,image_url,created_at&status=eq.approved&kind=eq.art` +
    `&order=created_at.desc&limit=60`;
  const res = await fetch(url, {
    headers: { apikey: env.SB_KEY, authorization: `Bearer ${env.SB_KEY}` },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
  });
  if (!res.ok) return [];
  return res.json();
}

/* ── Soft-404 guard ─────────────────────────────────────────────── */

const PROFILE_RE = /^\/profile\/([^/]+)\/?$/;
const ARTWORK_RE = /^\/artwork\/([^/]+)\/?$/;

/* Usernames the app issues are letters/digits/._- . Anything outside that
   can't be a real profile — and rejecting it early also keeps PostgREST's
   filter syntax (* , . ") from ever reaching the query string. */
const SAFE_NAME = /^[\p{L}\p{N}._-]{1,40}$/u;
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Returns: true = definitely gone · false = exists · null = couldn't tell.
   FAILS OPEN on every uncertainty — no key, network error, bad response,
   non-2xx. Wrongly 404ing a real artist's page would deindex live work,
   which is far worse than one soft 404 lingering. Only a clean, empty
   result set is allowed to produce a 404. */
async function isMissing(env, pathname) {
  if (!env || !env.SB_URL || !env.SB_KEY) return null;

  const pm = pathname.match(PROFILE_RE);
  const am = pathname.match(ARTWORK_RE);
  let query;

  if (pm) {
    const name = decodeURIComponent(pm[1]);
    if (!SAFE_NAME.test(name)) return true;
    /* ilike — mirrors the app's own case-insensitive lookup, so
       /profile/SEKIRO still resolves instead of 404ing. */
    query = `profiles?select=id&username=ilike.${encodeURIComponent(name)}&limit=1`;
  } else if (am) {
    const id = decodeURIComponent(am[1]);
    if (!UUID_RE.test(id)) return true;
    /* Approved art only — a pending or rejected id must not be indexed. */
    query = `artworks?select=id&id=eq.${id}&status=eq.approved&kind=eq.art&limit=1`;
  } else {
    return false;   // not a guarded route
  }

  try {
    const res = await fetch(`${env.SB_URL}/rest/v1/${query}`, {
      headers: { apikey: env.SB_KEY, authorization: `Bearer ${env.SB_KEY}` },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return rows.length === 0;
  } catch {
    return null;
  }
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

  /* Dead profile or artwork → same shell, real 404, noindex. The body is
     still the app, so a human who follows a stale link sees the site
     rather than a bare error page. */
  if (await isMissing(env, pathname)) {
    const gone = new HTMLRewriter()
      .on('head', {
        element(el) {
          el.append('<meta name="robots" content="noindex, follow">', { html: true });
        }
      })
      .transform(origin);
    return new Response(gone.body, { status: 404, headers: gone.headers });
  }

  let arts = [];
  try { arts = await fetchArtworks(env); } catch { return origin; }
  if (!arts.length) return origin;

  const cards = arts.map((a) =>
    `<a class="awCard" href="/artwork/${esc(a.id)}"><div class="awImgWrap">` +
    `<img loading="lazy" decoding="async" src="${esc(thumb(a.image_url))}" ` +
    `alt="${esc(a.name)} — digital artwork on DigiArtz"></div></a>`
  ).join('');

  const ld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ImageGallery',
    name: 'DigiArtz — Digital Art Gallery', url: 'https://digiartz.net/',
    hasPart: arts.map((a, i) => ({
      '@type': 'ImageObject', position: i + 1, name: a.name,
      contentUrl: a.image_url, thumbnailUrl: thumb(a.image_url),
      url: `https://digiartz.net/artwork/${a.id}`,
      datePublished: (a.created_at || '').slice(0, 10)
    }))
  }).replace(/<\//g, '<\\/');   // can't break out of the <script> tag

  return new HTMLRewriter()
    .on('div#awGrid', {
      element(el) { el.setInnerContent(cards, { html: true }); }
    })
    .on('head', {
      element(el) {
        el.append(`<script type="application/ld+json">${ld}</script>`, { html: true });
      }
    })
    .transform(origin);
     }
