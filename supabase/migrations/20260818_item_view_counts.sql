create or replace function public.dz_write_rate()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
declare
  v_uid  uuid := auth.uid();
  v_noun text := coalesce(nullif(TG_ARGV[0], ''), 'requests');
  v_max  int  := coalesce(nullif(TG_ARGV[1], '')::int, 30);
  v_win  int  := coalesce(nullif(TG_ARGV[2], '')::int, 3600);
begin
  if v_uid is null then return new; end if;

  if coalesce(current_setting('app.allow_view_count_write', true), '') = '1'
     or coalesce(current_setting('app.allow_download_count_write', true), '') = '1'
     or coalesce(current_setting('app.allow_like_count_write', true), '') = '1'
     or coalesce(current_setting('app.allow_bookmark_count_write', true), '') = '1' then
    return new;
  end if;

  if not public.dz_rate_ok(
       TG_TABLE_NAME || ':' || TG_OP || ':' || v_uid::text, v_max, v_win) then
    raise exception 'Too many % in a short time — wait a moment and try again', v_noun
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.protect_artwork_like_count()
returns trigger language plpgsql security definer
set search_path to 'public' as $$
declare v_counter boolean := false;
begin
  if coalesce(current_setting('app.allow_like_count_write', true), '') <> '1' then
    if TG_OP = 'INSERT' then NEW.like_count := 0; else NEW.like_count := OLD.like_count; end if;
  else v_counter := true; end if;

  if coalesce(current_setting('app.allow_view_count_write', true), '') <> '1' then
    if TG_OP = 'INSERT' then NEW.view_count := 0; else NEW.view_count := OLD.view_count; end if;
  else v_counter := true; end if;

  if coalesce(current_setting('app.allow_bookmark_count_write', true), '') <> '1' then
    if TG_OP = 'INSERT' then NEW.bookmark_count := 0; else NEW.bookmark_count := OLD.bookmark_count; end if;
  else v_counter := true; end if;

  if coalesce(current_setting('app.allow_download_count_write', true), '') <> '1' then
    if TG_OP = 'INSERT' then NEW.download_count := 0; else NEW.download_count := OLD.download_count; end if;
  else v_counter := true; end if;

  if v_counter and TG_OP = 'UPDATE' then
    NEW.updated_at := OLD.updated_at;
  end if;

  return NEW;
end $$;

create or replace function public.dz_protect_item_view_count()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
begin
  if coalesce(current_setting('app.allow_view_count_write', true), '') <> '1' then
    if TG_OP = 'INSERT' then NEW.view_count := 0; else NEW.view_count := OLD.view_count; end if;
  elsif TG_OP = 'UPDATE' then
    NEW.updated_at := OLD.updated_at;
  end if;
  return NEW;
end $$;

drop trigger if exists zz_protect_view_count on public.marketplace_items;
create trigger zz_protect_view_count before insert or update on public.marketplace_items
  for each row execute function public.dz_protect_item_view_count();

drop trigger if exists zz_protect_view_count on public.blog_posts;
create trigger zz_protect_view_count before insert or update on public.blog_posts
  for each row execute function public.dz_protect_item_view_count();

drop trigger if exists zz_protect_view_count on public.resources;
create trigger zz_protect_view_count before insert or update on public.resources
  for each row execute function public.dz_protect_item_view_count();

create or replace function public.dz_bounds_on_change()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp' as $$
declare
  i int; col text; lo int; hi int; nullable boolean; newv text; oldv text;
begin
  i := 0;
  while i < TG_NARGS loop
    col      := TG_ARGV[i];
    lo       := TG_ARGV[i + 1]::int;
    hi       := TG_ARGV[i + 2]::int;
    nullable := TG_ARGV[i + 3] = 'null-ok';

    execute format('select ($1).%I::text', col) into newv using NEW;
    if TG_OP = 'UPDATE' then
      execute format('select ($1).%I::text', col) into oldv using OLD;
    else
      oldv := null;
    end if;

    if TG_OP = 'INSERT' or newv is distinct from oldv then
      if newv is null then
        if not nullable then
          raise exception '% is required', col using errcode = '23514';
        end if;
      elsif char_length(btrim(newv)) < lo or char_length(btrim(newv)) > hi then
        raise exception '% must be between % and % characters', col, lo, hi
          using errcode = '23514';
      end if;
    end if;

    i := i + 4;
  end loop;
  return NEW;
end $$;

