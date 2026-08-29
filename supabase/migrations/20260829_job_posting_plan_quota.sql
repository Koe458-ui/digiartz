-- Posting a job is a paid feature.
--
--   Free and Lite   cannot post at all. They still read and apply to every
--                   posting — a job board nobody can answer is worthless.
--   Premium         1 posting per plan month.
--   Max             2 postings per plan month.
--
-- "Plan month" is the 31-day window the member is currently inside, not the
-- calendar month and not "since the subscription started". A member who has
-- stacked three months has one expiry date far in the future, so the window is
-- found by stepping back from that expiry in 31-day strides until the stride
-- containing now() is reached. That way an allowance is spent and refilled
-- once per paid month however many months were bought at once.

create or replace function public.dz_job_allowance(p_tier text)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case lower(coalesce(p_tier, ''))
           when 'premium' then 1
           when 'max'     then 2
           else 0
         end
$function$;

comment on function public.dz_job_allowance(text) is
  'Job postings a tier may publish in one plan month. Everything that is not '
  'premium or max gets 0 — including an expired plan, which reaches here as null.';

create or replace function public.dz_job_plan(p_user uuid)
returns table (tier text, allowance integer,
               period_start timestamptz, period_end timestamptz)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select q.tier,
         public.dz_job_allowance(q.tier),
         q.p_start,
         q.p_start + interval '31 days'
    from (
      select case when p.subscription_expires_at is null
                   or p.subscription_expires_at <= now()
                  then null
                  else p.subscription_tier
             end as tier,
             case when p.subscription_expires_at is null
                   or p.subscription_expires_at <= now()
                  then null
                  else p.subscription_expires_at
                       - (ceil(extract(epoch from (p.subscription_expires_at - now()))
                               / 2678400.0)::double precision * interval '31 days')
             end as p_start
        -- left join, so an id with no profile row still answers "no plan"
        -- rather than answering nothing and leaving the caller's record
        -- unassigned.
        from (select p_user as uid) s
        left join public.profiles p on p.id = s.uid
    ) q
$function$;

comment on function public.dz_job_plan(uuid) is
  'The member''s live subscription tier, how many job postings it allows, and '
  'the 31-day plan window now() falls inside. tier is null once the plan has '
  'expired, which is what makes the allowance 0.';

revoke all on function public.dz_job_plan(uuid) from public, anon, authenticated;

-- What the upload page asks before it decides whether to draw the form, the
-- "join Premium or Max" panel, or the "you have used this month's postings"
-- panel. It reports on the caller and nobody else.
create or replace function public.dz_job_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_plan  record;
  v_used  integer := 0;
  v_staff boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('tier', null, 'limit', 0, 'used', 0,
                              'remaining', 0, 'allowed', false, 'reason', 'auth');
  end if;

  begin
    v_staff := public.dz_is_staff(v_uid);
  exception when others then
    v_staff := false;
  end;

  select * into v_plan from public.dz_job_plan(v_uid);

  if v_staff then
    return jsonb_build_object('tier', coalesce(v_plan.tier, 'staff'),
                              'limit', null, 'used', 0, 'remaining', null,
                              'allowed', true, 'staff', true);
  end if;

  if v_plan.tier is null or coalesce(v_plan.allowance, 0) = 0 then
    return jsonb_build_object('tier', v_plan.tier, 'limit', 0, 'used', 0,
                              'remaining', 0, 'allowed', false, 'reason', 'plan');
  end if;

  -- A posting waiting on a publish date has already spent its slot. Counting
  -- it here is what stops someone scheduling four and being told, four times
  -- over and long after the fact, that three of them could not be published.
  select count(*) into v_used
    from (
      select 1 from public.jobs
       where user_id = v_uid and created_at >= v_plan.period_start
      union all
      select 1 from public.scheduled_sections
       where user_id = v_uid and section = 'jobs' and publish_error is null
    ) q;

  return jsonb_build_object(
    'tier',         v_plan.tier,
    'limit',        v_plan.allowance,
    'used',         v_used,
    'remaining',    greatest(v_plan.allowance - v_used, 0),
    'allowed',      v_used < v_plan.allowance,
    'reason',       case when v_used < v_plan.allowance then null else 'limit' end,
    'period_start', v_plan.period_start,
    'period_end',   v_plan.period_end);
end $function$;

revoke all on function public.dz_job_quota() from public, anon;
grant execute on function public.dz_job_quota() to authenticated;

comment on function public.dz_job_quota() is
  'The caller''s job-posting allowance for the plan month they are in. '
  'reason is auth (signed out), plan (no Premium or Max) or limit (spent).';

-- The rule itself. The page above is a courtesy; this is what actually holds,
-- and it holds for a scheduled posting reaching its publish date too — that
-- insert arrives with no auth.uid(), so the row's own owner is the subject.
create or replace function public.dz_job_post_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid;
  v_plan  record;
  v_used  integer;
  v_staff boolean := false;
begin
  -- Nested rather than one condition: plpgsql evaluates a whole expression at
  -- once, so a single "and" would still reach for new.section on the jobs
  -- table, which has no such column.
  if TG_TABLE_NAME = 'scheduled_sections' then
    if coalesce(new.section, '') <> 'jobs' then
      return new;
    end if;
  end if;

  v_uid := coalesce(auth.uid(), new.user_id);
  if v_uid is null then return new; end if;

  begin
    v_staff := public.dz_is_staff(v_uid);
  exception when others then
    v_staff := false;
  end;
  if v_staff then return new; end if;

  select * into v_plan from public.dz_job_plan(v_uid);

  if v_plan.tier is null or coalesce(v_plan.allowance, 0) = 0 then
    raise exception
      'Posting a job needs a Premium or Max subscription'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('dz_job_quota:' || v_uid::text));

  select count(*) into v_used from public.jobs
   where user_id = v_uid and created_at >= v_plan.period_start;

  -- Scheduling asks for a slot it has not spent yet, so the postings already
  -- queued count against it. The publish itself must not count the queued row
  -- it is in the middle of turning into a posting.
  if TG_TABLE_NAME = 'scheduled_sections' then
    select v_used + count(*) into v_used from public.scheduled_sections
     where user_id = v_uid and section = 'jobs' and publish_error is null;
  end if;

  if v_used >= v_plan.allowance then
    raise exception
      'You have used all % job % on your % plan this month',
      v_plan.allowance,
      case when v_plan.allowance = 1 then 'posting' else 'postings' end,
      initcap(v_plan.tier)
      using errcode = 'P0001';
  end if;

  return new;
end $function$;

drop trigger if exists dz_job_post_gate on public.jobs;
create trigger dz_job_post_gate
  before insert on public.jobs
  for each row execute function public.dz_job_post_gate();

drop trigger if exists dz_job_schedule_gate on public.scheduled_sections;
create trigger dz_job_schedule_gate
  before insert on public.scheduled_sections
  for each row execute function public.dz_job_post_gate();

create index if not exists jobs_owner_created_idx
  on public.jobs (user_id, created_at desc);
