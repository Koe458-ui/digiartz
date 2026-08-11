-- No links anywhere in a community, and browsing lists only public ones
--
-- TWO SETTINGS THAT SHOULD NEVER HAVE BEEN SETTINGS.
--
-- links_allowed let an owner switch link posting on for their community, and
-- enforce_community_links only refused a link when the flag was explicitly
-- false — so a community created before the column existed, or with the flag
-- left null, allowed every link anyone cared to post. That is the wrong
-- default for the wrong feature: a text-only room on an art site has no use
-- for a link, and "who may post links here" is not a decision worth handing to
-- whoever happened to create the room. Links are refused everywhere now, with
-- no way to turn that off, and the column that carried the choice goes with
-- the choice.
--
-- Nothing else read it: cpSaveComment already understood CM_NO_LINKS and the
-- direct-message side has always refused links outright, through dm_no_links.
-- The rule is now the same in both places.
--
-- BROWSING LISTS PUBLIC COMMUNITIES ONLY. cm_browse listed everything, on the
-- reasoning that communities is world-readable anyway. That is true and it is
-- still the wrong list: a private community is private, and putting its name
-- and its member count in a public directory tells anyone who looks that it
-- exists and how big it is. Being unlisted is most of what private means on
-- every other site, and it should mean that here. A private community is
-- joined the way it always was — by name and join ID, from somebody in it.

-- ---- links are refused, everywhere, always ---------------------------------
create or replace function public.enforce_community_links()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Every channel, not only the ones that are rows in communities: the six
  -- rooms the site runs go through here too and were never covered, because
  -- community_channel_id is null for them and the old body returned early.
  if NEW.comment_text ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|gg|co|xyz|ru|link|me|app|dev|shop|store|info|biz|site|online|club|live|tv))'
     and not public.is_dev() then
    raise exception 'CM_NO_LINKS' using errcode = 'P0001';
  end if;
  return NEW;
end $$;

-- the column, and the one thing that read it, are both gone
alter table public.communities drop column if exists links_allowed;

-- ---- browse lists public communities only ----------------------------------
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
   where c.is_public
     and (p_q is null
       or btrim(p_q) = ''
       or c.name ilike '%' || replace(replace(btrim(p_q), '%', '\%'), '_', '\_') || '%'
       or coalesce(c.short_description, '') ilike '%' || replace(replace(btrim(p_q), '%', '\%'), '_', '\_') || '%')
   group by c.id
   -- biggest first, and a stable tiebreak so paging cannot repeat or skip a
   -- row when two communities are the same size
   order by count(m.user_id) filter (where m.banned = false) desc, c.name asc, c.id asc
   limit greatest(1, least(coalesce(p_limit, 30), 50))
  offset greatest(0, coalesce(p_offset, 0))
$$;
