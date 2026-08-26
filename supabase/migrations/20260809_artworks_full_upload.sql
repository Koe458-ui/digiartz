alter table public.artworks
  add column if not exists summary              text,
  add column if not exists subject_matter       text,
  add column if not exists medium               text,
  add column if not exists software_list        text[] not null default '{}',
  add column if not exists license              text,
  add column if not exists commercial_use       boolean not null default false,
  add column if not exists attribution_required boolean not null default false,
  add column if not exists modification_allowed boolean not null default false,
  add column if not exists credits              text[] not null default '{}',
  add column if not exists process_notes        text,
  add column if not exists external_links       text[] not null default '{}',
  add column if not exists comments_allowed     boolean not null default true,
  add column if not exists visibility           text not null default 'published',
  add column if not exists featured             boolean not null default false,
  add column if not exists seo_title            text,
  add column if not exists seo_description      text,
  add column if not exists slug                 text,
  add column if not exists file_ext             text,
  add column if not exists file_size            bigint,
  add column if not exists width                integer,
  add column if not exists height               integer,
  add column if not exists updated_at           timestamptz not null default now();

do $$
declare c record;
begin
  for c in
    select * from (values
      ('art_summary_len',      'summary is null or char_length(btrim(summary)) between 20 and 250', true),
      ('art_subject_len',      'subject_matter is null or char_length(btrim(subject_matter)) between 2 and 100', true),
      ('art_medium_len',       'medium is null or char_length(btrim(medium)) between 2 and 50', true),
      ('art_software_n',       'cardinality(software_list) <= 10', true),
      ('art_software_len',     'public.arr_items_within(software_list, 2, 50)', true),
      ('art_license_len',      'license is null or char_length(btrim(license)) between 3 and 100', true),
      ('art_credits_n',        'cardinality(credits) <= 20', true),
      ('art_credits_len',      'public.arr_items_within(credits, 2, 300)', true),
      ('art_process_len',      'process_notes is null or char_length(btrim(process_notes)) between 20 and 3000', true),
      ('art_links_n',          'cardinality(external_links) <= 5', true),
      ('art_links_len',        'public.arr_items_within(external_links, 5, 200)', true),
      ('art_visibility_vals',  'visibility in (''draft'',''published'',''scheduled'',''hidden'')', true),
      ('art_seo_title_len',    'seo_title is null or char_length(btrim(seo_title)) between 10 and 70', true),
      ('art_seo_desc_len',     'seo_description is null or char_length(btrim(seo_description)) between 50 and 160', true),
      ('art_slug_len',         'slug is null or char_length(btrim(slug)) between 3 and 120', true),
      ('art_tags_n',           'cardinality(tags) <= 10', true),
      ('art_tags_len',         'public.arr_items_within(tags, 1, 30)', true),
      ('art_category_n',       'cardinality(category) <= 5', true),
      ('art_dims_rng',         '(width is null or width between 1 and 100000) and (height is null or height between 1 and 100000)', true),
      ('art_file_size_rng',    'file_size is null or (file_size >= 0 and file_size <= 26214400)', true),
      ('art_pages_n',          'pages is null or jsonb_typeof(pages) <> ''array'' or jsonb_array_length(pages) <= 10', true),
      ('art_name_len',         'name is null or char_length(btrim(name)) between 3 and 100', false),
      ('art_description_len',  'description is null or char_length(btrim(description)) between 20 and 5000', false)
    ) as t(name, expr, do_validate)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.artworks'::regclass and conname = c.name) then
      execute format('alter table public.artworks add constraint %I check (%s) not valid', c.name, c.expr);
      if c.do_validate then
        execute format('alter table public.artworks validate constraint %I', c.name);
      end if;
    end if;
  end loop;
end $$;

grant select (
  summary, subject_matter, medium, software_list, license, commercial_use,
  attribution_required, modification_allowed, credits, process_notes,
  external_links, comments_allowed, visibility, featured, seo_title,
  seo_description, slug, file_ext, file_size, width, height, updated_at
) on public.artworks to anon, authenticated;

grant insert (
  summary, subject_matter, medium, software_list, license, commercial_use,
  attribution_required, modification_allowed, credits, process_notes,
  external_links, comments_allowed, visibility, featured, seo_title,
  seo_description, slug, file_ext, file_size, width, height, updated_at
) on public.artworks to anon, authenticated;

grant update (
  summary, subject_matter, medium, software_list, license, commercial_use,
  attribution_required, modification_allowed, credits, process_notes,
  external_links, comments_allowed, visibility, featured, seo_title,
  seo_description, slug, file_ext, file_size, width, height, updated_at
) on public.artworks to anon, authenticated;

