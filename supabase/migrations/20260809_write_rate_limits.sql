create or replace function public.dz_write_rate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid  uuid := auth.uid();
  v_noun text := coalesce(nullif(TG_ARGV[0], ''), 'requests');
  v_max  int  := coalesce(nullif(TG_ARGV[1], '')::int, 30);
  v_win  int  := coalesce(nullif(TG_ARGV[2], '')::int, 3600);
begin
  if v_uid is null then return new; end if;

  if not public.dz_rate_ok(
       TG_TABLE_NAME || ':' || TG_OP || ':' || v_uid::text, v_max, v_win) then
    raise exception 'Too many % in a short time — wait a moment and try again', v_noun
      using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('artworks',            'INSERT', 'uploads',            40,  3600),
      ('artworks',            'UPDATE', 'edits',             120,  3600),
      ('resources',           'INSERT', 'resources',          20,  3600),
      ('resources',           'UPDATE', 'edits',             120,  3600),
      ('marketplace_items',   'INSERT', 'listings',           20,  3600),
      ('marketplace_items',   'UPDATE', 'edits',             120,  3600),
      ('blog_posts',          'INSERT', 'posts',              15,  3600),
      ('blog_posts',          'UPDATE', 'edits',             120,  3600),
      ('jobs',                'INSERT', 'job postings',       15,  3600),
      ('jobs',                'UPDATE', 'edits',             120,  3600),
      ('item_comments',       'INSERT', 'comments',           20,   300),
      ('comments',            'INSERT', 'comments',           20,   300),
      ('direct_messages',     'INSERT', 'messages',           30,   300),
      ('item_reports',        'INSERT', 'reports',            15,  3600),
      ('artwork_reports',     'INSERT', 'reports',            15,  3600),
      ('albums',              'INSERT', 'albums',             40,  3600),
      ('albums',              'UPDATE', 'edits',             120,  3600),
      ('profiles',            'UPDATE', 'profile changes',    60,  3600),
      ('profile_creds',       'INSERT', 'credentials',        30,  3600),
      ('scheduled_uploads',   'INSERT', 'scheduled uploads',  30,  3600),
      ('scheduled_sections',  'INSERT', 'scheduled posts',    30,  3600)
    ) as t(tbl, op, noun, max_n, win)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;

    execute format('drop trigger if exists dz_rate_%s_%s on public.%I',
                   lower(r.op), r.tbl, r.tbl);
    execute format(
      'create trigger dz_rate_%s_%s before %s on public.%I '||
      'for each row execute function public.dz_write_rate(%L, %L, %L)',
      lower(r.op), r.tbl, r.op, r.tbl, r.noun, r.max_n::text, r.win::text);
  end loop;
end $$;

drop trigger if exists artworks_touch on public.artworks;
create trigger artworks_touch
  before update on public.artworks
  for each row execute function public.dz_touch_updated_at();
