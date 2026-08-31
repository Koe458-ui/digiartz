-- Round 4 — two read policies that said `USING (true)` and meant something
-- narrower.
--
-- 1. public.comics
--
--    The table carried two SELECT policies. `comics_anon_read` limited anon to
--    approved rows, which is what was intended — but `comics_select_public`
--    applied to PUBLIC with `USING (true)`, and policies for the same command
--    are OR-ed. The permissive one therefore decided every read, and a comic
--    sitting in 'pending' or 'rejected' was as readable as an approved one, to
--    a caller who was not signed in.
--
--    Replaced with the same rule the other content tables use: approved, or
--    your own.
--
-- 2. public.album_items
--
--    get_album_artworks() is careful — it will only return a private album's
--    contents to the album's owner. album_items itself was readable by anyone,
--    so the careful function was not the only way in: selecting album_items by
--    album_id listed the artwork ids inside any private album, straight past
--    the check the RPC exists to make.
--
--    The new policy is the RPC's own predicate, so the two agree by
--    construction rather than by hand.
--
-- Neither change affects a live read path: js/albums.js reads albums only
-- through get_user_albums() and get_album_artworks(), and touches album_items
-- solely to insert and delete (neither returns rows without an explicit
-- .select(), which the callers do not chain).

drop policy if exists comics_select_public on public.comics;
drop policy if exists comics_anon_read     on public.comics;

create policy comics_select_public
  on public.comics
  for select
  using (status = 'approved' or user_id = auth.uid());

drop policy if exists album_items_read on public.album_items;

create policy album_items_read
  on public.album_items
  for select
  using (
    exists (
      select 1
        from public.albums al
       where al.id = album_items.album_id
         and (al.is_public or al.user_id = auth.uid())
    )
  );
