create table if not exists public.reserved_names (
  name       text primary key,
  mode       text not null default 'exact'
             check (mode in ('exact', 'contains')),
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.reserved_names enable row level security;
revoke all on public.reserved_names from anon, authenticated;

insert into public.reserved_names (name, mode, reason) values
  ('digiartz',      'contains', 'the site itself'),
  ('digiart',       'contains', 'one keystroke from the site itself'),
  ('digartz',       'contains', 'transposition of the site name'),
  ('diqiartz',      'contains', 'q-for-g homoglyph of the site name'),
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

create or replace function public.dz_name_reserved(p_name text)
returns text
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

  if TG_OP = 'INSERT' or NEW.username is distinct from OLD.username then
    v_hit := public.dz_name_reserved(NEW.username);
    if v_hit is not null then
      raise exception 'That name is reserved — pick another.'
        using errcode = 'P0001';
    end if;
  end if;

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
