# DigiArtz — Security Hardening

Summary of the security review and the changes made.

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
