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

import { sbUrl, sbAnon, sbSvc, sbUser, underLimit } from '../lib/sb.js';
import { toValue } from '../lib/money.js';

// The minimum is per currency, and it is NOT one figure converted eight ways.
// Converting a dollar minimum into the seller's currency would be the same
// mistake the wallet used to make in the other direction — a rate moving would
// silently move the floor. These are round numbers in each currency, roughly
// five dollars' worth, chosen once.
// One row per currency store.js offers, which is the whole point of the list.
// CHF, HKD, NZD and SEK were missing and fell through to MIN_DEFAULT — five
// hundred minor units, which is five dollars in USD and about fifty cents in
// SEK. A floor an order of magnitude under the intended one lets a payout out
// that PayPal's own per-item fee can exceed.
const MIN_PAYOUT = {
  USD: 500, EUR: 500, GBP: 400, INR: 50000, JPY: 700,
  AUD: 800, CAD: 700, SGD: 700,
  CHF: 400, HKD: 4000, NZD: 900, SEK: 5000,
};
// Only reached by a currency not in the table above, which today is none of
// the twelve that can be selected.
const MIN_DEFAULT = 500;
const minPayout = (cur) => MIN_PAYOUT[cur] != null ? MIN_PAYOUT[cur] : MIN_DEFAULT;

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const apiBase = (env) =>
  String(env.PAYPAL_ENV || '').trim().toLowerCase() === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

// What PayPal will actually send. A balance in anything else is not lost and
// is not converted — it waits for a route, and the seller is told that rather
// than being handed a dollar figure that cost them a spread.
const PP_PAYOUT_CURRENCIES = new Set(['AUD', 'BRL', 'CAD', 'CZK', 'DKK', 'EUR',
  'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN',
  'GBP', 'SGD', 'SEK', 'CHF', 'THB', 'USD']);

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
// Throws on failure rather than answering null.
//
// It used to return null for anything that went wrong, and the overview
// handler turned that into `summary: []` beside `ok: true` — so a transport
// error, an expired token on the forwarded header or an RLS refusal all
// rendered as "Nothing sold yet. You are paid in whichever currency you priced
// your listing in." A seller with money was told they had none, in the one
// panel where that is most alarming, and the payout button was disabled with
// it so there was no way back except a reload. An empty wallet and a broken
// one have to be distinguishable, and only the caller can tell them apart.
async function sbRpc(env, request, fn, args = {}) {
  const res = await fetch(sbUrl(env) + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: sbAnon(env),
      authorization: request.headers.get('authorization') || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error('Could not read your balance (' + res.status + ')');
  return res.json().catch(() => null);
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

async function ledgerAppend(env, args) {
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
  } catch { /* the payout already went; never fail on the audit write */ }
}

// Admin OR dev, and the second half is not a widening — it is the fix for a
// gate that has never opened for anybody.
//
// profiles carried a CHECK allowing only guest, premium and dev, so no row
// could ever hold 'admin'. Every action behind this — admin-list,
// admin-decide, admin-send — is a control for reviewing and sending a seller's
// withdrawal, and all three have been unreachable since the column was
// constrained. supabase/migrations/20260823 widens the vocabulary and points
// dz_tax_due() at dz_is_staff() for the same reason; this is the third place
// that asked for a value the database refused to store.
async function isAdmin(env, userId) {
  const rows = await sbService(env, '/profiles?id=eq.' + userId + '&select=role&limit=1');
  const role = rows && rows[0] && rows[0].role;
  return role === 'admin' || role === 'dev';
}

// ---------------------------------------------------------------------------
// The gate. Nothing leaves without the two records agreeing.
//
// The wallet's figure is derived from the operational tables. The ledger's is
// derived from an append-only record written at settlement from the provider's
// own numbers. If a bug inflates one — the sixteen dollars that reads as a
// hundred and nine — the other does not move with it, the two disagree, and
// the withdrawal is refused rather than paid.
//
// Fails CLOSED, unlike the rate limiter. A limiter that breaks should not stop
// a customer; a reconciliation check that breaks must not let money out.
async function reconciled(env, userId, currency) {
  let rows;
  try {
    const res = await fetch(sbUrl(env) + '/rest/v1/rpc/dz_reconcile', {
      method: 'POST',
      headers: {
        apikey: sbSvc(env),
        authorization: 'Bearer ' + sbSvc(env),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_user: userId }),
    });
    if (!res.ok) return { ok: false, reason: 'check unavailable' };
    rows = await res.json();
  } catch {
    return { ok: false, reason: 'check unavailable' };
  }

  const row = (rows || []).find((r) => r.currency === currency);
  // No ledger and no earnings in this currency is not a mismatch, it is an
  // empty balance — the amount check upstream already refuses that.
  if (!row) return { ok: true };
  if (row.agrees) return { ok: true };

  // Record it so support has something to look at, and so a member cannot
  // simply retry until a race lets it through.
  //
  // One open flag per member per currency. This used to insert unconditionally,
  // so every retry after a flag had been resolved — while the divergence behind
  // it was still there — filed the same incident again, and support could not
  // tell one problem from ten attempts at it.
  const open = await sbService(env,
    '/reconciliation_flags?user_id=eq.' + userId +
    '&currency=eq.' + currency + '&status=eq.open&select=id&limit=1').catch(() => null);
  if (!(open && open.length)) {
    await sbService(env, '/reconciliation_flags', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId, currency,
        operational: row.operational, ledger: row.ledger,
        discrepancy: row.discrepancy, kind: 'balance_mismatch',
        detail: 'Withdrawal blocked: wallet says ' + row.operational +
                ', ledger says ' + row.ledger + ' (' + currency + ', minor units)',
      }),
    }).catch(() => {});
  }

  return { ok: false, reason: 'mismatch', row };
}

