// One copy of how a Function talks to Supabase.
//
// These eight helpers were written out by hand in nine of the twelve files
// under functions/api, byte for byte the same in every copy: the three env
// readers in nine files, sbUser in six, underLimit in four, ledger and peekJwt
// in three each. Nothing about them is endpoint-specific — they are the shape
// of "which project, which key, who is calling" — and a helper copied nine
// times is a helper that gets fixed in one of them.
//
// That is not hypothetical for this set. underLimit and ledger both swallow
// their own failures on purpose, and the reasoning for that lives in a comment
// that existed in some copies and not others; peekJwt is a security helper
// whose whole safety argument is "it only ever refuses", and that argument has
// to hold in every copy at once.
//
// What is NOT here, deliberately: sbService. Five files still have one of
// their own and they are not the same function — collab.js throws a Refused it
// can turn into a status code, payouts.js and both webhooks ask PostgREST for
// the row back, store.js does not. Folding four different error contracts into
// one parameterised helper would make each caller harder to read to save a
// dozen lines, so each keeps its own. paypal.js and rzp.js share theirs
// through lib/billing.js, where the two really are identical and the money
// they move is the reason to keep them that way.

// ---------------------------------------------------------------------------
// Supabase environment names.
//
// This project uses two spellings. The older Functions read SUPABASE_URL /
// SUPABASE_ANON_KEY; the newer ones read SB_URL / SB_KEY, and config.example.js
// documents the service key as SUPABASE_SERVICE_ROLE_KEY while the code asks
// for SB_SERVICE_KEY. Either is fine to bind — what is not fine is a deploy
// that half-works because of which spelling someone picked, so both are
// accepted here and the endpoint says exactly what is missing when neither is.
//
// Neither is defaulted to a literal: an endpoint with no project bound must
// fail to reach anything, not reach a guess.
export const sbUrl  = (env) => env.SB_URL || env.SUPABASE_URL || '';
export const sbAnon = (env) => env.SB_KEY || env.SUPABASE_ANON_KEY || '';
export const sbSvc  = (env) => env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

// Who is calling, verified. Hands the bearer token to GoTrue, which checks the
// signature for real; null means nobody, and every caller treats that as 401.
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

// Reads a jwt payload WITHOUT verifying it. Only ever used to refuse early —
// a token of the wrong shape, or one that has already expired, costs a
// Supabase round trip to discover otherwise. Whatever it lets through is
// checked for real by PostgREST or GoTrue on the call that follows, so this
// can be wrong about a token being good and can never be wrong in a way that
// grants anything.
export function peekJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch { return null; }
}

// A named bucket, a ceiling and a window; true means still under it.
//
// Cloudflare stops the floods; this stops the cheap targeted abuse it has no
// reason to block — walking item ids through checkout, opening orders to spam
// the ledger, hammering a payout race.
//
// FAILS OPEN, like every other limiter in this codebase: no service key bound,
// a network blip, or a limiter that errors must never take an endpoint down,
// and a paying customer still gets served. The controls that fail CLOSED are
// the ones inside the database, where the damage would be.
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

// The audit write for a settlement.
//
// An independent record of the same movement, taken from what the PROVIDER
// reported rather than from our own arithmetic — that is the whole point of
// it. Appended, never updated: the table refuses UPDATE and DELETE to every
// role. If our maths drifts, this does not drift with it, and the mismatch is
// what stops a withdrawal.
//
// Fire and forget on purpose: a settlement is not held up by its own audit
// row, and the row that failed to write is a mismatch the reconciler sees.
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
  } catch { /* never block a settlement on the audit write */ }
}
