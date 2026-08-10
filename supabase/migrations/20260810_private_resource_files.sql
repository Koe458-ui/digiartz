-- Resource packages stop being public objects
--
-- The daily download budget reached resources one migration ago, but it capped
-- the button rather than the bytes: resources.file_url was a public storage url
-- printed into the page, so anyone who copied it could pull the file as often
-- as they liked and never touch the counter. A brush pack is the largest file
-- on the site, so that was the one hole worth closing.
--
-- This is the treatment artworks and sold marketplace files already have. The
-- object goes to the private bucket, the row keeps a bucket and a path instead
-- of a url, and the only route to the bytes is functions/api/resource-download,
-- which spends a unit of the caller's quota, signs a short-lived GET with the
-- service role, and streams the response from our own origin. The browser never
-- receives a url of any kind, so there is nothing to copy and nothing to share.
--
-- This is a good moment for it: public.resources has no rows, so no published
-- package is being taken away from anyone and no link that ever worked stops
-- working. Rows written before this — there are none, and this is written so
-- that if any appear from a backup they still work — keep their file_url and
-- are served through the same endpoint, so every downloader's path is one path.

alter table public.resources
  add column if not exists file_storage_bucket text;

-- The url is what a resource no longer has. Existing rows keep whatever they
-- have; new ones write a bucket and a path and leave this null.
alter table public.resources
  alter column file_url drop not null;

-- ---- the grant -----------------------------------------------------------
-- Runs AS THE CALLER, so auth.uid() is the downloader and no header the
-- browser sends can talk it out of the answer. Same order of checks as
-- dz_request_download and dz_request_item_download: refuse the cheap way
-- first, never charge someone for their own upload, mirror the read policy of
-- the table, then take a unit under a per viewer lock.
--
-- It returns a storage location, never a url. The endpoint signs what it is
-- handed; it does not get a say in what it may sign.
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

  -- a draft or a hidden resource is still the uploader's own to fetch
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

    -- the count on the card is what other people took, not what the uploader
    -- fetched back
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

-- download_count is maintained by the grant above now, which runs as a definer
-- and is the only writer that should ever touch it. Nothing else did, and this
-- says so rather than leaving the column open to a client update.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='resources' and policyname='resources_no_client_counter'
  ) then
    -- no policy is added: resources' own update policy already limits a member
    -- to their own rows, and a member inflating the count on their own resource
    -- is not a threat worth a trigger. Noted here so the next reader does not
    -- go looking for one.
    null;
  end if;
end $$;
