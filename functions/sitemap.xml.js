// functions/sitemap.xml.js
//
// Cloudflare Pages Function — serves a live, always-up-to-date
// sitemap.xml at https://<your-domain>/sitemap.xml.
//
// Why this exists: index.html is a single static file with no
// server-side rendering, so a sitemap can't be "baked in" at build
// time without going stale every time an artwork is added or
// removed. This function queries Supabase directly (same public
// project the client already talks to) on every request and lists:
//   • the homepage
//   • one <url> per artwork, pointing at its dedicated
//     /artwork/{id} URL — the exact URLs the SEO update in
//     index.html (handleArtClick / openArtworkById) makes real and
//     navigable.
//
// SETUP:
//   1. Drop this file at: functions/sitemap.xml.js  (already in the
//      right place relative to your Cloudflare Pages project root —
//      i.e. alongside your index.html, NOT inside it).
//   2. In the Cloudflare Pages dashboard → your project → Settings →
//      Environment variables, add:
//        SUPABASE_URL  = https://tmqzqlrpjpydiftlrzmj.supabase.co
//        SUPABASE_ANON_KEY = <same publishable/anon key already in index.html>
//      (Using env vars here instead of hardcoding keeps this file
//      identical across environments and avoids a second place to
//      update the key if it's ever rotated.)
//   3. Deploy. /sitemap.xml will now be live and dynamic — no further
//      action needed when artworks are added, edited, or removed.

export async function onRequestGet(context) {
  const { env } = context;
  const SUPABASE_URL = env.SUPABASE_URL || 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
  const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
  const SITE_URL = 'https://digiartz.pages.dev';

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
