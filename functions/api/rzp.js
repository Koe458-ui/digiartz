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
// ---------------------------------------------------------------------------
// Supabase environment names.
//
// This project uses two spellings. The older Functions read SUPABASE_URL /
// SUPABASE_ANON_KEY; the newer ones read SB_URL / SB_KEY, and config.example.js
// documents the service key as SUPABASE_SERVICE_ROLE_KEY while the code asks
// for SB_SERVICE_KEY. Either is fine to bind — what is not fine is a deploy
// that half-works because of which spelling someone picked, so both are
// accepted here and the endpoint says exactly what is missing when neither is.
const sbUrl = (env) => env.SB_URL || env.SUPABASE_URL || '';
const sbAnon = (env) => env.SB_KEY || env.SUPABASE_ANON_KEY || '';
const sbSvc = (env) => env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

async function sbUser(env, request) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const res = await fetch(sbUrl(env) + '/auth/v1/user', {
    headers: { apikey: sbAnon(env), authorization: bearer },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

async function sbService(env, path, init = {}) {
  const res = await fetch(sbUrl(env) + '/rest/v1' + path, {
    ...init,
    headers: {
      apikey: sbSvc(env),
      authorization: 'Bearer ' + sbSvc(env),
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

// A marketplace sale owes the seller their share. Mirrors the same split the
// other checkout applies — the ledger must read the same whichever provider
// took the money. The seller's half is a claim, not a wallet: the cash stays in
// our provider account until a payout sends it, after a hold window so a
// chargeback lands while it is still ours to reclaim.
const FEE_BPS   = 1500;   // 15%
const HOLD_DAYS = 7;

// Independent record of the same movement, taken from what the PROVIDER
// reported rather than from our own arithmetic — that is the whole point of
// it. Appended, never updated: the table refuses UPDATE and DELETE to every
// role. If our maths drifts, this does not drift with it, and the mismatch is
// what stops a withdrawal.
async function ledger(env, args) {
  try {
    await fetch(sbUrl(env) + '/rest/v1/rpc/dz_ledger_append', {
      method: 'POST',
      headers: {
        apikey: sbSvc(env),
        authorization: 'Bearer ' + sbSvc(env),
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    });
  } catch { /* never block a settlement on the audit write */ }
}

async function recordEarning(env, row, prov) {
  if (row.kind !== 'marketplace' || !row.item_id) return;
  const items = await sbService(env,
    '/marketplace_items?id=eq.' + row.item_id + '&select=user_id&limit=1');
  const sellerId = items && items[0] && items[0].user_id;
  if (!sellerId || sellerId === row.user_id) return;

  const gross = Number(row.amount) || 0;
  const fee   = Math.round((gross * FEE_BPS) / 10000);
  await sbService(env, '/marketplace_earnings', {
    method: 'POST',
    headers: { prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({
      payment_id: row.id, item_id: row.item_id,
      seller_id: sellerId, buyer_id: row.user_id,
      gross_amount: gross, fee_amount: fee, net_amount: gross - fee,
      fee_bps: FEE_BPS, currency: row.currency, status: 'available',
      available_at: new Date(Date.now() + HOLD_DAYS * 86400000).toISOString(),
    }),
  }).catch(() => {});

  await ledger(env, {
    p_user: sellerId, p_type: 'sale_credit', p_direction: 'credit',
    p_amount: gross - fee, p_currency: row.currency,
    p_source: 'razorpay',
    p_provider_txn: (prov && prov.txn) || null,
    p_provider_amount: (prov && prov.amount) || null,
    p_provider_currency: (prov && prov.currency) || row.currency,
    p_ref_table: 'payments', p_ref_id: row.id,
  });
}

// ---------------------------------------------------------------------------
// Rate limit. Cloudflare stops the floods; this stops the cheap targeted abuse
// it has no reason to block — walking item ids through checkout, opening
// orders to spam the ledger, hammering a payout race. Fails OPEN: if the
// limiter itself is broken, a paying customer still gets served.
async function underLimit(env, bucket, limit, seconds) {
  try {
    const res = await fetch(sbUrl(env) + '/rest/v1/rpc/dz_rate_take', {
      method: 'POST',
      headers: {
        apikey: sbSvc(env),
        authorization: 'Bearer ' + sbSvc(env),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_bucket: bucket, p_limit: limit, p_seconds: seconds }),
    });
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch { return true; }
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
                   sbUrl(env) && sbAnon(env) && sbSvc(env));
  return json({ enabled: ready });
}

// entry point
export async function onRequestPost({ env, request }) {
  const missing = [
    ['RAZORPAY_KEY_ID', env.RAZORPAY_KEY_ID],
    ['RAZORPAY_KEY_SECRET', env.RAZORPAY_KEY_SECRET],
    ['SB_URL or SUPABASE_URL', sbUrl(env)],
    ['SB_KEY or SUPABASE_ANON_KEY', sbAnon(env)],
    ['SB_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY', sbSvc(env)],
  ].find(([, v]) => !v);
  if (missing) return json({ error: 'Payment service not configured (' + missing[0] + ' missing)' }, 500);

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Sign in required' }, 401);

  if (!(await underLimit(env, 'rzp:' + user.id, 30, 60)))
    return json({ error: 'Too many attempts — wait a moment' }, 429);

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
        '/payments?rzp_order_id=eq.' + orderId + '&status=eq.created' +
        '&select=id,user_id,kind,item_id,amount,currency', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid', rzp_payment_id: String(paymentId),
          paid_at: new Date().toISOString(),
        }),
      });
      const firstVerify = Array.isArray(paidRows) && paidRows.length > 0;
      if (firstVerify) await recordEarning(env, paidRows[0], {
        txn: String(paymentId), amount: order.amount_paid || order.amount,
        currency: order.currency,
      });

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
