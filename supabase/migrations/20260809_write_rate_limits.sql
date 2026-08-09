-- Every text write is rate limited
--
-- The site already rate limited the two things that cost money: uploads, in
-- the storage signer, and payments, in the payment endpoints. Everything a
-- member can type was unlimited. A job posting and a blog post need no file
-- at all, so nothing whatsoever stood between one script and a table full of
-- them; comments, reports and direct messages were the same.
--
-- rate_hits and dz_rate_ok already exist and are already used by the download
-- and view counters, so this adds no new machinery — it is one trigger
-- function that calls the counter that was already there, attached to every
-- table a member can write words into.
--
-- Three things worth knowing about how this behaves:
--
--   auth.uid() is null for the service role and for the two scheduled
--   publishers, which run as SECURITY DEFINER from cron. Those are skipped, so
--   a member who queued forty scheduled posts still gets all forty published
--   — they were rate limited when they queued them, which is the moment that
--   was theirs.
--
--   The bucket is per user and per table and per operation, so somebody
--   commenting fast cannot exhaust their own ability to publish, and one
--   member can never exhaust another's.
--
--   The window is fixed rather than sliding, which is what makes it one row
--   and one UPSERT instead of a log. A burst straddling a boundary can reach
--   twice the limit for one window; the limits below are set with that in
--   mind, and the point is to stop a script, not to police a fast typist.

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
  -- the schedulers and any service-role work are not the thing being limited
  if v_uid is null then return new; end if;

  if not public.dz_rate_ok(
       TG_TABLE_NAME || ':' || TG_OP || ':' || v_uid::text, v_max, v_win) then
    -- Worded to survive safeErr in js/app-core.js, which suppresses anything
    -- that reads like a database error and shows the rest to the member.
    raise exception 'Too many % in a short time — wait a moment and try again', v_noun
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---- who gets one, and how many ------------------------------------------
-- Generous enough that no real member meets them, tight enough that a script
-- meets them immediately. Publishing is slower than commenting because
-- publishing is heavier, and editing is faster than publishing because a
-- member really does adjust a listing several times in a row.
do $$
declare r record;
begin
  for r in
    select * from (values
      -- table,               op,       noun,               max,  window secs
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
      -- pure text, and the most spammable surface on the site
      ('item_comments',       'INSERT', 'comments',           20,   300),
      ('comments',            'INSERT', 'comments',           20,   300),
      ('direct_messages',     'INSERT', 'messages',           30,   300),
      ('item_reports',        'INSERT', 'reports',            15,  3600),
      ('artwork_reports',     'INSERT', 'reports',            15,  3600),
      -- the rest of what a member can type
      ('albums',              'INSERT', 'albums',             40,  3600),
      ('albums',              'UPDATE', 'edits',             120,  3600),
      ('profiles',            'UPDATE', 'profile changes',    60,  3600),
      ('profile_creds',       'INSERT', 'credentials',        30,  3600),
      ('scheduled_uploads',   'INSERT', 'scheduled uploads',  30,  3600),
      ('scheduled_sections',  'INSERT', 'scheduled posts',    30,  3600)
    ) as t(tbl, op, noun, max_n, win)
  loop
    -- a table this deployment does not have is skipped rather than fatal
    if to_regclass('public.' || r.tbl) is null then continue; end if;

    execute format('drop trigger if exists dz_rate_%s_%s on public.%I',
                   lower(r.op), r.tbl, r.tbl);
    execute format(
      'create trigger dz_rate_%s_%s before %s on public.%I '||
      'for each row execute function public.dz_write_rate(%L, %L, %L)',
      lower(r.op), r.tbl, r.op, r.tbl, r.noun, r.max_n::text, r.win::text);
  end loop;
end $$;

-- ---- a bug this audit turned up -------------------------------------------
-- artworks gained an updated_at column with the upload revamp and nothing
-- maintained it, so "Last updated" would have read as the creation time
-- forever. The other four content tables have carried this trigger for a
-- while; artworks never did, because it never had the column.
drop trigger if exists artworks_touch on public.artworks;
create trigger artworks_touch
  before update on public.artworks
  for each row execute function public.dz_touch_updated_at();
