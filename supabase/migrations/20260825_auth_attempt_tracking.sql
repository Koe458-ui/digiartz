-- Noticing when one address is cycling through accounts
--
-- The phishing account signed up and posted within two minutes. The signup
-- limiter in 20260824 caps that at six accounts an hour per address, which
-- stops a flood but says nothing about the pattern that actually gives an
-- abuser away: the same address signing in and out of several different
-- accounts in quick succession. Six is a generous ceiling for a household and
-- an enormous one for one person, and everything under it was invisible.
--
-- This file makes that pattern visible, and gives the sign-in page a way to
-- ask "should I make this one prove they are a person?" before it lets the
-- attempt through.
--
-- WHY NOT auth.audit_log_entries. GoTrue keeps its own log with an ip_address
-- column, which looks like exactly the right source and is not: it is pruned
-- on a schedule outside our control and was already empty on this project when
-- checked. A control cannot depend on a table that may or may not have rows in
-- it, so attempts are recorded here instead.
--
-- WHAT IS AND IS NOT STORED. An email address is a person's identity and this
-- table is a security log, not a mailing list, so no address is written to it.
-- What is stored is a keyed hash — enough to answer "is this the same account
-- as that one?", useless for answering "which account is it?". The key is the
-- project's own, not a per-row salt: a per-row salt would make the rows
-- incomparable and the count impossible.

-- ===========================================================================
-- 1. THE LOG
-- ===========================================================================
create table if not exists public.auth_attempts (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  ip         text,
  email_key  text,                       -- keyed hash, never the address
  event      text not null
             check (event in ('login', 'signup', 'logout', 'recover')),
  ok         boolean                     -- null when the client cannot tell
);
create index if not exists auth_attempts_ip_idx
  on public.auth_attempts (ip, created_at desc);
create index if not exists auth_attempts_time_idx
  on public.auth_attempts (created_at desc);

alter table public.auth_attempts enable row level security;
-- No policy is declared, so RLS denies every direct read and write. The only
-- way in is through the two SECURITY DEFINER functions below — a member cannot
-- read the log, cannot forge rows into it, and cannot learn another address's
-- history from it.
revoke all on public.auth_attempts from anon, authenticated;


-- ===========================================================================
-- 2. THE HASH
-- ===========================================================================
-- pgcrypto ships with Supabase. hmac() over a key that lives in the database
-- rather than in the page: the client sends the address it was going to send
-- to GoTrue anyway, and it is hashed here, server-side, before it is stored.
create extension if not exists pgcrypto with schema extensions;

-- The key. Generated once, on first run, and never regenerated — rotating it
-- would make every existing row incomparable with every new one and silently
-- blind the detector for an hour. Stored in its own table rather than in a
-- setting so that it survives a restart and stays out of pg_settings.
create table if not exists public.dz_secrets (
  name  text primary key,
  value text not null
);
alter table public.dz_secrets enable row level security;
revoke all on public.dz_secrets from anon, authenticated;

insert into public.dz_secrets (name, value)
select 'auth_attempt_key', encode(extensions.gen_random_bytes(32), 'hex')
 where not exists (select 1 from public.dz_secrets where name = 'auth_attempt_key');

