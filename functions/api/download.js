// artwork download gate
// the only endpoint that hands out artwork bytes. it charges the caller's daily
// quota through dz_request_download before a single byte moves, then streams the
// file back from our own origin as an attachment, so the raw CDN url never has
// to reach the browser and the file cannot be pulled without a signed-in session.
//
// POST /api/download  { artwork: "<uuid>" }   Authorization: Bearer <supabase jwt>
//   200 -> the file, Content-Disposition: attachment
//   401 -> not signed in
//   403 -> request did not come from our own pages
//   404 -> artwork not visible to this user
//   429 -> daily quota spent  { reason:'limit', limit, tier, resets_at }
//          or too many attempts { reason:'rate' }, Retry-After set
//
// checks run cheapest first, so an abusive request is refused before it can
// cost a Supabase roundtrip:
//   1. same-origin  (headers only)
//   2. json body    (headers only)
//   3. jwt shape and expiry, decoded locally, no network
//   4. burst limit + daily quota, one rpc
//   5. jwt signature verified
//   6. the file itself
//
// env: SB_URL, SB_KEY (falls back to SUPABASE_URL / SUPABASE_ANON_KEY),
//      DIT_HOST, ALLOWED_ORIGINS (comma separated extra hosts)

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
    // the button on our own page is the only caller. a cross-origin POST with
    // Content-Type: application/json already needs a preflight we never answer,
    // so this mainly turns away scripts and third-party embeds. spoofable with
    // a hand-set header — it is a speed bump on the cheapest possible path,
    // not an authentication step
    if (!sameOrigin(request, env)) {
      return json({ error: 'Downloads must come from the DigiArtz site.' }, 403);
    }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ reason: 'auth', error: 'Sign in to download.' }, 401);

    let body;
    try { body = await request.json(); } catch { body = null; }
    const artwork = body && String(body.artwork || '');
    if (!artwork || !UUID_RE.test(artwork)) {
      return json({ error: 'Bad request.' }, 400);
    }

    // reject junk and expired tokens without paying for a roundtrip. this reads
    // the payload without verifying the signature, which is fine here: it only
    // ever refuses, and step 5 does the real check before any bytes are served
    const claims = peekJwt(token);
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 <= Date.now())) {
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);
    }

    // charge the burst limit and the daily quota. the rpc runs as the caller,
    // so it counts against their own tier. the ip is a hint for the second
    // bucket, taken from Cloudflare rather than the request body
    const gateRes = await fetch(`${SB_URL}/rest/v1/rpc/dz_request_download`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_artwork: artwork,
        p_ip: request.headers.get('CF-Connecting-IP') || null
      })
    });
    // an unverifiable jwt fails here too, before anything is served
    if (gateRes.status === 401 || gateRes.status === 403) {
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);
    }
    if (!gateRes.ok) return json({ error: 'Could not check your download quota.' }, 502);
    const gate = await gateRes.json();

    if (!gate || !gate.allowed) {
      const reason = (gate && gate.reason) || 'denied';
      if (reason === 'rate') {
        return json({ reason: 'rate', error: 'Too many download requests — wait a moment.' },
                    429, { 'Retry-After': String(gate.retry_after || 60) });
      }
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

// the request has to have come from a page we serve.
// Sec-Fetch-Site is the primary signal: browsers set it themselves and page
// script cannot override it, so a fetch() from another site cannot claim
// same-origin. Origin and Referer are the fallback for anything that omits it.
function sameOrigin(request, env) {
  const h = request.headers;
  let host = '';
  try { host = new URL(request.url).host; } catch { return false; }

  const allowed = new Set([host]);
  for (const extra of String(env.ALLOWED_ORIGINS || '').split(',')) {
    const v = extra.trim();
    if (!v) continue;
    try { allowed.add(new URL(v.includes('://') ? v : 'https://' + v).host); }
    catch { allowed.add(v); }
  }

  const site = h.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';

  for (const name of ['Origin', 'Referer']) {
    const raw = h.get(name);
    if (!raw) continue;
    try { return allowed.has(new URL(raw).host); } catch { return false; }
  }
  // no browser signal at all — a scripted client
  return false;
}

// reads a jwt payload without verifying it. only ever used to refuse early;
// PostgREST does the real signature check on the calls that follow
function peekJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch { return null; }
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

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extra || {})
    }
  });
}
