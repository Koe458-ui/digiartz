export const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);

export const fromPriceCents = (cents, cur) =>
  ZERO_DECIMAL.has(cur) ? Math.round(cents / 100) : cents;

export const toValue = (minor, cur) =>
  ZERO_DECIMAL.has(cur) ? String(minor) : (minor / 100).toFixed(2);

export const showAmount = (minor, cur) => toValue(minor, cur) + ' ' + cur;

const MIN_CHARGE = { INR: 100, JPY: 1, HUF: 1, TWD: 1 };
const MIN_CHARGE_DEFAULT = 50;
export const minCharge = (cur) =>
  MIN_CHARGE[cur] != null ? MIN_CHARGE[cur] : MIN_CHARGE_DEFAULT;

export function ppFee(capture, currency) {
  const br = (capture && capture.seller_receivable_breakdown) || {};
  const f  = br.paypal_fee;
  if (!f || f.currency_code !== currency) return 0;
  const v = parseFloat(f.value);
  if (!Number.isFinite(v)) return 0;
  return ZERO_DECIMAL.has(currency) ? Math.round(v) : Math.round(v * 100);
}
