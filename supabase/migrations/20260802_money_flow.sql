-- THE MONEY FLOW. This file is the whole of it — there is no older one.
--
-- Applied to the live project on 2 August 2026, as two steps recorded there as
-- `single_currency_money_flow` and `pending_wallet_and_statutory_deductions`.
-- They are consolidated here into one file on purpose: two migrations where
-- the second rewrites half of the first is exactly how someone later deletes
-- the wrong one. This is the end state, and it runs from clean.
--
--   BUYER pays, in the listing's own currency
--     |
--   PAYMENT GATEWAY takes its fee immediately
--     |
--   GROSS SALE RECEIVED
--     |
--   SELLER WALLET = PENDING          the whole gross, withdrawable by nobody
--     |
--   section 194-O                    TDS withheld at CREDIT, which is here
--     |                              nil for an individual or HUF at or under
--     |                              Rs 5,00,000 for the year with a PAN
--     |
--   section 52 GST TCS               collected through the month, remittable
--     |                              by the 10th of the next one
--     |
--   SETTLEMENT WINDOW                Razorpay domestic T+2 working days
--     |                              Razorpay international T+7
--     |                              PayPal up to 5 business days
--     |
--   SELLER WALLET = AVAILABLE        what is genuinely theirs
--     |
--   Seller withdraws, in the same currency they earned in
--
-- TWO RULES THIS FILE EXISTS TO ENFORCE
--
-- 1. A seller's money is never converted. Not to display it, not to pay it,
--    not to tax it. It was earned in one currency and it leaves in that
--    currency. The old wallet totalled every currency into USD and the payout
--    form then asked PayPal for USD, so a EUR sale crossed a spread twice and
--    the tax basis was computed off the far side of both. fx_rates.usd_rate is
--    dropped below so no future query can quietly route through the dollar
--    again.
--
-- 2. Only what is actually the platform's is converted to INR: the commission,
--    once, at settlement, at a rate frozen onto the row. That plus the
--    subscriptions is all that reaches the platform's bank account. A seller's
--    net and the two statutory collections are other people's money passing
--    through, and dz_platform_revenue() reports them separately so they cannot
--    be mistaken for income.

-- ===========================================================================
-- RATES — direct to INR, with no third currency in the middle
-- ===========================================================================
alter table public.fx_rates add column if not exists inr_rate numeric(18,8);

update public.fx_rates f
   set inr_rate = round(f.usd_rate / (select usd_rate from public.fx_rates where code = 'INR'), 8)
 where f.inr_rate is null
   and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'fx_rates'
                  and column_name = 'usd_rate');

alter table public.fx_rates alter column inr_rate set not null;
alter table public.fx_rates drop column if exists usd_rate;

comment on column public.fx_rates.inr_rate is
  'Rupees per one major unit of this currency. Maintain as a DIRECT rate — '
  'nothing in this schema converts through a third currency.';

-- ===========================================================================
-- RATES OF TAX AND COMMISSION — in a table, because statute changes
-- ===========================================================================
create table if not exists public.platform_tax_config (
  id                smallint primary key default 1 check (id = 1),
  commission_bps    integer not null default 1500,     -- 15%, the platform's cut
  tds_bps           integer not null default 10,       -- 0.1% since 01-10-2024
  tds_no_pan_bps    integer not null default 500,      -- 5% under section 206AA
  tds_floor_inr     bigint  not null default 50000000, -- Rs 5,00,000 in paise
  tcs_active        boolean not null default false,    -- on only once registered
  tcs_bps           integer not null default 50,       -- 0.5% since 10-07-2024
  updated_at        timestamptz not null default now()
);
insert into public.platform_tax_config (id) values (1) on conflict (id) do nothing;
alter table public.platform_tax_config enable row level security;
revoke all on public.platform_tax_config from anon, authenticated;

comment on table public.platform_tax_config is
  'Single row. Service role and SECURITY DEFINER functions only — a member '
  'must never read or move the rate their own tax is computed at.';
