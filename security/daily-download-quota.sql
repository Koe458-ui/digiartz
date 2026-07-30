-- daily download quota per subscription tier
--
-- already applied to the live project. kept here as the record of what runs
-- server-side behind /api/download, and so it can be replayed on a fresh
-- database.
--
--   free / normal : 5  downloads per day
--   lite          : 10
--   premium       : 15
--   max           : 20
--   dev           : effectively unlimited (staff)
--
-- the window is a UTC calendar day: everything counted since
-- date_trunc('day', now()), resetting at 00:00 UTC.
--
-- signing in is required. an anonymous viewer key lives in the browser and can
-- be wiped at will, so a guest cap is not enforceable — dz_request_download
-- answers reason='auth' when there is no session and the viewer shows the
-- sign-in prompt.
--
-- roll back:
--   drop function if exists public.dz_download_quota();
--   drop function if exists public.dz_download_limit(text);
--   -- then restore the previous monthly dz_request_download

create or replace function public.dz_download_limit(p_tier text)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case lower(coalesce(p_tier, 'guest'))
    when 'dev'     then 100000   -- staff, effectively unlimited
    when 'max'     then 20
    when 'premium' then 15
    when 'lite'    then 10
    else 5                       -- signed-in free user
  end;
$$;

-- spends one unit of today's quota and reports what is left.
-- every granted download is a row in download_events; there is no path that
-- hands out bytes without one.
create or replace function public.dz_request_download(p_artwork uuid, p_anon_key text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_key    text;
  v_tier   text;
  v_limit  int;
  v_used   int;
  v_full   boolean;
  v_owner  uuid;
  v_status text;
  v_day    timestamptz := date_trunc('day', now());
begin
  select user_id, status into v_owner, v_status
    from public.artworks where id = p_artwork;
  if v_owner is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  if v_uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'auth');
  end if;

  -- your own artwork never costs quota
  if v_owner = v_uid then
    return jsonb_build_object('allowed', true, 'full', true, 'own', true);
  end if;

  -- mirrors the read policy on artworks
  if v_status is distinct from 'approved' then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  v_key   := 'u:' || v_uid::text;
  v_tier  := coalesce(public.dz_effective_tier(v_uid), 'guest');
  v_limit := public.dz_download_limit(v_tier);
  v_full  := v_tier in ('premium', 'max', 'dev');

  -- serialise per viewer so parallel clicks cannot both slip past the check
  perform pg_advisory_xact_lock(hashtext(v_key));

  select count(*) into v_used from public.download_events
   where viewer_key = v_key
     and created_at >= v_day;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit',
                              'limit', v_limit, 'used', v_used, 'remaining', 0,
                              'tier', v_tier, 'resets_at', v_day + interval '1 day');
  end if;

  insert into public.download_events (viewer_key, artwork_id)
  values (v_key, p_artwork);

  return jsonb_build_object('allowed', true, 'full', v_full,
                            'used', v_used + 1,
                            'remaining', v_limit - v_used - 1,
                            'limit', v_limit, 'tier', v_tier,
                            'resets_at', v_day + interval '1 day');
end $$;

-- read-only view of the same numbers, so the viewer can print
-- "3 of 5 downloads left today" without spending one
create or replace function public.dz_download_quota()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid   uuid := auth.uid();
  v_tier  text;
  v_limit int;
  v_used  int;
  v_day   timestamptz := date_trunc('day', now());
begin
  if v_uid is null then
    return jsonb_build_object('signed_in', false);
  end if;
  v_tier  := coalesce(public.dz_effective_tier(v_uid), 'guest');
  v_limit := public.dz_download_limit(v_tier);
  select count(*) into v_used from public.download_events
   where viewer_key = 'u:' || v_uid::text
     and created_at >= v_day;
  return jsonb_build_object('signed_in', true, 'tier', v_tier,
                            'limit', v_limit, 'used', v_used,
                            'remaining', greatest(v_limit - v_used, 0),
                            'resets_at', v_day + interval '1 day');
end $$;

-- anon may call both: they answer reason='auth' / signed_in=false instead of
-- raising a permission error, which is what the viewer needs to prompt a login
grant execute on function public.dz_request_download(uuid, text) to anon, authenticated;
grant execute on function public.dz_download_quota()            to anon, authenticated;
grant execute on function public.dz_download_limit(text)        to anon, authenticated;

-- the existing (viewer_key, created_at) index already serves the daily count
-- create index if not exists download_events_month_idx
--   on public.download_events (viewer_key, created_at);
