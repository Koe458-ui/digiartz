import { sbUrl, sbSvc } from '../lib/sb.js';
import {
  PLAN_TIERS, applySubscription, revokeSubscription, recordEarning
} from '../lib/billing.js';
import { ppFee, toValue } from '../lib/money.js';

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
  if (!res.ok || !body.access_token) throw new Error('paypal auth failed');
  tokenCache = {
    key, token: body.access_token,
    expires: Date.now() + Math.max(60, (Number(body.expires_in) || 3600) - 60) * 1000,
  };
  return tokenCache.token;
}

async function pp(env, path, init = {}) {
  const res = await fetch(apiBase(env) + path, {
    ...init,
    headers: {
      authorization: 'Bearer ' + (await ppToken(env)),
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || 'paypal ' + res.status);
    err.issue = (body.details && body.details[0] && body.details[0].issue) || body.name || '';
    throw err;
  }
  return body;
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
  if (!res.ok) throw new Error('db ' + res.status);
  return body;
}

async function verified(env, request, headers, event) {
  const res = await pp(env, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo:         headers.get('paypal-auth-algo'),
      cert_url:          headers.get('paypal-cert-url'),
      transmission_id:   headers.get('paypal-transmission-id'),
      transmission_sig:  headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id:        env.PAYPAL_WEBHOOK_ID,
      webhook_event:     event,
    }),
  }).catch(() => null);
  return !!(res && res.verification_status === 'SUCCESS');
}

async function fulfil(env, orderId, capture) {
  const captureId = (capture && capture.id) || '';
  const rows = await sbService(env,
    '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
    '&select=id,user_id,kind,plan,item_id,amount,currency,status,promo_code_id&limit=1');
  const row = rows && rows[0];
  if (!row) return 'no ledger row';

  const paidAmount = (capture && capture.amount) || {};
  if (paidAmount.value != null && paidAmount.value !== toValue(row.amount, row.currency))
    return 'amount mismatch';
  if (paidAmount.currency_code && String(paidAmount.currency_code) !== String(row.currency))
    return 'currency mismatch';

  const patched = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.created', {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'paid',
      pp_capture_id: String(captureId),
      paid_at: new Date().toISOString(),
    }),
  });
  const first = Array.isArray(patched) && patched.length > 0;

  await recordEarning(env, 'paypal', row, {
    txn: capture && capture.id,
    amount: Math.round(parseFloat(paidAmount.value) * 100),
    currency: paidAmount.currency_code,
    fee: ppFee(capture, row.currency),
  });

  if (!first) return 'already settled';

  if (row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await applySubscription(env, row.user_id, PLAN_TIERS[row.plan]);
  }
  return 'settled';
}

