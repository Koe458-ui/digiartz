create table if not exists public.chat_rate_events (
  id         bigserial primary key,
  user_id    uuid        not null,
  scope      text        not null,
  body_hash  text,
  created_at timestamptz not null default now()
);
create index if not exists chat_rate_events_lookup
  on public.chat_rate_events (user_id, created_at desc);

alter table public.chat_rate_events enable row level security;

create table if not exists public.chat_cooldowns (
  user_id        uuid primary key,
  strikes        int         not null default 0,
  until          timestamptz,
  last_strike_at timestamptz,
  reason         text
);
alter table public.chat_cooldowns enable row level security;

create or replace function public.dz_chat_gate(
  p_scope text, p_text text, p_channel text default null
) returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid     uuid := auth.uid();
  v_hash    text;
  v_now     timestamptz := clock_timestamp();
  v_cd      record;
  v_last    timestamptz;
  v_dupe    timestamptz;
  v_strikes int;
  v_wait    int;
  v_reason  text := null;
  v_cid     uuid;
begin
  if v_uid is null then return true; end if;

  select * into v_cd from public.chat_cooldowns where user_id = v_uid;
  if v_cd.until is not null and v_cd.until > v_now then
    return false;
  end if;

  v_hash := md5(lower(btrim(coalesce(p_text, ''))));

  select max(created_at) into v_dupe from public.chat_rate_events e
   where e.user_id = v_uid and e.body_hash = v_hash
     and e.created_at > v_now - interval '30 seconds';
  if v_dupe is not null then
    insert into public.chat_cooldowns (user_id, strikes, until, last_strike_at, reason)
    values (v_uid, coalesce(v_cd.strikes, 0), v_dupe + interval '30 seconds',
            v_cd.last_strike_at, 'You just sent that')
    on conflict (user_id) do update
      set until = excluded.until, reason = excluded.reason;
    return false;
  end if;

  select max(created_at) into v_last
    from public.chat_rate_events where user_id = v_uid;
  if v_last is not null and v_last > v_now - interval '1 second' then
    v_reason := 'You are sending faster than one message a second';
  end if;

  if v_reason is null then
    if (select count(*) from public.chat_rate_events
         where user_id = v_uid and created_at > v_now - interval '24 hours') >= 3000 then
      v_reason := 'That is 3000 messages today';
    elsif (select count(*) from public.chat_rate_events
            where user_id = v_uid and created_at > v_now - interval '1 hour') >= 500 then
      v_reason := 'That is 500 messages in an hour';
    elsif (select count(*) from public.chat_rate_events
            where user_id = v_uid and created_at > v_now - interval '10 minutes') >= 150 then
      v_reason := 'That is 150 messages in ten minutes';
    elsif (select count(*) from public.chat_rate_events
            where user_id = v_uid and created_at > v_now - interval '1 minute') >= 30 then
      v_reason := 'That is 30 messages in a minute';
    elsif (select count(*) from public.chat_rate_events
            where user_id = v_uid and created_at > v_now - interval '10 seconds') >= 5 then
      v_reason := 'That is 5 messages in ten seconds';
    end if;
  end if;

  if v_reason is not null then
    v_strikes := coalesce(v_cd.strikes, 0);
    if v_cd.last_strike_at is null or v_cd.last_strike_at < v_now - interval '1 hour' then
      v_strikes := 0;
    end if;
    v_strikes := v_strikes + 1;
    v_wait := case least(v_strikes, 5)
                when 1 then 10 when 2 then 30 when 3 then 120
                when 4 then 600 else 3600 end;

    insert into public.chat_cooldowns (user_id, strikes, until, last_strike_at, reason)
    values (v_uid, v_strikes, v_now + make_interval(secs => v_wait), v_now, v_reason)
    on conflict (user_id) do update
      set strikes = excluded.strikes, until = excluded.until,
          last_strike_at = excluded.last_strike_at, reason = excluded.reason;

    if v_strikes > 5 and p_channel is not null then
      v_cid := public.community_channel_id(p_channel);
      if v_cid is not null then
        update public.community_members
           set timeout_until = greatest(coalesce(timeout_until, v_now), v_now + interval '1 hour')
         where community_id = v_cid and user_id = v_uid;
      end if;
    end if;
    return false;
  end if;

  insert into public.chat_rate_events (user_id, scope, body_hash)
  values (v_uid, p_scope, v_hash);

  if random() < 0.002 then
    delete from public.chat_rate_events where created_at < v_now - interval '25 hours';
    delete from public.chat_cooldowns
     where coalesce(until, last_strike_at) < v_now - interval '2 hours';
  end if;
  return true;
end $$;

create or replace function public.dz_chat_status()
returns table (cooldown_seconds int, strikes int, reason text)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    greatest(0, coalesce(ceil(extract(epoch from (c.until - now())))::int, 0)),
    coalesce(c.strikes, 0),
    c.reason
  from (select 1) one
  left join public.chat_cooldowns c on c.user_id = auth.uid()
$$;

create or replace function public.dz_chat_gate_comments()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.dz_chat_gate('community', new.comment_text, new.channel) then
    return new;
  end if;
  return null;
end $$;

create or replace function public.dz_chat_gate_dm()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if public.dz_chat_gate('dm', new.content, null) then
    return new;
  end if;
  return null;
end $$;

drop trigger if exists dz_chat_gate_ins on public.comments;
create trigger dz_chat_gate_ins
  before insert on public.comments
  for each row execute function public.dz_chat_gate_comments();

drop trigger if exists dz_chat_gate_ins on public.direct_messages;
create trigger dz_chat_gate_ins
  before insert on public.direct_messages
  for each row execute function public.dz_chat_gate_dm();

drop trigger if exists dz_rate_insert_comments on public.comments;
drop trigger if exists dz_rate_insert_direct_messages on public.direct_messages;

alter table public.comments drop constraint if exists comments_len_chk;
alter table public.comments add constraint comments_len_chk
  check (char_length(comment_text) between 1 and 1000);

alter table public.direct_messages drop constraint if exists direct_messages_len_chk;
alter table public.direct_messages add constraint direct_messages_len_chk
  check (char_length(content) between 1 and 1000);

alter table public.communities drop constraint if exists communities_text_len_chk;
alter table public.communities add constraint communities_text_len_chk
  check (
        char_length(btrim(name)) between 3 and 40
    and char_length(coalesce(short_description, '')) <= 120
    and char_length(coalesce(description, ''))       <= 500
    and char_length(coalesce(rules, ''))             <= 2000
  );
