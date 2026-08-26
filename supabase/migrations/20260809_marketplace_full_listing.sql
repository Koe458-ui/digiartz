alter table public.marketplace_items
  add column if not exists product_type          text,
  add column if not exists summary               text,
  add column if not exists subcategory           text,
  add column if not exists buyer_gets            text,
  add column if not exists file_format           text,
  add column if not exists file_count            integer,
  add column if not exists file_size_mb          numeric(12,2),
  add column if not exists dimensions            text,
  add column if not exists software              text,
  add column if not exists source_files_included boolean not null default false,
  add column if not exists commercial_use        boolean not null default true,
  add column if not exists personal_use          boolean not null default false,
  add column if not exists modification_allowed  boolean not null default false,
  add column if not exists attribution_required  boolean not null default false,
  add column if not exists sale_price_cents      integer,
  add column if not exists stock                 integer,
  add column if not exists delivery_type         text not null default 'instant',
  add column if not exists delivery_notes        text,
  add column if not exists custom_requests       boolean not null default false,
  add column if not exists revision_count        integer,
  add column if not exists support_period        text,
  add column if not exists refund_policy         text,
  add column if not exists preview_watermark     boolean not null default false,
  add column if not exists safety_notes          text,
  add column if not exists seller_note           text,
  add column if not exists apply_url             text,
  add column if not exists apply_email           text,
  add column if not exists visibility            text not null default 'published',
  add column if not exists featured              boolean not null default false,
  add column if not exists closing_date          date,
  add column if not exists internal_notes        text,
  add column if not exists seo_title             text,
  add column if not exists seo_description       text,
  add column if not exists slug                  text;

do $$
declare c record;
begin
  for c in
    select * from (values
      ('mk_product_type_len',   'product_type is null or char_length(btrim(product_type)) between 3 and 30', true),
      ('mk_summary_len',        'summary is null or char_length(btrim(summary)) between 20 and 200', true),
      ('mk_subcategory_len',    'subcategory is null or char_length(btrim(subcategory)) between 2 and 50', true),
      ('mk_buyer_gets_len',     'buyer_gets is null or char_length(btrim(buyer_gets)) between 20 and 3000', true),
      ('mk_file_format_len',    'file_format is null or char_length(btrim(file_format)) between 2 and 100', true),
      ('mk_file_count_rng',     'file_count is null or file_count between 1 and 9999', true),
      ('mk_file_size_rng',      'file_size_mb is null or (file_size_mb >= 0 and file_size_mb <= 100000)', true),
      ('mk_dimensions_len',     'dimensions is null or char_length(btrim(dimensions)) between 2 and 50', true),
      ('mk_software_len',       'software is null or char_length(btrim(software)) between 2 and 100', true),
      ('mk_sale_price_rng',     'sale_price_cents is null or sale_price_cents >= 0', true),
      ('mk_sale_below_price',   'sale_price_cents is null or sale_price_cents < price_cents', true),
      ('mk_stock_rng',          'stock is null or stock between 0 and 999999', true),
      ('mk_delivery_type_vals', 'delivery_type in (''instant'',''custom'')', true),
      ('mk_delivery_days_rng',  'delivery_days is null or delivery_days between 0 and 365', true),
      ('mk_delivery_notes_len', 'delivery_notes is null or char_length(btrim(delivery_notes)) between 20 and 1000', true),
      ('mk_revision_rng',       'revision_count is null or revision_count between 0 and 99', true),
      ('mk_support_period_len', 'support_period is null or char_length(btrim(support_period)) between 2 and 50', true),
      ('mk_refund_policy_len',  'refund_policy is null or char_length(btrim(refund_policy)) between 20 and 500', true),
      ('mk_safety_notes_len',   'safety_notes is null or char_length(btrim(safety_notes)) between 20 and 500', true),
      ('mk_seller_note_len',    'seller_note is null or char_length(btrim(seller_note)) between 20 and 500', true),
      ('mk_apply_url_len',      'apply_url is null or char_length(btrim(apply_url)) between 10 and 200', true),
      ('mk_apply_email_len',    'apply_email is null or char_length(btrim(apply_email)) between 5 and 254', true),
      ('mk_visibility_vals',    'visibility in (''draft'',''published'',''hidden'')', true),
      ('mk_internal_notes_len', 'internal_notes is null or char_length(btrim(internal_notes)) between 20 and 1000', true),
      ('mk_seo_title_len',      'seo_title is null or char_length(btrim(seo_title)) between 3 and 80', true),
      ('mk_seo_desc_len',       'seo_description is null or char_length(btrim(seo_description)) between 50 and 160', true),
      ('mk_slug_len',           'slug is null or char_length(btrim(slug)) between 3 and 120', true),
      ('mk_tags_n',             'cardinality(tags) <= 10', true),
      ('mk_gallery_n',          'gallery is null or jsonb_typeof(gallery) <> ''array'' or jsonb_array_length(gallery) <= 8', true),
      ('mk_title_len',          'char_length(btrim(title)) between 3 and 100', false),
      ('mk_description_len',    'description is null or char_length(btrim(description)) between 100 and 5000', false)
    ) as t(name, expr, do_validate)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.marketplace_items'::regclass and conname = c.name) then
      execute format('alter table public.marketplace_items add constraint %I check (%s) not valid', c.name, c.expr);
      if c.do_validate then
        execute format('alter table public.marketplace_items validate constraint %I', c.name);
      end if;
    end if;
  end loop;