async function reverse(env, orderId, status) {
  const rows = await sbService(env,
    '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
    '&select=id,user_id,kind,plan,status&limit=1');
  const row = rows && rows[0];
  if (!row) return 'no ledger row';

  const from = status === 'failed' ? '&status=in.(created,paid)' : '&status=eq.paid';
  const patched = await sbService(env, '/payments?id=eq.' + row.id + from, {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
  if (!(Array.isArray(patched) && patched.length)) return 'nothing to reverse';

  if (row.status !== 'paid') return status;

  await sbService(env, '/marketplace_earnings?payment_id=eq.' + row.id +
    '&status=in.(pending,available)', {
    method: 'PATCH', body: JSON.stringify({ status: 'reversed' }),
  }).catch(() => {});

  if (status === 'refunded' && row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await revokeSubscription(env, row.user_id).catch(() => {});
  }
  return status;
}

export async function onRequestPost({ env, request }) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID ||
      !sbUrl(env) || !sbSvc(env))
    return json({ error: 'not configured' }, 503);

  let event;
  try { event = await request.json(); } catch { return json({ error: 'bad body' }, 400); }

  if (!(await verified(env, request, request.headers, event)))
    return json({ error: 'signature check failed' }, 401);

  const type     = String(event.event_type || '');
  const resource = event.resource || {};
  const related  = (resource.supplementary_data && resource.supplementary_data.related_ids) || {};
  const orderId  = related.order_id || (type.startsWith('CHECKOUT.ORDER.') ? resource.id : '');

  try {
    if (type.startsWith('PAYMENTS.PAYOUTS-ITEM.'))
      return json({ ok: true, result: await payoutItem(env, type, resource) });

    if (!orderId) return json({ ok: true, skipped: 'no order id' });

    if (type === 'CHECKOUT.ORDER.APPROVED') {
      const open = await sbService(env,
        '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
        '&status=eq.created&select=id&limit=1');
      if (!(open && open.length)) return json({ ok: true, skipped: 'nothing open' });

      let captured;
      try {
        captured = await pp(env, '/v2/checkout/orders/' + orderId + '/capture', {
          method: 'POST', headers: { 'paypal-request-id': 'cap_' + orderId }, body: '{}',
        });
      } catch (err) {
        if (err.issue !== 'ORDER_ALREADY_CAPTURED') throw err;
        captured = await pp(env, '/v2/checkout/orders/' + orderId);
      }
      const unit = (captured.purchase_units && captured.purchase_units[0]) || {};
      const cap  = (unit.payments && unit.payments.captures && unit.payments.captures[0]) || {};
      if (captured.status !== 'COMPLETED') return json({ ok: true, skipped: 'not complete' });
      return json({ ok: true, result: await fulfil(env, orderId, cap) });
    }

    if (type === 'PAYMENT.CAPTURE.COMPLETED')
      return json({ ok: true, result: await fulfil(env, orderId, resource) });

    if (type === 'PAYMENT.CAPTURE.REFUNDED')
      return json({ ok: true, result: await reverse(env, orderId, 'refunded') });

    if (type === 'PAYMENT.CAPTURE.REVERSED')
      return json({ ok: true, result: await reverse(env, orderId, 'refunded') });

    if (type === 'PAYMENT.CAPTURE.DENIED')
      return json({ ok: true, result: await reverse(env, orderId, 'failed') });

    return json({ ok: true, skipped: type });
  } catch (err) {
    return json({ error: (err && err.message) || 'handler failed' }, 500);
  }
}

async function payoutItem(env, type, resource) {
  const id = String((resource && resource.sender_item_id) || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return 'no request id';

  const rows = await sbService(env,
    '/payout_requests?id=eq.' + id + '&select=id,user_id,amount,currency,status&limit=1');
  const req = rows && rows[0];
  if (!req) return 'no such request';

  if (type === 'PAYMENTS.PAYOUTS-ITEM.SUCCEEDED') {
    await sbService(env, '/payout_requests?id=eq.' + id + '&status=eq.processing', {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'paid',
        paid_at: new Date().toISOString(),
        provider_item_id: String((resource && resource.payout_item_id) || ''),
      }),
    });
    return 'paid';
  }

  if (type === 'PAYMENTS.PAYOUTS-ITEM.UNCLAIMED') {
    await sbService(env, '/payout_requests?id=eq.' + id, {
      method: 'PATCH',
      body: JSON.stringify({ review_note: 'Sent, waiting for the recipient to claim it' }),
    }).catch(() => {});
    return 'unclaimed';
  }

  const note = {
    'PAYMENTS.PAYOUTS-ITEM.FAILED':   'PayPal could not send this item',
    'PAYMENTS.PAYOUTS-ITEM.BLOCKED':  'PayPal blocked this item',
    'PAYMENTS.PAYOUTS-ITEM.RETURNED': 'Unclaimed and returned by PayPal',
    'PAYMENTS.PAYOUTS-ITEM.DENIED':   'PayPal denied this item',
    'PAYMENTS.PAYOUTS-ITEM.REFUNDED': 'This payout was refunded back to us',
  }[type] || 'This payout did not complete';

  await sbService(env, '/payout_requests?id=eq.' + id + '&status=in.(processing,paid)', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', review_note: note, paid_at: null }),
  });
  await sbService(env,
    '/marketplace_earnings?seller_id=eq.' + req.user_id +
    '&currency=eq.' + req.currency + '&status=eq.paid_out', {
    method: 'PATCH', body: JSON.stringify({ status: 'available' }),
  }).catch(() => {});
  return 'returned to approved';
}
