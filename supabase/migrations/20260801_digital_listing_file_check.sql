-- A digital listing still needs a file. It no longer needs a public url.
--
-- marketplace_digital_needs_file read `item_type <> 'digital' OR file_url IS
-- NOT NULL`, which was the right rule when the only way to attach a file was
-- to upload it to the public bucket and keep the link. Product files now go to
-- koe-originals and have no public url by design — file_url is null on purpose,
-- because a row that carries one is a row that leaks — so under the old
-- constraint every new digital listing would have been rejected at INSERT.
--
-- The requirement itself is worth keeping: a digital download with nothing to
-- download is a listing that takes money for nothing. So the check now accepts
-- either shape — the legacy public url, or a storage path, which the composer
-- sets from the first file it uploads. A CHECK cannot reach into
-- marketplace_file to count the rest, and does not need to: the composer writes
-- file_storage_path and the file rows in the same publish, and rolls the
-- listing back if the file rows fail.
alter table public.marketplace_items
  drop constraint if exists marketplace_digital_needs_file;

alter table public.marketplace_items
  add constraint marketplace_digital_needs_file
  check (
    item_type <> 'digital'
    or file_url is not null
    or file_storage_path is not null
  );
