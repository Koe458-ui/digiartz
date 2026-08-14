-- Anonymous view and download counting trusted a client-supplied p_anon_key as
-- the dedup identity. The value was only shape-checked (16-64 chars, drawn from
-- [A-Za-z0-9-]) and never bound to the caller, so a script minting a fresh key
-- per request could raise artworks.view_count and download_count without limit.
-- Both feed rank_scores(), so the leaderboards were writable by anyone.
--
-- Two changes here:
--
--   1. The anonymous dedup key is derived server-side from the forwarded
--      request IP. PostgREST publishes the request headers as the
--      request.headers GUC, the same mechanism that already carries
--      request.jwt.claims for dz_is_privileged(). The caller no longer picks
--      its own identity.
--
--   2. Both functions now go through dz_rate_ok. They never did -- there was no
--      vw: bucket in rate_hits at all, while the money and download paths have
--      been rate limited all along.
--
-- The signatures are unchanged, so the existing js/engagement.js keeps working
-- with no deploy. p_anon_key survives only as the identity of last resort for
-- the case where no forwarded IP is visible, and that whole path shares one
-- capped bucket rather than trusting the key.
--
-- Trade-off worth knowing: keying anonymous viewers on IP means a household
-- behind one NAT, an office, or a mobile carrier CGNAT range counts once per
-- artwork per day. Counts get more conservative than they were. They also stop
-- being forgeable, which is the point.
--
-- Both functions also now require status = 'approved' before counting, matching
-- the gate dz_request_download already applies, so traffic to pending or
-- rejected work no longer moves a public counter.

-- Reads the caller's IP from the forwarded headers. Returns NULL when nothing
-- trustworthy is present -- callers must treat NULL as "no identity", never as
-- a value to key on. Deliberately tolerant: an absent or malformed
-- request.headers must not raise inside a fire-and-forget counter.
create or replace function public.dz_client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text;
  v_hdr json;
  v_ip  text;
begin
  v_raw := nullif(current_setting('request.headers', true), '');
  if v_raw is null then
    return null;
  end if;

  begin
    v_hdr := v_raw::json;
  exception when others then
    return null;
  end;

  -- x-forwarded-for is a list; the client is the first entry
  v_ip := coalesce(
    nullif(btrim(coalesce(v_hdr ->> 'cf-connecting-ip', '')), ''),
    nullif(btrim(coalesce(v_hdr ->> 'true-client-ip',  '')), ''),
    nullif(btrim(coalesce(v_hdr ->> 'x-real-ip',       '')), ''),
    nullif(btrim(split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1)), '')
  );

  return left(v_ip, 64);
end
$$;

-- internal only: nothing outside these counters should be resolving caller IPs
revoke all on function public.dz_client_ip() from public;
revoke all on function public.dz_client_ip() from anon;
revoke all on function public.dz_client_ip() from authenticated;


create or replace function public.register_artwork_view(p_artwork uuid, p_anon_key text default null::text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_ip  text;
begin
  if not exists (
    select 1 from public.artworks
     where id = p_artwork and status = 'approved'
  ) then
    return;
  end if;

  if auth.uid() is not null then
    -- the session is the identity, there is nothing here to forge
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
      -- hashed so the dedup table does not become a log of visitor IPs
      v_key := 'a:' || md5('dzview|' || v_ip);
    else
      -- No forwarded IP to trust. Keep counting rather than going silent, but
      -- the caller chooses its own key on this path, so cap the path as a whole
      -- instead of per key -- a per-key limit is meaningless when the attacker
      -- picks the key.
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
  end if;
end
$$;


create or replace function public.register_artwork_download(p_artwork uuid, p_anon_key text default null::text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_ip  text;
begin
  if not exists (
    select 1 from public.artworks
     where id = p_artwork and status = 'approved'
  ) then
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
  end if;
end
$$;
