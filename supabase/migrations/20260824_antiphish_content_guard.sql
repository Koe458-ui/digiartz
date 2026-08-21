-- The phishing comment, and why the site had nothing to stop it
--
-- On 2026-08-20 an account calling itself "DigiArtzSupport" left this under an
-- artwork:
--
--   (This message was generated automatically and sent from DigiArtz) Complete
--   Verification. Your DigiArtz account has been temporarily restricted. [...]
--   please use the secure link: https:5347567%2eshop/227983727
--
-- Three separate failures had to line up for that to reach a reader, and this
-- file closes all three.
--
-- 1. THE LINK FILTER WAS NEVER ON THIS TABLE. enforce_community_links guards
--    public.comments — the community rooms — and dm_no_links guards direct
--    messages. item_comments, which is every comment under every artwork,
--    resource, blog post, listing and job on the site, had a rate limiter and
--    a ban gate and no content check at all. The most public surface the site
--    has was the one surface links were legal on.
--
-- 2. THE FILTER THAT DID EXIST WOULD NOT HAVE CAUGHT IT EITHER. Look at what
--    was actually typed: `https:5347567%2eshop/227983727`. There is no `//`
--    after the scheme, so `(https?://|www\.)` misses. The dot before the TLD
--    is written `%2e`, so `\.(com|net|...|shop|...)` misses — the browser
--    decodes it back to a dot when the reader pastes it, which is the entire
--    trick. A regex that reads the text as typed will always lose to somebody
--    who types it differently; the text has to be DECODED first and matched
--    second. That is what dz_deobfuscate does, and every link check on the
--    site now goes through it.
--
-- 3. NOTHING STOPPED THE NAME. "DigiArtzSupport" was a username anyone could
--    claim, and a comment carrying it renders identically to one from us. The
--    link was the payload; the name was what made a reader trust it. Reserved
--    names are in the companion migration, 20260824_reserved_names.sql.
--
-- The client already had a URL filter, in js/badwords.js. It runs in the
-- reader's browser, wrapped around supabase.createClient(), which means it
-- filters exactly the people who are not attacking you. Anyone willing to type
-- `curl` past it entirely — the anon key is public by design and PostgREST
-- answers it directly. Client-side filtering is a typo-catcher. This file is
-- the control.

