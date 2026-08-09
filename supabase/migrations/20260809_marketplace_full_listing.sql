-- A listing says what the buyer is actually buying
--
-- The composer asked for a title, one description box, a price and a license.
-- Everything a buyer decides on — what is in the download, what format it is
-- in, whether they may sell what they make with it, how long delivery takes,
-- whether there is a refund — was either buried in the description or left to
-- be asked in the comments. This is the rest of the listing, one column per
-- thing.
--
-- Everything added here is nullable or defaulted, so every listing already in
-- the table stays valid and reads exactly as it did.
--
-- Two rules about who may read what, and both matter:
--
--   sale_price_cents is a price, so it follows price_cents exactly — readable
--   by a signed-in caller and revoked for anon. The grant is column level, so
--   a guest that asks for it fails the whole request rather than getting a
--   null, which is why the composer only names it in the select list when
--   there is a session.
--
--   internal_notes is the seller's note to the moderators. It is granted for
--   INSERT and UPDATE so the seller can write it, and granted SELECT to
--   nobody — not anon, not authenticated, not even the seller. Row policies
--   cannot help here: any signed-in caller can already read every approved
--   listing's row, so a SELECT grant on this column would hand them everyone's
--   private notes. Moderation reads it through the service role.

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

-- ---- bounds ---------------------------------------------------------------
-- The new columns are checked outright: they are null on every existing row,
-- so nothing can be retroactively invalid.
--
-- title and description are tightened NOT VALID and left unvalidated on
-- purpose. A NOT VALID check is still enforced on every INSERT and UPDATE from
-- here on; what it skips is the backfill sweep over rows written under the old
-- bounds. That is exactly the behaviour wanted — new listings must meet the
-- new floors, listings from before are not retroactively broken.
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
      -- a "sale" price at or above the price is not a sale
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
      -- tightened on existing columns: enforced from here on, not backfilled
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

-- the old 2–140 title rule is superseded by mk_title_len
alter table public.marketplace_items drop constraint if exists marketplace_items_title_check;

-- ---- how many files one listing may sell ----------------------------------
-- A CHECK cannot count rows in another table, so the cap is a trigger. Without
-- it a seller can attach files to a listing until the storage bill notices;
-- the signer already caps each file at 200MB and rate limits the uploads, but
-- nothing capped how many rows could point at one listing.
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

-- ---- grants ---------------------------------------------------------------
-- Column level, like everything else on this table. Read the note at the top
-- of this file before adding either of the two exceptions to this list.
grant select (
  product_type, summary, subcategory, buyer_gets, file_format, file_count,
  file_size_mb, dimensions, software, source_files_included, commercial_use,
  personal_use, modification_allowed, attribution_required, stock,
  delivery_type, delivery_notes, custom_requests, revision_count,
  support_period, refund_policy, preview_watermark, safety_notes, seller_note,
  apply_url, apply_email, visibility, featured, closing_date,
  seo_title, seo_description, slug
) on public.marketplace_items to anon, authenticated;

-- a price, so it goes where price_cents goes and no further
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

-- internal_notes is deliberately absent from every grant select above.

-- the grid only shows published listings, and sorts featured first
create index if not exists marketplace_feed_idx
  on public.marketplace_items (status, visibility, featured desc, created_at desc);
