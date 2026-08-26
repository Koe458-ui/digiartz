do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_role_known'
  ) then
    alter table public.profiles
      add constraint profiles_role_known
      check (role is null or role in ('guest', 'admin', 'dev', 'partner')) not valid;
    alter table public.profiles validate constraint profiles_role_known;
  end if;
end $$;

alter table public.profiles
  add column if not exists max_claimed    boolean not null default false,
  add column if not exists partner_since  timestamptz;

comment on column public.profiles.max_claimed is
  'True once this partner has taken the free Max that comes with the role. '
  'Never reset — a partner who lets the role go and is given it again does not '
  'get a second perpetual subscription out of it.';

create or replace function public.dz_profiles_guard_privileged()
returns trigger
language plpgsql
as $$
begin
  if (new.role          is distinct from old.role)
  or (new.max_claimed   is distinct from old.max_claimed)
  or (new.partner_since is distinct from old.partner_since) then
    if current_user in ('authenticated', 'anon') then
      raise exception 'role, max_claimed and partner_since are not yours to set';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists dz_profiles_guard_privileged on public.profiles;
create trigger dz_profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.dz_profiles_guard_privileged();

create or replace function public.dz_profiles_guard_insert()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.role is not null or new.max_claimed or new.partner_since is not null) then
    raise exception 'role, max_claimed and partner_since are not yours to set';
  end if;
  return new;
end $$;

drop trigger if exists dz_profiles_guard_insert on public.profiles;
create trigger dz_profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.dz_profiles_guard_insert();

revoke all on function public.dz_profiles_guard_privileged() from public, anon, authenticated;
revoke all on function public.dz_profiles_guard_insert() from public, anon, authenticated;

alter function public.dz_profiles_guard_privileged() set search_path to 'public', 'pg_temp';
alter function public.dz_profiles_guard_insert()     set search_path to 'public', 'pg_temp';

create or replace function public.dz_role(p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select role from public.profiles where id = p_user;
$$;
revoke all on function public.dz_role(uuid) from public, anon, authenticated;

create or replace function public.dz_is_staff(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select role in ('admin', 'dev') from public.profiles where id = p_user),
    false);
$$;
revoke all on function public.dz_is_staff(uuid) from public, anon, authenticated;

create or replace function public.dz_is_ordinary(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select role is null or role = 'guest' from public.profiles where id = p_user),
    false);
$$;
revoke all on function public.dz_is_ordinary(uuid) from public, anon, authenticated;

create or replace function public.dz_is_partner(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select role = 'partner' from public.profiles where id = p_user),
    false);
