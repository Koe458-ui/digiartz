// razorpay webhook receiver
//
// Razorpay calls this; no user session is involved, so nothing here may be
// trusted on arrival. Every event is checked against RAZORPAY_WEBHOOK_SECRET
// before a single row is touched, and the endpoint fails CLOSED — with no
// secret bound it refuses everything rather than accepting unsigned events.
// That matters more than usual: a forged payment.captured would hand out a
// subscription, or credit a seller for a sale that never happened.
//
// Why this exists at all, when functions/api/rzp.js already verifies a payment
// the browser hands back: the browser is not reliable. A buyer who closes the
// tab between paying and the handler firing, a dropped connection, a phone that
// sleeps — Razorpay took the money in every one of those cases and our ledger
// row would sit at 'created' forever. This is the settlement of record. It is
// also the only way we ever hear about a refund or a chargeback, which happen
// days later with no browser involved at all.
//
// REGISTERING IT
//   Razorpay Dashboard -> Settings -> Webhooks -> Add New Webhook
//   URL:    https://digiartz.net/api/rzp-webhook
//   Secret: any long random string. Paste the SAME string into the Pages
//           project as RAZORPAY_WEBHOOK_SECRET. It is not the API key secret
//           and not something Razorpay generates — you choose it, and the two
//           sides must match exactly or every event is rejected as forged.
//   Active events (tick these):
//     payment.captured        the settlement of record
//     payment.failed          never went through
//     order.paid              the order's own confirmation, same outcome
//     refund.created          money on its way back
//     refund.processed        money returned
//     payment.dispute.created a chargeback was opened
//     payment.dispute.lost    the chargeback went against us
//
// Anything else is signature-checked and then ignored, so subscribing to more
// costs nothing but noise.
//
// Money going OUT is not handled here. Payouts are sent through PayPal only
// (see functions/api/payouts.js — a UPI or bank method is recorded and paid by
// hand), so there is no RazorpayX batch whose fate we would need to hear about.
// If that ever changes, payout events belong in this file next to the rest.

import { sbUrl, sbSvc, ledger } from '../lib/sb.js';
import { PLAN_TIERS, applySubscription } from '../lib/billing.js';

// The commission, the TDS, the GST TCS and the settlement date are worked out
// by dz_earning_apply_deductions() in Postgres, not here. This file reports
// two facts and does no arithmetic on money: what the buyer paid, and what
// Razorpay took out of it before it reached us.

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

// ---------------------------------------------------------------------------
// Did Razorpay really send this?
//
// The signature is an HMAC-SHA256 of the RAW request body, hex encoded, under
// the webhook secret. Raw is the operative word: JSON.parse followed by
// JSON.stringify produces a byte-for-byte different document and every event
// would read as forged. The body is read once as text, checked, and only then
// parsed.
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

// A marketplace sale owes the seller their share. Written once per payment —
// the unique constraint on payment_id is what makes a replayed webhook a no-op
// rather than a second credit.
async function recordEarning(env, row, prov) {
  if (row.kind !== 'marketplace' || !row.item_id) return;

  const items = await sbService(env,
    '/marketplace_items?id=eq.' + row.item_id + '&select=user_id&limit=1');
  const sellerId = items && items[0] && items[0].user_id;
  if (!sellerId || sellerId === row.user_id) return;   // no seller, or self-purchase

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
  }).catch(() => null);   // duplicate is the expected outcome on a replay

  // Only a real insert reaches the ledger. This path runs on every replayed
  // webhook and on top of the browser's own verify call, and ledger_entries is
  // append-only with no unique key — an append that ran twice could not be
  // taken back, the two records would disagree, and dz_reconcile would freeze
  // an honest seller's withdrawals permanently.
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

// our own row, found by the order id we wrote when checkout opened
async function rowFor(env, orderId, select) {
  const rows = await sbService(env,
    '/payments?rzp_order_id=eq.' + encodeURIComponent(orderId) +
    '&provider=eq.razorpay&select=' + select + '&limit=1');
  return (rows && rows[0]) || null;
}

// ---------------------------------------------------------------------------
// settle a ledger row, once
async function fulfil(env, orderId, payment) {
  const row = await rowFor(env, orderId,
    'id,user_id,kind,plan,item_id,amount,currency,status,promo_code_id');
  if (!row) return 'no ledger row';

  // What Razorpay says it took must be what we asked for. The order was priced
  // server-side and Razorpay cannot take a different amount against it, so a
  // mismatch here means something is wrong enough not to fulfil on.
  const paid = Number(payment && payment.amount);
  const cur  = String((payment && payment.currency) || '');
  if (Number.isFinite(paid) && paid !== Number(row.amount)) return 'amount mismatch';
  if (cur && cur !== String(row.currency)) return 'currency mismatch';

  // Only the created -> paid transition returns a row, so a replayed event —
  // or the browser having already verified this same payment through
  // /api/rzp — fulfils nothing twice.
  const patched = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.created', {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'paid',
      rzp_payment_id: String((payment && payment.id) || ''),
      paid_at: new Date().toISOString(),
    }),
  });
  const first = Array.isArray(patched) && patched.length > 0;

  // Earnings are recorded even on a replay: the browser may have settled the
  // row already without ever getting this far, and the write is idempotent.
  await recordEarning(env, row, {
    txn: (payment && payment.id) || null,
    amount: Number.isFinite(paid) ? paid : null,
    currency: cur || row.currency,
    // Razorpay reports its own cut on the payment entity. `fee` is the whole
    // deduction including the GST on it — the part that never arrives — so
    // that is the figure recorded rather than any rate-card estimate.
    fee: Number(payment && payment.fee) || 0,
  });

  if (!first) return 'already settled';

  if (row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await applySubscription(env, row.user_id, PLAN_TIERS[row.plan]);
  }
  return 'settled';
}

