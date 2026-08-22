
'use strict';

const CACHE_VERSION = 'v235';


const STATIC = `dz-static-${CACHE_VERSION}`;     
const THUMB  = `dz-img-thumb-${CACHE_VERSION}`;  
const CARD   = `dz-img-card-${CACHE_VERSION}`; 
const VIEW   = `dz-img-view-${CACHE_VERSION}`;
const FULL   = `dz-img-full-${CACHE_VERSION}`;   
const MEDIA  = `dz-img-media-${CACHE_VERSION}`;  
const FONT   = `dz-font-${CACHE_VERSION}`;
const KEEP   = [STATIC, THUMB, CARD, VIEW, FULL, MEDIA, FONT];
const IMAGE_CACHES = [THUMB, CARD, VIEW, FULL, MEDIA];

const LIMITS = {
  [THUMB]: 300,
  [CARD]:  150,
  [VIEW]:  60,
  [FULL]:  6,
  [MEDIA]: 150,
  [FONT]:  20
};


const SHELL_URLS = [
  '/',
  '/index.html',
  '/config.js',
  '/uploadVerifier.js',
  '/aiAssistantData.js',
  '/site.webmanifest',
  '/favicon.svg?v=3',
  '/favicon.ico?v=3',
  '/apple-touch-icon.png?v=3',
  '/icon-192.png?v=3',

  '/css/base.css?v=12',
  '/css/hero.css?v=101',
  '/css/viewer.css?v=33',
  '/css/community.css?v=19',
  '/css/connect.css?v=6',
  '/css/ranking.css?v=4',
  '/css/profile.css?v=14',
  '/css/admin.css?v=4',
  '/css/auth.css?v=3',
  '/css/panels.css?v=13',
  '/css/upload.css?v=15',
  '/css/widgets.css?v=12',
  '/css/overrides.css?v=36',
  '/css/select.css?v=4',
  '/css/analytics.css?v=9',

  '/js/vendor/supabase-js-2.112.2.min.js',

  '/js/badwords-list-a.js?v=1',
  '/js/badwords-list-b.js?v=1',
  '/js/badwords.js?v=2',
  '/js/captcha.js?v=2',

  '/js/cache.js?v=1',
  '/js/ranking.js?v=3',
  '/js/community.js?v=6',
  '/js/dm.js?v=10',
  '/js/composer.js?v=2',
  '/js/share.js?v=1',
  '/js/misc-core.js?v=5',
  '/js/app-core.js?v=31',
  '/js/protect.js?v=3',
  '/js/gallery.js?v=100',
  '/js/auth.js?v=20',
  '/js/profile.js?v=16',
  '/js/albums.js?v=18',
  '/js/drafts.js?v=8',
  '/js/upqueue.js?v=7',
  '/js/avatar.js?v=3',
  '/js/pfedit.js?v=15',
  '/js/mywork.js?v=23',
  '/js/startup.js?v=7',
  '/js/tagrail.js?v=3',
  '/js/search.js?v=11',
  '/js/feed.js?v=3',
  '/js/fgshow.js?v=4',
  '/js/effects.js?v=9',
  '/js/legal-content.js?v=1',
  '/js/cookie.js?v=1',
  '/js/zeo.js?v=2',
  '/js/theme.js?v=6',
  '/js/analytics.js?v=8',
  '/js/engagement.js?v=9',
  '/js/sections.js?v=119',
  '/js/routes.js?v=2',
  '/js/navprogress.js?v=5'
];

const API_RE       = /^\/api\//;
const SUPABASE_RE  = /\.supabase\.co$/;
const FONT_RE      = /^fonts\.(googleapis|gstatic)\.com$/;
const BYPASS_RE    = /(googletagmanager|google-analytics|googlesyndication|doubleclick|cloudflareinsights)\./;

const SB_OBJECT_RE = /^\/storage\/v1\/object\/public\//;
const SB_T300_RE   = /__t300\.webp$/;
const SB_T600_RE   = /__t600\.webp$/;
const SB_V1000_RE  = /__v1000\.webp$/;
const SB_F1600_RE  = /__f1600\.webp$/;
const SB_IMAGE_RE  = /\.(?:webp|jpe?g|png|gif|avif|svg)$/i;

function imageCacheFor(pathname) {
  if (SB_T300_RE.test(pathname))  return THUMB;
  if (SB_T600_RE.test(pathname))  return CARD;
  if (SB_V1000_RE.test(pathname)) return VIEW;
  if (SB_F1600_RE.test(pathname)) return FULL;
  if (SB_IMAGE_RE.test(pathname)) return MEDIA;
  return null;
}

