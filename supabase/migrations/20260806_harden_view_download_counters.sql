-- WHAT THIS FILE STILL DOES: it creates dz_client_ip() and locks it down. The
-- two counter rewrites the note below describes were superseded by
-- 20260816_analytics.sql before this file was ever committed, and the comment
-- at the foot of the file explains why replaying them here would be a
-- regression rather than a no-op. The history is kept because it is the reason
-- dz_client_ip() exists at all.
--
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


-- ---------------------------------------------------------------------------
-- The two counter bodies that used to live here have been dropped from this
-- file, deliberately, and this is the one place that says why.
--
-- They redefined register_artwork_view/register_artwork_download on their
-- ORIGINAL two-argument signature (p_artwork, p_anon_key).
-- 20260816_analytics.sql later replaced both with six-argument versions that
-- also take p_source, p_ref, p_device and p_country, and that is what the
-- live database has. Replaying the two-argument bodies here would not replace
-- those -- a different argument list is a different function -- it would add a
-- second overload alongside them.
--
-- That is not cosmetic. js/engagement.js calls these through withDims(), and
-- dims() returns {} whenever js/analytics.js has not loaded yet, so a real
-- cold-start call arrives with exactly p_artwork and p_anon_key. Today it
-- resolves to the six-argument function through its defaults and the view is
-- counted with its dimensions null. With a two-argument overload present it
-- would bind to that instead and silently stop recording dimensions.
--
-- What this file still has to carry is dz_client_ip() above.
-- 20260816_analytics.sql, 20260817 and 20260818 all call it and none of them
-- create it -- it reached the database by hand and its definition was never
-- committed, so rebuilding from supabase/migrations/ alone failed at 20260816
-- until this file landed. The server-side IP derivation and the rate limiting
-- described at the top are in force through those later definitions.
-- ---------------------------------------------------------------------------
