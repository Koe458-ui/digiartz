update storage.buckets
   set file_size_limit = 419430400
 where id = 'koe-originals';

drop trigger if exists dz_range_resources on public.resources;
create trigger dz_range_resources before insert or update on public.resources
  for each row execute function public.dz_range_on_change(
    'file_size', '0', '419430400', 'required');
