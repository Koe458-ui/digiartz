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

-- ============================================================ phase 2 (code
-- landed, not yet run) scripts/migrate-storage.mjs copies the objects across.
-- Runs from a developer machine with the service-role key. Reads from the
-- CloudFront urls, so it MUST run before either distribution is disabled.
-- Three modes: plan (default, writes nothing), --copy (objects only),
-- --copy --commit (also rewrites the url columns).
--
-- Sizes are generated ONCE at upload rather than resized per request, because
-- Supabase image transformations are a paid-plan feature and this has to work
-- on Free. Each size is its own object:
--
--   koe-originals  artworks/<uid>/<base>.<ext>        untouched original
--   koe-media      artworks/<uid>/<base>__t300.webp   grid thumbnail
--   koe-media      artworks/<uid>/<base>__v1000.webp  lightbox
--   koe-media      artworks/<uid>/<base>__f1600.webp  free download, og:image
--
-- The size lives in the FILENAME, never a path prefix: koe-media's existing
-- policies test foldername(name)[2] = auth.uid(), and a prefix like
-- t300/artworks/<uid>/... would shift the owner to position 3 and break every
-- one of them. Keeping <prefix>/<uid>/<file> is why no existing policy changed.
--
-- Column meaning after migration:
--   image_url     public url of the __f1600 derivative. Directly usable, and
--                 the other sizes are a suffix swap away.
--   storage_path  path of the ORIGINAL in koe-originals. What the download gate
--                 signs and what deletes remove.
--
-- ============================================================ phase 3 (landed)
-- Dual read. imgResize in js/app-core.js, resize() in the edge middleware and
-- crawlImage() in the sitemap all accept either host: a CloudFront url resizes
-- on the fly, a Supabase url swaps the size suffix. Display is therefore
-- correct with any mix of migrated and unmigrated rows, which is what makes the
-- copy safe to run incrementally.
-- The service worker also stopped skipping Supabase hosts for storage objects —
-- uncached thumbnails against metered egress was the worst case available.
--
-- ============================================================ phase 4 (landed)
-- Uploads go to Supabase Storage. smart-function v17 mints SUPABASE signed
-- upload URLs instead of an S3 presigned PUT, and keeps every check it already
-- had: mime allowlist, 25MB/200MB ceilings, asset extension allowlist, per-user
-- flood limit. Uploading straight from the browser would have discarded all of
-- that and left only what RLS can express, which is why the function stays in
-- the path rather than being removed.
--
-- An image yields four signed targets (original -> koe-originals, three sizes
-- -> koe-media). The browser generates the sizes in a canvas before uploading.
-- Signing uses the CALLER's client, so storage RLS applies on top of the checks.
--
-- The response carries BOTH shapes — targets/supabasePublicUrl for the new
-- client, uploadUrl/publicUrl for the old one — because the service worker
-- caches the site's JS and some browsers run the previous client for a while
-- after a deploy. Each pair is internally consistent, so no client can store a
-- url pointing at bytes that were never written. The S3 pair goes in phase 7.
--
-- NOTE the object path. The client sends an S3 KEY, which carries the bucket
-- name as its first segment (koe-media/artworks/<uid>/file.png). Supabase names
-- the bucket separately, so the object path is that key minus the prefix. Not
-- cosmetic: with the prefix left on, foldername(name)[2] is 'artworks' rather
-- than the uid and RLS rejects EVERY upload. objKey holds the stripped form.
--
-- ============================================================ phase 5 (landed)
-- The download gate is dual-mode. For a migrated row it signs the original out
-- of koe-originals with createSignedUrl, using the SERVICE ROLE so that serving
-- somebody else's artwork can bypass the owner-only select policy — reached
-- only after dz_request_download has granted a unit of quota. For a row still
-- on CloudFront it presigns S3 exactly as before. Delete is dual-mode too: the
-- caller knows only a path, not which host holds it, so it removes from
-- koe-originals, koe-media (original plus all three derivatives) and S3, every
-- one idempotent.
--
-- ============================================================ phases 6-7
-- Not yet applied:
--   6. run the copier with --copy --commit to move objects and backfill urls.
--   7. verify, then decommission: delete the S3 bucket, disable and delete both
--      CloudFront distributions, drop the AWS secrets and the aws4fetch import
--      from the edge function.
