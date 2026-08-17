-- What a Max subscription actually buys, written where it is enforced
--
-- Max was a bigger download allowance and a badge. It is five things now, and
-- three of them are decided here because a client cannot be trusted with any
-- of them: the seller's share of a sale, the right to a second community, and
-- what happens to that community when the subscription lapses. The other two —
-- a 25MB image and a 400MB package — are size gates, and they live with the
-- signer that refuses the bytes.
--
-- Everything here keys off public.dz_effective_tier(uid), which already
-- returns 'guest' the moment subscription_expires_at passes. Nothing added
-- below reads subscription_tier directly, so an expired Max is not Max
-- anywhere, and there is one definition of "is this member on Max" rather
-- than five that can drift.

-- ===========================================================================
-- 1. THE SELLER'S SHARE — 90% on Max, 85% otherwise
-- ===========================================================================
-- The rate goes in the config table beside the one it replaces, because that
-- is where this schema keeps rates, and because a percentage written into a
-- trigger body is a percentage nobody can find.
alter table public.platform_tax_config
  add column if not exists max_commission_bps integer not null default 1000;

comment on column public.platform_tax_config.max_commission_bps is
  'The platform cut on a sale by a seller whose effective tier is max, in '
  'basis points. 1000 = 10%, so the seller keeps 90%. commission_bps is the '
  'rate for everyone else.';

-- The whole function is restated rather than patched: it is a single BEFORE
-- INSERT trigger and the version in 20260802_money_flow.sql is the only other
-- copy of it. One line differs — fee_bps now asks which tier the seller was on
-- at the moment of the sale.
create or replace function public.dz_earning_apply_deductions()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cfg        public.platform_tax_config%rowtype;
  v_tax      record;
  v_win      record;
  v_scope    text;
  v_rate     numeric(18,8);
  v_scale    integer;
  v_country  text;
  v_pan      text;
  v_indiv    boolean;
  v_fy_gross bigint;
  v_after_gw bigint;
begin
  select * into cfg from public.platform_tax_config where id = 1;
  if not found then raise exception 'platform_tax_config is missing'; end if;

  v_scale := case when new.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end;

  new.gateway_fee := greatest(coalesce(new.gateway_fee, 0), 0);
  v_after_gw      := new.gross_amount - new.gateway_fee;
  if v_after_gw < 0 then raise exception 'gateway fee exceeds the sale'; end if;

  -- ---- our commission ------------------------------------------------------
  -- Read at the moment the earning is written, which is the moment of the
  -- sale, and frozen into the row by fee_bps. A seller who lets Max lapse
  -- keeps the 90% on everything they had already sold — the row is a record of
  -- a transaction, not a live lookup — and a seller who buys Max gets it on
  -- the next sale and not retroactively on the last one.
  new.fee_bps := coalesce(
    nullif(new.fee_bps, 0),
    case when public.dz_effective_tier(new.seller_id) = 'max'
         then cfg.max_commission_bps
         else cfg.commission_bps end);
  new.fee_amount := round(new.gross_amount::numeric * new.fee_bps / 10000);

  select country, pan, is_individual into v_tax
    from public.seller_tax where user_id = new.seller_id;
  v_country := coalesce(v_tax.country, 'IN');
  v_pan     := v_tax.pan;
  v_indiv   := coalesce(v_tax.is_individual, true);

  if v_country <> 'IN' then
    new.tds_bps := 0;
  elsif v_pan is null or v_pan = '' then
    new.tds_bps := cfg.tds_no_pan_bps;
  elsif v_indiv then
    v_fy_gross := public.dz_fy_gross(new.seller_id);
    new.tds_bps := case when v_fy_gross <= cfg.tds_floor_inr then 0 else cfg.tds_bps end;
  else
    new.tds_bps := cfg.tds_bps;
  end if;
  new.tds_amount := round(new.gross_amount::numeric * new.tds_bps / 10000);

  if cfg.tcs_active and v_country = 'IN' then
    new.tcs_bps    := cfg.tcs_bps;
    new.tcs_amount := round(new.gross_amount::numeric * cfg.tcs_bps / 10000);
  else
    new.tcs_bps    := 0;
    new.tcs_amount := 0;
  end if;

  new.net_amount := v_after_gw - new.fee_amount - new.tds_amount - new.tcs_amount;
  if new.net_amount < 0 then
    new.fee_amount := greatest(v_after_gw - new.tds_amount - new.tcs_amount, 0);
    new.net_amount := v_after_gw - new.fee_amount - new.tds_amount - new.tcs_amount;
  end if;
  if new.net_amount < 0 then raise exception 'deductions exceed the sale value'; end if;

  v_scope := case
    when new.provider = 'razorpay' and new.currency = 'INR' then 'domestic'
    when new.provider = 'razorpay' then 'international'
    else 'any' end;

  select * into v_win from public.settlement_windows
   where provider = coalesce(new.provider, 'paypal') and scope = v_scope;
  if not found then
    select * into v_win from public.settlement_windows
     where provider = coalesce(new.provider, 'paypal') and scope = 'any';
  end if;

  if found then
    new.available_at := case when v_win.business
      then public.dz_add_business_days(now(), v_win.days)
      else now() + (v_win.days || ' days')::interval end;
    new.settlement_note := v_win.label;
  else
    new.available_at := public.dz_add_business_days(now(), 7);
    new.settlement_note := 'Settling';
  end if;

  select inr_rate into v_rate from public.fx_rates where code = new.currency;
  if v_rate is not null then
    new.fx_inr_rate := v_rate;
    new.fee_inr     := round(new.fee_amount * v_rate * v_scale);
  end if;

  return new;
