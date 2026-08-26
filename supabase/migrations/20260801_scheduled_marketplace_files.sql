alter table public.scheduled_sections
  add column if not exists sell_files jsonb;

create or replace function public.publish_due_scheduled_sections()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  r        record;
  moved    int := 0;
  tbl      text;
  fail_msg text;
  collist  text;
  body     jsonb;
  new_id   uuid;
  f        jsonb;
  pos      int;
BEGIN
  FOR r IN
    SELECT * FROM public.scheduled_sections
    WHERE publish_at <= now() AND publish_error IS NULL
    ORDER BY publish_at LIMIT 200
  LOOP
    fail_msg := NULL;
    new_id   := NULL;
    tbl := CASE r.section
             WHEN 'resources'   THEN 'resources'
             WHEN 'blog'        THEN 'blog_posts'
             WHEN 'marketplace' THEN 'marketplace_items'
             WHEN 'jobs'        THEN 'jobs' END;

    IF tbl IS NULL THEN
      fail_msg := 'Unknown section';
    ELSIF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id) THEN
      fail_msg := 'Account no longer active';
    END IF;

    IF fail_msg IS NULL THEN
      body := (r.payload - 'status')
              || jsonb_build_object('status','approved','user_id', r.user_id::text);
      SELECT string_agg(quote_ident(k), ',') INTO collist
      FROM jsonb_object_keys(body) k
      WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema='public' AND c.table_name=tbl AND c.column_name=k);
      IF collist IS NULL THEN
        fail_msg := 'Nothing to publish';
      ELSE
        BEGIN
          EXECUTE format(
            'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) RETURNING id',
            tbl, collist, collist, tbl) USING body INTO new_id;
        EXCEPTION WHEN OTHERS THEN
          fail_msg := left(SQLERRM, 300);
        END;
      END IF;
    END IF;

    IF fail_msg IS NULL AND r.section = 'marketplace' AND new_id IS NOT NULL
       AND jsonb_typeof(r.sell_files) = 'array' THEN
      BEGIN
        pos := 0;
        FOR f IN SELECT * FROM jsonb_array_elements(r.sell_files) LOOP
          INSERT INTO public.marketplace_file
            (user_id, item_id, storage_bucket, storage_path, original_filename, mime, bytes, position)
          VALUES (
            r.user_id, new_id,
            COALESCE(f->>'bucket', 'koe-originals'),
            f->>'path',
            left(COALESCE(f->>'name', 'file'), 260),
            f->>'mime',
            NULLIF(f->>'bytes', '')::bigint,
            pos
          );
          pos := pos + 1;
        END LOOP;
      EXCEPTION WHEN OTHERS THEN
        DELETE FROM public.marketplace_items WHERE id = new_id;
        fail_msg := left('Could not attach the files: ' || SQLERRM, 300);
      END;
    END IF;

    IF fail_msg IS NOT NULL THEN
      UPDATE public.scheduled_sections
         SET publish_error = fail_msg, attempts = attempts + 1, last_attempt_at = now()
       WHERE id = r.id;
      INSERT INTO public.notifications (user_id, type, title, message, ref_table)
      VALUES (r.user_id, 'post_rejected', 'Scheduled post not published',
              COALESCE(r.payload->>'title','Your post') || ' could not be published: ' || fail_msg,
              'scheduled_sections');
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, ref_table)
    VALUES (r.user_id, 'post_published', 'Your scheduled post is live',
            COALESCE(r.payload->>'title','Your post') || ' has been published.', tbl);

    DELETE FROM public.scheduled_sections WHERE id = r.id;
    moved := moved + 1;
  END LOOP;
  RETURN moved;
END; $function$;
