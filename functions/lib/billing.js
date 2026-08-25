// What the two checkout backends read before they name a price.
//
// functions/api/rzp.js and functions/api/paypal.js are two different providers
// with two different order shapes, two different signature schemes and two
// different webhooks. What they are NOT different about is the five questions
// they each ask the database before an order exists: which currency does this
// member transact in, what does this plan cost there, what are the floor and
// ceiling on a support payment, what does this member already hold, and is
// this promo code real. Those five were byte-identical in both files, along
// with the service-role reader underneath them.
//
// Five copies of "what does this plan cost" is five chances to charge the
// wrong amount, and that is not a hypothetical failure mode in this directory:
// the note this codebase kept above rzp.js's ZERO_DECIMAL records the time one
// copy of a currency list fell behind the other three and priced an order at a
// hundredth of the quoted figure. The rule these two files already state — one
// price list, read at request time, never written into code — applies to the
// readers as much as to the prices.
//
// The five readers and sbService are for those two. The block at the foot of
// this file — the plan tables and applySubscription — is for all four money
// files, because settlement runs in the webhooks as well.
//
// store.js, payouts.js and both webhooks keep service-role readers of their
// own for their other calls, because theirs answer differently on failure; see
// the note in functions/lib/sb.js.

import { sbUrl, sbAnon, sbSvc } from './sb.js';

// Service-role read, asking PostgREST for the row back so a write can be
// checked. Throws on anything but 2xx: a checkout that cannot read the price
// list must fail loudly rather than quote a default.
export async function sbService(env, path, init = {}) {
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

// What this member transacts in. Dollars for anyone who has not chosen, and
// for anyone whose stored value is not a currency code.
export async function memberCurrency(env, userId) {
  const rows = await sbService(env,
    '/profiles?id=eq.' + userId + '&select=currency&limit=1');
  const c = rows && rows[0] && rows[0].currency;
  return /^[A-Z]{3}$/.test(String(c || '')) ? c : 'USD';
}

// What a plan costs in that currency, in the currency's smallest unit. null
// when there is no row — a plan with no price in a currency is not orderable
// in it, which is a different answer from "free".
export async function planPrice(env, plan, currency) {
  const rows = await sbService(env,
    '/subscription_prices?plan=eq.' + encodeURIComponent(plan) +
    '&currency=eq.' + encodeURIComponent(currency) + '&select=amount&limit=1');
  const a = rows && rows[0] && Number(rows[0].amount);
  return Number.isFinite(a) && a > 0 ? a : null;
}

// The floor and ceiling on a support payment in that currency.
export async function supportLimits(env, currency) {
  const rows = await sbService(env,
    '/support_limits?currency=eq.' + encodeURIComponent(currency) +
    '&select=min_amount,max_amount&limit=1');
  const r = rows && rows[0];
  return r ? { min: Number(r.min_amount), max: Number(r.max_amount) } : null;
}

// What the member already holds. Read before an order is created, so a plan
// that would take something away can be refused while the buyer still has
// their money, and read again at settlement.
export async function currentPlan(env, userId) {
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

// A promo code, resolved AS THE CALLER — the rpc runs on their token, not on
// the service role, so a code's own eligibility rules apply to the person
// spending it.
export async function resolvePromo(env, request, code, kind) {
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
    // Clamped on the way out. The discount comes from a config row an admin can
    // edit, and a typo there should cost the platform a sale, not the whole
    // price of one.
    const bps = Math.min(Math.max(Number(r.discount_bps) || 0, 0), 9500);
    return { id: r.id, code: raw, discountBps: bps };
  } catch {
    // A code that cannot be checked is not silently honoured and not silently
    // dropped either — the buyer is told, and can pay without it.
    return { error: 'That code could not be checked' };
  }
}

// ---------------------------------------------------------------------------
// WHAT A PLAN IS WORTH, AND WHAT A SETTLED MONTH DOES TO IT.
//
// These three tables and the function under them were written out in all four
// money files — rzp.js, paypal.js and both webhooks — and each file's own
// comment said so ("Same table in rzp.js and both webhooks"). Four hand-kept
// copies of the rule that decides what a member gets for their money is four
// chances for a renewal to be a month in one file and something else in
// another, and the renewal is not a detail: it runs after the money is taken.

// Which tier a plan grants. `support` is a payment that grants nothing, which
// is why it is null rather than absent — the difference between "not a plan"
// and "a plan with no tier" is what tells a settled support payment apart from
// a plan name nobody recognises. rzp.js and paypal.js called this TIERS and
// the two webhooks called it PLAN_TIERS; it is one table with one name now.
export const PLAN_TIERS = { lite: 'lite', premium: 'premium', max: 'max', support: null };

// What a member already holds decides both whether a plan may be ordered and
// how a settled month is applied, so the three need an order. It matters most
// in the window between an order placed before an upgrade and settled after
// it, where the money is already taken and the only wrong answer is to give
// less than was there before.
export const TIER_RANK = { lite: 1, premium: 2, max: 3 };

export const PLAN_LABEL = {
  lite: 'Lite \u2014 1 month', premium: 'Premium \u2014 1 month',
  max: 'Max \u2014 1 month',   support: 'Support DigiArtz',
};

// A month, in days.
export const SUB_DAYS = 31;

// Add a settled month to what the member holds.
//
// Four paths can settle a subscription — rzp.js, paypal.js and the two
// webhooks — and this used to be an unconditional PATCH to
// { tier, now + 31 days } in all four, reading neither the current tier nor
// the current expiry first:
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
//
// An expired subscription is not a subscription and starts from today; a
// profile that cannot be read (currentPlan swallows that) falls through to a
// plain month from now, because the money is already taken and refusing to
// grant anything is the one answer that is certainly wrong.
export async function applySubscription(env, userId, tier) {
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