function isVersioned(url) {
  return url.searchParams.has('v') || /\/js\/vendor\//.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    await Promise.all(SHELL_URLS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith('dz-') && !KEEP.includes(n))
           .map((n) => caches.delete(n))
    );
    await pruneStatic();
    await self.clients.claim();
  })());
});

async function pruneStatic() {
  try {
    const cache = await caches.open(STATIC);
    const abs = SHELL_URLS.map((u) => new URL(u, self.location.origin));
    const want = new Set(abs.map((u) => u.href));
    const wantPaths = new Set(abs.map((u) => u.pathname));
    const keys = await cache.keys();
    await Promise.all(keys.map(async (req) => {
      const u = new URL(req.url);
      if (!wantPaths.has(u.pathname)) return;  
      if (!want.has(u.href)) await cache.delete(req);
    }));
  } catch (err) { /* a prune that fails costs space, not correctness */ }
}


async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  const target = Math.floor(limit * 0.9);
  await Promise.all(keys.slice(0, keys.length - target).map((k) => cache.delete(k)));
}

async function imageFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  let res = null;
  try {
    res = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
  } catch (err) {
  
    try { return await fetch(request); }
    catch (err2) {
      const stale = await cache.match(request, { ignoreVary: true });
      if (stale) return stale;
      throw err2;
    }
  }
  if (res && res.ok) {
    await cache.put(request, res.clone());
    trim(cacheName).catch(() => {});   
  }
  return res;
}


async function anyVersionOf(cache, request) {
  try {
    const path = new URL(request.url).pathname;
    if (!/\.css$/i.test(path)) return null;
    const keys = await cache.keys();
    for (const req of keys) {
      if (new URL(req.url).pathname !== path) continue;
      const res = await cache.match(req);
      if (res) return res;
    }
  } catch (err) { /* fall through to whatever the caller had */ }
  return null;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(request, res.clone());
      trim(cacheName).catch(() => {});
    }
    if (res && !res.ok) {
      const older = await anyVersionOf(cache, request);
      if (older) return older;
    }
    return res;
  } catch (err) {
    const stale = await cache.match(request, { ignoreVary: true });
    if (stale) return stale;
    const older = await anyVersionOf(cache, request);
    if (older) return older;
    throw err;
  }
}

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

  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  if (SUPABASE_RE.test(url.hostname) && SB_OBJECT_RE.test(url.pathname)) {
    const bucket = imageCacheFor(url.pathname);
    if (bucket) { event.respondWith(imageFirst(req, bucket)); return; }
    return;   
  }

  if (SUPABASE_RE.test(url.hostname) || BYPASS_RE.test(url.hostname)) return;

  if (url.origin === self.location.origin && API_RE.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);

        if (res && res.ok && (url.pathname === '/' || url.pathname === '/index.html')) {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put('/index.html', copy)).catch(() => {});
        }
        return res;
      } catch {
        const cache = await caches.open(STATIC);
        return (await cache.match(req)) ||
               (await cache.match('/index.html')) ||
               (await cache.match('/')) ||
               Response.error();
      }
    })());
    return;
  }

  if (FONT_RE.test(url.hostname)) {
    event.respondWith(cacheFirst(req, FONT));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(isVersioned(url)
      ? cacheFirst(req, STATIC)
      : staleWhileRevalidate(req, STATIC));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }

  if (data.type === 'DZ_DROP_IMAGES' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const sizes = ['__t300.webp', '__t600.webp', '__v1000.webp', '__f1600.webp'];
      const targets = [];
      data.urls.forEach((raw) => {
        if (typeof raw !== 'string' || !raw) return;
        targets.push(raw);
        const base = raw.replace(/__(?:t300|t600|v1000|f1600)\.webp$/, '');
        if (base !== raw) sizes.forEach((s) => targets.push(base + s));
      });
      const caches_ = await Promise.all(IMAGE_CACHES.map((n) => caches.open(n)));
      await Promise.all(caches_.map((c) =>
        Promise.all(targets.map((u) => c.delete(u).catch(() => false)))
      ));
    })());
    return;
  }

  if (data.type === 'DZ_CACHE_STATS') {
    event.waitUntil((async () => {
      const out = { version: CACHE_VERSION };
      for (const name of KEEP) {
        try {
          const c = await caches.open(name);
          out[name] = (await c.keys()).length;
        } catch (err) { out[name] = -1; }
      }
      const port = event.ports && event.ports[0];
      if (port) port.postMessage(out);
      else if (event.source && event.source.postMessage) {
        event.source.postMessage({ type: 'DZ_CACHE_STATS_RESULT', stats: out });
      }
    })());
  }
});
