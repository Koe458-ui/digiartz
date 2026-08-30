# DigiArtz — Security Hardening

Summary of the security review and the changes made.

---

## Round 3 — 2026-08-30, full-scope audit

A ground-up pass over the whole surface: every Pages Function, every RLS
policy, every column grant, every SECURITY DEFINER function, both storage
buckets, the service worker, the workflow file, and all 79 commits of history.
Round 2's fixes all still hold — this round is what was left, plus two things
that were never in scope before (Postgres **grants**, as distinct from
policies, and the **storage bucket settings**, as distinct from the storage
policies).

Nothing here removes a capability a member had. `featured` stays a member's own
checkbox: it is an advertised part of the upload form, not a hole.

### Fixed — money

| # | What | Severity | Where |
|---|------|----------|-------|
| 1 | **A payout could be requested twice against the same balance.** `withdrawable()` reads, then the insert writes: two requests fired together both passed the check and both got created. `admin-decide` then weighed each one against the balance *on its own*, so both could be approved, and `admin-send` re-checked nothing before calling PayPal. Three gates, and a concurrent pair walked all three. Now: the request re-reads the open set once its own row is in it and withdraws itself if the total is over, approval counts what is already approved or in flight, and the send re-checks coverage as the last act before the money leaves | **HIGH** | `functions/api/payouts.js` |
| 2 | **The PayPal capture path dropped the seller's credit.** `recordEarning()` reads `row.user_id` for `buyer_id`, which is `NOT NULL`, and the capture handler's select did not ask for it — so the insert failed and was swallowed by the `.catch()`. The webhook rescued it only when `PAYPAL_WEBHOOK_ID` was set and the event actually arrived | HIGH (money, correctness) | `functions/api/paypal.js` |
| 3 | `payments.rzp_order_id` was unique; `pp_order_id` was not, though both are the key a webhook settles on | LOW | migration §4 |

### Fixed — authorization

| # | What | Severity | Where |
|---|------|----------|-------|
| 4 | **A free listing was downloadable whatever its status.** `dz_market_owns()` let any signed-in member fetch the file of any `price_cents = 0` listing — including one pulled for moderation, or still a draft. A *paid* purchase is deliberately still honoured regardless of status: somebody who paid keeps their download if the listing is later withdrawn | MEDIUM | migration §2 |
| 5 | **A second, weaker copy of that same rule.** `dz_market_download()` — the older RPC, still reachable over `/rest/v1/rpc` though nothing calls it — carried its own owner/free/paid test, and the copy had already drifted (no visibility check, no `kind` check). It now asks `dz_market_owns()` instead of re-deciding | MEDIUM | migration §2b |
| 6 | **`profiles` INSERT was granted on every column, entitlement columns included.** The guard named only `role`, `max_claimed` and `partner_since`. Nothing exploits this today — `handle_new_user()` writes the row the moment the account exists, so a member's own insert always collides on the primary key, and an upsert would need UPDATE privilege on columns they do not hold — but both of those are accidents of ordering rather than decisions. The guard now names the tier and merit columns too, and INSERT on them is revoked at the grant layer, which does not depend on trigger ordering at all | MEDIUM | migration §1 |
| 7 | **The action router answered to `Object.prototype`.** `ACTIONS[name]` with a caller-supplied `name`: `constructor`, `__proto__`, `toString` all resolve to something truthy. Reaching the call with `fn = Object` would have returned `{ env, request, body, user }` — the service-role key inside it — straight into the JSON response. It never got that far only because `LIMITS[name]` is destructured first and throws on the same keys. That is one refactor away from being the real thing | MEDIUM | `functions/api/collab.js` |

### Fixed — abuse and disclosure

