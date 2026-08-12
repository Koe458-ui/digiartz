-- Analytics for all four sections, and every number belongs to its own
--
-- The artwork dashboard shipped first. Marketplace, blog and resources get the
-- same twelve sections here, under one rule that decides most of this file:
--
--   A NUMBER APPEARS IN THE SECTION IT CAME FROM AND NOWHERE ELSE.
--
-- A like on an artwork is one like under Artworks and zero under the other
-- three. A blog post's five likes are five under Blog and zero elsewhere. The
-- artwork dashboard is not a summary of the account and never was; it is the
-- artworks, and now each of the other three is itself in the same way.
--
-- THE ONE THING THAT CANNOT BE SPLIT is cred. profile_creds has a giver, a
-- receiver and a time, and no subject — cred is given to a person on their
-- profile, not to a piece of work — so there is no blog cred to separate from
-- artwork cred. Rather than print the same account total in four places and
-- let it read as four different section figures, cred stops being reported as
-- a section metric at all: no cred tile in the KPI row, no cred goal, and the
-- count moved into an `account` block that says out loud what it covers.
-- Communities, DMs, merit and friends are in there with it for the same
-- reason. Per-section cred would need cred to be giveable on an item, which
-- is a feature, not a query.
--
-- WHAT THE OTHER THREE SECTIONS DID NOT HAVE. Artworks came with history:
-- artwork_view_dedup, artwork_likes, artwork_bookmarks. The other three had
-- item_likes, item_bookmarks and item_comments keyed by (kind, subject) — and
-- no views at all. marketplace_items.view_count, blog_posts.view_count and
-- resources.view_count existed and were never once incremented; nothing wrote
-- them. item_view_dedup and register_item_view are that missing half.
--
-- WHY THE ITEM TABLES ARE NOT TOUCHED ON A VIEW. The obvious move is to bump
-- view_count the way register_artwork_view does. Not here: all three tables
-- carry dz_touch_updated_at and dz_write_rate('edits', …) on UPDATE, so every
-- view would restamp updated_at — reordering the listings a viewer is looking
-- at — and spend the viewer's own edit budget. item_view_dedup is the record,
-- and the readers count it directly.

-- ---------------------------------------------------------------------------
-- views for the three sections that never had them
-- ---------------------------------------------------------------------------
create table if not exists public.item_view_dedup (
  kind       text not null,
  subject_id uuid not null,
  viewer_key text not null,
  day        date not null default current_date,
  primary key (kind, subject_id, viewer_key, day),
  constraint item_view_kind check (kind in ('marketplace','blog','resource'))
);

create index if not exists item_view_dedup_day_idx on public.item_view_dedup (kind, day);
create index if not exists item_view_dedup_subject_idx on public.item_view_dedup (subject_id, day);

alter table public.item_view_dedup enable row level security;
revoke all on public.item_view_dedup from anon, authenticated;

-- The same shape and the same viewer key as register_artwork_view, so a
-- viewer is the same viewer across all four sections.
create or replace function public.register_item_view(
  p_kind     text,
  p_subject  uuid,
  p_anon_key text default null,
  p_source   text default null,
  p_ref      text default null,
  p_device   text default null,
  p_country  text default null
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_key    text;
  v_ip     text;
  v_owner  uuid;
  v_status text;
  v_vis    text;
begin
  if p_kind not in ('marketplace','blog','resource') or p_subject is null then
    return;
  end if;

  if p_kind = 'marketplace' then
    select user_id, status, visibility into v_owner, v_status, v_vis
      from public.marketplace_items where id = p_subject;
  elsif p_kind = 'blog' then
    select user_id, status, visibility into v_owner, v_status, v_vis
      from public.blog_posts where id = p_subject;
  else
    select user_id, status, visibility into v_owner, v_status, v_vis
      from public.resources where id = p_subject;
  end if;

  if v_owner is null then return; end if;
  -- a draft or an unlisted row cannot have been opened from outside, so a
  -- view claimed against one is not a view
  if v_status is distinct from 'approved' or v_vis is distinct from 'published' then
    return;
  end if;

  if auth.uid() is not null then
    if not public.dz_rate_ok('ivw:u:' || auth.uid()::text, 120, 60) then return; end if;
    v_key := 'u:' || auth.uid()::text;
  else
    v_ip := public.dz_client_ip();
    if v_ip is not null then
      if not public.dz_rate_ok('ivw:ip:' || v_ip, 120, 60) then return; end if;
      v_key := 'a:' || md5('dzview|' || v_ip);
    else
      if p_anon_key is null
         or length(p_anon_key) not between 16 and 64
         or p_anon_key !~ '^[A-Za-z0-9-]+$' then
        return;
      end if;
      if not public.dz_rate_ok('ivw:nokey', 600, 60) then return; end if;
      v_key := 'a:' || p_anon_key;
    end if;
  end if;

  insert into public.item_view_dedup (kind, subject_id, viewer_key, day)
  values (p_kind, p_subject, v_key, current_date)
  on conflict do nothing;

  if found and (auth.uid() is null or auth.uid() <> v_owner) then
    insert into public.analytics_events
      (owner_id, actor_id, viewer_key, scope, subject_id, event,
       source, referrer_host, country, device)
    values
      (v_owner, auth.uid(), v_key, p_kind, p_subject, 'view',
       case when lower(coalesce(p_source, 'direct')) in
                 ('direct','social','search','referral','internal')
            then lower(p_source) else 'direct' end,
       nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.:-]', '', 'g'), 120), ''),
       public.dz_an_country(p_country),
       case when lower(coalesce(p_device, 'unknown')) in ('mobile','tablet','desktop')
            then lower(p_device) else 'unknown' end)
    on conflict do nothing;
  end if;
