export const sbUrl  = (env) => env.SB_URL || env.SUPABASE_URL || '';
export const sbAnon = (env) => env.SB_KEY || env.SUPABASE_ANON_KEY || '';
export const sbSvc  = (env) => env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function sbUser(env, request) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const res = await fetch(sbUrl(env) + '/auth/v1/user', {
    headers: { apikey: sbAnon(env), authorization: bearer },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

export function peekJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch { return null; }
}

export async function underLimit(env, bucket, limit, seconds) {
  try {
    const res = await fetch(sbUrl(env) + '/rest/v1/rpc/dz_rate_take', {
      method: 'POST',
      headers: {
        apikey: sbSvc(env),
        authorization: 'Bearer ' + sbSvc(env),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_bucket: bucket, p_limit: limit, p_seconds: seconds }),
    });
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch { return true; }
}

export async function ledger(env, args) {
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
  } catch {   }
}