| # | What | Severity | Where |
|---|------|----------|-------|
| 8 | **The public bucket accepted an upload of any size.** `koe-media` had no `file_size_limit`, and the only size check anywhere is the one `smart-function` makes against the size the **client declares** before minting the signed URL. Declare one byte, `PUT` a gigabyte, 400 times a day per account. The bucket now carries the same 400MB ceiling as `koe-originals`, which is what a Max member is granted anyway, so no legitimate upload changes | **HIGH** (cost / exhaustion) | migration §6 |
| 9 | **Engagement counters were the seller's to write.** `view_count` was pinned on the item tables and all four counters on `artworks`, but `like_count`, `bookmark_count`, `download_count` and `sales_count` on `marketplace_items`, `resources` and `blog_posts` were not. A seller could write their own social proof. The client only ever reads these; the new guard fires for a direct PostgREST write only, so the SECURITY DEFINER counter paths are untouched | LOW | migration §3 |
| 10 | **Internal error text was returned to callers.** `detail: String(err).slice(0, 200)` on all three download endpoints and the moderation endpoint, and the Gemini error body echoed into the moderation audit the browser gets back | LOW | `download.js`, `market-download.js`, `resource-download.js`, `moderate-upload.js` |
| 11 | Nine functions still had a floating `search_path`. All nine are SECURITY INVOKER so this is not the classic escalation — but two of them are `dz_has_link` and `dz_phish_score`, and an anti-phishing guard whose operator resolution depends on the caller's `search_path` is a guard with a seam in it. Every function in `public` is now pinned, definer and invoker alike | LOW | migration §5 |
| 12 | The workflow had no `permissions:` block, so every job on every pull request ran with the repository's default token scope. Now `contents: read` | LOW | `.github/workflows/checks.yml` |

### Checked and found correct

Recorded because "we looked" is worth as much as "we changed", and because the
next audit should not have to re-derive it:

- **Razorpay webhook** verifies HMAC-SHA256 over the **raw** body before any
  parse, with a length check and `timingSafeEqual`. **PayPal webhook** verifies
  through PayPal's own `verify-webhook-signature` API. Neither trusts the event
  before the signature.
- **Fulfilment is idempotent.** Both webhooks and both client-side verify paths
  settle with a conditional `PATCH … &status=eq.created` and act on the
  entitlement only when that returns a row. `marketplace_earnings` carries
  `UNIQUE (payment_id)`, so a replayed event cannot double-credit a seller.
- **No price comes from the client.** Plan prices come from
  `subscription_prices`, item prices from `marketplace_items`, support amounts
  are bounded by `support_limits`, and the webhook compares the amount the
  provider reports against the stored row before settling.
- **RLS and grants agree.** Every money table (`payments`, `payout_requests`,
  `marketplace_earnings`, `payout_methods`, `seller_tax`,
  `reconciliation_flags`, `ledger_entries`) carries a SELECT-only policy, so the
  broad `anon`/`authenticated` grants on them are inert — INSERT/UPDATE/DELETE
  have no policy and fail closed. Verified by attack, not by reading:
  `security/rls-regression.sql`.
- **`profiles` column grants are right.** `email`, `currency`, `max_claimed`
  and `partner_since` are not in the SELECT grant, so an anonymous read cannot
  reach them; UPDATE is granted on twelve display columns and nothing else.
- **`wallet_history` is `security_invoker=true`**, so the wide grants on the
  view resolve against the underlying policies rather than the view owner's
  rights. The `an_*` views are definer views and carry no grants at all.
- **Storage paths are owned.** Both buckets require `foldername(name)[2] =
  auth.uid()` to write, and `koe-originals` requires it to read. The edge
  function's upload signing does not check the path itself — it does not need
  to, because it signs through the caller's own token and RLS decides.
- **XSS.** Every innerHTML site that carries database text runs it through the
  local `esc`; every `href` built from a database column goes through
  `safeHref`, which requires `http:` or `https:` and so refuses `javascript:`.
  Swept `js/*.js` and `index.html` mechanically, not by eye.
- **Secrets.** All 79 commits scanned blob by blob for JWT shapes,
  `rzp_live_*`, `sk_live_*`, `AIzaSy*`, `sb_secret_*` and PEM private keys —
  nothing. `config.js` has never been tracked. `scripts/security-test.mjs` now
  re-runs that scan over every browser-served file on each push.
- **The service worker** never caches `/api/*` or the Supabase REST origin, so
  one member's response cannot be served to another.

### Tests

Two suites, both runnable, both of which fail if the fix is reverted — checked
by reverting each fix and watching them go red.

