-- Communities and friendships get a ceiling, and a rate limit
--
-- Three of the four limits this adds already existed in one form or another,
-- but only one of them existed where it counts. cm_create has always refused a
-- second community per owner, so "one created community per artist" is real.
-- Everything else was open: a member could join every community on the site,
-- accept an unbounded number of friends, and do either as fast as a script can
-- issue requests. 20260809_write_rate_limits.sql went table by table through
-- everything a member can type and did not reach these three tables, because
-- friendships and memberships are not text — which is exactly why they were
-- missed, and does nothing to make them cheaper to write.
--
-- Where the caps live matters. The client checks them too (js/dm.js,
-- js/mywork.js) so that a member is told before the round trip instead of
-- after it, but a client check is a courtesy, not a limit — anybody can post
-- to PostgREST directly. These triggers are the limit.
--
--   50 communities per member. Counted over memberships that are not banned,
--   because a ban already removes the community from that member's list, and
--   holding a slot open for one they cannot enter would be the wrong answer.
--
--   200 friends per member. Checked on both sides of the row: the requester
--   and the addressee each have their own 200, and an accept that would put
--   either of them over is refused. Checked when the row lands on 'accepted',
--   which is the moment a friendship starts existing — a pending request costs
--   nobody a slot.
--
--   100 outgoing requests waiting. This is the one cap that is not in the
--   brief, and it is here because without it the friend cap is trivially
--   sidestepped as a spam vector: pending requests are unbounded, they show up
--   in somebody else's inbox, and they cost nothing to create. Cancelling or
--   being answered frees the slot.
--
-- The error strings are the codes the two js files already switch on, in the
-- same shape as the CM_* codes cm_create raises.

-- ---- 50 communities per member --------------------------------------------
create or replace function public.cm_member_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max int := 50;
  v_n   int;
begin
  -- cm_join inserts with ON CONFLICT DO NOTHING, and a BEFORE trigger fires
  -- ahead of the conflict being resolved. Re-joining a community you are
  -- already in adds nothing, so it must not be refused at the cap.
  if exists (select 1 from public.community_members
              where community_id = new.community_id and user_id = new.user_id) then
    return new;
  end if;

  select count(*) into v_n
    from public.community_members
   where user_id = new.user_id and not banned;

  if v_n >= v_max then
    raise exception 'CM_MAX_JOINED' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists cm_member_cap_ins on public.community_members;
create trigger cm_member_cap_ins
  before insert on public.community_members
  for each row execute function public.cm_member_cap();

-- ---- 200 friends, and 100 requests waiting ---------------------------------
create or replace function public.fr_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max_friends int := 200;
  v_max_pending int := 100;
  v_n           int;
begin
  -- an accepted friendship costs both sides a slot, so both are checked. On
  -- UPDATE this only fires on the transition into 'accepted' — re-saving a row
  -- that is already accepted must not count the row it is itself part of.
  if new.status = 'accepted'
     and (TG_OP = 'INSERT' or old.status is distinct from 'accepted') then

    select count(*) into v_n from public.friendships
     where status = 'accepted'
       and (requester_id = new.requester_id or addressee_id = new.requester_id);
    if v_n >= v_max_friends then
      raise exception 'FR_MAX_FRIENDS' using errcode = 'P0001';
    end if;

    select count(*) into v_n from public.friendships
     where status = 'accepted'
       and (requester_id = new.addressee_id or addressee_id = new.addressee_id);
    if v_n >= v_max_friends then
      raise exception 'FR_MAX_FRIENDS' using errcode = 'P0001';
    end if;
  end if;

  -- outgoing requests waiting on an answer, counted only as one is created
  if TG_OP = 'INSERT' and new.status = 'pending' then
    select count(*) into v_n from public.friendships
     where status = 'pending' and requester_id = new.requester_id;
    if v_n >= v_max_pending then
      raise exception 'FR_MAX_PENDING' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists fr_cap_ins on public.friendships;
create trigger fr_cap_ins
  before insert on public.friendships
  for each row execute function public.fr_cap();

drop trigger if exists fr_cap_upd on public.friendships;
create trigger fr_cap_upd
  before update on public.friendships
  for each row execute function public.fr_cap();

-- ---- rate limits -----------------------------------------------------------
-- Same machinery as 20260809_write_rate_limits.sql: dz_write_rate calls
-- dz_rate_ok, one bucket per member per table per operation.
--
-- DELETE is deliberately not limited on any of these. dz_write_rate is a
-- BEFORE trigger that returns NEW, and NEW is null on a delete — attaching it
-- to DELETE would cancel every delete on the table. Cancelling a request,
-- unblocking somebody and leaving a community are all deletes, and all three
-- are things a member should be able to do without a budget anyway.
--
-- communities INSERT is set at 5 rather than 1 even though an artist can only
-- own one: the failed attempts are what a script would generate, and this is
-- the bucket that stops them.
do $$
declare r record;
begin
  for r in
    select * from (values
      -- table,              op,       noun,                 max,  window secs
      ('friendships',        'INSERT', 'friend requests',      30,  3600),
      ('friendships',        'UPDATE', 'friend actions',       60,  3600),
      ('communities',        'INSERT', 'communities',           5,  3600),
      ('communities',        'UPDATE', 'community edits',      60,  3600),
      ('community_members',  'INSERT', 'community joins',      20,  3600),
      ('community_members',  'UPDATE', 'member changes',      120,  3600)
    ) as t(tbl, op, noun, max_n, win)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;

    execute format('drop trigger if exists dz_rate_%s_%s on public.%I',
                   lower(r.op), r.tbl, r.tbl);
    execute format(
      'create trigger dz_rate_%s_%s before %s on public.%I '||
      'for each row execute function public.dz_write_rate(%L, %L, %L)',
      lower(r.op), r.tbl, r.op, r.tbl, r.noun, r.max_n::text, r.win::text);
  end loop;
end $$;

-- ---- trigger order ---------------------------------------------------------
-- Postgres fires BEFORE row triggers in name order, which puts cm_member_cap_ins
-- ahead of dz_rate_insert_community_members and dz_rate_insert_friendships ahead
-- of fr_cap_ins. That asymmetry does not matter: a member sitting at the friend
-- cap is not, by that fact, also over 30 requests an hour, so the rate trigger
-- passes and the cap is what they are told about. The two only collide for
-- somebody who is both capped and hammering, and either message is true.