-- ===========================================================================
-- 1. DEOBFUSCATION — decode first, match second
-- ===========================================================================
-- Everything a spammer does to a link is an attempt to be readable to a human
-- and unreadable to a regex. Percent-escapes, a dot from another alphabet, the
-- word "dot", a space either side of it, an invisible character in the middle
-- of the hostname. Each is trivial on its own and there is no end to the list,
-- so the answer is not more patterns — it is to fold all of them back to the
-- one form they are pretending not to be, and then run ONE pattern.
--
-- IMMUTABLE and pure text: no table access, no settings, safe in an index or a
-- check constraint if a later migration wants one.
create or replace function public.dz_deobfuscate(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  t := lower(coalesce(p_text, ''));
  if t = '' then return ''; end if;

  -- ---- percent-escapes, including double-encoded -------------------------
  -- %2e is a dot to every browser and to no regex. %252e is the same trick
  -- applied twice, so %25 collapses twice before the rest is read.
  t := replace(t, '%25', '%');
  t := replace(t, '%25', '%');
  t := replace(t, '%2e', '.');
  t := replace(t, '%2f', '/');
  t := replace(t, '%3a', ':');
  t := replace(t, '%40', '@');
  t := replace(t, '&#46;', '.');
  t := replace(t, '&period;', '.');
  t := replace(t, '&#x2e;', '.');

  -- ---- invisible characters ----------------------------------------------
  -- Zero-width spaces and joiners, the bidi overrides, the word joiner, the
  -- BOM and the soft hyphen. All render as nothing and all break a match.
  t := regexp_replace(
         t,
         '[' || E'­​‌‍‎‏‪‫‬' ||
                E'‭‮⁠⁡⁢⁣⁤﻿' || ']',
         '', 'g');

  -- ---- characters that are a dot wearing a costume ------------------------
  -- One-dot leader, fullwidth stop, ideographic stop, small full stop, Arabic
  -- and Syriac full stops, bullet operator, dot operator, middle dot, bullet,
  -- Lisu tone point. Every one of them is a period to a reader.
  t := translate(
         t,
         E'․．。﹒۔܁∙⋅·•ꓸ',
         '...........');

  -- ---- fullwidth latin, which is latin ------------------------------------
  t := translate(
         t,
         E'ａｂｃｄｅｆｇｈｉｊｋ' ||
         E'ｌｍｎｏｐｑｒｓｔｕｖ' ||
         E'ｗｘｙｚ０１２３４５６' ||
         E'７８９：／＠',
         'abcdefghijklmnopqrstuvwxyz0123456789:/@');

  -- ---- homoglyphs: Cyrillic and Greek letters that are latin letters -------
  -- "аmazon.com" with a Cyrillic а is a different string and the same picture.
  t := translate(
         t,
         E'аеорсхуѕіј' ||
         E'ӏԛԁһɡορυνα' ||
         E'τκηΒΕ',
         'aeopcxysijldqdhgopvnatkhbe');

  -- ---- accented latin folds to latin --------------------------------------
  t := translate(
         t,
         E'àáâãäåèéêë' ||
         E'ìíîïòóôõöù' ||
         E'úûüýÿñç',
         'aaaaaaeeeeiiiiooooouuuuyync');

  -- ---- the word "dot", and its punctuated disguises ------------------------
  -- Order matters: the bracketed forms go first so that "[dot]" is one
  -- replacement rather than a bracket left behind by the bare-word rule.
  t := regexp_replace(t, '\s*[\(\[\{<]\s*(dot|punto|punkt|d0t|daht)\s*[\)\]\}>]\s*', '.', 'g');
  t := regexp_replace(t, '\s*[\(\[\{<]\s*\.\s*[\)\]\}>]\s*', '.', 'g');
  t := regexp_replace(t, '\s+(dot|punto|punkt|d0t|daht)\s+', '.', 'g');
  t := regexp_replace(t, '\s*[\(\[\{<]\s*(at|arroba)\s*[\)\]\}>]\s*', '@', 'g');
  t := regexp_replace(t, '\s+(at|arroba)\s+(?=[a-z0-9._-]+\.[a-z]{2,})', '@', 'g');

  -- ---- schemes written to be unreadable ------------------------------------
  -- hxxp and h**p are the two everyone uses; the third rule catches a scheme
  -- with anything wedged between the letters.
  t := regexp_replace(t, 'h[x*#]{2}ps?', 'http', 'g');
  t := regexp_replace(t, 'h\s*t\s*t\s*p\s*s?\s*(?=:)', 'http', 'g');

  -- ---- separators glued around structural characters -----------------------
  -- "digiartz . net", "digiartz .net", "mail @ example.com".
  --
  -- ONLY whitespace BEFORE the dot is removed, and that asymmetry is the whole
  -- point. Written English never puts a space in front of a full stop, so a
  -- space there is somebody spacing a domain out to break a pattern. A space
  -- AFTER a full stop is just the next sentence starting, and collapsing it
  -- turns "I love this. Info here" into "this.info" — a real domain match on
  -- an innocent comment, which is exactly the kind of false positive that
  -- gets a filter switched off.
  --
  -- The cost is "digiartz. net", which reads as a sentence boundary and is
  -- left alone. That is the right way round: a missed evasion is one more
  -- comment to moderate, a refused sentence is a member who cannot post.
  t := regexp_replace(t, '\s+\.\s*', '.', 'g');
  t := regexp_replace(t, '\s+@\s*', '@', 'g');
  t := regexp_replace(t, '\s*:\s*//', '://', 'g');
  t := regexp_replace(t, '(?<=[a-z0-9])\s*/\s*(?=[a-z0-9])', '/', 'g');

  -- ---- a run of the same character is one character ------------------------
  t := regexp_replace(t, '\.{2,}', '.', 'g');

  return t;
end $$;

comment on function public.dz_deobfuscate(text) is
  'Folds a string back to the form a browser would resolve it to: percent-'
  'escapes decoded, invisible characters dropped, homoglyph and fullwidth '
  'characters mapped to latin, "[dot]"/" dot " written as a dot, whitespace '
  'around structural characters removed. Every link check on the site matches '
  'against this rather than against what was typed.';


-- ===========================================================================
-- 2. IS THERE A LINK IN IT
-- ===========================================================================
-- Run against the deobfuscated text, so each pattern can be simple and strict
-- instead of trying to anticipate a disguise.
--
-- The TLD list is the one enforce_community_links carried, widened to the
-- suffixes that actually turn up in this kind of comment. It is not
-- exhaustive and does not need to be: rules 1 and 2 below catch anything
-- carrying a scheme or a www, whatever it ends in, and that is most of them.
create or replace function public.dz_has_link(p_text text)
returns boolean
language plpgsql
immutable
as $$
declare
  t text := public.dz_deobfuscate(p_text);
begin
  if t = '' then return false; end if;

  -- 1. any scheme at all, with or without the slashes. This is the rule the
  --    reported comment loses to: `https:5347567.shop/...` has a scheme and no
  --    `//`, and the old pattern required the `//`.
  if t ~ '\y(https?|ftps?|ws{1,2}s?|data|javascript|magnet|tel|mailto)\s*:' then
    return true;
  end if;

  -- 2. a bare host that announces itself
  if t ~ '\ywww\.[a-z0-9-]' then return true; end if;

  -- 3. host.tld, optionally with a path. The negative lookahead keeps a
  --    sentence like "the file is final.zip" or a version like "v2.0" out of
  --    it: a TLD must be followed by a boundary, not by more letters.
  if t ~ ('\y[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9-]{1,63})*\.(' ||
          'com|net|org|info|biz|online|site|shop|store|app|dev|link|live|club|' ||
          'fun|top|vip|pro|xyz|icu|cyou|monster|quest|rest|cfd|sbs|bond|' ||
          'io|co|in|me|gg|tv|ly|to|cc|ru|su|ua|by|kz|cn|hk|tk|ml|ga|cf|gq|' ||
          'uk|us|ca|au|de|fr|jp|br|es|it|nl|se|pl|tr|ir|pk|bd|lk|np|ph|id|vn|' ||
          -- .zip and .mov are deliberately ABSENT. Both are real TLDs and both
          -- are things members type every day on an art site — "final.zip",
          -- "turntable.mov". A filter that refuses a comment about a file is a
          -- filter that gets turned off.
          'work|click|download|review|country|stream|gdn|racing|win|' ||
          'page|space|website|host|press|fund|cash|money|credit|loan|finance' ||
          ')\y') then
    return true;
  end if;

  -- 4. an email address is an off-platform contact handoff, same as a link
  if t ~ '\y[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\y' then return true; end if;

  -- 5. an IP address with a path, which is a link with the hostname skipped
  if t ~ '\y(\d{1,3}\.){3}\d{1,3}(:\d+)?(/|\y)' then return true; end if;

  return false;
end $$;


-- ===========================================================================
-- 3. DOES IT READ LIKE A PHISH
-- ===========================================================================
-- Blocking links closes the delivery route, and a phish that cannot carry a
-- link is most of the way to harmless. It is not all the way: "reply to this
-- with your password" needs no link, and neither does a message that talks a
-- reader into searching for something. So the prose is scored too.
--
-- Two independent markers, or one marker that only a forgery would ever write,
-- and the row is refused. One marker on its own is not enough — a member
-- genuinely asking "why is my account restricted?" says one of these things
-- and has done nothing wrong.
create or replace function public.dz_phish_score(p_text text)
returns int
language plpgsql
immutable
as $$
declare
  t text := regexp_replace(public.dz_deobfuscate(p_text), '[^a-z0-9@:/. ]+', ' ', 'g');
  n int := 0;
  pat text;
  -- Things only a forgery says. Any one of these is decisive on its own.
  fatal text[] := array[
    'this message was generated automatically',
    'generated automatically and sent from',
    'complete verification',
    'seed phrase',
    'recovery phrase',
    'private key',
    'wallet address',
    'connect your wallet',
    'validate your wallet',
    'send.{0,12}(btc|eth|usdt|bnb|sol)',
    'copy and paste it into your browser',
    'copy.{0,12}paste.{0,12}(link|url).{0,20}browser'
  ];
  -- Things a phish says and an ordinary comment occasionally also says.
  weak text[] := array[
    'account (has been|is|was) (temporarily )?(restricted|suspended|limited|locked|disabled)',
    'under review until',
    'verify your (account|identity|information)',
    'verification (process|page|link|required)',
    'regain (full )?access',
    'secure link',
    'support (representative|agent|team) will',
    'official support',
    'updated our privacy policy',
    'in accordance with the new privacy policy',
    'failure to (verify|comply)',
    'within 24 hours',
    'permanently (deleted|removed|banned)',
    'click (the|this) link',
    'if you can.?t click',
    'claim your (reward|prize|airdrop|nft|gift)',
    'you have been selected',
    'limited time offer',
    'confirm your (payment|billing|card)'
  ];
begin
  if t = '' then return 0; end if;

  foreach pat in array fatal loop
    if t ~ pat then return 10; end if;
  end loop;

  foreach pat in array weak loop
    if t ~ pat then n := n + 1; end if;
    exit when n >= 2;
  end loop;

  return n;
end $$;


-- ===========================================================================
-- 4. THE EVIDENCE TABLE
-- ===========================================================================
-- A refusal that leaves no trace tells you nothing about whether you are under
-- attack, and the difference between one confused member and a campaign is the
-- only thing worth knowing here. Every block writes a row: who, which surface,
-- which rule, and the first 500 characters of what they tried.
--
-- Staff-readable only. No policy grants select to a member, and RLS is on, so
-- a member reading their own attempts back is not a thing that can happen.
create table if not exists public.dz_abuse_events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid        references auth.users(id) on delete set null,
  ip          text,
  surface     text        not null,     -- the table the write was aimed at
  rule        text        not null,     -- 'link' | 'phish' | 'name'
  detail      text,                     -- what matched, for tuning
  sample      text                      -- first 500 chars, truncated
);
create index if not exists dz_abuse_events_time_idx
  on public.dz_abuse_events (created_at desc);
