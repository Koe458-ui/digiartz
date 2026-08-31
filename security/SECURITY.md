# DigiArtz — Security Hardening

Summary of the security review and the changes made.

---

## Round 4 — 2026-08-31, the predicates and the grants under them

Rounds 1 to 3 read the code. This round read the **live catalogue** — every RLS
policy expression, every column grant, both buckets' policies, and the trigger
set — and compared each one against what the callers in `js/` actually need. The
advisor is no help here: it reports whether a policy *exists*, not what it says,
and every finding below sat behind a policy that existed.

Two findings were exploitable today. The rest are the layer under them.

### HIGH — every private community's join code was world-readable

`cm_join(name, code)` is the whole gate on a private room: match the name, match
the code, you are a member, and `can_read_community()` then opens every post in
it. Both halves of that secret were public.

`communities_read` was `USING (true)` for `anon` and `authenticated` alike, and
`join_code` sat in a table-level SELECT grant held by both roles. So:

```
GET /rest/v1/communities?select=name,join_code&is_public=is.false
```

with the publishable key that ships in `config.js` returned the key to every
private room on the site, to a caller who was not signed in. There are no
private rooms on production right now, which is the only reason this is a
latent hole rather than a live one — the first one created would have been open
from the moment it existed.

Fixed in two places, because either alone leaves a way round:

- The read policy is now `is_public OR owner_id = auth.uid() OR
  can_read_community(id)`. A private room is visible to its owner and its
  members and to nobody else, so the row carrying the code is not selectable.
- `join_code` left `anon`'s grant entirely — a signed-out visitor has no
  management screen and never needed the column.

**Two things went wrong on the way to that fix, and both are worth recording.**

The first: `revoke select (join_code) ... from anon` returned success and
changed nothing. `anon` held SELECT on the whole table (`anon=r` in `relacl`),
and a column-level REVOKE cannot carve a hole in a table-level grant. This is
the same silent no-op Round 3b hit from the other direction. The grant has to be
dropped and re-issued column by column, which is what
`20260831_community_join_code_scope.sql` now does. Verified after applying, not
assumed: `has_column_privilege('anon', ..., 'join_code', 'SELECT')` is false.

The second, worse: the first version of the policy tested membership with an
inline `exists (select 1 from community_members ...)`. A policy expression is
evaluated **as the calling role**, and `anon` holds no SELECT on
`community_members` — correctly. Every anon read of `public.communities` then
raised `permission denied for table community_members`, which emptied the
signed-out community page. The regression probe caught it before it went
anywhere. `can_read_community()` is SECURITY DEFINER and is what the `comments`
policy already uses for this exact question, so the lookup now happens as its
owner and the caller needs no grant.

### HIGH — the AI moderation check was skippable for everything except art

`artworks` has been gated since Round 3 by `dz_artwork_mod_gate()`. Resources,
marketplace listings and blog posts were not.

The composer in `js/sections.js` does the right thing on its face: it posts the
preview to `/api/moderate-upload`, refuses to continue if Gemini says no, and
receives a signed ticket back. It then **threw the ticket away** and inserted
the row itself with `status: 'approved'`. Nothing on the database side asked
whether the check had happened — the RLS policy on those tables is
`auth.uid() = user_id AND current_merit() >= 80` and says nothing about status.
So the check was a courtesy the client extended to itself:

```
POST /rest/v1/resources
{ "user_id": "<me>", "title": "...", "status": "approved",
  "visibility": "published", ... }
```

published straight to the front page, past Gemini, from curl. Given what the
2026-08-20 incident was, this is that door with a different handle.

`dz_section_mod_gate()` generalises the artwork gate onto the three tables. Same
HMAC over `uid.exp.jti`, same shared secret, same `private.used_mod_tokens`
burn-on-use — one moderation pass buys one publish, whatever section it lands
in. It fails the way the artwork gate fails: a missing, malformed, expired or
replayed ticket does not raise, it rewrites `status` to `'pending'`, so a bad
deploy sends work to review rather than breaking the composer. `js/sections.js`
now carries the ticket it was already being handed.

One deliberate exception: a **blog cover is optional**, and
`/api/moderate-upload` cannot mint a ticket for an image nobody uploaded.
Demanding one unconditionally would have sent every cover-less post to a review
queue nobody staffs, which is not moderation, it is breakage. The trigger takes
an optional column name and skips the ticket requirement when that column is
null. `resources` and `marketplace_items` pass no argument on purpose — their
preview is required, and an insert must not be able to buy itself an exemption
by leaving the column out. A cover-less post is still guarded: `dz_content_guard`
runs on `blog_posts.body`, which is the control the phishing incident called for.

**This gate ships INERT and there is a manual step to finish it — see “What YOU
need to do” below.** `private.mod_config.sections_enforced` defaults to false
because the artwork secret is already live: turning it on before the browser is
sending tickets would send every new listing to `'pending'`.

### MEDIUM — three more read predicates that were wider than they read

