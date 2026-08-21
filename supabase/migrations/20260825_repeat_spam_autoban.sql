-- Posting the same thing over and over earns a day off
--
-- The phishing account posted the SAME message four times in forty-three
-- seconds. Nothing counted that. The rate limiter counted comments and saw
-- four, far under its twenty; the content guard now reads each one on its own
-- and would refuse all four identically. Neither notices the thing a human
-- moderator would notice first, which is that it is the same message again.
--
-- Five identical messages and the account stops writing for a day —
-- everywhere, not just on the surface it was repeating on. There is nothing to
-- attach for that last part: dz_ban_gate() is already on 55 triggers covering
-- every table a member can write to, and it reads user_bans. A row there with
-- expires_at set is a temporary ban that lifts itself.
--
-- TWO DESIGN DECISIONS WORTH ARGUING WITH
--
-- 1. THE BAN IS RECORDED AND THE ROW IS DROPPED, not refused. Postgres has no
--    autonomous transactions: a trigger that inserts the ban and then RAISEs
--    rolls the ban back along with everything else, and the account would be
--    free to carry on. Returning NULL lets the statement commit, so the ban
--    sticks. The writer sees their fifth message not appear, and their sixth
--    attempt — anywhere on the site — meets the suspension message from
--    dz_ban_gate. Same reasoning as the phishing path in
--    20260824_antiphish_content_guard.sql.
--
-- 2. SHORT MESSAGES ARE EXEMPT, and this is the important one. On an art site
--    "nice!", "gorgeous", "love this" and "🔥" are posted by the same happy
--    member on ten different artworks in a row, and that is not spam, it is
--    the site working. A rule that banned for it would be worse than the
--    problem it solves. So only messages of 30 normalised characters or more
--    are counted — the phishing text was about 700. Below that, the existing
--    rate limits and the chat gate's own repeat detection are the controls.
--
-- Matching is on the DEOBFUSCATED, punctuation-stripped text, so changing
-- "Verification." to "Verification!" or swapping a homoglyph in does not mint
-- a fresh message. That is exactly what the attacker did between attempts one
-- and two, where the only difference was a leading "]".

-- ===========================================================================
-- 1. WHAT COUNTS AS "THE SAME MESSAGE"
-- ===========================================================================
-- dz_deobfuscate folds homoglyphs, invisible characters and encodings; on top
-- of that everything that is not a letter or a digit goes, so spacing and
-- punctuation cannot be used to mint a new message.
create or replace function public.dz_content_fingerprint(p_text text)
returns text
language sql
immutable
as $$
  select case
           when length(regexp_replace(public.dz_deobfuscate(p_text), '[^a-z0-9]+', '', 'g')) < 30
             then null                       -- too short to judge; see above
           else md5(regexp_replace(public.dz_deobfuscate(p_text), '[^a-z0-9]+', '', 'g'))
         end;
$$;


-- ===========================================================================
-- 2. THE TALLY
-- ===========================================================================
-- One row per (member, message), carrying how many times it has been posted
-- and when it was last seen. Written by the trigger below, which is SECURITY
-- DEFINER, so no member-facing grant is needed and RLS denies everything else.
create table if not exists public.content_repeats (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  fingerprint text        not null,
  n           int         not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
create index if not exists content_repeats_last_idx
  on public.content_repeats (last_at);
alter table public.content_repeats enable row level security;
revoke all on public.content_repeats from anon, authenticated;


-- ===========================================================================
-- 3. THE RULE
-- ===========================================================================
create or replace function public.dz_repeat_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_col   text := coalesce(nullif(TG_ARGV[0], ''), 'body');
  v_limit int  := coalesce(nullif(TG_ARGV[1], '')::int, 5);
  v_text  text;
  v_row   json := row_to_json(NEW);
  v_uid   uuid := auth.uid();
  v_fp    text;
  v_n     int;
  v_dev   boolean := false;
begin
  if v_uid is null then return NEW; end if;      -- cron and service role

  if to_regprocedure('public.is_dev()') is not null then
    begin v_dev := public.is_dev(); exception when others then v_dev := false; end;
  end if;
  if v_dev then return NEW; end if;

  v_text := v_row ->> v_col;
  v_fp := public.dz_content_fingerprint(v_text);
  if v_fp is null then return NEW; end if;       -- short message, not counted

  -- A repeat only counts against a repeat that is recent. Somebody who posts
  -- the same paragraph in January and again in June is not spamming, and a
  -- tally that never resets would eventually ban them for it. Six hours is
  -- long enough to cover the "post it, get bored, post it again" pattern and
  -- short enough that yesterday is forgotten.
  insert into public.content_repeats (user_id, fingerprint)
  values (v_uid, v_fp)
  on conflict (user_id, fingerprint) do update
    set n       = case when public.content_repeats.last_at < now() - interval '6 hours'
                       then 1
                       else public.content_repeats.n + 1 end,
        last_at = now()
  returning n into v_n;

  if v_n < v_limit then return NEW; end if;

  -- Already serving one? Do not stack a second on top — that would turn a
  -- one-day ban into a rolling one every time the client retried.
  if not public.dz_is_banned(v_uid) then
    insert into public.user_bans (user_id, reason, note, banned_by, expires_at)
    values (v_uid,
            'spam',
            'Automatic: the same message posted ' || v_n || ' times (' ||
              TG_TABLE_NAME || '.' || v_col || ')',
            null,                                   -- nobody: the system did it
            now() + interval '1 day');
  end if;

  if to_regprocedure('public.dz_log_abuse(text,text,text,text)') is not null then
    perform public.dz_log_abuse(TG_TABLE_NAME, 'repeat',
                                'n=' || v_n || ' auto-ban 1 day', v_text);
  end if;

  -- Dropped, not refused, so the ban above commits. See the header.
  return null;
end $$;


-- ===========================================================================
-- 4. WHERE IT GOES
-- ===========================================================================
-- The three surfaces a message is written to. Attached after the content guard
-- so that a phishing repeat is refused as phishing first and only counted if
-- it was otherwise postable.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('item_comments',   'body'),
      ('comments',        'comment_text'),
      ('direct_messages', 'content')
    ) as t(tbl, col)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = r.tbl and column_name = r.col
    ) then continue; end if;

    execute format('drop trigger if exists dz_repeat_%s on public.%I', r.tbl, r.tbl);
    -- zz_ prefix so it sorts last: Postgres fires per-row triggers in name
    -- order, and this one must run after the content and ban gates.
    execute format('drop trigger if exists zz_dz_repeat_%s on public.%I', r.tbl, r.tbl);
    execute format(
      'create trigger zz_dz_repeat_%s before insert on public.%I '||
      'for each row execute function public.dz_repeat_guard(%L, %L)',
      r.tbl, r.tbl, r.col, '5');
  end loop;
end $$;


-- ===========================================================================
-- 5. HOUSEKEEPING
-- ===========================================================================
-- The tally is only ever read six hours back, so anything older is dead
-- weight. Swept opportunistically, the same way rate_hits is, rather than with
-- a cron job that is one more thing to keep alive.
create or replace function public.dz_sweep_repeats()
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  delete from public.content_repeats where last_at < now() - interval '2 days';
$$;
revoke all on function public.dz_sweep_repeats() from public, anon, authenticated;