end $$;

revoke all on function public.register_item_view(text,uuid,text,text,text,text,text) from public;
grant execute on function public.register_item_view(text,uuid,text,text,text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- one shape for four sections
-- ---------------------------------------------------------------------------
-- Every reader works off these, so a second section costs a scope filter
-- rather than a second copy of every query. They bypass RLS — a view runs as
-- its owner unless it says otherwise — and are therefore granted to nobody:
-- the only things that read them are the SECURITY DEFINER readers, and those
-- scope to auth.uid() on the first line.

create or replace view public.an_item as
  select 'artwork'::text as kind, a.id, a.user_id,
         coalesce(nullif(btrim(a.name), ''), 'Untitled') as title,
         a.image_url as thumb, a.category, a.tags,
         case when coalesce(array_length(a.software_list, 1), 0) > 0 then a.software_list
              when a.software is not null and btrim(a.software) <> '' then array[a.software]
              else '{}'::text[] end as software,
         a.created_at::timestamptz as created_at,
         a.status, a.visibility, a.featured, a.license, a.is_mature,
         coalesce(a.view_count, 0)::bigint     as view_count,
         coalesce(a.like_count, 0)::bigint     as like_count,
         coalesce(a.bookmark_count, 0)::bigint as bookmark_count,
         coalesce(a.download_count, 0)::bigint as download_count,
         0::bigint as sales_count, 0::bigint as price_cents
    from public.artworks a
  union all
  select 'marketplace', m.id, m.user_id,
         coalesce(nullif(btrim(m.title), ''), 'Untitled'),
         m.preview_url, m.category, m.tags,
         case when m.software is not null and btrim(m.software) <> ''
              then array[m.software] else '{}'::text[] end,
         m.created_at, m.status, m.visibility, m.featured, m.license, false,
         coalesce(m.view_count, 0)::bigint, coalesce(m.like_count, 0)::bigint,
         0::bigint, 0::bigint,
         coalesce(m.sales_count, 0)::bigint, coalesce(m.price_cents, 0)::bigint
    from public.marketplace_items m
  union all
  select 'blog', b.id, b.user_id,
         coalesce(nullif(btrim(b.title), ''), 'Untitled'),
         b.cover_url, b.category, b.tags, '{}'::text[],
         b.created_at, b.status, b.visibility, b.featured, null, false,
         coalesce(b.view_count, 0)::bigint, coalesce(b.like_count, 0)::bigint,
         coalesce(b.bookmark_count, 0)::bigint, 0::bigint,
         0::bigint, 0::bigint
    from public.blog_posts b
  union all
  select 'resource', r.id, r.user_id,
         coalesce(nullif(btrim(r.title), ''), 'Untitled'),
         r.preview_url, r.category, r.tags,
         case when coalesce(array_length(r.compatible_software, 1), 0) > 0 then r.compatible_software
              when r.software is not null and btrim(r.software) <> '' then array[r.software]
              else '{}'::text[] end,
         r.created_at, r.status, r.visibility, r.featured, r.license, false,
         coalesce(r.view_count, 0)::bigint, coalesce(r.like_count, 0)::bigint,
         0::bigint, coalesce(r.download_count, 0)::bigint,
         0::bigint, 0::bigint
    from public.resources r;

create or replace view public.an_view as
  select 'artwork'::text as kind, d.artwork_id as subject_id, d.viewer_key, d.day
    from public.artwork_view_dedup d
  union all
  select v.kind, v.subject_id, v.viewer_key, v.day from public.item_view_dedup v;

create or replace view public.an_like as
  select 'artwork'::text as kind, l.artwork_id as subject_id, l.user_id, l.created_at
    from public.artwork_likes l
  union all
  select k.kind, k.subject_id, k.user_id, k.created_at from public.item_likes k;

create or replace view public.an_bookmark as
  select 'artwork'::text as kind, b.artwork_id as subject_id, b.user_id, b.created_at
    from public.artwork_bookmarks b
  union all
  select k.kind, k.subject_id, k.user_id, k.created_at from public.item_bookmarks k;

-- Downloads come from two records that do not agree on shape: the artwork side
-- is already one row per viewer per day, download_events is one row per
-- download. The group by collapses the second to the first's grain, so the two
-- halves of one number are not counted by two different rules.
create or replace view public.an_download as
  select 'artwork'::text as kind, d.artwork_id as subject_id, d.viewer_key, d.day
    from public.artwork_download_dedup d
  union all
  select case when e.kind = 'resources' then 'resource' else e.kind end,
         e.subject_id, e.viewer_key, e.created_at::date
    from public.download_events e
   where e.kind <> 'artwork' and e.subject_id is not null
   group by 1, 2, 3, 4;

revoke all on public.an_item, public.an_view, public.an_like,
              public.an_bookmark, public.an_download from public, anon, authenticated;

-- 'resources' is what the section is called in the interface; 'resource' is
-- what every table has always stored. One spelling from here down.
create or replace function public.dz_an_scope(p_scope text)
returns text language sql immutable as $$
  select case lower(coalesce(p_scope, 'artwork'))
           when 'marketplace' then 'marketplace'
           when 'blog'        then 'blog'
           when 'resource'    then 'resource'
           when 'resources'   then 'resource'
           else 'artwork'
         end;
$$;
grant execute on function public.dz_an_scope(text) to authenticated;

-- ---------------------------------------------------------------------------
-- goals and achievements belong to a dashboard
-- ---------------------------------------------------------------------------
-- "500 views in 30 days" means something different under Artworks than under
-- Blog, and until now one goal was shared by all four.
alter table public.analytics_goals add column if not exists scope text not null default 'artwork';
alter table public.analytics_goals drop constraint if exists an_goal_scope;
alter table public.analytics_goals add constraint an_goal_scope
  check (scope in ('artwork','marketplace','blog','resource'));

-- cred leaves the metric list for the reason at the top of this file, and
-- sales joins it, because the marketplace is the one section where a sale is
-- a thing that happens.
alter table public.analytics_goals drop constraint if exists an_goal_metric;
alter table public.analytics_goals add constraint an_goal_metric check (metric in
  ('views','likes','bookmarks','downloads','comments','uploads','sales'));

update public.analytics_goals set metric = 'views' where metric = 'cred';

drop index if exists public.analytics_goals_one_idx;
create unique index if not exists analytics_goals_one_idx
  on public.analytics_goals (user_id, scope, metric, period);

create or replace function public.dz_an_goal_progress(
  p_user uuid, p_metric text, p_period text, p_scope text default 'artwork')
returns bigint language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_sc   text := public.dz_an_scope(p_scope);
  v_from date := case p_period
                   when '7d'  then current_date - 6
                   when '30d' then current_date - 29
                   when '90d' then current_date - 89
                   else date '1970-01-01'
                 end;
begin
  return case p_metric
    when 'views' then
      (select count(*) from public.an_view d
         join public.an_item i on i.id = d.subject_id and i.kind = d.kind
        where i.user_id = p_user and d.kind = v_sc and d.day >= v_from)
    when 'likes' then
      (select count(*) from public.an_like l
         join public.an_item i on i.id = l.subject_id and i.kind = l.kind
        where i.user_id = p_user and l.kind = v_sc and l.created_at::date >= v_from)
    when 'bookmarks' then
      (select count(*) from public.an_bookmark b
         join public.an_item i on i.id = b.subject_id and i.kind = b.kind
        where i.user_id = p_user and b.kind = v_sc and b.created_at::date >= v_from)
    when 'downloads' then
      (select count(*) from public.an_download d
         join public.an_item i on i.id = d.subject_id and i.kind = d.kind
        where i.user_id = p_user and d.kind = v_sc and d.day >= v_from)
    when 'comments' then
      (select count(*) from public.item_comments c
         join public.an_item i on i.id = c.subject_id and i.kind = c.kind
        where i.user_id = p_user and c.kind = v_sc and c.user_id <> p_user
          and c.created_at::date >= v_from)
    when 'uploads' then
      (select count(*) from public.an_item i
        where i.user_id = p_user and i.kind = v_sc and i.created_at::date >= v_from)
    when 'sales' then
      (select count(*) from public.marketplace_earnings e
        where v_sc = 'marketplace' and e.seller_id = p_user
          and coalesce(e.status, '') not in ('refunded','reversed','cancelled')
          and e.created_at::date >= v_from)
    else 0
  end;
end $$;

grant execute on function public.dz_an_goal_progress(uuid, text, text, text) to authenticated;
drop function if exists public.dz_an_goal_progress(uuid, text, text);

create or replace function public.dz_an_achievements(p_user uuid, p_scope text default 'artwork')
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_sc text := public.dz_an_scope(p_scope);
  v_up bigint; v_vw bigint; v_lk bigint; v_dl bigint; v_cm bigint;
  v_out jsonb;
  v_noun text := case v_sc when 'marketplace' then 'listings'
                           when 'blog' then 'posts'
                           when 'resource' then 'resources'
                           else 'artworks' end;
begin
  select count(*) into v_up from public.an_item i where i.user_id = p_user and i.kind = v_sc;

  select count(*) into v_vw from public.an_view d
    join public.an_item i on i.id = d.subject_id and i.kind = d.kind
   where i.user_id = p_user and d.kind = v_sc;

  select count(*) into v_lk from public.an_like l
    join public.an_item i on i.id = l.subject_id and i.kind = l.kind
   where i.user_id = p_user and l.kind = v_sc;

  select count(*) into v_dl from public.an_download d
    join public.an_item i on i.id = d.subject_id and i.kind = d.kind
   where i.user_id = p_user and d.kind = v_sc;

  select count(*) into v_cm from public.item_comments c
    join public.an_item i on i.id = c.subject_id and i.kind = c.kind
   where i.user_id = p_user and c.kind = v_sc and c.user_id <> p_user;

  select jsonb_agg(jsonb_build_object(
           'key', k, 'title', title, 'note', note,
           'have', have, 'need', need, 'done', have >= need) order by ord)
    into v_out
    from (values
      (1,  'first_upload', 'First Light',  'Publish your first '||rtrim(v_noun,'s'), v_up, 1::bigint),
      (2,  'five_uploads', 'Getting Going','Publish five '||v_noun,                  v_up, 5::bigint),
      (3,  'twenty_five',  'A Real Body',  'Publish twenty-five '||v_noun,           v_up, 25::bigint),
      (4,  'views_100',    'Seen',         'Reach 100 views here',                   v_vw, 100::bigint),
      (5,  'views_1k',     'Noticed',      'Reach 1,000 views here',                 v_vw, 1000::bigint),
      (6,  'views_10k',    'Widely Seen',  'Reach 10,000 views here',                v_vw, 10000::bigint),
      (7,  'likes_10',     'Liked',        'Collect 10 likes here',                  v_lk, 10::bigint),
      (8,  'likes_100',    'Loved',        'Collect 100 likes here',                 v_lk, 100::bigint),
      (9,  'likes_1k',     'Adored',       'Collect 1,000 likes here',               v_lk, 1000::bigint),
      (10, 'dl_1',         'Taken Home',   'Be downloaded once',                     v_dl, 1::bigint),
      (11, 'dl_50',        'In Demand',    'Reach 50 downloads',                     v_dl, 50::bigint),
      (12, 'comments_25',  'Talked About', 'Receive 25 comments here',               v_cm, 25::bigint)
    ) as t(ord, k, title, note, have, need);

  return coalesce(v_out, '[]'::jsonb);
end $$;

grant execute on function public.dz_an_achievements(uuid, text) to authenticated;
drop function if exists public.dz_an_achievements(uuid);

-- ---------------------------------------------------------------------------
-- the writer learns the other three sections
-- ---------------------------------------------------------------------------
-- Same rules as before, one addition: each kind resolves its owner from its
-- own table, and only a row the public can actually reach counts.
create or replace function public.dz_analytics_track(
  p_event    text,
  p_subject  uuid default null,
  p_scope    text default 'artwork',
  p_owner    uuid default null,
  p_source   text default null,
  p_ref      text default null,
  p_device   text default null,
  p_country  text default null,
  p_term     text default null,
  p_anon_key text default null
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_key    text;
  v_owner  uuid;
  v_source text;
  v_device text;
  v_term   text;
  v_ref    text;
  v_scope  text;
  v_actor  uuid;
begin
  if p_event is null then return; end if;

  if p_event not in ('like','unlike','bookmark','unbookmark','comment','share',
                     'profile_view','search_impression','search_click',
                     'follow','unfollow','cred') then
    return;
  end if;

  v_key := public.dz_an_viewer_key(p_anon_key);
  if v_key is null then return; end if;

  if not public.dz_rate_ok('an:' || v_key, 240, 60) then return; end if;

  v_scope := public.dz_an_scope(p_scope);

  if p_subject is not null and v_scope = 'artwork' then
    select a.user_id into v_owner from public.artworks a
     where a.id = p_subject and a.status = 'approved';
  elsif p_subject is not null and v_scope = 'marketplace' then
    select m.user_id into v_owner from public.marketplace_items m
     where m.id = p_subject and m.status = 'approved' and m.visibility = 'published';
  elsif p_subject is not null and v_scope = 'blog' then
    select b.user_id into v_owner from public.blog_posts b
     where b.id = p_subject and b.status = 'approved' and b.visibility = 'published';
  elsif p_subject is not null and v_scope = 'resource' then
    select r.user_id into v_owner from public.resources r
     where r.id = p_subject and r.status = 'approved' and r.visibility = 'published';
  elsif p_event in ('profile_view','follow','unfollow','cred') and p_owner is not null then
    select p.id into v_owner from public.profiles p where p.id = p_owner;
  end if;
  if v_owner is null then return; end if;

  if auth.uid() is not null and auth.uid() = v_owner then return; end if;

  v_source := lower(coalesce(p_source, 'direct'));
  if v_source not in ('direct','social','search','referral','internal') then
    v_source := 'direct';
  end if;

  v_device := lower(coalesce(p_device, 'unknown'));
  if v_device not in ('mobile','tablet','desktop') then
    v_device := 'unknown';
  end if;

  v_term := nullif(btrim(lower(coalesce(p_term, ''))), '');
  if v_term is not null then v_term := left(v_term, 80); end if;
  if p_event not in ('search_impression','search_click') then v_term := null; end if;

  v_ref := nullif(btrim(lower(coalesce(p_ref, ''))), '');
  if v_ref is not null then
    v_ref := nullif(left(regexp_replace(v_ref, '[^a-z0-9.:-]', '', 'g'), 120), '');
  end if;

  if p_event in ('profile_view','follow','unfollow','cred') then
    v_scope := 'profile';
  end if;

  -- A cred row exists only so the receiver's dashboard hears about it the
  -- moment it happens; the names it then shows come from the reader, off
  -- profile_creds itself. So this row carries no identity — it does not need
  -- any to do its job. The hash still dedups one cred per giver per receiver
  -- per day.
  if p_event = 'cred' then
    v_actor := null;
    v_key := 'c:' || md5('dzcred|' || v_key);
  else
    v_actor := auth.uid();
  end if;

  insert into public.analytics_events
    (owner_id, actor_id, viewer_key, scope, subject_id, event,
     source, referrer_host, country, device, term)
  values
    (v_owner, v_actor, v_key, v_scope, p_subject, p_event,
     v_source, v_ref, public.dz_an_country(p_country), v_device, v_term)
  on conflict do nothing;
end $$;

-- The search page searches every section, so an impression can belong to any
-- of them; it takes the scope now instead of assuming artworks.
drop function if exists public.dz_analytics_track_search(uuid[],text,text,text,text,text,text);
create or replace function public.dz_analytics_track_search(
  p_subjects uuid[],
  p_term     text,
  p_source   text default null,
  p_ref      text default null,
  p_device   text default null,
  p_country  text default null,
  p_anon_key text default null,
  p_scope    text default 'artwork'
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare v_id uuid; v_n int := 0;
begin
  if p_subjects is null or p_term is null or btrim(p_term) = '' then return; end if;
  foreach v_id in array p_subjects loop
    v_n := v_n + 1;
    exit when v_n > 12;
    perform public.dz_analytics_track(
      'search_impression', v_id, coalesce(p_scope, 'artwork'), null,
      p_source, p_ref, p_device, p_country, p_term, p_anon_key);
  end loop;
end $$;

grant execute on function public.dz_analytics_track(text,uuid,text,uuid,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.dz_analytics_track_search(uuid[],text,text,text,text,text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- the readers, one scope at a time
-- ---------------------------------------------------------------------------
-- The four readers are the artwork ones with `and kind = v_sc` running through
-- them and the tables swapped for the normalised views. Two shapes are new:
-- `sales`, which only the marketplace can have, and the `account` block, which
-- is the only place a number that is not this section's is allowed to appear.

create or replace function public.dz_analytics_overview(p_days int default 30, p_scope text default 'artwork')
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me    uuid := auth.uid();
  v_days  int  := public.dz_an_days(p_days);
  v_sc    text := public.dz_an_scope(p_scope);
  v_to    date := current_date;
  v_from  date := current_date - (v_days - 1);
  v_pto   date := current_date - v_days;
  v_pfrom date := current_date - (2 * v_days - 1);
  v_out   jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  with mine as (
    select i.id, i.created_at::date as made
      from public.an_item i where i.user_id = v_me and i.kind = v_sc
  ),
  daily as (
    select d.day as day, 'views'::text as metric, count(*)::bigint as n
      from public.an_view d join mine m on m.id = d.subject_id
     where d.kind = v_sc and d.day between v_pfrom and v_to group by d.day
    union all
    select d.day, 'downloads', count(*)::bigint
      from public.an_download d join mine m on m.id = d.subject_id
     where d.kind = v_sc and d.day between v_pfrom and v_to group by d.day
    union all
    select l.created_at::date, 'likes', count(*)::bigint
      from public.an_like l join mine m on m.id = l.subject_id
     where l.kind = v_sc and l.created_at::date between v_pfrom and v_to group by 1
    union all
    select b.created_at::date, 'bookmarks', count(*)::bigint
      from public.an_bookmark b join mine m on m.id = b.subject_id
     where b.kind = v_sc and b.created_at::date between v_pfrom and v_to group by 1
    union all
    select c.created_at::date, 'comments', count(*)::bigint
      from public.item_comments c join mine m on m.id = c.subject_id
     where c.kind = v_sc and c.user_id <> v_me
       and c.created_at::date between v_pfrom and v_to group by 1
    union all
    select e.day, 'shares', count(*)::bigint
      from public.analytics_events e
     where e.owner_id = v_me and e.scope = v_sc and e.event = 'share'
       and e.day between v_pfrom and v_to group by e.day
    union all
    select m.made, 'uploads', count(*)::bigint
      from mine m where m.made between v_pfrom and v_to group by m.made
    union all
    select e.created_at::date, 'sales', count(*)::bigint
      from public.marketplace_earnings e
     where v_sc = 'marketplace' and e.seller_id = v_me
       and coalesce(e.status, '') not in ('refunded','reversed','cancelled')
       and e.created_at::date between v_pfrom and v_to group by 1
  ),
  cal as (select gs::date as day from generate_series(v_from, v_to, interval '1 day') gs),
  per_day as (
    select cal.day,
           coalesce(sum(n) filter (where metric = 'views'), 0)::bigint     as views,
           coalesce(sum(n) filter (where metric = 'likes'), 0)::bigint     as likes,
           coalesce(sum(n) filter (where metric = 'bookmarks'), 0)::bigint as bookmarks,
           coalesce(sum(n) filter (where metric = 'downloads'), 0)::bigint as downloads,
           coalesce(sum(n) filter (where metric = 'comments'), 0)::bigint  as comments,
           coalesce(sum(n) filter (where metric = 'shares'), 0)::bigint    as shares,
           coalesce(sum(n) filter (where metric = 'uploads'), 0)::bigint   as uploads,
           coalesce(sum(n) filter (where metric = 'sales'), 0)::bigint     as sales
      from cal left join daily on daily.day = cal.day group by cal.day
  ),
  series as (
    select jsonb_agg(jsonb_build_object(
             'd', day, 'views', views, 'likes', likes, 'bookmarks', bookmarks,
             'downloads', downloads, 'comments', comments, 'shares', shares,
             'uploads', uploads, 'sales', sales) order by day) as rows
      from per_day
  ),
  names (metric) as (values ('views'),('likes'),('bookmarks'),('downloads'),
                            ('comments'),('shares'),('uploads'),('sales')),
  win as (
    select names.metric,
           coalesce(sum(d.n) filter (where d.day between v_from  and v_to),  0)::bigint as cur,
           coalesce(sum(d.n) filter (where d.day between v_pfrom and v_pto), 0)::bigint as prev
      from names left join daily d on d.metric = names.metric group by names.metric
  ),
  totals as (
    select
      (select count(*) from mine)::bigint as items,
      (select count(*) from public.an_view v join mine m on m.id = v.subject_id
        where v.kind = v_sc)::bigint as views_all,
      (select count(*) from public.an_like l join mine m on m.id = l.subject_id
        where l.kind = v_sc)::bigint as likes_all,
      (select count(*) from public.an_bookmark b join mine m on m.id = b.subject_id
        where b.kind = v_sc)::bigint as bookmarks_all,
      (select count(*) from public.an_download d join mine m on m.id = d.subject_id
        where d.kind = v_sc)::bigint as downloads_all,
      (select count(*) from public.item_comments c join mine m on m.id = c.subject_id
        where c.kind = v_sc and c.user_id <> v_me)::bigint as comments_all,
      (select count(*) from public.analytics_events e
        where e.owner_id = v_me and e.scope = v_sc and e.event = 'share')::bigint as shares_all,
      (select count(*) from public.marketplace_earnings e
        where v_sc = 'marketplace' and e.seller_id = v_me
          and coalesce(e.status, '') not in ('refunded','reversed','cancelled'))::bigint as sales_all
  ),
  peers as (
    select i.user_id, count(*)::bigint as n
      from public.an_view d
      join public.an_item i on i.id = d.subject_id and i.kind = d.kind
     where d.kind = v_sc and d.day between v_from and v_to and i.user_id is not null
     group by i.user_id
  ),
  mine_views as (select coalesce(max(cur), 0)::bigint as n from win where metric = 'views'),
  peerstat as (
    select
      coalesce(percentile_cont(0.5) within group (order by p.n), 0)::bigint as median_views,
      coalesce(round(avg(p.n), 1), 0)::numeric                              as avg_views,
      count(*)::bigint                                                      as artists,
      count(*) filter (where p.n <= (select n from mine_views))::bigint     as below
      from peers p
  )
  select jsonb_build_object(
    'scope',  v_sc,
    'range',  jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to,
                                 'prev_from', v_pfrom, 'prev_to', v_pto),
    'series', coalesce((select rows from series), '[]'::jsonb),
    'window', (select coalesce(jsonb_object_agg(metric, cur), '{}'::jsonb) from win),
    'prev',   (select coalesce(jsonb_object_agg(metric, prev), '{}'::jsonb) from win),
    'totals', (select to_jsonb(t) from totals t),
    'compare', (select jsonb_build_object(
                  'my_views',     (select n from mine_views),
                  'median_views', ps.median_views,
                  'avg_views',    ps.avg_views,
                  'artists',      ps.artists,
                  'percentile',   case when ps.artists > 0
                                       then round((ps.below::numeric / ps.artists) * 100)
                                       else 0 end)
                 from peerstat ps)
  ) into v_out;

  return coalesce(v_out, '{}'::jsonb);
end $$;

create or replace function public.dz_analytics_content(p_days int default 30, p_scope text default 'artwork')
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me   uuid := auth.uid();
  v_sc   text := public.dz_an_scope(p_scope);
  v_to   date := current_date;
  v_from date := current_date - (public.dz_an_days(p_days) - 1);
  v_out  jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  with mine as (select i.* from public.an_item i where i.user_id = v_me and i.kind = v_sc),
  g_views as (select d.subject_id as id, count(*)::bigint as n
                from public.an_view d join mine m on m.id = d.subject_id
               where d.kind = v_sc and d.day between v_from and v_to group by 1),
  g_dls as (select d.subject_id as id, count(*)::bigint as n
              from public.an_download d join mine m on m.id = d.subject_id
             where d.kind = v_sc and d.day between v_from and v_to group by 1),
  g_likes as (select l.subject_id as id, count(*)::bigint as n
                from public.an_like l join mine m on m.id = l.subject_id
               where l.kind = v_sc and l.created_at::date between v_from and v_to group by 1),
  g_bms as (select b.subject_id as id, count(*)::bigint as n
              from public.an_bookmark b join mine m on m.id = b.subject_id
             where b.kind = v_sc and b.created_at::date between v_from and v_to group by 1),
  g_cms as (select c.subject_id as id, count(*)::bigint as n
              from public.item_comments c join mine m on m.id = c.subject_id
             where c.kind = v_sc and c.user_id <> v_me
               and c.created_at::date between v_from and v_to group by 1),
  g_sales as (select e.item_id as id, count(*)::bigint as n
                from public.marketplace_earnings e
               where v_sc = 'marketplace' and e.seller_id = v_me
                 and coalesce(e.status, '') not in ('refunded','reversed','cancelled')
                 and e.created_at::date between v_from and v_to group by 1),
  win as (
    select m.*,
           coalesce(gv.n, 0) as w_views,
           coalesce(gd.n, 0) as w_downloads,
           coalesce(gl.n, 0) as w_likes,
           coalesce(gb.n, 0) as w_bookmarks,
           coalesce(gc.n, 0) as w_comments,
           coalesce(gs.n, 0) as w_sales
      from mine m
      left join g_views gv on gv.id = m.id
      left join g_dls   gd on gd.id = m.id
      left join g_likes gl on gl.id = m.id
      left join g_bms   gb on gb.id = m.id
      left join g_cms   gc on gc.id = m.id
      left join g_sales gs on gs.id = m.id
  ),
  art_rows as (
    select jsonb_agg(x order by ord) as list from (
      select row_number() over (order by w_views desc, w_likes desc, created_at desc) as ord,
             jsonb_build_object(
               'id', id, 'title', title, 'thumb', thumb,
               'category', coalesce(category[1], 'others'),
               'created_at', created_at,
               'status', status, 'visibility', visibility,
               'featured', featured, 'mature', is_mature,
               'views', w_views, 'likes', w_likes, 'bookmarks', w_bookmarks,
               'downloads', w_downloads, 'comments', w_comments, 'sales', w_sales,
               'views_all', view_count, 'likes_all', like_count,
               'bookmarks_all', bookmark_count, 'downloads_all', download_count,
               'sales_all', sales_count, 'price_cents', price_cents,
               'engagement', case when w_views > 0
                                  then round(((w_likes + w_bookmarks + w_comments)::numeric / w_views) * 100, 1)
                                  else 0 end
             ) as x
        from win
       order by w_views desc, w_likes desc, created_at desc
       limit 200
    ) s
  ),
  cats as (
    select jsonb_agg(jsonb_build_object('key', k, 'artworks', n, 'views', v, 'likes', l)
                     order by v desc, n desc) as list
      from (
        select coalesce(category[1], 'others') as k, count(*)::bigint as n,
               sum(w_views)::bigint as v, sum(w_likes)::bigint as l
          from win group by 1
      ) s
  ),
  tags as (
    select jsonb_agg(jsonb_build_object('key', k, 'artworks', n, 'views', v)
                     order by v desc, n desc) as list
      from (
        select lower(btrim(t)) as k, count(*)::bigint as n, sum(w.w_views)::bigint as v
          from win w, unnest(w.tags) as t
         where btrim(t) <> '' group by 1 order by v desc, n desc limit 20
      ) s
  ),
  soft as (
    select jsonb_agg(jsonb_build_object('key', k, 'artworks', n, 'views', v)
                     order by v desc, n desc) as list
      from (
        select lower(btrim(s2)) as k, count(*)::bigint as n, sum(w.w_views)::bigint as v
          from win w, unnest(w.software) as s2
         where btrim(s2) <> '' group by 1 order by v desc, n desc limit 12
      ) s
  ),
  cadence as (
    select jsonb_agg(jsonb_build_object('month', mth, 'uploads', n) order by mth) as list
      from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') as mth, count(*)::bigint as n
          from mine
         where created_at >= (date_trunc('month', now()) - interval '11 months')
         group by 1
      ) s
  ),
  shape as (
    select
      count(*)::bigint                                          as artworks,
      count(*) filter (where is_mature)::bigint                 as mature,
      count(*) filter (where featured)::bigint                  as featured,
      count(*) filter (where visibility is distinct from 'published')::bigint as unlisted,
      count(*) filter (where status = 'approved')::bigint       as approved,
      count(*) filter (where license is not null)::bigint       as licensed,
      coalesce(round(avg(view_count), 1), 0)::numeric           as avg_views,
      coalesce(round(avg(like_count), 1), 0)::numeric           as avg_likes,
      min(created_at) as first_upload,
      max(created_at) as last_upload
      from mine
  )
  select jsonb_build_object(
    'scope',       v_sc,
    'range',       jsonb_build_object('from', v_from, 'to', v_to),
    'artworks',    coalesce((select list from art_rows), '[]'::jsonb),
    'by_category', coalesce((select list from cats), '[]'::jsonb),
    'by_tag',      coalesce((select list from tags), '[]'::jsonb),
    'by_software', coalesce((select list from soft), '[]'::jsonb),
    'cadence',     coalesce((select list from cadence), '[]'::jsonb),
    'shape',       (select to_jsonb(s) from shape s)
  ) into v_out;

  return coalesce(v_out, '{}'::jsonb);
end $$;

create or replace function public.dz_analytics_reach(p_days int default 30, p_scope text default 'artwork')
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me   uuid := auth.uid();
  v_sc   text := public.dz_an_scope(p_scope);
  v_to   date := current_date;
  v_from date := current_date - (public.dz_an_days(p_days) - 1);
  v_out  jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  with mine as (select i.id from public.an_item i where i.user_id = v_me and i.kind = v_sc),
  ev as (
    select e.event, e.source, e.referrer_host, e.country, e.device, e.term, e.created_at
      from public.analytics_events e
     where e.owner_id = v_me and e.day between v_from and v_to and e.scope = v_sc
  ),
  seen as (
    select d.viewer_key, count(distinct d.day)::int as days
      from public.an_view d join mine m on m.id = d.subject_id
     where d.kind = v_sc and d.day between v_from and v_to
     group by d.viewer_key
  ),
  countries as (
    select jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc) as list
      from (select country as k, count(*)::bigint n from ev
             where country is not null and event in ('view','download')
             group by 1 order by n desc limit 12) s
  ),
  devices as (
    select jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc) as list
      from (select device as k, count(*)::bigint n from ev
             where event in ('view','download') group by 1) s
  ),
  sources as (
    select jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc) as list
      from (select source as k, count(*)::bigint n from ev
             where event in ('view','download') group by 1) s
  ),
  referrers as (
    select jsonb_agg(jsonb_build_object('key', k, 'n', n) order by n desc) as list
      from (select referrer_host as k, count(*)::bigint n from ev
             where referrer_host is not null and event in ('view','download')
             group by 1 order by n desc limit 10) s
  ),
  hours as (
    select jsonb_agg(jsonb_build_object('h', h, 'n', coalesce(s.n, 0)) order by h) as list
      from generate_series(0, 23) h
      left join (select extract(hour from created_at at time zone 'UTC')::int as hh,
                        count(*)::bigint as n
                   from ev where event = 'view' group by 1) s on s.hh = h
  ),
  weekdays as (
    select jsonb_agg(jsonb_build_object('w', w, 'n', coalesce(s.n, 0)) order by w) as list
      from generate_series(0, 6) w
      left join (select extract(dow from d.day)::int as ww, count(*)::bigint as n
                   from public.an_view d join mine m on m.id = d.subject_id
                  where d.kind = v_sc and d.day between v_from and v_to group by 1) s on s.ww = w
  ),
  fans as (
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(nullif(p.display_name, ''), p.username, 'Artist'),
             'handle', p.username, 'avatar', p.avatar_url, 'n', f.n) order by f.n desc) as list
      from (
        select uid, count(*)::bigint as n from (
          select l.user_id as uid from public.an_like l join mine m on m.id = l.subject_id
           where l.kind = v_sc and l.created_at::date between v_from and v_to
          union all
          select b.user_id from public.an_bookmark b join mine m on m.id = b.subject_id
           where b.kind = v_sc and b.created_at::date between v_from and v_to
          union all
          select c.user_id from public.item_comments c join mine m on m.id = c.subject_id
           where c.kind = v_sc and c.created_at::date between v_from and v_to
        ) u where uid is not null and uid <> v_me
        group by uid order by n desc limit 8
      ) f join public.profiles p on p.id = f.uid
  ),
  terms as (
    select jsonb_agg(jsonb_build_object(
             'term', term, 'impressions', imp, 'clicks', clk,
             'ctr', case when imp > 0 then round((clk::numeric / imp) * 100, 1) else 0 end)
             order by imp desc, clk desc) as list
      from (
        select term,
               count(*) filter (where event = 'search_impression')::bigint as imp,
               count(*) filter (where event = 'search_click')::bigint      as clk
          from ev where term is not null group by term
         order by imp desc limit 15
      ) s
  )
  select jsonb_build_object(
    'scope', v_sc,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'audience', jsonb_build_object(
      'viewers',   (select count(*) from seen),
      'returning', (select count(*) from seen where days > 1),
      'new',       (select count(*) from seen where days = 1),
      'signed_in', (select count(*) from seen where viewer_key like 'u:%'),
      'days_per_viewer', (select case when count(*) > 0
                                      then round(sum(days)::numeric / count(*), 2)
                                      else 0 end from seen),
      'top_fans',   coalesce((select list from fans), '[]'::jsonb),
      'by_hour',    coalesce((select list from hours), '[]'::jsonb),
      'by_weekday', coalesce((select list from weekdays), '[]'::jsonb)
    ),
    'countries', coalesce((select list from countries), '[]'::jsonb),
    'devices',   coalesce((select list from devices), '[]'::jsonb),
    'sources',   coalesce((select list from sources), '[]'::jsonb),
    'referrers', coalesce((select list from referrers), '[]'::jsonb),
    'search', jsonb_build_object(
      'terms',       coalesce((select list from terms), '[]'::jsonb),
      'impressions', (select count(*) from ev where event = 'search_impression'),
      'clicks',      (select count(*) from ev where event = 'search_click')
    ),
    'dimension_rows', (select count(*) from ev)
  ) into v_out;

  return coalesce(v_out, '{}'::jsonb);
