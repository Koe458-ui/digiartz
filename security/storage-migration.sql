-- Storage migration: S3 + CloudFront -> Supabase Storage
--
-- Applied phases are recorded here as they land. The deployed database is the
-- source of truth; this file exists so the policy set is reviewable in the repo.
--
-- ============================================================ design
--
-- Two buckets, mirroring what S3 plus the two CloudFront distributions did, so
-- the move changes hosting without changing the security model:
--
--   koe-media     public   display derivatives, avatars, banners,
--                          resource/market previews, blog covers.
--                          UNCHANGED by this migration — its eleven
--                          pre-existing policies are left exactly as they were.
--   koe-originals private  artwork originals, resource files, marketplace
--                          files. No public endpoint. Reachable only through a
--                          signed URL minted server-side after
--                          dz_request_download grants a unit of daily quota.
--
-- Every path the app writes has the shape <prefix>/<uid>/<file>, so folder
-- position 2 is the owner. That is the convention the koe-media policies
-- already used, and the koe-originals policies follow it.
--
--   artworks/<uid>/<ts>_<slug>.<ext>        original + extra pages
--   avatars/<uid>/<ts>.jpg
--   banners/<uid>/<ts>.jpg
--   resources/<uid>/<ts>_<slug>.<ext>       file (private) + preview (public)
--   market/<uid>/<ts>_<slug>.<ext>          file (private) + preview (public)
--
-- ============================================================ phase 1
-- Create the private originals bucket and its policies. Additive: nothing reads
-- it yet, the app still serves from S3/CloudFront.
--
-- roll back:
--   drop policy "originals select own folder" on storage.objects;
--   drop policy "originals delete own folder" on storage.objects;
--   drop policy "originals update own folder" on storage.objects;
--   drop policy "originals insert own folder" on storage.objects;
--   delete from storage.buckets where id = 'koe-originals';

-- 200MB matches MAX_ASSET_BYTES in the smart-function edge function, so the
-- storage layer enforces the same ceiling the signer does.
insert into storage.buckets (id, name, public, file_size_limit)
values ('koe-originals', 'koe-originals', false, 209715200)
on conflict (id) do nothing;

create policy "originals insert own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'koe-originals'
  and ((storage.foldername(name))[2] = (auth.uid())::text or public.is_dev())
);

create policy "originals update own folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'koe-originals'
  and ((storage.foldername(name))[2] = (auth.uid())::text or public.is_dev())
)
with check (
  bucket_id = 'koe-originals'
  and ((storage.foldername(name))[2] = (auth.uid())::text or public.is_dev())
);

create policy "originals delete own folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'koe-originals'
  and ((storage.foldername(name))[2] = (auth.uid())::text or public.is_dev())
);

-- Read your OWN originals, and nothing else. Downloading somebody else's
-- artwork does NOT go through this policy: it goes through the edge function
-- using the service role, which bypasses RLS only after the quota check has
-- passed. There is no anon select policy, so the bucket is unreadable without
-- a session.
create policy "originals select own folder"
on storage.objects for select to authenticated
using (
  bucket_id = 'koe-originals'
  and ((storage.foldername(name))[2] = (auth.uid())::text or public.is_dev())
);

-- ============================================================ phases 2-7
-- Not yet applied. See the migration plan:
--   2. copy the 24 artworks + 4 avatars across, originals -> koe-originals,
--      derivatives -> koe-media. Must run while the CloudFront URLs are still
--      public, since the copier reads from them.
--   3. dual-read helpers: resolve a stored URL on either host, so display keeps
--      working with a mix of migrated and unmigrated rows.
--   4. switch uploads to Supabase Storage, writing both bucket copies.
--   5. switch the download gate to a Supabase signed URL.
--   6. backfill the URL columns on artworks / profiles / resources /
--      marketplace_items / blog_posts / comics.
--   7. verify, then decommission the S3 bucket and both distributions.
