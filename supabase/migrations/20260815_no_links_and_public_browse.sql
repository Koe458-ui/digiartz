create or replace function public.enforce_community_links()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if NEW.comment_text ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|gg|co|xyz|ru|link|me|app|dev|shop|store|info|biz|site|online|club|live|tv))'
     and not public.is_dev() then
    raise exception 'CM_NO_LINKS' using errcode = 'P0001';
  end if;
  return NEW;
end $$;

alter table public.communities drop column if exists links_allowed;

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
   order by count(m.user_id) filter (where m.banned = false) desc, c.name asc, c.id asc
   limit greatest(1, least(coalesce(p_limit, 30), 50))
  offset greatest(0, coalesce(p_offset, 0))
$$;
