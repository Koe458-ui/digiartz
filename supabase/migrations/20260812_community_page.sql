alter table public.communities add column if not exists short_description text;
alter table public.communities add column if not exists is_public boolean not null default false;

create or replace function public.can_read_community(cid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.communities c
     where c.id = cid and c.is_public
  ) or exists (
    select 1 from public.community_members m
     where m.community_id = cid
       and m.user_id = auth.uid()
       and m.banned = false
  )
$$;

create or replace function public.cm_join_public(cid uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'CM_FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.communities c where c.id = cid and c.is_public) then
    raise exception 'CM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_members
              where community_id = cid and user_id = auth.uid() and banned) then
    raise exception 'CM_BANNED' using errcode = 'P0001';
  end if;
  insert into public.community_members (community_id, user_id, role)
  values (cid, auth.uid(), 'member')
  on conflict (community_id, user_id) do nothing;
  return cid;
end $$;

create or replace function public.cm_leave(cid uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'CM_FORBIDDEN' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.communities where id = cid and owner_id = auth.uid()) then
    raise exception 'CM_OWNER_LEAVE' using errcode = 'P0001';
  end if;
  delete from public.community_members
   where community_id = cid and user_id = auth.uid();
end $$;

create or replace function public.cm_delete(cid uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.communities where id = cid and owner_id = auth.uid()) then
    raise exception 'CM_FORBIDDEN' using errcode = 'P0001';
  end if;
  delete from public.comments where channel = 'c:' || cid::text;
  delete from public.community_members where community_id = cid;
  delete from public.communities where id = cid;
end $$;

drop policy if exists comments_delete_own_or_staff on public.comments;
create policy comments_delete_own_or_staff on public.comments
  for delete
  using (
    user_id = auth.uid()
    or public.is_dev()
    or (
      public.community_channel_id(channel) is not null
      and public.my_community_rank(public.community_channel_id(channel)) >= 2
    )
  );

alter table public.item_reports add column if not exists subject_ref text;

alter table public.item_reports drop constraint if exists item_reports_kind_check;
alter table public.item_reports add constraint item_reports_kind_check
  check (kind = any (array[
    'artwork','resource','blog','marketplace','job',
    'community','community_member','community_message'
  ]));

create unique index if not exists item_reports_once_idx
  on public.item_reports (reporter_id, kind, subject_id, coalesce(subject_ref, ''));

alter table public.communities add column if not exists avatar_storage_path text;
