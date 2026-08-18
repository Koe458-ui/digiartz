-- One vocabulary for profiles.role, and the two things gated on a value it
-- could never hold
--
-- Found by running the partner invite against the live project instead of
-- against a fixture. It failed, every time, with a constraint violation:
--
--   new row for relation "profiles" violates check constraint "role_valid"
--
-- profiles carried role_valid from long before any of this:
--
--   CHECK (role = ANY (ARRAY['guest', 'premium', 'dev']))
--
-- and 20260822 added profiles_role_known allowing guest/admin/dev/partner. A
-- row has to satisfy BOTH, so the effective vocabulary was the intersection —
-- 'guest' and 'dev'. dz_grant_partner() could not write 'partner', which means
-- the entire partner feature was inert the moment it shipped: no partner, no
-- promo code, no commission, no Collab Hub. The migration applied cleanly and
-- every function was correct; the column simply would not take the value.
--
-- It also means 'admin' has never been a value this table could hold, which is
-- worth stating plainly because two things have been gated on it since long
-- before this branch and have therefore never been reachable by anybody:
--
--   dz_tax_due() — what is owed to the government, restated below against
--   dz_is_staff() so it answers for the 'dev' account that actually exists;
--
--   the admin payout actions in functions/api/payouts.js — admin-list,
--   admin-decide and admin-send — which is every control for reviewing and
--   sending a seller's withdrawal. Fixed in that file in the same change.
--
-- Two constraints on one column is the same mistake as two records of the same
-- money, and it failed the same way: they drifted, and the stricter one won
-- silently. There is one now.
--
-- 'premium' is kept. Nothing in this repository writes it and no row carries
-- it, but it predates everything here and dropping a value from a live CHECK
-- is a separate decision from fixing the one that is broken.

alter table public.profiles drop constraint if exists role_valid;
alter table public.profiles drop constraint if exists profiles_role_known;

alter table public.profiles
  add constraint profiles_role_known
  check (role is null or role in ('guest', 'premium', 'admin', 'dev', 'partner'))
  not valid;
alter table public.profiles validate constraint profiles_role_known;

-- ---------------------------------------------------------------------------
-- dz_tax_due(), asked of the accounts that can actually exist.
--
-- Restated rather than patched, for the reason the rest of this schema gives:
-- there is one other copy of this function and two copies of a tax report is
-- one too many. One line differs — the guard.
create or replace function public.dz_tax_due()
returns table(kind text, period date, collected bigint, remit_by date,
              remitted_at timestamptz, overdue boolean)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.dz_is_staff(auth.uid()) then
    raise exception 'not allowed';
  end if;
  return query
  with m as (
    select date_trunc('month', e.created_at)::date as period,
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
