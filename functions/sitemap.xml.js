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

  // Google is pointed at the resized derivative, never at the stored original.
  // The origin bucket is meant to stop being publicly readable, and an
  // <image:loc> that 403s would drop these out of image search. Mirrors
  // ogImage() in functions/_middleware.js.
  const DIT = (env.DIT_HOST || 'https://d1l8dn7jegdgem.cloudfront.net').replace(/\/$/, '');
  const crawlImage = (url) => {
    if (!url || typeof url !== 'string') return '';
    let u, ditHost;
    try { u = new URL(url); ditHost = new URL(DIT).hostname; } catch { return ''; }
    if (u.hostname === ditHost) return url;
    if (u.hostname.endsWith('.supabase.co')) return url;
    const key = u.pathname.replace(/^\/+/, '');
    if (!key) return '';
    return `${DIT}/fit-in/1200x0/filters:format(jpeg):quality(80)/${key}`;
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

  let artworks = [];
  let profiles = [];
  try {
    // approved art only
    [artworks, profiles] = await Promise.all([
      sbGet('artworks?select=id,name,image_url,created_at&status=eq.approved&kind=eq.art&order=created_at.desc&limit=5000'),
      sbGet('profiles?select=username&limit=5000'),
    ]);
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
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