create index if not exists dz_abuse_events_user_idx
  on public.dz_abuse_events (user_id, created_at desc);
alter table public.dz_abuse_events enable row level security;
revoke all on public.dz_abuse_events from anon, authenticated;

-- Written by the triggers, which are SECURITY DEFINER, so no grant is needed
-- for the insert to land.
create or replace function public.dz_log_abuse(
  p_surface text, p_rule text, p_detail text, p_sample text
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.dz_abuse_events (user_id, ip, surface, rule, detail, sample)
  values (auth.uid(),
          case when to_regprocedure('public.dz_client_ip()') is not null
               then public.dz_client_ip() else null end,
          p_surface, p_rule, left(coalesce(p_detail, ''), 200),
          left(coalesce(p_sample, ''), 500));
exception when others then
  -- Logging is never allowed to be the reason a write fails or succeeds.
  return;
end $$;

-- ---- WHY SOME REFUSALS ARE LOGGED AND SOME ARE NOT -------------------------
-- Postgres has no autonomous transactions. A trigger that writes an audit row
-- and then calls RAISE undoes its own audit row along with everything else —
-- the insert is part of the transaction the exception aborts. That is not a
-- bug to work around with dblink (which would mean storing a database password
-- to solve a logging problem); it is a fact to design against, and the design
-- is to pick the right kind of refusal per rule:
--
--   PHISHING is logged, and the row is DROPPED rather than refused — the
--   trigger returns NULL, so the statement succeeds, the transaction commits,
--   and the evidence stands. js/sections.js reloads the list after a post, so
--   the writer sees their message simply not appear. Right twice over against
--   an attacker: the evidence survives, and there is no refusal message to
--   tune the next attempt against. This is what dz_chat_gate_comments already
--   does in 20260813, for the same reason.
--
--   A PLAIN LINK is refused with a message and NOT logged. Whoever typed it is
--   almost always a member linking their own portfolio; they need to be told
--   why it did not post, and "somebody typed a URL" is not evidence worth
--   keeping.
--
-- So dz_abuse_events is a record of ATTACKS, not of every refusal — which is
-- also what keeps it small enough to actually read.

-- What staff read. A member has no way to call it: execute is revoked from
-- both public roles and the body refuses anyone dz_is_staff() does not know.
create or replace function public.dz_abuse_recent(p_hours int default 24, p_limit int default 200)
returns setof public.dz_abuse_events
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if to_regprocedure('public.dz_is_staff()') is not null then
    if not public.dz_is_staff() then
      raise exception 'staff only' using errcode = '42501';
    end if;
  elsif to_regprocedure('public.is_dev()') is not null then
    if not public.is_dev() then
      raise exception 'staff only' using errcode = '42501';
    end if;
  else
    raise exception 'staff only' using errcode = '42501';
  end if;

  return query
    select * from public.dz_abuse_events
     where created_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 720)))
     order by created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;