comment on column public.platform_tax_config.tcs_active is
  'Turn on only when DigiArtz is registered as an e-commerce operator under '
  'GST. Off, nothing is collected and nothing is reported as collected — '
  'collecting a tax there is no registration to remit under is worse than not '
  'collecting it.';

-- ===========================================================================
-- SETTLEMENT WINDOWS — the providers' own published terms
-- ===========================================================================
create table if not exists public.settlement_windows (
  provider text not null,
  scope    text not null check (scope in ('domestic', 'international', 'any')),
  days     integer not null check (days >= 0),
  business boolean not null default true,
  label    text not null,
  primary key (provider, scope)
);
insert into public.settlement_windows (provider, scope, days, business, label) values
  ('razorpay', 'domestic',      2, true, 'Razorpay domestic · T+2 working days'),
  ('razorpay', 'international', 7, true, 'Razorpay international · T+7 working days'),
  ('paypal',   'any',           5, true, 'PayPal · up to 5 business days to the bank')
on conflict (provider, scope) do update
  set days = excluded.days, business = excluded.business, label = excluded.label;
alter table public.settlement_windows enable row level security;
revoke all on public.settlement_windows from anon, authenticated;

-- Working days, counted the way a settlement team counts them. Public holidays
-- are not modelled — the providers quote these as approximate, and erring a day
-- late errs in the direction of not releasing money that has not arrived.
create or replace function public.dz_add_business_days(p_from timestamptz, p_days integer)
returns timestamptz language plpgsql immutable as $$
declare v_at timestamptz := p_from; v_left integer := greatest(p_days, 0);
begin
  while v_left > 0 loop
    v_at := v_at + interval '1 day';
    if extract(isodow from v_at) < 6 then v_left := v_left - 1; end if;
  end loop;
  return v_at;
end $$;

-- ===========================================================================
-- THE EARNING — every deduction lands on the row that earned it
-- ===========================================================================
alter table public.marketplace_earnings
  add column if not exists gateway_fee     bigint  not null default 0,
  add column if not exists tds_amount      bigint  not null default 0,
  add column if not exists tds_bps         integer not null default 0,
  add column if not exists tcs_amount      bigint  not null default 0,
  add column if not exists tcs_bps         integer not null default 0,
  add column if not exists provider        text,
  add column if not exists settlement_note text,
  add column if not exists fee_inr         bigint,
  add column if not exists fx_inr_rate     numeric(18,8);

-- The old rule said commission plus net was the whole sale. It is not, and
-- believing it was is what let three deductions go missing.
alter table public.marketplace_earnings drop constraint if exists earnings_splits_add_up;
alter table public.marketplace_earnings add constraint earnings_splits_add_up check (
  gateway_fee + fee_amount + tds_amount + tcs_amount + net_amount = gross_amount
);

comment on column public.marketplace_earnings.gateway_fee is
  'What Razorpay or PayPal took before the money reached us. Reported by the '
  'provider on the payment, never estimated from a rate card.';
comment on column public.marketplace_earnings.net_amount is
  'The seller''s, after the gateway, our commission, TDS and TCS. Pending '
  'until available_at, then withdrawable. Never converted to another currency.';
comment on column public.marketplace_earnings.fee_inr is
  'Platform commission in paise, converted once at settlement at the rate '
  'frozen in fx_inr_rate. The seller''s net_amount is NOT converted, ever.';

