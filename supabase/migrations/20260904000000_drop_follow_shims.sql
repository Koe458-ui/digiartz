-- The transition shims come out.
--
-- 20260903000000_follows.sql renamed profile_creds to follows and
-- cred_received_count to follower_count, and left both old names answering so
-- that a visitor still carrying the pre-follow bundle would keep working
-- through the changeover: PostgREST answers an unknown column with a 400, and
-- the old profile page treats that as fatal and closes itself.
--
-- That overlap is over. The service worker is network-first for navigations
-- and /sw.js is served no-cache, so any online visit since the deploy has
-- already taken the new bundle, and nothing in the database refers to either
-- name any more -- not a function, view, index, constraint, policy or trigger.
--
-- Putting them back, should that ever be needed, is the two statements this
-- file removes; they are in 20260903000000_follows.sql under "transition
-- shims".

drop view if exists public.profile_creds;

alter table public.profiles drop column if exists cred_received_count;