- **`comics_select_public` was `USING (true)`.** The table also carried
  `comics_anon_read` limiting anon to approved rows — but policies for the same
  command are OR-ed, so the permissive one decided every read and a comic in
  `pending` or `rejected` was as readable as an approved one, to a caller who
  was not signed in. Now `status = 'approved' OR user_id = auth.uid()`, the same
  rule the other content tables use.

- **`album_items_read` was `USING (true)`.** `get_album_artworks()` is careful —
  it returns a private album's contents only to its owner. The table underneath
  it was not, so selecting `album_items` by `album_id` listed the artwork ids
  inside any private album, straight past the check the RPC exists to make. The
  new policy *is* the RPC's predicate, so the two now agree by construction.

- **`mod_token` arrived readable and writable.** `grant insert (mod_token)` was
  meant to be the whole of it; `resources`, `blog_posts` and `artworks` already
  carry table-wide SELECT and UPDATE grants for `authenticated`, and a
  table-level grant covers columns added later — the join-code trap from the
  opposite direction. Readable is harmless (both gates null the column before
  the row lands). Writable is not: the gates are BEFORE INSERT, so an UPDATE
  never reaches them, which left `mod_token` as a free-text column any member
  could write after the fact and, on the three tables with a public read policy,
  anyone could read. `dz_content_guard` does not run on it. Closed at the data
  level rather than by re-issuing every grant on those tables: a BEFORE UPDATE
  trigger nulls it for `anon` and `authenticated`, so it can never hold a value.
  `artworks` included — it had the same latent column since Round 3.

### MEDIUM — the moderation endpoint was an open tap on a metered API

`/api/moderate-upload` bills Gemini once per image and had no same-origin check
and no per-account limit of its own. The edge limiter counts *requests* (20/min),
and the endpoint accepts six images per request — 120 images a minute per
account, and a cross-origin page could fire them even though it could not read
the reply. It now refuses cross-origin callers, takes a second bucket keyed to
the account and sized to what actually costs money, and rejects an oversized
body from `content-length` before `formData()` pulls it into memory.

It also announced `Server not configured: GEMINI_API_KEY missing in Cloudflare
environment variables` — naming the variable and the dashboard it lives in — to
a caller that had not signed in yet. The config check now runs after auth and
says nothing.

### MEDIUM — internal errors reaching the browser

`rzp.js`, `paypal.js` and `payouts.js` all ended in
`catch (err) { return json({ error: err.message }) }`. `sbService()` throws
`Database error (403)` and `sbRpc()` threw `Could not read your balance (403)`,
so a prober learned exactly which call it had reached and how it failed.

Only a message deliberately written for a person to read now comes back. The
providers' own descriptions ("international cards are not supported") carry a
`userFacing` flag and survive, because those are what a buyer needs; everything
else collapses to one sentence. `payout_requests.review_note` gets the same
filter — it is seller-readable, and it was being written with the raw throw.

`smart-function` had the same shape: `createSignedUploadUrl()`'s error text
names buckets, object keys and the policy that refused, and it was returned
verbatim.

### LOW — least privilege, and a wildcard closed

- **`anon` is now read-only.** Seventeen tables carried INSERT/UPDATE/DELETE
  grants for `anon`, and six carried SELECT on tables that are entirely own-row
  (`cart_items`, `friendships`, `item_likes`, `item_bookmarks`,
  `scheduled_sections`, `user_tag_prefs`, plus `marketplace_earnings` and
  `payout_requests`). None was reachable — every policy in front of them
  compares a column to `auth.uid()`, which is NULL for a signed-out caller.
  That is *why* it was worth doing: today RLS is the only thing between `anon`
  and every row of `marketplace_earnings`. A policy dropped by accident, a table
  rebuilt without one, an `alter table ... disable row level security` in the
  wrong window — any of those turns a live grant into a live read. A grant that
  was never there cannot. No answer the API gives today changes.

- **`storage_user_upload_own_folder` was granted to PUBLIC**, not to
  `authenticated`. Not exploitable — both halves of its predicate are
  NULL/false for a signed-out caller, and `anon` holds no INSERT on
  `storage.objects` — but "not exploitable because two other things happen to be
  true" is not "cannot apply", and this is the INSERT policy on the bucket the
  whole site serves images from. Every sibling policy already says
  `authenticated`.

- **Three storage policies keyed on `auth.email() = '<a personal address>'`.**
  Not forgeable (GoTrue will not move an address without confirming it), but it
  made an admin grant depend on a mutable identity claim rather than the role
  column every other privileged check on this project reads, hardcoded a
  personal address into schema committed to git, and could not be handed to a
  second admin or taken back without a migration. Now `is_dev()`, which one
  UPDATE revokes. Verified first that the account at that address holds
  `role = 'dev'`, so the same person keeps the same access.

