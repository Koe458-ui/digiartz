-- Browsing every community, biggest first
--
-- Until now the only way to find a community you were not already in was to be
-- handed its name and its six-character join ID by somebody who was. There was
-- no list. communities has always been world-readable — communities_read is
-- `using (true)` — so the names and descriptions were never secret; there was
-- simply nothing that showed them.
--
-- This is that list, and it is one function rather than a query the client
-- assembles, for two reasons. The ranking is by member count, which means a
-- join and a group-by that a PostgREST select cannot order by. And the count
-- has to skip banned rows, which is a rule about what a member count means,
-- not a filter the caller should be trusted to remember.
--
-- What it does NOT do is widen anything. A private community appears in the
-- list because its row was already readable; joining it still needs its name
-- and join ID through cm_join, and reading its messages still needs
-- membership. The list tells you a place exists. It does not let you in.

create or replace function public.cm_browse(
  p_q text default null, p_limit int default 30, p_offset int default 0
) returns table (
  id                uuid,
  name              text,
  short_description text,
  description       text,
  avatar_url        text,
  is_public         boolean,
  members           bigint,
  joined            boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id,
         c.name,
         c.short_description,
         c.description,
         c.avatar_url,
         c.is_public,
         count(m.user_id) filter (where m.banned = false) as members,
         bool_or(m.user_id = auth.uid() and m.banned = false) as joined
    from public.communities c
    left join public.community_members m on m.community_id = c.id
   where p_q is null
      or btrim(p_q) = ''
      or c.name ilike '%' || replace(replace(btrim(p_q), '%', '\%'), '_', '\_') || '%'
      or coalesce(c.short_description, '') ilike '%' || replace(replace(btrim(p_q), '%', '\%'), '_', '\_') || '%'
   group by c.id
   -- biggest first, and a stable tiebreak so paging cannot repeat or skip a
   -- row when two communities are the same size
   order by count(m.user_id) filter (where m.banned = false) desc, c.name asc, c.id asc
   limit greatest(1, least(coalesce(p_limit, 30), 50))
  offset greatest(0, coalesce(p_offset, 0))
$$;
