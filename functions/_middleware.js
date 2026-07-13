/* ═══════════════════════════════════════════════════════════════════
   Edge prerender — Cloudflare Pages middleware.

   WAS: functions/functions/[[path]].js, written as a standalone Worker
   (`export default { fetch }`). Two things made it dead code there:
     1. Pages Functions dispatch on named onRequest* exports, not on a
        default module export — so Pages never invoked it.
     2. Nested one level deep, its route was /functions/*, not /.
   As _middleware.js it runs on every route, which is what it needs to
   do: rewrite the HTML shell on its way out.

   WHY IT EXISTS: index.html is a single-file SPA — its #awGrid is
   empty until JS runs, and crawlers that don't execute JS see nothing.
   This injects the 60 newest approved artworks as real <a href> cards
   plus an ImageGallery ld+json block, server-side, at the edge.
   It replaces the 33 artworks currently hard-baked into index.html,
   which freeze the moment the file is committed.

   REQUIRES two Pages environment variables (Settings → Environment
   variables → Production AND Preview):
     SB_URL   https://tmqzqlrpjpydiftlrzmj.supabase.co
     SB_KEY   the publishable/anon key (the same one in config.js)
   Without them fetchArtworks() returns [] and the page passes through
   untouched — degraded, never broken.
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

export async function onRequest(context) {
  const { env, next } = context;

  /* next() runs the rest of the pipeline — the sitemap.xml Function on
     that route, the static asset (or the /artwork/* rewrite to
     index.html) everywhere else. */
  const origin = await next();

  /* Anything that isn't an HTML document — sw.js, config.js, images,
     sitemap.xml — is returned exactly as-is. Critically this means the
     service worker keeps its application/javascript content-type. */
  const ct = origin.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return origin;

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
