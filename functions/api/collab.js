// partners, promo codes, moderation and the telemetry dashboard
//
// One endpoint, dispatched on an action, the way /api/payouts and /api/store
// are. The four route names the brief asked for exist as their own files —
// functions/api/admin/collab/add-partner.js and its three siblings — and every
// one of them delegates here, so there is one implementation of each action
// and four addresses that reach it.
//
// WHAT THIS FILE DOES NOT DO IS DECIDE ANYTHING.
//
// Every guard in this feature lives in Postgres, in the SECURITY DEFINER
// functions added by 20260822_collab_and_admin.sql, and every call below is
// made AS THE CALLER — the member's own bearer token, never the service key.
// So auth.uid() inside those functions is the person who made the request, and
// a bug in this file cannot promote anybody, pay anybody or unmask anybody:
// the worst it can do is ask a question and be told no.
//
// That is deliberate and it is the opposite of how /api/payouts works, which
// holds the service role because it moves money out of a provider account and
// has to be trusted with the arithmetic. Nothing here moves money. Commissions
// are written by triggers at the moment a sale settles, and this endpoint only
// ever reads them back.
//
// The one exception is `broadcast`, which writes a notification with a null
// user_id — a row every member reads — and is marked as such where it sits.
//
// Environment: SB_URL / SB_KEY, and SB_SERVICE_KEY for the broadcast only.

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex, nofollow',
    },
  });

// ---------------------------------------------------------------------------
// Supabase environment names. Two spellings are in use across this project and
// both are accepted; see the same note in functions/api/payouts.js.
const sbUrl = (env) => env.SB_URL || env.SUPABASE_URL || '';
const sbAnon = (env) => env.SB_KEY || env.SUPABASE_ANON_KEY || '';
const sbSvc = (env) => env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

