// The arithmetic of minor units, in one place.
//
// Nothing here touches the network and nothing here decides policy. These are
// the four facts every money endpoint needs before it can name an amount, and
// they were written out separately in rzp.js, paypal.js, paypal-webhook.js and
// payouts.js.
//
// The reason to have one copy is written in rzp.js's own history: its
// ZERO_DECIMAL said `{ JPY }` alone while the other three said
// `{ JPY, HUF, TWD }`, so a Razorpay order in forints or Taiwan dollars was
// priced at a hundredth of the figure the page had quoted. That is what a
// four-way copy of a currency list costs, and adding a currency to the site is
// now one edit rather than four that have to agree.

// Currencies with no minor unit at all: ¥1500 is 1500, not 150000. Every
// conversion below turns on this set, which is why it is the one constant in
// this codebase that must never exist twice.
export const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

// marketplace_items.price_cents -> the currency's smallest unit.
//
// LISTINGS ONLY, and the name says so on purpose. subscription_prices are
// already in the smallest unit — 1500 JPY is stored as 1500 — while
// price_cents is always major × 100 whatever the currency, because that is
// what the composer writes. An earlier version of this was applied to both and
// a ¥1500 plan was ordered at ¥15.
export const fromPriceCents = (cents, cur) =>
  ZERO_DECIMAL.has(cur) ? Math.round(cents / 100) : cents;

// Minor units back out to the decimal string PayPal wants.
export const toValue = (minor, cur) =>
  ZERO_DECIMAL.has(cur) ? String(minor) : (minor / 100).toFixed(2);

// The same figure with its currency after it, for a sentence a buyer reads.
export const showAmount = (minor, cur) => toValue(minor, cur) + ' ' + cur;

// The smallest charge a gateway will accept, per currency, in minor units.
// A 90% discount on a cheap plan in a cheap currency can land under this, and
// a gateway refusing the order is a checkout that fails with a message the
// buyer cannot act on. The floor is roughly one major unit — a rupee, a cent,
// a yen — which is what both providers document as their minimum.
const MIN_CHARGE = { INR: 100, JPY: 1, HUF: 1, TWD: 1 };
const MIN_CHARGE_DEFAULT = 50;
export const minCharge = (cur) =>
  MIN_CHARGE[cur] != null ? MIN_CHARGE[cur] : MIN_CHARGE_DEFAULT;

// What PayPal kept. Reported on the capture as seller_receivable_breakdown, in
// the capture's own currency — if it ever comes back in a different one, zero
// is recorded rather than a number in the wrong denomination.
export function ppFee(capture, currency) {
  const br = (capture && capture.seller_receivable_breakdown) || {};
  const f  = br.paypal_fee;
  if (!f || f.currency_code !== currency) return 0;
  const v = parseFloat(f.value);
  if (!Number.isFinite(v)) return 0;
  return ZERO_DECIMAL.has(currency) ? Math.round(v) : Math.round(v * 100);
}
