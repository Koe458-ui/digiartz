// paypal checkout backend
//
// Sits alongside functions/api/rzp.js and answers the same three questions
// with the same shapes: make me a subscription order, make me a marketplace
// order, and settle one. Both write the same public.payments ledger, tagged by
// the provider column, so everything downstream — dz_market_owns, the
// subscription tier on profiles — reads one table and never learns which
// checkout the money came through.
//
// Environment (Cloudflare Pages project variables, never config.js):
//   PAYPAL_CLIENT_ID       public half of the REST app credentials
//   PAYPAL_CLIENT_SECRET   secret half — a leak lets anyone take payments as us
//   PAYPAL_ENV             'sandbox' to point at PayPal's test bank, anything
//                          else (or unset) means live
// plus SB_URL, SB_KEY and SB_SERVICE_KEY, exactly as rzp.js reads them.

// Plan prices are NOT here. They live in public.subscription_prices, one row
// per plan per currency, read on the service role — see the note in rzp.js.
// The browser names a plan and never a price or a currency.
const TIERS = { lite: 'lite', premium: 'premium', max: 'max', support: null };
// What a member already holds decides both whether a plan may be ordered and
// how a settled month is applied \u2014 see applySubscription below. Same table in
// rzp.js and both webhooks.
const TIER_RANK = { lite: 1, premium: 2, max: 3 };
const PLAN_LABEL = {
  lite: 'Lite \u2014 1 month', premium: 'Premium \u2014 1 month',
  max: 'Max \u2014 1 month',   support: 'Support DigiArtz',
};
const SUB_DAYS = 31;

// PayPal quotes amounts as decimal strings, and rejects a fractional part on a
// currency that has none. These are the zero-decimal currencies PayPal lists.
const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

// The smallest charge a gateway will accept, per currency, in minor units.
// A 90% discount on a cheap plan in a cheap currency can land under this, and
// a gateway refusing the order is a checkout that fails with a message the
// buyer cannot act on. The floor is roughly one major unit — a rupee, a cent,
// a yen — which is what both providers document as their minimum.
const MIN_CHARGE = { INR: 100, JPY: 1, HUF: 1, TWD: 1 };
const MIN_CHARGE_DEFAULT = 50;
const minCharge = (cur) => MIN_CHARGE[cur] != null ? MIN_CHARGE[cur] : MIN_CHARGE_DEFAULT;


// The marketplace composer offers USD, EUR, GBP, INR and JPY. PayPal settles
// four of those; INR is not a currency it will take here, so an INR listing
// stays a Razorpay purchase and says so rather than failing inside the popup.
const SUPPORTED = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'NZD', 'SGD', 'HKD', 'MXN',
  'BRL', 'ILS', 'PHP', 'THB', 'TWD']);

// TWO UNITS, AND ONLY ONE OF THEM NEEDS CONVERTING. See the long note in
// rzp.js: payments.amount, marketplace_earnings, support_limits and
// subscription_prices are all in the currency's smallest unit already — 1500
// JPY is stored as 1500 — while marketplace_items.price_cents is always
// major x 100 whatever the currency, because that is what the composer writes.
//
// This helper divided for every zero-decimal currency and was applied to both,
// so a ¥1500 plan was ordered at ¥15. It is now named for the one input it is
// actually for.
const fromPriceCents = (cents, cur) =>
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

