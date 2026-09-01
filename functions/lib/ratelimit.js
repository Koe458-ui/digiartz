import { underLimit } from './sb.js';

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
  ['/api/',                  90]
];

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
    } catch {   }
  }
  const ip = request.headers.get('CF-Connecting-IP')
          || request.headers.get('X-Real-IP')
          || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim();
  return ip ? 'ip:' + ip.slice(0, 64) : 'anon';
}

export async function underEdgeLimit(env, request, pathname) {
  const rule = limitFor(pathname);
  if (!rule) return true;

  const actor = await actorKey(request);
  return underLimit(env, 'edge:' + rule.bucket + ':' + actor, rule.limit, 60);
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
