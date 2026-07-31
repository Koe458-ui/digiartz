// marketplace payouts
//
// A seller's earnings are a RECORD, not a wallet. The buyer's money is in the
// platform's provider account; this endpoint is what moves some of it out.
// Everything that decides an amount happens here on the service role — the
// browser only ever names an amount it would like, and is checked against the
// ledger before anything is written.
//
// Seller actions:  method, request, cancel
// Admin actions:   admin-list, admin-decide, admin-send
//
// Environment: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV, plus the
// usual SB_URL / SB_KEY / SB_SERVICE_KEY.
//
// NOTE ON admin-send: the PayPal Payouts API has to be enabled on the merchant
// account by PayPal — it is not on by default. Until it is, that call returns
// the provider's own refusal and the request stays 'approved', which is the
// correct resting place: reviewed, owed, not yet sent. Everything up to that
// point works without the approval.

const MIN_PAYOUT = 1000;   // ten dollars, in minor units — below this the fees eat it

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const apiBase = (env) =>
  String(env.PAYPAL_ENV || '').trim().toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);
const toValue = (minor, cur) =>
  ZERO_DECIMAL.has(cur) ? String(minor) : (minor / 100).toFixed(2);

// rough shape check; PayPal does the real validation
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

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
  if (!res.ok || !body.access_token) throw new Error('Payment provider rejected our credentials');
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
    const err = new Error(
      body.message ||
      (body.details && body.details[0] && body.details[0].description) ||
      'Payout provider error (' + res.status + ')'
    );
    err.name_ = body.name || '';
    throw err;
  }
  return body;
}