- **`Access-Control-Allow-Origin: *` on the edge function** — carried as a known
  residual since Round 3. Still not exploitable for the reason Round 3 gave, but
  now an allowlist (`ALLOWED_ORIGINS`, plus the site's own origins). An unknown
  or absent Origin gets no ACAO header, so a browser refuses the response while
  a server-to-server caller is unaffected. **Deployed — `smart-function` v27**,
  and the deployed source was read back and compared against what was sent
  before this was called done. Fixing it turned up a bug in my own first
  attempt: a module-level `let cors` would have let one request's Origin decide
  another's reply, since `Deno.serve` runs requests concurrently on one isolate.
  It is request-scoped now, and the regression suite asserts the mutable is gone.

- **`connect-src` allowed `https://generativelanguage.googleapis.com`.** Gemini
  is called by the Worker, never by the page. With `'unsafe-inline'` still in
  `script-src`, every origin in `connect-src` is a place an injected script may
  post to; this one bought nothing. Removed.

### HIGH — an edge function that was live, unaudited, and an open email relay

The project has **five** deployed edge functions. Two are in this repository.
The other three had never been read by any round of this review, because
nothing in the repo pointed at them.

`report-notify` mails the owner when an artwork report is filed. It took
`body.record` from the request and emailed its contents. The payload is
*supposed* to come from a database webhook — but nothing checked that it had,
and the gateway asks only for a valid JWT, which every signed-in member holds.
So any member could POST a JSON body of their choosing and have the function
send mail, with content they chose, to the owner's personal inbox, as often as
they liked. That is three things at once: an inbox flood, a Resend quota burn,
and a phishing lure wearing the site's own return address — which is precisely
the shape of the attack this project has already had once. It also returned
Resend's error body to the caller verbatim.

Rewritten so the request supplies exactly one thing: an id. Every word of the
email is now read back out of `artwork_reports` on the service role, so the
worst a forged call can do is re-send an alert about a report that genuinely
exists — and even that is closed off, because only a report filed in the last
ten minutes is mailed and `dz_rate_take` caps the hourly send. It fails closed:
no row, no mail. Deployed (v7).

The other two, `storage-copy` and `t600-probe`, are already inert stubs that
return 410 — one-shot migration tools whose bodies were removed when their job
finished. They hold nothing and can do nothing. They should still be deleted,
because a slug that answers is a slug someone can probe; see below.

The lesson is the inventory, not the bug. **A deployed function that is not in
the repository will not be audited, because nobody knows to look for it.**

### Cleanup — four read policies that granted nothing their neighbour did not

Not a finding on its own; the same hazard as the comics one, caught before it
cost anything. Policies for one command are OR-ed, so a table carrying several
is decided by the most permissive, and a reviewer reading the narrow-looking
sibling comes away with the wrong idea of what the table allows. `comics` was
exactly that: a sensible `status = 'approved'` policy for anon sitting beside a
`USING (true)` for everyone, and the second one decided every read.

Two tables still carried the pattern:

| table | dropped | kept |
|---|---|---|
| `artworks` | `artworks_anon_read` {anon} `status='approved'` | `public read approved` {PUBLIC} `status='approved' OR user_id=auth.uid()` |
| `profiles` | `profiles public read` {PUBLIC} `true`, `profiles_anon_read` {anon} `true`, `profiles_select_own` {PUBLIC} `auth.uid()=id` | `profiles_select_public` {anon, authenticated} `true` |

Every dropped policy is a strict subset of one that stays — PUBLIC covers anon,
and for a signed-out caller `auth.uid()` is NULL, so the kept `artworks` policy
reduces to exactly the dropped one's predicate. Three of the four `profiles`
policies were three ways of writing `true`. The survivor names its roles rather
than relying on PUBLIC, which also narrows it slightly: `service_role` and
`postgres` bypass RLS and never needed a policy.

Six read policies became two, and it was measured rather than reasoned about:
anon saw 15 profiles and 25 artworks before and after, a member saw the same,
and a member could still see their own unapproved artwork — the one branch only
the surviving policy provides — while another member and anon could not.

Profiles stay world-readable on purpose; usernames, bios and avatars are the
public face of the site. What keeps that honest is the column-grant layer, not
these policies: `email`, `currency`, `max_claimed` and `partner_since` are not
selectable by `anon` or `authenticated` at all.

**Left alone deliberately:** the two INSERT policies on `comments`. They look
like a duplicate pair and are not — one covers `channel <> 'official'`, the
other `channel = 'official' AND is_dev()`. Disjoint cases, both load-bearing.
`security/rls-regression.sql` now asserts zero *stacked SELECT* policies rather
than zero stacked policies, so this split stays legal.

### Looked at and found correct

Worth saying explicitly, because "no finding" is a result:

- **No SQL injection anywhere.** Only two SECURITY DEFINER functions build
  dynamic SQL. `publish_due_scheduled_sections()` uses `quote_ident` over a
  whitelist of four tables and filters the payload's keys against
  `information_schema.columns`. `search_artworks()` escapes LIKE wildcards
  before interpolating. Every PostgREST filter built in `functions/` is
  interpolated from a value already validated against a UUID, `^[A-Z]{3}$`,
  `^[a-z,]{1,60}$` or similar.
- **The payment paths.** Amounts are always re-derived server-side from
  `subscription_prices` or `marketplace_items.price_cents`, never taken from the
  request. Razorpay's signature check and the PayPal capture both use
  `crypto.subtle.timingSafeEqual` after a length check. Settlement is idempotent
  through `status=eq.created` on the PATCH. The webhook signature checks are
  correct.
- **Column grants on `profiles`.** `email`, `currency`, `max_claimed` and
  `partner_since` are not selectable by `anon` or `authenticated`, and
  `subscription_tier` / `subscription_expires_at` / `role` are not updatable —
  belt (`protect_privileged_cols`), braces (`dz_profiles_guard_privileged`) and
  the grant layer all agree.
- **XSS.** Every builder in `js/` that concatenates HTML runs its values through
  an `esc()`; user-supplied URLs pass `safeHref()`, which admits only `http:` and
  `https:`. `functions/_middleware.js` writes meta through HTMLRewriter's
  escaping API and `<\/` -escapes its JSON-LD. Both storage buckets exclude
  `text/html`, `image/svg+xml` and every `text/*` from `allowed_mime_types`, so
  an uploaded object cannot be a page on the storage hostname.
- **Upload paths are bound to the uploader by storage RLS**, not by the edge
  function's own arithmetic, and `koe-media` has no UPDATE policy for members —
  so one member cannot overwrite another's object.
- **RLS is enabled on all 74 public tables**, and an event trigger
  (`rls_auto_enable`) turns it on for any new one.

### Tests

- `scripts/security-test.mjs` — 49 new assertions on this round's fixes, on top
  of the existing suite. All pass.
- `security/rls-regression.sql` — 7 new live assertions covering this round:
  anon cannot read `join_code`; no `USING (true)` left on communities, comics or
  album_items; **zero tables with stacked SELECT policies**; zero anon write
  grants; zero loose storage policies; 3 section mod gates; 4 mod_token update
  guards. Run against production, all 7 match.
- The other five suites (`check-precache`, `check-overlays`, `check-sections`,
  `cache-test`, `check-css-dead`) and `check-cachebust` — all pass.
- Every `.js`/`.mjs` in `js/`, `functions/`, `scripts/`, plus `sw.js` and
  `uploadVerifier.js`, parses under `node --check`.
- **Live behavioural probes against production**, each one run inside a
  transaction that raises at the end so it rolls back, and each one verified
  afterwards to have left no rows behind:
  - private room: non-member `0`, anon `0`, owner `1`, after joining `1`; anon
    reading `join_code` → permission denied
  - `album_items`: other user sees `0` of a private album, owner sees `1`
  - `comics`: other user sees `0` of a pending comic, owner sees `1`
  - section gate: inert+no ticket → `approved`; enforcing+no ticket → `pending`;
    valid ticket → `approved`; replayed → `pending`; expired → `pending`;
    non-approved insert untouched; dev without a ticket → `approved`
  - blog cover exception: no cover → `approved`; cover without ticket →
    `pending`; cover with ticket → `approved`; and `resources` /
    `marketplace_items` get **no** null-image exemption
  - `mod_token` after a member UPDATE → NULL
  - regression sweep as anon: public rooms visible, `cm_browse` works, public
    album items visible, private album items not, approved artworks and profiles
    visible; as a member: rooms visible, `get_album_artworks` works; publishing
    with the gate inert still lands `approved`

### What is still open after this round

Unchanged from Round 3, and still true:

- **`'unsafe-inline'` and `'unsafe-eval'` in `script-src`.** Still the
  highest-value item left, and still not something this round could take.
  `index.html` carries 3 inline `<script>` blocks and ~340 inline event
  handlers, and `js/` generates more `onclick=` strings at runtime; a nonce
  cannot cover `script-src-attr`, so closing this is a refactor of the event
  model, not a header change. It is why session tokens in `localStorage` matter.

  `'unsafe-eval'` was checked separately and **deliberately left**. Nothing
  first-party needs it — no `eval` or `new Function` in `js/`, `index.html`,
  `sw.js`, `uploadVerifier.js` or the vendored supabase-js. But the directive
  also covers AdSense, GTM/GA, Razorpay Checkout and the PayPal SDK, and some
  of those have historically needed it on paths that vary by geography and ad
  inventory. This environment cannot reach `digiartz.net` to test it, and
  removing it blind risks the ad script or the checkout sheet for a directive
  that buys almost nothing while `'unsafe-inline'` is still there — an attacker
  who can inject inline script has no need of `eval`. Worth doing when someone
  can watch a real browser console through a purchase and a page of ads.
- **Session tokens in `localStorage`** — inherent to the SPA + PostgREST design.
- **Leaked-password protection** and **email confirmation before a first public
  write** — two dashboard toggles, fourth round of asking. This round checked
  whether either could be done from code instead, and neither can:

  Email confirmation is currently **off**, and that is now measured rather than
  assumed — all 15 email signups in `auth.users` were confirmed within two
  seconds of being created, which is GoTrue auto-confirming, not people
  clicking links. That also rules out the obvious workaround: a policy gating
  writes on `email_confirmed_at` would pass instantly for a throwaway signup
  and give false comfort. And once the toggle IS on, GoTrue issues no session
  until the address is confirmed, so an unconfirmed account has no JWT and
  cannot write anyway. **The toggle is the control; there is no code substitute
  for it.**

  Leaked-password protection is a HaveIBeenPwned check inside GoTrue. A
  client-side imitation would be bypassable by anyone calling the auth endpoint
  directly, which is most of the point of having it, so it was not built.
- **`featured` is self-service.** Any member can tick "Feature this listing" and
  sort themselves to the top of a section. That is what the composer's own
  checkbox offers, so it is a product decision rather than a defect, and this
  round did not change it — but every member ticking it makes the ordering
  meaningless, and it is worth a policy decision.
- **Image-content binding.** A ticket says "this account passed a check", not
  "this file passed a check", so moderate image A / upload image B is still
  possible, as is editing an approved row's image afterwards (both gates are
  BEFORE INSERT). Unchanged from Round 3, and a larger redesign.
