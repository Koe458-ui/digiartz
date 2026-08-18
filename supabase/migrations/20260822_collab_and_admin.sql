-- Partners, promo codes, and the admin panel's own tables
--
-- Three things arrive together here because they are one thing: an account
-- type that is trusted with a slice of moderation and a slice of the revenue,
-- the code that attributes that revenue to it, and the ledger that proves the
-- attribution. Splitting them across three migrations would leave a role with
-- powers and no audit trail in between.
--
--   PARTNER is a role on the profile, beside 'admin' and 'dev'. It is not a
--   tier. A partner claims Max once, for nothing, and after that their tier is
--   an ordinary Max tier that every existing gate already understands — there
--   is no second definition of "is this member on Max" anywhere below.
--
--   A PROMO CODE belongs to exactly one partner, and a partner has exactly one
--   code. Both halves of that are enforced by unique indexes rather than by the
--   endpoint that creates them, because an endpoint can be called twice.
--
--   A COMMISSION is a row written at the moment the sale settles, in the
--   currency the sale was priced in, and it is never converted. That is the
--   rule the rest of this schema already lives by (20260802_money_flow.sql),
--   and a partner's earnings are no more special than a seller's.
--
-- WHERE THE PARTNER'S MONEY COMES FROM, said plainly because it is the one
-- thing about this feature that can be got wrong quietly:
--
--   It comes out of the PLATFORM'S OWN CUT. Never out of the seller's net, and
--   never out of TDS or TCS — those are collected under statute and are not
--   ours to redistribute. A seller keeps 85%, or 90% on Max, whether or not
--   the buyer typed a code, and cannot tell from their wallet that one was
--   used. Of the platform's 15%, five points go to the partner whose code was
--   used, leaving the platform ten.
--
--   The brief for this feature described the marketplace split as "85 seller /
--   5 tax / 5 platform / 5 partner". The seller's 85 and the partner's 5 are
--   implemented exactly. The remaining ten points are NOT a flat 5% tax and a
--   flat 5% platform share, because the tax on a marketplace sale here is not
--   a rate anyone at this company picks: it is 0.1% under section 194-O and
--   0.5% under section 52, both already computed by
--   dz_earning_apply_deductions() from platform_tax_config, and both changing
--   by statute without notice. Writing 5% into this file would have been a
--   number that is wrong on the day it is written. So the tax line is whatever
--   the law says it is, and the platform keeps the rest.
--
--   On a Max subscription bought with a code, the split IS exactly as briefed,
--   because every part of it is ours to set: the buyer pays 10% of list (a 90%
--   discount), and of the list price 5 points are tax, 2.5 are the platform's
--   and 2.5 are the partner's. Half of everything collected on a discounted
--   subscription therefore goes to the partner who sent the buyer.
--
-- NO ESCROW. The platform does not refund digital goods or subscriptions, so
-- there is no window in which a commission might have to be clawed back, and
-- a partner's balance is available the moment the sale settles. This is the
-- one place this schema differs from the seller wallet, which holds for the
-- provider's settlement window because the provider has genuinely not paid us
-- yet. A commission is a share of money already received.

-- ===========================================================================
-- 1. THE ROLE
-- ===========================================================================
-- profiles.role already carries 'admin' and 'dev'. 'partner' joins them.
--
-- AND SO DOES 'guest', WHICH IS WHAT AN ORDINARY MEMBER ACTUALLY HAS. Every
-- non-staff profile on the live project carries the string 'guest'; not one
-- carries null. This file was first written assuming null meant "no role",
-- which is the obvious reading of a nullable column and was wrong about this
-- database — the constraint below would have refused ten of eleven rows and
-- taken the migration down at the VALIDATE.
--
-- Both are accepted rather than one being migrated to the other. Rewriting ten
-- rows to null to match an assumption in a new file is the wrong way round:
-- the data is the fact, the file is the thing that was wrong. dz_is_ordinary()
-- below is the single place that knows the two mean the same thing, so nothing
-- downstream has to remember.
--
-- The constraint is added NOT VALID and then validated, so a pre-existing row
-- with some other spelling in it names itself in the error rather than taking
-- the whole migration down at the ALTER.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_known'
  ) then
    alter table public.profiles
      add constraint profiles_role_known
      check (role is null or role in ('guest', 'admin', 'dev', 'partner')) not valid;
    alter table public.profiles validate constraint profiles_role_known;
  end if;
end $$;

-- Claimed once, and the boolean is what makes it once. The tier and the expiry
-- below could both be reached by an ordinary purchase; this cannot.
alter table public.profiles
  add column if not exists max_claimed    boolean not null default false,
  add column if not exists partner_since  timestamptz;

comment on column public.profiles.max_claimed is
  'True once this partner has taken the free Max that comes with the role. '
  'Never reset — a partner who lets the role go and is given it again does not '
  'get a second perpetual subscription out of it.';

-- ---------------------------------------------------------------------------
-- AND NOBODY SETS THEIR OWN.
--
-- This is the load-bearing line of the whole feature, so it is worth being
-- exact about why it is here. profiles.role was, until this migration, a label:
-- it decided whether a settings menu carried an ADMIN PANEL entry. It now
-- decides who is paid a share of the platform's revenue.
--
-- Three places in this repository update a profile straight from the browser —
-- js/pfedit.js, js/avatar.js and js/albums.js all call
-- .from('profiles').update(...).eq('id', currentUser.id) — and PostgREST sends
-- whatever object it is given. A member editing their bio and a member sending
-- { role: 'partner' } are the same request to the row's update policy, which
-- can only say yes or no to the row and not to the column.
--
-- So the column is defended here instead. dz_grant_partner(), dz_claim_max()
-- and dz_revoke_partner() are SECURITY DEFINER and run as this function's
-- owner, so they pass; a client writing as `authenticated` or `anon` does not.
-- SECURITY INVOKER on purpose — the whole test is who current_user is, and a
-- DEFINER trigger would answer "the owner" every time and let everything past.
--
-- subscription_tier and subscription_expires_at are deliberately NOT guarded
-- here. Four settled checkout paths write them and they predate this feature;
-- narrowing them is a separate change with its own testing, and doing it
-- quietly inside a partner migration is how a subscription stops renewing on
-- a Friday night.
create or replace function public.dz_profiles_guard_privileged()
returns trigger
language plpgsql
as $$
begin
  if (new.role          is distinct from old.role)
  or (new.max_claimed   is distinct from old.max_claimed)
  or (new.partner_since is distinct from old.partner_since) then
    if current_user in ('authenticated', 'anon') then
      raise exception 'role, max_claimed and partner_since are not yours to set';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists dz_profiles_guard_privileged on public.profiles;
create trigger dz_profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.dz_profiles_guard_privileged();

-- An INSERT would be the same hole through the signup trigger, and the same
-- answer: a new profile arrives with no role, and only the functions above can
-- give it one.
create or replace function public.dz_profiles_guard_insert()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.role is not null or new.max_claimed or new.partner_since is not null) then
    raise exception 'role, max_claimed and partner_since are not yours to set';
  end if;
  return new;
end $$;

drop trigger if exists dz_profiles_guard_insert on public.profiles;
create trigger dz_profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.dz_profiles_guard_insert();

-- Neither is callable by hand. A trigger function refuses a direct call anyway
-- ("trigger functions can only be called as triggers"), so this is defence in
-- depth rather than a hole being closed — but every other trigger function in
-- this schema is revoked, including dz_earning_apply_deductions in
-- 20260802_money_flow.sql, and one that is not invites the question of whether
-- it was meant to be.
--
-- Revoking EXECUTE does NOT stop the trigger firing: PostgreSQL checks that
-- privilege when the trigger is CREATED, not each time it fires. Verified
-- against a scratch database rather than assumed, because getting it backwards
-- would silently disable the one guard standing between a member and the
-- 'partner' role.
revoke all on function public.dz_profiles_guard_privileged() from public, anon, authenticated;
revoke all on function public.dz_profiles_guard_insert() from public, anon, authenticated;

