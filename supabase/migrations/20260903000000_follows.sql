-- Follows: the artist -> audience edge the site was missing.
--
-- The relationship was already here under another name. public.profile_creds was
-- a directed, unique (giver, receiver) edge with a counter cached on the profile
-- — a follower graph wearing the word "cred". So this renames it rather than
-- building a second graph beside it: every existing cred becomes a follow, the
-- counter becomes follower_count, and a following_count joins it. Renames keep
-- the rows, the indexes, the foreign keys and the policies; only the function
-- bodies that spelled the old names out have to be re-emitted, which is most of
-- the length below.
--
-- On top of the rename: a notification when someone follows you, and the
-- follower/following facts and lists the analytics page reads.

set check_function_bodies = off;

-- ---------------------------------------------------------------- the edge ---

do $$
begin
  if to_regclass('public.profile_creds') is not null
     and to_regclass('public.follows') is null then
    alter table public.profile_creds rename to follows;
    alter table public.follows rename column giver_id    to follower_id;
    alter table public.follows rename column receiver_id to following_id;
  end if;
end $$;

create table if not exists public.follows (
  id           uuid primary key default extensions.gen_random_uuid(),
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table public.follows enable row level security;

-- constraints keep their old names through a rename; give them the new one so
-- the next reader is not sent looking for a cred table
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profile_creds_pkey' and conrelid = 'public.follows'::regclass) then
    alter table public.follows rename constraint profile_creds_pkey to follows_pkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'profile_creds_giver_id_receiver_id_key' and conrelid = 'public.follows'::regclass) then
    alter table public.follows rename constraint profile_creds_giver_id_receiver_id_key
      to follows_pair_key;
  end if;
  if exists (select 1 from pg_constraint where conname = 'profile_creds_check' and conrelid = 'public.follows'::regclass) then
    alter table public.follows rename constraint profile_creds_check to follows_not_self;
  end if;
  if exists (select 1 from pg_constraint where conname = 'profile_creds_giver_id_fkey' and conrelid = 'public.follows'::regclass) then
    alter table public.follows rename constraint profile_creds_giver_id_fkey
      to follows_follower_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'profile_creds_receiver_id_fkey' and conrelid = 'public.follows'::regclass) then
    alter table public.follows rename constraint profile_creds_receiver_id_fkey
      to follows_following_id_fkey;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'follows_not_self' and conrelid = 'public.follows'::regclass) then
    alter table public.follows add constraint follows_not_self
      CHECK (follower_id <> following_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'follows_pair_key' and conrelid = 'public.follows'::regclass) then
    alter table public.follows add constraint follows_pair_key
      UNIQUE (follower_id, following_id);
  end if;
end $$;

-- a feed reads "the newest work from the people I follow", a profile reads
-- "who follows this artist"; one index each
create index if not exists follows_follower_idx  on public.follows (follower_id, created_at desc);
create index if not exists follows_following_idx on public.follows (following_id, created_at desc);

-- --------------------------------------------------------------- counters ---

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'cred_received_count')
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'profiles'
                        and column_name = 'follower_count') then
    alter table public.profiles rename column cred_received_count to follower_count;
  end if;
end $$;

alter table public.profiles add column if not exists follower_count  integer not null default 0;
alter table public.profiles add column if not exists following_count integer not null default 0;

CREATE OR REPLACE FUNCTION public.sync_follow_counts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  perform set_config('app.allow_follow_count_write', '1', true);
  if TG_OP = 'INSERT' then
    update public.profiles set follower_count = coalesce(follower_count, 0) + 1
     where id = NEW.following_id;
    update public.profiles set following_count = coalesce(following_count, 0) + 1
     where id = NEW.follower_id;
    perform set_config('app.allow_follow_count_write', '0', true);
    return NEW;
  else
    update public.profiles set follower_count = greatest(coalesce(follower_count, 0) - 1, 0)
     where id = OLD.following_id;
    update public.profiles set following_count = greatest(coalesce(following_count, 0) - 1, 0)
     where id = OLD.follower_id;
    perform set_config('app.allow_follow_count_write', '0', true);
    return OLD;
  end if;
end $function$;

