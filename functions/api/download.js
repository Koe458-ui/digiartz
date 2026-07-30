// artwork download gate
// the only endpoint that hands out artwork bytes. it charges the caller's daily
// quota through dz_request_download before a single byte moves, then streams the
// file back from our own origin as an attachment, so the raw CDN url never has
// to reach the browser and the file cannot be pulled without a signed-in session.
//
// POST /api/download  { artwork: "<uuid>" }   Authorization: Bearer <supabase jwt>
//   200 -> the file, Content-Disposition: attachment
//   401 -> not signed in
//   404 -> artwork not visible to this user
//   429 -> daily quota spent, body carries { reason:'limit', limit, tier, resets_at }
// env: SB_URL, SB_KEY (falls back to SUPABASE_URL / SUPABASE_ANON_KEY), DIT_HOST

const SB_URL_FALLBACK  = 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
const SB_ANON_FALLBACK = 'sb_publishable_x7xlsCx-ZsvpNLCXRxyvMw_PsJQT2xy';
const DIT_FALLBACK     = 'https://d1l8dn7jegdgem.cloudfront.net';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// free tiers get a 1600px copy, paid tiers get the original
const PREVIEW_WIDTH   = 1600;
const PREVIEW_QUALITY = 82;

export async function onRequestPost(context) {
  const { request, env } = context;
  const SB_URL  = env.SB_URL  || env.SUPABASE_URL      || SB_URL_FALLBACK;
  const SB_KEY  = env.SB_KEY  || env.SUPABASE_ANON_KEY || SB_ANON_FALLBACK;
  const DIT     = env.DIT_HOST || DIT_FALLBACK;

  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ reason: 'auth', error: 'Sign in to download.' }, 401);

    let body;
    try { body = await request.json(); } catch { body = null; }
    const artwork = body && String(body.artwork || '');
    if (!artwork || !UUID_RE.test(artwork)) {
      return json({ error: 'Bad request.' }, 400);
    }

    // the jwt has to be real before it can spend quota
    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);
    const user = await userRes.json();
    if (!user || !user.id) return json({ reason: 'auth', error: 'Invalid session.' }, 401);

    // charge the daily quota. the rpc runs as the caller, so it counts against
    // their own tier and refuses once the cap for today is spent
    const gateRes = await fetch(`${SB_URL}/rest/v1/rpc/dz_request_download`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_artwork: artwork })
    });
    if (!gateRes.ok) return json({ error: 'Could not check your download quota.' }, 502);
    const gate = await gateRes.json();

    if (!gate || !gate.allowed) {
      const reason = (gate && gate.reason) || 'denied';
      if (reason === 'limit') {
        return json({
          reason: 'limit',
          tier: gate.tier, limit: gate.limit, used: gate.used,
          remaining: 0, resets_at: gate.resets_at,
          error: 'Daily download quota reached.'
        }, 429);
      }
      if (reason === 'auth')      return json({ reason, error: 'Sign in to download.' }, 401);
      if (reason === 'not_found') return json({ reason, error: 'Artwork not found.' }, 404);
      return json({ reason, error: 'Download not allowed.' }, 403);
    }

    // the source url comes from the row, never from the request, so this cannot
    // be driven as an open proxy
    const rowRes = await fetch(
      `${SB_URL}/rest/v1/artworks?select=name,image_url&id=eq.${artwork}&limit=1`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }
    );
    if (!rowRes.ok) return json({ error: 'Could not load the artwork.' }, 502);
    const rows = await rowRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.image_url) return json({ reason: 'not_found', error: 'Artwork not found.' }, 404);

    const src = gate.full ? row.image_url
                          : resize(row.image_url, PREVIEW_WIDTH, PREVIEW_QUALITY, DIT);
    if (!allowedHost(src, DIT, SB_URL)) return json({ error: 'Artwork source is not downloadable.' }, 502);

    const fileRes = await fetch(src, { cf: { cacheEverything: true, cacheTtl: 3600 } });
    if (!fileRes.ok || !fileRes.body) return json({ error: 'The file could not be fetched.' }, 502);

    const type = fileRes.headers.get('content-type') || 'application/octet-stream';
    const headers = new Headers({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${asciiName(row.name, src, type)}"; ` +
                             `filename*=UTF-8''${encodeURIComponent(niceName(row.name, src, type))}`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Dz-Remaining': String(gate.remaining ?? ''),
      'X-Dz-Limit': String(gate.limit ?? ''),
      'X-Dz-Tier': String(gate.tier || ''),
      'Access-Control-Expose-Headers': 'X-Dz-Remaining, X-Dz-Limit, X-Dz-Tier'
    });
    // no Content-Length passthrough: the runtime may re-encode the stream, and
    // a stale length would truncate the file
    return new Response(fileRes.body, { status: 200, headers });

  } catch (err) {
    return json({ error: 'Download failed — try again.', detail: String(err).slice(0, 200) }, 500);
  }
}

// mirrors imgresize in js/app-core.js
function resize(url, width, quality, dit) {
  if (!url || typeof url !== 'string') return url;
  let u, ditHost;
  try { u = new URL(url); ditHost = new URL(dit).hostname; } catch { return url; }
  if (u.hostname === ditHost) return url;
  if (u.hostname.endsWith('.supabase.co')) return url;
  const key = u.pathname.replace(/^\/+/, '');
  if (!key) return url;
  return `${dit.replace(/\/$/, '')}/fit-in/${width}x0/filters:format(webp):quality(${quality})/${key}`;
}

// only our own media hosts may be fetched
function allowedHost(url, dit, sbUrl) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  try { if (u.hostname === new URL(dit).hostname) return true; } catch { /* keep checking */ }
  try { if (u.hostname === new URL(sbUrl).hostname) return true; } catch { /* keep checking */ }
  return u.hostname.endsWith('.cloudfront.net') || u.hostname.endsWith('.supabase.co');
}

function extFor(src, type) {
  if (/webp/i.test(type)) return 'webp';
  const m = /\.([a-z0-9]{2,4})$/i.exec(safePath(src));
  if (m) return m[1].toLowerCase();
  const t = /image\/([a-z0-9]+)/i.exec(type || '');
  return t ? t[1].toLowerCase() : 'jpg';
}
function safePath(src) {
  try { return new URL(src).pathname; } catch { return ''; }
}
function niceName(name, src, type) {
  const base = String(name || 'artwork').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60);
  return `${base || 'artwork'}.${extFor(src, type)}`;
}
// header-safe fallback for clients that ignore filename*
function asciiName(name, src, type) {
  return niceName(name, src, type).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
