-- Round 4 — a private community's join code was readable by everyone.
--
-- cm_join(name, code) is the whole gate on a private community: match the name,
-- match the code, you are a member, and can_read_community() then opens every
-- post in it. Both halves of that secret sat behind `communities_read`, which
-- was `USING (true)` for anon and authenticated alike, and `join_code` was in
-- the SELECT grant for both roles. One request —
--
--   GET /rest/v1/communities?select=name,join_code&is_public=is.false
--
-- with the publishable key that ships in config.js — returned the key to every
-- private room on the site, to a caller who was not signed in.
--
-- Two changes, because either alone leaves a way round:
--
--   1. The read policy stops being `true`. A community row is visible to the
--      people it is for: anyone, if it is public; its owner; its members. That
--      alone stops a private room's code from being read, because the row
--      carrying it is no longer selectable.
--
--   2. `join_code` leaves anon's grant entirely. A signed-out visitor has no
--      management screen and never needed the column; taking it away means the
--      code is unreachable for that role even if a future policy widens again.
--
-- What still works, checked against the callers in js/:
--   * cm_browse(), cm_state(), can_read_community() and cm_join() are all
--     SECURITY DEFINER and do not read through this policy at all.
--   * js/mywork.js reads communities two ways — embedded under the caller's own
--     community_members rows, and by id for a room they manage. Both are rooms
--     they are a member of, so both still resolve.

alter table public.communities enable row level security;

drop policy if exists communities_read on public.communities;

-- The membership test goes through can_read_community(), not through an
-- inline subquery. A policy expression is evaluated as the CALLING role, and
-- anon holds no SELECT on community_members (correctly) -- an inline
-- `exists (select 1 from community_members ...)` therefore raised "permission
-- denied for table community_members" on every anon read of this table, which
-- emptied the signed-out community page. The first version of this migration
-- did exactly that and the regression probe caught it. can_read_community() is
-- SECURITY DEFINER and is what the comments policy already uses for the same
-- question, so the lookup happens as its owner and the caller needs no grant.
-- The owner term stays inline: it reads communities, which the caller can see.
create policy communities_read
  on public.communities
  for select
  to anon, authenticated
  using (
    is_public
    or owner_id = auth.uid()
    or public.can_read_community(id)
  );

revoke select (join_code) on public.communities from anon;

-- Correction, applied as its own migration on production: the REVOKE above
-- returned success and changed nothing. anon held table-level SELECT
-- (`anon=r/postgres` in relacl), and a column-level REVOKE cannot carve a hole
-- in a table-level grant — the same shape of silent no-op Round 3b hit. The
-- grant has to be dropped and re-issued column by column.
revoke select on public.communities from anon;

grant select (
  id, name, description, avatar_url, banner_url, rules, owner_id,
  created_at, short_description, is_public, avatar_storage_path, plan_backed
) on public.communities to anon;
