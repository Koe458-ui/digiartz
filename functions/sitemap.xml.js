export async function onRequestGet(context) {
  const { env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
  const SITE_URL = 'https://digiartz.net';

  /* Usernames we never hand to Google, matched case-insensitively and
     ignoring separators, so `Madarchod`, `madar_chod` and `M4darchod`
     all fall out. Anything a crawler would surface as a site URL — a
     slur, a placeholder, an impersonation — belongs here. Add to the
     list; nothing else needs to change. */
  const BLOCKED = ['madarchod', 'bhenchod', 'chutiya', 'lund', 'randi'];
  const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't' };
  const isBlocked = (u) => {
    /* Order matters: substitute leetspeak FIRST, then strip separators.
       Stripping first would delete the '4' in M4darchod before it could
       ever be mapped back to an 'a'. */
    const flat = String(u || '')
      .toLowerCase()
      .replace(/[4@31!05$7]/g, (c) => LEET[c])
      .replace(/[^a-z]/g, '');
    return BLOCKED.some((bad) => flat.includes(bad));
  };

  /* Auto-generated placeholder handles (user_9f8c7d5a) are real accounts
     but have no content or SEO value — they just dilute the sitemap. */
  const isPlaceholder = (u) => /^user_[0-9a-f]{8}$/i.test(String(u || ''));

  /* XML-escape. A username or artwork title containing & or < would
     otherwise emit malformed XML and invalidate the whole sitemap. */
  const xesc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
    );

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
    /* Only approved art. The old query had no status filter, so anything
       sitting in the admin review queue — or already rejected — was being
       advertised to Google at /artwork/<id>. */
    [artworks, profiles] = await Promise.all([
      sbGet('artworks?select=id,name,image_url,created_at&status=eq.approved&kind=eq.art&order=created_at.desc&limit=5000'),
      sbGet('profiles?select=username&limit=5000'),
    ]);
  } catch (e) {
    // Fall through and still serve a partial sitemap.
  }

  /* Was a hardcoded array — it went stale the moment anyone signed up,
     and it's how the slur got submitted to Google in the first place. */
  const usernames = profiles
    .map((p) => p && p.username)
    .filter((u) => u && !isBlocked(u) && !isPlaceholder(u))
    .sort();

  const artworkEntries = artworks
    .map((a) => {
      const lastmod = a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : '';
      /* Was stripping & < > " outright, which silently mangled titles
         like "Rain & Steel" into "Rain  Steel". Escape, don't delete. */
      const title = xesc(a.name);
      const imageUrl = xesc(a.image_url);

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