-- ---------------------------------------------------------------------------
-- Every derived figure, in one place, at the moment of the sale.
--
-- Four checkout paths insert here — rzp.js, paypal.js and both webhooks — and
-- four copies of this arithmetic were four chances to disagree about what a
-- seller is owed. They now send facts only: the gross, what the gateway took,
-- the currency and the provider.
create or replace function public.dz_earning_apply_deductions()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
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

  -- Amounts are in each currency's smallest unit, and a zero-decimal
  -- currency's smallest unit IS its major unit — 100 JPY is stored as 100, not
  -- 10000. Rupees have paise, so the factor goes back on when converting.
  v_scale := case when new.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end;

  new.gateway_fee := greatest(coalesce(new.gateway_fee, 0), 0);
  v_after_gw      := new.gross_amount - new.gateway_fee;
  if v_after_gw < 0 then raise exception 'gateway fee exceeds the sale'; end if;

  -- ---- our commission ------------------------------------------------------
  new.fee_bps    := coalesce(nullif(new.fee_bps, 0), cfg.commission_bps);
  new.fee_amount := round(new.gross_amount::numeric * new.fee_bps / 10000);

  -- ---- 194-O, withheld at CREDIT -------------------------------------------
  -- "at credit or payment, whichever is earlier". The credit is this row, so
  -- this is the earlier of the two — it used to be taken at payout time, which
  -- was late by the length of the hold and was taken a second time on a
  -- balance that had already had it deducted.
  select country, pan, is_individual into v_tax
    from public.seller_tax where user_id = new.seller_id;

  -- No declaration on file reads as Indian residence without a PAN. Under-
  -- withholding is the platform's liability; over-withholding is the seller's
  -- to reclaim in their own return.
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

  -- ---- section 52 GST TCS --------------------------------------------------
  if cfg.tcs_active and v_country = 'IN' then
    new.tcs_bps    := cfg.tcs_bps;
    new.tcs_amount := round(new.gross_amount::numeric * cfg.tcs_bps / 10000);
  else
    new.tcs_bps    := 0;
    new.tcs_amount := 0;
  end if;

  -- ---- what is left is the seller's ----------------------------------------
  new.net_amount := v_after_gw - new.fee_amount - new.tds_amount - new.tcs_amount;
  if new.net_amount < 0 then
    -- Deductions cannot exceed the sale. Our commission gives way before the
    -- statutory pieces do — those are not ours to waive.
    new.fee_amount := greatest(v_after_gw - new.tds_amount - new.tcs_amount, 0);
    new.net_amount := v_after_gw - new.fee_amount - new.tds_amount - new.tcs_amount;
  end if;
  if new.net_amount < 0 then raise exception 'deductions exceed the sale value'; end if;

  -- ---- when it clears ------------------------------------------------------
  -- Not a flat seven-day hold any more; the provider's own window, and for
  -- Razorpay that turns on whether the sale was domestic.
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

  -- ---- our commission in rupees, frozen ------------------------------------
  select inr_rate into v_rate from public.fx_rates where code = new.currency;
  if v_rate is not null then
    new.fx_inr_rate := v_rate;
    new.fee_inr     := round(new.fee_amount * v_rate * v_scale);
  end if;

  return new;
end $$;

drop trigger if exists dz_earning_commission_inr on public.marketplace_earnings;
drop function if exists public.dz_earning_commission_inr();
drop trigger if exists dz_earning_apply_deductions on public.marketplace_earnings;
create trigger dz_earning_apply_deductions
  before insert on public.marketplace_earnings
  for each row execute function public.dz_earning_apply_deductions();
revoke all on function public.dz_earning_apply_deductions() from public, anon, authenticated;

-- ===========================================================================
-- THE WALLET — two halves, per currency, that never mix
-- ===========================================================================
-- A row is PENDING while available_at is still in the future, and it carries
-- the whole gross. It becomes AVAILABLE on its own, at the settlement date,
-- with no job to run and nothing to flip — the date is the fact, so there is
-- no second copy of it to fall out of step.
drop function if exists public.dz_wallet_summary();
create function public.dz_wallet_summary()
returns table(
  currency text, pending_gross bigint, pending_net bigint, pending_gateway bigint,
  pending_fee bigint, pending_tds bigint, pending_tcs bigint,
  next_clears_at timestamptz, settlement_note text,
  available bigint, locked bigint, withdrawable bigint,
  total_sales bigint, gateway_fees bigint, commission bigint,
  tds_withheld bigint, tcs_collected bigint, paid_out bigint, items_sold bigint)
