// razorpay checkout backend

// server side price list
const SUB_CURRENCY = 'USD';
const PLANS = {
  lite:    { amount: 100,  tier: 'lite',    label: 'Lite — 1 month'    },
  premium: { amount: 500,  tier: 'premium', label: 'Premium — 1 month' },
  max:     { amount: 1000, tier: 'max',     label: 'Max — 1 month'     },
  support: { amount: null, tier: null,      label: 'Support DigiArtz'  },
};
const SUPPORT_MIN = 50;        // fifty cents
const SUPPORT_MAX = 1000000;   // ten thousand dollars
const SUB_DAYS    = 31;

// smallest currency unit
const ZERO_DECIMAL = new Set(['JPY']);
const toRzpAmount = (cents, cur) =>
  ZERO_DECIMAL.has(cur) ? Math.round(cents / 100) : cents;

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

// razorpay rest
async function rzp(env, path, init = {}) {
  const res = await fetch('https://api.razorpay.com' + path, {
    ...init,
    headers: {
      authorization: 'Basic ' + btoa(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET),
      'content-type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.description) || 'Payment provider error (' + res.status + ')');
  return body;
}

// supabase caller and service role
async function sbUser(env, request) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const res = await fetch(env.SB_URL + '/auth/v1/user', {
    headers: { apikey: env.SB_KEY, authorization: bearer },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

async function sbService(env, path, init = {}) {
  const res = await fetch(env.SB_URL + '/rest/v1' + path, {
    ...init,
    headers: {
      apikey: env.SB_SERVICE_KEY,
      authorization: 'Bearer ' + env.SB_SERVICE_KEY,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error('Database error (' + res.status + ')');
  return body;
}

// signature check
async function validSignature(env, orderId, paymentId, signature) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.RAZORPAY_KEY_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(orderId + '|' + paymentId));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  const a = new TextEncoder().encode(hex);
  const b = new TextEncoder().encode(String(signature || ''));
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

// create order and ledger row
async function makeOrder(env, user, { amount, currency, kind, plan, itemId, label }) {
  const order = await rzp(env, '/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount, currency,
      receipt: 'dz_' + Date.now(),
      notes: { kind, plan: plan || '', item_id: itemId || '', user_id: user.id },
    }),
  });
  await sbService(env, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      user_id: user.id, kind, plan: plan || null, item_id: itemId || null,
      amount, currency, provider: 'razorpay',
      rzp_order_id: order.id, status: 'created',
    }),
  });
  return json({ orderId: order.id, keyId: env.RAZORPAY_KEY_ID, amount, currency, label });
}

// availability probe
//
// PayPal now sits beside this endpoint, and the browser asks both who can take
// money before it draws a chooser — a provider with no credentials bound is
// simply not offered.
//
// Signed in only, and it answers with a bare boolean. Whether this site takes
// Razorpay is not something an anonymous scraper gets told, and the key id is
// not handed out here at all — it comes back with an order, which is already
// behind the same sign-in, so nothing about payments is reachable in public.
export async function onRequestGet({ env, request }) {
  if (!(await sbUser(env, request))) return json({ error: 'Sign in required' }, 401);
  const ready = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET &&
                   env.SB_URL && env.SB_KEY && env.SB_SERVICE_KEY);
  return json({ enabled: ready });
}

// entry point
export async function onRequestPost({ env, request }) {
  for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'SB_SERVICE_KEY', 'SB_URL', 'SB_KEY'])
    if (!env[k]) return json({ error: 'Payment service not configured (' + k + ' missing)' }, 500);

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    // subscriptions
    if (body.action === 'sub-order') {
      const plan = PLANS[String(body.plan || '')];
      if (!plan) return json({ error: 'Unknown plan' }, 400);
      let amount = plan.amount;
      if (amount === null) {                       // support, any amount
        amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount < SUPPORT_MIN || amount > SUPPORT_MAX)
          return json({ error: 'Amount must be between $0.50 and $10,000' }, 400);
      }
      return await makeOrder(env, user, {
        amount, currency: SUB_CURRENCY, kind: 'subscription',
        plan: String(body.plan), label: plan.label,
      });
    }

    // marketplace
    if (body.action === 'market-order') {
      const itemId = String(body.itemId || '');
      if (!/^[0-9a-f-]{36}$/.test(itemId)) return json({ error: 'Bad item id' }, 400);

      const rows = await sbService(env,
        '/marketplace_items?id=eq.' + itemId +
        '&select=id,user_id,title,price_cents,currency,status&limit=1');
      const item = rows && rows[0];
      if (!item || item.status !== 'approved') return json({ error: 'Listing not found' }, 404);
      if (item.user_id === user.id) return json({ error: 'This is your own listing' }, 400);
      if (!(item.price_cents > 0)) return json({ error: 'This item is free — just download it' }, 400);

      // already bought, skip checkout
      const paid = await sbService(env,
        '/payments?item_id=eq.' + itemId + '&user_id=eq.' + user.id +
        '&status=eq.paid&select=id&limit=1');
      if (paid && paid.length) return json({ owned: true });

      return await makeOrder(env, user, {
        amount: toRzpAmount(item.price_cents, item.currency),
        currency: item.currency || 'USD',
        kind: 'marketplace', itemId,
        label: String(item.title || 'Marketplace item').slice(0, 120),
      });
    }

    // verify and fulfill
    if (body.action === 'verify') {
      const { orderId, paymentId, signature } = body;
      if (!orderId || !paymentId) return json({ error: 'Bad request' }, 400);
      if (!(await validSignature(env, orderId, paymentId, signature)))
        return json({ error: 'Payment verification failed' }, 400);

      // order is the source of truth
      const order = await rzp(env, '/v1/orders/' + orderId);
      if (order.status !== 'paid') return json({ error: 'Payment not completed yet' }, 400);
      const notes = order.notes || {};
      if (notes.user_id !== user.id) return json({ error: 'Order does not belong to you' }, 403);

      // block replayed signatures
      const paidRows = await sbService(env,
        '/payments?rzp_order_id=eq.' + orderId + '&status=eq.created', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid', rzp_payment_id: String(paymentId),
          paid_at: new Date().toISOString(),
        }),
      });
      const firstVerify = Array.isArray(paidRows) && paidRows.length > 0;

      let tier = null;
      if (notes.kind === 'subscription') {
        const plan = PLANS[notes.plan];
        if (plan && plan.tier) {
          tier = plan.tier;
          if (firstVerify) {
            const exp = new Date(Date.now() + SUB_DAYS * 86400000).toISOString();
            await sbService(env, '/profiles?id=eq.' + user.id, {
              method: 'PATCH',
              body: JSON.stringify({ subscription_tier: tier, subscription_expires_at: exp }),
            });
          }
        }
      }
      return json({ ok: true, kind: notes.kind, tier });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payment service error' }, 500);
  }
}
