# Things only an operator can do

Four security items are outside what a database connection or a repository
checkout can reach. They are listed here because "we could not do it from the
audit environment" is a reason to write it down, not a reason to drop it.

Each one says what it is, why it cannot be automated from here, and exactly what
to click or run.

---

## 1. Branch protection on `main` — HIGH

`main` has none. No required review, no required status check, force-push not
blocked — and `main` is what Cloudflare Pages deploys. So the eight CI jobs
advise and gate nothing: a pull request with every check red can be merged, and
history on the branch that becomes production can be rewritten.

**Why not automated:** the GitHub MCP server exposes no branch-protection or
repository-settings endpoint. Nothing in this session could set it.

**Do this:** Settings → Branches → Add branch ruleset, target `main`:

- Require a pull request before merging — **1 approval**, or 0 if you are
  routinely the only committer. Even at 0, the PR requirement is what makes the
  status checks below able to block.
- Require status checks to pass. Add all eight: `precache`, `cachebust`,
  `overlays`, `sections`, `cache`, `security`, `sql`, `syntax`.
- Block force pushes.
- Do **not** tick "Allow specified actors to bypass" for yourself. A rule you
  can walk past is a rule that will be walked past on the day it matters.

With two collaborators this costs one extra click per change and buys the thing
CI was written for.

---

## 2. Supabase Auth settings — MEDIUM

Two toggles, both dashboard-only. The Management API surface available here does
not expose Auth configuration.

**Leaked password protection** is **off** — the `auth_leaked_password_protection`
advisor reports it on every run of this audit. Turning it on makes Supabase check
new passwords against HaveIBeenPwned. Authentication → Providers → Email →
enable "Prevent use of leaked passwords".

**Captcha enforcement is unverified.** `js/auth.js` obtains a Turnstile token and
passes it to Supabase as `captchaToken`, which is the right place to verify it —
but if the toggle is off, Supabase ignores the token and the widget is
decoration. Authentication → Settings → Bot and Abuse Protection → confirm
Turnstile is enabled and the secret key is set. Also confirm
`TURNSTILE_SITE_KEY` is non-empty in the deployed `config.js`; it is generated at
deploy from Pages environment variables and is gitignored, so it cannot be
checked from the repository.

---

## 3. Storage quota — MEDIUM

See `security/STORAGE-QUOTA.md`. Short version: every upload limit lives in
`smart-function`, which a member can skip by talking to the storage API
directly, and `storage.objects` is owned by `supabase_storage_admin` — the
project's `postgres` role is not a member, so `CREATE TRIGGER` and
`CREATE POLICY` on it both fail with `42501` from a migration. The function to
call is written and can be applied normally; only the two policy edits need the
Dashboard.

---

## 4. Live HTTP verification — UNKNOWN, not a finding

The audit environment's network policy denies egress to `digiartz.net` **and**
`tmqzqlrpjpydiftlrzmj.supabase.co`; only the Postgres connection is reachable.
So nothing in this audit tested live HTTP. `_headers` was read as a statement of
intent, not confirmed as behaviour.

**Do this** from any machine that can reach the site:

```sh
curl -sSI https://digiartz.net/ | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy|x-frame'
curl -sSI https://digiartz.net/api/store            # expect 401, no-store, nosniff
curl -sSI https://digiartz.net/supabase/migrations/20260901000000_baseline.sql   # expect 404
curl -sSI https://digiartz.net/security/SECURITY.md                              # expect 404
curl -sSI https://digiartz.net/scripts/security-test.mjs                         # currently 200
curl -sS  -H 'Origin: https://evil.example' -I https://digiartz.net/api/download # expect no ACAO echo
```

The two `[[path]].js` catch-alls should make `/supabase/*` and `/security/*`
return 404 rather than serving the schema and these notes as files.
`/scripts/*.mjs` has no such blocker and is currently served; harmless while the
repository is public, worth a third catch-all if that ever changes.

---

## Not doing, and why

**Removing `'unsafe-inline'` / `'unsafe-eval'` from the CSP.** Both are real
weaknesses. `'unsafe-inline'` cannot go until every inline `onclick=` in
`index.html` does, which is a large refactor of working code, and a nonce is
meaningless until then. `'unsafe-eval'` is most likely there for the Razorpay
and PayPal SDKs; removing it blind breaks checkout for everyone and the audit
environment cannot load either SDK to find out. Both want a staged test on a
preview deployment, not a guess in a security pass.

**Making the repository private.** It is public, and that is a choice rather
than a defect: no secret has ever been committed, and the security of this
system does not rest on anyone not reading it. Worth knowing that it means
attackers read every policy, every guard and every rate limit — which is the
correct assumption to design under anyway.
