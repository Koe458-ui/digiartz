export async function onRequestGet(context) {
  const { env } = context;

  // accept either env name
  const SUPABASE_URL = env.SB_URL || env.SUPABASE_URL || 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
  const SUPABASE_ANON_KEY = env.SB_KEY || env.SUPABASE_ANON_KEY || '';
  const SITE_URL = 'https://digiartz.net';

  // usernames never sent to google
  const BLOCKED = ['madarchod', 'bhenchod', 'chutiya', 'lund', 'randi'];
  const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };
  const isBlocked = (u) => {
    // leetspeak first, then separators
    const flat = String(u || '')
      .toLowerCase()
      .replace(/[4@31!05$7]/g, (c) => LEET[c])
      .replace(/[^a-z]/g, '');
    return BLOCKED.some((bad) => flat.includes(bad));
  };

  // skip placeholder handles
  const isPlaceholder = (u) => /^user_[0-9a-f]{8}$/i.test(String(u || ''));

  // xml escape
  const xesc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
    );

  // Google is pointed at the public derivative, never at the stored original:
  // koe-originals is private, and an <image:loc> that 403s would drop these out
  // of image search. Stored urls already point at __f1600, the largest public
  // derivative and exactly what a crawler should index, so they are indexed
  // as-is. Anything that is not a Supabase Storage url is skipped rather than
  // guessed at — there is no resizer left to route it through.
  const crawlImage = (url) => {
    if (!url || typeof url !== 'string') return '';
    let u;
    try { u = new URL(url); } catch { return ''; }
    return u.hostname.endsWith('.supabase.co') ? url : '';
  };

  const sbGet = async (path) => {
    if (!SUPABASE_ANON_KEY) return [];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    return res.ok ? res.json() : [];
  };

  /* The four section item types, published and approved only. Same filters
     the section panels use, plus the moderation gate: a draft, a hidden
     listing or an unreviewed post is reachable by its own link on purpose and
     is not something to hand to a crawler. functions/_middleware.js marks the
     same rows noindex when one is opened directly, so the two agree.

     Each type's url segment is what the app pushes when the item is open —
     /listing/<id> for a marketplace item, not /marketplace/<id> — so these are
     the addresses that exist. */
  const ITEM_FEEDS = [
    { seg: 'resource', q: 'resources?select=id,created_at&visibility=eq.published&status=eq.approved' },
    { seg: 'blog',     q: 'blog_posts?select=id,created_at&visibility=eq.published&status=eq.approved' },
    { seg: 'listing',  q: 'marketplace_items?select=id,created_at&visibility=eq.published&status=eq.approved' },
    { seg: 'job',      q: 'jobs?select=id,created_at&visibility=eq.public&status=eq.approved' },
  ];

  let artworks = [];
  let profiles = [];
  let itemSets = ITEM_FEEDS.map(() => []);
  try {
    // approved art only
    const all = await Promise.all([
      sbGet('artworks?select=id,name,image_url,created_at&status=eq.approved&kind=eq.art&order=created_at.desc&limit=5000'),
      sbGet('profiles?select=username&limit=5000'),
      ...ITEM_FEEDS.map((f) => sbGet(`${f.q}&order=created_at.desc&limit=5000`)),
    ]);
    artworks = all[0];
    profiles = all[1];
    itemSets = all.slice(2);
  } catch (e) {
    // still serve a partial sitemap
  }

  // read usernames live
  const usernames = profiles
    .map((p) => p && p.username)
    .filter((u) => u && !isBlocked(u) && !isPlaceholder(u))
    .sort();

  const artworkEntries = artworks
    .map((a) => {
      const lastmod = a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : '';
      // escape, do not delete
      const title = xesc(a.name);
      const imageUrl = xesc(crawlImage(a.image_url));

      return `  <url>
    <loc>${SITE_URL}/artwork/${xesc(a.id)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>${imageUrl ? `\n    <image:image>\n      <image:loc>${imageUrl}</image:loc>${title ? `\n      <image:title>${title}</image:title>` : ''}\n    </image:image>` : ''}
  </url>`;
    })
    .join('\n');

  const profileEntries = usernames
    .map(
      (username) => `  <url>
    <loc>${SITE_URL}/profile/${encodeURIComponent(username)}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`
    )
    .join('\n');

  /* The public sections, listed first and weighted above everything below
     them because they are what the site is organised into: Explore is the
     gallery, Marketplace is the shop, Community is the forum, and each one is
     the parent of a whole class of item urls further down this file.

     /login is here as well and deliberately so. It is a public page — a sign-in
     form anybody can open, not a page BEHIND sign-in — and it is one of the
     four destinations a visitor looks for by name. Nothing that requires a
     session is in this file: no cart, no dashboard, no upload manager, no
     admin, no settings.

     Kept in step with the SECTIONS table in functions/_middleware.js, the
     ROUTES table in js/routes.js and the fallbacks in _redirects. */
  const sectionEntries = [
    ['/explore', '0.9', 'daily'],
    ['/marketplace', '0.9', 'daily'],
    ['/community', '0.9', 'daily'],
    ['/resources', '0.8', 'weekly'],
    ['/blog', '0.8', 'weekly'],
    ['/jobs', '0.8', 'weekly'],
    ['/login', '0.3', 'yearly'],
  ]
    .map(
      ([path, priority, freq]) => `  <url>
    <loc>${SITE_URL}${path}</loc>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>`
    )
    .join('\n');

  const itemEntries = itemSets
    .map((rows, i) =>
      (Array.isArray(rows) ? rows : [])
        .map((r) => {
          const lastmod = r && r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '';
          return `  <url>
    <loc>${SITE_URL}/${ITEM_FEEDS[i].seg}/${xesc(r.id)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
        })
        .join('\n')
    )
    .filter(Boolean)
    .join('\n');

  // The standalone legal pages. Listed so they are crawlable and so anyone
  // auditing the site — a payment provider reviewing the domain, most of all —
  // can find them without being handed a link. The slugs are defined by
  // functions/legal/[doc].js; they are repeated rather than imported because
  // that route's filename carries brackets and is an awkward import specifier.
  // A slug that drifts out of step costs a 404 in a sitemap, nothing more.
  const legalEntries = [
    'privacy', 'terms', 'refund', 'delivery', 'creator-terms', 'cookies', 'contact',
  ]
    .map(
      (slug) => `  <url>
    <loc>${SITE_URL}/legal/${slug}</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${sectionEntries}
${legalEntries}
${itemEntries}
${artworkEntries}
${profileEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
    }
