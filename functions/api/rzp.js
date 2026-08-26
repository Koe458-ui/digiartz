import { sbUrl, sbAnon, sbSvc, sbUser, underLimit, ledger } from '../lib/sb.js';
import { fromPriceCents, minCharge, showAmount } from '../lib/money.js';
import {
  sbService, memberCurrency, planPrice, supportLimits, currentPlan, resolvePromo,
  PLAN_TIERS, TIER_RANK, PLAN_LABEL, applySubscription
} from '../lib/billing.js';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

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
      provider: 'razorpay',
      status: 'available',
    }),
  }).catch(() => null);

  const earning = Array.isArray(made) && made[0];
  if (!earning) return;

  await ledger(env, {
    p_user: sellerId, p_type: 'sale_credit', p_direction: 'credit',
    p_amount: Number(earning.net_amount) || 0, p_currency: row.currency,
    p_source: 'razorpay',
    p_provider_txn: (prov && prov.txn) || null,
    p_provider_amount: (prov && prov.amount) || null,
    p_provider_currency: (prov && prov.currency) || row.currency,
    p_ref_table: 'payments', p_ref_id: row.id,
  });
}

const PROMO_PLAN = 'max';

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
      promo_code_id: promoId || null,
      order_label: label ? String(label).slice(0, 200) : null,
      rzp_order_id: order.id, status: 'created',
    }),
  });
  return json({ orderId: order.id, keyId: env.RAZORPAY_KEY_ID, amount, currency, label });
}

export async function onRequestGet({ env, request }) {
  if (!(await sbUser(env, request))) return json({ error: 'Sign in required' }, 401);
  const ready = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET &&
                   sbUrl(env) && sbAnon(env) && sbSvc(env));
  return json({ enabled: ready });
}

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
    if (body.action === 'sub-order') {
      const key = String(body.plan || '');
      if (!(key in PLAN_TIERS)) return json({ error: 'Unknown plan' }, 400);

      const currency = await memberCurrency(env, user.id);
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
        amount, currency, promoId: promo.id,
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

      const paid = await sbService(env,
        '/payments?item_id=eq.' + itemId + '&user_id=eq.' + user.id +
        '&status=eq.paid&select=id&limit=1');
      if (paid && paid.length) return json({ owned: true });

      const promo = await resolvePromo(env, request, body.promo, 'marketplace');
      if (promo.error) return json({ error: promo.error }, 400);

      return await makeOrder(env, user, {
        amount: fromPriceCents(item.price_cents, item.currency),
        currency: item.currency || 'USD',
        kind: 'marketplace', itemId, promoId: promo.id,
        label: String(item.title || 'Marketplace item').slice(0, 120),
      });
    }

    if (body.action === 'verify') {
      const { orderId, paymentId, signature } = body;
      if (!orderId || !paymentId) return json({ error: 'Bad request' }, 400);
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(orderId)) ||
          !/^[A-Za-z0-9_-]{6,64}$/.test(String(paymentId)))
        return json({ error: 'Bad request' }, 400);
      if (!(await validSignature(env, orderId, paymentId, signature)))
        return json({ error: 'Payment verification failed' }, 400);

      const order = await rzp(env, '/v1/orders/' + encodeURIComponent(orderId));
      if (order.status !== 'paid') return json({ error: 'Payment not completed yet' }, 400);
      const notes = order.notes || {};
      if (notes.user_id !== user.id) return json({ error: 'Order does not belong to you' }, 403);

      let gwFee = 0;
      try {
        const pay = await rzp(env, '/v1/payments/' + encodeURIComponent(String(paymentId)));
        if (pay && pay.currency === order.currency) gwFee = Number(pay.fee) || 0;
      } catch {   }

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
        const t = PLAN_TIERS[notes.plan];
        if (t) {
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