end $$;

alter table public.marketplace_items drop constraint if exists marketplace_items_title_check;

create or replace function public.marketplace_file_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare n int;
begin
  select count(*) into n from public.marketplace_file where item_id = new.item_id;
  if n >= 50 then
    raise exception 'A listing can carry at most 50 files';
  end if;
  return new;
end $$;

drop trigger if exists marketplace_file_cap_trg on public.marketplace_file;
create trigger marketplace_file_cap_trg
  before insert on public.marketplace_file
  for each row execute function public.marketplace_file_cap();

grant select (
  product_type, summary, subcategory, buyer_gets, file_format, file_count,
  file_size_mb, dimensions, software, source_files_included, commercial_use,
  personal_use, modification_allowed, attribution_required, stock,
  delivery_type, delivery_notes, custom_requests, revision_count,
  support_period, refund_policy, preview_watermark, safety_notes, seller_note,
  apply_url, apply_email, visibility, featured, closing_date,
  seo_title, seo_description, slug
) on public.marketplace_items to anon, authenticated;

grant select (sale_price_cents) on public.marketplace_items to authenticated;

grant insert (
  product_type, summary, subcategory, buyer_gets, file_format, file_count,
  file_size_mb, dimensions, software, source_files_included, commercial_use,
  personal_use, modification_allowed, attribution_required, sale_price_cents,
  stock, delivery_type, delivery_notes, custom_requests, revision_count,
  support_period, refund_policy, preview_watermark, safety_notes, seller_note,
  apply_url, apply_email, visibility, featured, closing_date, internal_notes,
  seo_title, seo_description, slug
) on public.marketplace_items to anon, authenticated;

grant update (
  product_type, summary, subcategory, buyer_gets, file_format, file_count,
  file_size_mb, dimensions, software, source_files_included, commercial_use,
  personal_use, modification_allowed, attribution_required, sale_price_cents,
  stock, delivery_type, delivery_notes, custom_requests, revision_count,
  support_period, refund_policy, preview_watermark, safety_notes, seller_note,
  apply_url, apply_email, visibility, featured, closing_date, internal_notes,
  seo_title, seo_description, slug
) on public.marketplace_items to anon, authenticated;

create index if not exists marketplace_feed_idx
  on public.marketplace_items (status, visibility, featured desc, created_at desc);
