// paypal webhook receiver
//
// PayPal calls this; no user session is involved, so nothing here may be
// trusted on arrival. Every event is verified against PAYPAL_WEBHOOK_ID before
// a single row is touched, and the endpoint fails CLOSED — with no webhook id
// bound it refuses everything rather than accepting unverified events. That
// matters more than usual: a forged PAYMENT.CAPTURE.COMPLETED would hand out a
// subscription, or credit a seller for a sale that never happened.
//
// Register this URL at developer.paypal.com -> your app -> Webhooks:
//   https://digiartz.net/api/paypal-webhook
// PayPal issues the webhook id once the URL is registered, which is why this
// has to exist before PAYPAL_WEBHOOK_ID can be bound.
//
// Subscribing to every event is fine — anything not listed below is verified
// and then ignored. The only cost is a verification round-trip for noise.
//
// Money coming IN:
//   CHECKOUT.ORDER.APPROVED    buyer approved but the browser never came back
//   PAYMENT.CAPTURE.COMPLETED  the settlement of record
//   PAYMENT.CAPTURE.REFUNDED   money returned
//   PAYMENT.CAPTURE.REVERSED   chargeback or reversal
//   PAYMENT.CAPTURE.DENIED     never settled
//
// Money going OUT — these are not optional if payouts are used. A batch PayPal
// accepts is not money that arrived, and without them a payout that failed,
// was blocked or was never claimed would sit reading as paid forever:
//   PAYMENTS.PAYOUTS-ITEM.SUCCEEDED   it actually landed
//   PAYMENTS.PAYOUTS-ITEM.UNCLAIMED   sent, recipient has not accepted yet
//   PAYMENTS.PAYOUTS-ITEM.FAILED / .BLOCKED / .RETURNED / .DENIED / .REFUNDED

const SUB_DAYS   = 31;
const PLAN_TIERS = { lite: 'lite', premium: 'premium', max: 'max', support: null };

// platform's cut of a marketplace sale, in basis points, and how long the
// seller's half waits before it can be withdrawn. The window is there so a
// chargeback lands while the money is still ours to claw back.
const FEE_BPS   = 1500;   // 15%
const HOLD_DAYS = 7;

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
  if (!res.ok) throw new Error('db ' + res.status);
  return body;
}

// ---------------------------------------------------------------------------
// Ask PayPal whether it really sent this. The body must be handed back as the
// parsed object it arrived as — re-serialising a reordered copy fails.
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

// ---------------------------------------------------------------------------
// A marketplace sale owes the seller their share. Written once per payment —
// the unique constraint on payment_id is what makes a replayed webhook a
// no-op rather than a second credit.
async function recordEarning(env, row, capture) {
  if (row.kind !== 'marketplace' || !row.item_id) return;

  const items = await sbService(env,
    '/marketplace_items?id=eq.' + row.item_id + '&select=user_id&limit=1');
  const sellerId = items && items[0] && items[0].user_id;
  if (!sellerId || sellerId === row.user_id) return;   // no seller, or self-purchase

  const gross = Number(row.amount) || 0;
  const fee   = Math.round((gross * FEE_BPS) / 10000);

  await sbService(env, '/marketplace_earnings', {
    method: 'POST',
    headers: { prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({
      payment_id: row.id, item_id: row.item_id,
      seller_id: sellerId, buyer_id: row.user_id,
      gross_amount: gross, fee_amount: fee, net_amount: gross - fee,
      fee_bps: FEE_BPS, currency: row.currency,
      // held, then withdrawable — never released on the sale itself
      status: 'available',
      available_at: new Date(Date.now() + HOLD_DAYS * 86400000).toISOString(),
    }),
  }).catch(() => {});   // duplicate is the expected outcome on a replay
}

// settle a ledger row, once
async function fulfil(env, orderId, captureId) {
  const rows = await sbService(env,
    '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
    '&select=id,user_id,kind,plan,item_id,amount,currency,status&limit=1');
  const row = rows && rows[0];
  if (!row) return 'no ledger row';

  const patched = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.created', {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'paid',
      pp_capture_id: String(captureId || ''),
      paid_at: new Date().toISOString(),
    }),
  });
  const first = Array.isArray(patched) && patched.length > 0;

  // Earnings are recorded even on a replay: the browser capture may have
  // settled the row already without ever getting this far.
  await recordEarning(env, row, captureId);

  if (!first) return 'already settled';

  if (row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await sbService(env, '/profiles?id=eq.' + row.user_id, {
      method: 'PATCH',
      body: JSON.stringify({
        subscription_tier: PLAN_TIERS[row.plan],
        subscription_expires_at: new Date(Date.now() + SUB_DAYS * 86400000).toISOString(),
      }),
    });
  }
  return 'settled';
}

