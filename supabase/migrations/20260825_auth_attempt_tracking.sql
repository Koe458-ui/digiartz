create table if not exists public.auth_attempts (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  ip         text,
  email_key  text,
  event      text not null
             check (event in ('login', 'signup', 'logout', 'recover')),
  ok         boolean
);
create index if not exists auth_attempts_ip_idx
  on public.auth_attempts (ip, created_at desc);
create index if not exists auth_attempts_time_idx
  on public.auth_attempts (created_at desc);

alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

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
  return left(encode(extensions.hmac(v_norm, v_key, 'sha256'), 'hex'), 32);
end $$;
revoke all on function public.dz_email_key(text) from public, anon, authenticated;

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

  if v_ip is null or v_ip = '' then return; end if;

  if not public.dz_rate_ok('authnote:' || v_ip, 60, 3600) then return; end if;

  insert into public.auth_attempts (ip, email_key, event, ok)
  values (v_ip, public.dz_email_key(p_email), p_event, p_ok);

  if random() < 0.01 then
    delete from public.auth_attempts where created_at < now() - interval '1 day';
  end if;
exception when others then
  return;
end $$;
revoke all on function public.dz_note_auth(text, text, boolean) from public;
grant execute on function public.dz_note_auth(text, text, boolean) to anon, authenticated;

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
