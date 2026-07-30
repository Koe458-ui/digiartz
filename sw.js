/* service worker, offline cache
   caches: shell, thumbs, lightbox images, fonts
   supabase, analytics and ads are never cached
   bump CACHE_VERSION to refill every client

   changelog
   v71 — storage migration, phases 1-3. Media is moving off S3 +
       CloudFront onto Supabase Storage, in stages, with both hosts
       serving at once so nothing breaks mid-move.
       Two buckets: koe-media stays public and unchanged for display
       derivatives, avatars and banners (all eleven of its existing
       policies intact); a new private koe-originals holds artwork
       originals and paid asset files, reachable only through a signed
       url minted after the daily quota is spent.
       Sizes are now generated once at upload rather than resized on the
       fly, because Supabase image transformations are a paid-plan
       feature and this must work on Free. Each size is its own object,
       distinguished by a filename suffix — __t300 / __v1000 / __f1600 —
       and the size sits in the filename rather than a path prefix so
       koe-media's foldername[2] = auth.uid() policies keep working.
       imgResize, the edge middleware and the sitemap all dual-read: a
       CloudFront url still resizes on the fly, a Supabase url swaps the
       suffix. Correct whether or not a given row has been migrated.
       The SW previously skipped every Supabase host, which after the
       move would have meant zero caching for images and the largest
       possible metered egress. Public storage objects are now cached by
       size, thumbs and lightbox views, while rest/auth/realtime stay
       uncached as before.
       scripts/migrate-storage.mjs copies the objects across, pulling
       each derivative from the resizer distribution being retired so
       nothing is re-encoded. Must run before that distribution is
       disabled.
       Changed: js/app-core.js, sw.js, functions/_middleware.js,
       _middleware.js, functions/sitemap.xml.js,
       scripts/migrate-storage.mjs (new),
       security/storage-migration.sql.

   v70 — artwork downloads are metered per day and no longer reachable
       any way except the Download button. The button now posts to
       /api/download, which spends a quota unit through
       dz_request_download and streams the file back from our own
       origin as an attachment, so the raw CDN url never reaches the
       browser. /api/* is POST-only here and the SW ignores non-GET, so
       nothing new is cached. js/protect.js joins the shell: it kills the
       long-press / right-click image menu, image dragging and the save
       page shortcut, and base.css carries the matching -webkit-touch-
       callout rules.
       The subscription page states the numbers instead of hinting at
       them: a Free 5 / Lite 10 / Premium 15 / Max 20 per-day strip above
       the plan cards, the reset time and the resolution difference in
       writing, and each card's first bullet is its own daily count. The
       old copy said "download limited assets" and "more downloads per
       month", which was both vague and, after this change, wrong.
       base.css, viewer.css, panels.css and gallery.js all changed, so
       their ?v= moved with them.
       /api/download only answers requests that carry a same-origin browser
       signal, and it refuses expired or malformed tokens by reading the JWT
       locally before it spends a Supabase roundtrip. Attempts are capped at
       30 a minute per account and 60 per IP, so a script cannot run the bill
       up on refusals after the daily quota is gone.
       Bytes no longer come from a public url at all. /api/download asks
       smart-function for a source, and that function mints a short-lived
       presigned S3 GET only after the quota has been spent — the gate sits
       beside the AWS credentials, so a signed url cannot exist without a
       download having been charged. Paid tiers get the original that way;
       free tiers get the public resized derivative the image CDN already
       serves for display. This is what lets the origin bucket stop being
       world-readable, so the three remaining places that pointed at the
       stored original now point at the resized copy instead: the sitemap's
       <image:loc>, the client og:image / twitter:image / JSON-LD, and the
       My Work edit-form thumbnail. Display, thumbnails and avatars already
       went through the resizer and are untouched.
       A second sweep caught the rest of the readers of the stored original,
       all of them crawler-facing: the JSON-LD contentUrl the edge middleware
       writes for the gallery and for each artwork, 37 hardcoded URLs in the
       static ldGallery block in index.html, and the blog cover download link.
       All now resolve through the resizer, so locking the origin bucket
       cannot cost image-search indexing. Nothing in the repo references the
       origin host any more.
       Changed: index.html, js/gallery.js, js/mywork.js, js/sections.js,
       js/protect.js (new), css/base.css, css/viewer.css, css/panels.css,
       functions/api/download.js (new), functions/sitemap.xml.js,
       functions/_middleware.js, _middleware.js,
       supabase/functions/smart-function/ (new, mirror of the deployed v16),
       security/daily-download-quota.sql (new, record only).

   v69 — the precache was covering URLs nobody asks for. Every tag in
       index.html carries a query string (/css/base.css?v=1) while
       SHELL_URLS listed the bare path (/css/base.css), and cache.match
       keys on the full URL including the search, so 38 of the 41 shell
       assets were precached under a name the page never requests. They
       missed on every first load and only got cached once a network
       fetch had already succeeded — which is the one thing precaching
       exists to avoid, and it left a freshly installed client with no
       usable CSS or JS if it went offline before a full load. The list
       now mirrors the tags exactly. When you change a shell file, bump
       its ?v= in both index.html and here — they have to move together.
       Changed: sw.js.

   v68 — three quick links repointed at the page each one actually
       belongs to. Level was opening the ranking board of the same name;
       it now opens Artist Progress, the profile's own level page, and
       clears the last-viewed profile first — that page targets whoever
       you looked at most recently, so without the reset a quick link
       would show someone else's level. Ranking takes over the full
       boards, the page the hero strip's VIEW FULL RANKING leads to,
       instead of scrolling down to that strip. Subscription and Theme
       already opened the same pages Settings does and are unchanged.
       closeXpPage joins the sweep, since Artist Progress hides the
       bottom bar while it is up and bnCloseAllSections does not know it.
       Changed: index.html, js/sections.js.

   v67 — quick links land in the right place. Tapping one opened the
       right thing but not where it belongs: Cart showed the cart panel
       with the section tab strip still scrolled to Artworks, so its own
       tab sat off-screen and there was no sign of which section you
       were in, and the bottom bar still lit Home. qlGo called openFG()
       and the bare open* functions, which are the raw openers —
       bnGoGallery / bnGoUpload are the real entries and additionally
       close whatever else is open, reset the category filter and set
       the nav highlight. Community was already routed through
       bnGoCommunity, which is why it alone behaved. Every destination
       now goes through the same door, and Subscription, Level, Theme
       and Ranking close open overlays first. fgSwitchSection also
       scrolls the active tab into view, so arriving from a quick link
       or the hero CTA shows where you are.
       Changed: index.html, js/sections.js, js/gallery.js.

   v66 — the quick links rendered unstyled on a first load after v65 on
       some browsers: giant SVGs, title and description running together
       on one line, grey default button chrome. Nothing wrong with the
       CSS — the page was being served the previous hero.css. Navigations
       are network-first, so index.html is always fresh, but same-origin
       assets are stale-while-revalidate, which hands back the cached copy
       and only then refetches. New markup therefore paints against last
       release's stylesheet, and the fix does not land until a second
       reload. Every asset in index.html was pinned at ?v=1 and had never
       been bumped, so the URL never changed and the cache entry never
       missed. hero.css and sections.js now carry ?v=65, which is a cache
       key the old shell cannot hold, so the very first load after a
       deploy gets the matching pair. SHELL_URLS carries the same two
       query strings so the precache still covers what the page asks for
       (the other entries there are still unversioned, matching their
       tags). Bump the ?v= on any shell file you change from here on.
       Also drops color-mix() out of the quick links: the light theme now
       carries a spelled-out --qlL per item and the progress track uses
       rgba(), so browsers older than Chromium 111 / Safari 16.2 get the
       same result instead of a washed-out or invisible one.
       Changed: index.html, css/hero.css, sw.js.

   v65 — homepage quick links. A row of twelve icon + title +
       description shortcuts now sits between the hero pitch and the
       search bar, split into two halves of six: browse (Artworks,
       Marketplace, Resources, Blog, Jobs, Community) then yours
       (Upload, Ranking, Level, Subscription, Cart, Theme), so a large
       desktop shows one whole half per screen. It is a snap scroller
       whose slot count follows the device and never leaves 2–6: 2 mobile,
       3 large mobile, 4 tablet, 5 desktop, 6 large desktop, and 6 on
       ultrawide with the row capped and centred rather than stretched.
       Icons sit in a fixed box and descriptions reserve two lines, so
       titles and card heights line up whatever the copy does. A thin
       line under the row tracks scroll position and hides itself when
       nothing overflows. The icon hues are picked against near-black,
       so the light theme darkens them and the progress track is tied
       to the text colour — otherwise lime and cyan sat near 1.4:1 on
       #F6F6F9. Every theme now clears 4.5:1 on text and 3:1 on icons.
       Changed: index.html, css/hero.css, js/sections.js.

   v64 — homepage feed is pure trending. renderAwGrid ran the trending
       sort and then tgPrioritize() pulled every artwork matching a
       saved tag preference to the front, so the homepage order did not
       match the gallery's. The call is gone; both now use the same
       sortByTrending. tgPrioritize and tgAfterChange were its only
       users and are removed with it. Changed: js/search.js,
       js/tagrail.js.

   v63 — comments across the codebase reduced to short keyword labels,
       site description rewritten in plain wording, and the U+2726
       sparkle dropped where it was punctuation in toasts and buttons.

   v62 — homepage: the chip rail and the Artworks/Latest/category tab
       strip are gone. The search bar is now the last thing above the
       feed, so artwork starts immediately under it on every device.
       The tag rail survives in the Full Gallery overlay only.
       index.html changed substantially — every client must drop the
       old shell.

   v61 — security hardening. The artwork upload now forwards a server-
       signed moderation approval token (mod_token) on both the direct
       and scheduled publish paths, so the DB-side moderation gate can
       verify a real moderation pass before an insert is trusted as
       approved. Changed: js/upqueue.js.

   v60 — artwork dropzone matches the new picker. The artwork upload's
       drop target now uses the same anatomy as the section forms: the
       Artworks gradient mark instead of the ⬆ emoji tile, a "Select
       image" action in place of "📁 Choose Files", the accepted
       formats as a spaced caption, and the roomier padding. The extra
       pages zone follows, keeping its per-mode emoji (📖 / 🖼).
       Changed: index.html, css/upload.css.

   v59 — section upload file picker. The Resources / Blog / Marketplace
       forms used the browser's bare "Choose file" control; each file
       field is now a dropzone matching the artwork page — drag & drop,
       a Select image / Select file action, the accepted formats, and
       the picked file shown back with a thumbnail (or its extension),
       size, Replace and Remove. The tile carries that section's own
       gradient icon, the same mark the gallery rail and upload tabs
       use. Roomier padding and field spacing throughout the picker.
       Changed: js/sections.js, css/hero.css. Both already ship in the
       shell, so this bump is what gets them to existing clients.

   v58 — upload page side margin 8% → 10%. Laptop and up (PC, desktop,
       ultrawide, TV) now leave 10% of the viewport empty on each side
       of the single column. css/upload.css only.

   v57 — upload page is one column. The upload page rendered as three
       side-by-side columns on desktop (media | fields | sidebar) and
       paired Category with Tags; everything now stacks one item per
       line at every width, including the action buttons. No width cap
       on the page any more — big screens get an 8% empty margin down
       each side instead, so the column grows with the screen. The
       section forms (Resources, Blog, Marketplace, Jobs) lose their
       form-plus-sidebar split the same way, and their SCHEDULED /
       SAVED DRAFTS strips are now the artwork rail itself: the same
       scrolling .upDraftRow of square .upDraftCard tiles with the
       top-left ✕ and the corner expiry / countdown mark, only filled
       with text instead of a thumbnail (a section draft has no image).
       Changed: css/upload.css, css/overrides.css, js/sections.js.
       This bump is what gets the new CSS to clients that already have
       the old stylesheets in the shell cache.

   v39 — section schedule + drafts. The section forms (Resources, Blog,
       Marketplace, Jobs) now match the artwork upload: a two-column
       layout with a sidebar (SCHEDULED strip, SAVED DRAFTS strip,
       Upload Guidelines, Tips), the Reset button replaced by 💾 Save
       Draft, and a Schedule field using the same custom calendar the
       artwork upload uses. Scheduling is fully server-side, mirroring
       artworks: the built row + its S3 files are parked in the new
       public.scheduled_sections table and a five-minute pg_cron
       (publish_due_scheduled_sections) inserts it into the real table
       at the set time, so a post goes live even with the device off.
       Drafts are device-local (IndexedDB 'dzsecdrafts'), text + tags
       only, auto-purged after 7 days. Drafts and scheduled posts show
       as text-first cards (.dzPCard) — status badge, title, excerpt,
       meta — since these posts are words, not thumbnails. Changed:
       js/sections.js, css/overrides.css. Backend applied separately.

   v38 — upload selects skinned. The section forms (Resources, Blog,
       Marketplace, Jobs) shipped native Chrome <select> boxes —
       .dzSel — and the schedule hour/minute (.upSchedSel) did too, so
       they stuck out grey and system-font next to the artwork upload's
       custom controls. css/overrides.css gains a § UPLOAD SELECTS +
       CALENDAR block giving both the same appearance:none + SVG chevron
       + theme-token option list that select.upIn already uses, so they
       now read identically to the artwork upload. The Jobs date field's
       calendar glyph is dimmed until hover/focus; its popup already
       follows color-scheme. One file changed, loads last, nothing else
       touched.

   v37 — title colour. Removing the star in v36 took the only accent
       colour out of every heading, so the accent moves onto the words:
       css/overrides.css gains a § TITLE COLOUR block setting .secT,
       .subPgTitle, .subPgHeadline h2, .faqTitle, .apTitle, .apDescTitle,
       .spTitle, .cpTitle, .albModTitle, .tgModTitle, .pfShareTitle,
       .fltPH h3, .upDraftTitle, .dmConvoHead, .cLbl and .xpRankTitle to
       var(--pg). It is the theme token, not a fixed purple, so Light and
       the mono themes follow their own accent. .fgTitle and .cmHdrTitle
       keep their gradient — they stay the top tier. One file changed,
       and it already loads last, so nothing else needed touching.

   v36 — heading stars removed. The decorative four-pointed star that
       sat in the <span class="s"> slot after almost every page and
       section title is gone: Gallery, Profile, Upload, Community,
       Ranking, Subscription, Settings, Albums, Bookmarks, Friends,
       Filters, Sponsor, Admin, Drafts, Share Profile, Tags, the FAQ
       and Choose Your Plan headings, the LET'S CONNECT divider, the
       MESSAGES conversation head and the footer logo mark. Titles
       built in JS lose it too — album name / rename / new album
       (js/albums.js), the Likes-Bookmarks page head (js/engagement.js)
       and the XP rank title (js/misc-core.js). The .s rules stay in
       CSS because four non-star markers still use them: Edit My Work,
       Notifications, Account and Theme. Four shell files changed, no
       new paths, so this bump is purely to pull returning visitors
       off the stale cached copies.

   v35 — scroll-reveal deleted. The .fu-el rise (opacity 0 + 50px,
       850ms, staggered 80ms per card) is gone from artworks, ranking,
       subscriptions and connect — not gated, removed. js/effects.js
       loses its last module entirely, 192 lines, taking with it the
       IntersectionObserver and the MutationObserver that re-scanned
       every grid re-render; the .fu-el rules go from css/connect.css
       and the 24px rank-card variant from css/ranking.css. A stale
       cached effects.js can no longer hide anything, because nothing
       stamps the class and no rule acts on it. The stale note in
       js/startup.js describing the restamp is corrected. Four shell
       files changed, no new paths.

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
*/
'use strict';

