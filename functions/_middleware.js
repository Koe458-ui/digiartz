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
// Gated on T600_READY for the same reason as the client — a srcset candidate
// that 404s breaks the image rather than falling back. Unset, this emits
// exactly the single-src markup it always did.
//
// Pages environment variables arrive as STRINGS, so a bare truthiness test
// would read "false" and "0" as ON — which is precisely how someone disabling
// this would write it. Only the affirmative spellings count.
const flagOn = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

function thumbAttrs(url, env) {
  const src = `src="${esc(thumb(url))}"`;
  if (!env || !flagOn(env.T600_READY) || !SB_SIZE_RE.test(url || '')) return src;
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

// the public sections

/* One entry per public destination that is a panel in the app rather than a
   document of its own. The panels are unchanged — js/routes.js opens the same
   ones the buttons always opened — but each now has a url, and a url with the
   home page's title, description and canonical on it is a url Google reads as
   the home page. This table is what makes each one its own page.

   Keep it in step with the ROUTES table in js/routes.js, the fallbacks in
   _redirects and the cache rules in _headers: a path in one list and not the
   others is either a 404 or a page wearing the wrong name. */
const SECTIONS = {
  '/explore': {
    crumb: 'Explore',
    title: 'Explore Digital Art — DigiArtz',
    desc: 'Browse digital artwork from the DigiArtz community — character illustration, ' +
          'fan art, concept art, landscapes, vehicles and original work from artists worldwide.',
    ld: 'CollectionPage'
  },
  '/marketplace': {
    crumb: 'Marketplace',
    title: 'Marketplace — Buy and Sell Digital Art on DigiArtz',
    desc: 'Buy and sell digital art and creative assets on DigiArtz: artwork, prints, ' +
          'brushes, templates, UI kits, 3D models and commissions from independent artists.',
    ld: 'CollectionPage'
  },
  '/community': {
    crumb: 'Community',
    title: 'Community — DigiArtz',
    desc: 'Join the DigiArtz community. Talk with other digital artists, share work in ' +
          'progress, swap feedback and find people to collaborate with.',
    ld: 'CollectionPage'
  },
  '/resources': {
    crumb: 'Resources',
    title: 'Resources for Digital Artists — DigiArtz',
    desc: 'Resources for digital artists on DigiArtz: brushes, textures, fonts, references, ' +
          'colour palettes, mockups, templates and tutorials shared by the community.',
    ld: 'CollectionPage'
  },
  '/blog': {
    crumb: 'Blog',
    title: 'Blog — Tutorials and Artist Stories — DigiArtz',
    desc: 'Tutorials, artist spotlights, interviews, reviews and news from the DigiArtz ' +
          'digital art community.',
    ld: 'CollectionPage'
  },
  // Jobs is deliberately not here. The section is in the app and is not going
  // anywhere — it is a chip in the gallery and a quick link on the home page —
  // it is simply not one of the destinations this site is putting forward to
  // search. So there is no /jobs url, no entry in the sitemap and no link in
  // the footer. Individual postings keep their own /job/<id> address, because
  // those links are shared and have to answer as themselves rather than as the
  // home page.
  '/login': {
    // One word, and it leads. The sitelink label a search engine prints for a
    // page is drawn from its title and from the words the site links to it
    // with, so all three say the same thing: the anchor in the footer, the
    // accessible name on the nav control, and this.
    crumb: 'Login',
    title: 'Login — DigiArtz',
    desc: 'Sign in to your DigiArtz account to upload artwork, sell in the marketplace, ' +
          'join communities and follow other artists.',
    // A sign-in form is a page, not a collection, and it is the one entry here
    // with nothing behind it to collect.
    ld: 'WebPage'
  }
};

// route resolution

const PROFILE_RE = /^\/profile\/([^/]+)\/?$/;
const ARTWORK_RE = /^\/artwork\/([^/]+)\/?$/;
const ITEM_RE    = /^\/(resource|blog|listing|job)\/([^/]+)\/?$/;

/* The four section item types, by the url segment each one is published under.
   `parent` is the section index the item belongs beneath, which is what makes
   /marketplace → /listing/<id> a hierarchy rather than two unrelated pages.

   `select` asks for the columns the anon key is granted and no more. Several
   of these tables revoke a column from anon at the grant level — a marketplace
   listing's price and file url among them — and asking for one of those fails
   the whole query rather than returning null, so this list is deliberately
   short: it is what a search result needs and nothing else.

   `eq` is the same visibility filter the app's own lists use. An item that
   does not match is not deleted — a hidden listing stays reachable by its own
   link, which is the point of hiding rather than unpublishing — it is simply
   not something to put in an index, so it comes back unresolved and the page
   is marked noindex below. */
const ITEMS = {
  resource: {
    table: 'resources', parent: '/resources', crumb: 'Resources', vis: 'visibility=eq.published&status=eq.approved',
    select: 'id,title,summary,preview_url,created_at', ld: 'CreativeWork'
  },
  blog: {
    table: 'blog_posts', parent: '/blog', crumb: 'Blog',
    vis: 'visibility=eq.published&status=eq.approved',
    select: 'id,title,excerpt,cover_url,seo_title,seo_description,published_at,created_at',
    ld: 'BlogPosting'
  },
  listing: {
    table: 'marketplace_items', parent: '/marketplace', crumb: 'Marketplace',
    vis: 'visibility=eq.published&status=eq.approved',
    select: 'id,title,summary,preview_url,seo_title,seo_description,created_at',
    ld: 'CreativeWork'
  },
  job: {
    // No `parent`, alone among these four: there is no /jobs index to sit
    // under, so a posting's trail is Home → the posting. A breadcrumb pointing
    // at a url that does not resolve is worse than a short breadcrumb.
    table: 'jobs', crumb: 'Jobs',
    vis: 'visibility=eq.public&status=eq.approved',
    select: 'id,title,company,description,created_at',
    // Deliberately not JobPosting. That type is worth having and is worth
    // having correctly — datePosted, validThrough, hiringOrganization,
    // jobLocation and employmentType all carry policy — and a half-filled one
    // is worse than none. WebPage is the honest description of what this is
    // until the full set is mapped.
    ld: 'WebPage'
  }
};

// safe username charset
const SAFE_NAME = /^[\p{L}\p{N}._-]{1,40}$/u;
// '_' and '%' are wildcards to SQL LIKE; a username is not a pattern.
const likeEscape = (s) => String(s).replace(/[\\%_]/g, '\\$&');
// the row that answered has to be the member who was asked for
const sameName = (a, b) =>
  String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// resolve a path
async function resolve(env, pathname) {
  // The section indexes are static text — no row to look up, so no round trip
  // to discover that.
  const sec = SECTIONS[pathname.replace(/(.)\/$/, '$1')];
  if (sec) return { type: 'section', status: 'found', sec, path: pathname.replace(/(.)\/$/, '$1') };

  const im = pathname.match(ITEM_RE);
  if (im) {
    const cfg = ITEMS[im[1]];
    if (!cfg) return { type: 'other', status: 'found' };
    if (!env || !env.SB_URL || !env.SB_KEY) return { type: 'item', status: 'unknown', cfg };
    let raw;
    try { raw = decodeURIComponent(im[2]); } catch { return { type: 'other', status: 'found' }; }
    // Every one of these tables keys on a uuid, so anything else is not an id
    // that could exist — and handing it to PostgREST is a 400 rather than an
    // empty result. It is also the whole of the injection guard on the query
    // below: nothing but a uuid ever reaches it.
    if (!UUID_RE.test(raw)) return { type: 'item', status: 'gone', cfg, seg: im[1] };
    try {
      const rows = await sbGet(env,
        `${cfg.table}?select=${cfg.select}&id=eq.${raw}&${cfg.vis}&limit=1`,
        ROW_CACHE_SECONDS);
      // Not published, or not there at all. This one is deliberately NOT a
      // 404: a hidden listing is reachable by its own link on purpose, and
      // that link has been shared. The page is served, kept out of the index,
      // and left carrying its own address rather than the home page's.
      if (!rows.length) return { type: 'item', status: 'unlisted', cfg, seg: im[1], id: raw };
      return { type: 'item', status: 'found', cfg, seg: im[1], row: rows[0] };
    } catch { return { type: 'item', status: 'unknown', cfg }; }
  }

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
      // Case-insensitive lookup, and the pattern is escaped on the way in.
      // ILIKE reads '_' as "any single character" and SAFE_NAME admits '_' in
      // a username — so /profile/a_b matched a member called axb, and with
      // limit=1 and no order an arbitrary one of them won. The page then went
      // out with somebody else's name, bio, avatar and canonical url on it.
      // ('%' is already refused by the charset; both are escaped anyway, with
      // the backslash Postgres takes as LIKE's default escape character.)
      const rows = await sbGet(env,
        'profiles?select=id,username,display_name,bio,avatar_url,banner_url' +
        `&username=ilike.${encodeURIComponent(likeEscape(raw))}&limit=1`,
        ROW_CACHE_SECONDS);
      if (!rows.length) return { type, status: 'gone' };
      // The escape above is the fix; this is the proof. Whatever the pattern
      // did, the row that came back has to be the member who was asked for.
      if (!sameName(rows[0].username, raw)) return { type, status: 'gone' };
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

// A trail back up to the home page, on every page that has one. It is the
// cheapest way to tell a crawler that /listing/<id> sits under /marketplace
// which sits under /, and it is the same trail the app's own back button walks.
function crumbs(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', url: `${SITE}/` }, ...trail].map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: c.url
    }))
  };
}

