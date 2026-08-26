create table if not exists public.analytics_events (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  actor_id      uuid references public.profiles(id) on delete set null,
  viewer_key    text not null,
  scope         text not null default 'artwork',
  subject_id    uuid,
  event         text not null,
  source        text not null default 'direct',
  referrer_host text,
  country       text,
  device        text not null default 'unknown',
  term          text,
  created_at    timestamptz not null default now(),
  day           date not null default current_date,

  constraint an_ev_event check (event in (
    'view','like','unlike','bookmark','unbookmark','download','comment',
    'share','profile_view','search_impression','search_click','follow','unfollow',
    'cred'
  )),
  constraint an_ev_scope   check (scope in ('artwork','marketplace','blog','resource','profile')),
  constraint an_ev_source  check (source in ('direct','social','search','referral','internal')),
  constraint an_ev_device  check (device in ('mobile','tablet','desktop','unknown')),
  constraint an_ev_country check (country is null or country ~ '^[A-Z]{2}$'),
  constraint an_ev_term    check (term is null or char_length(term) between 1 and 80),
  constraint an_ev_ref     check (referrer_host is null or char_length(referrer_host) between 1 and 120),
  constraint an_ev_vkey    check (char_length(viewer_key) between 3 and 80)
);

create unique index if not exists analytics_events_once_idx
  on public.analytics_events (
    owner_id, event,
    coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    viewer_key, coalesce(term, ''), day
  );

create index if not exists analytics_events_owner_day_idx
  on public.analytics_events (owner_id, day desc);
create index if not exists analytics_events_owner_event_idx
  on public.analytics_events (owner_id, event, day desc);
create index if not exists analytics_events_subject_idx
  on public.analytics_events (subject_id, event) where subject_id is not null;
create index if not exists analytics_events_term_idx
  on public.analytics_events (owner_id, term, day desc) where term is not null;

alter table public.analytics_events enable row level security;

drop policy if exists analytics_events_select_own on public.analytics_events;
create policy analytics_events_select_own on public.analytics_events
  for select to authenticated
  using (owner_id = auth.uid());

revoke all on public.analytics_events from anon, authenticated;
grant select on public.analytics_events to authenticated;

create table if not exists public.analytics_goals (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  metric      text not null,
  target      bigint not null,
  period      text not null default '30d',
  created_at  timestamptz not null default now(),
  achieved_at timestamptz,

  constraint an_goal_metric check (metric in
    ('views','likes','bookmarks','downloads','comments','cred','uploads')),
  constraint an_goal_period check (period in ('7d','30d','90d','all')),
  constraint an_goal_target check (target between 1 and 100000000)
);

create index if not exists analytics_goals_user_idx on public.analytics_goals (user_id, created_at desc);
create unique index if not exists analytics_goals_one_idx
  on public.analytics_goals (user_id, metric, period);

alter table public.analytics_goals enable row level security;

drop policy if exists analytics_goals_all_own on public.analytics_goals;
create policy analytics_goals_all_own on public.analytics_goals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.analytics_goals to authenticated;

create or replace function public.dz_analytics_goal_cap()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
begin
  if (select count(*) from public.analytics_goals where user_id = new.user_id) >= 12 then
    raise exception 'goal limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists analytics_goals_cap on public.analytics_goals;
create trigger analytics_goals_cap before insert on public.analytics_goals
  for each row execute function public.dz_analytics_goal_cap();

create or replace function public.dz_an_country(p_hint text default null)
returns text language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_raw text;
  v_hdr json;
  v_cc  text;
begin
  v_raw := nullif(current_setting('request.headers', true), '');
  if v_raw is not null then
    begin
      v_hdr := v_raw::json;
      v_cc := upper(btrim(coalesce(
        nullif(v_hdr ->> 'cf-ipcountry', ''),
        nullif(v_hdr ->> 'x-vercel-ip-country', ''),
        nullif(v_hdr ->> 'x-country-code', ''),
        ''
      )));
    exception when others then
      v_cc := null;
    end;
  end if;
  if v_cc is not null and v_cc ~ '^[A-Z]{2}$' and v_cc not in ('XX', 'T1') then
    return v_cc;
  end if;
  v_cc := upper(btrim(coalesce(p_hint, '')));
  if v_cc ~ '^[A-Z]{2}$' then return v_cc; end if;
  return null;
