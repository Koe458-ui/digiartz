-- Room for a 400MB package
--
-- Max may upload a 400MB downloadable file. Three ceilings stood at 200MB and
-- every one of them would have refused it after the signer had already said
-- yes: the private bucket's own file_size_limit, and the range trigger on
-- resources.file_size.
--
-- These are raised to 400MB for everyone, and that is deliberate. They are the
-- outer wall — what the storage layer and the row will physically accept —
-- and the wall does not know who is uploading. The line between 200 and 400
-- is drawn in supabase/functions/smart-function, which reads
-- dz_effective_tier() for the caller and refuses to sign the upload at all
-- past their tier's ceiling. A member on Lite cannot reach these numbers
-- because nothing will sign the bytes into the bucket for them.

-- The private bucket. Sellable product files and resource packages both land
-- here; nothing public is affected — koe-media has no limit of its own and
-- images are capped at 25MB by the signer.
update storage.buckets
   set file_size_limit = 419430400          -- 400MB
 where id = 'koe-originals';

-- The row's own record of the package size. The trigger form of this check
-- came from 20260818_item_view_counts.sql, which replaced the old
-- res_file_size_rng constraint with a range trigger that only fires when the
-- value actually changes; the arguments are positional, so the whole trigger
-- is restated to move one number.
drop trigger if exists dz_range_resources on public.resources;
create trigger dz_range_resources before insert or update on public.resources
  for each row execute function public.dz_range_on_change(
    'file_size', '0', '419430400', 'required');