-- Pinned for hygiene rather than for a hole: both are SECURITY INVOKER and
-- reference no schema-qualified object, so there is nothing in them to hijack.
-- But a mutable search_path on the function guarding the role column is a line
-- nobody should have to think twice about, and Supabase's advisor flags it.
-- `set search_path` does not affect current_user, which is the whole test
-- these two make.
alter function public.dz_profiles_guard_privileged() set search_path to 'public', 'pg_temp';
alter function public.dz_profiles_guard_insert()     set search_path to 'public', 'pg_temp';

-- ===========================================================================
-- 2. WHO IS WHAT — one answer, read by everything below
-- ===========================================================================
-- Every guard in this file goes through these two. Nothing below writes
-- `role = 'admin'` inline, which is how a fourth spelling of the same check
-- ends up disagreeing with the other three.
create or replace function public.dz_role(p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select role from public.profiles where id = p_user;
$$;
-- ...FROM authenticated TOO, AND THAT WORD IS LOAD-BEARING.
--
-- Supabase grants EXECUTE on functions in `public` to anon and authenticated by
-- default. Revoking from PUBLIC does not take that away — the grant to
-- `authenticated` is its own, and it survives. Written as "from public, anon",
-- as every line here first was, these helpers stayed reachable at
-- /rest/v1/rpc for any signed-in member.
--
-- dz_role is the one that matters: post a uuid, read back that account's role,
-- and the list of who the admins, devs and partners are falls out. That is the
-- exact leak dz_mod_find() is hardened against, arriving through the helper the
-- hardening is built on.
--
-- Caught by Supabase's own advisor against the live project, not by the test
-- suite — the scratch fixture had no such default grant, so a revoke that was
-- doing nothing in production looked like it worked. The fixture grants it now.
--
-- Every one of these exists to be called BY the SECURITY DEFINER functions
-- below, which run as their owner and are unaffected.
revoke all on function public.dz_role(uuid) from public, anon, authenticated;

create or replace function public.dz_is_staff(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select role in ('admin', 'dev') from public.profiles where id = p_user),
    false);
$$;
revoke all on function public.dz_is_staff(uuid) from public, anon, authenticated;

-- Neither staff nor partner: the accounts a partner is allowed to moderate.
-- 'guest' is what this database writes and null is what a nullable column
-- suggests, and both have always meant the same thing here. This is the only
-- place that has to know that.
create or replace function public.dz_is_ordinary(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select role is null or role = 'guest' from public.profiles where id = p_user),
    false);
$$;
revoke all on function public.dz_is_ordinary(uuid) from public, anon, authenticated;

create or replace function public.dz_is_partner(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select role = 'partner' from public.profiles where id = p_user),
    false);
