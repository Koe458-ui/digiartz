// razorpay checkout backend

import { sbUrl, sbAnon, sbSvc, sbUser, underLimit, ledger } from '../lib/sb.js';
import { fromPriceCents, minCharge, showAmount } from '../lib/money.js';
import {
  sbService, memberCurrency, planPrice, supportLimits, currentPlan, resolvePromo
} from '../lib/billing.js';

// Plan prices are NOT here. They live in public.subscription_prices, one row
// per plan per currency, because this file, paypal.js and the module in
// store.js all price subscriptions and three copies of a price list is three
// chances to charge the wrong amount. They are LOCAL prices per currency, not
// a dollar figure run through an exchange rate — that is how you end up
// quoting Rs 416.67 a month.
const TIERS = { lite: 'lite', premium: 'premium', max: 'max', support: null };
// What a member already holds decides both whether a plan may be ordered and
// how a settled month is applied, so the three need an order. The same block
// is in paypal.js and both webhooks — see applySubscription below.
const TIER_RANK = { lite: 1, premium: 2, max: 3 };
const PLAN_LABEL = {
  lite: 'Lite \u2014 1 month', premium: 'Premium \u2014 1 month',
  max: 'Max \u2014 1 month',   support: 'Support DigiArtz',
};
const SUB_DAYS = 31;

// TWO UNITS LIVE IN THIS SYSTEM AND THEY ARE NOT THE SAME UNIT.
//
// Everything on the money side — payments.amount, marketplace_earnings.*,
// support_limits, subscription_prices, MIN_PAYOUT in payouts.js — is in the
// currency's SMALLEST unit, and for a zero-decimal currency that IS the major
// unit: 1500 JPY is stored as 1500. The rule is written out in
// 20260802_money_flow.sql, and dz_earning_apply_deductions scales by 100 for
// exactly these three currencies on the strength of it.
//
// marketplace_items.price_cents is the exception, and it is not a small one:
// the composer stores Math.round(price * 100) whatever the currency, so a
// ¥1500 listing carries 150000 and has to be scaled DOWN before it can be
// charged or written to payments.amount.
//
// One helper used to serve both, dividing for every zero-decimal currency. It
// is right for a listing and wrong for a plan: a ¥1500 plan was ordered at ¥15
// and the buyer paid one percent of the price they had just been quoted. The
// checkout page even showed both figures — the plan grid's, and the server
// order's at the gateway step — and they disagreed on screen.
//
// The smallest charge a gateway will accept, per currency, in minor units.
// A 90% discount on a cheap plan in a cheap currency can land under this, and
// a gateway refusing the order is a checkout that fails with a message the
// buyer cannot act on. The floor is roughly one major unit — a rupee, a cent,
// a yen — which is what both providers document as their minimum.
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

// A marketplace sale owes the seller a share, and this file no longer works
// out what it is.
//
// The commission, the TDS, the GST TCS and the settlement date are all
// computed by dz_earning_apply_deductions() in Postgres, from one config row,
// at the moment the earning is written. Four checkout paths insert into that
// table — this one, PayPal, and both webhooks — and having four copies of the
// arithmetic was four chances for them to disagree about what a seller is
// owed. What is sent from here is only what this side actually knows: what the
// buyer paid, and what the gateway took out of it before it reached us.

async function recordEarning(env, row, prov) {
  if (row.kind !== 'marketplace' || !row.item_id) return;
  const items = await sbService(env,
    '/marketplace_items?id=eq.' + row.item_id + '&select=user_id&limit=1');
  const sellerId = items && items[0] && items[0].user_id;
  if (!sellerId || sellerId === row.user_id) return;

  // One earning per payment. The unique constraint on payment_id is what makes
  // this a no-op the second time — and the second time is normal, because the
  // browser and the webhook both arrive at the same sale.
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
      provider: 'razorpay',
      status: 'available',
    }),
  }).catch(() => null);

  // THE LEDGER APPEND ONLY HAPPENS ON A REAL INSERT.
  //
  // ledger_entries has no unique key and is append-only by design, so an
  // append that ran twice could never be taken back. The earnings insert is
  // idempotent; this is what makes the audit record idempotent with it.
  // Appending on a replay would credit the seller twice in the ledger, the two
  // records would then disagree, and dz_reconcile would freeze the withdrawal
  // of an honest seller with no way to unfreeze it.
  const earning = Array.isArray(made) && made[0];
  if (!earning) return;

  await ledger(env, {
    p_user: sellerId, p_type: 'sale_credit', p_direction: 'credit',
    // what the database worked out the seller is owed, not what we guessed
    p_amount: Number(earning.net_amount) || 0, p_currency: row.currency,
    p_source: 'razorpay',
    p_provider_txn: (prov && prov.txn) || null,
    p_provider_amount: (prov && prov.amount) || null,
    p_provider_currency: (prov && prov.currency) || row.currency,
    p_ref_table: 'payments', p_ref_id: row.id,
  });
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


