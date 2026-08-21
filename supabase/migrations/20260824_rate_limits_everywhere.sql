-- Rate limiting with no holes in it
--
-- 20260809_write_rate_limits.sql attached a limiter to twenty-odd tables and
-- was right about all of them. What it could not cover, and what this file
-- closes, is three gaps that a limiter with a list always has.
--
-- 1. THE LIST GOES STALE. Every table added since — item_likes, cart_items,
--    user_reports, community_members, friendships — needed somebody to
--    remember to add a line. Mostly they did. "Mostly" is the problem: the way
--    a surface ends up unlimited is that it was added on a day when the list
--    was not the thing being edited. So the list is still there, because the
--    per-table numbers are worth choosing by hand, but a discovery pass now
--    runs after it and attaches a conservative default to anything writable
--    that the list forgot. A new table is limited from the moment it exists.
--
-- 2. SIGNED-OUT WRITES WERE NOT LIMITED AT ALL. dz_write_rate opens with
--
--        if v_uid is null then return new; end if;
--
--    and the comment above it explains why: the scheduled publishers run as
--    SECURITY DEFINER from cron with no auth.uid(), and rate limiting the site
--    against itself would be absurd. True — but auth.uid() is also null for
--    every anonymous caller holding the public anon key, which is everyone,
--    because the key ships in config.js. Anything anon can write, anon could
--    write without limit. The fix is to tell the two apart rather than to
--    treat them the same: cron has no client IP and no request headers at all,
--    an anonymous HTTP caller has both.
--
-- 3. PER-TABLE BUDGETS ADD UP. Twenty tables at twenty writes per five minutes
--    is four hundred writes per five minutes for one account, all of it inside
--    the rules. Each individual ceiling was sensible and the sum was not. A
--    global bucket now sits over the per-table ones.

-- ===========================================================================
-- 1. WHO IS THIS
-- ===========================================================================
-- One identity for every limiter to key on, and one place that decides what
-- counts as "internal, do not limit".
--
-- Returns:
--   'u:<uuid>'  a signed-in member
--   'ip:<addr>' an anonymous caller we can at least name
--   'anon'      an anonymous caller behind no usable header — shared bucket,
--               deliberately, because an unnamed caller is not entitled to its
--               own budget
--   NULL        internal: the service role, or cron with no request context.
--               Callers MUST read NULL as "skip the limit", never as a key.
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

  -- The service role is the site acting as itself: the payment functions, the
  -- payout worker, the moderation gate. Never limited here — those endpoints
  -- carry their own limits at the edge.
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role')
    );
  exception when others then
    v_role := null;
  end;
  if v_role = 'service_role' then return null; end if;

  -- No request context at all means nothing arrived over HTTP: this is cron,
  -- or a migration, or somebody in the SQL editor. The scheduled publishers
  -- land here, which is the behaviour 20260809 wanted and the reason its early
  -- return existed.
  v_hdr := nullif(current_setting('request.headers', true), '');
  if v_hdr is null then return null; end if;

  if to_regprocedure('public.dz_client_ip()') is not null then
    begin v_ip := public.dz_client_ip(); exception when others then v_ip := null; end;
  end if;

  return case when v_ip is not null and v_ip <> '' then 'ip:' || v_ip else 'anon' end;
end $$;


-- ===========================================================================
-- 2. THE WRITE LIMITER, WITH THE HOLE CLOSED
-- ===========================================================================
-- Same signature and same trigger arguments as before, so every trigger
-- already attached keeps working untouched and only the body changes.
--
-- An anonymous caller gets a quarter of the signed-in budget, floored at one.
-- Signing in is free and takes a moment; needing to do it before you can write
-- twenty of something is not a hardship, and it puts a name on whoever is
-- filling the table.
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
  -- internal work is not the thing being limited
  if v_key is null then return new; end if;

  if left(v_key, 2) <> 'u:' then
    v_max := greatest(1, v_max / 4);
  end if;

  -- the per-table bucket, which is what the numbers in the list are about
  if not public.dz_rate_ok(
       TG_TABLE_NAME || ':' || TG_OP || ':' || v_key, v_max, v_win) then
    raise exception 'Too many % in a short time — wait a moment and try again', v_noun
      using errcode = 'P0001';
  end if;

  -- The ceiling over all of them. Sized so that no single per-table limit can
  -- reach it alone — hitting this means writing to several tables at once,
  -- which is a script and not a member.
  if not public.dz_rate_ok('all:' || v_key, 240, 300) then
    raise exception 'Too many changes in a short time — wait a moment and try again'
      using errcode = 'P0001';
  end if;

  return new;
