alter table public.marketplace_items
  drop constraint if exists marketplace_digital_needs_file;

alter table public.marketplace_items
  add constraint marketplace_digital_needs_file
  check (
    item_type <> 'digital'
    or file_url is not null
    or file_storage_path is not null
  );
