-- A community becomes a place with a front page
--
-- Until now a community was a chat room with a settings modal behind a MANAGE
-- button on its card. There was nowhere to read what a community is, no list
-- of who is in it that a member could open, no way to leave one, no way to
-- delete one, and no way to report one. The page that fixes that needs five
-- things the database did not have.
--
-- SHORT DESCRIPTION. A community already had a description; a card needs a
-- line and a page needs a paragraph, and one column cannot be both.
--
-- PUBLIC / PRIVATE. Every community today is private: can_read_community says
-- members only, and cm_join wants the name and the six-character join ID. That
-- is left exactly as it is — is_public defaults to false, so no existing
-- community changes hands the day this lands. Turning it on is the owner's
-- decision, and what it buys is that anyone signed in can read the room and
-- join it from its page without being handed a code.
--
-- LEAVING. community_members already lets a member delete their own row, so
-- leaving was technically possible and had no button. What it did not have was
-- the one rule that matters: an owner cannot leave, because a community with
-- no owner has nobody who can edit or delete it. cm_leave says so by name.
--
-- DELETING. communities has an owner DELETE policy, but a community's messages
-- live in comments keyed by the text channel 'c:<uuid>' — no foreign key, so a
-- straight delete leaves every message behind, readable by nobody and deleted
-- by nothing. cm_delete takes the room with the community.
--
-- DELETING ONE MESSAGE. comments had policies for select and insert and none
-- at all for delete, which means nothing has ever been deletable — not by its
-- author, not by a moderator. "Delete your own text" and "a moderator can
-- remove text" were both simply absent.

-- ---- the two new columns ---------------------------------------------------
alter table public.communities add column if not exists short_description text;
alter table public.communities add column if not exists is_public boolean not null default false;

-- ---- public communities are readable without joining -----------------------
-- comments_select already routes through this, so a public room's text becomes
-- readable by the same edit that makes the room public.
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

-- Posting is deliberately NOT widened: a public community can be read by
-- anyone and written in by its members. can_post_community is unchanged.

-- ---- joining a public community without a code -----------------------------
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
    -- a private community still needs its name and join ID, through cm_join
    raise exception 'CM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_members
              where community_id = cid and user_id = auth.uid() and banned) then
    raise exception 'CM_BANNED' using errcode = 'P0001';
  end if;
  -- the 50-community cap is the trigger's, not this function's
  insert into public.community_members (community_id, user_id, role)
  values (cid, auth.uid(), 'member')
  on conflict (community_id, user_id) do nothing;
  return cid;
end $$;

-- ---- leaving ---------------------------------------------------------------
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
    -- the owner is the only person who can edit or delete it. Walking out
    -- would leave a room nobody can reach the controls for.
    raise exception 'CM_OWNER_LEAVE' using errcode = 'P0001';
  end if;
  delete from public.community_members
   where community_id = cid and user_id = auth.uid();
end $$;

-- ---- deleting --------------------------------------------------------------
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
  -- the room first: comments are keyed by a text channel, not a foreign key,
  -- so nothing else would ever collect them
  delete from public.comments where channel = 'c:' || cid::text;
  delete from public.community_members where community_id = cid;
  delete from public.communities where id = cid;
end $$;

-- ---- deleting one message --------------------------------------------------
-- Its author, or a moderator of that community, or a dev. Everyone else gets
-- the same answer they got before this policy existed: no.
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

-- ---- reporting a community, a member or a message --------------------------
-- item_reports already carries kind + subject_id + reason for the five content
-- types. Two of the three new kinds are uuid-keyed and fit as they are; a
-- message is keyed by comments.id, which is a bigint, so the row gains a
-- nullable text reference rather than the id column changing type under five
-- working report flows.
alter table public.item_reports add column if not exists subject_ref text;

alter table public.item_reports drop constraint if exists item_reports_kind_check;
alter table public.item_reports add constraint item_reports_kind_check
  check (kind = any (array[
    'artwork','resource','blog','marketplace','job',
    'community','community_member','community_message'
  ]));

-- one report per person per subject, so a second tap is not a second row
create unique index if not exists item_reports_once_idx
  on public.item_reports (reporter_id, kind, subject_id, coalesce(subject_ref, ''));

-- ---- the community icon is uploaded, not pasted --------------------------
-- The settings form asked for an "icon image URL", which is only usable by
-- somebody who already has the image hosted somewhere else — and whatever
-- they paste can rot, redirect or be swapped under us. It is a file picker
-- now, uploading through the same signer profile photos use, and the object
-- key is kept so replacing an icon deletes the file it replaced instead of
-- leaving every icon the community has ever had in the bucket.
alter table public.communities add column if not exists avatar_storage_path text;
