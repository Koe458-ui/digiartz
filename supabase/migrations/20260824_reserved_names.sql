-- Nobody gets to be called DigiArtz
--
-- The phishing comment worked because of the name on it. Read the body on its
-- own and it is a badly punctuated form letter; read it under the word
-- "DigiArtzSupport" and it is a notice from the site. The account was
-- registered at 21:58 on 2026-08-20 and posted its first comment at 22:00 —
-- two minutes, because claiming that name took no more effort than typing it.
--
-- A username is an identity claim, and there is a small set of them that only
-- the site is entitled to make. Those are reserved here, and the check runs on
-- the DEOBFUSCATED name, so the next attempt cannot simply be spelled
-- "D1giArtz_Support" or "DigiArtz Support" or "ⅮigiArtzSupport" with a Roman
-- numeral D.
--
-- Two rules, deliberately different in kind:
--
--   THE BRAND. Any name containing "digiartz" is refused outright. There is no
--   legitimate member account with our own name in it, and every false
--   positive here costs somebody one retype while every miss costs a reader
--   their password.
--
--   THE ROLES. "support", "admin", "moderator" and their family are refused as
--   the WHOLE name, not as a substring. "support" is reserved; "supportive_art"
--   is somebody's handle and always was. Substring matching on these would
--   refuse half the dictionary.

