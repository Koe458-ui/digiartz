// paypal checkout backend
//
// Sits alongside functions/api/rzp.js and answers the same three questions
// with the same shapes: make me a subscription order, make me a marketplace
// order, and settle one. Both write the same public.payments ledger, tagged by
// the provider column, so everything downstream — dz_market_download, the
// subscription tier on profiles — reads one table and never learns which
// checkout the money came through.
//
// Environment (Cloudflare Pages project variables, never config.js):
//   PAYPAL_CLIENT_ID       public half of the REST app credentials
//   PAYPAL_CLIENT_SECRET   secret half — a leak lets anyone take payments as us
//   PAYPAL_ENV             'sandbox' to point at PayPal's test bank, anything
//                          else (or unset) means live
// plus SB_URL, SB_KEY and SB_SERVICE_KEY, exactly as rzp.js reads them.

// server side price list, mirrors rzp.js
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

// PayPal quotes amounts as decimal strings, and rejects a fractional part on a
// currency that has none. These are the zero-decimal currencies PayPal lists.
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

// The marketplace composer offers USD, EUR, GBP, INR and JPY. PayPal settles
// four of those; INR is not a currency it will take here, so an INR listing
// stays a Razorpay purchase and says so rather than failing inside the popup.
const SUPPORTED = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'NZD', 'SGD', 'HKD', 'MXN',
  'BRL', 'ILS', 'PHP', 'THB', 'TWD']);

// smallest currency unit, same convention rzp.js stores in payments.amount
const toMinor = (cents, cur) =>
  ZERO_DECIMAL.has(cur) ? Math.round(cents / 100) : cents;

// minor units back out to the decimal string PayPal wants
const toValue = (minor, cur) =>
  ZERO_DECIMAL.has(cur) ? String(minor) : (minor / 100).toFixed(2);

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const apiBase = (env) =>
  String(env.PAYPAL_ENV || '').trim().toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

// paypal rest
//
// The access token is good for hours and this module lives as long as the
// isolate does, so one token serves many requests. Held per client id so a
// credential swap can never be answered with the old token.
let tokenCache = null;   // { key, token, expires }

async function ppToken(env) {
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

  // retire the token a minute early rather than mid-request
  tokenCache = {
    key,
    token: body.access_token,
    expires: Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000,
  };
  return tokenCache.token;
}

async function pp(env, path, init = {}) {
  const token = await ppToken(env);
  const res = await fetch(apiBase(env) + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      body.message ||
      (body.details && body.details[0] && body.details[0].description) ||
      'Payment provider error (' + res.status + ')'
    );
    err.status = res.status;
    err.issue = (body.details && body.details[0] && body.details[0].issue) || body.name || '';
    throw err;
  }
  return body;
}

// supabase caller and service role, same as rzp.js
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

// A marketplace sale owes the seller their share. The platform's cut is taken
// here, at settlement, and recorded on the row so a later change to the rate
// never restates an old sale. The seller's half is a claim, not a wallet — the
// cash stays in our provider account until a payout sends it, and it waits out
// a hold window first so a chargeback lands while it is still ours to reclaim.
const FEE_BPS   = 1500;   // 15%
const HOLD_DAYS = 7;

async function recordEarning(env, row) {
  if (row.kind !== 'marketplace' || !row.item_id) return;
  const items = await sbService(env,
    '/marketplace_items?id=eq.' + row.item_id + '&select=user_id&limit=1');
  const sellerId = items && items[0] && items[0].user_id;
  if (!sellerId || sellerId === row.user_id) return;

  const gross = Number(row.amount) || 0;
  const fee   = Math.round((gross * FEE_BPS) / 10000);
  // one earning per payment; a replay hits the unique constraint and stops
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
}

// ---------------------------------------------------------------------------
// Rate limit. Cloudflare stops the floods; this stops the cheap targeted abuse
// it has no reason to block — walking item ids through checkout, opening
// orders to spam the ledger, hammering a payout race. Fails OPEN: if the
// limiter itself is broken, a paying customer still gets served.
async function underLimit(env, bucket, limit, seconds) {
  try {
    const res = await fetch(env.SB_URL + '/rest/v1/rpc/dz_rate_take', {
      method: 'POST',
      headers: {
        apikey: env.SB_SERVICE_KEY,
        authorization: 'Bearer ' + env.SB_SERVICE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_bucket: bucket, p_limit: limit, p_seconds: seconds }),
    });
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch { return true; }
}

// create order and ledger row
async function makeOrder(env, user, { minor, currency, kind, plan, itemId, label }) {
  const order = await pp(env, '/v2/checkout/orders', {
    method: 'POST',
    headers: { 'paypal-request-id': 'dz_' + user.id.slice(0, 8) + '_' + Date.now() },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'dz_' + Date.now(),
        description: String(label || 'DigiArtz').slice(0, 127),
        custom_id: user.id,
        amount: { currency_code: currency, value: toValue(minor, currency) },
      }],
      application_context: {
        brand_name: 'DigiArtz',
        shipping_preference: 'NO_SHIPPING',   // nothing here is posted to an address
        user_action: 'PAY_NOW',
      },
    }),
  });
  if (!order.id) throw new Error('Payment provider error');

  // The ledger row is written before the buyer ever sees the popup, and it is
  // what capture reads back. Nothing the browser sends is trusted at capture
  // time beyond the order id.
  await sbService(env, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      user_id: user.id, kind, plan: plan || null, item_id: itemId || null,
      amount: minor, currency, provider: 'paypal',
      pp_order_id: order.id, status: 'created',
    }),
  });
  return json({
    orderId: order.id,
    clientId: env.PAYPAL_CLIENT_ID,
    amount: minor,
    currency,
    label,
  });
}