- **`dz_client_ip()` falls back to `true-client-ip`, `x-real-ip` and
  `x-forwarded-for`** when `cf-connecting-ip` is absent. Cloudflare sets and
  overwrites `cf-connecting-ip` on everything it proxies, so the first entry in
  that coalesce is trustworthy and the fallbacks are unreachable in practice —
  but they are client-supplied headers on a direct-to-Supabase request, and they
  key the per-IP download and auth-attempt limits.
- **No CDN/WAF rate limiting in front of the edge limiter** — a volumetric flood
  still costs a Supabase round trip per request before being refused.

---

## Deployment check — 2026-08-30

Run against the branch before merge: git state, every CI job, both regression
suites, and — the part that mattered — a reconciliation of what the two
migration files *claim* against what the live catalogue actually says.

Sixteen of the seventeen claims reconciled. One did not.

### The one that did not: a revoke that returned success and changed nothing

Round 3 item 6 said INSERT on the entitlement columns of `profiles` was revoked
at the grant layer. It was not. The statement was:

```sql
revoke insert (role, max_claimed, partner_since, subscription_tier, ...)
  on public.profiles from anon, authenticated;
```

**A column-level `REVOKE` cannot subtract from a table-level `GRANT`.** Postgres
keeps conferring the privilege on every column, the statement reports success,
and nothing changes. `authenticated` held table-level INSERT on `profiles`, so
all eight columns were still grantable:

