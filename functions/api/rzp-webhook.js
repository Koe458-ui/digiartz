import { sbUrl, sbSvc, ledger } from '../lib/sb.js';
import { PLAN_TIERS, applySubscription } from '../lib/billing.js';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

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
  if (!res.ok) throw new Error('db ' + res.status);
  return body;
}

async function signed(env, raw, signature) {
  const sig = String(signature || '');
  if (!sig) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.RAZORPAY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const a = new TextEncoder().encode(hex);
  const b = new TextEncoder().encode(sig);
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

async function rowFor(env, orderId, select) {
  const rows = await sbService(env,
    '/payments?rzp_order_id=eq.' + encodeURIComponent(orderId) +
    '&provider=eq.razorpay&select=' + select + '&limit=1');
  return (rows && rows[0]) || null;
}

async function fulfil(env, orderId, payment) {
  const row = await rowFor(env, orderId,
    'id,user_id,kind,plan,item_id,amount,currency,status,promo_code_id');
  if (!row) return 'no ledger row';

  const paid = Number(payment && payment.amount);
  const cur  = String((payment && payment.currency) || '');
  if (Number.isFinite(paid) && paid !== Number(row.amount)) return 'amount mismatch';
  if (cur && cur !== String(row.currency)) return 'currency mismatch';

  const patched = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.created', {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'paid',
      rzp_payment_id: String((payment && payment.id) || ''),
      paid_at: new Date().toISOString(),
    }),
  });
  const first = Array.isArray(patched) && patched.length > 0;

  await recordEarning(env, row, {
    txn: (payment && payment.id) || null,
    amount: Number.isFinite(paid) ? paid : null,
    currency: cur || row.currency,
    fee: Number(payment && payment.fee) || 0,
  });

  if (!first) return 'already settled';

  if (row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await applySubscription(env, row.user_id, PLAN_TIERS[row.plan]);
  }
  return 'settled';
}

async function reverseRow(env, row, status) {
  const patched = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.paid', {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
  if (!(Array.isArray(patched) && patched.length)) return 'not a settled payment';

  await sbService(env, '/marketplace_earnings?payment_id=eq.' + row.id +
    '&status=in.(pending,available)', {
    method: 'PATCH', body: JSON.stringify({ status: 'reversed' }),
  }).catch(() => {});

  if (row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await sbService(env, '/profiles?id=eq.' + row.user_id, {
      method: 'PATCH',
      body: JSON.stringify({ subscription_tier: null, subscription_expires_at: null }),
    }).catch(() => {});
  }
  return status;
}

async function refunded(env, orderId, payment, refund) {
  const row = await rowFor(env, orderId, 'id,user_id,kind,plan,status,amount');
  if (!row) return 'no ledger row';

  const gross = Number(payment && payment.amount) || Number(row.amount) || 0;
  const back  = Number.isFinite(Number(payment && payment.amount_refunded))
    ? Number(payment.amount_refunded)
    : Number((refund && refund.amount) || 0);

  if (!(gross > 0) || back < gross) return 'partial refund, purchase stands';
  return reverseRow(env, row, 'refunded');
}

async function disputeOpened(env, orderId) {
  const row = await rowFor(env, orderId, 'id,user_id,kind');
  if (!row) return 'no ledger row';
  await sbService(env, '/marketplace_earnings?payment_id=eq.' + row.id + '&status=eq.available', {
    method: 'PATCH', body: JSON.stringify({ status: 'pending' }),
  }).catch(() => {});
  return 'held pending dispute';
}

export async function onRequestPost({ env, request }) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !sbUrl(env) || !sbSvc(env))
    return json({ error: 'not configured' }, 503);

  const raw = await request.text().catch(() => '');
  if (!raw) return json({ error: 'bad body' }, 400);

  if (!(await signed(env, raw, request.headers.get('x-razorpay-signature'))))
    return json({ error: 'signature check failed' }, 401);

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'bad body' }, 400); }

  const type    = String(event.event || '');
  const payload = event.payload || {};
  const payment = (payload.payment && payload.payment.entity) || null;
  const order   = (payload.order && payload.order.entity) || null;
  const refund  = (payload.refund && payload.refund.entity) || null;

  const orderId = (payment && payment.order_id) || (order && order.id) || '';

  try {
    if (!orderId) return json({ ok: true, skipped: 'no order id' });

    if (type === 'payment.captured' || type === 'order.paid')
      return json({ ok: true, result: await fulfil(env, orderId, payment) });

    if (type === 'payment.failed')
      return json({ ok: true, skipped: 'attempt failed, order still open' });

    if (type === 'refund.created' || type === 'refund.processed')
      return json({ ok: true, result: await refunded(env, orderId, payment, refund) });

    if (type === 'payment.dispute.created')
      return json({ ok: true, result: await disputeOpened(env, orderId) });

    if (type === 'payment.dispute.lost') {
      const row = await rowFor(env, orderId, 'id,user_id,kind,plan,status');
      return json({ ok: true, result: row ? await reverseRow(env, row, 'refunded') : 'no ledger row' });
    }

    return json({ ok: true, skipped: type });
  } catch (err) {
    return json({ error: (err && err.message) || 'handler failed' }, 500);
  }
}