// availability probe
//
// The browser asks who can take money before it draws a chooser, so a provider
// with no credentials bound is simply not offered.
//
// Signed in only, and it answers with a bare boolean. Whether this site takes
// PayPal is not something an anonymous scraper gets told, and the client id is
// not handed out here at all — it comes back with an order, which is already
// behind the same sign-in, so nothing about payments is reachable in public.
export async function onRequestGet({ env, request }) {
  if (!(await sbUser(env, request))) return json({ error: 'Sign in required' }, 401);
  const ready = !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET &&
                   env.SB_URL && env.SB_KEY && env.SB_SERVICE_KEY);
  return json({ enabled: ready });
}

// entry point
export async function onRequestPost({ env, request }) {
  for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'SB_SERVICE_KEY', 'SB_URL', 'SB_KEY'])
    if (!env[k]) return json({ error: 'PayPal is not configured (' + k + ' missing)' }, 500);

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Sign in required' }, 401);

  // thirty checkout calls a minute is far past any real buyer
  if (!(await underLimit(env, 'pp:' + user.id, 30, 60)))
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
        minor: toMinor(amount, SUB_CURRENCY), currency: SUB_CURRENCY,
        kind: 'subscription', plan: String(body.plan), label: plan.label,
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

      const currency = item.currency || 'USD';
      if (!SUPPORTED.has(currency))
        return json({ error: 'PayPal cannot take ' + currency + ' — use the other checkout' }, 400);

      // already bought, skip checkout — provider does not matter here
      const paid = await sbService(env,
        '/payments?item_id=eq.' + itemId + '&user_id=eq.' + user.id +
        '&status=eq.paid&select=id&limit=1');
      if (paid && paid.length) return json({ owned: true });

      return await makeOrder(env, user, {
        minor: toMinor(item.price_cents, currency),
        currency,
        kind: 'marketplace', itemId,
        label: String(item.title || 'Marketplace item').slice(0, 120),
      });
    }

    // capture and fulfill
    if (body.action === 'capture') {
      const orderId = String(body.orderId || '');
      if (!/^[A-Z0-9]{6,64}$/i.test(orderId)) return json({ error: 'Bad request' }, 400);

      // our own row is the source of truth for who is paying for what. Scoped
      // to the caller, so someone else's order id buys them nothing.
      const rows = await sbService(env,
        '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
        '&user_id=eq.' + user.id +
        '&select=id,kind,plan,item_id,amount,currency,status&limit=1');
      const row = rows && rows[0];
      if (!row) return json({ error: 'Order does not belong to you' }, 403);

      // Capture is the settling call, and PayPal refuses a second one. An
      // already-captured order is a retry — read it back instead of failing.
      let order;
      try {
        order = await pp(env, '/v2/checkout/orders/' + orderId + '/capture', {
          method: 'POST',
          headers: { 'paypal-request-id': 'cap_' + orderId },
          body: '{}',
        });
      } catch (err) {
        if (err.issue === 'ORDER_ALREADY_CAPTURED')
          order = await pp(env, '/v2/checkout/orders/' + orderId);
        else throw err;
      }

      const unit    = (order.purchase_units && order.purchase_units[0]) || {};
      const capture = (unit.payments && unit.payments.captures && unit.payments.captures[0]) || {};
      if (order.status !== 'COMPLETED' || capture.status !== 'COMPLETED')
        return json({ error: 'Payment not completed yet' }, 400);

      // what PayPal says it took must be what we asked for
      const paidAmount = capture.amount || {};
      if (paidAmount.currency_code !== row.currency ||
          paidAmount.value !== toValue(row.amount, row.currency))
        return json({ error: 'Payment amount does not match the order' }, 400);

      // block replayed captures: only the created -> paid transition returns a
      // row, so a second call through here fulfils nothing twice
      const paidRows = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.created', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid',
          pp_capture_id: String(capture.id || ''),
          paid_at: new Date().toISOString(),
        }),
      });
      const firstCapture = Array.isArray(paidRows) && paidRows.length > 0;

      // Recorded regardless of who got here first — the webhook may already
      // have settled the row, and the earning is idempotent either way.
      await recordEarning(env, row);

      let tier = null;
      if (row.kind === 'subscription') {
        const plan = PLANS[row.plan];
        if (plan && plan.tier) {
          tier = plan.tier;
          if (firstCapture) {
            const exp = new Date(Date.now() + SUB_DAYS * 86400000).toISOString();
            await sbService(env, '/profiles?id=eq.' + user.id, {
              method: 'PATCH',
              body: JSON.stringify({ subscription_tier: tier, subscription_expires_at: exp }),
            });
          }
        }
      }
      return json({ ok: true, kind: row.kind, tier });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payment service error' }, 500);
  }
}