// money went back
//
// Only a row standing at 'paid' can be reversed, and that filter is the whole
// safety of this function. It is also why nothing here is reachable from
// payment.failed — see the note at the dispatch below.
async function reverseRow(env, row, status) {
  const patched = await sbService(env, '/payments?id=eq.' + row.id + '&status=eq.paid', {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
  if (!(Array.isArray(patched) && patched.length)) return 'not a settled payment';

  // The seller must not keep a claim on money the buyer took back. Anything
  // already paid out is left alone — that is a debt to chase, not a row to
  // rewrite.
  await sbService(env, '/marketplace_earnings?payment_id=eq.' + row.id +
    '&status=in.(pending,available)', {
    method: 'PATCH', body: JSON.stringify({ status: 'reversed' }),
  }).catch(() => {});

  // A refunded subscription stops being a subscription.
  if (row.kind === 'subscription' && PLAN_TIERS[row.plan]) {
    await sbService(env, '/profiles?id=eq.' + row.user_id, {
      method: 'PATCH',
      body: JSON.stringify({ subscription_tier: null, subscription_expires_at: null }),
    }).catch(() => {});
  }
  return status;
}

// A PART of the money coming back is not the sale coming undone. A seller who
// refunds ten percent as a goodwill gesture has not un-sold the files, and
// revoking the buyer's download over it would be wrong. Razorpay keeps a
// running amount_refunded on the payment, so the question "is this sale over?"
// has one honest answer and it is not the size of this particular refund.
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

// A chargeback is not a refund yet — it is someone asking for one, and the
// money is still ours until it is decided. The sale stays paid so the buyer
// keeps what they bought while it is contested; what changes is that the
// seller's half stops being withdrawable, because paying it out and then
// losing the dispute is how a platform ends up down the money twice.
async function disputeOpened(env, orderId) {
  const row = await rowFor(env, orderId, 'id,user_id,kind');
  if (!row) return 'no ledger row';
  await sbService(env, '/marketplace_earnings?payment_id=eq.' + row.id + '&status=eq.available', {
    method: 'PATCH', body: JSON.stringify({ status: 'pending' }),
  }).catch(() => {});
  return 'held pending dispute';
}

// ---------------------------------------------------------------------------
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

  // Every event we act on names an order: a payment carries its order_id, and
  // an order event is its own id.
  const orderId = (payment && payment.order_id) || (order && order.id) || '';

  try {
    if (!orderId) return json({ ok: true, skipped: 'no order id' });

    if (type === 'payment.captured' || type === 'order.paid')
      return json({ ok: true, result: await fulfil(env, orderId, payment) });

    // payment.failed is deliberately a no-op on the ledger row, and that is
    // not laziness.
    //
    // A Razorpay order survives a failed attempt: the buyer's card is declined,
    // they switch to UPI, and the SECOND payment against the SAME order id
    // succeeds. Writing 'failed' on the first event would take the row out of
    // 'created', and every path that settles it — this webhook and the
    // browser's verify call alike — only moves a row from 'created' to 'paid'.
    // The buyer would pay and get nothing. An abandoned checkout resting at
    // 'created' costs nothing and unlocks nothing, which is the right way to
    // be wrong here.
    if (type === 'payment.failed')
      return json({ ok: true, skipped: 'attempt failed, order still open' });

    if (type === 'refund.created' || type === 'refund.processed')
      return json({ ok: true, result: await refunded(env, orderId, payment, refund) });

    if (type === 'payment.dispute.created')
      return json({ ok: true, result: await disputeOpened(env, orderId) });

    // Lost is the chargeback actually taken back off us. Same outcome as a
    // refund: the sale is over, and the seller's claim on it goes with it.
    if (type === 'payment.dispute.lost') {
      const row = await rowFor(env, orderId, 'id,user_id,kind,plan,status');
      return json({ ok: true, result: row ? await reverseRow(env, row, 'refunded') : 'no ledger row' });
    }

    return json({ ok: true, skipped: type });
  } catch (err) {
    // A 500 tells Razorpay to retry, which is what we want for a transient
    // database failure — every handler above is idempotent.
    return json({ error: (err && err.message) || 'handler failed' }, 500);
  }
}
