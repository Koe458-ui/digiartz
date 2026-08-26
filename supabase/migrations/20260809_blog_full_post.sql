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

alter table public.blog_posts drop constraint if exists blog_posts_title_check;
alter table public.blog_posts drop constraint if exists blog_posts_body_check;

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

create index if not exists blog_feed_idx
  on public.blog_posts (status, visibility, featured desc, created_at desc);
