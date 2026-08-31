-- Round 4 cleanup — four SELECT policies that granted nothing the policy
-- beside them did not already grant.
--
-- This is the same hazard the comics finding earlier in this round turned out
-- to be, caught before it costs anything rather than after. Policies for one
-- command are OR-ed, so a table carrying several of them is decided by the
-- most permissive, and a reviewer reading the narrow-looking one comes away
-- with the wrong idea of what the table allows. public.comics had exactly that
-- shape: a sensible `status = 'approved'` policy for anon sitting next to a
-- `USING (true)` for everyone, and the second one decided every read.
--
-- Nothing here changes a single answer the API gives. Each dropped policy is a
-- strict subset of one that stays, which is checked below rather than asserted:
--
--   public.artworks
--     dropped  artworks_anon_read  {anon}    USING (status = 'approved')
--     kept     public read approved {PUBLIC} USING (status = 'approved'
--                                                    OR user_id = auth.uid())
--     PUBLIC covers anon, and for a signed-out caller auth.uid() is NULL, so
--     the kept policy reduces to exactly the dropped one's predicate.
--
--   public.profiles  (four policies, three of them plain `true`)
--     dropped  profiles public read   {PUBLIC}              USING (true)
--     dropped  profiles_anon_read     {anon}                USING (true)
--     dropped  profiles_select_own    {PUBLIC}              USING (auth.uid() = id)
--     kept     profiles_select_public {anon, authenticated} USING (true)
--     Three ways of saying `true` and one that says "your own row", which is a
--     subset of `true`. The survivor is the one that names its roles instead of
--     relying on PUBLIC, so the grant is now visible in the policy rather than
--     inferred. Dropping the PUBLIC one also narrows it: service_role and
--     postgres bypass RLS anyway and never needed a policy.
--
-- Profiles stay world-readable on purpose — usernames, bios and avatars are the
-- public face of the site. What keeps that honest is the COLUMN grant layer, not
-- these policies: email, currency, max_claimed and partner_since are not
-- selectable by anon or authenticated at all (20260830_least_privilege.sql).
--
-- Left alone deliberately: the two INSERT policies on public.comments. They look
-- like a duplicate pair and are not — one covers `channel <> 'official'`, the
-- other `channel = 'official' AND is_dev()`. The cases are disjoint, so both
-- are load-bearing and dropping either would remove a capability.

drop policy if exists artworks_anon_read     on public.artworks;

drop policy if exists "profiles public read" on public.profiles;
drop policy if exists profiles_anon_read     on public.profiles;
drop policy if exists profiles_select_own    on public.profiles;
