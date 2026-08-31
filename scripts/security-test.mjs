// Regression tests for the security controls in functions/. Each case here is
// a fix that had a way past it before, so a failure means the way back is open.
//
//   node scripts/security-test.mjs

import { readFileSync } from 'node:fs';
import { limitFor } from '../functions/lib/ratelimit.js';
import { sameOrigin, allowedHost, storedFileName, storedFileNameAscii } from '../functions/lib/http.js';

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`FAIL  ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
  else console.log(`ok    ${name}`);
}
function truthy(name, got) { check(name, !!got, true); }
function falsy(name, got)  { check(name, !!got, false); }

// --- every /api route carries an edge rate limit ------------------------------
// Webhooks are the two deliberate exemptions: they authenticate by signature and
// a limiter in front of them is a way to make a provider's retries fail.
const routes = [
  '/api/store', '/api/ops', '/api/collab', '/api/collab/promo-code',
  '/api/rzp', '/api/paypal', '/api/payouts', '/api/download',
  '/api/market-download', '/api/resource-download', '/api/moderate-upload',
  '/api/moderation/ban-user', '/api/admin/collab/add-partner',
  '/api/subscription/claim-max', '/api/something-added-tomorrow',
];
for (const r of routes) truthy(`rate limit covers ${r}`, limitFor(r));
check('webhook rzp exempt',    limitFor('/api/rzp-webhook'), null);
check('webhook paypal exempt', limitFor('/api/paypal-webhook'), null);
// The longest matching prefix wins, so /api/rzp does not inherit /api/'s 90.
check('most specific prefix wins', limitFor('/api/download').bucket, '/api/download');

// --- same-origin gate on the download endpoints -------------------------------
const req = (headers) => ({ url: 'https://digiartz.net/api/download', headers: new Headers(headers) });

falsy('no origin, no referer, no fetch metadata', sameOrigin(req({}), {}));
falsy('Sec-Fetch-Site: none (address bar)',       sameOrigin(req({ 'Sec-Fetch-Site': 'none' }), {}));
falsy('cross-site Origin',       sameOrigin(req({ Origin: 'https://evil.example' }), {}));
falsy('cross-site Referer',      sameOrigin(req({ Referer: 'https://evil.example/x' }), {}));
falsy('lookalike host',          sameOrigin(req({ Origin: 'https://digiartz.net.evil.example' }), {}));
truthy('same Origin',            sameOrigin(req({ Origin: 'https://digiartz.net' }), {}));
truthy('Sec-Fetch-Site: same-origin', sameOrigin(req({ 'Sec-Fetch-Site': 'same-origin' }), {}));
truthy('ALLOWED_ORIGINS entry',  sameOrigin(req({ Origin: 'https://staging.digiartz.net' }),
                                            { ALLOWED_ORIGINS: 'https://staging.digiartz.net' }));
falsy('ALLOWED_ORIGINS does not open the door to others',
      sameOrigin(req({ Origin: 'https://evil.example' }),
                 { ALLOWED_ORIGINS: 'https://staging.digiartz.net' }));

// --- signed URLs are only ever followed back to Supabase ----------------------
const SB = 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
truthy('project host allowed',      allowedHost(SB + '/storage/v1/object/x', SB));
truthy('sibling supabase host',     allowedHost('https://other.supabase.co/x', SB));
falsy('plain http refused',         allowedHost('http://tmqzqlrpjpydiftlrzmj.supabase.co/x', SB));
falsy('attacker host refused',      allowedHost('https://evil.example/x', SB));
falsy('suffix-glued host refused',  allowedHost('https://evil-supabase.co/x', SB));
falsy('userinfo trick refused',     allowedHost('https://tmqzqlrpjpydiftlrzmj.supabase.co@evil.example/x', SB));
falsy('file: refused',              allowedHost('file:///etc/passwd', SB));
falsy('garbage refused',            allowedHost('not a url', SB));

// --- Content-Disposition cannot be steered by a filename ----------------------
check('path separators stripped', storedFileName('../../etc/passwd'), '....etcpasswd');
check('quote stripped from the ascii form', storedFileNameAscii('a"; x="y'), 'a; x=y');
check('non-ascii folded in the ascii form', storedFileNameAscii('naïve.png'), 'na_ve.png');
check('empty name has a fallback', storedFileName(''), 'file');

// --- the action router answers to own properties only ------------------------
// ACTIONS/LIMITS are object literals, so 'constructor' and '__proto__' resolve
// to something truthy on Object.prototype. Reaching the call with fn = Object
// would return { env, request, body, user } — the service-role key included —
// straight into the JSON response.
{
  const collab = readFileSync('functions/api/collab.js', 'utf8');
  truthy('collab dispatch checks hasOwnProperty', /hasOwnProperty\.call\(\s*obj\s*,\s*key\s*\)/.test(collab));
  truthy('collab dispatch guards ACTIONS', /has\(ACTIONS,\s*name\)/.test(collab));
  truthy('collab dispatch guards LIMITS',  /has\(LIMITS,\s*name\)/.test(collab));
  truthy('collab dispatch requires a function', /typeof fn !== 'function'/.test(collab));
}

// --- no endpoint hands an internal error string back to the caller -----------
for (const f of ['download', 'market-download', 'resource-download', 'moderate-upload',
                 'rzp', 'paypal', 'payouts', 'collab', 'ops', 'store']) {
  const src = readFileSync(`functions/api/${f}.js`, 'utf8');
  falsy(`${f}.js does not return String(err) to the caller`, /detail:\s*String\(err\)/.test(src));
}

// --- the paypal capture path carries the buyer through to the earning --------
// recordEarning() reads row.user_id for buyer_id, which is NOT NULL: a select
// that omits it drops the seller's credit on the floor.
{
  const src = readFileSync('functions/api/paypal.js', 'utf8');
  truthy('capture select includes user_id', /select=id,user_id,kind,plan,item_id/.test(src));
}

// --- a payout is re-checked against the whole open set -----------------------
{
  const src = readFileSync('functions/api/payouts.js', 'utf8');
  truthy('request re-reads after insert', /claimedTotal\(env, user\.id, currency/.test(src));
  truthy('approve counts other commitments', /claimedTotal\(env, req\.user_id, req\.currency,\s*\n?\s*\['approved', 'processing'\]/.test(src));
  truthy('send re-checks before paying', /pot < Number\(req\.amount\) \+ alsoInFlight/.test(src));
}

// --- an upload never declares a content type the storage domain will render --
// koe-media is public. An object stored as text/html or image/svg+xml is a page
// on the project's storage hostname. The bucket's allowed_mime_types is the
// control; this is the half that keeps a legitimate .svg or .pdf asset
// uploading under that rule rather than being refused by it.
{
  const src = readFileSync('js/app-core.js', 'utf8');

  // pull the real function out of the shipped file and run it, rather than
  // re-implementing it here and testing the copy
  const list = src.match(/var UPLOAD_IMAGE_TYPES\s*=\s*\n?\s*(\[[^\]]*\]);/);
  const fn   = src.match(/function safeUploadType\(type\)\{[\s\S]*?\n  \}/);
  truthy('safeUploadType is present in app-core.js', list && fn);
  if (list && fn) {
    const safeUploadType = new Function(
      `var UPLOAD_IMAGE_TYPES = ${list[1]}; ${fn[0]} return safeUploadType;`)();

    check('webp passes through',      safeUploadType('image/webp'), 'image/webp');
    check('png passes through',       safeUploadType('image/png'), 'image/png');
    check('case is normalised',       safeUploadType('IMAGE/JPEG'), 'image/jpeg');
    for (const bad of ['text/html', 'image/svg+xml', 'application/xhtml+xml',
                       'application/pdf', 'text/xml', 'application/xml',
                       'text/plain', '', null, undefined, 'constructor', '__proto__']) {
      check(`${JSON.stringify(bad)} is declared as a download`,
            safeUploadType(bad), 'application/octet-stream');
    }
  }

  falsy('no PUT still sends the raw file.type',
        /'content-type'\s*:\s*(file|body)\.type/.test(src));
  truthy('the signed-target PUT normalises', /'content-type':\s*type,/.test(src));
  truthy('the legacy PUT normalises', /'content-type':safeUploadType\(file\.type\)/.test(src));
}

// --- marking a notification read is idempotent -------------------------------
// The DO UPDATE form of an upsert needs an UPDATE privilege the table has no
// policy for, so a re-mark used to throw.
{
  const src = readFileSync('js/auth.js', 'utf8');
  truthy('notification_reads upsert ignores duplicates',
         /notification_reads'\)\s*\n?\s*\.upsert\([\s\S]{0,120}ignoreDuplicates:\s*true/.test(src));
}

// --- no secret-shaped literal in anything the browser is served --------------
{
  const SECRET = /(eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,})|(\brzp_(live|test)_[A-Za-z0-9]{10,})|(\bsk_live_[A-Za-z0-9]{10,})|(\bAIzaSy[A-Za-z0-9_-]{20,})|(\bsb_secret_[A-Za-z0-9_-]{10,})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const { readdirSync } = await import('node:fs');
  const served = ['index.html', 'sw.js', 'uploadVerifier.js', 'aiAssistantData.js', 'config.example.js']
    .concat(readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => 'js/' + f));
  for (const f of served) falsy(`${f} carries no secret-shaped literal`, SECRET.test(readFileSync(f, 'utf8')));
}

// --- Round 4 -----------------------------------------------------------------

// The composer's moderation ticket reaches the insert. It used to be read for
// its verdict and dropped, which left the whole Gemini check advisory: the row
// carries status:'approved' and nothing on the database side asked whether the
// check had happened.
{
  const src = readFileSync('js/sections.js', 'utf8');
  truthy('sections.js keeps the moderation ticket', /modTicket\s*=\s*mod\.token/.test(src));
  truthy('sections.js sends it with the row', /if\(modTicket\)\s*row\.mod_token\s*=\s*modTicket/.test(src));
  truthy('only the gated sections carry one',
         /MOD_GATED\s*=\s*\{\s*resources:1,\s*marketplace:1,\s*blog:1\s*\}/.test(src));
  // A ticket lives ten minutes and is single-use; a scheduled row is published
  // hours later by a trigger the gate already trusts.
  truthy('a scheduled payload carries no stale ticket',
         /pk!=='status'\s*&&\s*pk!=='mod_token'/.test(src));
}

// The moderation endpoint spends real money at a third party on every call.
{
  const src = readFileSync('functions/api/moderate-upload.js', 'utf8');
  truthy('moderate-upload refuses cross-origin callers', /if \(!sameOrigin\(request, env\)\)/.test(src));
  truthy('moderate-upload rate-limits per account', /underLimit\(env, 'mod:' \+ user\.id/.test(src));
  truthy('moderate-upload caps the request body', /content-length/.test(src));
  // The old message named the variable AND the dashboard it lives in, to a
  // caller that had not signed in yet.
  falsy('moderate-upload does not name GEMINI_API_KEY to the caller',
        /error: 'Server not configured: GEMINI_API_KEY/.test(src));
}

// No endpoint hands an unclassified throw back to the browser. sbService()
// throws 'Database error (403)'; the catch-alls used to return err.message.
for (const f of ['rzp', 'paypal', 'payouts']) {
  const src = readFileSync(`functions/api/${f}.js`, 'utf8');
  falsy(`${f}.js does not return a bare err.message`,
        /error: \(err && err\.message\)/.test(src));
  truthy(`${f}.js filters errors through safeMessage`, /safeMessage\(err,/.test(src));
}

// The CSP names only origins the browser actually talks to. Gemini is called by
// the Worker, never by the page, so its origin in connect-src was one more place
// an injected script could have posted to.
{
  const headers = readFileSync('_headers', 'utf8');
  falsy('CSP does not allow the browser to reach Gemini',
        /generativelanguage\.googleapis\.com/.test(headers));
  const csp = (headers.match(/Content-Security-Policy: ([^\n]+)/) || [])[1] || '';
  truthy('CSP is present', csp.length > 100);
  for (const d of ['object-src \'none\'', 'base-uri \'self\'', 'frame-ancestors \'self\'']) {
    truthy(`CSP keeps ${d}`, csp.includes(d));
  }
  const connect = (csp.match(/connect-src ([^;]+)/) || [])[1] || '';
  falsy('connect-src carries no wildcard host', /(^|\s)\*(\s|$)/.test(connect));
}

// The edge function answers a named origin or no origin at all, never '*'.
{
  const src = readFileSync('supabase/functions/smart-function/index.ts', 'utf8');
  falsy('smart-function does not send ACAO: *',
        /"Access-Control-Allow-Origin":\s*"\*"/.test(src));
  truthy('smart-function checks the Origin against an allowlist',
         /allowedOrigins\(\)\.includes\(origin\)/.test(src));
  truthy('smart-function varies on Origin', /"Vary":\s*"Origin"/.test(src));
  // Deno.serve runs requests concurrently on one isolate: a module-level
  // mutable would let one request's Origin decide another's reply.
  falsy('smart-function holds no shared mutable cors binding',
        /^let cors/m.test(src));
  falsy('smart-function does not return the storage error text',
        /String\(\(e as Error\)\.message/.test(src));
}

// The migrations that closed the join-code leak have to keep saying so. A
// column-level REVOKE cannot carve a hole in a table-level GRANT, so the fix is
// specifically the drop-and-reissue pair, not the REVOKE on its own.
{
  const sql = readFileSync('supabase/migrations/20260831_community_join_code_scope.sql', 'utf8');
  truthy('communities_read is no longer USING (true)',
         /is_public\s*\n?\s*or owner_id = auth\.uid\(\)/.test(sql));
  truthy('anon\'s table-wide SELECT is dropped', /revoke select on public\.communities from anon/.test(sql));
  truthy('anon is re-granted column by column', /grant select \(/.test(sql));
  falsy('and join_code is not among the columns',
        /grant select \([^)]*join_code/s.test(sql));
}

// The edge functions. report-notify was live for months without ever being in
// this repository, which is how it kept an open email relay: it emailed
// whatever `body.record` said, and the gateway asks only for a JWT that every
// signed-in member holds.
{
  const src = readFileSync('supabase/functions/report-notify/index.ts', 'utf8');
  truthy('report-notify reads the report from the database',
         /loadReport\(id\)/.test(src) && /artwork_reports\`/.test(src));
  truthy('report-notify uses the service role for that read',
         /authorization: `Bearer \$\{SB_SVC\(\)\}`/.test(src));
  truthy('report-notify takes only an id from the request',
         /const id = String\(\(r && r\.id\) \?\? ""\);/.test(src));
  truthy('report-notify validates that id as a uuid', /UUID_RE\.test\(id\)/.test(src));
  truthy('report-notify refuses a report it cannot find',
         /if \(!row\) return new Response\("no such report"/.test(src));
  truthy('report-notify will not replay an old report', /FRESH_MS/.test(src));
  truthy('report-notify caps outbound mail', /dz_rate_take/.test(src));
  // The old body took every field from the caller.
  falsy('report-notify does not email the request payload',
        /esc\(r\.details\)|REASONS\[r\.reason\]/.test(src));
  falsy('report-notify does not return the Resend error body',
        /Resend error: \$\{t\}/.test(src));
  // A subject line is a header wherever it ends up.
  truthy('report-notify strips control characters from the subject',
         /subjectSafe/.test(src));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
