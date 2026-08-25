// artwork download gate
// the only endpoint that hands out artwork bytes. it asks the smart-function
// edge function for a source url, which that function only mints after
// dz_request_download has granted a unit of the caller's daily quota, then
// streams the bytes back from our own origin as an attachment. the browser
// never receives a url of its own, so a file cannot be pulled without a
// signed-in session and cannot be pulled at all once the quota is spent.
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
//   4. per-IP burst limit on the real client address, one cheap rpc
//   5. daily quota + presign, one call to smart-function
//   6. the file itself
//
// env: SB_URL, SB_KEY (falls back to SUPABASE_URL / SUPABASE_ANON_KEY),
//      S3_FN_URL (defaults to SB_URL/functions/v1/smart-function),
//      SB_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) for the per-IP limiter,
//      ALLOWED_ORIGINS (comma separated extra hosts)

import { peekJwt } from '../lib/sb.js';
import { UUID_RE, sameOrigin, allowedHost, json } from '../lib/http.js';

const SB_URL_FALLBACK  = 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
const SB_ANON_FALLBACK = 'sb_publishable_x7xlsCx-ZsvpNLCXRxyvMw_PsJQT2xy';

// Free tiers get the public 1600px derivative, paid tiers get the original.
// Each size is its own Supabase Storage object, named by suffix, so choosing
// one is a suffix swap rather than a resize request.
const SB_SIZE_RE = /__(?:t300|t600|v1000|f1600)\.webp$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const SB_URL  = env.SB_URL  || env.SUPABASE_URL      || SB_URL_FALLBACK;
  const SB_KEY  = env.SB_KEY  || env.SUPABASE_ANON_KEY || SB_ANON_FALLBACK;
  const FN_URL  = env.S3_FN_URL || `${SB_URL.replace(/\/$/, '')}/functions/v1/smart-function`;

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
    // ever refuses, and smart-function verifies the token for real on the call
    // below, before anything is signed or served
    const claims = peekJwt(token);
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 <= Date.now())) {
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);
    }

    // the per-IP burst limit is settled here, not in the database. the ip below
    // is written by Cloudflare and page script cannot touch it, whereas the
    // p_ip that dz_request_download takes is an ordinary parameter that has
    // travelled through the browser — anything calling that rpc directly can
    // hand it a fresh string per request and never land in the same bucket
    // twice. the per-account limits it applies are the ones that hold there.
    if (!(await underIpLimit(env, request.headers.get('CF-Connecting-IP')))) {
      return json({ reason: 'rate', error: 'Too many download requests — wait a moment.' },
                  429, { 'Retry-After': '60' });
    }

    // one call does the per-account burst limit, the daily quota and the
    // presign — the per-IP half of the burst limit is already settled. it runs
    // as the caller, so the quota counts against their own tier, and it holds
    // the AWS credentials so nothing here has to. the ip is a hint for the
    // second limiter bucket, taken from Cloudflare rather than the request body
    const gateRes = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'download',
        artwork,
        ip: request.headers.get('CF-Connecting-IP') || null
      })
    });

    let out = {};
    try { out = await gateRes.json(); } catch { out = {}; }

    if (!gateRes.ok) {
      const reason = out.reason || 'denied';
      if (gateRes.status === 429 && reason === 'rate') {
        return json({ reason: 'rate', error: 'Too many download requests — wait a moment.' },
                    429, { 'Retry-After': String(out.retry_after || 60) });
      }
      if (gateRes.status === 429) {
        return json({
          reason: 'limit',
          tier: out.tier, limit: out.limit, used: out.used,
          remaining: 0, resets_at: out.resets_at,
          error: 'Daily download quota reached.'
        }, 429);
      }
      if (gateRes.status === 401) return json({ reason: 'auth', error: 'Sign in to download.' }, 401);
      if (gateRes.status === 404) return json({ reason: 'not_found', error: 'Artwork not found.' }, 404);
      if (gateRes.status === 403) return json({ reason, error: 'Download not allowed.' }, 403);
      return json({ error: 'Could not check your download quota.' }, 502);
    }

    const gate = out.gate || {};
    // paid tiers arrive as a presigned S3 GET; free tiers get the public
    // downscaled derivative, which the image CDN already serves for display
    const signed = typeof out.url === 'string' && out.url ? out.url : '';
    const src = signed || previewUrl(out.imageUrl);
    if (!src || !allowedHost(src, SB_URL)) {
      return json({ error: 'Artwork source is not downloadable.' }, 502);
    }

    // a presigned url is unique per request, so caching it would only ever miss
    const fileRes = signed
      ? await fetch(src)
      : await fetch(src, { cf: { cacheEverything: true, cacheTtl: 3600 } });
    if (!fileRes.ok || !fileRes.body) return json({ error: 'The file could not be fetched.' }, 502);

    const type = fileRes.headers.get('content-type') || 'application/octet-stream';
    const headers = new Headers({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${asciiName(out.name, src, type)}"; ` +
                             `filename*=UTF-8''${encodeURIComponent(niceName(out.name, src, type))}`,
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

// Counts one attempt against the caller's real address and reports whether they
// are still under the limit. Its own bucket, deliberately: dz_request_download
// keeps its dl:ip: bucket for the honest path, and sharing a name would make
// every download count twice and halve both limits.
//
// Fails OPEN, like every other limiter here — no service key bound, a network
// blip, or a limiter that errors must never stop a legitimate download. The
// account-level quota inside dz_request_download is the control that fails
// closed.
async function underIpLimit(env, ip) {
  const addr = String(ip || '').trim();
  if (!addr) return true;
  const key = env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return true;
  const base = String(env.SB_URL || env.SUPABASE_URL || SB_URL_FALLBACK).replace(/\/$/, '');
  try {
    const res = await fetch(base + '/rest/v1/rpc/dz_rate_take', {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        p_bucket: 'dl:edge:' + addr.slice(0, 64),
        p_limit: 60,
        p_seconds: 60
      })
    });
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch { return true; }
}

// mirrors imgResize in js/app-core.js: the largest public derivative
function previewUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return SB_SIZE_RE.test(url) ? url.replace(SB_SIZE_RE, '__f1600.webp') : url;
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