create index if not exists artworks_feed_idx
  on public.artworks (status, visibility, kind, featured desc, created_at desc);

alter table public.scheduled_uploads add column if not exists extra jsonb;

grant select (extra) on public.scheduled_uploads to anon, authenticated;
grant insert (extra) on public.scheduled_uploads to anon, authenticated;
grant update (extra) on public.scheduled_uploads to anon, authenticated;

create or replace function public.publish_due_scheduled_uploads()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  r        record;
  moved    integer := 0;
  fail_msg text;
  new_art  uuid;
  x        jsonb;
BEGIN
  FOR r IN
    SELECT * FROM public.scheduled_uploads
    WHERE publish_at <= now() AND publish_error IS NULL
    ORDER BY publish_at
    LIMIT 200
  LOOP
    fail_msg := NULL;
    x := COALESCE(r.extra, '{}'::jsonb);

    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id) THEN
      fail_msg := 'Account no longer active';
    ELSIF COALESCE(r.content_rating,'SAFE') = 'ADULT' THEN
      fail_msg := 'Failed content review';
    ELSIF r.phash IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.artworks a
      WHERE a.phash = r.phash AND a.created_at > r.created_at
    ) THEN
      fail_msg := 'This artwork was already published';
    END IF;

    IF fail_msg IS NOT NULL THEN
      UPDATE public.scheduled_uploads
         SET publish_error = fail_msg, attempts = attempts + 1, last_attempt_at = now()
       WHERE id = r.id;
      INSERT INTO public.notifications (user_id, type, title, message, ref_table)
      VALUES (r.user_id, 'artwork_rejected', 'Scheduled artwork not published',
              COALESCE(r.name,'Your artwork') || ' could not be published: ' || fail_msg,
              'scheduled_uploads');
      CONTINUE;
    END IF;

    INSERT INTO public.artworks (
      name, description, tags, category, image_url, storage_path,
      thumb_x, thumb_y, thumb_zoom, pages, kind, user_id, software,
      phash, status, content_rating, is_mature, ai_moderation,
      summary, subject_matter, medium, software_list, license, commercial_use,
      attribution_required, modification_allowed, credits, process_notes,
      external_links, comments_allowed, visibility, featured,
      seo_title, seo_description, slug, file_ext, file_size, width, height
    ) VALUES (
      r.name, r.description, r.tags, r.category, r.image_url, r.storage_path,
      COALESCE(r.thumb_x,50), COALESCE(r.thumb_y,50), COALESCE(r.thumb_zoom,1),
      r.pages, r.kind, r.user_id, r.software,
      r.phash, 'approved', COALESCE(r.content_rating,'SAFE'),
      COALESCE(r.is_mature,false) OR COALESCE((x->>'declared_mature')::boolean, false),
      r.ai_moderation,
      x->>'summary', x->>'subject_matter', x->>'medium',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(x->'software_list')='array' THEN x->'software_list' ELSE '[]'::jsonb END)), '{}'),
      x->>'license',
      COALESCE((x->>'commercial_use')::boolean, false),
      COALESCE((x->>'attribution_required')::boolean, false),
      COALESCE((x->>'modification_allowed')::boolean, false),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(x->'credits')='array' THEN x->'credits' ELSE '[]'::jsonb END)), '{}'),
      x->>'process_notes',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(x->'external_links')='array' THEN x->'external_links' ELSE '[]'::jsonb END)), '{}'),
      COALESCE((x->>'comments_allowed')::boolean, true),
      COALESCE(x->>'visibility', 'published'),
      COALESCE((x->>'featured')::boolean, false),
      x->>'seo_title', x->>'seo_description', x->>'slug',
      x->>'file_ext',
      (x->>'file_size')::bigint, (x->>'width')::int, (x->>'height')::int
    )
    RETURNING id INTO new_art;

    IF r.album_ids IS NOT NULL AND array_length(r.album_ids, 1) > 0 THEN
      INSERT INTO public.album_items (album_id, artwork_id)
      SELECT al.id, new_art
      FROM public.albums al
      WHERE al.id = ANY(r.album_ids) AND al.user_id = r.user_id
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, ref_table)
    VALUES (r.user_id, 'artwork_approved', 'Your scheduled artwork is live',
            COALESCE(r.name,'Your artwork') || ' has been published.', 'artworks');

    DELETE FROM public.scheduled_uploads WHERE id = r.id;
    moved := moved + 1;
  END LOOP;

  RETURN moved;
END;
$function$;
