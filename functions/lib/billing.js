import { sbUrl, sbAnon, sbSvc } from './sb.js';

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
