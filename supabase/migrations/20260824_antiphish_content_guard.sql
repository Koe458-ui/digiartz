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

  t := replace(t, '%25', '%');
  t := replace(t, '%25', '%');
  t := replace(t, '%2e', '.');
  t := replace(t, '%2f', '/');
  t := replace(t, '%3a', ':');
  t := replace(t, '%40', '@');
  t := replace(t, '&#46;', '.');
  t := replace(t, '&period;', '.');
  t := replace(t, '&#x2e;', '.');

  t := regexp_replace(
         t,
         '[' || E'­​‌‍‎‏‪‫‬' ||
                E'‭‮⁠⁡⁢⁣⁤﻿' || ']',
         '', 'g');

  t := translate(
         t,
         E'․．。﹒۔܁∙⋅·•ꓸ',
         '...........');

  t := translate(
         t,
         E'ａｂｃｄｅｆｇｈｉｊｋ' ||
         E'ｌｍｎｏｐｑｒｓｔｕｖ' ||
         E'ｗｘｙｚ０１２３４５６' ||
         E'７８９：／＠',
         'abcdefghijklmnopqrstuvwxyz0123456789:/@');

  t := translate(
         t,
         E'аеорсхуѕіј' ||
         E'ӏԛԁһɡορυνα' ||
         E'τκηΒΕ',
         'aeopcxysijldqdhgopvnatkhbe');

  t := translate(
         t,
         E'àáâãäåèéêë' ||
         E'ìíîïòóôõöù' ||
         E'úûüýÿñç',
         'aaaaaaeeeeiiiiooooouuuuyync');

  t := regexp_replace(t, '\s*[\(\[\{<]\s*(dot|punto|punkt|d0t|daht)\s*[\)\]\}>]\s*', '.', 'g');
  t := regexp_replace(t, '\s*[\(\[\{<]\s*\.\s*[\)\]\}>]\s*', '.', 'g');
  t := regexp_replace(t, '\s+(dot|punto|punkt|d0t|daht)\s+', '.', 'g');
  t := regexp_replace(t, '\s*[\(\[\{<]\s*(at|arroba)\s*[\)\]\}>]\s*', '@', 'g');
  t := regexp_replace(t, '\s+(at|arroba)\s+(?=[a-z0-9._-]+\.[a-z]{2,})', '@', 'g');

  t := regexp_replace(t, 'h[x*#]{2}ps?', 'http', 'g');
  t := regexp_replace(t, 'h\s*t\s*t\s*p\s*s?\s*(?=:)', 'http', 'g');

  t := regexp_replace(t, '\s+\.\s*', '.', 'g');
  t := regexp_replace(t, '\s+@\s*', '@', 'g');
  t := regexp_replace(t, '\s*:\s*//', '://', 'g');
  t := regexp_replace(t, '(?<=[a-z0-9])\s*/\s*(?=[a-z0-9])', '/', 'g');

  t := regexp_replace(t, '\.{2,}', '.', 'g');

  return t;
end $$;

comment on function public.dz_deobfuscate(text) is
  'Folds a string back to the form a browser would resolve it to: percent-'
  'escapes decoded, invisible characters dropped, homoglyph and fullwidth '
  'characters mapped to latin, "[dot]"/" dot " written as a dot, whitespace '
  'around structural characters removed. Every link check on the site matches '
  'against this rather than against what was typed.';

create or replace function public.dz_has_link(p_text text)
returns boolean
language plpgsql
immutable
as $$
declare
  t text := public.dz_deobfuscate(p_text);
begin
  if t = '' then return false; end if;

  if t ~ '\y(https?|ftps?|ws{1,2}s?|data|javascript|magnet|tel|mailto)\s*:' then
    return true;
  end if;

  if t ~ '\ywww\.[a-z0-9-]' then return true; end if;

  if t ~ ('\y[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9-]{1,63})*\.(' ||
          'com|net|org|info|biz|online|site|shop|store|app|dev|link|live|club|' ||
          'fun|top|vip|pro|xyz|icu|cyou|monster|quest|rest|cfd|sbs|bond|' ||
          'io|co|in|me|gg|tv|ly|to|cc|ru|su|ua|by|kz|cn|hk|tk|ml|ga|cf|gq|' ||
          'uk|us|ca|au|de|fr|jp|br|es|it|nl|se|pl|tr|ir|pk|bd|lk|np|ph|id|vn|' ||
          'work|click|download|review|country|stream|gdn|racing|win|' ||
          'page|space|website|host|press|fund|cash|money|credit|loan|finance' ||
          ')\y') then
    return true;
  end if;

  if t ~ '\y[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\y' then return true; end if;

  if t ~ '\y(\d{1,3}\.){3}\d{1,3}(:\d+)?(/|\y)' then return true; end if;

  return false;
end $$;

create or replace function public.dz_phish_score(p_text text)
returns int
language plpgsql
immutable
as $$
declare
  t text := regexp_replace(public.dz_deobfuscate(p_text), '[^a-z0-9@:/. ]+', ' ', 'g');
  n int := 0;
  pat text;
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

create table if not exists public.dz_abuse_events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid        references auth.users(id) on delete set null,
  ip          text,
  surface     text        not null,
  rule        text        not null,
  detail      text,
  sample      text
);
create index if not exists dz_abuse_events_time_idx
  on public.dz_abuse_events (created_at desc);
create index if not exists dz_abuse_events_user_idx
  on public.dz_abuse_events (user_id, created_at desc);
alter table public.dz_abuse_events enable row level security;
revoke all on public.dz_abuse_events from anon, authenticated;

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
  return;
end $$;

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
    raise exception 'Links aren''t allowed here — say it without the address.'
      using errcode = 'P0001';
  end if;

  if public.dz_phish_score(v_text) >= 2 then
    perform public.dz_log_abuse(TG_TABLE_NAME, 'phish', v_col, v_text);
    return null;
  end if;

  return NEW;
end $$;

drop trigger if exists dz_guard_insert_item_comments on public.item_comments;
create trigger dz_guard_insert_item_comments
  before insert on public.item_comments
  for each row execute function public.dz_content_guard('body');

drop trigger if exists dz_guard_update_item_comments on public.item_comments;
create trigger dz_guard_update_item_comments
  before update of body on public.item_comments
  for each row execute function public.dz_content_guard('body');

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
    return null;
  end if;

  return NEW;
end $$;

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
    return null;
  end if;

  return NEW;
end $$;

drop trigger if exists dz_guard_insert_direct_messages on public.direct_messages;
create trigger dz_guard_insert_direct_messages
  before insert on public.direct_messages
  for each row execute function public.dz_dm_guard();

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

do $$
begin
  if to_regclass('public.item_comments') is not null then
    alter table public.item_comments drop constraint if exists item_comments_len_chk;
    alter table public.item_comments
      add constraint item_comments_len_chk
      check (char_length(body) between 1 and 1000) not valid;
  end if;
end $$;

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