- `scripts/security-test.mjs` — 103 checks over the Pages Functions: rate-limit
  coverage of every route (including one that does not exist yet, so a new
  endpoint is covered the day it lands), the same-origin gate against seven
  forged-header cases, `allowedHost` against userinfo and suffix tricks,
  `Content-Disposition` filename escaping, the own-property dispatch guard, the
  absence of internal error text, the two payment fixes, and the secret scan.
  Wired into CI as its own job.
- `security/rls-regression.sql` — 22 checks against the live database,
  impersonating `anon` and two members the way PostgREST does. Every write
  attempt runs inside a PL/pgSQL sub-block that raises and catches its own
  exception, so an attack that *succeeds* is still rolled back and only the
  verdict survives; safe to run against production. Run 2026-08-30: 22/22 PASS,
  nothing left behind.

### Remaining risks

Honestly, and none of them newly introduced by this round:

| Risk | State | What closing it takes |
|---|---|---|
| **`koe-media` accepts any content type.** A member can upload `text/html` into the public bucket and get a working page on the project's storage domain. It cannot touch a digiartz.net session — different origin, and the CSP names no supabase.co host in `script-src` or `frame-src` — but it is a phishing page on a domain that looks like ours, two weeks after a phishing incident | **NOT FIXED** — deliberately | `allowed_mime_types` on the bucket. Not done blind: the list has to cover every extension in `smart-function`'s `ASSET_EXT` (archives, fonts, `.blend`, `.procreate`, brush sets), and one missing entry silently breaks that upload. Build the list from what is actually in the bucket today, then set it |
| **`'unsafe-inline'` and `'unsafe-eval'` in `script-src`** | NOT FIXED — carried from round 2 | `index.html` has inline scripts and a static `_headers` file cannot mint a nonce. `functions/_middleware.js` already rewrites the HTML and could |
| **Session tokens live in `localStorage`** (Supabase JS default) | ACCEPTED | Inherent to the SPA + PostgREST design. It is why the CSP item above matters more than it looks |
| **Leaked-password protection is still off** | NOT FIXED — **requires human action** | Supabase → Authentication → Passwords. Third round of asking |
| **Email confirmation before a first public write is still off** | NOT FIXED — **requires human action** | Supabase → Authentication → Providers → Email. The 2026-08-20 attacker posted two minutes after signup from an unverified throwaway |
| **No CDN/WAF rate limiting in front of the edge limiter** | ACCEPTED | The limiter in `_middleware.js` costs a Supabase round trip per request, so a volumetric flood still costs money before it is refused. Cloudflare WAF rate-limiting rules on `/api/*` would refuse at the edge for free |
| **`dz_rate_take` uses fixed windows** | ACCEPTED | A caller straddling a boundary gets up to 2× the limit in a burst. Sliding windows cost a table scan per call; not worth it at this scale |
| **158 SECURITY DEFINER functions are `anon`/`authenticated` executable** | REVIEWED, not changed | This is the RPC API — the surface is intentional. Every one that returns member data gates on `auth.uid()` internally; spot-checked the analytics, download, entitlement and profile families. About fifteen of them are trigger functions that Postgres will not let anyone call directly anyway; revoking EXECUTE would quiet the advisor without changing anything, and is not worth touching every write path to do |
| **Turnstile** is wired up but `TURNSTILE_SITE_KEY` is empty in `config.example.js` | UNKNOWN — check production | If the deployed `config.js` also leaves it empty, signup and sign-in have no bot control beyond the rate limiter |

### Verdict

**GO**, with two caveats that are not code:

- Both HIGH findings (the payout race, the unbounded public bucket) are fixed
  and tested. The one HIGH-adjacent money bug (the dropped PayPal earning) is
  fixed.
- The two dashboard settings — leaked-password protection and email
  confirmation — are the only findings in this round that nobody can fix from
  the repository. Both are one toggle each.
- Nothing here is "100% secure". The CSP still carries `'unsafe-inline'`, and
  while that is true, an XSS anywhere in the page reaches the session token.
  That is the single highest-value thing left to do.

---

