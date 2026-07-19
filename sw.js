/* ═══════════════════════════════════════════════════════════════════
   DigiArtz service worker — offline cache layer.

   Registered by index.html:
     navigator.serviceWorker.register('/sw.js')

   Works with the localStorage data snapshots (dzcSet/dzcGet) in
   index.html: those cache the JSON (artworks, messages, friends,
   convos); this file caches the FILES (app shell, fonts, images) so
   the site actually opens and renders with no network at all.

   Four caches, each bounded:

     dz-shell-v1  index.html + config.js + the two JS modules + icons
                  (stale-while-revalidate; also the offline fallback
                  for deep links like /artwork/123 and /profile/koe)
     dz-thumb-v1  300px grid thumbnails    — cap 60
                  (warmed on launch by dzcPrefetchThumbs(), which
                  issues plain no-cors fetches we intercept here)
     dz-view-v1   1000px lightbox images   — cap 50
                  (cached the moment an artwork is opened)
     dz-font-v1   Google Fonts CSS + WOFF2 — cap 20

   Never cached: Supabase REST/Realtime (always live; offline reads
   come from the localStorage snapshots), analytics, and ads.

   Bump CACHE_VERSION to force every client to drop and refill.

   v13 — albums, tags and featured-strip rework (supersedes v12,
   which covered the same work mid-flight).
     - Albums: profile tab, Settings manager, album detail page and
       an optional multi-select picker on upload. Likes and Bookmarks
       show up as virtual albums.
     - Tags: a chip rail under the hero plus a second one in the
       gallery (both share state), per-user preferences that BOOST
       feed order without ever filtering, and a tag search grid.
     - Featured strip: 1/2/3/4 slides per view by breakpoint, snap
       carousel with arrows + dots, a large two-line title, and a
       tap-through detail page (image, title, description, date).
     - Fixes scheduled uploads, which were publishing immediately
       because publishAt never reached the upload job.
   index.html changed substantially — every client must drop the
   old shell.
   v11 — upload session reset: a finished upload now clears every
   scrap of form state (files, focal point/zoom, preview, fields,
   schedule, draft link) so the next piece starts clean.
   v10 — upload page rebuild: full-page Upload destination (guest-
   viewable), thumbnail zoom (thumb_zoom), device-local Drafts,
   server-side Scheduled uploads, draft/schedule preview modal and
   the custom themed date picker. index.html changed substantially,
   so every client must drop the old shell.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const CACHE_VERSION = 'v13';
const SHELL = `dz-shell-${CACHE_VERSION}`;
const THUMB = `dz-thumb-${CACHE_VERSION}`;
const VIEW  = `dz-view-${CACHE_VERSION}`;
const FONT  = `dz-font-${CACHE_VERSION}`;
const KEEP  = [SHELL, THUMB, VIEW, FONT];

/* Cap each image cache so a heavy browsing session can't fill the
   origin's storage quota and get the whole bucket evicted. */
const LIMITS = { [THUMB]: 60, [VIEW]: 50, [FONT]: 20 };

/* Precached on install. Kept deliberately small — everything else is
   cached lazily as it's actually requested. */
const SHELL_URLS = [
  '/',
  '/index.html',
  '/config.js',
  '/aiAssistantData.js',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png'
];

/* Hosts. DIT = the resize distribution (thumbnails + lightbox).
   ORIGIN_CDN = the untouched originals, used by Download — we do NOT
   cache those; they're large and only fetched on an explicit save. */
const DIT_HOST     = 'd1l8dn7jegdgem.cloudfront.net';
const SUPABASE_RE  = /\.supabase\.co$/;
const FONT_RE      = /^fonts\.(googleapis|gstatic)\.com$/;
const BYPASS_RE    = /(googletagmanager|google-analytics|googlesyndication|doubleclick|cloudflareinsights)\./;

/* index.html builds these via imgResize(url, W, Q):
     thumbnail → /fit-in/300x0/filters:format(webp):quality(55)/<key>
     lightbox  → /fit-in/1000x0/filters:format(webp):quality(68)/<key>
   Match on the width segment so a future quality tweak doesn't
   silently stop the caching. */
const THUMB_PATH_RE = /\/fit-in\/300x0\//;
const VIEW_PATH_RE  = /\/fit-in\/1000x0\//;

/* ── install ── precache the shell, then take over immediately ──────
   addAll() is atomic: one 404 aborts the whole install. config.js is
   gitignored and only exists on the deployment, so cache entries
   individually and tolerate misses rather than bricking the SW. */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

/* ── activate ── drop stale versions, claim open tabs ─────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('dz-') && !KEEP.includes(n))
           .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* Trim a cache to its cap, oldest-first. Cache.keys() returns entries
   in insertion order, so the head of the list is the least recently
   ADDED (not used) — good enough, and it costs no bookkeeping. */
async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

/* Cache-first, for immutable-ish assets (images, fonts).

   NOTE ON OPAQUE RESPONSES: dzcPrefetchThumbs() fetches thumbnails
   with { mode:'no-cors' }, so the response is opaque — status 0, body
   unreadable. That's fine: the Cache API stores opaque responses and
   replays them into <img> tags perfectly. We must NOT test res.ok
   here, because an opaque response always reports ok:false. Test for
   a real error status instead. (Opaques do bloat quota via padding,
   which is exactly why every image cache above is capped.) */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.type === 'opaque' || res.ok)) {
      await cache.put(request, res.clone());
      trim(cacheName);                     /* fire-and-forget */
    }
    return res;
  } catch (err) {
    const stale = await cache.match(request, { ignoreVary: true });
    if (stale) return stale;
    throw err;
  }
}

/* Stale-while-revalidate, for the shell: paint instantly from cache,
   refresh in the background so the next load has the new build. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* Only GET. POST/PATCH (uploads, likes, messages) must always hit
     the network — never serve those from a cache. */
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  /* Live data + telemetry: stay out of the way entirely. */
  if (SUPABASE_RE.test(url.hostname) || BYPASS_RE.test(url.hostname)) return;

  /* Navigations (including deep links /artwork/123, /profile/koe —
     which Cloudflare rewrites to index.html). Network-first so a fresh
     build is picked up straight away; fall back to the cached shell so
     the app still boots with no connection. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match(req)) ||
               (await cache.match('/index.html')) ||
               (await cache.match('/')) ||
               Response.error();
      }
    })());
    return;
  }

  /* Resized artwork images off the DIT distribution. */
  if (url.hostname === DIT_HOST) {
    if (THUMB_PATH_RE.test(url.pathname)) {
      event.respondWith(cacheFirst(req, THUMB));   /* top-50 grid thumbs */
      return;
    }
    if (VIEW_PATH_RE.test(url.pathname)) {
      event.respondWith(cacheFirst(req, VIEW));    /* last-50 opened artworks */
      return;
    }
    return;   /* any other size → straight to network, uncached */
  }

  /* Google Fonts — the stylesheet and the WOFF2 files it points at. */
  if (FONT_RE.test(url.hostname)) {
    event.respondWith(cacheFirst(req, FONT));
    return;
  }

  /* Our own static assets: config.js, the JS modules, icons, manifest. */
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});

/* Lets a future build force an update without a hard reload:
     navigator.serviceWorker.controller.postMessage({ type:'SKIP_WAITING' }) */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