revoke all on function public.dz_abuse_recent(int, int) from public, anon;
grant execute on function public.dz_abuse_recent(int, int) to authenticated;


-- ===========================================================================
-- 5. THE GUARD, AND THE TABLES IT GOES ON
-- ===========================================================================
-- One trigger function, parameterised by which column holds the text, so the
-- rule cannot drift between surfaces the way it did between comments and
-- item_comments.
--
-- Developer accounts are exempt, matching every other content rule on the
-- site — is_dev() is how staff post a genuine announcement with a link in it.
create or replace function public.dz_content_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_col  text := coalesce(nullif(TG_ARGV[0], ''), 'body');
  v_text text;
  v_row  json := row_to_json(NEW);
  v_dev  boolean := false;
begin
  v_text := v_row ->> v_col;
  if v_text is null or btrim(v_text) = '' then return NEW; end if;

  if to_regprocedure('public.is_dev()') is not null then
    begin v_dev := public.is_dev(); exception when others then v_dev := false; end;
  end if;
  if v_dev then return NEW; end if;

  if public.dz_has_link(v_text) then
    perform public.dz_log_abuse(TG_TABLE_NAME, 'link', v_col, v_text);
    -- Worded for a member, because a member is who normally trips it, and
    -- phrased to survive safeErr in js/app-core.js.
    raise exception 'Links aren''t allowed here — say it without the address.'
      using errcode = 'P0001';
  end if;

  if public.dz_phish_score(v_text) >= 2 then
    perform public.dz_log_abuse(TG_TABLE_NAME, 'phish', v_col, v_text);
    -- Dropped, not refused. See the note above dz_abuse_recent: returning NULL
    -- lets the transaction commit, which is the only way the log row survives,
    -- and it denies the sender any signal to iterate against.
    return null;
  end if;

  return NEW;
