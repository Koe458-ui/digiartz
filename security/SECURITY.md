# DigiArtz — Security Hardening

Summary of the security review and the changes made.

## Verdict
No exposed secrets, no leaked AWS/Razorpay keys, payments are server-verified,
Row-Level Security is on for every table, and no user can promote themselves to
admin. The site was already **above average**. These changes close the
remaining gaps.

## Done (live / in this branch)

| # | Fix | Where | Status |
|---|-----|-------|--------|
| 1 | Security headers (clickjacking, HSTS, nosniff, referrer, base-uri, plugin block) — no CSP that would break AdSense/Razorpay | `_headers` | ✅ in branch, live on deploy |
| 2 | Pinned search_path on `community_channel_id` | Supabase | ✅ live now |
| 3 | Fail-open per-user upload rate limit (AWS-bill abuse guard) | `smart-function` edge fn + `upload_events` table | ✅ live now |
| 4 | Moderation-gate plumbing: server-signed approval token issued + forwarded | `moderate-upload.js`, `upqueue.js`, `mod_token` columns | ✅ in branch (inert until activated) |

## What YOU need to do

### 🔴 1. AWS budget alarm (do today — this is your bill protection)
AWS Console → **Billing → Budgets → Create budget** → set a monthly amount
(e.g. $5) with an **email alert**. Your AWS key is NOT exposed anywhere, but a
budget alarm means no cost can ever surprise you.

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

## Known residual (lower priority)
- The `scheduled_uploads` path carries the token but is not yet gated (its
  columns differ). Handle it as a follow-up if scheduled posting needs the
  same enforcement.
- Full image-content binding (stopping a "moderate image A, upload image B"
  swap) needs an upload-first redesign — a larger change for later.