$$;
revoke all on function public.dz_is_partner(uuid) from public, anon, authenticated;

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  actor_role text,
  action     text not null,
  target_id  uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint audit_action_len check (char_length(action) between 2 and 64)
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_target_idx  on public.audit_log (target_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

comment on table public.audit_log is
  'Append-only. Every privileged action in this schema writes here through '
  'dz_audit(), and the actor''s role is copied onto the row rather than joined '
  'at read time — a partner demoted next month must not make last month''s '
  'ban look like it was done by a member.';

create or replace function public.dz_audit(
  p_action text, p_target uuid, p_meta jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.audit_log (actor_id, actor_role, action, target_id, metadata)
  values (auth.uid(), public.dz_role(auth.uid()), p_action, p_target,
          coalesce(p_meta, '{}'::jsonb));
$$;
revoke all on function public.dz_audit(text, uuid, jsonb) from public, anon, authenticated;

create table if not exists public.user_bans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text not null,
  note       text,
  banned_by  uuid references public.profiles(id) on delete set null,
  banned_at  timestamptz not null default now(),
  expires_at timestamptz,
  lifted_by  uuid references public.profiles(id) on delete set null,
  lifted_at  timestamptz,

  constraint user_bans_reason_len check (char_length(reason) between 2 and 60),
  constraint user_bans_note_len   check (note is null or char_length(note) <= 500)
);

create unique index if not exists user_bans_live_idx
  on public.user_bans (user_id) where lifted_at is null;
create index if not exists user_bans_recent_idx on public.user_bans (banned_at desc);

alter table public.user_bans enable row level security;
revoke all on public.user_bans from anon, authenticated;

create or replace function public.dz_is_banned(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.user_bans
     where user_id = p_user
       and lifted_at is null
       and (expires_at is null or expires_at > now()));
$$;
revoke all on function public.dz_is_banned(uuid) from public, anon, authenticated;

create or replace function public.dz_may_moderate(p_actor uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when p_actor is null or p_target is null then false
    when p_actor = p_target                  then false
    when public.dz_is_staff(p_actor)         then not public.dz_is_staff(p_target)
    when public.dz_is_partner(p_actor)       then public.dz_is_ordinary(p_target)
    else false
  end;
$$;
revoke all on function public.dz_may_moderate(uuid, uuid) from public, anon, authenticated;

create or replace function public.dz_ban_user(
  p_target uuid, p_reason text, p_note text default null, p_days integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_expires timestamptz;
  v_id      uuid;
begin
  if not public.dz_may_moderate(auth.uid(), p_target) then
    raise exception 'not allowed';
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 2 then
    raise exception 'a reason is required';
  end if;

  v_expires := case when p_days is null or p_days <= 0
                    then null
                    else now() + make_interval(days => least(p_days, 3650)) end;

  insert into public.user_bans (user_id, reason, note, banned_by, expires_at)
  values (p_target, btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid(), v_expires)
  on conflict (user_id) where lifted_at is null
  do update set reason     = excluded.reason,
                note       = excluded.note,
                banned_by  = excluded.banned_by,
                banned_at  = now(),
                expires_at = excluded.expires_at
  returning id into v_id;

  perform public.dz_audit('ban_user', p_target, jsonb_build_object(
    'ban_id', v_id, 'reason', btrim(p_reason), 'expires_at', v_expires));

  return jsonb_build_object('ok', true, 'ban_id', v_id, 'expires_at', v_expires);
end $$;
revoke all on function public.dz_ban_user(uuid, text, text, integer) from public, anon;
grant execute on function public.dz_ban_user(uuid, text, text, integer) to authenticated;

create or replace function public.dz_unban_user(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_rows integer;
begin
  if not public.dz_may_moderate(auth.uid(), p_target) then
    raise exception 'not allowed';
  end if;

  update public.user_bans
     set lifted_by = auth.uid(), lifted_at = now()
   where user_id = p_target and lifted_at is null;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  perform public.dz_audit('unban_user', p_target, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.dz_unban_user(uuid) from public, anon;
grant execute on function public.dz_unban_user(uuid) to authenticated;

create or replace function public.dz_mod_find(p_query text)
returns table(
  id uuid, username text, display_name text, email text, role text,
  tier text, banned boolean, ban_reason text, ban_expires_at timestamptz,
  can_moderate boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q     text := btrim(coalesce(p_query, ''));
  v_id    uuid;
  v_staff boolean := public.dz_is_staff(auth.uid());
begin
  if not (v_staff or public.dz_is_partner(auth.uid())) then
    raise exception 'not allowed';
  end if;
  if char_length(v_q) < 2 then
    raise exception 'search for a username, an email or a user id';
  end if;

  begin
    v_id := v_q::uuid;
  exception when others then
    v_id := null;
  end;
  v_q := ltrim(v_q, '@');

  return query
  select p.id,
         p.username,
         p.display_name,
         case when v_staff then u.email::text else null end,
         case when v_staff then p.role else null end,
         coalesce(public.dz_effective_tier(p.id), 'guest') as tier,
         public.dz_is_banned(p.id) as banned,
         b.reason,
         b.expires_at,
         public.dz_may_moderate(auth.uid(), p.id) as can_moderate
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.user_bans b on b.user_id = p.id and b.lifted_at is null
   where (v_id is not null and p.id = v_id)
      or lower(p.username) = lower(v_q)
      or lower(u.email)    = lower(v_q)
   limit 1;
end $$;
revoke all on function public.dz_mod_find(text) from public, anon;
grant execute on function public.dz_mod_find(text) to authenticated;

create or replace function public.dz_ban_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return new; end if;
  if public.dz_is_banned(v_uid) then
    raise exception 'Your account is suspended. Contact DigiArtzsupport@gmail.com'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.dz_ban_gate() from public, anon, authenticated;

create table if not exists public.user_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references public.profiles(id) on delete set null,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  reason       text not null,
  details      text,
  status       text not null default 'pending',
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz not null default now(),

  constraint user_reports_reason check (reason in (
    'dmca', 'spam', 'harassment', 'fraud', 'impersonation',
    'hate', 'illegal', 'other')),
  constraint user_reports_status check (status in ('pending', 'resolved', 'dismissed')),
  constraint user_reports_details_len check (details is null or char_length(details) <= 1000),
  constraint user_reports_not_self check (reporter_id is null or reporter_id <> target_id)
);

create index if not exists user_reports_open_idx
  on public.user_reports (created_at desc) where status = 'pending';
create index if not exists user_reports_target_idx on public.user_reports (target_id);

create unique index if not exists user_reports_one_open_idx
  on public.user_reports (reporter_id, target_id) where status = 'pending';

alter table public.user_reports enable row level security;
revoke all on public.user_reports from anon, authenticated;
grant insert on public.user_reports to authenticated;

drop policy if exists user_reports_insert_own on public.user_reports;
create policy user_reports_insert_own on public.user_reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and target_id <> auth.uid());

drop policy if exists user_reports_select_own on public.user_reports;

create or replace function public.dz_reports_queue(
  p_status text default 'pending', p_limit integer default 100)
returns table(
  id uuid, reason text, details text, status text, created_at timestamptz,
  target_id uuid, target_username text, target_banned boolean,
  reporter_id uuid, reporter_username text,
  resolved_by uuid, resolved_at timestamptz, resolution text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_staff boolean := public.dz_is_staff(auth.uid());
begin
  if not (v_staff or public.dz_is_partner(auth.uid())) then
    raise exception 'not allowed';
  end if;
  if p_status not in ('pending', 'resolved', 'dismissed', 'all') then
    raise exception 'unknown status';
  end if;

  return query
  select r.id, r.reason, r.details, r.status, r.created_at,
         r.target_id, t.username, public.dz_is_banned(r.target_id),
         r.reporter_id, rp.username,
         r.resolved_by, r.resolved_at, r.resolution
    from public.user_reports r
    left join public.profiles t  on t.id  = r.target_id
    left join public.profiles rp on rp.id = r.reporter_id
   where (p_status = 'all' or r.status = p_status)
     and (v_staff or public.dz_may_moderate(auth.uid(), r.target_id))
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;
revoke all on function public.dz_reports_queue(text, integer) from public, anon;
grant execute on function public.dz_reports_queue(text, integer) to authenticated;

create or replace function public.dz_report_resolve(
  p_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_target uuid;
begin
  if not (public.dz_is_staff(auth.uid()) or public.dz_is_partner(auth.uid())) then
    raise exception 'not allowed';
  end if;
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'unknown status';
  end if;

  update public.user_reports
     set status = p_status, resolved_by = auth.uid(), resolved_at = now(),
         resolution = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending'
   returning target_id into v_target;

  if v_target is null then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  perform public.dz_audit('resolve_report', v_target,
    jsonb_build_object('report_id', p_id, 'status', p_status));
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.dz_report_resolve(uuid, text, text) from public, anon;
grant execute on function public.dz_report_resolve(uuid, text, text) to authenticated;

create table if not exists public.promo_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  partner_id  uuid not null references public.profiles(id) on delete cascade,
  is_active   boolean not null default true,
  usage_count integer not null default 0,
  created_at  timestamptz not null default now(),

  constraint promo_code_shape check (code ~ '^[A-Z0-9]{4,6}$'),
  constraint promo_usage_nonneg check (usage_count >= 0)
);

comment on column public.promo_codes.usage_count is
  'Sales this code has earned a commission on. Incremented by the two triggers '
  'in section 7, and only when a commission row was actually written — so it '
  'always equals the number of rows in partner_commissions for this code, and '
  'a replayed webhook moves neither.';

create unique index if not exists promo_codes_code_idx    on public.promo_codes (code);
create unique index if not exists promo_codes_partner_idx on public.promo_codes (partner_id);

alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon, authenticated;

comment on table public.promo_codes is
  'No RLS policy grants a read. A partner reads their own code through '
  'dz_promo_mine(); a buyer never reads this table at all, they type a code '
  'and dz_promo_resolve() answers yes or no. Selecting the table would list '
  'every partner''s code to every partner, which is the isolation rule this '
  'feature exists under.';

create or replace function public.dz_promo_create(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id   uuid;
  v_bad  boolean := false;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if v_code !~ '^[A-Z0-9]{4,6}$' then
    raise exception 'A code is 4 to 6 letters or digits, nothing else';
  end if;
  if exists (select 1 from public.promo_codes where partner_id = auth.uid()) then
    raise exception 'You already have a code';
  end if;
  if exists (select 1 from public.promo_codes where code = v_code) then
    raise exception 'That code is taken';
  end if;

  begin
    select exists (
      select 1 from public.bad_words w
       where v_code = upper(w.word) or v_code like '%' || upper(w.word) || '%'
    ) into v_bad;
  exception when undefined_table then
    v_bad := false;
  end;
  if v_bad then
    raise exception 'Pick a different code';
  end if;

  insert into public.promo_codes (code, partner_id)
  values (v_code, auth.uid())
  returning id into v_id;

  perform public.dz_audit('create_promo', auth.uid(),
    jsonb_build_object('promo_id', v_id, 'code', v_code));

  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end $$;
revoke all on function public.dz_promo_create(text) from public, anon;
grant execute on function public.dz_promo_create(text) to authenticated;

create or replace function public.dz_promo_resolve(p_code text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  r      record;
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;
  if p_kind not in ('marketplace', 'subscription') then
    raise exception 'unknown purchase kind';
  end if;
  if v_code !~ '^[A-Z0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'error', 'That code does not look right');
  end if;

  select c.id, c.partner_id, c.is_active into r
    from public.promo_codes c where c.code = v_code;

  if not found or not r.is_active then
    return jsonb_build_object('ok', false, 'error', 'No such code');
  end if;
  if not public.dz_is_partner(r.partner_id) then
    return jsonb_build_object('ok', false, 'error', 'No such code');
  end if;
  if r.partner_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'You cannot use your own code');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', r.id,
    'code', v_code,
    'discount_bps', case when p_kind = 'subscription' then 9000 else 0 end);
end $$;
revoke all on function public.dz_promo_resolve(text, text) from public, anon;
grant execute on function public.dz_promo_resolve(text, text) to authenticated;

create table if not exists public.partner_commissions (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.profiles(id) on delete cascade,
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  buyer_id      uuid references public.profiles(id) on delete set null,
  kind          text not null,
  earning_id    uuid,
  payment_id    uuid,
  label         text,
  gross_amount  bigint not null,
  rate_bps      integer not null,
  amount        bigint not null,
  currency      text   not null,
  amount_inr    bigint,
  fx_inr_rate   numeric(18,8),
  payout_status text   not null default 'wallet_credited',
  payout_id     uuid,
  created_at    timestamptz not null default now(),

  constraint pc_kind    check (kind in ('marketplace', 'subscription')),
  constraint pc_payout  check (payout_status in ('wallet_credited', 'paid_direct', 'reversed')),
  constraint pc_amounts check (gross_amount >= 0 and amount >= 0 and rate_bps between 0 and 10000),
  constraint pc_cur     check (currency ~ '^[A-Z]{3}$'),
  constraint pc_source  check (num_nonnulls(earning_id, payment_id) = 1)
);

create unique index if not exists partner_commissions_earning_idx
  on public.partner_commissions (earning_id) where earning_id is not null;
create unique index if not exists partner_commissions_payment_idx
  on public.partner_commissions (payment_id) where payment_id is not null;
create index if not exists partner_commissions_partner_idx
  on public.partner_commissions (partner_id, created_at desc);
create index if not exists partner_commissions_promo_idx
  on public.partner_commissions (promo_code_id, created_at desc);

alter table public.partner_commissions enable row level security;
revoke all on public.partner_commissions from anon, authenticated;

comment on table public.partner_commissions is
  'A partner''s whole wallet. There is no balance column anywhere — the '
  'balance is the sum of these rows less what has been paid out, computed by '
  'dz_partner_wallet(). Two records of the same money is how they come to '
  'disagree; see the seller wallet in 20260802_money_flow.sql, which is built '
  'the same way and for the same reason.';
comment on column public.partner_commissions.payout_status is
  'wallet_credited while the money is sitting here, paid_direct once a payout '
  'has carried it out. There is no pending state: this platform does not '
  'refund, so there is nothing to hold the money against.';

alter table public.platform_tax_config
  add column if not exists partner_market_bps  integer not null default 500,
  add column if not exists partner_sub_bps     integer not null default 250,
  add column if not exists promo_sub_discount_bps integer not null default 9000;

comment on column public.platform_tax_config.partner_market_bps is
  'The promo code owner''s share of a marketplace sale, in basis points of the '
  'gross. 500 = 5%. Taken OUT OF the platform''s commission_bps, never out of '
  'the seller''s net — a seller''s share does not change because a buyer typed '
  'a code, and the trigger below refuses to write a commission that would make '
  'it change.';
comment on column public.platform_tax_config.partner_sub_bps is
  'The promo code owner''s share of a Max subscription bought with their code, '
  'in basis points of the LIST price — 250 = 2.5%. The buyer pays 10% of list '
  'after promo_sub_discount_bps, so this is a quarter of what was collected.';

alter table public.marketplace_earnings
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;
alter table public.payments
  add column if not exists promo_code_id uuid references public.promo_codes(id) on delete set null;

create or replace function public.dz_partner_credit_market()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cfg     public.platform_tax_config%rowtype;
  v_part  uuid;
  v_amt   bigint;
  v_rate  numeric(18,8);
  v_scale integer;
begin
  if new.promo_code_id is null then return new; end if;

  select partner_id into v_part from public.promo_codes
   where id = new.promo_code_id and is_active;
  if v_part is null then return new; end if;
  if not public.dz_is_partner(v_part) then return new; end if;
  if v_part = new.seller_id or v_part = new.buyer_id then return new; end if;

  select * into cfg from public.platform_tax_config where id = 1;
  v_amt := round(new.gross_amount::numeric * cfg.partner_market_bps / 10000);

  v_amt := least(v_amt, new.fee_amount);
  if v_amt <= 0 then return new; end if;

  v_scale := case when new.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end;
  select inr_rate into v_rate from public.fx_rates where code = new.currency;

  insert into public.partner_commissions (
    partner_id, promo_code_id, buyer_id, kind, earning_id, label,
    gross_amount, rate_bps, amount, currency, amount_inr, fx_inr_rate)
  values (
    v_part, new.promo_code_id, new.buyer_id, 'marketplace', new.id,
    'Marketplace sale',
    new.gross_amount, cfg.partner_market_bps, v_amt, new.currency,
    case when v_rate is null then null else round(v_amt * v_rate * v_scale) end,
    v_rate)
  on conflict (earning_id) where earning_id is not null do nothing;

  if found then
    update public.promo_codes
       set usage_count = usage_count + 1
     where id = new.promo_code_id;
  end if;

  return new;
end $$;

drop trigger if exists dz_partner_credit_market on public.marketplace_earnings;
create trigger dz_partner_credit_market
  after insert on public.marketplace_earnings
  for each row execute function public.dz_partner_credit_market();
revoke all on function public.dz_partner_credit_market() from public, anon, authenticated;

create or replace function public.dz_partner_credit_sub()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cfg     public.platform_tax_config%rowtype;
  v_part  uuid;
  v_list  bigint;
  v_amt   bigint;
  v_rate  numeric(18,8);
  v_scale integer;
begin
  if new.status <> 'paid' or new.kind <> 'subscription' then return new; end if;
  if new.promo_code_id is null then return new; end if;

  select partner_id into v_part from public.promo_codes
   where id = new.promo_code_id and is_active;
  if v_part is null then return new; end if;
  if not public.dz_is_partner(v_part) then return new; end if;
  if v_part = new.user_id then return new; end if;

  select * into cfg from public.platform_tax_config where id = 1;

  if cfg.promo_sub_discount_bps >= 10000 then return new; end if;
  v_list := round(new.amount::numeric * 10000 / (10000 - cfg.promo_sub_discount_bps));
  v_amt  := round(v_list::numeric * cfg.partner_sub_bps / 10000);

  v_amt := least(v_amt, new.amount);
  if v_amt <= 0 then return new; end if;

  v_scale := case when new.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end;
  select inr_rate into v_rate from public.fx_rates where code = new.currency;

  insert into public.partner_commissions (
    partner_id, promo_code_id, buyer_id, kind, payment_id, label,
    gross_amount, rate_bps, amount, currency, amount_inr, fx_inr_rate)
  values (
    v_part, new.promo_code_id, new.user_id, 'subscription', new.id,
    'Max subscription',
    v_list, cfg.partner_sub_bps, v_amt, new.currency,
    case when v_rate is null then null else round(v_amt * v_rate * v_scale) end,
    v_rate)
  on conflict (payment_id) where payment_id is not null do nothing;

  if found then
    update public.promo_codes
       set usage_count = usage_count + 1
     where id = new.promo_code_id;
  end if;

  return new;
end $$;

drop trigger if exists dz_partner_credit_sub_ins on public.payments;
create trigger dz_partner_credit_sub_ins
  after insert on public.payments
  for each row when (new.status = 'paid')
  execute function public.dz_partner_credit_sub();

drop trigger if exists dz_partner_credit_sub_upd on public.payments;
create trigger dz_partner_credit_sub_upd
  after update of status on public.payments
  for each row when (old.status is distinct from new.status and new.status = 'paid')
  execute function public.dz_partner_credit_sub();
revoke all on function public.dz_partner_credit_sub() from public, anon, authenticated;

create or replace function public.dz_partner_reverse()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_rows integer;
begin
  update public.partner_commissions
     set payout_status = 'reversed'
   where payout_status = 'wallet_credited'
     and (   (tg_table_name = 'marketplace_earnings' and earning_id = new.id)
          or (tg_table_name = 'payments'             and payment_id = new.id));
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    update public.promo_codes c
       set usage_count = greatest(c.usage_count - v_rows, 0)
     where c.id = new.promo_code_id;
  end if;

  return new;
end $$;

drop trigger if exists dz_partner_reverse_earning on public.marketplace_earnings;
create trigger dz_partner_reverse_earning
  after update of status on public.marketplace_earnings
  for each row when (old.status is distinct from new.status and new.status = 'reversed')
  execute function public.dz_partner_reverse();

drop trigger if exists dz_partner_reverse_payment on public.payments;
create trigger dz_partner_reverse_payment
  after update of status on public.payments
  for each row when (old.status is distinct from new.status
                     and new.status in ('refunded', 'reversed', 'disputed'))
  execute function public.dz_partner_reverse();
revoke all on function public.dz_partner_reverse() from public, anon, authenticated;

drop function if exists public.dz_partner_wallet();
create function public.dz_partner_wallet()
returns table(
  currency text, available bigint, lifetime bigint, paid_out bigint,
  conversions bigint, has_payout_method boolean, route text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_has boolean;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;

  select exists (select 1 from public.payout_methods where user_id = auth.uid())
    into v_has;

  return query
  select c.currency,
         coalesce(sum(c.amount) filter (where c.payout_status = 'wallet_credited'), 0)::bigint,
         coalesce(sum(c.amount) filter (where c.payout_status <> 'reversed'), 0)::bigint,
         coalesce(sum(c.amount) filter (where c.payout_status = 'paid_direct'), 0)::bigint,
         count(*) filter (where c.payout_status <> 'reversed')::bigint,
         v_has,
         case when v_has then 'direct' else 'wallet' end
    from public.partner_commissions c
   where c.partner_id = auth.uid()
   group by c.currency
   order by c.currency;
end $$;
revoke all on function public.dz_partner_wallet() from public, anon;
grant execute on function public.dz_partner_wallet() to authenticated;

create or replace function public.dz_partner_ledger(
  p_limit integer default 50, p_before timestamptz default null)
returns table(
  id uuid, created_at timestamptz, kind text, label text,
  buyer_username text, gross_amount bigint, rate_bps integer,
  amount bigint, currency text, payout_status text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select c.id, c.created_at, c.kind, c.label,
         b.username, c.gross_amount, c.rate_bps, c.amount, c.currency,
         c.payout_status
    from public.partner_commissions c
    left join public.profiles b on b.id = c.buyer_id
   where c.partner_id = auth.uid()
     and (p_before is null or c.created_at < p_before)
   order by c.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;
revoke all on function public.dz_partner_ledger(integer, timestamptz) from public, anon;
grant execute on function public.dz_partner_ledger(integer, timestamptz) to authenticated;

create or replace function public.dz_promo_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r      record;
  v_conv record;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;

  select c.id, c.code, c.is_active, c.usage_count, c.created_at into r
    from public.promo_codes c where c.partner_id = auth.uid();

  if not found then
    return jsonb_build_object('ok', true, 'code', null);
  end if;

  select
    count(*) filter (where kind = 'marketplace')  as market,
    count(*) filter (where kind = 'subscription') as subs,
    count(distinct buyer_id)                     as buyers
    into v_conv
    from public.partner_commissions
   where partner_id = auth.uid() and payout_status <> 'reversed';

  return jsonb_build_object(
    'ok', true,
    'id', r.id, 'code', r.code, 'is_active', r.is_active,
    'usage_count', r.usage_count, 'created_at', r.created_at,
    'marketplace_conversions', coalesce(v_conv.market, 0),
    'subscription_conversions', coalesce(v_conv.subs, 0),
    'unique_buyers', coalesce(v_conv.buyers, 0));
end $$;
revoke all on function public.dz_promo_mine() from public, anon;
grant execute on function public.dz_promo_mine() to authenticated;

create or replace function public.dz_grant_partner(p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    uuid;
  v_role  text;
  v_name  text;
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'That does not look like an email address';
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = v_email;
  if v_id is null then
    raise exception 'No account is registered to that address';
  end if;

  select p.role, p.username into v_role, v_name
    from public.profiles p where p.id = v_id;

  if v_role in ('admin', 'dev') then
    raise exception 'That account is already staff';
  end if;
  if v_role = 'partner' then
    return jsonb_build_object('ok', true, 'changed', false,
                              'user_id', v_id, 'username', v_name);
  end if;

  update public.profiles
     set role = 'partner', partner_since = now()
   where id = v_id;

  insert into public.notifications (user_id, type, title, message)
  values (v_id, 'admin', 'You are now a DigiArtz partner',
          'Your Collab Hub is open: claim your free Max membership, create '
          'your promo code, and start earning on every sale it brings in.');

  perform public.dz_audit('grant_partner', v_id,
    jsonb_build_object('email', v_email));

  return jsonb_build_object('ok', true, 'changed', true,
                            'user_id', v_id, 'username', v_name);
end $$;
revoke all on function public.dz_grant_partner(text) from public, anon;
grant execute on function public.dz_grant_partner(text) to authenticated;

create or replace function public.dz_revoke_partner(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if not public.dz_is_partner(p_user) then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.profiles set role = 'guest' where id = p_user;
  update public.promo_codes set is_active = false where partner_id = p_user;

  perform public.dz_audit('revoke_partner', p_user, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end $$;
revoke all on function public.dz_revoke_partner(uuid) from public, anon;
grant execute on function public.dz_revoke_partner(uuid) to authenticated;

create or replace function public.dz_claim_max()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_until timestamptz;
begin
  if not public.dz_is_partner(auth.uid()) then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.profiles
              where id = auth.uid() and max_claimed) then
    return jsonb_build_object('ok', true, 'changed', false, 'tier', 'max');
  end if;

  v_until := now() + interval '100 years';

  update public.profiles
     set subscription_tier = 'max',
         subscription_expires_at = greatest(
           coalesce(subscription_expires_at, v_until), v_until),
         max_claimed = true
   where id = auth.uid();

  perform public.dz_audit('claim_max', auth.uid(),
    jsonb_build_object('until', v_until));

  return jsonb_build_object('ok', true, 'changed', true, 'tier', 'max',
                            'until', v_until);
end $$;
revoke all on function public.dz_claim_max() from public, anon;
grant execute on function public.dz_claim_max() to authenticated;

create or replace function public.dz_my_collab_state()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select jsonb_build_object(
       'role', p.role,
       'is_partner', p.role = 'partner',
       'is_staff', p.role in ('admin', 'dev'),
       'max_claimed', p.max_claimed,
       'tier', coalesce(public.dz_effective_tier(p.id), 'guest'),
       'has_promo', exists (
         select 1 from public.promo_codes pc where pc.partner_id = p.id),
       'has_payout_method', exists (
         select 1 from public.payout_methods pm where pm.user_id = p.id))
     from public.profiles p where p.id = auth.uid()),
    jsonb_build_object(
      'role', null, 'is_partner', false, 'is_staff', false,
      'max_claimed', false, 'tier', 'guest',
      'has_promo', false, 'has_payout_method', false));
$$;
revoke all on function public.dz_my_collab_state() from public, anon;
grant execute on function public.dz_my_collab_state() to authenticated;

create or replace function public.dz_admin_partners()
returns table(
  partner_id uuid, username text, display_name text, partner_since timestamptz,
  max_claimed boolean, code text, code_active boolean, usage_count integer,
  conversions bigint, earned_json jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select p.id, p.username, p.display_name, p.partner_since, p.max_claimed,
         c.code, c.is_active, c.usage_count,
         coalesce(x.n, 0)::bigint,
         coalesce(x.earned, '{}'::jsonb)
    from public.profiles p
    left join public.promo_codes c on c.partner_id = p.id
    left join lateral (
      select count(*) as n,
             jsonb_object_agg(t.currency, t.amt) as earned
        from (select pc.currency, sum(pc.amount)::bigint as amt
                from public.partner_commissions pc
               where pc.partner_id = p.id and pc.payout_status <> 'reversed'
               group by pc.currency) t
    ) x on true
   where p.role = 'partner'
   order by p.partner_since desc nulls last, p.username;
end $$;
revoke all on function public.dz_admin_partners() from public, anon;
grant execute on function public.dz_admin_partners() to authenticated;

create or replace function public.dz_audit_log(
  p_limit integer default 100, p_before timestamptz default null)
returns table(
  id bigint, created_at timestamptz, action text,
  actor_id uuid, actor_username text, actor_role text,
  target_id uuid, target_username text, metadata jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select a.id, a.created_at, a.action,
         a.actor_id, ap.username, a.actor_role,
         a.target_id, tp.username, a.metadata
    from public.audit_log a
    left join public.profiles ap on ap.id = a.actor_id
    left join public.profiles tp on tp.id = a.target_id
   where p_before is null or a.created_at < p_before
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;
revoke all on function public.dz_audit_log(integer, timestamptz) from public, anon;
grant execute on function public.dz_audit_log(integer, timestamptz) to authenticated;

create or replace function public.dz_admin_telemetry()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sub     jsonb;
  v_content jsonb;
  v_dev     jsonb;
  v_eng     jsonb;
  v_mod     jsonb;
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;

  select jsonb_build_object(
           'lite',    count(*) filter (where tier = 'lite'),
           'premium', count(*) filter (where tier = 'premium'),
           'max',     count(*) filter (where tier = 'max'),
           'free',    count(*) filter (where tier not in ('lite', 'premium', 'max')),
           'partners', count(*) filter (where role = 'partner'),
           'total',   count(*))
    into v_sub
    from (
      select p.role,
             case when p.subscription_expires_at is null
                   or p.subscription_expires_at <= now()
                  then 'guest' else coalesce(p.subscription_tier, 'guest') end as tier
        from public.profiles p) t;

  select jsonb_build_object(
           'artworks',    (select count(*) from public.artworks),
           'resources',   (select count(*) from public.resources),
           'marketplace', (select count(*) from public.marketplace_items),
           'blogs',       (select count(*) from public.blog_posts),
           'jobs',        (select count(*) from public.jobs),
           'communities', (select count(*) from public.communities),
           'today', jsonb_build_object(
             'artworks',    (select count(*) from public.artworks         where created_at >= current_date),
             'resources',   (select count(*) from public.resources        where created_at >= current_date),
             'marketplace', (select count(*) from public.marketplace_items where created_at >= current_date),
             'blogs',       (select count(*) from public.blog_posts       where created_at >= current_date),
             'jobs',        (select count(*) from public.jobs             where created_at >= current_date)))
    into v_content;

  select coalesce(jsonb_object_agg(device, n), '{}'::jsonb)
    into v_dev
    from (select device, count(distinct viewer_key)::bigint as n
            from public.analytics_events
           where created_at >= now() - interval '24 hours'
           group by device) d;

  select jsonb_build_object(
           'dau', (select count(distinct viewer_key) from public.analytics_events
                    where created_at >= now() - interval '24 hours'),
           'mau', (select count(distinct viewer_key) from public.analytics_events
                    where created_at >= now() - interval '30 days'),
           'dau_signed_in', (select count(distinct actor_id) from public.analytics_events
                              where actor_id is not null
                                and created_at >= now() - interval '24 hours'),
           'events_24h', (select count(*) from public.analytics_events
                           where created_at >= now() - interval '24 hours'),
           'new_members_24h', (select count(*) from public.profiles
                                where created_at >= now() - interval '24 hours'))
    into v_eng;

  select jsonb_build_object(
           'open_user_reports', (select count(*) from public.user_reports where status = 'pending'),
           'open_item_reports', (select count(*) from public.artwork_reports where status = 'open'),
           'active_bans', (select count(*) from public.user_bans
                            where lifted_at is null
                              and (expires_at is null or expires_at > now())))
    into v_mod;

  return jsonb_build_object(
    'at', now(), 'subscriptions', v_sub, 'content', v_content,
    'devices', v_dev, 'engagement', v_eng, 'moderation', v_mod);
end $$;
revoke all on function public.dz_admin_telemetry() from public, anon;
grant execute on function public.dz_admin_telemetry() to authenticated;

drop function if exists public.dz_platform_revenue();
create function public.dz_platform_revenue()
returns table(commission_inr bigint, subscriptions_inr bigint, partner_inr bigint,
              total_inr bigint, tds_held_inr bigint, tcs_held_inr bigint,
              held_for_sellers json)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  return query
  with com as (
    select coalesce(sum(fee_inr), 0)::bigint as amt
    from public.marketplace_earnings where status <> 'reversed'
  ),
  stat as (
    select
      coalesce(sum(round(e.tds_amount * f.inr_rate *
        case when e.currency in ('JPY','HUF','TWD') then 100 else 1 end)), 0)::bigint as tds,
      coalesce(sum(round(e.tcs_amount * f.inr_rate *
        case when e.currency in ('JPY','HUF','TWD') then 100 else 1 end)), 0)::bigint as tcs
    from public.marketplace_earnings e
    join public.fx_rates f on f.code = e.currency
    where e.status <> 'reversed'
  ),
  sub as (
    select coalesce(sum(round(p.amount * f.inr_rate *
             case when p.currency in ('JPY','HUF','TWD') then 100 else 1 end)), 0)::bigint as amt
    from public.payments p
    join public.fx_rates f on f.code = p.currency
    where p.kind = 'subscription' and p.status = 'paid'
  ),
  prt as (
    select coalesce(sum(c.amount_inr), 0)::bigint as amt
    from public.partner_commissions c
    where c.payout_status <> 'reversed'
  ),
  held as (
    select coalesce(json_object_agg(currency, amt), '{}'::json) as js
    from (
      select currency, sum(net_amount)::bigint as amt
      from public.marketplace_earnings
      where status in ('pending', 'available')
      group by currency
    ) x
  )
  select com.amt, sub.amt, prt.amt,
         (com.amt + sub.amt - prt.amt)::bigint,
         stat.tds, stat.tcs, held.js
  from com, sub, stat, prt, held;
end $$;
revoke all on function public.dz_platform_revenue() from public, anon;
grant execute on function public.dz_platform_revenue() to authenticated;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('artworks', 'INSERT'), ('artworks', 'UPDATE'),
      ('resources', 'INSERT'), ('resources', 'UPDATE'),
      ('marketplace_items', 'INSERT'), ('marketplace_items', 'UPDATE'),
      ('blog_posts', 'INSERT'), ('blog_posts', 'UPDATE'),
      ('jobs', 'INSERT'), ('jobs', 'UPDATE'),
      ('item_comments', 'INSERT'), ('comments', 'INSERT'),
      ('direct_messages', 'INSERT'),
      ('item_reports', 'INSERT'), ('artwork_reports', 'INSERT'),
      ('user_reports', 'INSERT'),
      ('albums', 'INSERT'), ('albums', 'UPDATE'),
      ('profiles', 'UPDATE'),
      ('profile_creds', 'INSERT'),
      ('scheduled_uploads', 'INSERT'), ('scheduled_sections', 'INSERT'),
      ('item_likes', 'INSERT'), ('item_bookmarks', 'INSERT'),
      ('cart_items', 'INSERT'), ('community_members', 'INSERT'),
      ('friendships', 'INSERT')
    ) as t(tbl, op)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;

    execute format('drop trigger if exists dz_ban_%s_%s on public.%I',
                   lower(r.op), r.tbl, r.tbl);
    execute format(
      'create trigger dz_ban_%s_%s before %s on public.%I '||
      'for each row execute function public.dz_ban_gate()',
      lower(r.op), r.tbl, r.op, r.tbl);
  end loop;
end $$;