```
subscription_tier   has_column_privilege(authenticated, INSERT) = true
role                has_column_privilege(authenticated, INSERT) = true
merit               has_column_privilege(authenticated, INSERT) = true    (all 8)
```

`anon` was clean, but only by accident — Round 3b's table-level sweep over inert
grants happened to catch it, which is also why the discrepancy was one-sided and
easy to miss.

**Exposure: none.** `dz_profiles_guard_insert` refuses every member-side insert
into `profiles` regardless, and the attack suite proved it throughout
(`member inserts a privileged profile → refused P0001`). What was missing was
the second layer — the one whose entire purpose is to not depend on the first.
The documentation asserted defence in depth that was one deep.

### Fixed

Drop the table-level grant, then re-grant per column, with the safe set built
from the catalogue rather than typed out:

```sql
revoke insert on public.profiles from anon, authenticated;
grant insert (<every column except the eight>) on public.profiles to authenticated;
```

The two layers are now independently observable, which is the test that they are
in fact two:

| attempt | refused by | code |
|---|---|---|
| `insert (id, username, subscription_tier)` | the **grant** | `42501 permission denied for table profiles` |
| `insert (id, username, role)` | the **grant** | `42501 permission denied for table profiles` |
| `insert (id, username)` — the app's own fallback shape | the **trigger**, as before | `P0001 role, max_claimed and partner_since are not yours to set` |
| `update` own `display_name` / `bio` | nothing — still accepted | — |

Before the fix the first two rows also read `P0001`: the trigger was doing all
the work and the grant layer was decorative.

`security/rls-regression.sql` now asserts the column grants directly, so this
cannot silently revert.

### Why it was caught

Not by re-reading the diff — the SQL looks right, and it runs without error. It
was caught by asking the live catalogue whether each claim in the migration was
true, one claim at a time. A migration that runs cleanly is not evidence that it
did what it says.

### Everything else reconciled

profiles guard ✓ · `dz_market_owns` visibility gate ✓ · `dz_market_download`
delegation ✓ · 3 counter triggers ✓ · `payments.pp_order_id` unique index ✓ ·
0 unpinned `search_path` ✓ · 0 `TRUNCATE`/`REFERENCES`/`TRIGGER` ✓ · 0
trigger-function `EXECUTE` ✓ · default ACL narrowed to `arwd` ✓ · both buckets
size- and MIME-bounded with no html/svg/pdf ✓ · single deliberate inert grant
(`notification_reads/authenticated/UPDATE`) ✓.

Suites at the time of the check: **122/122** JS checks, **22/22** attack cases,
**23/23** client write paths, 7/7 CI jobs.

### Not verifiable from the audit environment

Recorded as manual, not as outstanding work:

