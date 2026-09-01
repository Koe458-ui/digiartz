/* One PayPal client for the three endpoints that talk to them: checkout
   (api/paypal.js), payouts (api/payouts.js) and the webhook. Each used to
   carry its own copy of the base URL, the token cache and the fetch wrapper. */

export const apiBase = (env) =>
  String(env.PAYPAL_ENV || '').trim().toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

let tokenCache = null;

export async function ppToken(env) {
  const key = apiBase(env) + '|' + env.PAYPAL_CLIENT_ID;
  if (tokenCache && tokenCache.key === key && tokenCache.expires > Date.now())
    return tokenCache.token;

  const res = await fetch(apiBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token)
    throw new Error('Payment provider rejected our credentials');

  tokenCache = {
    key,
    token: body.access_token,
    expires: Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000,
  };
  return tokenCache.token;
}

/* `label` names the provider in the fallback message, so a failed payout reads
   as a payout problem rather than a payment one. `err.issue` is what callers
   branch on — ORDER_ALREADY_CAPTURED is not a failure to either of them. */
export async function pp(env, path, init = {}, label = 'Payment') {
  const res = await fetch(apiBase(env) + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + (await ppToken(env)),
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      body.message ||
      (body.details && body.details[0] && body.details[0].description) ||
      label + ' provider error (' + res.status + ')'
    );
    err.issue = (body.details && body.details[0] && body.details[0].issue) || body.name || '';
    throw err;
  }
  return body;
}