// Only Max carries a promo discount. A code typed against Lite or Premium is
// refused rather than quietly ignored: a buyer who thinks they used a code and
// was charged full price will say so, and they will be right.
const PROMO_PLAN = 'max';

// create order and ledger row
async function makeOrder(env, user, { amount, currency, kind, plan, itemId, label, promoId }) {
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
      // Set at checkout and never afterwards. The commission triggers read it
      // at settlement; nothing else in this file touches it again.
      promo_code_id: promoId || null,
      // What the buyer thought they were buying, kept on the payment itself.
      // A seller who delists after the sale takes the listing row with them,
      // and My Purchases falls back to this so the buyer's own history does not
      // turn into a row of blanks.
      order_label: label ? String(label).slice(0, 200) : null,
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
      const key = String(body.plan || '');
      if (!(key in TIERS)) return json({ error: 'Unknown plan' }, 400);

      const currency = await memberCurrency(env, user.id);
      let amount;

      if (key === 'support') {
        // open-ended, so it gets a floor and a ceiling in the member's own
        // currency rather than a dollar figure converted at request time
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
        // Razorpay refuses an order under one major unit, and so does every
        // other gateway. A discount that lands under the floor is honoured up
        // to it rather than turning into a failed checkout the buyer cannot
        // read the reason for.
        amount = Math.max(amount, minCharge(currency));
      }

      // Both a plan price and a support amount are already in the smallest
      // unit — subscription_prices.amount is, and the browser sends a support
      // amount through minorOf(), which does the same. Nothing to convert.
      return await makeOrder(env, user, {
        amount, currency, promoId: promo.id,
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

      // already bought, skip checkout
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
        amount: fromPriceCents(item.price_cents, item.currency),
        currency: item.currency || 'USD',
        kind: 'marketplace', itemId, promoId: promo.id,
        label: String(item.title || 'Marketplace item').slice(0, 120),
      });
    }

    // verify and fulfill
    if (body.action === 'verify') {
      const { orderId, paymentId, signature } = body;
      if (!orderId || !paymentId) return json({ error: 'Bad request' }, 400);
      // Shape-checked before either id is put in a url, the way paypal.js
      // checks its own. Razorpay mints these as order_/pay_ plus base62, so
      // nothing legitimate is refused. What this closes is not reachable today
      // — validSignature is an HMAC over exactly these two strings under the
      // key secret, so a caller cannot choose them — but orderId went
      // unencoded into a PostgREST filter on the payments table two calls
      // below, and "safe because of a check twenty lines up" is one refactor
      // away from a filter injection. paymentId was already encoded at its
      // call site; this makes the pair consistent.
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(orderId)) ||
          !/^[A-Za-z0-9_-]{6,64}$/.test(String(paymentId)))
        return json({ error: 'Bad request' }, 400);
      if (!(await validSignature(env, orderId, paymentId, signature)))
        return json({ error: 'Payment verification failed' }, 400);

      // order is the source of truth
      const order = await rzp(env, '/v1/orders/' + encodeURIComponent(orderId));
      if (order.status !== 'paid') return json({ error: 'Payment not completed yet' }, 400);
      const notes = order.notes || {};
      if (notes.user_id !== user.id) return json({ error: 'Order does not belong to you' }, 403);

      // What Razorpay charged us for taking it. Their `fee` is the whole
      // deduction including the GST on it, which is the figure that actually
      // never arrives, so that is the one recorded. Asked for rather than
      // estimated from a rate card — the rate varies by method, and a seller's
      // share should not depend on our guess about which card they used.
      let gwFee = 0;
      try {
        const pay = await rzp(env, '/v1/payments/' + encodeURIComponent(String(paymentId)));
        if (pay && pay.currency === order.currency) gwFee = Number(pay.fee) || 0;
      } catch { /* a fee we cannot read is recorded as zero, never as a guess */ }

      // block replayed signatures
      const paidRows = await sbService(env,
        '/payments?rzp_order_id=eq.' + encodeURIComponent(orderId) + '&status=eq.created' +
        '&select=id,user_id,kind,item_id,amount,currency,promo_code_id', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid', rzp_payment_id: String(paymentId),
          paid_at: new Date().toISOString(),
        }),
      });
      const firstVerify = Array.isArray(paidRows) && paidRows.length > 0;
      if (firstVerify) await recordEarning(env, paidRows[0], {
        txn: String(paymentId), amount: order.amount_paid || order.amount,
        currency: order.currency, fee: gwFee,
      });

      let tier = null;
      if (notes.kind === 'subscription') {
        const t = TIERS[notes.plan];
        if (t) {
          // What they end up holding, which is not always what they bought —
          // a month bought under a higher tier extends that tier instead.
          tier = firstVerify ? await applySubscription(env, user.id, t) : t;
        }
      }
      return json({ ok: true, kind: notes.kind, tier });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payment service error' }, 500);
  }
}