const CACHE_VERSION = 'v71';
const SHELL = `dz-shell-${CACHE_VERSION}`;
const THUMB = `dz-thumb-${CACHE_VERSION}`;
const VIEW  = `dz-view-${CACHE_VERSION}`;
const FONT  = `dz-font-${CACHE_VERSION}`;
const KEEP  = [SHELL, THUMB, VIEW, FONT];

// cap each image cache
const LIMITS = { [THUMB]: 60, [VIEW]: 50, [FONT]: 20 };

// precached shell
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

  // stylesheets
  '/css/base.css?v=2',
  '/css/hero.css?v=65',
  '/css/viewer.css?v=2',
  '/css/community.css?v=1',
  '/css/connect.css?v=1',
  '/css/ranking.css?v=1',
  '/css/profile.css?v=1',
  '/css/admin.css?v=1',
  '/css/auth.css?v=1',
  '/css/panels.css?v=2',
  '/css/upload.css?v=1',
  '/css/widgets.css?v=1',
  '/css/overrides.css?v=1',

  // word list goes with the engine
  '/js/badwords-list-a.js?v=1',
  '/js/badwords-list-b.js?v=1',
  '/js/badwords.js?v=1',

  // scripts
  '/js/ranking.js?v=1',
  '/js/community.js?v=1',
  '/js/dm.js?v=1',
  '/js/composer.js?v=1',
  '/js/share.js?v=1',
  '/js/misc-core.js?v=1',
  '/js/app-core.js?v=2',
  '/js/protect.js?v=1',
  '/js/gallery.js?v=67',
  '/js/auth.js?v=1',
  '/js/profile.js?v=1',
  '/js/albums.js?v=1',
  '/js/drafts.js?v=1',
  '/js/upqueue.js?v=1',
  '/js/avatar.js?v=1',
  '/js/pfedit.js?v=1',
  '/js/mywork.js?v=2',
  '/js/startup.js?v=1',
  '/js/tagrail.js?v=1',
  '/js/search.js?v=1',
  '/js/effects.js?v=1',
  '/js/cookie.js?v=1',
  '/js/zeo.js?v=1',
  '/js/theme.js?v=1',
  '/js/engagement.js?v=1',
  '/js/sections.js?v=69'
];