end $function$;

-- ===========================================================================
-- 2. THE SECOND COMMUNITY, AND WHAT HAPPENS WHEN IT IS NOT PAID FOR
-- ===========================================================================
-- One column decides which of an artist's communities is the subscription's.
-- It is set at creation and never moves: the alternative — "the newest one is
-- the paid one" — reshuffles which room dies every time somebody creates or
-- deletes another, and a member cannot be told in advance which room that is.
alter table public.communities
  add column if not exists plan_backed boolean not null default false;

comment on column public.communities.plan_backed is
  'True when this community exists because its owner was on Max. It stays up '
  'for three days after the subscription lapses and is locked after that. '
  'False is a community earned with artist level 100, which no subscription '
  'can take away.';

-- How long a lapsed Max keeps its community. Three days, in one place.
create or replace function public.cm_grace_days()
returns integer language sql immutable
as $$ select 3 $$;

-- ---- the state of one community -------------------------------------------
-- 'live'   — nothing is wrong, or the community was never plan backed
-- 'grace'  — the subscription lapsed under three days ago. Everything still
--            works; the app says it has ended and offers renewal.
-- 'locked' — the grace ran out. Nobody may join it and nobody may post in it.
--
-- Nothing is written when the state changes. The state IS the owner's
-- subscription expiry compared with now(), so there is no job to run, no
-- column to keep in step, and no window in which a lapsed community is still
-- open because a cron has not fired yet. Renewing is equally immediate: the
-- expiry moves and the room is live again in the same instant, which is what
-- "3 days to renew" has to mean to be worth offering.
create or replace function public.cm_state(cid uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when c.id is null                     then 'locked'   -- no such community
    when not c.plan_backed                then 'live'
    when public.dz_effective_tier(c.owner_id) = 'max' then 'live'
    when p.subscription_expires_at is null then 'locked'  -- never had one
    when p.subscription_expires_at
         + (public.cm_grace_days() || ' days')::interval > now() then 'grace'
    else 'locked'
  end
  from (select cid as id) q
  left join public.communities c on c.id = q.id
  left join public.profiles    p on p.id = c.owner_id;
$function$;

grant execute on function public.cm_state(uuid) to anon, authenticated;

comment on function public.cm_state(uuid) is
  'live | grace | locked. The app asks this before opening a community; '
  'cm_join, cm_join_public, cm_browse and the comments trigger enforce it.';

-- When the grace ends, to the second. Null unless the community is in grace,
-- so the app can count the days down without knowing the rule.
create or replace function public.cm_grace_until(cid uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case when public.cm_state(cid) = 'grace'
    then p.subscription_expires_at + (public.cm_grace_days() || ' days')::interval
  end
  from public.communities c
  join public.profiles p on p.id = c.owner_id
  where c.id = cid;
$function$;

grant execute on function public.cm_grace_until(uuid) to anon, authenticated;

-- ---- creating one ----------------------------------------------------------
-- Two slots, earned two different ways, and an artist may hold one of each:
--
--   level 100  — the community an artist earns. Not plan backed, and nothing
--                that happens to a subscription touches it.
--   Max        — the community a subscription buys. Plan backed, and it goes
--                quiet three days after the subscription does.
--
-- Which slot a new community takes is not a choice: the earned one is used
-- first when it is available, so an artist who qualifies both ways does not
-- spend the permanent slot on their first room and leave the rentable one
-- unused. A member holding only a plan-backed community who then reaches
-- level 100 can create their earned one, and now holds two.
create or replace function public.cm_create(p_name text, p_desc text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  new_id uuid;
  code   text;
  lvl    int  := public.current_artist_level();
  is_max boolean := public.dz_effective_tier(auth.uid()) = 'max';
  has_earned boolean;
  has_plan   boolean;
  v_plan_backed boolean;
begin
  if auth.uid() is null then
    raise exception 'CM_FORBIDDEN' using errcode='P0001';
  end if;

  select exists (select 1 from public.communities
                  where owner_id = auth.uid() and not plan_backed),
         exists (select 1 from public.communities
                  where owner_id = auth.uid() and plan_backed)
    into has_earned, has_plan;

  if public.is_dev() then
    v_plan_backed := false;
  elsif lvl >= 100 and not has_earned then
    v_plan_backed := false;
  elsif is_max and not has_plan then
    v_plan_backed := true;
  elsif lvl < 100 and not is_max then
    -- neither route is open, and the reason is the one they can act on
    raise exception 'CM_LEVEL' using errcode='P0001';
  else
    raise exception 'CM_ALREADY_OWNER' using errcode='P0001';
  end if;

  if exists (select 1 from public.communities
              where lower(btrim(name)) = lower(btrim(p_name))) then
    raise exception 'CM_NAME_TAKEN' using errcode='P0001';
  end if;

  loop
    code := upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
    exit when not exists (select 1 from public.communities c where upper(c.join_code) = code);
  end loop;

  insert into public.communities (name, join_code, description, owner_id, plan_backed)
  values (btrim(p_name), code, nullif(btrim(coalesce(p_desc,'')),''), auth.uid(), v_plan_backed)
  returning id into new_id;

  insert into public.community_members (community_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return new_id;
end; $function$;

-- ---- what a locked community refuses --------------------------------------
-- Joining by code.
create or replace function public.cm_join(p_name text, p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid;
begin
  select id into cid from public.communities
   where lower(btrim(name)) = lower(btrim(p_name))
     and upper(join_code)   = upper(btrim(p_code));
  if cid is null then
    raise exception 'CM_NOT_FOUND' using errcode='P0001';
  end if;
  if public.cm_state(cid) = 'locked' then
    raise exception 'CM_LOCKED' using errcode='P0001';
  end if;
  if exists (select 1 from public.community_members
              where community_id = cid and user_id = auth.uid() and banned) then
    raise exception 'CM_BANNED' using errcode='P0001';
  end if;
  insert into public.community_members (community_id, user_id, role)
  values (cid, auth.uid(), 'member')
  on conflict (community_id, user_id) do nothing;
  return cid;
end; $function$;

-- Joining a public one from Browse.
create or replace function public.cm_join_public(cid uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'CM_FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.communities c where c.id = cid and c.is_public) then
    raise exception 'CM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if public.cm_state(cid) = 'locked' then
    raise exception 'CM_LOCKED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_members
              where community_id = cid and user_id = auth.uid() and banned) then
    raise exception 'CM_BANNED' using errcode = 'P0001';
  end if;
  insert into public.community_members (community_id, user_id, role)
  values (cid, auth.uid(), 'member')
  on conflict (community_id, user_id) do nothing;
  return cid;
end $function$;

-- Browse does not list one. A locked room is not a room to walk into, and a
-- search result that refuses on click is worse than no search result.
create or replace function public.cm_browse(p_q text default null, p_limit integer default 30, p_offset integer default 0)
returns table(id uuid, name text, short_description text, description text,
              avatar_url text, is_public boolean, members bigint, joined boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.id,
         c.name,
         c.short_description,
         c.description,
         c.avatar_url,
         c.is_public,
         count(m.user_id) filter (where m.banned = false) as members,
         bool_or(m.user_id = auth.uid() and m.banned = false) as joined
    from public.communities c
    left join public.community_members m on m.community_id = c.id
   where c.is_public
     and public.cm_state(c.id) <> 'locked'
     and (p_q is null
       or btrim(p_q) = ''
       or c.name ilike '%' || replace(replace(btrim(p_q), '%', '\%'), '_', '\_') || '%'
       or coalesce(c.short_description, '') ilike '%' || replace(replace(btrim(p_q), '%', '\%'), '_', '\_') || '%')
   group by c.id
   order by count(m.user_id) filter (where m.banned = false) desc, c.name asc, c.id asc
   limit greatest(1, least(coalesce(p_limit, 30), 50))
  offset greatest(0, coalesce(p_offset, 0))
$function$;

-- ---- and the one that makes the lock real ---------------------------------
-- A community's chat is rows in public.comments under the channel 'c:<uuid>'.
-- Everything above can be enforced in an RPC because everything above IS an
-- RPC; posting a message is a plain insert the client makes for itself, so
-- the refusal has to sit on the table. Without this, a locked room still
-- takes messages from anyone who already had it open.
create or replace function public.dz_comment_community_open()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare cid uuid;
begin
  if new.channel is null or left(new.channel, 2) <> 'c:' then
    return new;                       -- a built-in room, not a community
  end if;
  begin
    cid := substring(new.channel from 3)::uuid;
  exception when others then
    return new;                       -- not a community id, not ours to judge
  end;
  if public.cm_state(cid) = 'locked' then
    raise exception 'CM_LOCKED' using errcode='P0001';
  end if;
  return new;
end $function$;

drop trigger if exists dz_comment_community_open on public.comments;
create trigger dz_comment_community_open
  before insert on public.comments
  for each row execute function public.dz_comment_community_open();