- **Leaked Password Protection** and **Email Confirmation** — enabled by the
  operator and taken as such. The `auth_leaked_password_protection` advisor
  still appears, but it is the only one of 150 lints carrying no `observed_at`
  timestamp, so it cannot be dated and is not evidence either way. No signup has
  occurred since the toggles (18 users, all confirmed, newest 2026-08-26), so
  the data says nothing either. **MANUALLY VERIFIED.**
- **Turnstile in production** — `config.js` is generated at deploy from Pages
  environment variables and is gitignored; outbound egress to `digiartz.net` is
  blocked from the audit environment. Confirm `TURNSTILE_SITE_KEY` is non-empty
  in the deployed file.
- **The bucket MIME rule end to end** — configuration is asserted in the suite,
  but no real `PUT` was performed: egress to `supabase.co` is blocked and there
  is no user JWT to sign one with. Upload a webp, a `.pdf` and a `.svg` after
  deploy.

### Deploy ordering, which is live right now

The database and storage changes are **already applied to production**. The two
JavaScript changes are **not** — they are on the branch, and `main` does not
have them.

That means the bucket MIME allowlist is enforcing while the deployed client
still sends the raw `file.type`. A `.svg` or `.pdf` **asset** upload would be
refused until the branch merges. koe-media held 152 objects, every one
`image/webp`, and the asset path had never been used against it, so nothing in
flight is affected — but the window is real and closes on merge.

---

## Round 3b — 2026-08-30, the grant layer and the storage content types

Round 3 left two things open and named them. This closes both, and in going
after the second one properly it opened a layer nobody had audited: Postgres
**grants**, which sit underneath RLS rather than beside it.

A policy decides which *rows* a role may touch. A grant decides whether the role
may touch the table at all — and two of the privileges found here are not
row-filtered by RLS in the first place.

### The finding that mattered

**`anon` held `TRUNCATE` on 51 tables. `authenticated` held it on 54.**

`TRUNCATE` is not filtered by row-level security. There is no policy that
narrows it, no `USING` clause it consults; holding the privilege *is* the whole
check. Every control in this schema is built on RLS, and this is a
delete-every-row primitive that RLS does not see.

It was not reachable through PostgREST — which speaks SELECT/INSERT/UPDATE/
DELETE and RPC, and has no TRUNCATE verb — so this was a latent privilege
rather than an open door, and it is scored MEDIUM for that reason. But it sat on
the **anonymous** role, on almost every table in the database, exempt from the
one control everything else relies on.

The cause is not a mistake anyone made. Supabase's default privileges grant
`ALL` on new tables to `anon` and `authenticated`, and `ALL` includes `TRUNCATE`,
`REFERENCES` and `TRIGGER`. Every table created since the project started
inherited them silently. Fixed on the existing 73 tables, and the default
narrowed to `SELECT, INSERT, UPDATE, DELETE` so the next one does not inherit
them either — a new table still works behind its policies exactly as before.

| # | What | Severity | Where |
|---|------|----------|-------|
| 13 | `TRUNCATE`, `REFERENCES`, `TRIGGER` on all 73 public tables, held by both roles; `TRUNCATE` is RLS-exempt | **MEDIUM** | `20260830_least_privilege.sql` §1 |
| 14 | 80 further (table, role, privilege) triples held where RLS has no matching policy. Inert today — the grant reaches the table, the missing policy refuses every row — and removed because "inert" is a property of the current policy set, not of the grant. The day somebody adds a convenience `FOR ALL` policy, the write privilege is already sitting there | LOW | §2 |
| 15 | `EXECUTE` on all 43 trigger functions, held by both roles, making each one an addressable `/rest/v1/rpc` name | LOW | §3 |
| 16 | **`koe-media` accepted any content type** — the item Round 3 left open. See below | MEDIUM | §4 |

### The storage content types, and why Round 3 did not just do it

Round 3 wrote: *"Not done blind: the list has to cover every extension in
`smart-function`'s `ASSET_EXT`, and one missing entry silently breaks that
upload."* That was the right call and it is still true — which is why the fix is
two halves, not one.

The half that made it safe: **every asset now declares
`application/octet-stream`**. Nothing was lost by doing that, because every
asset is fetched back through `/api/market-download` or
`/api/resource-download`, and both set their own `Content-Type` and
`Content-Disposition: attachment` from the database row. *The type stored beside
the bytes is never read on the way out.* Checked before relying on it: no
`file_url` is ever used as an `<img src>` — everything rendered inline is a webp
derivative from `preview_url`, `cover_url` or `image_url`.

So the only content types the app can now produce are five image types and
`application/octet-stream`, and the bucket list can be closed against renderable
types without a `.blend` or a `.procreate` ever being caught by it.

Not on the allowlist, on purpose: `text/html`, `application/xhtml+xml`, every
other `text/*`, `image/svg+xml`, `application/xml`, `application/pdf`. Each
renders in a browser window rather than landing in a downloads folder. SVG is
the one worth naming — it is an image by extension and a script host by
behaviour, and `.svg` is a legitimate asset format here, so it still uploads
happily as a download and simply cannot be rendered from the storage origin any
more.

