alter table public.profiles drop constraint if exists role_valid;
alter table public.profiles drop constraint if exists profiles_role_known;

alter table public.profiles
  add constraint profiles_role_known
  check (role is null or role in ('guest', 'premium', 'admin', 'dev', 'partner'))
  not valid;
alter table public.profiles validate constraint profiles_role_known;

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
    select 'gst_tcs'::text as kind, m.period, m.tcs as collected,
           (m.period + interval '1 month' + interval '9 days')::date as remit_by
    from m where m.tcs > 0
    union all
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
