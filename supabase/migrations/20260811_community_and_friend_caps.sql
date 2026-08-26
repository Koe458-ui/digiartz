create or replace function public.cm_member_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max int := 50;
  v_n   int;
begin
  if exists (select 1 from public.community_members
              where community_id = new.community_id and user_id = new.user_id) then
    return new;
  end if;

  select count(*) into v_n
    from public.community_members
   where user_id = new.user_id and not banned;

  if v_n >= v_max then
    raise exception 'CM_MAX_JOINED' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists cm_member_cap_ins on public.community_members;
create trigger cm_member_cap_ins
  before insert on public.community_members
  for each row execute function public.cm_member_cap();

create or replace function public.fr_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_max_friends int := 200;
  v_max_pending int := 100;
  v_n           int;
begin
  if new.status = 'accepted'
     and (TG_OP = 'INSERT' or old.status is distinct from 'accepted') then

    select count(*) into v_n from public.friendships
     where status = 'accepted'
       and (requester_id = new.requester_id or addressee_id = new.requester_id);
    if v_n >= v_max_friends then
      raise exception 'FR_MAX_FRIENDS' using errcode = 'P0001';
    end if;

    select count(*) into v_n from public.friendships
     where status = 'accepted'
       and (requester_id = new.addressee_id or addressee_id = new.addressee_id);
    if v_n >= v_max_friends then
      raise exception 'FR_MAX_FRIENDS' using errcode = 'P0001';
    end if;
  end if;

  if TG_OP = 'INSERT' and new.status = 'pending' then
    select count(*) into v_n from public.friendships
     where status = 'pending' and requester_id = new.requester_id;
    if v_n >= v_max_pending then
      raise exception 'FR_MAX_PENDING' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists fr_cap_ins on public.friendships;
create trigger fr_cap_ins
  before insert on public.friendships
  for each row execute function public.fr_cap();

drop trigger if exists fr_cap_upd on public.friendships;
create trigger fr_cap_upd
  before update on public.friendships
  for each row execute function public.fr_cap();

do $$
declare r record;
begin
  for r in
    select * from (values
      ('friendships',        'INSERT', 'friend requests',      30,  3600),
      ('friendships',        'UPDATE', 'friend actions',       60,  3600),
      ('communities',        'INSERT', 'communities',           5,  3600),
      ('communities',        'UPDATE', 'community edits',      60,  3600),
      ('community_members',  'INSERT', 'community joins',      20,  3600),
      ('community_members',  'UPDATE', 'member changes',      120,  3600)
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
