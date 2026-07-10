export async function onRequestGet(context) {
  const { env } = context;

  const SUPABASE_URL = env.SUPABASE_URL || 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
  const SITE_URL = 'https://digiartz.net';

  const staticProfiles = [
    'albaze',
    'Koe_Official',
    'koexharsh',
    'Madarchod',
    'mitsuri',
    'user_9f8c7d5a',
    'user_d9ccd81d',
  ];

  let artworks = [];
  try {
    if (SUPABASE_ANON_KEY) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/artworks?select=id,name,image_url,created_at&order=created_at.desc`,
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
    // Fall through and still serve a partial sitemap.
  }

  const artworkEntries = artworks
    .map((a) => {
      const lastmod = a.created_at ? new Date(a.created_at).toISOString().slice(0, 10) : '';
      const title = (a.name || '').replace(/[<>&"]/g, '');
      const imageUrl = (a.image_url || '').replace(/[<>&"]/g, '');

      return `  <url>
    <loc>${SITE_URL}/artwork/${a.id}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>${imageUrl ? `\n    <image:image>\n      <image:loc>${imageUrl}</image:loc>${title ? `\n      <image:title>${title}</image:title>` : ''}\n    </image:image>` : ''}
  </url>`;
    })
    .join('\n');

  const profileEntries = staticProfiles
    .map(
      (username) => `  <url>
    <loc>${SITE_URL}/profile/${username}</loc>
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