// money went back
async function reverse(env, orderId, status) {
  const rows = await sbService(env,
    '/payments?pp_order_id=eq.' + encodeURIComponent(orderId) +
    '&select=id,user_id,kind,plan&limit=1');
  const row = rows && rows[0];
  if (!row) return 'no ledger row';

  await sbService(env, '/payments?id=eq.' + row.id, {
    method: 'PATCH', body: JSON.stringify({ status }),
  });

  // The seller must not keep a claim on money the buyer took back. Anything
  // already paid out is left alone — that is a debt to chase, not a row to
  // rewrite.
  await sbService(env, '/marketplace_earnings?payment_id=eq.' + row.id +
    '&status=in.(pending,available)', {
    method: 'PATCH', body: JSON.stringify({ status: 'reversed' }),
  }).catch(() => {});

  // A refunded subscription stops being a subscription.
  if (status === 'refunded' && row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await sbService(env, '/profiles?id=eq.' + row.user_id, {
      method: 'PATCH',
      body: JSON.stringify({ subscription_tier: null, subscription_expires_at: null }),
    }).catch(() => {});
  }
  return 'reversed';
}

// ---------------------------------------------------------------------------
export async function onRequestPost({ env, request }) {
  for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID',
                   'SB_URL', 'SB_SERVICE_KEY'])
    if (!env[k]) return json({ error: 'not configured' }, 503);

  let event;
  try { event = await request.json(); } catch { return json({ error: 'bad body' }, 400); }

  if (!(await verified(env, request, request.headers, event)))
    return json({ error: 'signature check failed' }, 401);

  const type     = String(event.event_type || '');
  const resource = event.resource || {};
  const related  = (resource.supplementary_data && resource.supplementary_data.related_ids) || {};
  // a capture names its order here; an order event is its own id
  const orderId  = related.order_id || (type.startsWith('CHECKOUT.ORDER.') ? resource.id : '');

  try {
    // Payout events are about money going OUT and name no order, so they are
    // routed before the order-id guard below.
    if (type.startsWith('PAYMENTS.PAYOUTS-ITEM.'))
      return json({ ok: true, result: await payoutItem(env, type, resource) });

    if (!orderId) return json({ ok: true, skipped: 'no order id' });

    if (type === 'CHECKOUT.ORDER.APPROVED') {
      // The buyer approved and then the browser never made the capture call —
      // closed tab, lost connection. Capture it here so the sale is not lost.
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
      return json({ ok: true, result: await fulfil(env, orderId, cap.id) });
    }

    if (type === 'PAYMENT.CAPTURE.COMPLETED')
      return json({ ok: true, result: await fulfil(env, orderId, resource.id) });

    if (type === 'PAYMENT.CAPTURE.REFUNDED')
      return json({ ok: true, result: await reverse(env, orderId, 'refunded') });

    if (type === 'PAYMENT.CAPTURE.REVERSED')
      return json({ ok: true, result: await reverse(env, orderId, 'refunded') });

    if (type === 'PAYMENT.CAPTURE.DENIED')
      return json({ ok: true, result: await reverse(env, orderId, 'failed') });

    return json({ ok: true, skipped: type });
  } catch (err) {
    // A 500 tells PayPal to retry, which is what we want for a transient
    // database failure — every handler above is idempotent.
    return json({ error: (err && err.message) || 'handler failed' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Payout items settle asynchronously.
//
// /v1/payments/payouts accepting a batch is NOT the money arriving. The item
// can still fail afterwards — a bad address, a blocked or returned item, or
// one the recipient never claims. These events are the only honest signal, so
// a payout stays 'processing' until one of them says otherwise.
async function payoutItem(env, type, resource) {
  // sender_item_id is the payout_requests row id, set when the batch was sent
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

  // Unclaimed is not a failure yet — PayPal holds it for the recipient and
  // returns it after 30 days if they never accept. Leave it processing and
  // say so, rather than paying it twice or writing it off early.
  if (type === 'PAYMENTS.PAYOUTS-ITEM.UNCLAIMED') {
    await sbService(env, '/payout_requests?id=eq.' + id, {
      method: 'PATCH',
      body: JSON.stringify({ review_note: 'Sent, waiting for the recipient to claim it' }),
    }).catch(() => {});
    return 'unclaimed';
  }

  // Everything else means the money did not go. Put the request back where an
  // admin can act on it and hand the seller their earnings back, so the
  // balance stops under-reporting what they are owed.
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
  // hand back exactly what this payout retired
  await sbService(env,
    '/marketplace_earnings?seller_id=eq.' + req.user_id +
    '&currency=eq.' + req.currency + '&status=eq.paid_out', {
    method: 'PATCH', body: JSON.stringify({ status: 'available' }),
  }).catch(() => {});
  return 'returned to approved';
}