function sectionMeta(path, sec) {
  const url = `${SITE}${path}`;
  return {
    title: sec.title,
    desc: sec.desc,
    url,
    // The section indexes have no single image of their own — the grid behind
    // them changes by the hour — so the site card stands, which is what the
    // document already carries.
    img: '',
    imgAlt: `${sec.crumb} on DigiArtz`,
    ogType: 'website',
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': sec.ld,
        name: sec.title,
        description: sec.desc,
        url,
        isPartOf: { '@type': 'WebSite', name: 'DigiArtz', url: `${SITE}/` }
      },
      crumbs([{ name: sec.crumb, url }])
    ],
    ldId: 'ldSection'
  };
}

function itemMeta(seg, cfg, row) {
  const url = `${SITE}/${seg}/${row.id}`;
  const name = row.seo_title || row.title || 'Untitled';
  const body = row.seo_description || row.summary || row.excerpt || row.description || '';
  const img = ogImage(row.preview_url || row.cover_url || '') || '';
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const desc = clamp(body || `${name} — ${cfg.crumb.toLowerCase()} on DigiArtz.`);
  // The company is part of what a job posting IS, so it belongs in the title
  // where a searcher reads it rather than only in the body.
  const title = seg === 'job' && row.company
    ? `${name} at ${row.company} — DigiArtz`
    : `${name} — DigiArtz`;

  return {
    title,
    desc,
    url,
    img,
    imgAlt: name,
    ogType: seg === 'blog' ? 'article' : 'website',
    ld: [
      {
        '@context': 'https://schema.org',
        '@type': cfg.ld,
        ...(cfg.ld === 'BlogPosting' ? { headline: name } : { name }),
        description: desc,
        url,
        ...(date ? { datePublished: date } : {}),
        ...(img ? { image: img } : {}),
        isPartOf: { '@type': 'WebSite', name: 'DigiArtz', url: `${SITE}/` }
      },
      // The section index, where there is one to point at. A job posting has
      // none, so its trail is Home → the posting.
      crumbs(cfg.parent
        ? [{ name: cfg.crumb, url: `${SITE}${cfg.parent}` }, { name, url }]
        : [{ name, url }])
    ],
    ldId: 'ldItem'
  };
}

