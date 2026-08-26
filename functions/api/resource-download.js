import { sbUrl, sbAnon, sbSvc, peekJwt } from '../lib/sb.js';
import {
  UUID_RE, sameOrigin, allowedHost, encodePath, json,
  storedFileName, storedFileNameAscii
} from '../lib/http.js';

const SIGN_TTL = 120;

export async function onRequestPost({ request, env }) {
  const SB_URL = sbUrl(env), SB_KEY = sbAnon(env), SB_SVC = sbSvc(env);

  try {
    if (!SB_URL || !SB_KEY) return json({ error: 'Downloads are not configured.' }, 503);

    if (!sameOrigin(request, env))
      return json({ error: 'Downloads must come from the DigiArtz site.' }, 403);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ reason: 'auth', error: 'Sign in to download.' }, 401);

    let body;
    try { body = await request.json(); } catch { body = null; }
    const resource = body && String(body.resource || '');
    if (!UUID_RE.test(resource)) return json({ error: 'Bad request.' }, 400);

    const claims = peekJwt(token);
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 <= Date.now()))
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);

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
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    });
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
