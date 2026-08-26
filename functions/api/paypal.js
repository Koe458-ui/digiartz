import { sbUrl, sbAnon, sbSvc, sbUser, underLimit, ledger } from '../lib/sb.js';
import { fromPriceCents, toValue, minCharge, ppFee, showAmount } from '../lib/money.js';
import {
  sbService, memberCurrency, planPrice, supportLimits, currentPlan, resolvePromo,
  PLAN_TIERS, TIER_RANK, PLAN_LABEL, applySubscription
} from '../lib/billing.js';

const SUPPORTED = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'NZD', 'SGD', 'HKD', 'MXN',
  'BRL', 'ILS', 'PHP', 'THB', 'TWD']);

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const apiBase = (env) =>
  String(env.PAYPAL_ENV || '').trim().toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

let tokenCache = null;

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

async function recordEarning(env, row, prov) {
  if (row.kind !== 'marketplace' || !row.item_id) return;
  const items = await sbService(env,
    '/marketplace_items?id=eq.' + row.item_id + '&select=user_id&limit=1');
  const sellerId = items && items[0] && items[0].user_id;
  if (!sellerId || sellerId === row.user_id) return;

  const made = await sbService(env, '/marketplace_earnings', {
    method: 'POST',
    headers: { prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({
      payment_id: row.id, item_id: row.item_id,
      seller_id: sellerId, buyer_id: row.user_id,
      gross_amount: Number(row.amount) || 0,
      gateway_fee: (prov && prov.fee) || 0,
      currency: row.currency,
      promo_code_id: row.promo_code_id || null,
      provider: 'paypal',
      status: 'available',
    }),
  }).catch(() => null);

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
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
  });
  if (!order.id) throw new Error('Payment provider error');

  await sbService(env, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      user_id: user.id, kind, plan: plan || null, item_id: itemId || null,
      amount: minor, currency, provider: 'paypal',
      promo_code_id: promoId || null,
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

export async function onRequestGet({ env, request }) {
  if (!(await sbUser(env, request))) return json({ error: 'Sign in required' }, 401);
  const ready = !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET &&
                   sbUrl(env) && sbAnon(env) && sbSvc(env));
  return json({ enabled: ready });
}

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

  if (!(await underLimit(env, 'pp:' + user.id, 30, 60)))
    return json({ error: 'Too many attempts — wait a moment' }, 429);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    if (body.action === 'sub-order') {
      const key = String(body.plan || '');
      if (!(key in PLAN_TIERS)) return json({ error: 'Unknown plan' }, 400);

      const currency = await memberCurrency(env, user.id);
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

        const cur = await currentPlan(env, user.id);
        if (cur.tier && (TIER_RANK[cur.tier] || 0) > (TIER_RANK[key] || 0)) {
          return json({ error: 'Your ' + cur.tier + ' plan runs until ' +
            new Date(cur.expires).toISOString().slice(0, 10) +
            '. Buying ' + key + ' now would not add anything to it \u2014 ' +
            'renew ' + cur.tier + ', or wait until it ends.' }, 400);
        }
      }

      const promo = await resolvePromo(env, request, body.promo, 'subscription');
      if (promo.error) return json({ error: promo.error }, 400);
      if (promo.id && key !== PROMO_PLAN)
        return json({ error: 'That code only applies to Max' }, 400);
      if (promo.discountBps > 0) {
        amount = Math.round(amount * (10000 - promo.discountBps) / 10000);
        amount = Math.max(amount, minCharge(currency));
      }

      return await makeOrder(env, user, {
        minor: amount, currency, promoId: promo.id,
        kind: 'subscription', plan: key, label: PLAN_LABEL[key],
      });
    }

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

      const paid = await sbService(env,
        '/payments?item_id=eq.' + itemId + '&user_id=eq.' + user.id +
        '&status=eq.paid&select=id&limit=1');
      if (paid && paid.length) return json({ owned: true });

      const promo = await resolvePromo(env, request, body.promo, 'marketplace');
      if (promo.error) return json({ error: promo.error }, 400);

      return await makeOrder(env, user, {
        minor: fromPriceCents(item.price_cents, currency),
        currency,
        kind: 'marketplace', itemId, promoId: promo.id,
        label: String(item.title || 'Marketplace item').slice(0, 120),
      });
    }

    if (body.action === 'capture') {
      const orderId = String(body.orderId || '');
      if (!/^[A-Z0-9]{6,64}$/i.test(orderId)) return json({ error: 'Bad request' }, 400);

      const rows = await sbService(env,
        '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
        '&user_id=eq.' + user.id +
        '&select=id,kind,plan,item_id,amount,currency,status,promo_code_id&limit=1');
      const row = rows && rows[0];
      if (!row) return json({ error: 'Order does not belong to you' }, 403);

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

      const paidAmount = capture.amount || {};
      if (paidAmount.currency_code !== row.currency ||
          paidAmount.value !== toValue(row.amount, row.currency))
        return json({ error: 'Payment amount does not match the order' }, 400);

      const paidRows = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.created', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'paid',
          pp_capture_id: String(capture.id || ''),
          paid_at: new Date().toISOString(),
        }),
      });
      const firstCapture = Array.isArray(paidRows) && paidRows.length > 0;

      await recordEarning(env, row, {
        txn: capture.id,
        amount: Math.round(parseFloat(paidAmount.value) * 100),
        currency: paidAmount.currency_code,
        fee: ppFee(capture, row.currency),
      });

      let tier = null;
      if (row.kind === 'subscription') {
        const t = PLAN_TIERS[row.plan];
        if (t) {
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