end $$;

create or replace function public.dz_an_viewer_key(p_anon_key text)
returns text language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare v_ip text;
begin
  if auth.uid() is not null then
    return 'u:' || auth.uid()::text;
  end if;
  v_ip := public.dz_client_ip();
  if v_ip is not null then
    return 'a:' || md5('dzview|' || v_ip);
  end if;
  if p_anon_key is null
     or length(p_anon_key) not between 16 and 64
     or p_anon_key !~ '^[A-Za-z0-9-]+$' then
    return null;
  end if;
  return 'a:' || p_anon_key;
end $$;

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

  if p_subject is not null and coalesce(p_scope, 'artwork') = 'artwork' then
    select a.user_id into v_owner
      from public.artworks a
     where a.id = p_subject and a.status = 'approved';
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

  v_scope := case when p_event in ('profile_view','follow','unfollow','cred') then 'profile'
                  else coalesce(p_scope, 'artwork') end;
  if v_scope not in ('artwork','marketplace','blog','resource','profile') then
    v_scope := 'artwork';
  end if;

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

create or replace function public.dz_analytics_track_search(
  p_subjects uuid[],
  p_term     text,
  p_source   text default null,
  p_ref      text default null,
  p_device   text default null,
  p_country  text default null,
  p_anon_key text default null
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
      'search_impression', v_id, 'artwork', null,
      p_source, p_ref, p_device, p_country, p_term, p_anon_key);
  end loop;
end $$;