## Round 2 — 2026-08-21, after the phishing incident

An account named **DigiArtzSupport** posted phishing comments under two
artworks on 2026-08-20. The full write-up — what was posted, how it evaded the
filters, and the cleanup — is in
[`INCIDENT-2026-08-phishing.md`](INCIDENT-2026-08-phishing.md). The short
version: `item_comments` had no content check of any kind, and the check that
existed elsewhere read the text as typed, so `https:5347567%2eshop/…` walked
past it.

### Live on production now

| # | Fix | Where |
|---|-----|-------|
| 1 | The attacker's account, profile and all 4 comments deleted; footprint verified empty across every table and storage | production |
| 2 | `dz_deobfuscate()` — decodes percent-escapes, homoglyphs, fullwidth and invisible characters, `[dot]`/` dot `, `hxxp` before anything is matched | `20260824_antiphish_content_guard.sql` |
| 3 | `dz_has_link()` / `dz_phish_score()` — link and scam-prose detection, matched against the decoded form | same |
| 4 | Content guard on `item_comments` (insert **and** update), the community rooms, direct messages, and ten description/body columns — 23 triggers | same |
| 5 | `dz_abuse_events` — **phishing attempts** logged with actor, IP, rule and sample; `dz_abuse_recent()` for staff | same |
| 6 | `item_comments.body` capped at 1000 characters | same |
| 7 | Reserved names — nobody can register or rename to anything containing "digiartz", or to `support`/`admin`/`verify`/… as a whole name. Checked on the folded form, so `D1giArtz_Support` is refused too | `20260824_reserved_names.sql` |
| 8 | Anonymous writes are rate limited — `dz_write_rate` used to return early whenever `auth.uid()` was null, which is every anon caller, not just cron | `20260824_rate_limits_everywhere.sql` |
| 9 | A global per-actor write ceiling above the per-table ones (240 / 5 min) | same |
| 10 | Limiters auto-attached to every member-writable table, found by asking `pg_policy` rather than by remembering — **27 previously unlimited write paths**, plus 23 delete paths | same |
| 11 | Signup limited to 6 accounts per hour per address | same |

### In this branch, live on deploy

| # | Fix | Where |
|---|-----|-------|
| 12 | Edge rate limit in front of **every** `/api/*` route, ahead of the router — ten of sixteen endpoints had none. Webhooks exempt (they verify signatures instead) | `functions/lib/ratelimit.js`, `functions/_middleware.js` |
| 13 | A real CSP: `script-src`, `connect-src`, `worker-src`, `frame-src`, `form-action` allowlists. This is the anti-crypto-miner control — a miner is a script from an unknown host plus a socket to a pool, and both halves are now refused | `_headers` |
| 14 | `Cross-Origin-Opener-Policy`, `X-Permitted-Cross-Domain-Policies`, tightened `Permissions-Policy` | `_headers` |
| 15 | Client filter catches the obfuscated link forms too, so a member sees their link starred rather than being refused by the server for something the page let them type | `js/badwords.js` (v2) |

### Two kinds of refusal, and why they differ

Postgres has no autonomous transactions, so a trigger that writes an audit row
and then raises an exception **rolls back its own audit row**. Rather than
install `dblink` and store a database password to work around that, the guard
picks the right refusal per rule:

- **Phishing** → the row is *dropped* (the trigger returns `NULL`), so the
  transaction commits and the evidence in `dz_abuse_events` survives. The
  sender sees their message simply not appear, and gets no error text to tune
  the next attempt against. This is the pattern `dz_chat_gate_comments`
  already used.
- **A plain link** → refused with a visible message, not logged. Whoever typed
  it is almost always a member linking their portfolio, and they need to know
  why it did not post.

So `dz_abuse_events` is a record of *attacks*, not of every refusal — which is
also what keeps it short enough to read.

### Secrets audit — clean

Checked, not assumed:

- **No secret value has ever been committed.** All 115 commits scanned for JWT
  shapes, `rzp_live_*`, `sk_live_*`, `AIzaSy*`, `sb_secret_*` and PEM private
  keys. Nothing.