// hosts
const DIT_HOST     = 'd1l8dn7jegdgem.cloudfront.net';
const SUPABASE_RE  = /\.supabase\.co$/;
const FONT_RE      = /^fonts\.(googleapis|gstatic)\.com$/;
const BYPASS_RE    = /(googletagmanager|google-analytics|googlesyndication|doubleclick|cloudflareinsights)\./;

// match the resize widths
const THUMB_PATH_RE = /\/fit-in\/300x0\//;
const VIEW_PATH_RE  = /\/fit-in\/1000x0\//;

// Supabase Storage public objects. Migrated images live here, and each size is
// a separate object identified by a filename suffix rather than a resize path.
// These MUST be cached: Supabase egress is metered, so an uncached thumbnail
// grid is the most expensive thing the site can do. Everything else on the
// Supabase host (rest, auth, realtime) stays uncached.
const SB_OBJECT_RE = /^\/storage\/v1\/object\/public\//;
const SB_THUMB_RE  = /__t300\.webp$/;
const SB_VIEW_RE   = /__v1000\.webp$/;

// install, precache the shell
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    await self.skipWaiting();
  })());
});

// activate, drop stale versions
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

// trim to cap, oldest first
async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

// cache first
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.type === 'opaque' || res.ok)) {
      await cache.put(request, res.clone());
      // fire and forget eviction
      trim(cacheName).catch(() => {});
    }
    return res;
  } catch (err) {
    const stale = await cache.match(request, { ignoreVary: true });
    if (stale) return stale;
    throw err;
  }
}

