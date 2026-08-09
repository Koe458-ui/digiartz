-- A resource says what is in the package and what may be done with it
--
-- The composer asked for a file, a preview, a title, a description, a
-- category and a license. What kind of asset it is, what software opens it,
-- what is actually inside the zip, whether it may be sold on, and how to
-- install it were all left to one description box.
--
-- The last of the four, and it carries the same two ideas as the other three.
-- Floors and ceilings are repeated here as constraints because a form is a
-- courtesy and a constraint is a guarantee. And the line between what a
-- person types and what the system works out is drawn on purpose: file
-- format, file size, how many files are inside the package, the preview's
-- dimensions, the author, the dates and the download count are all derived
-- and none of them has a box on the form.
--
-- Everything added here is nullable or defaulted, so every resource already
-- in the table stays valid and reads exactly as it did.

alter table public.resources
  add column if not exists summary              text,
  add column if not exists resource_type        text,
  add column if not exists subcategory          text,
  add column if not exists commercial_use       boolean not null default false,
  add column if not exists attribution_required boolean not null default false,
  add column if not exists modification_allowed boolean not null default true,
  add column if not exists compatible_software  text[] not null default '{}',
  add column if not exists compatible_versions  text,
  add column if not exists whats_included       text,
  add column if not exists instructions         text,
  add column if not exists version              text,
  add column if not exists external_links       text[] not null default '{}',
  add column if not exists safety_notes         text,
  add column if not exists visibility           text not null default 'published',
  add column if not exists featured             boolean not null default false,
  -- the derived half: read off the upload, never typed
  add column if not exists file_count           integer,
  add column if not exists dimensions           text;

-- ---- bounds ---------------------------------------------------------------
-- New columns are checked outright — they are null or empty on every existing
-- row. title and description are tightened NOT VALID and left unvalidated: a
-- NOT VALID check is still enforced on every INSERT and UPDATE from here on,
-- and what it skips is the sweep over rows written under the old bounds.
do $$
declare c record;
begin
  for c in
    select * from (values
      ('res_summary_len',      'summary is null or char_length(btrim(summary)) between 20 and 250', true),
      ('res_type_len',         'resource_type is null or char_length(btrim(resource_type)) between 2 and 50', true),
      ('res_subcategory_len',  'subcategory is null or char_length(btrim(subcategory)) between 2 and 50', true),
      ('res_compat_sw_n',      'cardinality(compatible_software) <= 10', true),
      ('res_compat_sw_len',    'public.arr_items_within(compatible_software, 2, 50)', true),
      ('res_compat_ver_len',   'compatible_versions is null or char_length(btrim(compatible_versions)) between 2 and 200', true),
      ('res_included_len',     'whats_included is null or char_length(btrim(whats_included)) between 20 and 2000', true),
      ('res_instructions_len', 'instructions is null or char_length(btrim(instructions)) between 20 and 3000', true),
      ('res_version_len',      'version is null or char_length(btrim(version)) between 1 and 30', true),
      ('res_links_n',          'cardinality(external_links) <= 5', true),
      ('res_links_len',        'public.arr_items_within(external_links, 5, 200)', true),
      ('res_safety_len',       'safety_notes is null or char_length(btrim(safety_notes)) between 20 and 500', true),
      ('res_visibility_vals',  'visibility in (''draft'',''published'',''scheduled'',''hidden'')', true),
      ('res_software_len',     'software is null or char_length(btrim(software)) between 2 and 100', true),
      ('res_dimensions_len',   'dimensions is null or char_length(btrim(dimensions)) between 2 and 50', true),
      ('res_file_count_rng',   'file_count is null or file_count between 1 and 100000', true),
      ('res_tags_n',           'cardinality(tags) <= 10', true),
      ('res_tags_len',         'public.arr_items_within(tags, 1, 30)', true),
      ('res_category_n',       'cardinality(category) <= 5', true),
      -- The signer already refuses anything over 200MB before a byte is
      -- stored. This is the same ceiling written where the row lives, so a
      -- row cannot claim a size the storage layer would never have accepted.
      ('res_file_size_rng',    'file_size >= 0 and file_size <= 209715200', false),
      -- tightened on existing columns: enforced from here on, not backfilled
      ('res_title_len',        'char_length(btrim(title)) between 3 and 100', false),
      ('res_description_len',  'description is null or char_length(btrim(description)) between 50 and 5000', false)
    ) as t(name, expr, do_validate)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.resources'::regclass and conname = c.name) then
      execute format('alter table public.resources add constraint %I check (%s) not valid', c.name, c.expr);
      if c.do_validate then
        execute format('alter table public.resources validate constraint %I', c.name);
      end if;
    end if;
  end loop;
end $$;

-- the old 2–120 title rule is superseded by res_title_len
alter table public.resources drop constraint if exists resources_title_check;

-- ---- grants ---------------------------------------------------------------
-- Column level, like every other table here. Nothing on a resource is
-- private — a resource is a thing shared on purpose.
grant select (
  summary, resource_type, subcategory, commercial_use, attribution_required,
  modification_allowed, compatible_software, compatible_versions,
  whats_included, instructions, version, external_links, safety_notes,
  visibility, featured, file_count, dimensions
) on public.resources to anon, authenticated;

grant insert (
  summary, resource_type, subcategory, commercial_use, attribution_required,
  modification_allowed, compatible_software, compatible_versions,
  whats_included, instructions, version, external_links, safety_notes,
  visibility, featured, file_count, dimensions
) on public.resources to anon, authenticated;

grant update (
  summary, resource_type, subcategory, commercial_use, attribution_required,
  modification_allowed, compatible_software, compatible_versions,
  whats_included, instructions, version, external_links, safety_notes,
  visibility, featured, file_count, dimensions
) on public.resources to anon, authenticated;

-- download_count stays the system's: readable by everyone, and already not
-- writable through the client.

-- the grid only shows published resources, and sorts featured first
create index if not exists resources_feed_idx
  on public.resources (status, visibility, featured desc, created_at desc);