create or replace function public.dz_range_on_change()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp' as $$
declare
  i int; col text; lo bigint; hi bigint; nullable boolean;
  newv numeric; oldv numeric;
begin
  i := 0;
  while i < TG_NARGS loop
    col := TG_ARGV[i]; lo := TG_ARGV[i+1]::bigint; hi := TG_ARGV[i+2]::bigint;
    nullable := TG_ARGV[i+3] = 'null-ok';

    execute format('select ($1).%I::numeric', col) into newv using NEW;
    if TG_OP = 'UPDATE' then
      execute format('select ($1).%I::numeric', col) into oldv using OLD;
    else oldv := null; end if;

    if TG_OP = 'INSERT' or newv is distinct from oldv then
      if newv is null then
        if not nullable then raise exception '% is required', col using errcode = '23514'; end if;
      elsif newv < lo or newv > hi then
        raise exception '% must be between % and %', col, lo, hi using errcode = '23514';
      end if;
    end if;
    i := i + 4;
  end loop;
  return NEW;
end $$;

alter table public.blog_posts drop constraint if exists blog_body_len;
alter table public.blog_posts drop constraint if exists blog_excerpt_len;
alter table public.blog_posts drop constraint if exists blog_title_len;

drop trigger if exists dz_bounds_blog_posts on public.blog_posts;
create trigger dz_bounds_blog_posts before insert or update on public.blog_posts
  for each row execute function public.dz_bounds_on_change(
    'body', '100', '20000', 'required',
    'excerpt', '20', '300', 'null-ok',
    'title', '5', '120', 'required');

alter table public.marketplace_items drop constraint if exists mk_description_len;
alter table public.marketplace_items drop constraint if exists mk_title_len;

drop trigger if exists dz_bounds_marketplace_items on public.marketplace_items;
create trigger dz_bounds_marketplace_items before insert or update on public.marketplace_items
  for each row execute function public.dz_bounds_on_change(
    'description', '100', '5000', 'null-ok',
    'title', '3', '100', 'required');

alter table public.resources drop constraint if exists res_description_len;
alter table public.resources drop constraint if exists res_title_len;
alter table public.resources drop constraint if exists res_file_size_rng;

drop trigger if exists dz_bounds_resources on public.resources;
create trigger dz_bounds_resources before insert or update on public.resources
  for each row execute function public.dz_bounds_on_change(
    'description', '50', '5000', 'null-ok',
    'title', '3', '100', 'required');

drop trigger if exists dz_range_resources on public.resources;
create trigger dz_range_resources before insert or update on public.resources
  for each row execute function public.dz_range_on_change(
    'file_size', '0', '209715200', 'required');

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

  if not found then return; end if;

  if auth.uid() is null or auth.uid() <> v_owner then
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

  begin
    perform set_config('app.allow_view_count_write', '1', true);
    if p_kind = 'marketplace' then
      update public.marketplace_items set view_count = coalesce(view_count, 0) + 1
       where id = p_subject;
    elsif p_kind = 'blog' then
      update public.blog_posts set view_count = coalesce(view_count, 0) + 1
       where id = p_subject;
    else
      update public.resources set view_count = coalesce(view_count, 0) + 1
       where id = p_subject;
    end if;
    perform set_config('app.allow_view_count_write', '0', true);
  exception when others then
    perform set_config('app.allow_view_count_write', '0', true);
  end;
end $$;

grant execute on function public.register_item_view(text,uuid,text,text,text,text,text) to anon, authenticated;

do $$
begin
  perform set_config('app.allow_view_count_write', '1', true);

  update public.marketplace_items m set view_count = coalesce(v.n, 0)
    from (select subject_id, count(*)::bigint n from public.item_view_dedup
           where kind = 'marketplace' group by 1) v
   where v.subject_id = m.id and m.view_count is distinct from v.n;

  update public.blog_posts b set view_count = coalesce(v.n, 0)
    from (select subject_id, count(*)::bigint n from public.item_view_dedup
           where kind = 'blog' group by 1) v
   where v.subject_id = b.id and b.view_count is distinct from v.n;

  update public.resources r set view_count = coalesce(v.n, 0)
    from (select subject_id, count(*)::bigint n from public.item_view_dedup
           where kind = 'resource' group by 1) v
   where v.subject_id = r.id and r.view_count is distinct from v.n;

  perform set_config('app.allow_view_count_write', '0', true);
end $$;