language sql security definer set search_path to 'public', 'pg_temp' as $$
  with e as (
    select
      currency,
      coalesce(sum(gross_amount) filter (where is_pending), 0)  as p_gross,
      coalesce(sum(net_amount)   filter (where is_pending), 0)  as p_net,
      coalesce(sum(gateway_fee)  filter (where is_pending), 0)  as p_gw,
      coalesce(sum(fee_amount)   filter (where is_pending), 0)  as p_fee,
      coalesce(sum(tds_amount)   filter (where is_pending), 0)  as p_tds,
      coalesce(sum(tcs_amount)   filter (where is_pending), 0)  as p_tcs,
      min(available_at)          filter (where is_pending)      as p_next,
      (array_agg(settlement_note order by available_at)
         filter (where is_pending and settlement_note is not null))[1] as p_note,
      coalesce(sum(net_amount) filter (
        where status = 'available' and available_at <= now()), 0) as avail,
      coalesce(sum(gross_amount) filter (where status <> 'reversed'), 0) as gross,
      coalesce(sum(gateway_fee)  filter (where status <> 'reversed'), 0) as gw,
      coalesce(sum(fee_amount)   filter (where status <> 'reversed'), 0) as fee,
      coalesce(sum(tds_amount)   filter (where status <> 'reversed'), 0) as tds,
      coalesce(sum(tcs_amount)   filter (where status <> 'reversed'), 0) as tcs,
      coalesce(sum(net_amount)   filter (where status = 'paid_out'), 0)  as out,
      count(*) filter (where status <> 'reversed') as sold
    from (
      select *, (status = 'pending' or (status = 'available' and available_at > now()))
               as is_pending
      from public.marketplace_earnings where seller_id = auth.uid()
    ) x
    group by currency
  ),
  l as (
    select currency, coalesce(sum(amount), 0) as locked
    from public.payout_requests
    where user_id = auth.uid() and status in ('requested', 'approved', 'processing')
    group by currency
  ),
  cur as (select currency from e union select currency from l)
  select
    c.currency,
    coalesce(e.p_gross, 0)::bigint, coalesce(e.p_net, 0)::bigint,
    coalesce(e.p_gw, 0)::bigint, coalesce(e.p_fee, 0)::bigint,
    coalesce(e.p_tds, 0)::bigint, coalesce(e.p_tcs, 0)::bigint,
    e.p_next, e.p_note,
    coalesce(e.avail, 0)::bigint, coalesce(l.locked, 0)::bigint,
    greatest(coalesce(e.avail, 0) - coalesce(l.locked, 0), 0)::bigint,
    coalesce(e.gross, 0)::bigint, coalesce(e.gw, 0)::bigint, coalesce(e.fee, 0)::bigint,
    coalesce(e.tds, 0)::bigint, coalesce(e.tcs, 0)::bigint,
    coalesce(e.out, 0)::bigint, coalesce(e.sold, 0)::bigint
  from cur c
  left join e on e.currency = c.currency
  left join l on l.currency = c.currency
  order by c.currency;
$$;
revoke all on function public.dz_wallet_summary() from public, anon;
grant execute on function public.dz_wallet_summary() to authenticated;

-- dz_seller_balance() answered the same question one column short and nothing
-- called it. Two functions that have to agree about money is one too many.
drop function if exists public.dz_seller_balance();

-- ===========================================================================
-- THE 194-O THRESHOLD — the only place a seller's sales are read in rupees
-- ===========================================================================
-- The rate applies to the sale in its own currency and is withheld in that
-- currency. Only the Rs 5,00,000 exemption floor is a rupee figure by law, so
-- this expresses the year's gross in INR to compare against it — in a single
-- hop, and no money moves on the answer.
create or replace function public.dz_fy_gross(p_user uuid)
returns bigint language sql security definer
set search_path to 'public', 'pg_temp' as $$
  select coalesce(sum(
           round(e.gross_amount * f.inr_rate *
                 case when e.currency in ('JPY', 'HUF', 'TWD') then 100 else 1 end)
         ), 0)::bigint
  from public.marketplace_earnings e
  join public.fx_rates f on f.code = e.currency
  where e.seller_id = p_user
    and e.status <> 'reversed'
    and e.created_at >= (
      make_timestamptz(
        case when extract(month from now()) >= 4
             then extract(year from now())::int
             else extract(year from now())::int - 1 end,
        4, 1, 0, 0, 0, 'UTC')
    );