- **`config.js` has never been tracked** — it is gitignored and generated at
  deploy time from Pages environment variables.
- **No client-served file references a secret's value.** The only occurrences
  of `SERVICE_ROLE`, `CLIENT_SECRET`, `WEBHOOK_SECRET` etc. anywhere in the
  tree are the *names*, in `config.example.js` documentation and in the Pages
  Functions that read them from `env` at runtime.
- **The config-status responses in `rzp.js` and `paypal.js` emit the missing
  variable's NAME only**, never its value.

Two things in client code are public **by design** and are not leaks, despite
looking like credentials:

- `SB_URL` (`https://tmqzqlrpjpydiftlrzmj.supabase.co`) — the browser has to
  know which server to talk to. It cannot be hidden from a client that must
  connect to it; every request reveals it.
- `SB_KEY` (`sb_publishable_…`) — the publishable key. It is designed to be
  public and carries no authority of its own: **Row-Level Security is what
  stands behind it**, which is exactly why the fixes above went into the
  database rather than into the page.

The keys that would matter if leaked — `SUPABASE_SERVICE_ROLE_KEY`,
`PAYPAL_CLIENT_SECRET`, `RAZORPAY_KEY_SECRET`, `MOD_SIGNING_SECRET`,
`GEMINI_API_KEY` — are read from `env` inside Pages Functions and never reach
the browser. That is already correct and was not changed.

### Still worth doing

1. **Leaked-password protection** — Supabase → Authentication → Passwords.
   Still not enabled; it was already item 2 in the list below.
2. **Require email confirmation before a first public write.** The attacker
   posted two minutes after signup from an unverified throwaway address.
3. **A report button on comments.** Items can be reported, individual comments
   cannot, so a reader who spots one of these has no way to tell you.
4. **Nonce-based CSP.** `'unsafe-inline'` is still in `script-src` because
   `index.html` has inline scripts and a static `_headers` file cannot mint a
   per-request nonce. `functions/_middleware.js` already rewrites the HTML and
   could inject one.

---

## Round 1 — the original review

## Verdict
No exposed secrets, no leaked Razorpay keys, payments are server-verified,
Row-Level Security is on for every table, and no user can promote themselves to
admin. The site was already **above average**. These changes close the
remaining gaps.

## Done (live / in this branch)

| # | Fix | Where | Status |
|---|-----|-------|--------|
| 1 | Security headers (clickjacking, HSTS, nosniff, referrer, base-uri, plugin block) — no CSP that would break AdSense/Razorpay | `_headers` | ✅ in branch, live on deploy |
| 2 | Pinned search_path on `community_channel_id` | Supabase | ✅ live now |
| 3 | Fail-open per-user upload rate limit (storage-bill abuse guard) | `smart-function` edge fn + `upload_events` table | ✅ live now |
| 4 | Moderation-gate plumbing: server-signed approval token issued + forwarded | `moderate-upload.js`, `upqueue.js`, `mod_token` columns | ✅ in branch (inert until activated) |
| 5 | Second checkout provider (PayPal) beside Razorpay, same server-verified ledger | `functions/api/paypal.js`, `payments.provider` | ✅ in branch |
| 6 | Everything about money moved behind a session check — module, provider names, plan prices, buy controls, endpoint paths | `functions/api/store.js` | ✅ in branch |
| 7 | `marketplace_items.price_cents` revoked from `anon` at the column level | Supabase | ✅ live now |
| 8 | `/api/*` never cached: explicit service-worker bypass + `no-store` in `_headers` | `sw.js`, `_headers` | ✅ in branch |
| 10 | `profiles.email` was world-readable — revoked (table grant dropped, columns re-granted by name) | Supabase | ✅ live now |
| 11 | Members could self-grant `subscription_tier`/`role` — UPDATE now column-scoped | Supabase | ✅ live now |
| 12 | Immutable hash-chained ledger + reconciliation gate before every withdrawal | `ledger_entries`, `dz_reconcile` | ✅ live now |
| 13 | `publish_due_scheduled_sections` and trigger functions no longer callable over REST | Supabase | ✅ live now |
| 9 | `security/` no longer served — the repo root is the deploy output, so every `.sql` here was downloadable | `functions/security/[[path]].js` | ✅ in branch |