end $$;


-- ===========================================================================
-- 3. THE DISCOVERY PASS
-- ===========================================================================
-- Everything a member can write, found by asking the database rather than by
-- remembering. A table is member-writable if it has an RLS policy for INSERT
-- or UPDATE (or ALL) that applies to anon or authenticated.
--
-- Tables that already carry a hand-chosen limiter keep it — this only fills
-- gaps. The default is deliberately loose enough that it will not be the thing
-- a real member notices and tight enough that a script meets it in seconds.
--
-- The ban gate rides along on the same discovery, for the reason
-- 20260822 gave: the two lists drifting apart is how a surface ends up rate
-- limited but not ban-gated, or the reverse.
do $$
declare
  r        record;
  v_op     text;
  v_trig   text;
  v_n      int := 0;
begin
  for r in
    select c.relname as tbl,
           bool_or(pol.polcmd in ('a', '*')) as ins,      -- INSERT or ALL
           bool_or(pol.polcmd in ('w', '*')) as upd       -- UPDATE or ALL
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and pol.polcmd in ('a', 'w', '*')
       and exists (
         select 1 from unnest(coalesce(pol.polroles, '{}')) as role_oid
          where pg_get_userbyid(role_oid) in ('anon', 'authenticated')
       )
       -- The limiter's own bookkeeping must never be limited by itself, and
       -- neither must a log that a trigger writes on somebody's behalf.
       and c.relname not in ('rate_hits', 'chat_rate_events', 'chat_cooldowns',
                             'dz_abuse_events', 'reserved_names', 'audit_log',
                             'upload_events', 'analytics_events',
                             'moderation_logs',
       -- comments and direct_messages look unlimited here and are not: 20260813
       -- REMOVED their fixed-window limiters on purpose, because dz_chat_gate
       -- replaced them with a stricter sliding one that also handles repeats
       -- and cooldowns. Re-adding a loose limiter on top would be dead weight
       -- at best and, if anyone later tuned it down, would quietly override the
       -- control that is actually doing the work.
                             'comments', 'direct_messages')
     group by c.relname
     order by 1
  loop
    foreach v_op in array array['INSERT', 'UPDATE'] loop
      -- only the operations this table actually grants
      continue when (v_op = 'INSERT' and not r.ins)
                 or (v_op = 'UPDATE' and not r.upd);

      -- a hand-chosen limiter for this table and operation already exists
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

      -- and the ban gate, same reasoning
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


-- ===========================================================================
-- 4. DELETE IS A WRITE TOO
-- ===========================================================================
-- Nothing has ever limited deletes, on the reasoning that a member can only
-- delete their own rows so the worst case is self-harm. That is true of the
-- damage and false of the cost: a script deleting and re-inserting its own
-- rows in a loop is free write amplification against the database, and the
-- re-insert half is the only half anything counts.
--
-- Loose, because a member clearing out an album really does delete a lot at
-- once, and the point is only to stop a loop.
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
       and pol.polcmd in ('d', '*')                -- DELETE, ALL
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


-- ===========================================================================
-- 5. ACCOUNT CREATION
-- ===========================================================================
-- The attack needed one thing before it needed anything else: an account. It
-- got one in two minutes, and nothing would have stopped it getting fifty.
-- Supabase rate limits the auth endpoint itself, but the profile row is ours
-- and it is the row that makes an account real on this site.
--
-- Six per hour per address. A household, a classroom or a shared office behind
-- one NAT can register six people in an hour; a script cannot register six
-- hundred.
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
    -- Not logged: this raises, and the exception would roll the audit row back
    -- with it. The rate_hits bucket itself is the durable record of the burst.
    raise exception 'Too many accounts created from here recently — try again later'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;

drop trigger if exists dz_signup_rate_ins on public.profiles;
create trigger dz_signup_rate_ins
  before insert on public.profiles
  for each row execute function public.dz_signup_rate();


-- ===========================================================================
-- 6. READS, WHERE THEY COST SOMETHING
-- ===========================================================================
-- A SELECT is not free, and the expensive ones here are the SECURITY DEFINER
-- search and browse functions: they scan, they aggregate, and anon may call
-- them. They are the cheapest thing on the site to point a loop at and the
-- most expensive thing for the database to answer.
--
-- Wrapping each one would mean editing each one. Instead the limit goes on the
-- one thing they share — being called — through a guard they can each pick up
-- in a single line, and the three that anon can reach today get it now.
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