-- ===========================================================================
-- 1. THE LIST
-- ===========================================================================
-- A table rather than an array in a function body, so a name can be reserved
-- at 3am without a migration. Staff-writable only; no member-facing policy
-- exists, and RLS is on.
create table if not exists public.reserved_names (
  name       text primary key,          -- already folded, see dz_fold_name
  mode       text not null default 'exact'
             check (mode in ('exact', 'contains')),
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.reserved_names enable row level security;
revoke all on public.reserved_names from anon, authenticated;

insert into public.reserved_names (name, mode, reason) values
  -- the brand, matched anywhere in the name
  ('digiartz',      'contains', 'the site itself'),
  ('digiart',       'contains', 'one keystroke from the site itself'),
  ('digartz',       'contains', 'transposition of the site name'),
  ('diqiartz',      'contains', 'q-for-g homoglyph of the site name'),
  -- role claims, matched as the whole name
  ('support',       'exact', 'implies the site is speaking'),
  ('supportteam',   'exact', 'implies the site is speaking'),
  ('helpdesk',      'exact', 'implies the site is speaking'),
  ('help',          'exact', 'implies the site is speaking'),
  ('admin',         'exact', 'implies the site is speaking'),
  ('administrator', 'exact', 'implies the site is speaking'),
  ('moderator',     'exact', 'implies the site is speaking'),
  ('mod',           'exact', 'implies the site is speaking'),
  ('staff',         'exact', 'implies the site is speaking'),
  ('team',          'exact', 'implies the site is speaking'),
  ('official',      'exact', 'implies the site is speaking'),
  ('verify',        'exact', 'the exact verb this attack uses'),
  ('verification',  'exact', 'the exact noun this attack uses'),
  ('security',      'exact', 'implies the site is speaking'),
  ('billing',       'exact', 'implies the site is speaking'),
  ('payments',      'exact', 'implies the site is speaking'),
  ('payment',       'exact', 'implies the site is speaking'),
  ('noreply',       'exact', 'implies the site is speaking'),
  ('donotreply',    'exact', 'implies the site is speaking'),
  ('system',        'exact', 'implies the site is speaking'),
  ('root',          'exact', 'implies the site is speaking'),
  ('owner',         'exact', 'implies the site is speaking'),
  ('founder',       'exact', 'implies the site is speaking'),
  ('ceo',           'exact', 'implies the site is speaking'),
  ('info',          'exact', 'implies the site is speaking'),
  ('contact',       'exact', 'implies the site is speaking'),
  ('service',       'exact', 'implies the site is speaking'),
  ('customercare',  'exact', 'implies the site is speaking'),
  ('customerservice','exact','implies the site is speaking'),
  ('zeo',           'exact', 'the site assistant')
on conflict (name) do nothing;


-- ===========================================================================
-- 2. FOLDING A NAME TO WHAT IT LOOKS LIKE
-- ===========================================================================
-- dz_deobfuscate already maps homoglyphs, fullwidth characters and invisible
-- ones. On top of that a name gets its separators and its leetspeak removed,
-- because "d1gi-artz_support" and "DigiArtzSupport" are the same claim.
--
-- Digits fold to letters only when the name still reads as a word afterwards;
-- that is what the leet map does. A name that is genuinely mostly digits is
-- untouched by it and matches nothing in the list anyway.
create or replace function public.dz_fold_name(p_name text)
returns text
language sql
immutable
as $$
  select translate(
           regexp_replace(public.dz_deobfuscate(p_name), '[^a-z0-9]+', '', 'g'),
           '0134578',
           'oieasrt'
         );
$$;


-- ===========================================================================
-- 3. IS THIS NAME SOMEBODY ELSE'S TO USE
-- ===========================================================================
create or replace function public.dz_name_reserved(p_name text)
returns text                       -- the matched reservation, or NULL
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_folded text := public.dz_fold_name(p_name);
  v_hit    text;
begin
  if v_folded is null or v_folded = '' then return null; end if;

  select r.name into v_hit
    from public.reserved_names r
   where (r.mode = 'exact'    and v_folded = r.name)
      or (r.mode = 'contains' and position(r.name in v_folded) > 0)
   order by length(r.name) desc
   limit 1;

  return v_hit;
end $$;


-- ===========================================================================
-- 4. THE TRIGGER
-- ===========================================================================
-- Fires on insert, and on update only when the name actually CHANGES. That
-- distinction matters: an existing member whose handle happens to sit on the
-- list must still be able to save the rest of their profile. Their name is
-- grandfathered until they touch it, and the sweep at the bottom of this file
-- reports anyone in that position so it is a decision rather than a surprise.
--
-- Developers are exempt, so the site can run its own announcement account.
create or replace function public.dz_guard_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hit text;
  v_dev boolean := false;
begin
  if to_regprocedure('public.is_dev()') is not null then
    begin v_dev := public.is_dev(); exception when others then v_dev := false; end;
  end if;
  if v_dev then return NEW; end if;

  -- username
  if TG_OP = 'INSERT' or NEW.username is distinct from OLD.username then
    v_hit := public.dz_name_reserved(NEW.username);
    if v_hit is not null then
      -- Not logged, and deliberately: this path RAISES, and an exception rolls
      -- back the audit row along with everything else. See the note above
      -- dz_abuse_recent in 20260824_antiphish_content_guard.sql. A member
      -- needs to be told their chosen name is taken, so refusing wins over
      -- recording here.
      raise exception 'That name is reserved — pick another.'
        using errcode = 'P0001';
    end if;
  end if;

  -- display_name, which is what a comment actually renders when it is set
  if to_jsonb(NEW) ? 'display_name'
     and (TG_OP = 'INSERT' or NEW.display_name is distinct from OLD.display_name) then
    v_hit := public.dz_name_reserved(NEW.display_name);
    if v_hit is not null then
      raise exception 'That display name is reserved — pick another.'
        using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end $$;

drop trigger if exists dz_guard_identity_ins on public.profiles;
create trigger dz_guard_identity_ins
  before insert on public.profiles
  for each row execute function public.dz_guard_identity();

drop trigger if exists dz_guard_identity_upd on public.profiles;
create trigger dz_guard_identity_upd
  before update on public.profiles
  for each row execute function public.dz_guard_identity();


-- ===========================================================================
-- 5. WHO IS ALREADY WEARING ONE
-- ===========================================================================
-- Reports rather than deletes. Renaming somebody out from under themselves is
-- a support conversation, not a migration — except for the brand rule, where
-- there is nothing to discuss, and the sweep below is the query to run.
--
--   select id, username, public.dz_name_reserved(username) as matched
--     from public.profiles
--    where public.dz_name_reserved(username) is not null;
--
do $$
declare
  v_n int;
begin
  select count(*) into v_n
    from public.profiles
   where public.dz_name_reserved(username) is not null;

  if v_n > 0 then
    raise notice '% existing profile(s) hold a now-reserved name. They are '
                 'grandfathered until they next change it. Run the query in '
                 'section 5 of this file to list them.', v_n;
  end if;
end $$;