end $$;

-- ---- item_comments: the surface that was never covered ---------------------
-- INSERT and UPDATE both. An edit that turns an innocent comment into a
-- phishing one after the fact is the obvious way around an insert-only check.
drop trigger if exists dz_guard_insert_item_comments on public.item_comments;
create trigger dz_guard_insert_item_comments
  before insert on public.item_comments
  for each row execute function public.dz_content_guard('body');

drop trigger if exists dz_guard_update_item_comments on public.item_comments;
create trigger dz_guard_update_item_comments
  before update of body on public.item_comments
  for each row execute function public.dz_content_guard('body');

-- ---- the community rooms: same guard, replacing the evadable one ----------
-- enforce_community_links stays as a name because the trigger that calls it
-- was installed under that name in 20260815 and other deployments may still
-- reference it. The BODY is now the deobfuscating check, so `%2e` and its
-- family stop working here too, and a phish with no link at all is scored.
create or replace function public.enforce_community_links()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_dev boolean := false;
begin
  if NEW.comment_text is null or btrim(NEW.comment_text) = '' then return NEW; end if;

  if to_regprocedure('public.is_dev()') is not null then
    begin v_dev := public.is_dev(); exception when others then v_dev := false; end;
  end if;
  if v_dev then return NEW; end if;

  if public.dz_has_link(NEW.comment_text) then
    perform public.dz_log_abuse('comments', 'link', 'comment_text', NEW.comment_text);
    raise exception 'CM_NO_LINKS' using errcode = 'P0001';
  end if;

  if public.dz_phish_score(NEW.comment_text) >= 2 then
    perform public.dz_log_abuse('comments', 'phish', 'comment_text', NEW.comment_text);
    return null;   -- dropped, so the log row commits; see the note above
  end if;

  return NEW;
end $$;

