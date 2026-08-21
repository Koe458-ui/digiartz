# DigiArtz — Security Hardening

Summary of the security review and the changes made.

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
4. Run `security/activate-moderation-gate.sql` in the Supabase SQL editor
   (paste the SAME secret into it first).
5. Test again: a normal upload still publishes; a direct insert without a valid
   token now lands in `status='pending'` instead of going public.

If anything looks off, the gate **fails safe** (uploads go to review, never
error) and rolls back instantly — see the top of the SQL file.

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