drop trigger if exists trg_profile_creds_count on public.follows;
drop trigger if exists trg_follows_count       on public.follows;
create trigger trg_follows_count after insert or delete on public.follows
  for each row execute function public.sync_follow_counts();

drop function if exists public.sync_profile_cred_count();

-- the counters stay the trigger's to write, exactly as the cred one was
CREATE OR REPLACE FUNCTION public.guard_profile_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  cooldown CONSTANT interval := interval '90 days';
BEGIN
  IF coalesce(current_setting('app.allow_follow_count_write', true), '') <> '1'
     AND NOT public.dz_is_privileged() THEN
    NEW.follower_count  := OLD.follower_count;
    NEW.following_count := OLD.following_count;
  END IF;
  IF coalesce(current_setting('app.allow_merit_write', true), '') <> '1'
     AND NOT public.dz_is_privileged() THEN
    NEW.merit            := OLD.merit;
    NEW.merit_updated_at := OLD.merit_updated_at;
  END IF;
  IF NOT public.dz_is_privileged() THEN
    NEW.role                := OLD.role;
    NEW.subscription_tier   := OLD.subscription_tier;
    NEW.username_changed_at := OLD.username_changed_at;
    IF NEW.username IS DISTINCT FROM OLD.username THEN
      IF OLD.username_changed_at IS NOT NULL
         AND (now() - OLD.username_changed_at) < cooldown THEN
        RAISE EXCEPTION 'USERNAME_COOLDOWN until %',
          (OLD.username_changed_at + cooldown) USING errcode = 'P0001';
      END IF;
      NEW.username_changed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.dz_profiles_guard_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is not null or new.max_claimed or new.partner_since is not null then
      raise exception 'role, max_claimed and partner_since are not yours to set';
    end if;
    if new.subscription_tier is distinct from 'guest'
       or new.subscription_expires_at is not null then
      raise exception 'subscription_tier and subscription_expires_at are not yours to set';
    end if;
    if new.merit is distinct from 100
       or new.follower_count is distinct from 0
       or new.following_count is distinct from 0 then
      raise exception 'merit and the follow counters are not yours to set';
    end if;
  end if;
  return new;
end $function$;

-- Both counters are caches of the same table. Recount once, so a partly applied
-- history cannot leave a profile claiming an audience it does not have. The
-- guard above hands the counters to the trigger, so this write says who it is.
select set_config('app.allow_follow_count_write', '1', false);

with n as (
  select p.id,
         (select count(*) from public.follows f where f.following_id = p.id) as followers,
         (select count(*) from public.follows f where f.follower_id  = p.id) as following
    from public.profiles p
)
update public.profiles p
   set follower_count  = n.followers,
       following_count = n.following
  from n
 where n.id = p.id
   and (p.follower_count is distinct from n.followers::integer
     or p.following_count is distinct from n.following::integer);

select set_config('app.allow_follow_count_write', '0', false);

-- ------------------------------------------------------------------- rls ---

drop policy if exists creds_delete_own       on public.follows;
drop policy if exists creds_insert_own       on public.follows;
drop policy if exists creds_select_own_given on public.follows;
drop policy if exists follows_delete_own     on public.follows;
drop policy if exists follows_insert_own     on public.follows;
drop policy if exists follows_select_mine    on public.follows;

create policy follows_insert_own on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and follower_id <> following_id);
create policy follows_delete_own on public.follows for delete to authenticated
  using (follower_id = auth.uid());
-- both ends of an edge you are on: "am I following them", "who follows me",
-- "who do I follow". Someone else's follower list stays a count on the profile.
create policy follows_select_mine on public.follows for select to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());

grant select, insert, delete on public.follows to authenticated;
grant all on public.follows to service_role;
grant select (follower_count, following_count) on public.profiles to anon, authenticated;

-- the abuse gates the cred table carried, under the new name
drop trigger if exists dz_ban_insert_profile_creds    on public.follows;
drop trigger if exists dz_rate_insert_profile_creds   on public.follows;
drop trigger if exists dz_rate_delete_profile_creds   on public.follows;
drop trigger if exists dz_ban_insert_follows          on public.follows;
drop trigger if exists dz_rate_insert_follows         on public.follows;
drop trigger if exists dz_rate_delete_follows         on public.follows;
create trigger dz_ban_insert_follows before insert on public.follows
  for each row execute function public.dz_ban_gate();
