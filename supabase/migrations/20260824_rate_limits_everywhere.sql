create or replace function public.dz_actor_key()
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_hdr  text;
  v_ip   text;
begin
  if v_uid is not null then
    return 'u:' || v_uid::text;
  end if;

  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role')
    );
  exception when others then
    v_role := null;
  end;
  if v_role = 'service_role' then return null; end if;

  v_hdr := nullif(current_setting('request.headers', true), '');
  if v_hdr is null then return null; end if;

  if to_regprocedure('public.dz_client_ip()') is not null then
    begin v_ip := public.dz_client_ip(); exception when others then v_ip := null; end;
  end if;

  return case when v_ip is not null and v_ip <> '' then 'ip:' || v_ip else 'anon' end;
end $$;

create or replace function public.dz_write_rate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_key  text := public.dz_actor_key();
  v_noun text := coalesce(nullif(TG_ARGV[0], ''), 'requests');
  v_max  int  := coalesce(nullif(TG_ARGV[1], '')::int, 30);
  v_win  int  := coalesce(nullif(TG_ARGV[2], '')::int, 3600);
begin
  if v_key is null then return new; end if;

  if left(v_key, 2) <> 'u:' then
    v_max := greatest(1, v_max / 4);
  end if;

  if not public.dz_rate_ok(
       TG_TABLE_NAME || ':' || TG_OP || ':' || v_key, v_max, v_win) then
    raise exception 'Too many % in a short time — wait a moment and try again', v_noun
      using errcode = 'P0001';
  end if;

  if not public.dz_rate_ok('all:' || v_key, 240, 300) then
    raise exception 'Too many changes in a short time — wait a moment and try again'
      using errcode = 'P0001';
  end if;

  if TG_OP = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare
  r        record;
  v_op     text;
  v_trig   text;
  v_n      int := 0;
begin
  for r in
    select c.relname as tbl,
           bool_or(pol.polcmd in ('a', '*')) as ins,
           bool_or(pol.polcmd in ('w', '*')) as upd
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and pol.polcmd in ('a', 'w', '*')
       and exists (
         select 1 from unnest(coalesce(pol.polroles, '{}')) as role_oid
          where pg_get_userbyid(role_oid) in ('anon', 'authenticated')
       )
       and c.relname not in ('rate_hits', 'chat_rate_events', 'chat_cooldowns',
                             'dz_abuse_events', 'reserved_names', 'audit_log',
                             'upload_events', 'analytics_events',
                             'moderation_logs',
                             'comments', 'direct_messages')
     group by c.relname
     order by 1
  loop
    foreach v_op in array array['INSERT', 'UPDATE'] loop
      continue when (v_op = 'INSERT' and not r.ins)
                 or (v_op = 'UPDATE' and not r.upd);

      v_trig := 'dz_rate_' || lower(v_op) || '_' || r.tbl;
      if not exists (
        select 1 from pg_trigger t
         where t.tgrelid = to_regclass('public.' || quote_ident(r.tbl))
           and t.tgname = v_trig
           and not t.tgisinternal
      ) then
        execute format(
          'create trigger %I before %s on public.%I '||
          'for each row execute function public.dz_write_rate(%L, %L, %L)',
          v_trig, v_op, r.tbl, 'changes', '60', '300');
        v_n := v_n + 1;
      end if;

      if to_regprocedure('public.dz_ban_gate()') is not null then
        v_trig := 'dz_ban_' || lower(v_op) || '_' || r.tbl;
        if not exists (
          select 1 from pg_trigger t
           where t.tgrelid = to_regclass('public.' || quote_ident(r.tbl))
             and t.tgname = v_trig
             and not t.tgisinternal
        ) then
          execute format(
            'create trigger %I before %s on public.%I '||
            'for each row execute function public.dz_ban_gate()',
            v_trig, v_op, r.tbl);
        end if;
      end if;
    end loop;
  end loop;

  raise notice 'rate limiter: % trigger(s) attached to previously unlimited '
               'table/operation pairs', v_n;
end $$;

do $$
declare
  r record;
begin
  for r in
    select distinct c.relname as tbl
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and pol.polcmd in ('d', '*')
       and exists (
         select 1 from unnest(coalesce(pol.polroles, '{}')) as role_oid
          where pg_get_userbyid(role_oid) in ('anon', 'authenticated')
       )
       and c.relname not in ('rate_hits', 'chat_rate_events', 'chat_cooldowns',
                             'dz_abuse_events', 'reserved_names', 'audit_log',
                             'upload_events', 'analytics_events')
     order by 1
  loop
    if exists (
      select 1 from pg_trigger t
       where t.tgrelid = to_regclass('public.' || quote_ident(r.tbl))
         and t.tgname = 'dz_rate_delete_' || r.tbl
         and not t.tgisinternal
    ) then continue; end if;

    execute format(
      'create trigger %I before delete on public.%I '||
      'for each row execute function public.dz_write_rate(%L, %L, %L)',
      'dz_rate_delete_' || r.tbl, r.tbl, 'deletions', '200', '300');
  end loop;
end $$;

create or replace function public.dz_signup_rate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ip text;
begin
  if to_regprocedure('public.dz_client_ip()') is null then return NEW; end if;
  begin v_ip := public.dz_client_ip(); exception when others then v_ip := null; end;
  if v_ip is null or v_ip = '' then return NEW; end if;

  if not public.dz_rate_ok('signup:ip:' || v_ip, 6, 3600) then
    raise exception 'Too many accounts created from here recently — try again later'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;

drop trigger if exists dz_signup_rate_ins on public.profiles;
create trigger dz_signup_rate_ins
  before insert on public.profiles
  for each row execute function public.dz_signup_rate();

create or replace function public.dz_read_guard(p_name text, p_max int, p_win int)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_key text := public.dz_actor_key();
begin
  if v_key is null then return; end if;
  if not public.dz_rate_ok('read:' || p_name || ':' || v_key, p_max, p_win) then
    raise exception 'Too many requests — slow down and try again'
      using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.dz_read_guard(text, int, int) from public, anon, authenticated;

comment on function public.dz_read_guard(text, int, int) is
  'One line at the top of an expensive SECURITY DEFINER read puts a per-caller '
  'ceiling on it: perform public.dz_read_guard(''cm_browse'', 120, 60); '
  'Add it to any new browse/search function.';