Ground truth when this was applied: koe-media held 152 objects, **every one of
them `image/webp`**. The asset path had never been used against that bucket, so
nothing was orphaned and nothing in flight was affected. Both buckets now carry
the list.

### The regression I caused, and how it was caught

Revoking the inert grants broke **marking notifications read**.

`js/auth.js` upserts `notification_reads`, and an upsert is
`INSERT … ON CONFLICT DO UPDATE`, which Postgres requires the `UPDATE`
privilege to *plan* — whether or not a row actually conflicts. The measurement
was right that no `UPDATE` policy exists; it did not follow that the privilege
was unused.

It was caught by running every one of the 23 direct client write paths against
the live database, not by reading the diff. The `UPDATE` grant is restored, and
`js/auth.js` now passes `ignoreDuplicates`, making it `ON CONFLICT DO NOTHING` —
which needs no `UPDATE` privilege and is what "mark read" actually means, so a
re-mark no longer throws either. The grant is deliberately left in place until
that ships, so neither deploy order can break production.

That is the one place in this audit where a change of mine broke something. It
is written down here rather than quietly fixed, because the lesson is the
useful part: an inert-looking grant is only inert for the statements you
thought of.

### Tests

Both suites grew, and both were re-verified by reverting each fix and watching
them go red.

- `scripts/security-test.mjs` — now **122 checks**. New: `safeUploadType` pulled
  out of the shipped `app-core.js` and executed (not re-implemented) against
  `text/html`, `image/svg+xml`, `application/xhtml+xml`, `application/pdf`,
  empty, `null`, `constructor` and `__proto__`; that no PUT still sends the raw
  `file.type`; that the notification upsert ignores duplicates.
- `security/rls-regression.sql` — the 22 attack cases, plus structural
  assertions that now fail loudly if the grant layer drifts: inert grants must
  be exactly the one documented exception, `TRUNCATE`/`REFERENCES`/`TRIGGER`
  must be 0, trigger-function `EXECUTE` must be 0, unpinned `search_path` must
  be 0, unbounded buckets must be 0, tables without RLS must be 0, and no bucket
  may allow html, svg or pdf.
- 23 direct client write paths re-run after every revoke: **23/23**.

### What was proven rather than assumed

Two things were tested inside a rolled-back transaction before being applied to
43 functions:

- a trigger function cannot be called as an RPC at all — Postgres refuses it
  itself with `0A000 trigger functions can only be called as triggers`, so the
  `EXECUTE` grant was never exploitable, only noisy;
- revoking `EXECUTE` does **not** stop a trigger firing. The privilege is
  checked at `CREATE TRIGGER`, not per row. An insert into `artwork_likes` was
  accepted with the ban gate, the write limiter and the content guard all
  revoked, and every one of them still ran.

### Also checked this round

- **No `pg_net`, no `http` extension** — the database cannot make outbound
  requests, so there is no SSRF primitive inside Postgres. Installed: `pg_cron`,
  `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`.
- **`auth.users` is not reachable** by `anon` or `authenticated`. Neither is the
  `vault` schema. The `cron` schema has no grants to either role, and its four
  jobs are the expected ones (merit regen, scheduled publishing ×2, subscription
  expiry).
- **Statement timeouts are set**: `anon` 3s, `authenticated` 8s. That is a real
  application-DoS control and it was already correct.
- **Every table in `public` has RLS enabled** — 0 without.

### Advisor count

189 lints at the start of this audit, **150** now: all 9
`function_search_path_mutable` gone, and 30 of the
`security_definer_function_executable` warnings gone with the trigger-function
revokes. The remaining 128 are the intentional RPC API — every one that returns
member data gates on `auth.uid()` internally — and the 21
`rls_enabled_no_policy` are fail-closed tables whose grants are now stripped as
well, so they are closed twice.

### What is still open after this round

- **`'unsafe-inline'` in `script-src`.** Unchanged, and still the highest-value
  item left. It is why session tokens in `localStorage` matter.
- **Leaked-password protection** and **email confirmation before a first public
  write** — still two dashboard toggles nobody can set from the repository.
- **The `supabase_admin` default-privilege entry** still grants the full set
  including `TRUNCATE`. It could not be altered from the `postgres` role and
  applies only to tables created *by* `supabase_admin`, which migrations are
  not. The regression suite asserts the live count stays at zero, so if it ever
  comes back it will be visible.
- **`Access-Control-Allow-Origin: *` on the edge function.** Not exploitable —
  it authenticates by `Authorization` header, which a cross-origin caller cannot
  supply — but wider than it needs to be.
