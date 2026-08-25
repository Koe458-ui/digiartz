// resource delivery
//
// The only route from a resource package to a downloader. It is the artwork
// gate's twin (functions/api/download.js) and the marketplace gate's cousin
// (functions/api/market-download.js), and it takes one thing from each: the
// daily quota from the first, because a resource is a perk of a plan and not a
// purchase, and the private-object streaming from the second, because a brush
// pack is the largest file on the site and a public url for it is a bandwidth
// bill anyone can run up.
//
// The point of this endpoint is that the cap counts bytes rather than clicks.
// A resource used to be a public storage url printed into the page: the button
// spent a unit of quota and the url beside it did not, so copying the link out
// of devtools was an unlimited download. The object is private now and the
// browser never receives a url of any kind — signed or otherwise. The signed
// GET is minted here, spent here, and dies with the response.
//
// POST /api/resource-download  { resource: "<uuid>" }
//   Authorization: Bearer <supabase jwt>
//   200 -> the file, Content-Disposition: attachment
//   400 -> malformed id
//   401 -> not signed in
//   403 -> request did not come from our own pages
//   404 -> the resource is gone, or not visible to this caller
//   429 -> daily quota spent { reason:'limit', limit, tier, resets_at }
//          or too many attempts { reason:'rate' }, Retry-After set
//
// The quota question is never answered here. dz_resource_file_grant runs in
// Postgres AS THE CALLER, so auth.uid() is the downloader and the check cannot
// be talked out of by anything the browser sends: a storage path only comes
// back after a unit has been taken from that caller's budget for the day. This
// file signs what it is handed and streams the bytes; it does not get a say.
//
// Checks run cheapest first, so an abusive request is refused before it can
// cost a Supabase roundtrip:
//   1. same-origin   (headers only)
//   2. json body     (headers only)
//   3. jwt shape and expiry, decoded locally, no network
//   4. quota + visibility + path, one call to Postgres
//   5. the signature, then the file itself
//
// env: SB_URL, SB_KEY (falls back to SUPABASE_URL / SUPABASE_ANON_KEY),
//      SB_SERVICE_KEY (falls back to SUPABASE_SERVICE_ROLE_KEY),
//      ALLOWED_ORIGINS (comma separated extra hosts)

import { sbUrl, sbAnon, sbSvc, peekJwt } from '../lib/sb.js';
import {
  UUID_RE, sameOrigin, allowedHost, encodePath, json,
  storedFileName, storedFileNameAscii
} from '../lib/http.js';

// long enough to fetch, short enough to be worthless if it ever escaped
const SIGN_TTL = 120;

export async function onRequestPost({ request, env }) {
  const SB_URL = sbUrl(env), SB_KEY = sbAnon(env), SB_SVC = sbSvc(env);

  try {
    if (!SB_URL || !SB_KEY) return json({ error: 'Downloads are not configured.' }, 503);

    // the button on our own page is the only caller
    if (!sameOrigin(request, env))
      return json({ error: 'Downloads must come from the DigiArtz site.' }, 403);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ reason: 'auth', error: 'Sign in to download.' }, 401);

    let body;
    try { body = await request.json(); } catch { body = null; }
    const resource = body && String(body.resource || '');
    if (!UUID_RE.test(resource)) return json({ error: 'Bad request.' }, 400);

    // refuse a stale token without paying for a roundtrip. the payload is read
    // unverified, which is safe because it only ever refuses — PostgREST checks
    // the signature for real on the call below
    const claims = peekJwt(token);
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 <= Date.now()))
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);

    // The gate. Runs as the downloader; spends a unit and returns a path.
    const grantRes = await fetch(SB_URL + '/rest/v1/rpc/dz_resource_file_grant', {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_resource: resource, p_ip: clientIp(request) }),
    });
    const grant = await grantRes.json().catch(() => null);

    if (!grantRes.ok) {
      if (grantRes.status === 401) return json({ reason: 'auth', error: 'Sign in to download.' }, 401);
      return json({ error: 'Could not check your download allowance.' }, 502);
    }

    const row = Array.isArray(grant) ? grant[0] : grant;
    if (!row || !row.allowed) {
      const why = row && row.reason;
      if (why === 'limit') {
        return json({ reason: 'limit', error: 'Daily download limit reached.',
                      limit: row.limit, tier: row.tier, resets_at: row.resets_at }, 429);
      }
      if (why === 'rate') {
        return json({ reason: 'rate', error: 'Too many downloads just now.' }, 429,
                     { 'Retry-After': String(row.retry_after || 60) });
      }
      if (why === 'auth') return json({ reason: 'auth', error: 'Sign in to download.' }, 401);
      return json({ reason: 'not_found', error: 'That resource is no longer available.' }, 404);
    }

    const bucket = String(row.bucket || '');
    const path   = String(row.path || '');
    const name   = String(row.filename || 'resource');

    let src = '';
    if (path && bucket && !path.startsWith('/') && !path.includes('..')) {
      if (!SB_SVC) return json({ error: 'Downloads are not configured.' }, 503);
      // Signed with the SERVICE ROLE deliberately: the object is private and no
      // storage policy would hand it to a downloader. It is only reached once
      // the grant above has already taken a unit of their budget.
      const sigRes = await fetch(
        SB_URL + '/storage/v1/object/sign/' + bucket + '/' + encodePath(path), {
          method: 'POST',
          headers: {
            apikey: SB_SVC,
            authorization: 'Bearer ' + SB_SVC,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: SIGN_TTL }),
        });
      const sig = await sigRes.json().catch(() => null);
      const signed = sig && (sig.signedURL || sig.signedUrl);
      if (!sigRes.ok || !signed) return json({ error: 'The file could not be prepared.' }, 502);
      src = signed.startsWith('http') ? signed : SB_URL + '/storage/v1' + signed;
    } else if (row.legacy_url) {
      // A resource published while the bucket was still public. It has an
      // object and no path of its own; it is served from behind this gate as
      // well, so every downloader's route is the same route and the same
      // counter, whichever side of the change the package was uploaded on.
      src = String(row.legacy_url);
    }

    if (!src || !allowedHost(src, SB_URL))
      return json({ reason: 'not_found', error: 'That resource is no longer available.' }, 404);

    const fileRes = await fetch(src);
    if (!fileRes.ok || !fileRes.body) return json({ error: 'The file could not be fetched.' }, 502);

    const headers = new Headers({
      'Content-Type': fileRes.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + storedFileNameAscii(name) + '"; ' +
                             "filename*=UTF-8''" + encodeURIComponent(storedFileName(name)),
      // a metered download is not a public asset and the signed source is
      // single use — a cached copy would be a second download nobody paid for
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    // what is left of today, so the page can say so without asking again
    if (typeof row.remaining === 'number') headers.set('X-Downloads-Left', String(row.remaining));
    const len = fileRes.headers.get('content-length');
    if (len) headers.set('Content-Length', len);

    return new Response(fileRes.body, { status: 200, headers });

  } catch (err) {
    return json({ error: 'Download failed — try again.', detail: String(err).slice(0, 200) }, 500);
  }
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ||
         String(request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() || '';
}