## What YOU need to do

### 🔴 1. Storage spend alarm (do today — this is your bill protection)
Media now lives in Supabase Storage, so the bill to watch is Supabase's, not
AWS's. Supabase Dashboard → **Organization → Billing → Usage / spend cap** →
keep the spend cap on so a traffic spike cannot run past the Free tier's
included egress. Egress is the metered part: the service worker caches the two
sizes the grid and lightbox actually request, which is what keeps it small.

### 🟠 2. Turn on leaked-password protection (30 seconds)
Supabase Dashboard → **Authentication → Policies / Passwords** →
enable **"Prevent use of compromised passwords."**

### 🟠 3. Activate the moderation gate (when ready to test)
1. Deploy this branch to production.
2. Cloudflare Pages → **Settings → Environment variables → Production** →
   add `MOD_SIGNING_SECRET` = the secret Claude gave you in chat → redeploy.
3. Upload one artwork to confirm it still publishes normally.
4. Only then, in the Supabase SQL editor, with the SAME value:

   ```sql
   update private.mod_config
      set secret = '<the same secret as MOD_SIGNING_SECRET>'
    where id = true;
   ```

   Order matters. Setting the secret before the Worker can mint a ticket means
   every insert fails the check and every upload silently lands in `pending`.
5. Test again: a normal upload still publishes; a direct insert without a valid
   token now lands in `status='pending'` instead of going public.

If anything looks off, the gate **fails safe** (uploads go to review, never
error) and rolls back instantly:

```sql
-- make it inert again, dropping nothing
update private.mod_config set secret = '' where id = true;

-- or remove it entirely
drop trigger  if exists trg_artwork_mod_gate on public.artworks;
drop function if exists public.dz_artwork_mod_gate();
drop table    if exists private.used_mod_tokens;
drop table    if exists private.mod_config;
```

To check which state it is in:

```sql
select case when secret = '' then 'inert' else 'enforcing' end
  from private.mod_config where id = true;
```

The secret is a credential: it belongs in the Cloudflare dashboard and the
database, never in git.

## Payment exposure — what is and is not hidden

Everything up to the moment a signed-in buyer opens the checkout sheet is
gated. A signed-out visitor, a crawler or anyone reading page source gets no
provider name, no plan price, no buy control, no `/api` checkout path, and
cannot read a listing's price off the API either. `index.html`, `sw.js`,
`js/sections.js` and `aiAssistantData.js` were all scrubbed, changelog
included.

What cannot be hidden, and should not be mistaken for a gap: once the sheet is
open, the module is running in the buyer's own browser and the provider's
public identifier (`PAYPAL_CLIENT_ID` / `RAZORPAY_KEY_ID`) is in the script URL
it loads. Both are designed to be public and are useless without their
secrets. `PAYPAL_CLIENT_SECRET`, `RAZORPAY_KEY_SECRET` and `SB_SERVICE_KEY`
never leave the Worker.

Two things were left public on purpose:
- The **Billing & Payments FAQ** (refunds, no auto-renew, cancellation). It
  names no provider and quotes no price, and both Razorpay and PayPal require
  a publicly reachable refund/cancellation policy as a condition of merchant
  approval — hiding it risks the activation still pending.
- The **seller-side price field** in the marketplace composer, and the
  `.subCard` / `.subGrid` style rules. Neither carries an amount or a provider;
  removing them would break listing creation and leave the injected plan grid
  unstyled.

### PayPal environment variables (Cloudflare Pages → Settings → Environment variables)
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV` (`sandbox` for
testing; anything else, or unset, means live). Never put these in `config.js` —
that file is served to every visitor. With only these bound and the Razorpay
pair absent, PayPal is the only provider offered and the buyer sees no chooser.

## Known residual (lower priority)
- The `scheduled_uploads` path carries the token but is not yet gated (its
  columns differ). Handle it as a follow-up if scheduled posting needs the
  same enforcement.
- Full image-content binding (stopping a "moderate image A, upload image B"
  swap) needs an upload-first redesign — a larger change for later.
