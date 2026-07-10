export async function onRequestGet(context) {
  const { env } = context;
  const SUPABASE_URL = env.SUPABASE_URL || 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
  const SITE_URL = 'https://digiartz.net';

  let artworks = [];
  try {
    if (SUPABASE_ANON_KEY) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/artworks?select=id,created_at&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      if (res.ok) {
        artworks = await res.json();
      }
    }
  } catch (e) {
    // Fall through and still serve a sitemap with just the homepage
    // rather than a hard 500 — a partial sitemap is better than none.
  }

  const urlEntries = artworks
    .map((a) => {
      const lastmod = a.created_at ? new Date(a.created_at).toISOString() : undefined;
      return `  <url>
    <loc>${SITE_URL}/artwork/${a.id}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${urlEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
