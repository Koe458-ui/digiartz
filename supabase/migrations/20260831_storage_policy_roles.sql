-- Round 4 — two storage policies that granted correctly for the wrong reason.
--
-- 1. `storage_user_upload_own_folder` was granted to PUBLIC, not to
--    `authenticated`.
--
--    It is not exploitable today: the predicate is
--    `foldername(name)[2] = auth.uid()::text OR is_dev()`, both halves of which
--    are NULL/false for a signed-out caller, and anon holds no INSERT on
--    storage.objects anyway. But "not exploitable because two other things
--    happen to be true" is not the same as "cannot apply", and this is the
--    INSERT policy on the bucket the whole site serves images from. It belongs
--    to signed-in callers, so it should say so. Every sibling policy on this
--    table already does.
--
-- 2. The three `dev ... templates` policies keyed on
--    `auth.email() = 'duttaanish458@gmail.com'`.
--
--    auth.email() reads the email claim out of the caller's JWT. GoTrue will
--    not move an address to an account without confirming it, so this is not
--    forgeable today — but it makes an admin grant depend on a mutable identity
--    field rather than on the role column that every other privileged check on
--    this project reads, it hardcodes a personal address into schema that is
--    committed to git, and it cannot be handed to a second admin or taken back
--    without a migration.
--
--    is_dev() answers the same question from public.profiles.role, which is
--    what dz_is_staff(), the ops panel and the artwork mod gate all use, and
--    which one UPDATE can revoke. Verified before writing this: the account at
--    that address holds role = 'dev', so the replacement grants exactly the
--    same person exactly the same access.
--
--    The delete policy's reach over the whole bucket is left as it is. It is
--    the site owner's, it is deliberate, and narrowing it to templates/ would
--    take away a moderator's ability to pull a bad object by hand.

drop policy if exists "storage_user_upload_own_folder" on storage.objects;

create policy "storage_user_upload_own_folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'koe-media'
    and ((storage.foldername(name))[2] = (auth.uid())::text or public.is_dev())
  );

drop policy if exists "dev upload templates"          on storage.objects;
drop policy if exists "dev update templates storage"  on storage.objects;
drop policy if exists "dev delete templates storage"  on storage.objects;

create policy "dev upload templates"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'koe-media'
    and public.is_dev()
    and (name like 'templates/previews/%' or name like 'templates/files/%')
  );

create policy "dev update templates storage"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'koe-media' and public.is_dev());

create policy "dev delete templates storage"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'koe-media' and public.is_dev());
