alter table public.download_events
  add column if not exists kind       text not null default 'artwork',
  add column if not exists subject_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'download_events_kind_ck') then
    alter table public.download_events
      add constraint download_events_kind_ck
      check (kind in ('artwork','resource','blog'));
  end if;
end $$;

create index if not exists download_events_viewer_day_idx
  on public.download_events (viewer_key, created_at desc);

create or replace function public.dz_request_item_download(
  p_kind text,
  p_id   uuid,
  p_ip   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_key    text;
  v_tier   text;
  v_limit  int;
  v_used   int;
  v_owner  uuid;
  v_status text;
  v_vis    text;
  v_day    timestamptz := date_trunc('day', now());
begin
  if p_kind not in ('resource','blog') then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'auth');
  end if;

  if not public.dz_rate_ok('dl:u:' || v_uid::text, 30, 60) then
    return jsonb_build_object('allowed', false, 'reason', 'rate', 'retry_after', 60);
  end if;
  if p_ip is not null and p_ip <> ''
     and not public.dz_rate_ok('dl:ip:' || left(p_ip, 64), 60, 60) then
    return jsonb_build_object('allowed', false, 'reason', 'rate', 'retry_after', 60);
  end if;

  if p_kind = 'resource' then
    select user_id, status, visibility into v_owner, v_status, v_vis
      from public.resources where id = p_id;
  else
    select user_id, status, visibility into v_owner, v_status, v_vis
      from public.blog_posts where id = p_id;
  end if;

  if v_owner is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  if v_owner = v_uid then
    return jsonb_build_object('allowed', true, 'own', true);
  end if;

  if v_status is distinct from 'approved' or v_vis is distinct from 'published' then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  v_key   := 'u:' || v_uid::text;
  v_tier  := coalesce(public.dz_effective_tier(v_uid), 'guest');
  v_limit := public.dz_download_limit(v_tier);

  perform pg_advisory_xact_lock(hashtext(v_key));

  select count(*) into v_used from public.download_events
   where viewer_key = v_key
     and created_at >= v_day;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit',
                              'limit', v_limit, 'used', v_used, 'remaining', 0,
                              'tier', v_tier, 'resets_at', v_day + interval '1 day');
  end if;

  insert into public.download_events (viewer_key, kind, subject_id)
  values (v_key, p_kind, p_id);

  return jsonb_build_object('allowed', true,
                            'used', v_used + 1,
                            'remaining', v_limit - v_used - 1,
                            'limit', v_limit, 'tier', v_tier,
                            'resets_at', v_day + interval '1 day');
end $function$;

revoke all on function public.dz_request_item_download(text, uuid, text) from public;
grant execute on function public.dz_request_item_download(text, uuid, text) to authenticated;