// RPC as the CALLER, not the service role — dz_wallet_summary reads auth.uid()
// and must answer for whoever asked, never for everyone.
async function sbRpc(env, request, fn, args = {}) {
  const res = await fetch(env.SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: env.SB_KEY,
      authorization: request.headers.get('authorization') || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

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

async function isAdmin(env, userId) {
  const rows = await sbService(env, '/profiles?id=eq.' + userId + '&select=role&limit=1');
  return !!(rows && rows[0] && rows[0].role === 'admin');
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

// ---------------------------------------------------------------------------
// What this seller may actually withdraw, computed from the ledger rather than
// trusted from the caller. Mirrors dz_seller_balance(), but on the service role
// so it can be relied on for a write.
async function withdrawable(env, userId) {
  const earnings = await sbService(env,
    '/marketplace_earnings?seller_id=eq.' + userId +
    '&status=eq.available&available_at=lte.' + new Date().toISOString() +
    '&select=net_amount,currency');

  const open = await sbService(env,
    '/payout_requests?user_id=eq.' + userId +
    '&status=in.(requested,approved,processing)&select=amount,currency');

  const by = {};
  for (const e of earnings || []) {
    by[e.currency] = (by[e.currency] || 0) + Number(e.net_amount || 0);
  }
  for (const r of open || []) {
    by[r.currency] = (by[r.currency] || 0) - Number(r.amount || 0);
  }
  for (const k of Object.keys(by)) if (by[k] < 0) by[k] = 0;
  return by;
}

// ---------------------------------------------------------------------------
export async function onRequestPost({ env, request }) {
  for (const k of ['SB_URL', 'SB_KEY', 'SB_SERVICE_KEY'])
    if (!env[k]) return json({ error: 'Not configured' }, 503);

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Sign in required' }, 401);

  // Tighter than checkout: reading the wallet is cheap, but requesting a
  // payout or adding an instrument should never happen at speed, and a race
  // between two payout requests is exactly what this shuts.
  if (!(await underLimit(env, 'po:' + user.id, 20, 60)))
    return json({ error: 'Too many attempts — wait a moment' }, 429);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    // ---- wallet: everything the two profile sections read -----------------
    // One call, so the wallet cannot show a balance from one moment and a
    // history from another. Every figure is computed from the ledger here or
    // in dz_wallet_summary(); nothing is totalled in the browser.
    if (body.action === 'overview') {
      const [summary, history, methods] = await Promise.all([
        sbRpc(env, request, 'dz_wallet_summary'),
        sbService(env, '/wallet_history?user_id=eq.' + user.id +
          '&order=happened_at.desc&limit=100' +
          '&select=id,direction,category,title,amount,currency,status,provider,transaction_id,happened_at'),
        sbService(env, '/payout_methods?user_id=eq.' + user.id +
          '&order=is_default.desc,created_at.asc' +
          '&select=id,provider,kind,label,paypal_email,upi_vpa,holder_name,bank_name,bank_last4,bank_ifsc,is_default,verified'),
      ]);
      const payouts = await sbService(env,
        '/payout_requests?user_id=eq.' + user.id +
        '&order=requested_at.desc&limit=50' +
        '&select=id,amount,currency,status,destination,review_note,requested_at,paid_at');

      return json({
        ok: true,
        summary: summary || null,
        history: history || [],
        methods: methods || [],
        payouts: payouts || [],
        withdrawable: await withdrawable(env, user.id),
      });
    }

    // ---- bank details: add an instrument ---------------------------------
    // Nothing raw is accepted. A card number or a full account number sent
    // here is rejected rather than stored — see the note at the top of the
    // migration for why that line is where it is.
    if (body.action === 'method-add') {
      const kind = String(body.kind || '');
      const label = String(body.label || '').slice(0, 40) || null;
      let row = { user_id: user.id, kind, label, is_default: false };

      if (kind === 'paypal_email') {
        const email = String(body.paypalEmail || '').trim();
        if (!EMAIL_RE.test(email))
          return json({ error: 'That does not look like an email address' }, 400);
        row.provider = 'paypal';
        row.paypal_email = email;

      } else if (kind === 'upi') {
        const vpa = String(body.upi || '').trim().toLowerCase();
        if (!/^[a-z0-9.\-_]{2,64}@[a-z][a-z0-9.\-]{1,40}$/.test(vpa))
          return json({ error: 'That does not look like a UPI ID' }, 400);
        row.provider = 'razorpay';
        row.upi_vpa = vpa;

      } else if (kind === 'bank_account') {
        const holder = String(body.holderName || '').trim().slice(0, 80);
        const acct   = String(body.accountNumber || '').replace(/\s+/g, '');
        const ifsc   = String(body.ifsc || '').trim().toUpperCase();
        if (holder.length < 2) return json({ error: 'Account holder name is required' }, 400);
        if (!/^[0-9]{6,20}$/.test(acct)) return json({ error: 'That does not look like an account number' }, 400);
        if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))
          return json({ error: 'That does not look like an IFSC code' }, 400);
        row.provider    = 'razorpay';
        row.holder_name = holder;
        row.bank_name   = String(body.bankName || '').trim().slice(0, 80) || null;
        row.bank_ifsc   = ifsc || null;
        // THE ACCOUNT NUMBER IS NOT STORED. Four digits for the seller to
        // recognise the row by, and nothing that could be used to move money.
        row.bank_last4  = acct.slice(-4);

      } else {
        return json({ error: 'Unknown payout method' }, 400);
      }

      const existing = await sbService(env,
        '/payout_methods?user_id=eq.' + user.id + '&select=id&limit=6');
      if (existing && existing.length >= 5)
        return json({ error: 'You can keep up to five payout methods' }, 400);
      row.is_default = !(existing && existing.length);   // first one wins by default

      const made = await sbService(env, '/payout_methods', {
        method: 'POST', body: JSON.stringify(row),
      });
      return json({ ok: true, method: made && made[0] });
    }

    if (body.action === 'method-remove') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
      // not while money is on its way to it
      const open = await sbService(env,
        '/payout_requests?user_id=eq.' + user.id +
        '&status=in.(requested,approved,processing)&select=id&limit=1');
      if (open && open.length)
        return json({ error: 'You have a payout in progress — wait for it to finish' }, 400);
      await sbService(env, '/payout_methods?id=eq.' + id + '&user_id=eq.' + user.id,
        { method: 'DELETE' });
      return json({ ok: true });
    }

    if (body.action === 'method-default') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad id' }, 400);
      // the partial unique index allows only one, so clear before setting
      await sbService(env, '/payout_methods?user_id=eq.' + user.id + '&is_default=is.true',
        { method: 'PATCH', body: JSON.stringify({ is_default: false }) });
      const rows = await sbService(env, '/payout_methods?id=eq.' + id + '&user_id=eq.' + user.id,
        { method: 'PATCH', body: JSON.stringify({ is_default: true }) });
      if (!(Array.isArray(rows) && rows.length)) return json({ error: 'No such method' }, 404);
      return json({ ok: true });
    }

    // ---- seller: what is mine, and what can I take ------------------------
    if (body.action === 'balance') {
      return json({ ok: true, withdrawable: await withdrawable(env, user.id) });
    }

    // ---- seller: ask for a payout ----------------------------------------
    if (body.action === 'request') {
      const currency = String(body.currency || 'USD').toUpperCase();
      const amount   = Math.round(Number(body.amount));
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Bad amount' }, 400);

      // paid to the default instrument, snapshotted onto the request so a
      // later edit cannot rewrite where past money went
      const methods = await sbService(env,
        '/payout_methods?user_id=eq.' + user.id + '&is_default=is.true' +
        '&select=kind,paypal_email,upi_vpa,bank_last4&limit=1');
      const m = methods && methods[0];
      const dest = m && (m.paypal_email || m.upi_vpa ||
                         (m.bank_last4 ? 'bank ****' + m.bank_last4 : null));
      if (!dest) return json({ error: 'Add a payout method before requesting a payout' }, 400);
      if (m.kind !== 'paypal_email')
        return json({ error: 'Only PayPal payouts can be sent automatically right now' }, 400);

      const avail = (await withdrawable(env, user.id))[currency] || 0;
      if (amount > avail)
        return json({ error: 'You can withdraw at most ' + toValue(avail, currency) + ' ' + currency }, 400);
      if (amount < MIN_PAYOUT)
        return json({ error: 'Minimum payout is ' + toValue(MIN_PAYOUT, currency) + ' ' + currency }, 400);

      const rows = await sbService(env, '/payout_requests', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user.id, amount, currency,
          method: 'paypal', destination: dest, status: 'requested',
        }),
      });
      return json({ ok: true, request: rows && rows[0] });
    }

    // ---- seller: change their mind ---------------------------------------
    if (body.action === 'cancel') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad request id' }, 400);
      // only while nobody has acted on it
      const rows = await sbService(env,
        '/payout_requests?id=eq.' + id + '&user_id=eq.' + user.id + '&status=eq.requested', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected', review_note: 'Cancelled by the seller',
                               decided_at: new Date().toISOString() }),
      });
      if (!(Array.isArray(rows) && rows.length))
        return json({ error: 'That request can no longer be cancelled' }, 400);
      return json({ ok: true });
    }

    // ---- everything below is admin ---------------------------------------
    if (!String(body.action || '').startsWith('admin-'))
      return json({ error: 'Unknown action' }, 400);
    if (!(await isAdmin(env, user.id))) return json({ error: 'Not allowed' }, 403);

    if (body.action === 'admin-list') {
      const status = String(body.status || 'requested');
      if (!/^[a-z,]{1,60}$/.test(status)) return json({ error: 'Bad filter' }, 400);
      const rows = await sbService(env,
        '/payout_requests?status=in.(' + status + ')' +
        '&select=*&order=requested_at.asc&limit=200');
      return json({ ok: true, requests: rows || [] });
    }

    // Approve or reject. Approving does not send money — that is admin-send,
    // deliberately a separate act.
    if (body.action === 'admin-decide') {
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad request id' }, 400);
      const approve = !!body.approve;

      // Re-check the balance at decision time: refunds and chargebacks between
      // the request and the review can have taken the money back.
      const reqs = await sbService(env,
        '/payout_requests?id=eq.' + id + '&status=eq.requested&select=*&limit=1');
      const req = reqs && reqs[0];
      if (!req) return json({ error: 'No such open request' }, 404);

      if (approve) {
        const earned = await sbService(env,
          '/marketplace_earnings?seller_id=eq.' + req.user_id +
          '&status=eq.available&currency=eq.' + req.currency +
          '&available_at=lte.' + new Date().toISOString() + '&select=net_amount');
        const total = (earned || []).reduce((n, e) => n + Number(e.net_amount || 0), 0);
        if (total < Number(req.amount))
          return json({ error: 'Balance has fallen below the requested amount — reject or ask them to re-request' }, 400);
      }

      const rows = await sbService(env, '/payout_requests?id=eq.' + id + '&status=eq.requested', {
        method: 'PATCH',
        body: JSON.stringify({
          status: approve ? 'approved' : 'rejected',
          review_note: String(body.note || '').slice(0, 500) || null,
          decided_at: new Date().toISOString(),
        }),
      });
      return json({ ok: true, request: rows && rows[0] });
    }

    // Actually send it.
    if (body.action === 'admin-send') {
      for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'])
        if (!env[k]) return json({ error: 'PayPal is not configured (' + k + ' missing)' }, 503);

      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Bad request id' }, 400);

      // Claim it first. Only the transition out of 'approved' returns a row, so
      // two admins pressing send at the same moment cannot pay twice.
      const claimed = await sbService(env, '/payout_requests?id=eq.' + id + '&status=eq.approved', {
        method: 'PATCH', body: JSON.stringify({ status: 'processing' }),
      });
      const req = Array.isArray(claimed) && claimed[0];
      if (!req) return json({ error: 'That request is not approved and waiting' }, 400);

      const batchId = 'dzpo_' + req.id.slice(0, 8) + '_' + Date.now();
      try {
        const out = await pp(env, '/v1/payments/payouts', {
          method: 'POST',
          headers: { 'paypal-request-id': batchId },
          body: JSON.stringify({
            sender_batch_header: {
              sender_batch_id: batchId,
              email_subject: 'Your DigiArtz payout',
              email_message: 'Your marketplace earnings have been sent.',
            },
            items: [{
              recipient_type: 'EMAIL',
              receiver: req.destination,
              amount: { value: toValue(req.amount, req.currency), currency: req.currency },
              note: 'DigiArtz marketplace earnings',
              sender_item_id: req.id,
            }],
          }),
        });

        const bid = (out.batch_header && out.batch_header.payout_batch_id) || batchId;

        // Retire exactly the earnings this payout covers, oldest first, so the
        // same money cannot be requested twice while the item is in flight.
        // PAYMENTS.PAYOUTS-ITEM.* hands them back if the item never lands.
        const earned = await sbService(env,
          '/marketplace_earnings?seller_id=eq.' + req.user_id +
          '&status=eq.available&currency=eq.' + req.currency +
          '&select=id,net_amount&order=created_at.asc');
        let left = Number(req.amount);
        for (const e of earned || []) {
          if (left <= 0) break;
          await sbService(env, '/marketplace_earnings?id=eq.' + e.id, {
            method: 'PATCH', body: JSON.stringify({ status: 'paid_out' }),
          });
          left -= Number(e.net_amount || 0);
        }

        // A batch PayPal accepted is not money that arrived — the item can
        // still fail, be blocked, or go unclaimed. With a webhook bound, the
        // request waits at 'processing' until PAYMENTS.PAYOUTS-ITEM. says
        // which it was. Without one there is nothing that could ever tell us,
        // so it is marked paid here and that optimism is the cost of running
        // payouts with no webhook.
        const confirmable = !!env.PAYPAL_WEBHOOK_ID;
        await sbService(env, '/payout_requests?id=eq.' + req.id, {
          method: 'PATCH',
          body: JSON.stringify(confirmable
            ? { batch_id: bid, review_note: 'Sent, waiting for PayPal to confirm delivery' }
            : { status: 'paid', batch_id: bid, paid_at: new Date().toISOString() }),
        });
        return json({ ok: true, batchId: bid, confirmed: !confirmable });
      } catch (err) {
        // Back to approved, not failed: the money is still owed and the review
        // still stands. A missing Payouts entitlement lands here.
        await sbService(env, '/payout_requests?id=eq.' + req.id, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'approved',
            review_note: String((err && err.message) || 'Send failed').slice(0, 500),
          }),
        }).catch(() => {});
        // nothing was sent, so nothing stays retired
        await sbService(env,
          '/marketplace_earnings?seller_id=eq.' + req.user_id +
          '&currency=eq.' + req.currency + '&status=eq.paid_out', {
          method: 'PATCH', body: JSON.stringify({ status: 'available' }),
        }).catch(() => {});
        return json({ error: (err && err.message) || 'Could not send the payout' }, 502);
      }
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payout service error' }, 500);
  }
}
