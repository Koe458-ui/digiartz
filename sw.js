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

   v34 — hero motion stripped + connect links. The hero pitch no longer
       fades and rises 14px on every tab switch, the CTA no longer lifts
       on hover, and the floating badge / bell / Zeo button now cut in
       and out instead of sliding down 8px with a 250ms fade. Their
       translateZ(0) layer promotion stays — that's the iOS Safari
       white-flash fix, not decoration. In #connect, YouTube is gone and
       X is in at the new @DigiArtzHQ handle, leaving X / Instagram /
       Website / Email. No new precache paths; index.html, base.css and
       hero.css all already ship in the shell, so this bump is purely to
       get returning visitors off the stale copies.

   v33 — v32 shipped index.html and this file without the three /js
       badwords files, so the page requested scripts that 404'd and the
       filter never ran. This bump exists to re-run install once those
       files are actually there, otherwise clients that took v32 keep a
       shell that never precached them. Also strips the third-party
       source name out of the note below — that credit now lives in
       ATTRIBUTIONS.md at the repo root, which is where it has to stay:
       the word list is CC BY 4.0 and attribution is a condition of use.

   v32 — profanity + link mask. Three new files in /js: two word-list
       files (badwords-list-a/b.js, 2,536 entries across 27 languages)
       and badwords.js, which wraps supabase.createClient() so every
       insert/update/upsert/rpc gets masked on the way out. All three are
       precached below — the engine is useless without its lists, so an
       offline client must never hold one and not the others. index.html
       changed too (the three new script tags). Numbers are deliberately
       NOT filtered: order and payment references, image IDs and
       timestamps all live in that space. badwords-review.js is NOT
       precached — it ships nothing active and is only loaded if a
       held-back word gets switched on.

   v31 — follow-up to v30: the retired AI Art category was still
       reaching the tag rail. tgLabel() falls back to the raw slug for
       anything it has no label for, so dropping it from SITE_CATEGORIES
       turned the chip into a bare lowercase "ai-art" instead of hiding
       it. The rail feeds from get_top_tags() and saved user_tag_prefs,
       neither of which goes through catList(), so both are now filtered
       through a shared catHidden() predicate. The lightbox tag chips
       are guarded the same way.
   v30 — AI Art category retired from the UI and Zeo relabelled as a
       bot. The 18 artworks already tagged ai-art keep the value in the
       database; catList() just filters it out of every chip, filter and
       picker, so nothing is orphaned and the change is one line to
       revert. Zeo's badge and labels now read Bot instead of AI. The
       report reason and the upload rejection wording are unchanged.
   v29 — album privacy + per-tier cap. Like/Bookmark profile tabs are
       gone (saved artwork is private now); every album card gets a
       3-dot menu — Rename / Public-Private / Delete — with Likes and
       Bookmarks toggleable but never renameable or deletable. Album
       cap moved from a flat 100 to 25, or 30 on premium/max. Needs the
       album_visibility_and_tier_cap migration. css/widgets.css gains
       the menu styles; no new precache paths.
   v28 — resource / blog / marketplace image moderation. Gemini now
       gates Resources + Marketplace uploads (resource mode, MATURE
       allowed, AI previews rejected) and Blog covers (artwork mode),
       all through the same #upqBackdrop tracker artworks use. profile.js
       gains Resources / Blog / Marketplace tabs. No new precache paths —
       every changed file already ships in the shell — so this bump only
       forces returning clients onto the new JS.
   v27 — new favicon. Site icons regenerated from the DigiArtz bird
       logo (replacing the old "D"). Tab favicons now ship a dark-mode
       white variant switched by prefers-color-scheme in index.html;
       favicon-32x32.png is in the precache below, so this bump is what
       forces returning visitors off the stale cached icon. The 16/48
       and -dark variants cache lazily on first request.

   v26 — split shell. index.html's inline <style> and <script> blocks
       now live in /css (13 files) and /js (25 files); all 38 are
       precached alongside the shell so the first offline open still
       has the full site. uploadVerifier.js joins the precache list
       too — it was always part of the shell but only cached lazily.

   v25 — full-page + fit-first-screen. #artModal backdrop padding
       zeroed and the .avBox card fully flattened on every width (the
       old 2rem/.7rem paddings and min(1400px,94vw) card made it a
       box on desktop/tablet); viewer + stack + detail images now
       scale to calc(100dvh − 132px) so the whole image fits the
       first screen on any device, centered with side space.

   v24 — viewer spacing. Share is back as the last wide action after
       Download/Report; viewer + detail images are centered with
       clamp(1rem,5vw,3rem) side space and a 1100px cap instead of
       edge-to-edge.

   v23 — boxless viewers + FOUC fix. Viewer top bars are plain-text
       Previous/Next only (close = browser back or Escape); zoom bar,
       counter, close button and top icon row removed; images render
       directly on the page full-width with no stage/letterbox — in
       #dzView too, which now closes via the back button (history
       entry). 19 load-visible inline SVGs got width/height attributes
       so nothing flashes giant behind the transparent veil before the
       late stylesheet parses.

   v22 — cache resync. v21 shipped ahead of its index.html, so the
       v21 shell cache holds the OLD page; this bump forces every
       client to drop it and pick up the payments/detail-view/veil
       build in one visit instead of two (stale-while-revalidate).

   v21 — loading veil. The intro splash (logo, particles, progress
       bar, 2.8s minimum) is replaced by a transparent centered
       spinner + LOADING text. It blocks all input (see-through, not
       pass-through) and drops the instant the same tracked slices
       finish — zero minimum display time; 9s hang failsafe kept.

   v20 — detail views. Artwork viewer is a full-page single column:
       Previous top-left, Next top-right, all images stacked, author →
       details → NEW per-item comments (item_comments) → Download →
       Report; prev/next now clears image/title/like state instantly
       (data-id + synchronous engagement repaint). New #dzView overlay
       gives Resources/Blog/Marketplace/Jobs the same full-page detail
       treatment — comments on all but Jobs, Buy card top of the
       marketplace page, report everywhere (item_reports).

   v19 — desktop polish. ≥1280px layer at the end of <body>: grids
       capped at 1680px and centered (4 cols on small laptops, 5 at
       1440px+, wider gaps on ultrawide), 15px card titles and body
       copy, 12.5px meta, all primary buttons ≥46px tall with 14px
       labels. Mobile untouched.

   v18 — Razorpay payments + subscription revamp. Three-card plan
       grid ($1/$5/$10, Premium featured), checkout for plans and
       marketplace items via the /api/rzp Pages Function, buy/download
       buttons on marketplace cards, and the download button now asks
       dz_request_download() for tier quota + quality before opening
       the file. /api/* and checkout.razorpay.com are runtime-only and
       never cached: /api/rzp is a POST endpoint (SW ignores non-GET),
       and checkout.js is cross-origin, outside the cached hosts below.

   v17 — gallery becomes six sections; hero slides removed.
     - Gallery: Artworks / Resources / Blog / Marketplace / Jobs /
       Cart tabs (colour icon chips), one search bar per section with
       the filter riding at its tail, and per-option filter icons.
       The old SEARCH ARTWORK row (#fgQ) is gone.
     - Sections are live: resources, blog_posts, marketplace_items
       and jobs tables in Supabase; Resources/Marketplace files go to
       S3 under koe-media/resources/ and koe-media/market/ via the
       s3-sign edge function (now v14, ext-gated up to 200MB). Those
       downloads are fetched on explicit save only, so this worker
       deliberately does NOT cache them.
     - Upload page: What-are-you-posting rail (Artwork keeps its
       original form; Resources/Blog/Marketplace/Jobs forms are
       spec-generated; tags everywhere).
     - Hero banner slides deleted end to end: #topSlide strip + dot
       bar, #tsPage detail dialog, admin editor, hero_slides table,
       and the hero-slides/ signing prefix. 640 lines out.
     - In their place: the segmented hero pitch (Explore / Learn /
       Buy / Sell) — headline with brand-red highlight (--brand-red
       token, shared with the logo badge), checklist, CTA wired to
       the real surfaces, fade-and-rise per swap.
     - Section tab tap targets raised to ~47px; horizontal rails get
       overscroll containment.
   index.html changed substantially — every client must drop the
   old shell.
   v16 — sub-pixel fix in the tag rail packer. It measured chips with
   offsetWidth, which rounds to a whole pixel; with real webfont
   metrics a chip laying out at 86.4px reported 86, so ~16 chips
   under-counted a row by several px and the rail scrolled on desktop
   by exactly that much at roughly one width in three. Now measured
   with getBoundingClientRect, plus 1px of headroom because
   scrollWidth rounds up. Also: the All chip sticks at its inset
   instead of the raw scrollport edge, chip and clear-button touch
   targets grow into the row gutter, and hover states sit behind
   @media(hover:hover) so they can't stick after a tap.
   v15 — tag rail rebuilt, album tiles squared, thumbnail clip fixed.
     - Tag rail: a live artwork search bar over TWO chip rows instead
       of three. The bar filters the feed as you type (title,
       description, tags, category by slug and label, artist); the
       pinned "All" chip opens the tag grid. Rows pack to one
       desktop's worth of tags on every device, so a phone scrolls
       sideways to the same vocabulary a desktop shows at once.
       Picked tags now STAY on the rail, filled with the accent
       colour, instead of rotating out of sight.
     - Albums: the card is a square. The 2×2 cover mosaic fills it
       edge to edge and the name + item count sit inside at the
       bottom over a scrim. Grid columns and gaps now match
       .pfGridArt exactly. Creating an album lives on one surface
       only — the manager page, first tile.
     - Thumbnails: .admCardThumb gives Edit My Work cards their own
       square clip. thumbStyle()'s transform:scale() was painting
       outside its box and covering the title and the Edit/Delete
       row, which made zoomed cards look like tall blurry images
       with no controls.
   v14 — featured-strip caption resized. Title is now ~40% of the
   banner height and a two-line description sits under it, together
   filling ~60%. Both are measured in container units (cqh) so the
   proportion holds whether one slide is showing or four.
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

const CACHE_VERSION = 'v34';
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
  '/uploadVerifier.js',
  '/aiAssistantData.js',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',

  /* Split stylesheets — see the <link> block in index.html <head> */
  '/css/base.css',
  '/css/hero.css',
  '/css/viewer.css',
  '/css/community.css',
  '/css/connect.css',
  '/css/ranking.css',
  '/css/profile.css',
  '/css/admin.css',
  '/css/auth.css',
  '/css/panels.css',
  '/css/upload.css',
  '/css/widgets.css',
  '/css/overrides.css',

  /* Word list must be cached alongside the engine that reads it */
  '/js/badwords-list-a.js',
  '/js/badwords-list-b.js',
  '/js/badwords.js',

  /* Split scripts — see the <script src> tags through index.html */
  '/js/ranking.js',
  '/js/community.js',
  '/js/dm.js',
  '/js/composer.js',
  '/js/share.js',
  '/js/misc-core.js',
  '/js/app-core.js',
  '/js/gallery.js',
  '/js/auth.js',
  '/js/profile.js',
  '/js/albums.js',
  '/js/drafts.js',
  '/js/upqueue.js',
  '/js/avatar.js',
  '/js/pfedit.js',
  '/js/mywork.js',
  '/js/startup.js',
  '/js/tagrail.js',
  '/js/search.js',
  '/js/effects.js',
  '/js/cookie.js',
  '/js/zeo.js',
  '/js/theme.js',
  '/js/engagement.js',
  '/js/sections.js'
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
