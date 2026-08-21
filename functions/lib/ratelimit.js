// One rate limiter, in front of every Function
//
// Six of the sixteen endpoints under functions/api carried a limiter of their
// own. The other ten did not, and the ten included /api/ops, /api/store,
// /api/moderate-upload and both webhooks. Each of those was an oversight of
// the same kind: a limiter written per endpoint is a limiter somebody has to
// remember to write, and the endpoint added on a busy day does not get one.
//
// So this one sits in the middleware instead, ahead of the router, and every
// request under /api/ passes through it whether its handler knows about it or
// not. The per-endpoint limiters stay where they are — they are tighter and
// they understand their own costs, and this is the floor beneath them, not a
// replacement.
//
// It counts in the same rate_hits table the database limiters use, through the
// dz_rate_take RPC that functions/api/download.js already calls. One place
// where a bucket lives, one sweep keeping it small.
//
// FAILS OPEN, like every other limiter in this codebase: no service key bound,
// a network blip, or a limiter that errors must never take the site down. The
// controls that fail CLOSED are the ones inside the database, where the
// damage would be.

const SB_URL_FALLBACK = 'https://tmqzqlrpjpydiftlrzmj.supabase.co';

// Per-minute ceilings by path prefix, longest match wins.
//
// The numbers are set so that a member clicking as fast as a person can click
// never meets them, and a script meets them in the first second. Money and
// moderation are tighter than reads because each call there costs a round trip
// to a payment provider or a model.
const LIMITS = [
  ['/api/rzp',               20],
  ['/api/paypal',            20],
  ['/api/payouts',           20],
  ['/api/subscription',      20],
  ['/api/collab',            30],
  ['/api/admin',             30],
  ['/api/moderation',        30],
  ['/api/moderate-upload',   20],
  ['/api/ops',               30],
  ['/api/store',             60],
  ['/api/download',         120],
  ['/api/market-download',  120],
  ['/api/resource-download',120],
  ['/api/',                  90]   // the floor for anything not named above
];

// Webhooks are called by Razorpay and PayPal, not by a browser, and their
// volume is theirs to decide. Limiting them means dropping a payment
// notification, which costs a buyer their purchase. Both verify a signature
// before they act, which is the control that belongs on them.
const NO_LIMIT = ['/api/rzp-webhook', '/api/paypal-webhook'];

export function limitFor(pathname) {
  for (const skip of NO_LIMIT) if (pathname.startsWith(skip)) return null;
  let best = null;
  for (const [prefix, n] of LIMITS) {
    if (!pathname.startsWith(prefix)) continue;
    if (!best || prefix.length > best[0].length) best = [prefix, n];
  }
  return best ? { bucket: best[0], limit: best[1] } : null;
}

// Who to count against. A signed-in caller is counted by their token so that
// one member on a shared address cannot spend everyone else's budget; anyone
// else is counted by IP.
//
// The token is HASHED before it becomes a bucket name, because bucket names
// are stored in rate_hits as plain text and a session token in a table is a
// session token that can be stolen from that table. Only the first 16 hex
// characters are kept — enough to separate callers, useless to anyone reading
// it back.
async function actorKey(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token && token.length > 20) {
    try {
      const digest = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(token));
      const hex = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      return 'u:' + hex.slice(0, 16);
    } catch { /* fall through to the address */ }
  }
  const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Real-IP')
          || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
  return ip ? 'ip:' + ip.slice(0, 64) : 'anon';
}

// true  = under the limit, let it through
// false = over the limit, refuse
export async function underEdgeLimit(env, request, pathname) {
  const rule = limitFor(pathname);
  if (!rule) return true;

  const key = env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return true;                       // not configured: fail open

  const base = String(env.SB_URL || env.SUPABASE_URL || SB_URL_FALLBACK)
    .replace(/\/$/, '');

  try {
    const actor = await actorKey(request);
    const res = await fetch(base + '/rest/v1/rpc/dz_rate_take', {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: 'Bearer ' + key,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        p_bucket: 'edge:' + rule.bucket + ':' + actor,
        p_limit: rule.limit,
        p_seconds: 60
      })
    });
    if (!res.ok) return true;                  // limiter unhappy: fail open
    return (await res.json()) !== false;
  } catch {
    return true;                               // network blip: fail open
  }
}

export function tooManyRequests() {
  return new Response(
    JSON.stringify({ error: 'Too many requests — slow down and try again.' }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '60',
        'x-content-type-options': 'nosniff'
      }
    }
  );
}