revoke all on function public.dz_analytics_track(text,uuid,text,uuid,text,text,text,text,text,text) from public;
revoke all on function public.dz_analytics_track_search(uuid[],text,text,text,text,text,text) from public;
grant execute on function public.dz_analytics_track(text,uuid,text,uuid,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.dz_analytics_track_search(uuid[],text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.dz_an_country(text) to anon, authenticated;
grant execute on function public.dz_an_viewer_key(text) to anon, authenticated;

drop function if exists public.register_artwork_view(uuid, text);
create or replace function public.register_artwork_view(
  p_artwork  uuid,
  p_anon_key text default null,
  p_source   text default null,
  p_ref      text default null,
  p_device   text default null,
  p_country  text default null
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_key   text;
  v_ip    text;
  v_owner uuid;
begin
  select a.user_id into v_owner
    from public.artworks a
   where a.id = p_artwork and a.status = 'approved';
  if not found then
    return;
  end if;

  if auth.uid() is not null then
    if not public.dz_rate_ok('vw:u:' || auth.uid()::text, 120, 60) then
      return;
    end if;
    v_key := 'u:' || auth.uid()::text;
  else
    v_ip := public.dz_client_ip();

    if v_ip is not null then
      if not public.dz_rate_ok('vw:ip:' || v_ip, 120, 60) then
        return;
      end if;
      v_key := 'a:' || md5('dzview|' || v_ip);
    else
      if p_anon_key is null
         or length(p_anon_key) not between 16 and 64
         or p_anon_key !~ '^[A-Za-z0-9-]+$' then
        return;
      end if;
      if not public.dz_rate_ok('vw:nokey', 600, 60) then
        return;
      end if;
      v_key := 'a:' || p_anon_key;
    end if;
  end if;

  insert into public.artwork_view_dedup (artwork_id, viewer_key, day)
  values (p_artwork, v_key, current_date)
  on conflict do nothing;

  if found then
    perform set_config('app.allow_view_count_write', '1', true);
    update public.artworks
       set view_count = coalesce(view_count, 0) + 1
     where id = p_artwork;
    perform set_config('app.allow_view_count_write', '0', true);

    if v_owner is not null and (auth.uid() is null or auth.uid() <> v_owner) then
      insert into public.analytics_events
        (owner_id, actor_id, viewer_key, scope, subject_id, event,
         source, referrer_host, country, device)
      values
        (v_owner, auth.uid(), v_key, 'artwork', p_artwork, 'view',
         case when lower(coalesce(p_source, 'direct')) in
                   ('direct','social','search','referral','internal')
              then lower(p_source) else 'direct' end,
         nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.:-]', '', 'g'), 120), ''),
         public.dz_an_country(p_country),
         case when lower(coalesce(p_device, 'unknown')) in ('mobile','tablet','desktop')
              then lower(p_device) else 'unknown' end)
      on conflict do nothing;
    end if;
  end if;
end $$;

drop function if exists public.register_artwork_download(uuid, text);
create or replace function public.register_artwork_download(
  p_artwork  uuid,
  p_anon_key text default null,
  p_source   text default null,
  p_ref      text default null,
  p_device   text default null,
  p_country  text default null
) returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_key   text;
  v_ip    text;
  v_owner uuid;
begin
  select a.user_id into v_owner
    from public.artworks a
   where a.id = p_artwork and a.status = 'approved';
  if not found then
    return;
  end if;

  if auth.uid() is not null then
    if not public.dz_rate_ok('dlc:u:' || auth.uid()::text, 60, 60) then
      return;
    end if;
    v_key := 'u:' || auth.uid()::text;
  else
    v_ip := public.dz_client_ip();

    if v_ip is not null then
      if not public.dz_rate_ok('dlc:ip:' || v_ip, 60, 60) then
        return;
      end if;
      v_key := 'a:' || md5('dzdownload|' || v_ip);
    else
      if p_anon_key is null
         or length(p_anon_key) not between 16 and 64
         or p_anon_key !~ '^[A-Za-z0-9-]+$' then
        return;
      end if;
      if not public.dz_rate_ok('dlc:nokey', 300, 60) then
        return;
      end if;
      v_key := 'a:' || p_anon_key;
    end if;
  end if;

  insert into public.artwork_download_dedup (artwork_id, viewer_key, day)
  values (p_artwork, v_key, current_date)
  on conflict do nothing;

  if found then
    perform set_config('app.allow_download_count_write', '1', true);
    update public.artworks
       set download_count = coalesce(download_count, 0) + 1
     where id = p_artwork;
    perform set_config('app.allow_download_count_write', '0', true);

    if v_owner is not null and (auth.uid() is null or auth.uid() <> v_owner) then
      insert into public.analytics_events
        (owner_id, actor_id, viewer_key, scope, subject_id, event,
         source, referrer_host, country, device)
      values
        (v_owner, auth.uid(), v_key, 'artwork', p_artwork, 'download',
         case when lower(coalesce(p_source, 'direct')) in
                   ('direct','social','search','referral','internal')
              then lower(p_source) else 'direct' end,
         nullif(left(regexp_replace(lower(coalesce(p_ref, '')), '[^a-z0-9.:-]', '', 'g'), 120), ''),
         public.dz_an_country(p_country),
         case when lower(coalesce(p_device, 'unknown')) in ('mobile','tablet','desktop')
              then lower(p_device) else 'unknown' end)
      on conflict do nothing;
    end if;
  end if;
end $$;

grant execute on function public.register_artwork_view(uuid,text,text,text,text,text) to anon, authenticated;
grant execute on function public.register_artwork_download(uuid,text,text,text,text,text) to anon, authenticated;

create or replace function public.dz_an_days(p_days int)
returns int language sql immutable as $$
  select case when p_days in (7, 14, 30, 90, 365) then p_days else 30 end;
$$;

grant execute on function public.dz_an_days(int) to authenticated;

create or replace function public.dz_an_goal_progress(p_user uuid, p_metric text, p_period text)
returns bigint language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_from date := case p_period
                   when '7d'  then current_date - 6
                   when '30d' then current_date - 29
                   when '90d' then current_date - 89
                   else date '1970-01-01'
                 end;
begin
  return case p_metric
    when 'views' then
      (select count(*) from public.artwork_view_dedup d
         join public.artworks a on a.id = d.artwork_id
        where a.user_id = p_user and d.day >= v_from)
    when 'likes' then
      (select count(*) from public.artwork_likes l
         join public.artworks a on a.id = l.artwork_id
        where a.user_id = p_user and l.created_at::date >= v_from)
    when 'bookmarks' then
      (select count(*) from public.artwork_bookmarks b
         join public.artworks a on a.id = b.artwork_id
        where a.user_id = p_user and b.created_at::date >= v_from)
    when 'downloads' then
      (select count(*) from public.artwork_download_dedup d
         join public.artworks a on a.id = d.artwork_id
        where a.user_id = p_user and d.day >= v_from)
    when 'comments' then
      (select count(*) from public.item_comments c
         join public.artworks a on a.id = c.subject_id
        where c.kind = 'artwork' and a.user_id = p_user and c.user_id <> p_user
          and c.created_at::date >= v_from)
    when 'cred' then
      (select count(*) from public.profile_creds c
        where c.receiver_id = p_user and c.created_at::date >= v_from)
    when 'uploads' then
      (select count(*) from public.artworks a
        where a.user_id = p_user and a.created_at::date >= v_from)
    else 0
  end;
end $$;

create or replace function public.dz_an_achievements(p_user uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_up bigint; v_vw bigint; v_lk bigint; v_dl bigint; v_cr bigint; v_cm bigint;
  v_out jsonb;
begin
  select count(*), coalesce(sum(view_count), 0), coalesce(sum(like_count), 0),
         coalesce(sum(download_count), 0)
    into v_up, v_vw, v_lk, v_dl
    from public.artworks where user_id = p_user;

  select count(*) into v_cr from public.profile_creds c
   where c.receiver_id = p_user;

  select count(*) into v_cm from public.item_comments c
    join public.artworks a on a.id = c.subject_id
   where c.kind = 'artwork' and a.user_id = p_user and c.user_id <> p_user;

  select jsonb_agg(jsonb_build_object(
           'key', k, 'title', title, 'note', note,
           'have', have, 'need', need, 'done', have >= need) order by ord)
    into v_out
    from (values
      (1,  'first_upload', 'First Light',      'Publish your first artwork',       v_up, 1::bigint),
      (2,  'five_uploads', 'Getting Going',    'Publish five artworks',            v_up, 5::bigint),
      (3,  'twenty_five',  'A Real Portfolio', 'Publish twenty-five artworks',     v_up, 25::bigint),
      (4,  'views_100',    'Seen',             'Reach 100 total views',            v_vw, 100::bigint),
      (5,  'views_1k',     'Noticed',          'Reach 1,000 total views',          v_vw, 1000::bigint),
      (6,  'views_10k',    'Widely Seen',      'Reach 10,000 total views',         v_vw, 10000::bigint),
      (7,  'likes_10',     'Liked',            'Collect 10 likes',                 v_lk, 10::bigint),
      (8,  'likes_100',    'Loved',            'Collect 100 likes',                v_lk, 100::bigint),
      (9,  'likes_1k',     'Adored',           'Collect 1,000 likes',              v_lk, 1000::bigint),
      (10, 'dl_1',         'Taken Home',       'Have your work downloaded once',   v_dl, 1::bigint),
      (11, 'dl_50',        'In Demand',        'Reach 50 downloads',               v_dl, 50::bigint),
      (12, 'cred_25',      'Respected',        'Receive cred from 25 artists',     v_cr, 25::bigint),
      (13, 'comments_25',  'Talked About',     'Receive 25 comments on your work', v_cm, 25::bigint)
    ) as t(ord, k, title, note, have, need);

  return coalesce(v_out, '[]'::jsonb);
end $$;

grant execute on function public.dz_an_goal_progress(uuid, text, text) to authenticated;
grant execute on function public.dz_an_achievements(uuid) to authenticated;

create or replace function public.dz_analytics_overview(p_days int default 30)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me    uuid := auth.uid();
  v_days  int  := public.dz_an_days(p_days);
  v_to    date := current_date;
  v_from  date := current_date - (v_days - 1);
  v_pto   date := current_date - v_days;
  v_pfrom date := current_date - (2 * v_days - 1);
  v_out   jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  with mine as (
    select a.id, a.created_at::date as made
      from public.artworks a
     where a.user_id = v_me
  ),
  daily as (
    select d.day as day, 'views'::text as metric, count(*)::bigint as n
      from public.artwork_view_dedup d join mine m on m.id = d.artwork_id
     where d.day between v_pfrom and v_to
     group by d.day
    union all
    select d.day, 'downloads', count(*)::bigint
      from public.artwork_download_dedup d join mine m on m.id = d.artwork_id
     where d.day between v_pfrom and v_to
     group by d.day
    union all
    select l.created_at::date, 'likes', count(*)::bigint
      from public.artwork_likes l join mine m on m.id = l.artwork_id
     where l.created_at::date between v_pfrom and v_to
     group by 1
    union all
    select b.created_at::date, 'bookmarks', count(*)::bigint
      from public.artwork_bookmarks b join mine m on m.id = b.artwork_id
     where b.created_at::date between v_pfrom and v_to
     group by 1
    union all
    select c.created_at::date, 'comments', count(*)::bigint
      from public.item_comments c join mine m on m.id = c.subject_id
     where c.kind = 'artwork' and c.user_id <> v_me
       and c.created_at::date between v_pfrom and v_to
     group by 1
    union all
    select c.created_at::date, 'cred', count(*)::bigint
      from public.profile_creds c
     where c.receiver_id = v_me
       and c.created_at::date between v_pfrom and v_to
     group by 1
    union all
    select m.made, 'uploads', count(*)::bigint
      from mine m
     where m.made between v_pfrom and v_to
     group by m.made
  ),
  cal as (select gs::date as day from generate_series(v_from, v_to, interval '1 day') gs),
  per_day as (
    select cal.day,
           coalesce(sum(n) filter (where metric = 'views'), 0)::bigint     as views,
           coalesce(sum(n) filter (where metric = 'likes'), 0)::bigint     as likes,
           coalesce(sum(n) filter (where metric = 'bookmarks'), 0)::bigint as bookmarks,
           coalesce(sum(n) filter (where metric = 'downloads'), 0)::bigint as downloads,
           coalesce(sum(n) filter (where metric = 'comments'), 0)::bigint  as comments,
           coalesce(sum(n) filter (where metric = 'cred'), 0)::bigint      as cred,
           coalesce(sum(n) filter (where metric = 'uploads'), 0)::bigint   as uploads
      from cal left join daily on daily.day = cal.day
     group by cal.day
  ),
  series as (
    select jsonb_agg(jsonb_build_object(
             'd', day, 'views', views, 'likes', likes, 'bookmarks', bookmarks,
             'downloads', downloads, 'comments', comments, 'cred', cred,
             'uploads', uploads) order by day) as rows
      from per_day
  ),
  names (metric) as (values ('views'),('likes'),('bookmarks'),('downloads'),
                            ('comments'),('cred'),('uploads')),
  win as (
    select names.metric,
           coalesce(sum(d.n) filter (where d.day between v_from  and v_to),  0)::bigint as cur,
           coalesce(sum(d.n) filter (where d.day between v_pfrom and v_pto), 0)::bigint as prev
      from names left join daily d on d.metric = names.metric
     group by names.metric
  ),
  totals as (
    select
      (select count(*) from mine)::bigint as artworks,
      (select coalesce(sum(a.view_count), 0) from public.artworks a where a.user_id = v_me)::bigint as views_all,
      (select coalesce(sum(a.like_count), 0) from public.artworks a where a.user_id = v_me)::bigint as likes_all,
      (select coalesce(sum(a.bookmark_count), 0) from public.artworks a where a.user_id = v_me)::bigint as bookmarks_all,
      (select coalesce(sum(a.download_count), 0) from public.artworks a where a.user_id = v_me)::bigint as downloads_all,
      (select count(*) from public.profile_creds c
        where c.receiver_id = v_me)::bigint as cred_all
  ),
  peers as (
    select a.user_id, count(*)::bigint as n
      from public.artwork_view_dedup d
      join public.artworks a on a.id = d.artwork_id
     where d.day between v_from and v_to and a.user_id is not null
     group by a.user_id
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

create or replace function public.dz_analytics_content(p_days int default 30)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me   uuid := auth.uid();
  v_to   date := current_date;
  v_from date := current_date - (public.dz_an_days(p_days) - 1);
  v_out  jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  with mine as (
    select a.id, a.name, a.image_url, a.category, a.tags, a.software_list, a.software,
           a.medium, a.license, a.is_mature, a.status, a.visibility, a.featured,
           a.view_count, a.like_count, a.bookmark_count, a.download_count, a.created_at
      from public.artworks a
     where a.user_id = v_me
  ),
  g_views as (select d.artwork_id as id, count(*)::bigint as n
                from public.artwork_view_dedup d join mine m on m.id = d.artwork_id
               where d.day between v_from and v_to group by 1),
  g_dls as (select d.artwork_id as id, count(*)::bigint as n
              from public.artwork_download_dedup d join mine m on m.id = d.artwork_id
             where d.day between v_from and v_to group by 1),
  g_likes as (select l.artwork_id as id, count(*)::bigint as n
                from public.artwork_likes l join mine m on m.id = l.artwork_id
               where l.created_at::date between v_from and v_to group by 1),
  g_bms as (select b.artwork_id as id, count(*)::bigint as n
              from public.artwork_bookmarks b join mine m on m.id = b.artwork_id
             where b.created_at::date between v_from and v_to group by 1),
  g_cms as (select c.subject_id as id, count(*)::bigint as n
              from public.item_comments c join mine m on m.id = c.subject_id
             where c.kind = 'artwork' and c.user_id <> v_me
               and c.created_at::date between v_from and v_to group by 1),
  win as (
    select m.*,
           coalesce(gv.n, 0) as w_views,
           coalesce(gd.n, 0) as w_downloads,
           coalesce(gl.n, 0) as w_likes,
           coalesce(gb.n, 0) as w_bookmarks,
           coalesce(gc.n, 0) as w_comments
      from mine m
      left join g_views gv on gv.id = m.id
      left join g_dls   gd on gd.id = m.id
      left join g_likes gl on gl.id = m.id
      left join g_bms   gb on gb.id = m.id
      left join g_cms   gc on gc.id = m.id
  ),
  art_rows as (
    select jsonb_agg(x order by ord) as list from (
      select row_number() over (order by w_views desc, w_likes desc, created_at desc) as ord,
             jsonb_build_object(
               'id', id,
               'title', coalesce(nullif(btrim(name), ''), 'Untitled'),
               'thumb', image_url,
               'category', coalesce(category[1], 'others'),
               'created_at', created_at,
               'status', status, 'visibility', visibility,
               'featured', featured, 'mature', is_mature,
               'views', w_views, 'likes', w_likes, 'bookmarks', w_bookmarks,
               'downloads', w_downloads, 'comments', w_comments,
               'views_all', coalesce(view_count, 0),
               'likes_all', coalesce(like_count, 0),
               'bookmarks_all', coalesce(bookmark_count, 0),
               'downloads_all', coalesce(download_count, 0),
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
         where btrim(t) <> ''
         group by 1
         order by v desc, n desc
         limit 20
      ) s
  ),
  soft as (
    select jsonb_agg(jsonb_build_object('key', k, 'artworks', n, 'views', v)
                     order by v desc, n desc) as list
      from (
        select lower(btrim(s2)) as k, count(*)::bigint as n, sum(w.w_views)::bigint as v
          from win w,
               unnest(case
                 when coalesce(array_length(w.software_list, 1), 0) > 0 then w.software_list
                 when w.software is not null and btrim(w.software) <> '' then array[w.software]
                 else '{}'::text[] end) as s2
         where btrim(s2) <> ''
         group by 1
         order by v desc, n desc
         limit 12
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
      count(*) filter (where visibility <> 'published')::bigint as unlisted,
      count(*) filter (where status = 'approved')::bigint       as approved,
      count(*) filter (where license is not null)::bigint       as licensed,
      count(distinct medium) filter (where medium is not null)::bigint as mediums,
      coalesce(round(avg(coalesce(view_count, 0)), 1), 0)::numeric as avg_views,
      coalesce(round(avg(coalesce(like_count, 0)), 1), 0)::numeric as avg_likes,
      min(created_at) as first_upload,
      max(created_at) as last_upload
      from mine
  )
  select jsonb_build_object(
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

create or replace function public.dz_analytics_reach(p_days int default 30)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me   uuid := auth.uid();
  v_to   date := current_date;
  v_from date := current_date - (public.dz_an_days(p_days) - 1);
  v_out  jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  with mine as (select a.id from public.artworks a where a.user_id = v_me),
  ev as (
    select e.event, e.source, e.referrer_host, e.country, e.device, e.term, e.created_at
      from public.analytics_events e
     where e.owner_id = v_me and e.day between v_from and v_to
       and e.scope in ('artwork', 'profile')
  ),
  seen as (
    select d.viewer_key, count(distinct d.day)::int as days
      from public.artwork_view_dedup d join mine m on m.id = d.artwork_id
     where d.day between v_from and v_to
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
                   from public.artwork_view_dedup d join mine m on m.id = d.artwork_id
                  where d.day between v_from and v_to group by 1) s on s.ww = w
  ),
  fans as (
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(nullif(p.display_name, ''), p.username, 'Artist'),
             'handle', p.username, 'avatar', p.avatar_url, 'n', f.n) order by f.n desc) as list
      from (
        select uid, count(*)::bigint as n from (
          select l.user_id as uid from public.artwork_likes l join mine m on m.id = l.artwork_id
           where l.created_at::date between v_from and v_to
          union all
          select b.user_id from public.artwork_bookmarks b join mine m on m.id = b.artwork_id
           where b.created_at::date between v_from and v_to
          union all
          select c.user_id from public.item_comments c join mine m on m.id = c.subject_id
           where c.kind = 'artwork' and c.created_at::date between v_from and v_to
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

create or replace function public.dz_analytics_activity(p_days int default 30)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_me   uuid := auth.uid();
  v_days int  := public.dz_an_days(p_days);
  v_to   date := current_date;
  v_from date := current_date - (v_days - 1);
  v_out  jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'auth'); end if;

  update public.analytics_goals g
     set achieved_at = now()
   where g.user_id = v_me
     and g.achieved_at is null
     and public.dz_an_goal_progress(v_me, g.metric, g.period) >= g.target;

  with mine as (select a.id, a.created_at from public.artworks a where a.user_id = v_me),
  eng as (
    select
      (select count(*) from public.artwork_view_dedup d join mine m on m.id = d.artwork_id
        where d.day between v_from and v_to)::bigint as views,
      (select count(*) from public.artwork_likes l join mine m on m.id = l.artwork_id
        where l.created_at::date between v_from and v_to)::bigint as likes,
      (select count(*) from public.artwork_bookmarks b join mine m on m.id = b.artwork_id
        where b.created_at::date between v_from and v_to)::bigint as bookmarks,
      (select count(*) from public.item_comments c join mine m on m.id = c.subject_id
        where c.kind = 'artwork' and c.user_id <> v_me
          and c.created_at::date between v_from and v_to)::bigint as comments,
      (select count(*) from public.analytics_events e
        where e.owner_id = v_me and e.event = 'share'
          and e.day between v_from and v_to)::bigint as shares,
      (select count(*) from public.analytics_events e
        where e.owner_id = v_me and e.event = 'profile_view'
          and e.day between v_from and v_to)::bigint as profile_views
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
          from public.profile_creds c
         where c.receiver_id = v_me
         order by c.created_at desc limit 8
      ) c join public.profiles p on p.id = c.other
  ),
  goals as (
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'metric', g.metric, 'target', g.target, 'period', g.period,
             'progress', public.dz_an_goal_progress(v_me, g.metric, g.period),
             'achieved_at', g.achieved_at, 'created_at', g.created_at)
             order by g.created_at) as list
      from public.analytics_goals g where g.user_id = v_me
  ),
  feed as (
    select jsonb_agg(jsonb_build_object('event', event, 'at', at, 'title', title, 'artwork', aid)
                     order by at desc) as list
      from (
        select 'like'::text as event, l.created_at as at,
               coalesce(nullif(btrim(a.name), ''), 'Untitled') as title, a.id as aid
          from public.artwork_likes l join public.artworks a on a.id = l.artwork_id
         where a.user_id = v_me
        union all
        select 'bookmark', b.created_at, coalesce(nullif(btrim(a.name), ''), 'Untitled'), a.id
          from public.artwork_bookmarks b join public.artworks a on a.id = b.artwork_id
         where a.user_id = v_me
        union all
        select 'comment', c.created_at, coalesce(nullif(btrim(a.name), ''), 'Untitled'), a.id
          from public.item_comments c join public.artworks a on a.id = c.subject_id
         where c.kind = 'artwork' and a.user_id = v_me and c.user_id <> v_me
        order by at desc limit 12
      ) s
  )
  select jsonb_build_object(
    'range', jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to),
    'engagement', (select jsonb_build_object(
        'views', views, 'likes', likes, 'bookmarks', bookmarks, 'comments', comments,
        'shares', shares, 'profile_views', profile_views,
        'rate', case when views > 0
                     then round(((likes + bookmarks + comments + shares)::numeric / views) * 100, 1)
                     else 0 end,
        'like_rate',    case when views > 0 then round((likes::numeric / views) * 100, 1) else 0 end,
        'save_rate',    case when views > 0 then round((bookmarks::numeric / views) * 100, 1) else 0 end,
        'comment_rate', case when views > 0 then round((comments::numeric / views) * 100, 1) else 0 end
      ) from eng),
    'activity', coalesce((select list from feed), '[]'::jsonb),
    'cred', jsonb_build_object(
      'total',   (select count(*) from public.profile_creds c where c.receiver_id = v_me),
      'gained',  (select count(*) from public.profile_creds c
                   where c.receiver_id = v_me and c.created_at::date between v_from and v_to),
      'given',   (select count(*) from public.profile_creds c where c.giver_id = v_me),
      'givers',  (select count(distinct c.giver_id) from public.profile_creds c where c.receiver_id = v_me),
      'counted', (select coalesce(cred_received_count, 0) from public.profiles where id = v_me),
      'series',  coalesce((select list from cseries), '[]'::jsonb),
      'recent',  coalesce((select list from recent_cred), '[]'::jsonb)
    ),
    'community', jsonb_build_object(
      'owned',  (select count(*) from public.communities c where c.owner_id = v_me),
      'joined', (select count(*) from public.community_members cm
                  where cm.user_id = v_me and coalesce(cm.banned, false) = false),
      'messages', (select count(*) from public.comments c
                    where c.user_id = v_me and c.created_at::date between v_from and v_to),
      'dms', (select count(*) from public.direct_messages d
               where d.sender_id = v_me and d.created_at::date between v_from and v_to),
      'comments_made', (select count(*) from public.item_comments c
                         where c.user_id = v_me and c.created_at::date between v_from and v_to),
      'comments_received', (select comments from eng),
      'cred_given', (select count(*) from public.profile_creds c where c.giver_id = v_me),
      'friends', (select count(*) from public.friendships f
                   where f.status = 'accepted' and (f.requester_id = v_me or f.addressee_id = v_me)),
      'merit', (select coalesce(merit, 100) from public.profiles where id = v_me)
    ),
    'goals',        coalesce((select list from goals), '[]'::jsonb),
    'achievements', public.dz_an_achievements(v_me)
  ) into v_out;

  return coalesce(v_out, '{}'::jsonb);
end $$;

grant execute on function public.dz_analytics_overview(int) to authenticated;
grant execute on function public.dz_analytics_content(int)  to authenticated;
grant execute on function public.dz_analytics_reach(int)    to authenticated;
grant execute on function public.dz_analytics_activity(int) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'analytics_events'
  ) then
    alter publication supabase_realtime add table public.analytics_events;
  end if;
exception when undefined_object then
  null;
end $$;
