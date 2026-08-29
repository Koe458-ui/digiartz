import { sbUrl, sbAnon, sbService, ledger } from './sb.js';

export async function memberCurrency(env, userId) {
  const rows = await sbService(env,
    '/profiles?id=eq.' + userId + '&select=currency&limit=1');
  const c = rows && rows[0] && rows[0].currency;
  return /^[A-Z]{3}$/.test(String(c || '')) ? c : 'USD';
}

export async function planPrice(env, plan, currency) {
  const rows = await sbService(env,
    '/subscription_prices?plan=eq.' + encodeURIComponent(plan) +
    '&currency=eq.' + encodeURIComponent(currency) + '&select=amount&limit=1');
  const a = rows && rows[0] && Number(rows[0].amount);
  return Number.isFinite(a) && a > 0 ? a : null;
}

export async function supportLimits(env, currency) {
  const rows = await sbService(env,
    '/support_limits?currency=eq.' + encodeURIComponent(currency) +
    '&select=min_amount,max_amount&limit=1');
  const r = rows && rows[0];
  return r ? { min: Number(r.min_amount), max: Number(r.max_amount) } : null;
}

export async function currentPlan(env, userId) {
  try {
    const rows = await sbService(env, '/profiles?id=eq.' + userId +
      '&select=subscription_tier,subscription_expires_at&limit=1');
    const p = rows && rows[0];
    const t = p && p.subscription_expires_at
      ? new Date(p.subscription_expires_at).getTime() : 0;
    if (t && t > Date.now()) return { tier: p.subscription_tier || null, expires: t };
  } catch {   }
  return { tier: null, expires: 0 };
}

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
    const bps = Math.min(Math.max(Number(r.discount_bps) || 0, 0), 9500);
    return { id: r.id, code: raw, discountBps: bps };
  } catch {
    return { error: 'That code could not be checked' };
  }
}

export const PLAN_TIERS = { lite: 'lite', premium: 'premium', max: 'max', support: null };

export const TIER_RANK = { lite: 1, premium: 2, max: 3 };

export const PLAN_LABEL = {
  lite: 'Lite \u2014 1 month', premium: 'Premium \u2014 1 month',
  max: 'Max \u2014 1 month',   support: 'Support DigiArtz',
};

export const SUB_DAYS = 31;

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

export async function revokeSubscription(env, userId) {
  const cur = await currentPlan(env, userId);
  if (!cur.expires) return null;

  const back = cur.expires - SUB_DAYS * 86400000;
  if (back > Date.now()) {
    await sbService(env, '/profiles?id=eq.' + userId, {
      method: 'PATCH',
      body: JSON.stringify({ subscription_expires_at: new Date(back).toISOString() }),
    });
    return cur.tier;
  }

  await sbService(env, '/profiles?id=eq.' + userId, {
    method: 'PATCH',
    body: JSON.stringify({ subscription_tier: null, subscription_expires_at: null }),
  });
  return null;
}

export async function recordEarning(env, provider, row, prov) {
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
      provider: provider,
      status: 'available',
    }),
  }).catch(() => null);

  const earning = Array.isArray(made) && made[0];
  if (!earning) return;

  await ledger(env, {
    p_user: sellerId, p_type: 'sale_credit', p_direction: 'credit',
    p_amount: Number(earning.net_amount) || 0, p_currency: row.currency,
    p_source: provider,
    p_provider_txn: (prov && prov.txn) || null,
    p_provider_amount: (prov && prov.amount) || null,
    p_provider_currency: (prov && prov.currency) || row.currency,
    p_ref_table: 'payments', p_ref_id: row.id,
  });
}
