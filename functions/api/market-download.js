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
    const item = body && String(body.item || '');
    const file = body && String(body.file || item || '');
    if (!UUID_RE.test(item) || !UUID_RE.test(file)) return json({ error: 'Bad request.' }, 400);

    const claims = peekJwt(token);
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 <= Date.now()))
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);

    const grantRes = await fetch(SB_URL + '/rest/v1/rpc/dz_market_file_grant', {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_item: item, p_file: file }),
    });
    const grant = await grantRes.json().catch(() => null);

    if (!grantRes.ok) {
      const msg = (grant && (grant.message || grant.error)) || '';
      if (/purchase required/i.test(msg))
        return json({ reason: 'unpaid', error: 'Buy this item to download it.' }, 402);
      if (grantRes.status === 401)
        return json({ reason: 'auth', error: 'Sign in to download.' }, 401);
      return json({ error: 'Could not check your purchase.' }, 502);
    }

    const row = Array.isArray(grant) ? grant[0] : grant;
    if (!row) return json({ reason: 'not_found', error: 'That file is no longer available.' }, 404);

    const bucket = String(row.bucket || '');
    const path = String(row.path || '');
    const name = String(row.filename || 'file');

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
      return json({ reason: 'not_found', error: 'That file is no longer available.' }, 404);

    const fileRes = await fetch(src);
    if (!fileRes.ok || !fileRes.body) return json({ error: 'The file could not be fetched.' }, 502);

    const type = row.mime || fileRes.headers.get('content-type') || 'application/octet-stream';
    return new Response(fileRes.body, {
      status: 200,
      headers: new Headers({
        'Content-Type': type,
        'Content-Disposition': 'attachment; filename="' + storedFileNameAscii(name) + '"; ' +
                               "filename*=UTF-8''" + encodeURIComponent(storedFileName(name)),
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      }),
    });

  } catch (err) {
    return json({ error: 'Download failed — try again.', detail: String(err).slice(0, 200) }, 500);
  }
}
