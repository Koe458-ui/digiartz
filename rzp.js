/* ═══════════════════════════════════════════════════════════════════
   Cloudflare Pages Function — POST /api/rzp
   Razorpay checkout backend for subscriptions and marketplace buys.

   The browser NEVER sees the Razorpay key secret and NEVER decides a
   price. It sends an action; this function authenticates the caller
   against Supabase, creates the order at the server-decided amount,
   and later verifies the payment signature before anything is
   fulfilled. Fulfillment writes go through the Supabase SERVICE role
   (payments has no client write policies; subscription_tier is
   trigger-protected against every role except service_role).

   Actions:
     sub-order     {plan, amount?}        → create a subscription order
     market-order  {itemId}               → create a marketplace order
     verify        {orderId, paymentId, signature}
                                          → HMAC check + fulfill

   REQUIRES, in Pages → Settings → Environment variables
   (Production AND Preview):
     SB_URL                already set (middleware uses it)
     SB_KEY                already set (anon/publishable key)
     SB_SERVICE_KEY        NEW — Supabase service_role key
     RAZORPAY_KEY_ID       NEW — from the Razorpay dashboard
     RAZORPAY_KEY_SECRET   NEW — from the Razorpay dashboard

   NOTE ON RECURRENCE: these are one-time payments that grant 31 days
   (Razorpay auto-recurring subscriptions need dashboard-created plan
   entities + mandates — a later upgrade). subscription_expires_at is
   stamped on profiles; expiry enforcement is a read-side concern.
   ═══════════════════════════════════════════════════════════════════ */

/* Server-side price list — the client's plan string selects a row
   here, nothing more. Amounts are in the currency's smallest unit. */
const SUB_CURRENCY = 'USD';
const PLANS = {
  lite:    { amount: 100,  tier: 'lite',    label: 'Lite — 1 month'    },
  premium: { amount: 500,  tier: 'premium', label: 'Premium — 1 month' },
  max:     { amount: 1000, tier: 'max',     label: 'Max — 1 month'     },
  support: { amount: null, tier: null,      label: 'Support DigiArtz'  },
};
const SUPPORT_MIN = 50;        /* $0.50  */
const SUPPORT_MAX = 1000000;   /* $10,000 */
const SUB_DAYS    = 31;

/* Razorpay wants the smallest currency unit. price_cents stores
   price*100 for every currency, which is wrong for zero-decimal
   currencies (¥500 stored as 50000 would charge ¥50,000). */
const ZERO_DECIMAL = new Set(['JPY']);
const toRzpAmount = (cents, cur) =>
  ZERO_DECIMAL.has(cur) ? Math.round(cents / 100) : cents;

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

/* ── Razorpay REST ──────────────────────────────────────────────── */
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

/* ── Supabase: who is calling / service-role REST ──────────────── */
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

/* ── HMAC-SHA256 signature check (constant-time compare) ───────── */
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

/* ── shared: create order + ledger row, return checkout payload ── */
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
      amount, currency, rzp_order_id: order.id, status: 'created',
    }),
  });
  return json({ orderId: order.id, keyId: env.RAZORPAY_KEY_ID, amount, currency, label });
}

/* ── entry point ───────────────────────────────────────────────── */
export async function onRequestPost({ env, request }) {
  for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'SB_SERVICE_KEY', 'SB_URL', 'SB_KEY'])
    if (!env[k]) return json({ error: 'Payment service not configured (' + k + ' missing)' }, 500);

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    /* ── subscriptions ── */
    if (body.action === 'sub-order') {
      const plan = PLANS[String(body.plan || '')];
      if (!plan) return json({ error: 'Unknown plan' }, 400);
      let amount = plan.amount;
      if (amount === null) {                       /* Support — any amount */
        amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount < SUPPORT_MIN || amount > SUPPORT_MAX)
          return json({ error: 'Amount must be between $0.50 and $10,000' }, 400);
      }
      return await makeOrder(env, user, {
        amount, currency: SUB_CURRENCY, kind: 'subscription',
        plan: String(body.plan), label: plan.label,
      });
    }

    /* ── marketplace ── */
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

      /* already bought → skip checkout, client goes straight to download */
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

    /* ── verify + fulfill ── */
    if (body.action === 'verify') {
      const { orderId, paymentId, signature } = body;
      if (!orderId || !paymentId) return json({ error: 'Bad request' }, 400);
      if (!(await validSignature(env, orderId, paymentId, signature)))
        return json({ error: 'Payment verification failed' }, 400);

      /* Signature proves Razorpay issued this pair; the order itself
         is the source of truth for what was bought and by whom. */
      const order = await rzp(env, '/v1/orders/' + orderId);
      if (order.status !== 'paid') return json({ error: 'Payment not completed yet' }, 400);
      const notes = order.notes || {};
      if (notes.user_id !== user.id) return json({ error: 'Order does not belong to you' }, 403);

      await sbService(env, '/payments?rzp_order_id=eq.' + orderId, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid', rzp_payment_id: String(paymentId),
          paid_at: new Date().toISOString(),
        }),
      });

      let tier = null;
      if (notes.kind === 'subscription') {
        const plan = PLANS[notes.plan];
        if (plan && plan.tier) {
          tier = plan.tier;
          const exp = new Date(Date.now() + SUB_DAYS * 86400000).toISOString();
          await sbService(env, '/profiles?id=eq.' + user.id, {
            method: 'PATCH',
            body: JSON.stringify({ subscription_tier: tier, subscription_expires_at: exp }),
          });
        }
      }
      return json({ ok: true, kind: notes.kind, tier });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payment service error' }, 500);
  }
}
