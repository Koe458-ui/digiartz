-- A resource gets the search snippet every other section already has
--
-- Artworks, blog posts and marketplace listings all carry seo_title,
-- seo_description and slug. Resources were the one section of the four
-- without them, which showed in two places: functions/_middleware.js could
-- not select a snippet for a resource and fell back to the raw title and
-- summary for its meta tags, and the upload form had no automatic SEO card
-- to show, alone among the forms that have one.
--
-- Nothing here is asked for on the form. The three are written the same way
-- the artwork upload writes them — the title, the summary and a slug made
-- from the title — because a search snippet is not a preference and a slug
-- someone types drifts from the title it is supposed to name. See ART_AUTO
-- in js/sections.js for the reasoning; this file is the storage half of it.
--
-- Everything added is nullable, so every resource already in the table stays
-- valid and reads exactly as it did. The existing rows get no backfill: a
-- null snippet is a search engine falling back to the real title, which is
-- what it was already doing before this column existed.

alter table public.resources
  add column if not exists seo_title       text,
  add column if not exists seo_description text,
  add column if not exists slug            text;

-- ---- bounds ---------------------------------------------------------------
-- The same three the other tables carry, and the same numbers: 10–70 and
-- 50–160 are what dzSeoTitle and dzSeoDesc produce or refuse to produce, and
-- 3–120 is the marketplace slug rule. Checked outright rather than NOT VALID,
-- because all three columns are null on every existing row and so nothing can
-- be retroactively invalid.
do $$
declare c record;
begin
  for c in
    select * from (values
      ('res_seo_title_len', 'seo_title is null or char_length(btrim(seo_title)) between 10 and 70', true),
      ('res_seo_desc_len',  'seo_description is null or char_length(btrim(seo_description)) between 50 and 160', true),
      ('res_slug_len',      'slug is null or char_length(btrim(slug)) between 3 and 120', true)
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

-- ---- grants ---------------------------------------------------------------
-- Column level, like every other column on this table. Without these three
-- the client's insert is refused outright — the grant is not a formality
-- here, it is what makes the column writable at all.
grant select (seo_title, seo_description, slug) on public.resources to anon, authenticated;
grant insert (seo_title, seo_description, slug) on public.resources to anon, authenticated;
grant update (seo_title, seo_description, slug) on public.resources to anon, authenticated;