- **The bucket MIME rule was not exercised with a real upload.** It is enforced
  by Supabase Storage, and the configuration is verified in the suite, but no
  end-to-end PUT was performed from this session. Worth one manual upload of
  each kind after deploy.

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
| 6 | **`profiles` INSERT was granted on every column, entitlement columns included.** The guard named only `role`, `max_claimed` and `partner_since`. Nothing exploits this today — `handle_new_user()` writes the row the moment the account exists, so a member's own insert always collides on the primary key, and an upsert would need UPDATE privilege on columns they do not hold — but both of those are accidents of ordering rather than decisions. The guard now names the tier and merit columns too, and INSERT on them is withheld at the grant layer, which does not depend on trigger ordering at all. **The grant half was initially written as a column-level `REVOKE` and did nothing** — see the deployment check below | MEDIUM | migration §1 |
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
| ~~**`koe-media` accepts any content type.**~~ | **FIXED in Round 3b** — see above. Both buckets now carry an allowed_mime_types list that excludes html, xhtml, every other text/*, svg, xml and pdf, and the client declares application/octet-stream for every non-image upload so no legitimate asset is caught by it | — |
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

### 🔴 0. Finish the section moderation gate (Round 4 — do this after deploy)

The gate is installed on `resources`, `marketplace_items` and `blog_posts` and
is **inert**. It stays inert until you turn it on, and it must not be turned on
before the deploy that makes the browser send tickets.

1. Deploy this branch to production.
2. Publish one resource, one marketplace listing and one blog post. Confirm each
   goes live as normal.
3. Only then, in the Supabase SQL editor:

   ```sql
   update private.mod_config set sections_enforced = true where id;
   ```

4. Re-test: a normal publish still works; a direct PostgREST insert with
   `status='approved'` and no token now lands in `status='pending'`.

Roll back at any time, dropping nothing:

```sql
update private.mod_config set sections_enforced = false where id;
```

Check which state it is in:

```sql
select case when sections_enforced then 'enforcing' else 'inert' end
  from private.mod_config where id;
```

### ✅ 0b. Edge functions — already done, nothing for you unless you use previews

Both were deployed during the review and the deployed source was read back and
verified, so there is no action here:

- `smart-function` **v27** — CORS allowlist instead of `*`, signing errors no
  longer returned as text.
- `report-notify` **v7** — no longer emails whatever the caller sends.

One conditional: if you use Cloudflare **preview deployments**, add their
origins to `ALLOWED_ORIGINS` (comma-separated) under Supabase → Edge Functions →
Secrets, or uploads from a preview URL will be refused by the browser.
`https://digiartz.net` and `https://www.digiartz.net` are built in and need no
configuration.

### 🟢 0c. Delete two retired edge functions (one minute, tidiness)

`storage-copy` and `t600-probe` are finished one-shot migration tools. Their
bodies were already removed and both return 410, so they hold nothing and can
do nothing — but a slug that answers is a slug someone can probe, and the
management API had no delete call when they were retired. Supabase Dashboard →
Edge Functions → each one → Delete.


### 🔴 1. Storage spend alarm (do today — this is your bill protection)
Media now lives in Supabase Storage, so the bill to watch is Supabase's, not
AWS's. Supabase Dashboard → **Organization → Billing → Usage / spend cap** →
keep the spend cap on so a traffic spike cannot run past the Free tier's
included egress. Egress is the metered part: the service worker caches the two
sizes the grid and lightbox actually request, which is what keeps it small.

### 🟠 2. Turn on leaked-password protection (30 seconds)
Supabase Dashboard → **Authentication → Policies / Passwords** →
enable **"Prevent use of compromised passwords."**

### 🟠 2b. Require email confirmation before a first write (Round 4)

Supabase Dashboard → **Authentication → Providers → Email** → enable
**Confirm email**.

This is measured, not guessed: all 15 email signups in `auth.users` were
confirmed within two seconds of creation, which is GoTrue auto-confirming
because the setting is off. The 2026-08-20 phishing account posted two minutes
after signing up from an unverified throwaway address, and this is the switch
that would have stopped it.

Round 4 checked whether it could be enforced from code instead. It cannot, in
either direction: while the setting is off, `email_confirmed_at` is filled in
at signup, so a policy testing it would pass for a throwaway and give false
comfort; and once the setting is on, GoTrue issues no session until the address
is confirmed, so an unconfirmed account holds no JWT and cannot write anyway.
There is no code substitute — only this toggle.

### ✅ 3. The artwork moderation gate — done, nothing to do

Superseded, and kept only as a status line so it does not read as an open task
next to item 0. This was Round 3's rollout for `public.artworks`; it is live and
verified enforcing. `MOD_SIGNING_SECRET` is set in Cloudflare and the matching
secret is in `private.mod_config`, or the gate could not be enforcing.

**Item 0 above is the remaining half** — the same gate for resources, listings
and blog posts. That one is still inert and waiting on your deploy. The two are
separate switches on purpose: `secret` arms the artwork gate,
`sections_enforced` arms the other three.

Check either at any time:

```sql
select case when secret = '' then 'inert' else 'enforcing' end as artwork_gate,
       case when sections_enforced then 'enforcing' else 'inert' end as section_gate
  from private.mod_config where id = true;
```

Both fail safe and roll back without dropping anything — an upload goes to
review, it never errors:

```sql
update private.mod_config set secret = '' where id = true;              -- artworks
update private.mod_config set sections_enforced = false where id = true; -- sections
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

One thing was left public on purpose:
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