-- ---- direct messages ------------------------------------------------------
-- dm_no_links already refused links here and is left alone; what it never did
-- is score the prose. A DM is where this attack goes next once comments are
-- shut, and it is the more dangerous surface of the two because the reader
-- believes they were singled out.
create or replace function public.dz_dm_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_dev boolean := false;
begin
  if NEW.content is null or btrim(NEW.content) = '' then return NEW; end if;

  if to_regprocedure('public.is_dev()') is not null then
    begin v_dev := public.is_dev(); exception when others then v_dev := false; end;
  end if;
  if v_dev then return NEW; end if;

  if public.dz_has_link(NEW.content) then
    perform public.dz_log_abuse('direct_messages', 'link', 'content', NEW.content);
    raise exception 'dm_no_links' using errcode = 'P0001';
  end if;

  if public.dz_phish_score(NEW.content) >= 2 then
    perform public.dz_log_abuse('direct_messages', 'phish', 'content', NEW.content);
    return null;   -- dropped, so the log row commits; see the note above
  end if;

  return NEW;
end $$;

drop trigger if exists dz_guard_insert_direct_messages on public.direct_messages;
create trigger dz_guard_insert_direct_messages
  before insert on public.direct_messages
  for each row execute function public.dz_dm_guard();

-- ---- everywhere else a member types prose that others read ----------------
-- A description, a bio, a listing title. These are lower-traffic than a
-- comment and were never the delivery route here, but they are read by
-- strangers and they were not checked either. The loop skips a table this
-- deployment does not have, and skips a column the table does not have, so
-- the same file runs against a partial schema without editing.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('artworks',          'description'),
      ('resources',         'description'),
      ('marketplace_items', 'description'),
      ('blog_posts',        'body'),
      ('jobs',              'description'),
      ('albums',            'name'),
      ('communities',       'description'),
      ('communities',       'rules'),
      ('item_reports',      'reason'),
      ('artwork_reports',   'details')
    ) as t(tbl, col)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = r.tbl and column_name = r.col
    ) then continue; end if;

    execute format('drop trigger if exists dz_guard_ins_%s_%s on public.%I',
                   r.tbl, r.col, r.tbl);
    execute format(
      'create trigger dz_guard_ins_%s_%s before insert on public.%I '||
      'for each row execute function public.dz_content_guard(%L)',
      r.tbl, r.col, r.tbl, r.col);

    execute format('drop trigger if exists dz_guard_upd_%s_%s on public.%I',
                   r.tbl, r.col, r.tbl);
    execute format(
      'create trigger dz_guard_upd_%s_%s before update of %I on public.%I '||
      'for each row execute function public.dz_content_guard(%L)',
      r.tbl, r.col, r.col, r.tbl, r.col);
  end loop;
end $$;


-- ===========================================================================
-- 6. LENGTH, SO A COMMENT CANNOT BE A DOCUMENT
-- ===========================================================================
-- The phishing comment ran to about 900 characters. A comment box on an
-- artwork page has no business carrying an essay, and an unbounded text column
-- is a free storage sink for anyone who wants one. A fact about the column
-- rather than logic in a trigger, exactly as 20260813 did for comments.
do $$
begin
  if to_regclass('public.item_comments') is not null then
    -- Widened rather than narrowed if anything already longer exists: the
    -- constraint is added NOT VALID first so a legacy row cannot block the
    -- deploy, then validated separately below.
    alter table public.item_comments drop constraint if exists item_comments_len_chk;
    alter table public.item_comments
      add constraint item_comments_len_chk
      check (char_length(body) between 1 and 1000) not valid;
  end if;
end $$;

-- Validating separately means a pre-existing over-long row surfaces as a
-- failure of THIS statement, which is safe to re-run after cleaning it up,
-- rather than as a failure of the ALTER that added the constraint.
do $$
begin
  if to_regclass('public.item_comments') is not null then
    begin
      alter table public.item_comments validate constraint item_comments_len_chk;
    exception when check_violation then
      raise notice 'item_comments has rows longer than 1000 chars; constraint '
                   'left NOT VALID and enforced on new writes only. See '
                   'security/INCIDENT-2026-08-phishing.md for the cleanup query.';
    end;
  end if;
end $$;