// ---------------------------------------------------------------------------
// TDS under section 194-O is NOT here any more.
//
// The statute withholds at credit or payment, whichever is EARLIER, and the
// credit is the sale — so it now happens in Postgres, in
// dz_earning_apply_deductions(), at the moment the earning is written. The
// rates live in platform_tax_config because they are set by statute and change
// without notice: 0.1% since October 2024, 5% with no PAN under section 206AA,
// nil for an individual or HUF under the Rs 5,00,000 floor who has furnished
// one, nil for a seller resident outside India.
//
// This file used to compute all of that again at payout time. Two copies of a
// tax calculation is one too many, and the second one ran on a balance the
// first had already reduced.

// ---------------------------------------------------------------------------
// What this seller may actually withdraw, computed from the earnings rather
// than trusted from the caller. dz_wallet_summary() answers the same question
// for the browser as the CALLER; this answers it on the service role, which is
// what a write may rely on. Both count only earnings whose settlement window
// has elapsed, less anything a payout already has a claim on.
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
  if (!sbUrl(env) || !sbAnon(env) || !sbSvc(env))
    return json({ error: 'Not configured' }, 503);

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
      const flags = await sbService(env,
        '/reconciliation_flags?user_id=eq.' + user.id + '&status=eq.open' +
        '&select=id,currency,discrepancy,created_at&limit=5');
      const tax = await sbService(env,
        '/seller_tax?user_id=eq.' + user.id + '&select=country,pan,is_individual&limit=1');
      const payouts = await sbService(env,
        '/payout_requests?user_id=eq.' + user.id +
        '&order=requested_at.desc&limit=50' +
        '&select=id,amount,currency,status,destination,review_note,requested_at,paid_at');

      // summary is a ROW PER CURRENCY now. There is no total across them and
      // there is not meant to be one — adding a EUR balance to a USD balance
      // requires a rate, and a rate is exactly what this system no longer
      // applies to a seller's money.
      return json({
        ok: true,
        summary: Array.isArray(summary) ? summary : [],
        history: history || [],
        methods: methods || [],
        payouts: payouts || [],
        tax: (tax && tax[0]) || null,
        flags: flags || [],
        minPayouts: MIN_PAYOUT,
        minDefault: MIN_DEFAULT,
        // Which method kinds a payout can actually be SENT to, so the panel
        // can say so where a seller picks one. The request handler refuses
        // anything else, and it used to be the only thing that knew — a seller
        // entered an account holder name, a bank, an account number and an
        // IFSC, made it their default, and found out at the end that none of
        // it could be paid to. Named here rather than hard-coded in the module
        // so the two cannot drift.
        sendableKinds: ['paypal_email'],
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


    // ---- which currency this member transacts in --------------------------
    // Validated against the price table rather than a list in this file, so a
    // currency can never be selected that the checkout cannot then price.
    if (body.action === 'currency') {
      const cur = String(body.currency || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(cur)) return json({ error: 'Pick a currency' }, 400);

      const priced = await sbService(env,
        '/subscription_prices?currency=eq.' + cur + '&select=plan&limit=1');
      if (!(priced && priced.length))
        return json({ error: cur + ' is not one of the supported currencies' }, 400);

      // Nothing already earned, owed or charged moves. This sets what happens
      // NEXT; every existing balance stays in the currency it was earned in.
      await sbService(env, '/profiles?id=eq.' + user.id, {
        method: 'PATCH', body: JSON.stringify({ currency: cur }),
      });
      return json({ ok: true, currency: cur });
    }

    // ---- tax residence and PAN -------------------------------------------
    if (body.action === 'tax') {
      const country = String(body.country || 'IN').toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return json({ error: 'Pick a country' }, 400);
      const pan = String(body.pan || '').trim().toUpperCase();
      if (country === 'IN' && pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))
        return json({ error: 'That does not look like a PAN' }, 400);
      await sbService(env, '/seller_tax', {
        method: 'POST',
        headers: { prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id: user.id, country, pan: pan || null,
          is_individual: body.isIndividual !== false,
          updated_at: new Date().toISOString(),
        }),
      });
      return json({ ok: true });
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
      const gone = await sbService(env,
        '/payout_methods?id=eq.' + id + '&user_id=eq.' + user.id, { method: 'DELETE' });

      // Removing the default used to leave the account with methods and no
      // default, and the payout request then answered "Add a payout method
      // before requesting a payout" with one plainly on screen. Promote the
      // oldest survivor instead. The partial unique index allows one, and
      // there is none at this point, so this cannot collide.
      const removedDefault = Array.isArray(gone) && gone[0] && gone[0].is_default;
      if (removedDefault) {
        const left = await sbService(env,
          '/payout_methods?user_id=eq.' + user.id +
          '&order=created_at.asc&select=id&limit=1');
        if (left && left[0]) {
          await sbService(env, '/payout_methods?id=eq.' + left[0].id,
            { method: 'PATCH', body: JSON.stringify({ is_default: true }) }).catch(() => {});
        }
      }
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
      // The currency is the seller's, taken from the balance they are drawing
      // on. It used to default to USD, which is how a EUR seller ended up
      // asking for dollars they did not have — and, when the amount happened to
      // clear, how their money crossed a spread on the way out.
      const currency = String(body.currency || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return json({ error: 'Pick a currency to withdraw' }, 400);
      const amount   = Math.round(Number(body.amount));
      if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Bad amount' }, 400);

      // paid to the default instrument, snapshotted onto the request so a
      // later edit cannot rewrite where past money went
      // an unresolved flag freezes withdrawals until a human clears it
      const flags = await sbService(env,
        '/reconciliation_flags?user_id=eq.' + user.id +
        '&status=eq.open&select=id&limit=1');
      if (flags && flags.length)
        return json({ error: 'Withdrawals are paused on this account while a balance check is reviewed. Please contact support.', flagged: true }, 409);

      const methods = await sbService(env,
        '/payout_methods?user_id=eq.' + user.id + '&is_default=is.true' +
        '&select=kind,paypal_email,upi_vpa,bank_last4&limit=1');
      const m = methods && methods[0];
      const dest = m && (m.paypal_email || m.upi_vpa ||
                         (m.bank_last4 ? 'bank ****' + m.bank_last4 : null));
      if (!dest) return json({ error: 'Add a payout method before requesting a payout' }, 400);
      if (m.kind !== 'paypal_email')
        return json({ error: 'Only PayPal payouts can be sent automatically right now' }, 400);

      // Said here rather than discovered at send time, and said instead of
      // quietly converting. A currency PayPal will not pay out in is a
      // currency this seller cannot be paid in TODAY — the honest answer is to
      // say so and leave the balance where it is, not to move it through a
      // dollar and hand them the remainder.
      if (!PP_PAYOUT_CURRENCIES.has(currency))
        return json({ error: 'PayPal cannot pay out in ' + currency +
          '. Your ' + currency + ' balance stays as it is — nothing is converted — ' +
          'until a payout route for it is available. Contact support if you need it sooner.' }, 400);

      // Before anything else: do the two records agree?
      const rec = await reconciled(env, user.id, currency);
      if (!rec.ok) {
        return json({
          error: rec.reason === 'mismatch'
            ? 'Your balance could not be verified. Withdrawals are paused on this account as a precaution — please contact support.'
            : 'Balance verification is unavailable right now. Please try again shortly.',
          flagged: rec.reason === 'mismatch',
        }, 409);
      }

      const avail = (await withdrawable(env, user.id))[currency] || 0;
      if (!avail)
        return json({ error: 'You have no ' + currency + ' balance to withdraw' }, 400);
      if (amount > avail)
        return json({ error: 'You can withdraw at most ' + toValue(avail, currency) + ' ' + currency }, 400);
      const min = minPayout(currency);
      if (amount < min)
        return json({ error: 'Minimum payout is ' + toValue(min, currency) + ' ' + currency }, 400);

      // TDS IS NOT COMPUTED HERE ANY MORE.
      //
      // Section 194-O withholds at credit or payment, whichever is EARLIER,
      // and the credit is the sale. It is now withheld by
      // dz_earning_apply_deductions() at the moment the earning is written, so
      // the balance a seller is looking at is already net of it. Taking it
      // again here would withhold twice on the same sale.
      //
      // The figures are still carried on the request, for the record — walked
      // from the earnings this payout will actually retire, oldest first, in
      // the same order and under the same filter admin-send retires them in.
      // available_at is part of that filter: without it this walks earnings
      // that have not settled, and records a gross and a withheld figure
      // against money the payout will never touch.
      const covering = await sbService(env,
        '/marketplace_earnings?seller_id=eq.' + user.id +
        '&status=eq.available&currency=eq.' + currency +
        '&available_at=lte.' + new Date().toISOString() +
        '&select=gross_amount,net_amount,tds_amount&order=created_at.asc');
      let left = amount, grossBasis = 0, tdsAlready = 0;
      for (const e of covering || []) {
        if (left <= 0) break;
        grossBasis += Number(e.gross_amount || 0);
        tdsAlready += Number(e.tds_amount || 0);
        left -= Number(e.net_amount || 0);
      }

      const rows = await sbService(env, '/payout_requests', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user.id, amount, currency,
          method: 'paypal', destination: dest, status: 'requested',
          gross_basis: grossBasis,
          // already withheld at the sale; nothing further comes off here
          tds_amount: tdsAlready, tds_bps: 0, net_amount: amount,
        }),
      });
      return json({ ok: true, request: rows && rows[0], tds: 0, net: amount,
                    tdsAlreadyWithheld: tdsAlready });
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
      // Exactly the earnings THIS attempt retires, so the rollback below has
      // something to name. It used to have nothing, and swept every row the
      // seller had ever had paid out back to available.
      const retiredIds = [];
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
              // what leaves is the request minus anything withheld
              amount: { value: toValue(req.net_amount != null ? req.net_amount : req.amount,
                                       req.currency), currency: req.currency },
              note: 'DigiArtz marketplace earnings',
              sender_item_id: req.id,
            }],
          }),
        });

        const bid = (out.batch_header && out.batch_header.payout_batch_id) || batchId;

        // Retire exactly the earnings this payout covers, oldest first, so the
        // same money cannot be requested twice while the item is in flight.
        // PAYMENTS.PAYOUTS-ITEM.* hands them back if the item never lands.
        //
        // available_at is not optional here, and leaving it off was a way to
        // pay the same money twice. An earning sits at status 'available' from
        // the moment it is written, while available_at is the settlement date
        // days ahead — that gap is the whole of the pending/settled split the
        // wallet shows. withdrawable() above counts only rows past it, so a
        // walk without it retires PENDING earnings oldest-first and leaves the
        // settled ones this payout was actually drawn from still available.
        // Once the request closed, the seller's withdrawable balance was
        // unchanged and the same money could be taken again.
        const earned = await sbService(env,
          '/marketplace_earnings?seller_id=eq.' + req.user_id +
          '&status=eq.available&currency=eq.' + req.currency +
          '&available_at=lte.' + new Date().toISOString() +
          '&select=id,net_amount&order=created_at.asc');
        let left = Number(req.amount), retired = 0;
        for (const e of earned || []) {
          if (left <= 0) break;
          await sbService(env, '/marketplace_earnings?id=eq.' + e.id, {
            method: 'PATCH', body: JSON.stringify({ status: 'paid_out' }),
          });
          retiredIds.push(e.id);
          retired += Number(e.net_amount || 0);
          left -= Number(e.net_amount || 0);
        }

        // Booked against what was actually RETIRED, not what was requested.
        // Retirement walks whole earnings, so the last one usually overshoots;
        // booking the request would leave a few cents of permanent
        // disagreement and flag an honest seller forever.
        await ledgerAppend(env, {
          p_user: req.user_id, p_type: 'payout_debit', p_direction: 'debit',
          p_amount: retired, p_currency: req.currency,
          p_source: 'paypal', p_provider_txn: bid,
          p_provider_amount: req.net_amount != null ? req.net_amount : req.amount,
          p_provider_currency: req.currency,
          p_ref_table: 'payout_requests', p_ref_id: req.id,
          p_note: req.tds_amount ? 'net of tax withheld' : null,
        });

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
        // Nothing was sent, so nothing THIS ATTEMPT retired stays retired.
        //
        // The filter names the ids collected above, and that is the whole
        // point of collecting them. It used to say
        // "seller_id=eq.<user>&currency=eq.<cur>&status=eq.paid_out", which
        // names every earning the seller has ever been paid for — so one
        // failed send handed back the seller's entire payout history as
        // withdrawable balance. Worse, the retirement loop runs only after
        // PayPal succeeds, so on the ordinary failure path (a merchant account
        // without the Payouts entitlement, which is the default — see the note
        // at the top of this file) nothing had been retired at all and the
        // rollback still fired. ledger_entries is append-only, so the old
        // payout_debit rows stayed behind and dz_reconcile then froze the
        // account for a mismatch it had just been given.
        //
        // Empty when the send failed before the loop, and then there is
        // nothing to undo.
        if (retiredIds.length) {
          await sbService(env,
            '/marketplace_earnings?status=eq.paid_out' +
            '&id=in.(' + retiredIds.join(',') + ')', {
            method: 'PATCH', body: JSON.stringify({ status: 'available' }),
          }).catch(() => {});
        }
        return json({ error: (err && err.message) || 'Could not send the payout' }, 502);
      }
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err && err.message) || 'Payout service error' }, 500);
  }
}