end $$;

create or replace function public.dz_analytics_activity(p_days int default 30, p_scope text default 'artwork')
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
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
  cseries as (
    select jsonb_agg(jsonb_build_object('d', cal.day, 'gained', coalesce(g.n, 0)) order by cal.day) as list
      from (select gs::date as day from generate_series(v_from, v_to, interval '1 day') gs) cal
      left join (
        select c.created_at::date as day, count(*)::bigint as n
          from public.profile_creds c
         where c.receiver_id = v_me and c.created_at::date between v_from and v_to
         group by 1
      ) g on g.day = cal.day
  ),
  recent_cred as (
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(nullif(p.display_name, ''), p.username, 'Artist'),
             'handle', p.username, 'avatar', p.avatar_url, 'at', c.at) order by c.at desc) as list
      from (
        select c.giver_id as other, c.created_at as at
          from public.profile_creds c where c.receiver_id = v_me
         order by c.created_at desc limit 8
      ) c join public.profiles p on p.id = c.other
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
        order by at desc limit 12
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
    -- The one block that is allowed to hold a number this section did not
    -- earn, and it is labelled account-wide wherever it is drawn.
    'account', jsonb_build_object(
      'cred_total',  (select count(*) from public.profile_creds c where c.receiver_id = v_me),
      'cred_gained', (select count(*) from public.profile_creds c
                       where c.receiver_id = v_me and c.created_at::date between v_from and v_to),
      'cred_given',  (select count(*) from public.profile_creds c where c.giver_id = v_me),
      'cred_givers', (select count(distinct c.giver_id) from public.profile_creds c
                       where c.receiver_id = v_me),
      'cred_series', coalesce((select list from cseries), '[]'::jsonb),
      'cred_recent', coalesce((select list from recent_cred), '[]'::jsonb),
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
    -- null everywhere but the marketplace, and the page draws no revenue
    -- section when it is null. An artwork is not for sale here; a blog post
    -- and a resource are free.
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
end $$;

drop function if exists public.dz_analytics_overview(int);
drop function if exists public.dz_analytics_content(int);
drop function if exists public.dz_analytics_reach(int);
drop function if exists public.dz_analytics_activity(int);

grant execute on function public.dz_analytics_overview(int, text) to authenticated;
grant execute on function public.dz_analytics_content(int, text)  to authenticated;
grant execute on function public.dz_analytics_reach(int, text)    to authenticated;
grant execute on function public.dz_analytics_activity(int, text) to authenticated;