// The commission, the TDS, the GST TCS and the settlement date are worked out
// by dz_earning_apply_deductions() in Postgres, from one config row, not here
// and not in the three other files that also write earnings. What is sent from
// this side is only what this side knows: what the buyer paid, and what PayPal
// took out of it before it reached us.

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

  // one earning per payment; a replay hits the unique constraint and stops
  const made = await sbService(env, '/marketplace_earnings', {
    method: 'POST',
    headers: { prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({
      payment_id: row.id, item_id: row.item_id,
      seller_id: sellerId, buyer_id: row.user_id,
      gross_amount: Number(row.amount) || 0,
      gateway_fee: (prov && prov.fee) || 0,
      currency: row.currency,
      // Which promo code, if any, the buyer arrived with. Nothing here does
      // anything with it: dz_partner_credit_market() reads it off the inserted
      // row and takes the partner's share out of the platform's commission,
      // for the same reason the deductions are computed there rather than in
      // four checkout paths. A marketplace code is attribution only — it does
      // not change the price, and it does not change what the seller keeps.
      promo_code_id: row.promo_code_id || null,
      provider: 'paypal',
      status: 'available',
    }),
  }).catch(() => null);

  // Only a real insert reaches the ledger — this runs on the browser's capture
  // AND on the webhook for the same sale, and an append-only record that got
  // two credits for one payment would put the seller's own withdrawals into
  // permanent reconciliation failure.
  const earning = Array.isArray(made) && made[0];
  if (!earning) return;

  await ledger(env, {
    p_user: sellerId, p_type: 'sale_credit', p_direction: 'credit',
    p_amount: Number(earning.net_amount) || 0, p_currency: row.currency,
    p_source: 'paypal',
    p_provider_txn: (prov && prov.txn) || null,
    p_provider_amount: (prov && prov.amount) || null,
    p_provider_currency: (prov && prov.currency) || row.currency,
    p_ref_table: 'payments', p_ref_id: row.id,
  });
}

