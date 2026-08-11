-- Every message a member types goes through one gate
--
-- 20260809_write_rate_limits.sql put a fixed-window counter in front of
-- comments and direct_messages: 20 comments per 5 minutes, 30 messages per 5
-- minutes. Two things are wrong with that for a chat room.
--
-- It is too tight to hold a conversation in. Twenty messages in five minutes
-- is four a minute; two people talking quickly hit it while behaving
-- perfectly normally, and what they get is a refusal with no idea when it
-- lifts.
--
-- And a fixed window is the wrong shape. The bucket resets on a clock
-- boundary, so a script that sends its whole allowance at :59 and again at
-- :01 gets double the limit through in two seconds, and a member who sent
-- nothing for four minutes still cannot send at 4:59. The window has to
-- follow the member, not the clock.
--
-- So: a sliding window over an append-only event log, five bands deep.
--
--     5 in 10 seconds        a burst
--    30 in 1 minute          fast conversation
--   150 in 10 minutes        a long fast conversation
--   500 in 1 hour            a whole evening
--  3000 in 24 hours          more than anyone types in a day
--
-- plus 1000 characters a message, one second between messages, and thirty
-- seconds before the same text can be sent twice.
--
-- Why an event log rather than counting the message tables directly: a member
-- can delete their own messages now, and counting rows that can be deleted
-- means a spammer resets their own limit by cleaning up after themselves.
-- chat_rate_events is append-only and nothing deletes from it but the sweep.
--
-- WHAT HAPPENS WHEN A LIMIT IS HIT. Not a ban, and not a bare refusal. The
-- member is put on a cooldown that says how long it is, and the cooldowns
-- escalate only if they keep going: 10 seconds, 30 seconds, 2 minutes, 10
-- minutes, an hour. Strikes decay after an hour of behaving, so an ordinary
-- member who trips the burst limit once is never anywhere near the second
-- step. Somebody who keeps at it past the fifth strike gets muted in the
-- community they are doing it in, through the timeout_until column that
-- moderators already use and can_post_community already reads.
--
-- The character limit on a message and the four on a community's own text are
-- CHECK constraints rather than trigger logic: they are facts about the
-- column, and a constraint cannot be reasoned around.
--
-- WHY THE GATE CANCELS THE ROW INSTEAD OF RAISING. The first version of this
-- raised an exception, which aborted the statement — and took the cooldown row
-- the gate had just written down with it. The escalation never survived the
-- refusal that created it, so every strike was the first strike forever. A
-- BEFORE INSERT trigger that returns NULL drops its own row and leaves the
-- transaction standing, which is what lets the strike be recorded.
--
-- What a caller sees is an insert that comes back with no row. dz_chat_status()
-- then says why and for how long, and it says the same thing whether the caller
-- is the site or somebody posting to PostgREST by hand.

-- ---- the log ---------------------------------------------------------------
create table if not exists public.chat_rate_events (
  id         bigserial primary key,
  user_id    uuid        not null,
  scope      text        not null,   -- 'community' or 'dm'
  body_hash  text,                   -- md5 of the trimmed, lowercased text
  created_at timestamptz not null default now()
);
create index if not exists chat_rate_events_lookup
  on public.chat_rate_events (user_id, created_at desc);

alter table public.chat_rate_events enable row level security;
-- No policies on purpose. Only the SECURITY DEFINER functions below touch it;
-- a member has no reason to read their own audit trail and every reason not to
-- be able to write it.

-- ---- the cooldown state ----------------------------------------------------
create table if not exists public.chat_cooldowns (
  user_id        uuid primary key,
  strikes        int         not null default 0,
  until          timestamptz,
  last_strike_at timestamptz,
  reason         text
);
alter table public.chat_cooldowns enable row level security;

-- ---- the gate --------------------------------------------------------------
-- Returns true to let the row through, false to drop it. Everything it needs
-- to say afterwards is in chat_cooldowns, which is why it can be dropped
-- rather than raised over.
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
  -- the schedulers and any service-role work are not what this is for
  if v_uid is null then return true; end if;

  -- an active cooldown answers before anything else
  select * into v_cd from public.chat_cooldowns where user_id = v_uid;
  if v_cd.until is not null and v_cd.until > v_now then
    return false;
  end if;

  v_hash := md5(lower(btrim(coalesce(p_text, ''))));

  -- the same text twice. Not a strike: saying something twice by accident is a
  -- slip, and the bands below catch it if it is not. Case and surrounding
  -- space are normalised away, so "ok" and "  OK " are the same message.
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

  -- one second between messages
  select max(created_at) into v_last
    from public.chat_rate_events where user_id = v_uid;
  if v_last is not null and v_last > v_now - interval '1 second' then
    v_reason := 'You are sending faster than one message a second';
  end if;

  -- the five sliding bands, widest first so the message names the band that
  -- actually bit rather than always naming the ten-second one
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

  -- a limit was hit: cool down, escalating only on repeats
  if v_reason is not null then
    v_strikes := coalesce(v_cd.strikes, 0);
    -- an hour of behaving clears the record
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

    -- past the fifth strike, hand it to the machinery moderators already use:
    -- an hour muted in the room it is happening in, through the same
    -- timeout_until column can_post_community already reads
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

  -- the log only has to answer questions about the last day, and this keeps it
  -- that size without a cron job
  if random() < 0.002 then
    delete from public.chat_rate_events where created_at < v_now - interval '25 hours';
    delete from public.chat_cooldowns
     where coalesce(until, last_strike_at) < v_now - interval '2 hours';
  end if;
  return true;
end $$;

-- ---- what a member can ask about their own cooldown ------------------------
-- The composer counts down from this rather than guessing, and it is the one
-- thing about their own state a member is entitled to.
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

-- ---- the two triggers ------------------------------------------------------
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
  return null;   -- the row is dropped; the transaction, and the strike, stand
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

-- The fixed-window counters these replace. Leaving them on would mean the
-- tighter of the two always decides, and the tighter of the two is the one
-- being removed for being wrong.
drop trigger if exists dz_rate_insert_comments on public.comments;
drop trigger if exists dz_rate_insert_direct_messages on public.direct_messages;

-- ---- lengths ---------------------------------------------------------------
-- Facts about the column rather than logic in a trigger. A message is 1000
-- characters; a community's own text is as long as the form says it is, and
-- the form is no longer the only thing saying so.
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
