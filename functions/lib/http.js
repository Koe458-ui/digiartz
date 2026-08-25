// One copy of the request and response plumbing every Function repeats.
//
// The three download gates — functions/api/download.js, market-download.js and
// resource-download.js — are three endpoints doing three different things with
// three different entitlement questions, and they had four helpers between
// them that were the same text in all three: the same 24-line sameOrigin, the
// same allowedHost, the same json, the same UUID_RE. They are here because a
// same-origin check that gets tightened in one gate and not the other two is a
// hole in whichever gate was missed, and nothing about those checks depends on
// which gate is asking.
//
// niceName and asciiName are NOT here. All three files have a pair and the
// three pairs are not the same function: the artwork gate appends an extension
// derived from the source url and the content type, because an artwork's row
// carries a title and not a filename, and the other two are handed a real
// filename by the database and must not touch it. Folding those together would
// mean a flag that means "invent an extension", which is a worse thing to read
// than two short functions that each say what they do.

// Every table these endpoints address keys on a uuid, so anything else is not
// an id that could exist. It is also the whole of the injection guard on the
// PostgREST calls that take one: nothing but a uuid ever reaches them.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The request has to have come from a page we serve.
// Sec-Fetch-Site is the primary signal: browsers set it themselves and page
// script cannot override it, so a fetch() from another site cannot claim
// same-origin. Origin and Referer are the fallback for anything that omits it,
// and no browser signal at all — a scripted client — is refused.
export function sameOrigin(request, env) {
  const h = request.headers;
  let host = '';
  try { host = new URL(request.url).host; } catch { return false; }

  const allowed = new Set([host]);
  for (const extra of String(env.ALLOWED_ORIGINS || '').split(',')) {
    const v = extra.trim();
    if (!v) continue;
    try { allowed.add(new URL(v.includes('://') ? v : 'https://' + v).host); }
    catch { allowed.add(v); }
  }

  const site = h.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';

  for (const name of ['Origin', 'Referer']) {
    const raw = h.get(name);
    if (!raw) continue;
    try { return allowed.has(new URL(raw).host); } catch { return false; }
  }
  return false;
}

// Only our own storage host may be fetched and streamed back. The url always
// comes from the signer or from a column the browser cannot write, so this is
// a backstop against a poisoned row rather than a trust boundary.
export function allowedHost(url, sbUrlStr) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  try { if (u.hostname === new URL(sbUrlStr).hostname) return true; } catch { /* keep checking */ }
  return u.hostname.endsWith('.supabase.co');
}

// Storage paths are stored raw; the url they go into is not raw.
export function encodePath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

// Every one of these answers is per-caller and none of them may be held by a
// cache between two callers, so no-store is not a parameter.
export function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extra || {}),
    },
  });
}
