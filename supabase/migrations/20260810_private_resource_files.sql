alter table public.resources
  add column if not exists file_storage_bucket text;

alter table public.resources
  alter column file_url drop not null;

create or replace function public.dz_resource_file_grant(
  p_resource uuid,
  p_ip       text default null
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
  v_r      record;
  v_day    timestamptz := date_trunc('day', now());
  v_own    boolean;
begin
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

  select user_id, status, visibility, file_storage_bucket, file_storage_path,
         file_url, file_name, file_ext
    into v_r
    from public.resources where id = p_resource;

  if v_r.user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  v_own := v_r.user_id = v_uid;

  if not v_own and (v_r.status is distinct from 'approved'
                    or v_r.visibility is distinct from 'published') then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  if not v_own then
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
    values (v_key, 'resource', p_resource);

    update public.resources
       set download_count = coalesce(download_count, 0) + 1
     where id = p_resource;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'own', v_own,
    'bucket', v_r.file_storage_bucket,
    'path',   v_r.file_storage_path,
    'legacy_url', v_r.file_url,
    'filename', coalesce(v_r.file_name, 'resource.' || coalesce(v_r.file_ext, 'bin')),
    'limit', v_limit,
    'tier', v_tier,
    'remaining', case when v_own then null else greatest(v_limit - v_used - 1, 0) end,
    'resets_at', v_day + interval '1 day'
  );
end $function$;

revoke all on function public.dz_resource_file_grant(uuid, text) from public;
grant execute on function public.dz_resource_file_grant(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='resources' and policyname='resources_no_client_counter'
  ) then
    null;
  end if;
end $$;