$$;
revoke all on function public.dz_is_partner(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. THE AUDIT LOG — written before the thing it records is allowed to matter
-- ===========================================================================
-- Append only. No update policy, no delete policy, and no grant that would let
-- one be added from the client. A moderator with the power to ban is a
-- moderator whose bans have to be attributable months later.
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_role text,
  action     text not null,
  target_id  uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint audit_action_len check (char_length(action) between 2 and 64)
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_target_idx  on public.audit_log (target_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

comment on table public.audit_log is
  'Append-only. Every privileged action in this schema writes here through '
  'dz_audit(), and the actor''s role is copied onto the row rather than joined '
  'at read time — a partner demoted next month must not make last month''s '
  'ban look like it was done by a member.';

create or replace function public.dz_audit(
  p_action text, p_target uuid, p_meta jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.audit_log (actor_id, actor_role, action, target_id, metadata)
  values (auth.uid(), public.dz_role(auth.uid()), p_action, p_target,
          coalesce(p_meta, '{}'::jsonb));
$$;
revoke all on function public.dz_audit(text, uuid, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 4. PLATFORM BANS
-- ===========================================================================
-- Community bans already exist and are a different thing: they are one
-- community's door. This is the front door. A row here is the ban; there is no
-- boolean on the profile shadowing it, so there is nothing to fall out of step
-- and un-banning is a status change on the record rather than a delete that
-- takes the reason with it.
create table if not exists public.user_bans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text not null,
  note       text,
  banned_by  uuid references public.profiles(id) on delete set null,
  banned_at  timestamptz not null default now(),
  expires_at timestamptz,
  lifted_by  uuid references public.profiles(id) on delete set null,
  lifted_at  timestamptz,

  constraint user_bans_reason_len check (char_length(reason) between 2 and 60),
  constraint user_bans_note_len   check (note is null or char_length(note) <= 500)
);

-- One live ban per member. A second ban on someone already banned is not a
-- second row, it is an amendment to the one they have.
create unique index if not exists user_bans_live_idx
  on public.user_bans (user_id) where lifted_at is null;
create index if not exists user_bans_recent_idx on public.user_bans (banned_at desc);

alter table public.user_bans enable row level security;
revoke all on public.user_bans from anon, authenticated;

-- Is this member barred right now? A ban with an expiry that has passed is
-- over without anything having to run to end it — the same reasoning the
-- seller wallet uses for available_at.
create or replace function public.dz_is_banned(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.user_bans
     where user_id = p_user
       and lifted_at is null
       and (expires_at is null or expires_at > now()));
$$;
revoke all on function public.dz_is_banned(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may ban whom.
--
-- Staff may ban anyone who is not staff. A partner may ban ordinary members
-- only — not an admin, not a dev, and not another partner. That last one is
-- the point of the rule: a partner holds a moderation power and a revenue
-- stake at the same time, and two partners competing for the same referrals
-- must not be able to remove each other.
create or replace function public.dz_may_moderate(p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when p_actor is null or p_target is null then false
    when p_actor = p_target                  then false
    when public.dz_is_staff(p_actor)         then not public.dz_is_staff(p_target)
    -- dz_is_ordinary, not "role is null". Written as the latter, a partner
    -- could moderate nobody at all on the live database, where every ordinary
    -- member's role is the string 'guest' — the ban engine would have shipped
    -- refusing every target a partner was given the power to act on.
    when public.dz_is_partner(p_actor)       then public.dz_is_ordinary(p_target)
    else false
  end;
$$;
revoke all on function public.dz_may_moderate(uuid, uuid) from public, anon, authenticated;

create or replace function public.dz_ban_user(
  p_target uuid, p_reason text, p_note text default null, p_days integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_expires timestamptz;
  v_id      uuid;
begin
  if not public.dz_may_moderate(auth.uid(), p_target) then
    -- One message for "you are not a moderator" and for "not that member".
    -- A partner probing which accounts refuse learns nothing from the reply
    -- about who the other partners are.
    raise exception 'not allowed';
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 2 then
    raise exception 'a reason is required';
  end if;

  v_expires := case when p_days is null or p_days <= 0
                    then null
                    else now() + make_interval(days => least(p_days, 3650)) end;

  insert into public.user_bans (user_id, reason, note, banned_by, expires_at)
  values (p_target, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid(), v_expires)
  on conflict (user_id) where lifted_at is null
  do update set reason     = excluded.reason,
                note       = excluded.note,
                banned_by  = excluded.banned_by,
                banned_at  = now(),
                expires_at = excluded.expires_at
  returning id into v_id;

  perform public.dz_audit('ban_user', p_target, jsonb_build_object(
    'ban_id', v_id, 'reason', btrim(p_reason), 'expires_at', v_expires));

  return jsonb_build_object('ok', true, 'ban_id', v_id, 'expires_at', v_expires);
end $$;
revoke all on function public.dz_ban_user(uuid, text, text, integer) from public, anon;
grant execute on function public.dz_ban_user(uuid, text, text, integer) to authenticated;

create or replace function public.dz_unban_user(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_rows integer;
begin
  if not public.dz_may_moderate(auth.uid(), p_target) then
    raise exception 'not allowed';
  end if;

  update public.user_bans
     set lifted_by = auth.uid(), lifted_at = now()
   where user_id = p_target and lifted_at is null;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  perform public.dz_audit('unban_user', p_target, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.dz_unban_user(uuid) from public, anon;
grant execute on function public.dz_unban_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Finding somebody to moderate: by username, by email, or by id.
--
-- This is the one place a moderator is allowed to see an email address, and it
-- is SECURITY DEFINER over auth.users because that is where the address lives.
-- It answers with a single exact match, never a list: a prefix search over
-- addresses is an address harvester, and nobody moderating a named account
-- needs one.
create or replace function public.dz_mod_find(p_query text)
returns table(
  id uuid, username text, display_name text, email text, role text,
  tier text, banned boolean, ban_reason text, ban_expires_at timestamptz,
  can_moderate boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q     text := btrim(coalesce(p_query, ''));
  v_id    uuid;
  v_staff boolean := public.dz_is_staff(auth.uid());
begin
  if not (v_staff or public.dz_is_partner(auth.uid())) then
    raise exception 'not allowed';
  end if;
  if char_length(v_q) < 2 then
    raise exception 'search for a username, an email or a user id';
  end if;

  -- A uuid is matched as a uuid; anything else is matched as text, and the
  -- leading @ people paste with a handle is dropped rather than searched for.
  begin
    v_id := v_q::uuid;
  exception when others then
    v_id := null;
  end;
  v_q := ltrim(v_q, '@');

  -- WHAT COMES BACK DEPENDS ON WHO ASKED, and this is the second half of the
  -- isolation rule rather than a nicety.
  --
  -- Staff get the whole row, including the address, because staff are the
  -- people who answer support mail about an account.
  --
  -- A partner gets neither the email nor the role, and both omissions matter:
  --
  --   role would have made this an oracle for exactly the thing partners are
  --   not allowed to see. Look up handles, read the role back, and you have
  --   the list of who the other partners are — the isolation rule defeated
  --   through the moderation tool rather than through the analytics.
  --
  --   email would have turned a username into an address. A partner searching
  --   BY an address already knows it; being handed one they did not have is a
  --   different thing, and it is address harvesting with a moderator's badge on.
  --
  -- can_moderate is the answer a moderator actually needs, and it is computed
  -- by dz_may_moderate() rather than inferred from a role on this side. A
  -- partner is told they cannot act on this account. They are not told whether
  -- that is because it is an admin, a dev, or a fellow partner — and there is
  -- no field in this result from which they could work it out.
  return query
  select p.id,
         p.username,
         p.display_name,
         case when v_staff then u.email::text else null end,
         case when v_staff then p.role else null end,
         coalesce(public.dz_effective_tier(p.id), 'guest') as tier,
         public.dz_is_banned(p.id) as banned,
         b.reason,
         b.expires_at,
         public.dz_may_moderate(auth.uid(), p.id) as can_moderate
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.user_bans b on b.user_id = p.id and b.lifted_at is null
   where (v_id is not null and p.id = v_id)
      or lower(p.username) = lower(v_q)
      or lower(u.email)    = lower(v_q)
   limit 1;
end $$;
revoke all on function public.dz_mod_find(text) from public, anon;
grant execute on function public.dz_mod_find(text) to authenticated;

-- ---------------------------------------------------------------------------
-- AND THE BAN HAS TO ACTUALLY STOP SOMETHING.
--
-- A row in user_bans is a record of a decision. On its own it is not a ban:
-- until something reads it, a banned member uploads, comments and sells
-- exactly as before, and the moderator who pressed the button has been told a
-- lie by their own panel. So it is read here, on the same tables and by the
-- same mechanism as the write rate limiter in 20260809_write_rate_limits.sql —
-- one BEFORE trigger per member-writable table, attached by the same loop.
--
-- WHAT THIS DOES AND DOES NOT DO, because a half-enforced ban is worse than a
-- documented one:
--
--   It stops every write a member can make: uploads, listings, posts, jobs,
--   comments, messages, reports, albums, profile edits. That is the surface a
--   banned account is banned FOR.
--
--   It does not stop reading. Every read on this site is governed by an RLS
--   policy of its own, and threading a ban check through all of them is a
--   change with a much larger blast radius than this one — a mistake there
--   takes the site down for everybody rather than letting one banned account
--   keep browsing. A banned member can still see pages. They cannot touch
--   anything.
--
--   It does not end their session. Supabase issues the token and this schema
--   does not revoke it. The next write fails, which is the moment it matters.
--
-- The service role and the schedulers pass through, exactly as they do in the
-- rate limiter, and for the same reason: auth.uid() is null for both, and a
-- scheduled post queued before a ban is not a write the banned member is
-- making now.
create or replace function public.dz_ban_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  if public.dz_is_banned(v_uid) then
    -- Worded to survive safeErr in js/app-core.js, which suppresses anything
    -- that reads like a database error and shows the rest to the member. The
    -- reason is not quoted back: it is written for the audit log and for
    -- support, not as a message to argue with.
    raise exception 'Your account is suspended. Contact DigiArtzsupport@gmail.com'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.dz_ban_gate() from public, anon, authenticated;

-- The triggers that call it are attached at the END of this file, not here.
-- The loop skips a table this deployment does not have, and user_reports is
-- created further down — attached at this point it would silently skip the one
-- table this migration itself adds, which is exactly what it did on the first
-- run of this file. Nothing else in here is order-dependent; that one is.

-- ===========================================================================
-- 5. REPORTS ABOUT PEOPLE
-- ===========================================================================
-- artwork_reports already covers "this upload should not be here". This covers
-- "this account should not be here", which is a different queue with different
-- reasons and a different resolution — and which the ban engine above is the
-- answer to.
create table if not exists public.user_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references public.profiles(id) on delete set null,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  reason       text not null,
  details      text,
  status       text not null default 'pending',
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz not null default now(),

  constraint user_reports_reason check (reason in (
    'dmca', 'spam', 'harassment', 'fraud', 'impersonation',
    'hate', 'illegal', 'other')),
  constraint user_reports_status check (status in ('pending', 'resolved', 'dismissed')),
  constraint user_reports_details_len check (details is null or char_length(details) <= 1000),
  constraint user_reports_not_self check (reporter_id is null or reporter_id <> target_id)
);

create index if not exists user_reports_open_idx
  on public.user_reports (created_at desc) where status = 'pending';
create index if not exists user_reports_target_idx on public.user_reports (target_id);

-- One open report per reporter per target. Without it, "report" is a button
-- somebody holds down.
create unique index if not exists user_reports_one_open_idx
  on public.user_reports (reporter_id, target_id) where status = 'pending';

alter table public.user_reports enable row level security;
revoke all on public.user_reports from anon, authenticated;
grant insert on public.user_reports to authenticated;

drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and target_id <> auth.uid());

-- INSERT AND NOTHING ELSE. No select policy, and no select grant either.
--
-- There was one, letting a reporter read the reports they had filed, and it
-- was a mistake worth describing because it looked so reasonable. The row a
-- reporter would have read back carries resolved_by and resolution — the id of
-- the moderator who handled it, and their note. So: report an account, wait,
-- read your own row, and you have the user id of the moderator who acted. Look
-- it up and you have their handle.
--
-- On a platform where some moderators are partners, whose whole isolation rule
-- is that one partner cannot be identified from another's activity, that is
-- the leak the rest of this file is written to prevent — arriving through the
-- one table a member is allowed to write to.
--
-- Nothing needed the read: js/profile.js inserts without asking for the row
-- back, and a duplicate is recognised by its SQLSTATE rather than by looking.
-- If a "reports you have filed" view is ever wanted, it comes as a scoped RPC
-- that returns the reporter's own columns, the way every other read in this
-- schema does — not as a policy over a table with a moderator's name in it.
drop policy if exists user_reports_select_own on public.user_reports;

create or replace function public.dz_reports_queue(
  p_status text default 'pending', p_limit integer default 100)
returns table(
  id uuid, reason text, details text, status text, created_at timestamptz,
  target_id uuid, target_username text, target_banned boolean,
  reporter_id uuid, reporter_username text,
  resolved_by uuid, resolved_at timestamptz, resolution text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_staff boolean := public.dz_is_staff(auth.uid());
begin
  if not (v_staff or public.dz_is_partner(auth.uid())) then
    raise exception 'not allowed';
  end if;
  if p_status not in ('pending', 'resolved', 'dismissed', 'all') then
    raise exception 'unknown status';
  end if;

  -- A partner's queue is the queue they can act on, and nothing else.
  --
  -- Without the dz_may_moderate() line a report filed against an admin, a dev
  -- or a fellow partner would appear in every partner's queue, naming them —
  -- which is the same leak dz_mod_find() would have been, arriving by the
  -- other door. Filtering it here also happens to be the better queue: a
  -- partner is never shown a row whose buttons would refuse them.
  --
  -- Staff see every row, including reports about each other.
  return query
  select r.id, r.reason, r.details, r.status, r.created_at,
         r.target_id, t.username, public.dz_is_banned(r.target_id),
         r.reporter_id, rp.username,
         r.resolved_by, r.resolved_at, r.resolution
    from public.user_reports r
    left join public.profiles t  on t.id  = r.target_id
    left join public.profiles rp on rp.id = r.reporter_id
   where (p_status = 'all' or r.status = p_status)
     and (v_staff or public.dz_may_moderate(auth.uid(), r.target_id))
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;
revoke all on function public.dz_reports_queue(text, integer) from public, anon;
grant execute on function public.dz_reports_queue(text, integer) to authenticated;

create or replace function public.dz_report_resolve(
  p_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_target uuid;
begin
  if not (public.dz_is_staff(auth.uid()) or public.dz_is_partner(auth.uid())) then
    raise exception 'not allowed';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'unknown status';
  end if;

  update public.user_reports
     set status = p_status, resolved_by = auth.uid(), resolved_at = now(),
         resolution = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending'
   returning target_id into v_target;

  if v_target is null then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  perform public.dz_audit('resolve_report', v_target,
    jsonb_build_object('report_id', p_id, 'status', p_status));
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.dz_report_resolve(uuid, text, text) from public, anon;
grant execute on function public.dz_report_resolve(uuid, text, text) to authenticated;

-- ===========================================================================
-- 6. PROMO CODES
-- ===========================================================================
-- Four to six characters, letters and digits, stored uppercase. The column is
-- the normalised form and there is no second column holding what was typed,
-- so there is nothing to compare case-insensitively at lookup time and no way
-- for ART24 and art24 to be two codes.
create table if not exists public.promo_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  partner_id  uuid not null references public.profiles(id) on delete cascade,
  is_active   boolean not null default true,
  usage_count integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint promo_code_shape check (code ~ '^[A-Z0-9]{4,6}$'),
  constraint promo_usage_nonneg check (usage_count >= 0)
);

comment on column public.promo_codes.usage_count is
  'Sales this code has earned a commission on. Incremented by the two triggers '
  'in section 7, and only when a commission row was actually written — so it '
  'always equals the number of rows in partner_commissions for this code, and '
  'a replayed webhook moves neither.';

create unique index if not exists promo_codes_code_idx    on public.promo_codes (code);
-- One code per partner, and this index is the whole of that rule.
create unique index if not exists promo_codes_partner_idx on public.promo_codes (partner_id);

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

comment on table public.promo_codes is
  'No RLS policy grants a read. A partner reads their own code through '
  'dz_promo_mine(); a buyer never reads this table at all, they type a code '
  'and dz_promo_resolve() answers yes or no. Selecting the table would list '
  'every partner''s code to every partner, which is the isolation rule this '
  'feature exists under.';

-- ---------------------------------------------------------------------------
-- Creating one.
--
-- The profanity filter is the site's own list — js/badwords.js on the client
-- reads the same words out of a table, so a code cannot be waved through here
-- and then flagged by the comment filter. If that table is not present the
-- check is skipped rather than the creation refused: an unfiltered code is a
-- moderation problem, a partner who cannot create a code at all is an outage.
create or replace function public.dz_promo_create(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id   uuid;
  v_bad  boolean := false;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if v_code !~ '^[A-Z0-9]{4,6}$' then
    raise exception 'A code is 4 to 6 letters or digits, nothing else';
  end if;
  if exists (select 1 from public.promo_codes where partner_id = auth.uid()) then
    raise exception 'You already have a code';
  end if;
  if exists (select 1 from public.promo_codes where code = v_code) then
    raise exception 'That code is taken';
  end if;

  begin
    select exists (
      select 1 from public.bad_words w
       where v_code = upper(w.word) or v_code like '%' || upper(w.word) || '%'
    ) into v_bad;
  exception when undefined_table then
    v_bad := false;
  end;
  if v_bad then
    raise exception 'Pick a different code';
  end if;

  insert into public.promo_codes (code, partner_id)
  values (v_code, auth.uid())
  returning id into v_id;

  perform public.dz_audit('create_promo', auth.uid(),
    jsonb_build_object('promo_id', v_id, 'code', v_code));

  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end $$;
revoke all on function public.dz_promo_create(text) from public, anon;
grant execute on function public.dz_promo_create(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Is this code usable, by this buyer, on this kind of purchase?
--
-- Called at checkout, by the caller, so auth.uid() is the buyer. It answers
-- with the code's id and the discount, and never with the partner's identity:
-- a buyer typing codes at random must not be able to map the partner list.
--
-- The anti-abuse rule is the second-to-last branch. A partner cannot spend
-- their own code, which would otherwise be a 90% discount on their own Max and
-- a 2.5% rebate to themselves on top of it.
create or replace function public.dz_promo_resolve(p_code text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  r      record;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if p_kind not in ('marketplace', 'subscription') then
    raise exception 'unknown purchase kind';
  end if;
  if v_code !~ '^[A-Z0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'error', 'That code does not look right');
  end if;

  select c.id, c.partner_id, c.is_active into r
    from public.promo_codes c where c.code = v_code;

  if not found or not r.is_active then
    return jsonb_build_object('ok', false, 'error', 'No such code');
  end if;
  -- The code stops working the moment the role does. A demoted partner's code
  -- is not deleted — the commissions already earned under it stay attributable
  -- — it simply stops taking new business.
  if not public.dz_is_partner(r.partner_id) then
    return jsonb_build_object('ok', false, 'error', 'No such code');
  end if;
  if r.partner_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'You cannot use your own code');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', r.id,
    'code', v_code,
    -- A marketplace code changes nothing about what the buyer pays. It is an
    -- attribution, not a discount, and saying so here keeps the checkout from
    -- drawing a discount line that would not appear on the charge.
    'discount_bps', case when p_kind = 'subscription' then 9000 else 0 end);
end $$;
revoke all on function public.dz_promo_resolve(text, text) from public, anon;
grant execute on function public.dz_promo_resolve(text, text) to authenticated;

-- ===========================================================================
-- 7. THE COMMISSION LEDGER
-- ===========================================================================
-- One row per sale that carried a code. Written by trigger, from the sale's
-- own figures, in the sale's own currency — the two triggers below are the
-- only writers and neither of them is reachable from a client.
create table if not exists public.partner_commissions (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.profiles(id) on delete cascade,
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  buyer_id      uuid references public.profiles(id) on delete set null,
  kind          text not null,
  -- Whichever record this commission was computed from. Exactly one is set,
  -- and the unique indexes below are what make a replayed webhook idempotent.
  earning_id    uuid,
  payment_id    uuid,
  label         text,
  gross_amount  bigint not null,
  rate_bps      integer not null,
  amount        bigint not null,
  currency      text   not null,
  amount_inr    bigint,
  fx_inr_rate   numeric(18,8),
  payout_status text   not null default 'wallet_credited',
  payout_id     uuid,
  created_at    timestamptz not null default now(),

  constraint pc_kind    check (kind in ('marketplace', 'subscription')),
  constraint pc_payout  check (payout_status in ('wallet_credited', 'paid_direct', 'reversed')),
  constraint pc_amounts check (gross_amount >= 0 and amount >= 0 and rate_bps between 0 and 10000),
  constraint pc_cur     check (currency ~ '^[A-Z]{3}$'),
  constraint pc_source  check (num_nonnulls(earning_id, payment_id) = 1)
);

create unique index if not exists partner_commissions_earning_idx
  on public.partner_commissions (earning_id) where earning_id is not null;
create unique index if not exists partner_commissions_payment_idx
  on public.partner_commissions (payment_id) where payment_id is not null;
create index if not exists partner_commissions_partner_idx
  on public.partner_commissions (partner_id, created_at desc);
create index if not exists partner_commissions_promo_idx
  on public.partner_commissions (promo_code_id, created_at desc);

alter table public.partner_commissions enable row level security;
revoke all on public.partner_commissions from anon, authenticated;

comment on table public.partner_commissions is
  'A partner''s whole wallet. There is no balance column anywhere — the '
  'balance is the sum of these rows less what has been paid out, computed by '
  'dz_partner_wallet(). Two records of the same money is how they come to '
  'disagree; see the seller wallet in 20260802_money_flow.sql, which is built '
  'the same way and for the same reason.';
comment on column public.partner_commissions.payout_status is
  'wallet_credited while the money is sitting here, paid_direct once a payout '
  'has carried it out. There is no pending state: this platform does not '
  'refund, so there is nothing to hold the money against.';

-- ---------------------------------------------------------------------------
-- The rates. In the config table beside the ones that are already there,
-- because that is where this schema keeps rates and because a percentage
-- written into a trigger body is a percentage nobody can find.
alter table public.platform_tax_config
  add column if not exists partner_market_bps  integer not null default 500,
  add column if not exists partner_sub_bps     integer not null default 250,
  add column if not exists promo_sub_discount_bps integer not null default 9000;

comment on column public.platform_tax_config.partner_market_bps is
  'The promo code owner''s share of a marketplace sale, in basis points of the '
  'gross. 500 = 5%. Taken OUT OF the platform''s commission_bps, never out of '
  'the seller''s net — a seller''s share does not change because a buyer typed '
  'a code, and the trigger below refuses to write a commission that would make '
  'it change.';
comment on column public.platform_tax_config.partner_sub_bps is
  'The promo code owner''s share of a Max subscription bought with their code, '
  'in basis points of the LIST price — 250 = 2.5%. The buyer pays 10% of list '
  'after promo_sub_discount_bps, so this is a quarter of what was collected.';

-- ---------------------------------------------------------------------------
-- Which code was used. One column on each of the two records that can carry a
-- sale, set by checkout, read by the triggers.
alter table public.marketplace_earnings
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;
alter table public.payments
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;

-- ---------------------------------------------------------------------------
-- MARKETPLACE. Fires after the earning is written, which is after
-- dz_earning_apply_deductions() has settled every other figure on the row, so
-- fee_amount here is the platform's real commission on this sale and the
-- partner's slice can be checked against it rather than assumed.
create or replace function public.dz_partner_credit_market()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cfg     public.platform_tax_config%rowtype;
  v_part  uuid;
  v_amt   bigint;
  v_rate  numeric(18,8);
  v_scale integer;
begin
  if new.promo_code_id is null then return new; end if;

  select partner_id into v_part from public.promo_codes
   where id = new.promo_code_id and is_active;
  if v_part is null then return new; end if;
  -- Attribution is not a payment. A code belonging to somebody who is no
  -- longer a partner stays on the sale for the record and earns nothing.
  if not public.dz_is_partner(v_part) then return new; end if;
  -- Belt and braces on top of dz_promo_resolve(): the code cannot pay its own
  -- owner, whichever side of the sale they were on.
  if v_part = new.seller_id or v_part = new.buyer_id then return new; end if;

  select * into cfg from public.platform_tax_config where id = 1;
  v_amt := round(new.gross_amount::numeric * cfg.partner_market_bps / 10000);

  -- The commission is the ceiling. On a sale where the deductions had already
  -- eaten into the platform's cut — dz_earning_apply_deductions() reduces
  -- fee_amount rather than let the statutory pieces go short — there may be
  -- less than five points left, and the partner gets what there is. This is
  -- the line that guarantees the seller's net is untouched: the money can only
  -- come from fee_amount, which has already been taken off the top.
  v_amt := least(v_amt, new.fee_amount);
  if v_amt <= 0 then return new; end if;

  v_scale := case when new.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end;
  select inr_rate into v_rate from public.fx_rates where code = new.currency;

  insert into public.partner_commissions (
    partner_id, promo_code_id, buyer_id, kind, earning_id, label,
    gross_amount, rate_bps, amount, currency, amount_inr, fx_inr_rate)
  values (
    v_part, new.promo_code_id, new.buyer_id, 'marketplace', new.id,
    'Marketplace sale',
    new.gross_amount, cfg.partner_market_bps, v_amt, new.currency,
    case when v_rate is null then null else round(v_amt * v_rate * v_scale) end,
    v_rate)
  on conflict (earning_id) where earning_id is not null do nothing;

  -- Only when a row was actually written. FOUND is false on the conflict path,
  -- and without this test a replayed webhook — which writes no commission,
  -- because the unique index refuses it — still walked the counter up, so a
  -- code that had converted twice reported three uses and the dashboard's
  -- conversion list did not match its own headline number.
  if found then
    update public.promo_codes
       set usage_count = usage_count + 1
     where id = new.promo_code_id;
  end if;

  return new;
end $$;

drop trigger if exists dz_partner_credit_market on public.marketplace_earnings;
create trigger dz_partner_credit_market
  after insert on public.marketplace_earnings
  for each row execute function public.dz_partner_credit_market();
revoke all on function public.dz_partner_credit_market() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS. The four checkout paths all end at the same place — a
-- payments row going to 'paid' — so this hangs off that transition rather than
-- off any of the four, and a replayed webhook writes nothing twice because of
-- the unique index on payment_id.
--
-- The rate is applied to the LIST price, which is what the buyer would have
-- paid without the code, and payments.amount on a promo order is the
-- discounted charge. So the list is reconstructed from the discount rather
-- than looked up again in subscription_prices: the price table can be edited
-- between the order opening and the webhook arriving, and the commission must
-- be a share of the sale that actually happened.
create or replace function public.dz_partner_credit_sub()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cfg     public.platform_tax_config%rowtype;
  v_part  uuid;
  v_list  bigint;
  v_amt   bigint;
  v_rate  numeric(18,8);
  v_scale integer;
begin
  if new.status <> 'paid' or new.kind <> 'subscription' then return new; end if;
  if new.promo_code_id is null then return new; end if;

  select partner_id into v_part from public.promo_codes
   where id = new.promo_code_id and is_active;
  if v_part is null then return new; end if;
  if not public.dz_is_partner(v_part) then return new; end if;
  if v_part = new.user_id then return new; end if;

  select * into cfg from public.platform_tax_config where id = 1;

  -- charge = list * (10000 - discount) / 10000, so list = charge * 10000 /
  -- (10000 - discount). A discount of 100% would divide by zero and is refused
  -- rather than guessed at.
  if cfg.promo_sub_discount_bps >= 10000 then return new; end if;
  v_list := round(new.amount::numeric * 10000 / (10000 - cfg.promo_sub_discount_bps));
  v_amt  := round(v_list::numeric * cfg.partner_sub_bps / 10000);

  -- Never more than came in. At the briefed rates the charge is 10% of list
  -- and the partner takes 2.5 points of list, which is a quarter of it, so
  -- this bites only if somebody edits the rates into an impossible shape.
  v_amt := least(v_amt, new.amount);
  if v_amt <= 0 then return new; end if;

  v_scale := case when new.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end;
  select inr_rate into v_rate from public.fx_rates where code = new.currency;

  insert into public.partner_commissions (
    partner_id, promo_code_id, buyer_id, kind, payment_id, label,
    gross_amount, rate_bps, amount, currency, amount_inr, fx_inr_rate)
  values (
    v_part, new.promo_code_id, new.user_id, 'subscription', new.id,
    'Max subscription',
    v_list, cfg.partner_sub_bps, v_amt, new.currency,
    case when v_rate is null then null else round(v_amt * v_rate * v_scale) end,
    v_rate)
  on conflict (payment_id) where payment_id is not null do nothing;

  -- Same guard as the marketplace trigger above, and it matters more here:
  -- this one hangs off a status transition, and a payment can be walked back
  -- to 'created' and settled again by a provider retry.
  if found then
    update public.promo_codes
       set usage_count = usage_count + 1
     where id = new.promo_code_id;
  end if;

  return new;
end $$;

drop trigger if exists dz_partner_credit_sub_ins on public.payments;
create trigger dz_partner_credit_sub_ins
  after insert on public.payments
  for each row when (new.status = 'paid')
  execute function public.dz_partner_credit_sub();

drop trigger if exists dz_partner_credit_sub_upd on public.payments;
create trigger dz_partner_credit_sub_upd
  after update of status on public.payments
  for each row when (old.status is distinct from new.status and new.status = 'paid')
  execute function public.dz_partner_credit_sub();
revoke all on function public.dz_partner_credit_sub() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- AND WHEN A SALE IS TAKEN BACK.
--
-- This platform does not refund, which is why a commission is available the
-- moment it is written and why there is no escrow anywhere above. A chargeback
-- is not a refund and does not ask our permission: paypal-webhook.js already
-- flips a disputed earning to 'reversed' and a refunded subscription's payment
-- to 'refunded', and without what follows the seller would lose the sale while
-- the partner kept the commission on it.
--
-- Reversed rather than deleted, so the ledger still shows what happened, and
-- dz_partner_wallet() excludes it from every figure it reports.
create or replace function public.dz_partner_reverse()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_rows integer;
begin
  update public.partner_commissions
     set payout_status = 'reversed'
   where payout_status = 'wallet_credited'
     and (   (tg_table_name = 'marketplace_earnings' and earning_id = new.id)
          or (tg_table_name = 'payments'             and payment_id = new.id));
  get diagnostics v_rows = row_count;

  -- The counter follows the ledger, as it does on the way in. A code whose one
  -- sale was charged back reads as zero uses, which is the truth.
  if v_rows > 0 then
    update public.promo_codes c
       set usage_count = greatest(c.usage_count - v_rows, 0)
     where c.id = new.promo_code_id;
  end if;

  return new;
end $$;

-- A commission already sent out of the platform is NOT clawed back here. That
-- is money that has left, and turning a paid_direct row into a reversed one
-- would make the wallet claim to have recovered something it has not. It is a
-- debt to chase, the same call paypal-webhook.js already makes about a
-- seller's paid-out earnings, and the same one for the same reason.
drop trigger if exists dz_partner_reverse_earning on public.marketplace_earnings;
create trigger dz_partner_reverse_earning
  after update of status on public.marketplace_earnings
  for each row when (old.status is distinct from new.status and new.status = 'reversed')
  execute function public.dz_partner_reverse();

drop trigger if exists dz_partner_reverse_payment on public.payments;
create trigger dz_partner_reverse_payment
  after update of status on public.payments
  for each row when (old.status is distinct from new.status
                     and new.status in ('refunded', 'reversed', 'disputed'))
  execute function public.dz_partner_reverse();
revoke all on function public.dz_partner_reverse() from public, anon, authenticated;

-- ===========================================================================
-- 8. THE PARTNER'S WALLET — derived, per currency, never converted
-- ===========================================================================
-- Same shape as dz_wallet_summary() and for the same reasons. No pending half:
-- a commission is available when it is written.
--
-- `direct` is not a second balance. It is the same money, described by where
-- it is going: if the partner has a payout method attached, everything here is
-- ready to be dispatched to it; if they have not, it accumulates and the
-- dashboard says so. The routing decision is one boolean, computed here, so
-- the browser is never the thing that decides which of the two a partner is on.
drop function if exists public.dz_partner_wallet();
create function public.dz_partner_wallet()
returns table(
  currency text, available bigint, lifetime bigint, paid_out bigint,
  conversions bigint, has_payout_method boolean, route text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_has boolean;
begin
  -- Partner only, and the same guard as dz_partner_ledger() and
  -- dz_promo_mine() beside it. This admitted staff for a while, which was
  -- worse than useless: nothing calls it as staff — an admin reads
  -- dz_admin_partners() — so the branch was dead, and a dead branch saying
  -- "staff may read a partner's wallet" is a sentence about this system that
  -- is not true. The three functions a partner's own page is built from now
  -- answer the same question the same way.
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;

  select exists (select 1 from public.payout_methods where user_id = auth.uid())
    into v_has;

  return query
  select c.currency,
         coalesce(sum(c.amount) filter (where c.payout_status = 'wallet_credited'), 0)::bigint,
         coalesce(sum(c.amount) filter (where c.payout_status <> 'reversed'), 0)::bigint,
         coalesce(sum(c.amount) filter (where c.payout_status = 'paid_direct'), 0)::bigint,
         count(*) filter (where c.payout_status <> 'reversed')::bigint,
         v_has,
         case when v_has then 'direct' else 'wallet' end
    from public.partner_commissions c
   where c.partner_id = auth.uid()
   group by c.currency
   order by c.currency;
end $$;
revoke all on function public.dz_partner_wallet() from public, anon;
grant execute on function public.dz_partner_wallet() to authenticated;

-- ---------------------------------------------------------------------------
-- The ledger the wallet is derived from: who used the code, what they bought,
-- what it earned. The buyer is named by handle only — a partner is told which
-- of their referrals converted, not the buyer's email or anything else about
-- them, and a marketplace row does not name the seller at all.
create or replace function public.dz_partner_ledger(
  p_limit integer default 50, p_before timestamptz default null)
returns table(
  id uuid, created_at timestamptz, kind text, label text,
  buyer_username text, gross_amount bigint, rate_bps integer,
  amount bigint, currency text, payout_status text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select c.id, c.created_at, c.kind, c.label,
         b.username, c.gross_amount, c.rate_bps, c.amount, c.currency,
         c.payout_status
    from public.partner_commissions c
    left join public.profiles b on b.id = c.buyer_id
   where c.partner_id = auth.uid()
     and (p_before is null or c.created_at < p_before)
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;
revoke all on function public.dz_partner_ledger(integer, timestamptz) from public, anon;
grant execute on function public.dz_partner_ledger(integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- A partner's own code and its numbers.
--
-- THE ISOLATION RULE LIVES HERE, and it is one line: the where clause says
-- auth.uid(). There is no p_partner argument to pass somebody else's id into,
-- which is the only way to be sure nobody can. An admin asking about a partner
-- goes through dz_admin_partners() below, which is a different function with a
-- different guard, so the two questions cannot be confused for one another.
create or replace function public.dz_promo_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r      record;
  v_conv record;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;

  select c.id, c.code, c.is_active, c.usage_count, c.created_at into r
    from public.promo_codes c where c.partner_id = auth.uid();

  if not found then
    return jsonb_build_object('ok', true, 'code', null);
  end if;

  select
    count(*) filter (where kind = 'marketplace')  as market,
    count(*) filter (where kind = 'subscription') as subs,
    count(distinct buyer_id)                     as buyers
    into v_conv
    from public.partner_commissions
   where partner_id = auth.uid() and payout_status <> 'reversed';

  return jsonb_build_object(
    'ok', true,
    'id', r.id, 'code', r.code, 'is_active', r.is_active,
    'usage_count', r.usage_count, 'created_at', r.created_at,
    'marketplace_conversions', coalesce(v_conv.market, 0),
    'subscription_conversions', coalesce(v_conv.subs, 0),
    'unique_buyers', coalesce(v_conv.buyers, 0));
end $$;
revoke all on function public.dz_promo_mine() from public, anon;
grant execute on function public.dz_promo_mine() to authenticated;

-- ===========================================================================
-- 9. BECOMING A PARTNER, AND CLAIMING THE MAX THAT COMES WITH IT
-- ===========================================================================
-- Invited by email, because that is what an admin has to hand — they are
-- inviting somebody they have spoken to, not somebody they found in a user
-- list. The address is matched against auth.users exactly; an unregistered
-- address is refused rather than held as an invitation, so there is no pending
-- state that could grant a role to whoever registers that address later.
create or replace function public.dz_grant_partner(p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    uuid;
  v_role  text;
  v_name  text;
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'That does not look like an email address';
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = v_email;
  if v_id is null then
    raise exception 'No account is registered to that address';
  end if;

  select p.role, p.username into v_role, v_name
    from public.profiles p where p.id = v_id;

  if v_role in ('admin', 'dev') then
    -- Not a promotion. Staff already outrank a partner everywhere in this
    -- file, and writing 'partner' over 'admin' would quietly demote them.
    raise exception 'That account is already staff';
  end if;
  if v_role = 'partner' then
    return jsonb_build_object('ok', true, 'changed', false,
                              'user_id', v_id, 'username', v_name);
  end if;

  update public.profiles
     set role = 'partner', partner_since = now()
   where id = v_id;

  insert into public.notifications (user_id, type, title, message)
  values (v_id, 'admin', 'You are now a DigiArtz partner',
          'Your Collab Hub is open: claim your free Max membership, create '
          'your promo code, and start earning on every sale it brings in.');

  perform public.dz_audit('grant_partner', v_id,
    jsonb_build_object('email', v_email));

  return jsonb_build_object('ok', true, 'changed', true,
                            'user_id', v_id, 'username', v_name);
end $$;
revoke all on function public.dz_grant_partner(text) from public, anon;
grant execute on function public.dz_grant_partner(text) to authenticated;

create or replace function public.dz_revoke_partner(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if not public.dz_is_partner(p_user) then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  -- 'guest', not null: a revoked partner should be indistinguishable from
  -- every other member, and on this database that is what every other member
  -- says. dz_is_ordinary() accepts either, so this is about not leaving one
  -- odd row behind rather than about correctness.
  update public.profiles set role = 'guest' where id = p_user;
  -- The code stops taking business; it is not deleted, because every
  -- commission row points at it and the history has to stay readable. Nothing
  -- already earned is touched, and a balance stays withdrawable.
  update public.promo_codes set is_active = false where partner_id = p_user;

  perform public.dz_audit('revoke_partner', p_user, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.dz_revoke_partner(uuid) from public, anon;
grant execute on function public.dz_revoke_partner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The free Max.
--
-- Perpetual is expressed as a date a century out rather than as null, because
-- dz_effective_tier() and every gate downstream of it compare against
-- subscription_expires_at and a null there has always meant "no subscription".
-- A date keeps one meaning for the column and needs no reader to be changed.
--
-- No payments row is written. Nothing was paid, and a zero-amount payment in
-- the revenue tables would be a sale that never happened.
create or replace function public.dz_claim_max()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_until timestamptz;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.profiles
              where id = auth.uid() and max_claimed) then
    return jsonb_build_object('ok', true, 'changed', false, 'tier', 'max');
  end if;

  v_until := now() + interval '100 years';

  update public.profiles
     set subscription_tier = 'max',
         subscription_expires_at = greatest(
           coalesce(subscription_expires_at, v_until), v_until),
         max_claimed = true
   where id = auth.uid();

  perform public.dz_audit('claim_max', auth.uid(),
    jsonb_build_object('until', v_until));

  return jsonb_build_object('ok', true, 'changed', true, 'tier', 'max',
                            'until', v_until);
end $$;
revoke all on function public.dz_claim_max() from public, anon;
grant execute on function public.dz_claim_max() to authenticated;

-- What the subscription page needs to know before it draws anything: is this
-- member a partner, and have they already claimed. Cheap, and safe for a
-- member to ask about themselves — it answers about auth.uid() and takes no
-- argument.
-- Answers with a whole object or with an object saying no, and never with
-- NULL. A signed-in member whose profile row has not been written yet — the
-- seconds between signing up and the signup trigger landing — used to get a
-- bare null here, and every caller then had to remember to test for it before
-- reading a field off it. Two of them do test for it; the third would have
-- been the bug.
create or replace function public.dz_my_collab_state()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select jsonb_build_object(
       'role', p.role,
       'is_partner', p.role = 'partner',
       'is_staff', p.role in ('admin', 'dev'),
       'max_claimed', p.max_claimed,
       'tier', coalesce(public.dz_effective_tier(p.id), 'guest'),
       'has_promo', exists (
         select 1 from public.promo_codes pc where pc.partner_id = p.id),
       'has_payout_method', exists (
         select 1 from public.payout_methods pm where pm.user_id = p.id))
     from public.profiles p where p.id = auth.uid()),
    jsonb_build_object(
      'role', null, 'is_partner', false, 'is_staff', false,
      'max_claimed', false, 'tier', 'guest',
      'has_promo', false, 'has_payout_method', false));
$$;
revoke all on function public.dz_my_collab_state() from public, anon;
grant execute on function public.dz_my_collab_state() to authenticated;

-- ===========================================================================
-- 10. WHAT AN ADMIN SEES THAT A PARTNER DOES NOT
-- ===========================================================================
-- Every partner, their code, their numbers. The guard is dz_is_staff and there
-- is no partner branch — a partner calling this is refused outright rather
-- than served their own row, because a function that sometimes answers with
-- one row and sometimes with all of them is a function whose guard has to be
-- right every time it is edited.
create or replace function public.dz_admin_partners()
returns table(
  partner_id uuid, username text, display_name text, partner_since timestamptz,
  max_claimed boolean, code text, code_active boolean, usage_count integer,
  conversions bigint, earned_json jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select p.id, p.username, p.display_name, p.partner_since, p.max_claimed,
         c.code, c.is_active, c.usage_count,
         coalesce(x.n, 0)::bigint,
         coalesce(x.earned, '{}'::jsonb)
    from public.profiles p
    left join public.promo_codes c on c.partner_id = p.id
    -- pc, not a bare table name: partner_id is also this function's first OUT
    -- parameter, and an unqualified reference to it here resolves to the
    -- variable rather than the column. Postgres calls that ambiguous and
    -- refuses the whole function at run time — which is a PARTNERS tab that
    -- shows an error and no list.
    left join lateral (
      select count(*) as n,
             jsonb_object_agg(t.currency, t.amt) as earned
        from (select pc.currency, sum(pc.amount)::bigint as amt
                from public.partner_commissions pc
               where pc.partner_id = p.id and pc.payout_status <> 'reversed'
               group by pc.currency) t
    ) x on true
   where p.role = 'partner'
   order by p.partner_since desc nulls last, p.username;
end $$;
revoke all on function public.dz_admin_partners() from public, anon;
grant execute on function public.dz_admin_partners() to authenticated;

-- ---------------------------------------------------------------------------
-- The audit trail, read back.
--
-- dz_audit() has been writing to audit_log since the first guard in this file;
-- this is what makes it readable, and without it the log was a table nobody
-- could look at without a database console — which is the same as not having
-- one when a partner's ban is questioned three months later.
--
-- STAFF ONLY, and deliberately not extended to partners even for their own
-- actions. The log names every actor, and a partner reading even a filtered
-- slice of it learns that other moderators exist and roughly what they do.
-- A partner who needs a record of their own bans has the member's ban row,
-- which names them.
--
-- The actor's role is read off the ROW, not joined from the profile. It was
-- copied there when the action happened, so a partner who is demoted next
-- month does not make last month's ban look like a member did it.
create or replace function public.dz_audit_log(
  p_limit integer default 100, p_before timestamptz default null)
returns table(
  id bigint, created_at timestamptz, action text,
  actor_id uuid, actor_username text, actor_role text,
  target_id uuid, target_username text, metadata jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select a.id, a.created_at, a.action,
         a.actor_id, ap.username, a.actor_role,
         a.target_id, tp.username, a.metadata
    from public.audit_log a
    left join public.profiles ap on ap.id = a.actor_id
    left join public.profiles tp on tp.id = a.target_id
   where p_before is null or a.created_at < p_before
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;
revoke all on function public.dz_audit_log(integer, timestamptz) from public, anon;
grant execute on function public.dz_audit_log(integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- The telemetry dashboard, in one call.
--
-- One call rather than nine, so the counters on screen are all from the same
-- moment. A dashboard that fetches its numbers separately shows a submission
-- count from one second and an active-user count from another, and somebody
-- eventually reconciles the two and finds a bug that is not there.
--
-- DAU and MAU are counted over analytics_events, which is where this site
-- already records that somebody did something. A signed-out visitor is counted
-- by viewer_key, the same key the view-dedup tables use, so one person is one
-- person whether or not they were signed in.
create or replace function public.dz_admin_telemetry()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sub     jsonb;
  v_content jsonb;
  v_dev     jsonb;
  v_eng     jsonb;
  v_mod     jsonb;
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;

  -- Tiers, live. Counted through the expiry rather than off subscription_tier,
  -- so a lapsed Max is not reported as a Max — the column still says 'max' the
  -- morning after, which is the whole reason dz_effective_tier() exists.
  select jsonb_build_object(
           'lite',    count(*) filter (where tier = 'lite'),
           'premium', count(*) filter (where tier = 'premium'),
           'max',     count(*) filter (where tier = 'max'),
           'free',    count(*) filter (where tier not in ('lite', 'premium', 'max')),
           'partners', count(*) filter (where role = 'partner'),
           'total',   count(*))
    into v_sub
    from (
      select p.role,
             case when p.subscription_expires_at is null
                   or p.subscription_expires_at <= now()
                  then 'guest' else coalesce(p.subscription_tier, 'guest') end as tier
        from public.profiles p) t;

  select jsonb_build_object(
           'artworks',    (select count(*) from public.artworks),
           'resources',   (select count(*) from public.resources),
           'marketplace', (select count(*) from public.marketplace_items),
           'blogs',       (select count(*) from public.blog_posts),
           'jobs',        (select count(*) from public.jobs),
           'communities', (select count(*) from public.communities),
           'today', jsonb_build_object(
             'artworks',    (select count(*) from public.artworks         where created_at >= current_date),
             'resources',   (select count(*) from public.resources        where created_at >= current_date),
             'marketplace', (select count(*) from public.marketplace_items where created_at >= current_date),
             'blogs',       (select count(*) from public.blog_posts       where created_at >= current_date),
             'jobs',        (select count(*) from public.jobs             where created_at >= current_date)))
    into v_content;

  -- Devices over the last 24 hours of recorded activity. 'unknown' is reported
  -- rather than folded into desktop: a bucket that quietly absorbs what the
  -- client could not tell us is a bucket that hides a broken client.
  select coalesce(jsonb_object_agg(device, n), '{}'::jsonb)
    into v_dev
    from (select device, count(distinct viewer_key)::bigint as n
            from public.analytics_events
           where created_at >= now() - interval '24 hours'
           group by device) d;

  select jsonb_build_object(
           'dau', (select count(distinct viewer_key) from public.analytics_events
                    where created_at >= now() - interval '24 hours'),
           'mau', (select count(distinct viewer_key) from public.analytics_events
                    where created_at >= now() - interval '30 days'),
           'dau_signed_in', (select count(distinct actor_id) from public.analytics_events
                              where actor_id is not null
                                and created_at >= now() - interval '24 hours'),
           'events_24h', (select count(*) from public.analytics_events
                           where created_at >= now() - interval '24 hours'),
           'new_members_24h', (select count(*) from public.profiles
                                where created_at >= now() - interval '24 hours'))
    into v_eng;

  select jsonb_build_object(
           'open_user_reports', (select count(*) from public.user_reports where status = 'pending'),
           'open_item_reports', (select count(*) from public.artwork_reports where status = 'open'),
           'active_bans', (select count(*) from public.user_bans
                            where lifted_at is null
                              and (expires_at is null or expires_at > now())))
    into v_mod;

  return jsonb_build_object(
    'at', now(), 'subscriptions', v_sub, 'content', v_content,
    'devices', v_dev, 'engagement', v_eng, 'moderation', v_mod);
end $$;
revoke all on function public.dz_admin_telemetry() from public, anon;
grant execute on function public.dz_admin_telemetry() to authenticated;

-- ===========================================================================
-- 11. THE PLATFORM'S REVENUE, LESS WHAT IT NOW SHARES
-- ===========================================================================
-- Restated rather than patched, for the same reason the Max migration restated
-- dz_earning_apply_deductions(): there is one other copy of this function and
-- two copies of a revenue report is one too many.
--
-- One line of arithmetic changes — commission is now net of what partners
-- earned — and one column is added so the share is visible rather than merely
-- subtracted. Subscription revenue is reported gross of the discount because
-- payments.amount is already what was actually charged; the partner's slice of
-- it comes off in the same partner_inr figure.
drop function if exists public.dz_platform_revenue();
create function public.dz_platform_revenue()
returns table(commission_inr bigint, subscriptions_inr bigint, partner_inr bigint,
              total_inr bigint, tds_held_inr bigint, tcs_held_inr bigint,
              held_for_sellers json)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  return query
  with com as (
    select coalesce(sum(fee_inr), 0)::bigint as amt
    from public.marketplace_earnings where status <> 'reversed'
  ),
  stat as (
    select
      coalesce(sum(round(e.tds_amount * f.inr_rate *
        case when e.currency in ('JPY','HUF','TWD') then 100 else 1 end)), 0)::bigint as tds,
      coalesce(sum(round(e.tcs_amount * f.inr_rate *
        case when e.currency in ('JPY','HUF','TWD') then 100 else 1 end)), 0)::bigint as tcs
    from public.marketplace_earnings e
    join public.fx_rates f on f.code = e.currency
    where e.status <> 'reversed'
  ),
  sub as (
    select coalesce(sum(round(p.amount * f.inr_rate *
             case when p.currency in ('JPY','HUF','TWD') then 100 else 1 end)), 0)::bigint as amt
    from public.payments p
    join public.fx_rates f on f.code = p.currency
    where p.kind = 'subscription' and p.status = 'paid'
  ),
  -- Owed to partners or already sent to them. Not ours, on either side of the
  -- payout — the same reasoning that keeps a seller's net out of this figure.
  prt as (
    select coalesce(sum(c.amount_inr), 0)::bigint as amt
    from public.partner_commissions c
    where c.payout_status <> 'reversed'
  ),
  held as (
    select coalesce(json_object_agg(currency, amt), '{}'::json) as js
    from (
      select currency, sum(net_amount)::bigint as amt
      from public.marketplace_earnings
      where status in ('pending', 'available')
      group by currency
    ) x
  )
  select com.amt, sub.amt, prt.amt,
         (com.amt + sub.amt - prt.amt)::bigint,
         stat.tds, stat.tcs, held.js
  from com, sub, stat, prt, held;
end $$;
revoke all on function public.dz_platform_revenue() from public, anon;
grant execute on function public.dz_platform_revenue() to authenticated;

-- ===========================================================================
-- 12. THE BAN GATE, ATTACHED
-- ===========================================================================
-- Last, because the loop below skips any table that does not exist yet and
-- user_reports is created in section 5 of this same file. Attaching it up
-- beside dz_ban_gate() left the one table this migration adds ungated, and a
-- banned account could still file reports — which is precisely the abuse a
-- ban is for.
-- The same table list the rate limiter uses, and deliberately so: those are
-- the tables a member can write, and the two lists drifting apart is how a
-- surface ends up rate limited but not ban-gated, or the reverse.
do $$
declare r record;
begin
  for r in
    select * from (values
      ('artworks', 'INSERT'), ('artworks', 'UPDATE'),
      ('resources', 'INSERT'), ('resources', 'UPDATE'),
      ('marketplace_items', 'INSERT'), ('marketplace_items', 'UPDATE'),
      ('blog_posts', 'INSERT'), ('blog_posts', 'UPDATE'),
      ('jobs', 'INSERT'), ('jobs', 'UPDATE'),
      ('item_comments', 'INSERT'), ('comments', 'INSERT'),
      ('direct_messages', 'INSERT'),
      ('item_reports', 'INSERT'), ('artwork_reports', 'INSERT'),
      ('user_reports', 'INSERT'),
      ('albums', 'INSERT'), ('albums', 'UPDATE'),
      ('profiles', 'UPDATE'),
      ('profile_creds', 'INSERT'),
      ('scheduled_uploads', 'INSERT'), ('scheduled_sections', 'INSERT'),
      ('item_likes', 'INSERT'), ('item_bookmarks', 'INSERT'),
      ('cart_items', 'INSERT'), ('community_members', 'INSERT'),
      ('friendships', 'INSERT')
    ) as t(tbl, op)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;

    execute format('drop trigger if exists dz_ban_%s_%s on public.%I',
                   lower(r.op), r.tbl, r.tbl);
    -- Fired BEFORE the rate limiter would matter and before any of the row's
    -- own triggers: a suspended account should not consume a rate budget it
    -- cannot spend, and should not reach a uniqueness check that would tell it
    -- something about the table.
    execute format(
      'create trigger dz_ban_%s_%s before %s on public.%I '||
      'for each row execute function public.dz_ban_gate()',
      lower(r.op), r.tbl, r.op, r.tbl);
  end loop;
end $$;
