create or replace function public.dz_content_fingerprint(p_text text)
returns text
language sql
immutable
as $$
  select case
           when length(regexp_replace(public.dz_deobfuscate(p_text), '[^a-z0-9]+', '', 'g')) < 30
             then null
           else md5(regexp_replace(public.dz_deobfuscate(p_text), '[^a-z0-9]+', '', 'g'))
         end;
$$;

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
  if v_uid is null then return NEW; end if;

  if to_regprocedure('public.is_dev()') is not null then
    begin v_dev := public.is_dev(); exception when others then v_dev := false; end;
  end if;
  if v_dev then return NEW; end if;

  v_text := v_row ->> v_col;
  v_fp := public.dz_content_fingerprint(v_text);
  if v_fp is null then return NEW; end if;

  insert into public.content_repeats (user_id, fingerprint)
  values (v_uid, v_fp)
  on conflict (user_id, fingerprint) do update
    set n       = case when public.content_repeats.last_at < now() - interval '6 hours'
                       then 1
                       else public.content_repeats.n + 1 end,
        last_at = now()
  returning n into v_n;

  if v_n < v_limit then return NEW; end if;

  if not public.dz_is_banned(v_uid) then
    insert into public.user_bans (user_id, reason, note, banned_by, expires_at)
    values (v_uid,
            'spam',
            'Automatic: the same message posted ' || v_n || ' times (' ||
              TG_TABLE_NAME || '.' || v_col || ')',
            null,
            now() + interval '1 day');
  end if;

  if to_regprocedure('public.dz_log_abuse(text,text,text,text)') is not null then
    perform public.dz_log_abuse(TG_TABLE_NAME, 'repeat',
                                'n=' || v_n || ' auto-ban 1 day', v_text);
  end if;

  return null;
end $$;

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
    execute format('drop trigger if exists zz_dz_repeat_%s on public.%I', r.tbl, r.tbl);
    execute format(
      'create trigger zz_dz_repeat_%s before insert on public.%I '||
      'for each row execute function public.dz_repeat_guard(%L, %L)',
      r.tbl, r.tbl, r.col, '5');
  end loop;
end $$;

create or replace function public.dz_sweep_repeats()
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  delete from public.content_repeats where last_at < now() - interval '2 days';
$$;
revoke all on function public.dz_sweep_repeats() from public, anon, authenticated;