create trigger dz_rate_insert_follows before insert on public.follows
  for each row execute function public.dz_write_rate('follows', '120', '3600');
create trigger dz_rate_delete_follows before delete on public.follows
  for each row execute function public.dz_write_rate('deletions', '200', '300');

-- --------------------------------------------------------- notifications ---

-- 'follow' joins the types the bell accepts
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check CHECK (type = ANY (ARRAY[
  'like', 'comment', 'comment_reply', 'follow', 'friend_request', 'friend_accepted', 'mention',
  'community_join', 'community_post', 'community_comment', 'message',
  'artwork_featured', 'artwork_approved', 'artwork_rejected',
  'marketplace_sale', 'marketplace_purchase', 'payment', 'subscription',
  'system', 'admin',
  'comic_approved', 'comic_rejected', 'post_published', 'post_rejected'
]::text[]));

CREATE OR REPLACE FUNCTION public.dz_notify_follow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
declare v_who text; v_handle text;
begin
  if new.following_id = new.follower_id then return new; end if;
  v_who    := public.dz_notif_who(new.follower_id);
  v_handle := (select username from public.profiles where id = new.follower_id);
  perform public.dz_notify(new.following_id, 'follow', 'New follower',
    v_who || ' started following you.',
    p_actor     => new.follower_id,
    p_group_key => 'follow:' || new.following_id::text,
    p_url       => case when v_handle is null then '/' else '/profile/' || v_handle end,
    p_regroup   => v_who || ' and {n} other{s} started following you.');
  return new;
exception when others then return new;
end;
$function$;

drop trigger if exists dz_notify_follow on public.follows;
create trigger dz_notify_follow after insert on public.follows
  for each row execute function public.dz_notify_follow();

revoke all on function public.dz_notify_follow()    from public, anon, authenticated;
revoke all on function public.sync_follow_counts()  from public, anon, authenticated;
grant execute on function public.dz_notify_follow(), public.sync_follow_counts(),
  public.guard_profile_update(), public.dz_profiles_guard_insert() to service_role;

-- ------------------------------------------------------------- the feed ---

-- The gallery already holds every approved artwork client side, so the feed
-- itself is a filter there. This is for the case the client cannot answer on
-- its own: the ids, newest edge first, capped.
CREATE OR REPLACE FUNCTION public.dz_following_ids(p_limit integer DEFAULT 500)
RETURNS setof uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public', 'pg_temp' AS $function$
  select f.following_id from public.follows f
   where f.follower_id = auth.uid()
   order by f.created_at desc
   limit greatest(1, least(coalesce(p_limit, 500), 2000))
$function$;

revoke all on function public.dz_following_ids(integer) from public, anon;
grant execute on function public.dz_following_ids(integer) to authenticated, service_role;