$$;
revoke all on function public.dz_fy_gross(uuid) from public, anon, authenticated;

-- ===========================================================================
-- WHAT IS OWED TO THE GOVERNMENT, AND BY WHEN
-- ===========================================================================
create table if not exists public.tax_remittances (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('gst_tcs', 'tds_194o')),
  period      date not null,                -- first day of the month covered
  amount_inr  bigint not null,
  remitted_at timestamptz,
  reference   text,
  note        text,
  created_at  timestamptz not null default now(),
  unique (kind, period)
);
alter table public.tax_remittances enable row level security;
revoke all on public.tax_remittances from anon, authenticated;

drop function if exists public.dz_tax_due();
create function public.dz_tax_due()
returns table(kind text, period date, collected bigint, remit_by date,
              remitted_at timestamptz, overdue boolean)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not allowed';
  end if;
  return query
  with m as (
    select date_trunc('month', e.created_at)::date as period,
      -- owed in rupees whatever the sale was priced in
      sum(round(e.tcs_amount * f.inr_rate *
          case when e.currency in ('JPY','HUF','TWD') then 100 else 1 end))::bigint as tcs,
      sum(round(e.tds_amount * f.inr_rate *
          case when e.currency in ('JPY','HUF','TWD') then 100 else 1 end))::bigint as tds
    from public.marketplace_earnings e
    join public.fx_rates f on f.code = e.currency
    where e.status <> 'reversed'
    group by 1
  ),
  rows_out as (
    -- TCS: by the 10th of the following month
    select 'gst_tcs'::text as kind, m.period, m.tcs as collected,
           (m.period + interval '1 month' + interval '9 days')::date as remit_by
    from m where m.tcs > 0
    union all
    -- TDS: by the 7th of the following month
    select 'tds_194o'::text, m.period, m.tds,
           (m.period + interval '1 month' + interval '6 days')::date
    from m where m.tds > 0
  )
  select r.kind, r.period, r.collected, r.remit_by, t.remitted_at,
         (t.remitted_at is null and r.remit_by < current_date) as overdue
  from rows_out r
  left join public.tax_remittances t on t.kind = r.kind and t.period = r.period
  order by r.period desc, r.kind;
end $$;
revoke all on function public.dz_tax_due() from public, anon;
grant execute on function public.dz_tax_due() to authenticated;

-- ===========================================================================
-- WHAT REACHES THE PLATFORM'S BANK ACCOUNT, AND NOTHING ELSE
-- ===========================================================================
-- Commission and subscriptions are ours. A seller's net is theirs and sits in
-- the provider account under their name in our books until a payout sends it
-- on. TCS and TDS pass through us to the government. The last three are
-- reported separately so none of them can be read as income.
drop function if exists public.dz_platform_revenue();
create function public.dz_platform_revenue()
returns table(commission_inr bigint, subscriptions_inr bigint, total_inr bigint,
              tds_held_inr bigint, tcs_held_inr bigint, held_for_sellers json)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
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
  held as (
    -- owed to sellers, per currency, unconverted: the money that is NOT ours
    select coalesce(json_object_agg(currency, amt), '{}'::json) as js
    from (
      select currency, sum(net_amount)::bigint as amt
      from public.marketplace_earnings
      where status in ('pending', 'available')
      group by currency
    ) x
  )
  select com.amt, sub.amt, (com.amt + sub.amt)::bigint, stat.tds, stat.tcs, held.js
  from com, sub, stat, held;
end $$;
revoke all on function public.dz_platform_revenue() from public, anon;
grant execute on function public.dz_platform_revenue() to authenticated;
