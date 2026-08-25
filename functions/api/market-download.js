// marketplace delivery
//
// The only route from a sold file to a buyer. It is the artwork gate's twin
// (functions/api/download.js) with one deliberate difference: nothing here
// consults a subscription tier or a daily quota. A marketplace file is not a
// perk of a plan — it was bought, once, and it stays bought. Max does not
// unlock it and Free does not lose it, so there is no tier to read and no
// counter to spend. Re-downloading the same purchase for the tenth time costs
// the buyer nothing.
//
// POST /api/market-download  { item: "<uuid>", file: "<uuid>" }
//   Authorization: Bearer <supabase jwt>
//   200 -> the file, Content-Disposition: attachment
//   400 -> malformed ids
//   401 -> not signed in
//   402 -> signed in, but this item has not been paid for
//   403 -> request did not come from our own pages
//   404 -> the listing, or that file of it, is gone
//
// The entitlement question is never answered here. dz_market_file_grant runs
// in Postgres AS THE CALLER, so auth.uid() is the buyer and the check cannot be
// talked out of by anything the browser sends: a storage path only comes back
// after a paid payment for that item, by that user, has been found. This file
// signs what it is handed and streams the bytes; it does not get a say.
//
// The browser never receives a url, signed or otherwise. The signed GET is
// minted here, spent here, and dies with the response — so a buyer cannot pass
// a link to someone who did not buy, and a listing's files cannot be pulled by
// walking ids.
//
// env: SB_URL, SB_KEY (falls back to SUPABASE_URL / SUPABASE_ANON_KEY),
//      SB_SERVICE_KEY (falls back to SUPABASE_SERVICE_ROLE_KEY),
//      ALLOWED_ORIGINS (comma separated extra hosts)

import { sbUrl, sbAnon, sbSvc, peekJwt } from '../lib/sb.js';
import { UUID_RE, sameOrigin, allowedHost, encodePath, json } from '../lib/http.js';

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
    const item = body && String(body.item || '');
    const file = body && String(body.file || item || '');
    if (!UUID_RE.test(item) || !UUID_RE.test(file)) return json({ error: 'Bad request.' }, 400);

    // refuse a stale token without paying for a roundtrip. the payload is read
    // unverified, which is safe because it only ever refuses — PostgREST checks
    // the signature for real on the call below
    const claims = peekJwt(token);
    if (!claims || !claims.sub || (claims.exp && claims.exp * 1000 <= Date.now()))
      return json({ reason: 'auth', error: 'Session expired — sign in again.' }, 401);

    // The gate. Runs as the buyer; returns a path only if they own the item.
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
      // the function raises this by name for anyone who has not paid
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
      // Signed with the SERVICE ROLE deliberately: the bytes belong to the
      // seller, and no storage policy would hand them to a buyer. It is only
      // reached once the grant above has already said yes.
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
      // A listing published before product files were kept private. It has a
      // public object and no path of its own; it is still served from behind
      // this gate so every buyer's experience is the same one.
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
        'Content-Disposition': 'attachment; filename="' + asciiName(name) + '"; ' +
                               "filename*=UTF-8''" + encodeURIComponent(niceName(name)),
        // a purchase is not a public asset and the signed source is single-use
        'Cache-Control': 'no-store, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      }),
    });

  } catch (err) {
    return json({ error: 'Download failed — try again.', detail: String(err).slice(0, 200) }, 500);
  }
}

function niceName(name) {
  const clean = String(name || 'file').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80);
  return clean || 'file';
}
function asciiName(name) {
  return niceName(name).replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
}