// An item that is real enough for the app to open and not public enough to
// index: a hidden listing, an unpublished draft, a posting that has been taken
// down. It keeps its own canonical — pointing it at the home page would be a
// lie about what is here — and is told plainly not to be indexed.
function unlistedMeta(seg, cfg, id) {
  const url = `${SITE}/${seg}/${id}`;
  return {
    title: `${cfg.crumb} — DigiArtz`,
    desc: `${cfg.crumb} on DigiArtz.`,
    url,
    img: '',
    imgAlt: 'DigiArtz',
    ogType: 'website',
    robots: 'noindex, follow',
    ld: cfg.parent
      ? crumbs([{ name: cfg.crumb, url: `${SITE}${cfg.parent}` }])
      : crumbs([]),
    ldId: 'ldItem'
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

  // Only when the page asks for one. The document's own directive is
  // "index, follow, max-image-preview:large" and that is the right answer for
  // everything here except an item that is not published.
  if (m.robots) set('meta[name="robots"]', m.robots);

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

  // The legal pages arrive complete — their own title, description and
  // canonical, and none of the elements this rewriter fills in. Everything
  // below would be a Supabase round trip per view to discover it has nothing
  // to change.
  if (pathname.startsWith('/legal/')) return origin;

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
             : hit.type === 'section' ? sectionMeta(hit.path, hit.sec)
             : hit.status === 'found' && hit.type === 'item' ? itemMeta(hit.seg, hit.cfg, hit.row)
             : hit.status === 'unlisted' ? unlistedMeta(hit.seg, hit.cfg, hit.id)
             : null;

  if (!arts.length && !meta) return origin;   // nothing to say, pass through

  // The home page's gallery is the home page's. It is described once, at '/',
  // and nowhere else: the same ImageGallery block repeated on /marketplace and
  // on every artwork page said each of those urls WAS that gallery, at the url
  // of a different page. The cards below still go into every route — they are
  // real links to real artworks and are how a crawler walks off any page into
  // the collection — but the claim about what the page is stays at home.
  const home = pathname === '/' || pathname === '/index.html';

  let rw = new HTMLRewriter();

  // Elsewhere the block baked into index.html is the same claim, so it goes.
  if (!home) rw = rw.on('script#ldGallery', { element(el) { el.remove(); } });

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

    rw = rw.on('div#awGrid', {
      element(el) { el.setInnerContent(cards, { html: true }); }
    });
    // overwrite, never append
    if (home) {
      rw = rw.on('script#ldGallery', {
        element(el) { el.setInnerContent(galleryLd, { html: true }); }
      });
    }
  }

  if (meta) rw = applyMeta(rw, meta);

  return rw.transform(origin);
}