async function sbUser(env, request) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const res = await fetch(sbUrl(env) + '/auth/v1/user', {
    headers: { apikey: sbAnon(env), authorization: bearer },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

// A refusal raised by a Postgres guard, turned into the status code it means.
//
// The guards all raise the bare string 'not allowed', and they raise the same
// string whether the caller is not a partner at all or is a partner asking
// about somebody else. That is on purpose in the migration and it is preserved
// here: a 403 with no detail tells a prober nothing about which of the two it
// was, and therefore nothing about who the other partners are.
class Refused extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// A message is passed through to the browser ONLY when Postgres says it came
// from a RAISE in one of our own functions. That is SQLSTATE P0001, which is
// what `raise exception '...'` produces and what dz_ban_gate() sets explicitly.
// Everything else — a constraint, a permission error, a missing function — is
// replaced with a sentence that describes nothing.
//
// This used to sniff the MESSAGE with a regex, and it leaked. The SQLSTATE is
// in body.code, not at the front of body.message, so the "does this look like
// a Postgres error code" test never matched anything; and the wording filter
// beside it did not mention constraints, so
//
//   duplicate key value violates unique constraint "promo_codes_code_idx"
//
// was 68 characters of internal schema handed straight to whoever asked. An
// allowlist on the one code we control cannot fail that way: a message either
// carries P0001 or it does not reach the caller.
function refusalFrom(status, body) {
  const code = String((body && body.code) || '');
  const msg = String((body && (body.message || body.error)) || '').trim();

  // PostgREST's own refusals, before any of our SQL runs.
  if (status === 401) return new Refused('Sign in required', 401);
  if (status === 404) return new Refused('Unavailable', 503);

  if (code === 'P0001') {
    // 'not allowed' is raised identically by every guard — for "you are not a
    // partner" and for "not that member" alike — so a prober learns nothing
    // from the reply about which it was, and nothing about who the other
    // partners are.
    if (/^not allowed$/i.test(msg)) return new Refused('Not allowed', 403);
    if (/^sign in required$/i.test(msg)) return new Refused('Sign in required', 401);
    // Written for a member to read: "That code is taken", "No account is
    // registered to that address". Still capped, so a raise that ever
    // interpolates something large cannot become a channel.
    return new Refused(msg.slice(0, 160) || 'That did not work', 400);
  }

  return new Refused('That did not work', 400);
}

// Called AS THE CALLER. This is the whole security model of the file.
async function rpc(env, request, fn, args = {}) {
  const res = await fetch(sbUrl(env) + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: sbAnon(env),
      authorization: request.headers.get('authorization') || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw refusalFrom(res.status, body);
  return body;
}

// Service-role write. Used by exactly one action; see the note on `broadcast`.
async function sbService(env, path, init = {}) {
  const res = await fetch(sbUrl(env) + '/rest/v1' + path, {
    ...init,
    headers: {
      apikey: sbSvc(env),
      authorization: 'Bearer ' + sbSvc(env),
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Refused('Database error (' + res.status + ')', 500);
  return res.json().catch(() => null);
}

// Fails OPEN, like the limiter in /api/payouts: a broken limiter should not
// stop a partner reading their own wallet. The actions that could be abused at
// speed are the ones with a Postgres-side uniqueness rule behind them anyway —
// a code can only be created once whatever the limiter says.
async function underLimit(env, bucket, limit, seconds) {
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// ---------------------------------------------------------------------------
// The actions.
//
// Each one is a thin shape check and a call. The shape checks are here to give
// a member a sentence they can act on before a round trip, not to enforce
// anything — every rule they hint at is enforced again in Postgres, which is
// the copy that counts.
const ACTIONS = {
  // ---- anybody signed in --------------------------------------------------

  // What the subscription page and the nav need before they draw: is this
  // member a partner, have they claimed, do they have a code yet.
  async state({ env, request }) {
    return { ok: true, state: await rpc(env, request, 'dz_my_collab_state') };
  },

  // Checkout asks this before it shows a discount. It answers with the code's
  // id and the discount and never with the partner's name.
  async 'promo-resolve'({ env, request, body }) {
    const code = str(body.code, 12).toUpperCase();
    const kind = str(body.kind, 20);
    if (!/^[A-Z0-9]{4,6}$/.test(code))
      return { ok: false, error: 'A code is 4 to 6 letters or digits' };
    if (kind !== 'marketplace' && kind !== 'subscription')
      throw new Refused('Unknown purchase kind', 400);
    return await rpc(env, request, 'dz_promo_resolve', { p_code: code, p_kind: kind });
  },

  // ---- partner ------------------------------------------------------------

  // The free Max. Postgres decides whether this caller is entitled to it and
  // whether they have had it already; this is the button's other end.
  async 'claim-max'({ env, request }) {
    return await rpc(env, request, 'dz_claim_max');
  },

  async 'promo-create'({ env, request, body }) {
    const code = str(body.code, 12).toUpperCase();
    if (!/^[A-Z0-9]{4,6}$/.test(code))
      throw new Refused('A code is 4 to 6 letters or digits, nothing else', 400);
    return await rpc(env, request, 'dz_promo_create', { p_code: code });
  },

  async 'promo-mine'({ env, request }) {
    return await rpc(env, request, 'dz_promo_mine');
  },

  // The Collab Hub's whole first paint, in one call — the code, the wallet and
  // the ledger together, so the balance on screen and the rows under it are
  // from the same moment. /api/payouts assembles the seller wallet the same
  // way and for the same reason.
  async wallet({ env, request, body }) {
    const [promo, wallet, ledger, state] = await Promise.all([
      rpc(env, request, 'dz_promo_mine'),
      rpc(env, request, 'dz_partner_wallet'),
      rpc(env, request, 'dz_partner_ledger', {
        p_limit: Math.min(Math.max(Number(body.limit) || 50, 1), 100),
        p_before: body.before || null,
      }),
      // Carried because dz_partner_wallet() groups by currency and therefore
      // returns NO ROWS to a partner who has not earned anything yet — so
      // has_payout_method could not be read off it in exactly the case it
      // matters most. A partner who has added an account and is waiting for
      // their first sale was being told they had not added one.
      rpc(env, request, 'dz_my_collab_state'),
    ]);
    return { ok: true, promo, wallet: wallet || [], ledger: ledger || [], state };
  },

  // ---- partner and staff: moderation --------------------------------------

  // One exact match or nothing. dz_mod_find refuses a prefix, so this cannot
  // be walked to enumerate members or harvest addresses.
  async 'mod-find'({ env, request, body }) {
    const q = str(body.query, 200);
    if (q.length < 2) throw new Refused('Search for a username, an email or a user id', 400);
    const rows = await rpc(env, request, 'dz_mod_find', { p_query: q });
    return { ok: true, user: (rows && rows[0]) || null };
  },

  async ban({ env, request, body }) {
    const id = str(body.userId, 40);
    if (!UUID_RE.test(id)) throw new Refused('Pick a member to ban', 400);
    const reason = str(body.reason, 60);
    if (reason.length < 2) throw new Refused('A reason is required', 400);
    const days = Number(body.days);
    return await rpc(env, request, 'dz_ban_user', {
      p_target: id,
      p_reason: reason,
      p_note: str(body.note, 500) || null,
      p_days: Number.isFinite(days) && days > 0 ? Math.floor(days) : null,
    });
  },

  async unban({ env, request, body }) {
    const id = str(body.userId, 40);
    if (!UUID_RE.test(id)) throw new Refused('Pick a member to unban', 400);
    return await rpc(env, request, 'dz_unban_user', { p_target: id });
  },

  async reports({ env, request, body }) {
    const status = str(body.status, 20) || 'pending';
    const rows = await rpc(env, request, 'dz_reports_queue', {
      p_status: status,
      p_limit: Math.min(Math.max(Number(body.limit) || 100, 1), 200),
    });
    return { ok: true, reports: rows || [] };
  },

  async 'report-resolve'({ env, request, body }) {
    const id = str(body.id, 40);
    if (!UUID_RE.test(id)) throw new Refused('Pick a report', 400);
    const status = str(body.status, 20);
    if (status !== 'resolved' && status !== 'dismissed')
      throw new Refused('Resolve it or dismiss it', 400);
    return await rpc(env, request, 'dz_report_resolve', {
      p_id: id, p_status: status, p_note: str(body.note, 500) || null,
    });
  },

  // ---- admin and dev only -------------------------------------------------

  async 'add-partner'({ env, request, body }) {
    const email = str(body.email, 254).toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email))
      throw new Refused('That does not look like an email address', 400);
    return await rpc(env, request, 'dz_grant_partner', { p_email: email });
  },

  async 'revoke-partner'({ env, request, body }) {
    const id = str(body.userId, 40);
    if (!UUID_RE.test(id)) throw new Refused('Pick a partner', 400);
    return await rpc(env, request, 'dz_revoke_partner', { p_user: id });
  },

  async partners({ env, request }) {
    return { ok: true, partners: (await rpc(env, request, 'dz_admin_partners')) || [] };
  },

  async audit({ env, request, body }) {
    const rows = await rpc(env, request, 'dz_audit_log', {
      p_limit: Math.min(Math.max(Number(body.limit) || 100, 1), 200),
      p_before: body.before || null,
    });
    return { ok: true, entries: rows || [] };
  },

  async telemetry({ env, request }) {
    return { ok: true, telemetry: await rpc(env, request, 'dz_admin_telemetry') };
  },

  async revenue({ env, request }) {
    const rows = await rpc(env, request, 'dz_platform_revenue');
    return { ok: true, revenue: (rows && rows[0]) || null };
  },

  // The one write in this file that does not go through a Postgres guard,
  // because there is no guard to go through: notifications takes a null
  // user_id to mean everybody, and there is no SECURITY DEFINER wrapper for
  // it — js/auth.js has always inserted the row straight from an admin's
  // browser under the table's own RLS.
  //
  // So the check is made here, explicitly, before the service key is used: ask
  // Postgres who the caller is through a function that will only answer for a
  // member of staff, and refuse if it refuses. The service role is picked up
  // only after that has come back.
  async broadcast({ env, request, body }) {
    const title = str(body.title, 80);
    const message = str(body.message, 500);
    if (!title || !message) throw new Refused('A title and a message, please', 400);
    if (!sbSvc(env)) throw new Refused('Not configured', 503);

    // dz_admin_telemetry() raises 'not allowed' for anyone who is not admin or
    // dev, which makes it a usable staff check as well as a dashboard. Cheaper
    // options exist; none of them are already guarded, and a second guard to
    // keep in step with the first is what this whole file avoids.
    await rpc(env, request, 'dz_admin_telemetry');

    await sbService(env, '/notifications', {
      method: 'POST',
      body: JSON.stringify({ user_id: null, type: 'admin', title, message }),
    });
    return { ok: true };
  },
};

// How hard each action may be hit, per member per minute. Reading is cheap and
// the dashboards poll; creating a code, inviting a partner or banning somebody
// is not, and should never happen at speed.
const LIMITS = {
  'promo-create': [5, 300],
  'claim-max': [5, 300],
  'add-partner': [10, 60],
  'revoke-partner': [10, 60],
  ban: [20, 60],
  unban: [20, 60],
  broadcast: [5, 300],
  // Typing a code is a deliberate act; thirty a minute was a script's budget,
  // not a buyer's. A promo code is meant to be shared publicly, so guessing one
  // yields something a partner gives away on purpose — this is not the fix for
  // an enumeration hole, it is refusing to pay for the traffic.
  'promo-resolve': [10, 60],
  // Looking a member up is an exact-match lookup against usernames and email
  // addresses. dz_mod_find() refuses a prefix, so this cannot be walked to
  // enumerate, but a moderator moderates one account at a time and does not
  // need thirty lookups a minute to do it.
  'mod-find': [12, 60],
  audit: [30, 60],
};
const LIMIT_DEFAULT = [60, 60];

// ---------------------------------------------------------------------------
export async function handle(action, { env, request }) {
  if (!sbUrl(env) || !sbAnon(env)) return json({ error: 'Not configured' }, 503);

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Sign in required' }, 401);

  let body = {};
  if (request.method === 'POST') {
    try { body = (await request.json()) || {}; }
    catch { return json({ error: 'Bad request' }, 400); }
  }

  // A route file names its own action; a call to /api/collab names it in the
  // body. Neither is trusted past this lookup.
  const name = String(action || body.action || '');
  const fn = ACTIONS[name];
  if (!fn) return json({ error: 'Unknown action' }, 404);

  const [limit, seconds] = LIMITS[name] || LIMIT_DEFAULT;
  if (!(await underLimit(env, 'cl:' + name + ':' + user.id, limit, seconds)))
    return json({ error: 'Too many attempts — wait a moment' }, 429);

  try {
    return json(await fn({ env, request, body, user }));
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    // Nothing unexpected is described to the caller. Whatever it was, it was
    // not something they can act on, and the shape of it is not theirs to see.
    return json({ error: 'Something went wrong' }, 500);
  }
}

export const onRequestPost = (ctx) => handle(null, ctx);