// What PayPal kept. Reported on the capture as seller_receivable_breakdown,
// in the capture's own currency — if it ever comes back in a different one,
// nothing is recorded rather than a number in the wrong denomination.
function ppFee(capture, currency) {
  const br = (capture && capture.seller_receivable_breakdown) || {};
  const f  = br.paypal_fee;
  if (!f || f.currency_code !== currency) return 0;
  const v = parseFloat(f.value);
  if (!Number.isFinite(v)) return 0;
  return ZERO_DECIMAL.has(currency) ? Math.round(v) : Math.round(v * 100);
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


// what this member transacts in, and what a plan costs there
async function memberCurrency(env, userId) {
  const rows = await sbService(env,
    '/profiles?id=eq.' + userId + '&select=currency&limit=1');
  const c = rows && rows[0] && rows[0].currency;
  return /^[A-Z]{3}$/.test(String(c || '')) ? c : 'USD';
}

async function planPrice(env, plan, currency) {
  const rows = await sbService(env,
    '/subscription_prices?plan=eq.' + encodeURIComponent(plan) +
    '&currency=eq.' + encodeURIComponent(currency) + '&select=amount&limit=1');
  const a = rows && rows[0] && Number(rows[0].amount);
  return Number.isFinite(a) && a > 0 ? a : null;
}

async function supportLimits(env, currency) {
  const rows = await sbService(env,
    '/support_limits?currency=eq.' + encodeURIComponent(currency) +
    '&select=min_amount,max_amount&limit=1');
  const r = rows && rows[0];
  return r ? { min: Number(r.min_amount), max: Number(r.max_amount) } : null;
}

const showAmount = (minor, cur) => toValue(minor, cur) + ' ' + cur;

// ---------------------------------------------------------------------------
// WHAT THE MEMBER ALREADY HOLDS.
//
// Read before an order is created, so a plan that would take something away
// can be refused while the buyer still has their money, and read again at
// settlement so a month is added to what is there rather than written over it.
async function currentPlan(env, userId) {
  try {
    const rows = await sbService(env, '/profiles?id=eq.' + userId +
      '&select=subscription_tier,subscription_expires_at&limit=1');
    const p = rows && rows[0];
    const t = p && p.subscription_expires_at
      ? new Date(p.subscription_expires_at).getTime() : 0;
    // an expired subscription is not a subscription
    if (t && t > Date.now()) return { tier: p.subscription_tier || null, expires: t };
  } catch { /* unreadable — treated as holding nothing */ }
  return { tier: null, expires: 0 };
}

// APPLYING A MONTH TO WHAT IS ALREADY THERE.
//
// The same block is in paypal.js, rzp-webhook.js and paypal-webhook.js, which
// with this file are the four paths that can settle a subscription. It used to
// be an unconditional PATCH to { tier, now + 31 days } in all four, reading
// neither the current tier nor the current expiry first:
//
//   buying a month with twenty days left gave thirty-one, not fifty-one, so
//   twenty paid days were destroyed — and the plan copy invites exactly that
//   purchase ("A single charge for 31 days. Nothing recurring");
//
//   buying Lite while holding Max dropped the daily quota from twenty to ten
//   on the spot and took the remaining Max days with it.
//
// So: extend from whichever is later, now or the existing expiry, and never
// come out of this holding a lower tier than went in. sub-order refuses a
// downgrade before any money moves; this is the backstop for an order created
// before an upgrade and settled after it, where the money is already taken and
// the only wrong answer is to give less than was there before.
async function applySubscription(env, userId, tier) {
  const cur = await currentPlan(env, userId);
  const from = Math.max(Date.now(), cur.expires);
  const keep = (TIER_RANK[cur.tier] || 0) > (TIER_RANK[tier] || 0) ? cur.tier : tier;
  await sbService(env, '/profiles?id=eq.' + userId, {
    method: 'PATCH',
    body: JSON.stringify({
      subscription_tier: keep,
      subscription_expires_at: new Date(from + SUB_DAYS * 86400000).toISOString(),
    }),
  });
  return keep;
}

// create order and ledger row

// ---------------------------------------------------------------------------
// A PROMO CODE, AND WHAT IT IS WORTH.
//
// Resolved by Postgres, AS THE BUYER — the caller's own bearer, not the
// service key — because dz_promo_resolve() has to know who is asking in order
// to refuse a partner spending their own code. Sending the service key here
// would make every check pass and hand a partner a 90% discount on their own
// Max plus a rebate to themselves on top of it.
//
// The twin of this function is in rzp.js. Two copies is one more than ideal
// and it is the lesser evil here: these two files share no module today, and
// the arithmetic they would share is one multiplication — the decision that
// matters, what the code is worth, is made in Postgres and read by both.
async function resolvePromo(env, request, code, kind) {
  const raw = String(code || '').trim().toUpperCase();
  if (!raw) return { id: null, discountBps: 0 };
  if (!/^[A-Z0-9]{4,6}$/.test(raw)) return { error: 'That code does not look right' };
  try {
    const res = await fetch(sbUrl(env) + '/rest/v1/rpc/dz_promo_resolve', {
      method: 'POST',
      headers: {
        apikey: sbAnon(env),
        authorization: request.headers.get('authorization') || '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_code: raw, p_kind: kind }),
    });
    if (!res.ok) return { error: 'That code could not be checked' };
    const r = await res.json();
    if (!r || !r.ok) return { error: (r && r.error) || 'No such code' };
    const bps = Math.min(Math.max(Number(r.discount_bps) || 0, 0), 9500);
    return { id: r.id, code: raw, discountBps: bps };
  } catch {
    return { error: 'That code could not be checked' };
  }
}

const PROMO_PLAN = 'max';

async function makeOrder(env, user, { minor, currency, kind, plan, itemId, label, promoId }) {
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
      // Set at checkout and never afterwards. The commission triggers read it
      // at settlement; nothing else in this file touches it again.
      promo_code_id: promoId || null,
      // the title as it stood at checkout, so a purchase outlives its listing
      order_label: label ? String(label).slice(0, 200) : null,
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
                   sbUrl(env) && sbAnon(env) && sbSvc(env));
  return json({ enabled: ready });
}

// entry point
export async function onRequestPost({ env, request }) {
  const missing = [
    ['PAYPAL_CLIENT_ID', env.PAYPAL_CLIENT_ID],
    ['PAYPAL_CLIENT_SECRET', env.PAYPAL_CLIENT_SECRET],
    ['SB_URL or SUPABASE_URL', sbUrl(env)],
    ['SB_KEY or SUPABASE_ANON_KEY', sbAnon(env)],
    ['SB_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY', sbSvc(env)],
  ].find(([, v]) => !v);
  if (missing) return json({ error: 'PayPal is not configured (' + missing[0] + ' missing)' }, 500);

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
      const key = String(body.plan || '');
      if (!(key in TIERS)) return json({ error: 'Unknown plan' }, 400);

      const currency = await memberCurrency(env, user.id);
      // A member transacting in a currency PayPal will not settle is sent to
      // the other checkout rather than silently charged in dollars.
      if (!SUPPORTED.has(currency))
        return json({ error: 'PayPal cannot take ' + currency + ' \u2014 use the other checkout' }, 400);

      let amount;
      if (key === 'support') {
        const lim = await supportLimits(env, currency);
        if (!lim) return json({ error: 'Support is not available in ' + currency }, 400);
        amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount < lim.min || amount > lim.max)
          return json({ error: 'Amount must be between ' + showAmount(lim.min, currency) +
                               ' and ' + showAmount(lim.max, currency) }, 400);
      } else {
        amount = await planPrice(env, key, currency);
        if (!amount) return json({ error: 'That plan is not priced in ' + currency }, 400);

        // Refused BEFORE the order exists, which is the only place a downgrade
        // can be refused without taking someone's money for it. Buying Lite
        // while Max is still running used to drop the quota from twenty
        // downloads to ten on the spot and discard the remaining Max days;
        // buying the same plan again is fine and extends it.
        const cur = await currentPlan(env, user.id);
        if (cur.tier && (TIER_RANK[cur.tier] || 0) > (TIER_RANK[key] || 0)) {
          return json({ error: 'Your ' + cur.tier + ' plan runs until ' +
            new Date(cur.expires).toISOString().slice(0, 10) +
            '. Buying ' + key + ' now would not add anything to it \u2014 ' +
            'renew ' + cur.tier + ', or wait until it ends.' }, 400);
        }
      }

      // A promo code, if one was typed. Applied after the downgrade check, so
      // a discounted order still cannot take a plan away from somebody.
      const promo = await resolvePromo(env, request, body.promo, 'subscription');
      if (promo.error) return json({ error: promo.error }, 400);
      if (promo.id && key !== PROMO_PLAN)
        return json({ error: 'That code only applies to Max' }, 400);
      if (promo.discountBps > 0) {
        amount = Math.round(amount * (10000 - promo.discountBps) / 10000);
        amount = Math.max(amount, minCharge(currency));
      }

      // A plan price and a support amount are both already in the smallest
      // unit, so they go through untouched.
      return await makeOrder(env, user, {
        minor: amount, currency, promoId: promo.id,
        kind: 'subscription', plan: key, label: PLAN_LABEL[key],
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

      // A code on a marketplace purchase is attribution, not a discount — the
      // buyer pays the listed price and the partner's share comes out of the
      // platform's commission. dz_promo_resolve() returns discount_bps 0 for
      // this kind, so there is nothing to apply; only the id is carried.
      const promo = await resolvePromo(env, request, body.promo, 'marketplace');
      if (promo.error) return json({ error: promo.error }, 400);

      return await makeOrder(env, user, {
        minor: fromPriceCents(item.price_cents, currency),
        currency,
        kind: 'marketplace', itemId, promoId: promo.id,
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
        '&select=id,kind,plan,item_id,amount,currency,status,promo_code_id&limit=1');
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
      await recordEarning(env, row, {
        txn: capture.id,
        amount: Math.round(parseFloat(paidAmount.value) * 100),
        currency: paidAmount.currency_code,
        fee: ppFee(capture, row.currency),
      });

      let tier = null;
      if (row.kind === 'subscription') {
        const t = TIERS[row.plan];
        if (t) {
          // What they end up holding, which is not always what they bought —
          // a month bought under a higher tier extends that tier instead.
          tier = firstCapture ? await applySubscription(env, user.id, t) : t;
        }
      }
      return json({ ok: true, kind: row.kind, tier });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payment service error' }, 500);
  }
}