create or replace function public.dz_email_key(p_email text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_key text;
  v_norm text := lower(btrim(coalesce(p_email, '')));
begin
  if v_norm = '' then return null; end if;
  select value into v_key from public.dz_secrets where name = 'auth_attempt_key';
  if v_key is null then return null; end if;
  -- 32 hex characters is 128 bits of the digest: far past collision concerns
  -- at this table's size, and short enough to index cheaply.
  return left(encode(extensions.hmac(v_norm, v_key, 'sha256'), 'hex'), 32);
end $$;
revoke all on function public.dz_email_key(text) from public, anon, authenticated;


-- ===========================================================================
-- 3. RECORDING AN ATTEMPT
-- ===========================================================================
-- Called by the sign-in page, so it must be callable by anon — the whole point
-- is to record attempts made by people who are not signed in.
--
-- It returns void and swallows its own errors. A logging call is never allowed
-- to be the reason somebody cannot sign in.
create or replace function public.dz_note_auth(
  p_event text, p_email text default null, p_ok boolean default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ip text;
begin
  if p_event is null or p_event not in ('login', 'signup', 'logout', 'recover') then
    return;
  end if;

  if to_regprocedure('public.dz_client_ip()') is not null then
    begin v_ip := public.dz_client_ip(); exception when others then v_ip := null; end;
  end if;

  -- A caller with no resolvable address tells us nothing and would only pile
  -- up rows nothing can ever group by.
  if v_ip is null or v_ip = '' then return; end if;

  -- The log itself is rate limited, or it becomes the abuse. Sixty attempts an
  -- hour from one address is far past any honest sign-in and still leaves the
  -- detector plenty to count.
  if not public.dz_rate_ok('authnote:' || v_ip, 60, 3600) then return; end if;

  insert into public.auth_attempts (ip, email_key, event, ok)
  values (v_ip, public.dz_email_key(p_email), p_event, p_ok);

  -- Opportunistic sweep, same pattern as dz_rate_ok. The detector only ever
  -- looks back one hour; a day is kept so there is something to investigate
  -- with after the fact.
  if random() < 0.01 then
    delete from public.auth_attempts where created_at < now() - interval '1 day';
  end if;
exception when others then
  return;
end $$;
revoke all on function public.dz_note_auth(text, text, boolean) from public;
grant execute on function public.dz_note_auth(text, text, boolean) to anon, authenticated;


-- ===========================================================================
-- 4. SHOULD THIS ONE PROVE THEY ARE A PERSON
-- ===========================================================================
-- Three signals, any one of which is enough. Each is set where an ordinary
-- person on an ordinary connection does not reach it, including the shared
-- ones — an office, a campus, a household behind one NAT.
--
--   ACCOUNT CYCLING — three or more DIFFERENT accounts attempting to sign in
--   from one address within the hour. This is the pattern asked for: sign in,
--   sign out, sign in as somebody else. A family sharing a laptop reaches two
--   over an evening and rarely three within sixty minutes.
--
--   FAILED PASSWORDS — five failures within the hour, which is password
--   guessing whether or not the accounts differ.
--
--   REPEAT SIGNUPS — a second signup from one address within the hour. The
--   hard ceiling is still six (dz_signup_rate); this is the softer line where
--   a challenge appears rather than a refusal.
--
-- Returns a plain boolean and nothing else. It deliberately does not say WHICH
-- rule fired: the page has no use for it and an attacker would.
create or replace function public.dz_captcha_required()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ip     text;
  v_since  timestamptz := now() - interval '1 hour';
  v_accts  int;
  v_fails  int;
  v_signup int;
begin
  if to_regprocedure('public.dz_client_ip()') is not null then
    begin v_ip := public.dz_client_ip(); exception when others then v_ip := null; end;
  end if;
  -- No address means no evidence either way. Answering "true" here would put a
  -- challenge in front of everybody the moment a header changed shape.
  if v_ip is null or v_ip = '' then return false; end if;

  select count(distinct email_key) filter (where event = 'login' and email_key is not null),
         count(*)                  filter (where event = 'login' and ok is false),
         count(*)                  filter (where event = 'signup')
    into v_accts, v_fails, v_signup
    from public.auth_attempts
   where ip = v_ip and created_at > v_since;

  return coalesce(v_accts, 0) >= 3
      or coalesce(v_fails, 0) >= 5
      or coalesce(v_signup, 0) >= 2;
end $$;
revoke all on function public.dz_captcha_required() from public;
grant execute on function public.dz_captcha_required() to anon, authenticated;


-- ===========================================================================
-- 5. WHAT STAFF CAN SEE
-- ===========================================================================
-- Addresses cycling through accounts, worst first. The email keys are hashes,
-- so this answers "how many accounts" and never "whose".
create or replace function public.dz_auth_churn(p_hours int default 24)
returns table (
  ip        text,
  accounts  bigint,
  logins    bigint,
  failures  bigint,
  signups   bigint,
  first_at  timestamptz,
  last_at   timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if to_regprocedure('public.dz_is_staff()') is not null then
    if not public.dz_is_staff() then
      raise exception 'staff only' using errcode = '42501';
    end if;
  elsif to_regprocedure('public.is_dev()') is not null then
    if not public.is_dev() then
      raise exception 'staff only' using errcode = '42501';
    end if;
  else
    raise exception 'staff only' using errcode = '42501';
  end if;

  return query
    select a.ip,
           count(distinct a.email_key) filter (where a.email_key is not null),
           count(*) filter (where a.event = 'login'),
           count(*) filter (where a.event = 'login' and a.ok is false),
           count(*) filter (where a.event = 'signup'),
           min(a.created_at), max(a.created_at)
      from public.auth_attempts a
     where a.created_at > now() - make_interval(
             hours => greatest(1, least(coalesce(p_hours, 24), 168)))
     group by a.ip
     having count(distinct a.email_key) > 1 or count(*) filter (where a.event = 'login' and a.ok is false) > 2
     order by count(distinct a.email_key) desc, count(*) desc;
end $$;
revoke all on function public.dz_auth_churn(int) from public, anon;
grant execute on function public.dz_auth_churn(int) to authenticated;
