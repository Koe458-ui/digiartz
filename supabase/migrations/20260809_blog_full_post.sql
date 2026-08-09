-- A post carries its own context
--
-- The composer asked for a title, an excerpt, a body, a category and tags.
-- What kind of piece it is, what work it is about, where its claims came from
-- and whether it is even meant to be public yet were all unaskable.
--
-- The dividing line running through this one is which fields a person fills
-- in and which the system does. Slug, author, reading time, publication date
-- and the counters are the system's, and the composer never offers a box for
-- any of them — they are derived at publish and shown back as a read-only
-- summary so nobody wonders where they went. Everything else is asked.
--
-- Everything added here is nullable or defaulted, so every post already in the
-- table stays valid and reads exactly as it did.

-- Whether every element of a text array is within a length. A CHECK cannot
-- contain a subquery, so the per-element rule has to arrive as one immutable
-- expression. An empty or absent array passes: having no tags is not a tag of
-- the wrong length.
create or replace function public.arr_items_within(a text[], lo int, hi int)
returns boolean
language sql
immutable
parallel safe
set search_path to 'pg_catalog', 'pg_temp'
as $$
  select coalesce(
    (select bool_and(char_length(btrim(x)) between lo and hi)
       from unnest(coalesce(a, '{}'::text[])) x),
    true)
$$;

alter table public.blog_posts
  add column if not exists content_type      text,
  add column if not exists related_artworks  uuid[] not null default '{}',
  add column if not exists related_items     uuid[] not null default '{}',
  add column if not exists external_refs     text[] not null default '{}',
  add column if not exists visibility        text   not null default 'published',
  add column if not exists featured          boolean not null default false,
  add column if not exists author_bio        text,
  add column if not exists seo_title         text,
  add column if not exists seo_description   text,
  add column if not exists bookmark_count    bigint not null default 0;

-- ---- bounds ---------------------------------------------------------------
-- New columns are checked outright — they are null or empty on every existing
-- row, so nothing can be retroactively invalid. title, excerpt and body are
-- tightened NOT VALID and left unvalidated: a NOT VALID check is still
-- enforced on every INSERT and UPDATE from here on, and what it skips is the
-- sweep over posts written under the old bounds. New posts meet the new
-- floors; old posts are not retroactively broken.
do $$
declare c record;
begin
  for c in
    select * from (values
      ('blog_content_type_len', 'content_type is null or char_length(btrim(content_type)) between 3 and 30', true),
      ('blog_related_art_n',    'cardinality(related_artworks) <= 10', true),
      ('blog_related_items_n',  'cardinality(related_items) <= 10', true),
      ('blog_external_refs_n',  'cardinality(external_refs) <= 20', true),
      ('blog_external_refs_len','public.arr_items_within(external_refs, 5, 200)', true),
      ('blog_tags_n',           'cardinality(tags) <= 10', true),
      ('blog_tags_len',         'public.arr_items_within(tags, 1, 30)', true),
      ('blog_visibility_vals',  'visibility in (''draft'',''published'',''scheduled'',''hidden'')', true),
      ('blog_author_bio_len',   'author_bio is null or char_length(btrim(author_bio)) between 20 and 500', true),
      ('blog_seo_title_len',    'seo_title is null or char_length(btrim(seo_title)) between 10 and 70', true),
      ('blog_seo_desc_len',     'seo_description is null or char_length(btrim(seo_description)) between 50 and 160', true),
      ('blog_read_minutes_rng', 'read_minutes between 1 and 2000', true),
      ('blog_category_n',       'cardinality(category) <= 5', true),
      -- tightened on existing columns: enforced from here on, not backfilled
      ('blog_title_len',        'char_length(btrim(title)) between 5 and 120', false),
      ('blog_excerpt_len',      'excerpt is null or char_length(btrim(excerpt)) between 20 and 300', false),
      ('blog_body_len',         'char_length(btrim(body)) between 100 and 20000', false)
    ) as t(name, expr, do_validate)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.blog_posts'::regclass and conname = c.name) then
      execute format('alter table public.blog_posts add constraint %I check (%s) not valid', c.name, c.expr);
      if c.do_validate then
        execute format('alter table public.blog_posts validate constraint %I', c.name);
      end if;
    end if;
  end loop;
end $$;

-- the old 2–160 title rule and the old 40-character body floor are superseded
alter table public.blog_posts drop constraint if exists blog_posts_title_check;
alter table public.blog_posts drop constraint if exists blog_posts_body_check;

-- ---- grants ---------------------------------------------------------------
-- Column level, like every other table here. Nothing on a blog post is
-- private — a post is a thing published on purpose — so all of these are
-- readable by everyone.
grant select (
  content_type, related_artworks, related_items, external_refs, visibility,
  featured, author_bio, seo_title, seo_description, bookmark_count
) on public.blog_posts to anon, authenticated;

grant insert (
  content_type, related_artworks, related_items, external_refs, visibility,
  featured, author_bio, seo_title, seo_description
) on public.blog_posts to anon, authenticated;

grant update (
  content_type, related_artworks, related_items, external_refs, visibility,
  featured, author_bio, seo_title, seo_description
) on public.blog_posts to anon, authenticated;

-- bookmark_count is the system's, like the other counters: readable by
-- everyone, written by nobody through the client.

-- the list only shows published posts, and sorts featured first
create index if not exists blog_feed_idx
  on public.blog_posts (status, visibility, featured desc, created_at desc);
