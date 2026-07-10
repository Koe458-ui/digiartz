const DIT = 'https://d1l8dn7jegdgem.cloudfront.net';
const CACHE_SECONDS = 300; // Supabase feed cached at the edge for 5 min

function thumb(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.supabase.co') || u.hostname === new URL(DIT).hostname) return url;
    return `${DIT}/fit-in/300x0/filters:format(webp):quality(55)/${u.pathname.replace(/^\/+/, '')}`;
  } catch { return url; }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function fetchArtworks(env) {
  const url = `${env.SB_URL}/rest/v1/artworks` +
    `?select=id,name,image_url,created_at&status=eq.approved&kind=eq.art` +
    `&order=created_at.desc&limit=60`;
  const res = await fetch(url, {
    headers: { apikey: env.SB_KEY, authorization: `Bearer ${env.SB_KEY}` },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
  });
  if (!res.ok) return [];
  return res.json();
}

export default {
  async fetch(request, env) {
    const origin = await fetch(request); // Pages serves the file
    const ct = origin.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return origin;

    let arts = [];
    try { arts = await fetchArtworks(env); } catch { return origin; }
    if (!arts.length) return origin;

    const cards = arts.map((a) =>
      `<a class="awCard" href="/artwork/${esc(a.id)}"><div class="awImgWrap">` +
      `<img loading="lazy" decoding="async" src="${esc(thumb(a.image_url))}" ` +
      `alt="${esc(a.name)} — digital artwork on DigiArtz"></div></a>`
    ).join('');

    const ld = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ImageGallery',
      name: 'DigiArtz — Digital Art Gallery', url: 'https://digiartz.net/',
      hasPart: arts.map((a, i) => ({
        '@type': 'ImageObject', position: i + 1, name: a.name,
        contentUrl: a.image_url, thumbnailUrl: thumb(a.image_url),
        url: `https://digiartz.net/artwork/${a.id}`,
        datePublished: (a.created_at || '').slice(0, 10)
      }))
    }).replace(/<\//g, '<\\/');

    return new HTMLRewriter()
      .on('div#awGrid', {
        element(el) { el.setInnerContent(cards, { html: true }); }
      })
      .on('head', {
        element(el) {
          el.append(`<script type="application/ld+json">${ld}</script>`, { html: true });
        }
      })
      .transform(origin);
  }
};