-- Counts for any profile, without opening one artist's follower list to the
-- next. The numbers are public; the names behind them are not.
CREATE OR REPLACE FUNCTION public.dz_follow_counts(p_user uuid)
RETURNS TABLE(followers bigint, following bigint, i_follow boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  select coalesce(p.follower_count, 0)::bigint,
         coalesce(p.following_count, 0)::bigint,
         exists (select 1 from public.follows f
                  where f.follower_id = auth.uid() and f.following_id = p_user)
    from public.profiles p where p.id = p_user
$function$;

revoke all on function public.dz_follow_counts(uuid) from public;
grant execute on function public.dz_follow_counts(uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------- rankings ---

-- the cred column of the score set becomes followers, which is a change of
-- return type: the two readers go first, then the set itself
drop function if exists public.get_rank_board(text, integer, integer);
drop function if exists public.get_rank_me(text);
drop function if exists public.rank_scores();

CREATE FUNCTION public.rank_scores()
RETURNS TABLE(id uuid, username text, avatar_url text, lvl integer, xp bigint,
              followers bigint, likes bigint, bookmarks bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  with agg as (
    select
      p.id, p.username, p.avatar_url,
      coalesce(p.follower_count,0)::bigint as followers,
      coalesce(a.up,0)::bigint  as up,
      coalesce(a.lk,0)::bigint  as likes,
      coalesce(a.bm,0)::bigint  as bookmarks,
      coalesce(lg.c,0)::bigint  as likes_given,
      coalesce(bg.c,0)::bigint  as bm_given,
      coalesce(cm.c,0)::bigint  as comments
    from profiles p
    left join (
      select user_id,
             count(*)                        as up,
             coalesce(sum(like_count),0)     as lk,
             coalesce(sum(bookmark_count),0) as bm
      from artworks
      where status = 'approved' and user_id is not null
      group by 1
    ) a on a.user_id = p.id
    left join (select user_id, count(*) c from artwork_likes     group by 1) lg on lg.user_id = p.id
    left join (select user_id, count(*) c from artwork_bookmarks group by 1) bg on bg.user_id = p.id
    left join (select user_id, count(*) c from comments where user_id is not null group by 1) cm on cm.user_id = p.id
    where p.username is not null
  )
  select
    id, username, avatar_url,
    public.xp_to_level((up*10 + likes_given*2 + bm_given*2 + comments)::int) as lvl,
    (up*10 + likes_given*2 + bm_given*2 + comments)::bigint                  as xp,
    followers, likes, bookmarks
  from agg
$function$;

CREATE FUNCTION public.get_rank_board(board text, lim integer DEFAULT 20, off integer DEFAULT 0)
RETURNS TABLE(rnk bigint, uid uuid, username text, avatar_url text, score bigint, lvl integer, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  with pick as (
    select s.id, s.username, s.avatar_url, s.lvl,
      case lower(coalesce(board,'level'))
        when 'followers' then s.followers
        when 'likes'     then s.likes
        when 'bookmarks' then s.bookmarks
        else s.xp
      end as score
    from public.rank_scores() s
  ),
  ranked as (
    select rank() over (order by score desc) as rnk,
           count(*) over ()                  as total,
           id, username, avatar_url, lvl, score
    from pick
    where score > 0
  )
  select rnk, id, username, avatar_url, score, lvl, total
  from ranked
  order by rnk asc, username asc
  limit  greatest(1, least(coalesce(lim,20), 50))
  offset greatest(0, coalesce(off,0))
$function$;

CREATE FUNCTION public.get_rank_me(board text)
RETURNS TABLE(rnk bigint, score bigint, lvl integer, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  with pick as (
    select s.id, s.lvl,
      case lower(coalesce(board,'level'))
        when 'followers' then s.followers
        when 'likes'     then s.likes
        when 'bookmarks' then s.bookmarks
        else s.xp
      end as score
    from public.rank_scores() s
  ),
  ranked as (
    select rank() over (order by score desc) as rnk,
           count(*) over ()                  as total,
           id, lvl, score
    from pick
    where score > 0
  )
  select r.rnk, r.score, r.lvl, r.total
  from ranked r
  where r.id = auth.uid()
$function$;

grant execute on function public.rank_scores() to service_role;
grant execute on function public.get_rank_board(board text, lim integer, off integer),
                          public.get_rank_me(board text)
  to PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------ analytics ---

-- Same function as before, with the account block now reporting followers and
-- following -- including the two lists the Account section shows.

CREATE OR REPLACE FUNCTION public.dz_analytics_activity(p_days integer DEFAULT 30, p_scope text DEFAULT 'artwork'::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
declare
  v_me   uuid := auth.uid();
  v_days int  := public.dz_an_days(p_days);
  v_sc   text := public.dz_an_scope(p_scope);
  v_to   date := current_date;
  v_from date := current_date - (v_days - 1);
  v_out  jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  update public.analytics_goals g
     set achieved_at = now()
   where g.user_id = v_me
     and g.scope = v_sc
     and g.achieved_at is null
     and public.dz_an_goal_progress(v_me, g.metric, g.period, g.scope) >= g.target;

  with mine as (select i.id, i.title from public.an_item i
                 where i.user_id = v_me and i.kind = v_sc),
  eng as (
    select
      (select count(*) from public.an_view d join mine m on m.id = d.subject_id
        where d.kind = v_sc and d.day between v_from and v_to)::bigint as views,
      (select count(*) from public.an_like l join mine m on m.id = l.subject_id
        where l.kind = v_sc and l.created_at::date between v_from and v_to)::bigint as likes,
      (select count(*) from public.an_bookmark b join mine m on m.id = b.subject_id
        where b.kind = v_sc and b.created_at::date between v_from and v_to)::bigint as bookmarks,
      (select count(*) from public.item_comments c join mine m on m.id = c.subject_id
        where c.kind = v_sc and c.user_id <> v_me
          and c.created_at::date between v_from and v_to)::bigint as comments,
      (select count(*) from public.an_download d join mine m on m.id = d.subject_id
        where d.kind = v_sc and d.day between v_from and v_to)::bigint as downloads,
      (select count(*) from public.analytics_events e
        where e.owner_id = v_me and e.event = 'share' and e.scope = v_sc
          and e.day between v_from and v_to)::bigint as shares
  ),
  fseries as (
    select jsonb_agg(jsonb_build_object('d', cal.day, 'gained', coalesce(g.n, 0)) order by cal.day) as list
      from (select gs::date as day from generate_series(v_from, v_to, interval '1 day') gs) cal
      left join (
        select f.created_at::date as day, count(*)::bigint as n
          from public.follows f
         where f.following_id = v_me and f.created_at::date between v_from and v_to
         group by 1
      ) g on g.day = cal.day
  ),
  recent_followers as (
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(nullif(p.display_name, ''), p.username, 'Artist'),
             'handle', p.username, 'avatar', p.avatar_url, 'at', f.at) order by f.at desc) as list
      from (
        select f.follower_id as other, f.created_at as at
          from public.follows f where f.following_id = v_me
         order by f.created_at desc limit 100
      ) f join public.profiles p on p.id = f.other
  ),
  recent_following as (
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(nullif(p.display_name, ''), p.username, 'Artist'),
             'handle', p.username, 'avatar', p.avatar_url, 'at', f.at) order by f.at desc) as list
      from (
        select f.following_id as other, f.created_at as at
          from public.follows f where f.follower_id = v_me
         order by f.created_at desc limit 100
      ) f join public.profiles p on p.id = f.other
  ),
  goals as (
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'metric', g.metric, 'target', g.target, 'period', g.period,
             'progress', public.dz_an_goal_progress(v_me, g.metric, g.period, g.scope),
             'achieved_at', g.achieved_at, 'created_at', g.created_at)
             order by g.created_at) as list
      from public.analytics_goals g where g.user_id = v_me and g.scope = v_sc
  ),
  feed as (
    select jsonb_agg(jsonb_build_object('event', event, 'at', at, 'title', title, 'artwork', aid)
                     order by at desc) as list
      from (
        select 'like'::text as event, l.created_at as at, m.title, m.id as aid
          from public.an_like l join mine m on m.id = l.subject_id where l.kind = v_sc
        union all
        select 'bookmark', b.created_at, m.title, m.id
          from public.an_bookmark b join mine m on m.id = b.subject_id where b.kind = v_sc
        union all
        select 'comment', c.created_at, m.title, m.id
          from public.item_comments c join mine m on m.id = c.subject_id
         where c.kind = v_sc and c.user_id <> v_me
        order by at desc limit 100
      ) s
  ),
  money as (
    select
      coalesce(sum(e.net_amount), 0)::bigint   as net,
      coalesce(sum(e.gross_amount), 0)::bigint as gross,
      coalesce(sum(e.fee_amount), 0)::bigint   as fees,
      count(*)::bigint                         as sales,
      coalesce(max(e.currency), (select currency from public.profiles where id = v_me), 'USD') as currency
      from public.marketplace_earnings e
     where e.seller_id = v_me
       and coalesce(e.status, '') not in ('refunded','reversed','cancelled')
       and e.created_at::date between v_from and v_to
  ),
  money_all as (
    select
      coalesce(sum(e.net_amount), 0)::bigint as net,
      coalesce(sum(e.net_amount) filter (where e.available_at is not null
                                           and e.available_at <= now()), 0)::bigint as available,
      coalesce(sum(e.net_amount) filter (where e.available_at is null
                                           or e.available_at > now()), 0)::bigint as pending
      from public.marketplace_earnings e
     where e.seller_id = v_me
       and coalesce(e.status, '') not in ('refunded','reversed','cancelled')
  ),
  mseries as (
    select jsonb_agg(jsonb_build_object('d', cal.day, 'net', coalesce(s.n, 0), 'sales', coalesce(s.c, 0))
                     order by cal.day) as list
      from (select gs::date as day from generate_series(v_from, v_to, interval '1 day') gs) cal
      left join (
        select e.created_at::date as day, coalesce(sum(e.net_amount), 0)::bigint as n,
               count(*)::bigint as c
          from public.marketplace_earnings e
         where e.seller_id = v_me
           and coalesce(e.status, '') not in ('refunded','reversed','cancelled')
           and e.created_at::date between v_from and v_to
         group by 1
      ) s on s.day = cal.day
  )
  select jsonb_build_object(
    'scope', v_sc,
    'range', jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to),
    'engagement', (select jsonb_build_object(
        'views', views, 'likes', likes, 'bookmarks', bookmarks, 'comments', comments,
        'downloads', downloads, 'shares', shares,
        'rate', case when views > 0
                     then round(((likes + bookmarks + comments + shares)::numeric / views) * 100, 1)
                     else 0 end,
        'like_rate',    case when views > 0 then round((likes::numeric / views) * 100, 1) else 0 end,
        'save_rate',    case when views > 0 then round((bookmarks::numeric / views) * 100, 1) else 0 end,
        'comment_rate', case when views > 0 then round((comments::numeric / views) * 100, 1) else 0 end
      ) from eng),
    'activity', coalesce((select list from feed), '[]'::jsonb),
    'account', jsonb_build_object(
      'followers_total',  (select count(*) from public.follows f where f.following_id = v_me),
      'followers_gained', (select count(*) from public.follows f
                            where f.following_id = v_me and f.created_at::date between v_from and v_to),
      'followers_lost',   (select count(*) from public.analytics_events e
                            where e.owner_id = v_me and e.event = 'unfollow'
                              and e.day between v_from and v_to),
      'following_total',  (select count(*) from public.follows f where f.follower_id = v_me),
      'following_gained', (select count(*) from public.follows f
                            where f.follower_id = v_me and f.created_at::date between v_from and v_to),
      'followers_series', coalesce((select list from fseries), '[]'::jsonb),
      'followers_list',   coalesce((select list from recent_followers), '[]'::jsonb),
      'following_list',   coalesce((select list from recent_following), '[]'::jsonb),
      'profile_views', (select count(*) from public.analytics_events e
                         where e.owner_id = v_me and e.event = 'profile_view'
                           and e.day between v_from and v_to),
      'communities_owned',  (select count(*) from public.communities c where c.owner_id = v_me),
      'communities_joined', (select count(*) from public.community_members cm
                              where cm.user_id = v_me and coalesce(cm.banned, false) = false),
      'messages', (select count(*) from public.comments c
                    where c.user_id = v_me and c.created_at::date between v_from and v_to),
      'dms', (select count(*) from public.direct_messages d
               where d.sender_id = v_me and d.created_at::date between v_from and v_to),
      'comments_made', (select count(*) from public.item_comments c
                         where c.user_id = v_me and c.created_at::date between v_from and v_to),
      'friends', (select count(*) from public.friendships f
                   where f.status = 'accepted' and (f.requester_id = v_me or f.addressee_id = v_me)),
      'merit', (select coalesce(merit, 100) from public.profiles where id = v_me)
    ),
    'revenue', case when v_sc = 'marketplace' then (
        select jsonb_build_object(
          'currency', m.currency, 'net', m.net, 'gross', m.gross, 'fees', m.fees,
          'sales', m.sales, 'net_all', ma.net,
          'available', ma.available, 'pending', ma.pending,
          'series', coalesce((select list from mseries), '[]'::jsonb))
          from money m, money_all ma
      ) else null end,
    'goals',        coalesce((select list from goals), '[]'::jsonb),
    'achievements', public.dz_an_achievements(v_me, v_sc)
  ) into v_out;

  return coalesce(v_out, '{}'::jsonb);
end $function$;


grant execute on function public.dz_analytics_activity(p_days integer, p_scope text)
  to authenticated, service_role;