// stale while revalidate
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

  // get only
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // migrated images, cached by size. checked before the Supabase skip below,
  // which is there for rest/auth/realtime and would otherwise cover these too
  if (SUPABASE_RE.test(url.hostname) && SB_OBJECT_RE.test(url.pathname)) {
    if (SB_THUMB_RE.test(url.pathname)) { event.respondWith(cacheFirst(req, THUMB)); return; }
    if (SB_VIEW_RE.test(url.pathname))  { event.respondWith(cacheFirst(req, VIEW));  return; }
    return;   // other sizes, no cache
  }

  // skip live data
  if (SUPABASE_RE.test(url.hostname) || BYPASS_RE.test(url.hostname)) return;

  // navigations, network first
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

  // resized images
  if (url.hostname === DIT_HOST) {
    if (THUMB_PATH_RE.test(url.pathname)) {
      event.respondWith(cacheFirst(req, THUMB));   // grid thumbs
      return;
    }
    if (VIEW_PATH_RE.test(url.pathname)) {
      event.respondWith(cacheFirst(req, VIEW));    // opened artworks
      return;
    }
    return;   // other sizes, no cache
  }

  // google fonts
  if (FONT_RE.test(url.hostname)) {
    event.respondWith(cacheFirst(req, FONT));
    return;
  }

  // own static assets
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
  }
});

// skip waiting message
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
