-- A job posting says the whole job
--
-- The composer asked for a title, a company, one description box and a pay
-- range, and left everything an applicant actually decides on — the hours,
-- the timezone, what to send, when it closes — to be buried inside that one
-- box or left out entirely. This is the rest of the posting, one column per
-- thing rather than one prose field standing in for twenty.
--
-- Everything added here is nullable (or defaulted) so every row already in
-- the table stays valid and keeps reading exactly as it did. The bounds below
-- are the same numbers the composer enforces while typing; they are repeated
-- here because a form is a courtesy and a constraint is a guarantee, and the
-- two have to agree or the browser is the only thing standing between the
-- table and a hundred thousand word posting.
--
-- work_mode replaces the is_remote checkbox as the thing the composer asks
-- for, because "remote or not" cannot say hybrid. is_remote stays and stays
-- authoritative: the two existing location constraints are written against
-- it, the cards and the search index read it, and the composer keeps it in
-- step (is_remote = work_mode is 'remote'). Existing rows are backfilled from
-- it in the same direction.

alter table public.jobs
  add column if not exists about_company            text,
  add column if not exists experience_level         text,
  add column if not exists years_experience         integer,
  add column if not exists openings                 integer,
  add column if not exists responsibilities         text,
  add column if not exists requirements             text,
  add column if not exists required_skills          text,
  add column if not exists nice_to_have_skills      text,
  add column if not exists benefits                 text,
  add column if not exists work_mode                text,
  add column if not exists timezone                 text,
  add column if not exists working_hours            text,
  add column if not exists schedule                 text,
  add column if not exists start_date               date,
  add column if not exists contract_duration        text,
  add column if not exists application_instructions text,
  add column if not exists application_materials    text,
  add column if not exists application_questions    text,
  add column if not exists portfolio_required       boolean not null default false,
  add column if not exists resume_required          boolean not null default false,
  add column if not exists cover_letter_required    boolean not null default false,
  add column if not exists visibility               text    not null default 'public',
  add column if not exists featured                 boolean not null default false;

-- the postings that predate the column already said which of the three they
-- were, in the only two words the old form had
update public.jobs
   set work_mode = case when is_remote then 'remote' else 'onsite' end
 where work_mode is null;

alter table public.jobs alter column work_mode set default 'onsite';

-- ---- bounds ---------------------------------------------------------------
-- Each one is `x is null or …` so a row that never carried the field is not
-- retroactively invalid. do-blocks because `add constraint if not exists` is
-- not a thing, and this migration has to be safe to run twice.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('jobs_about_company_len',   'about_company is null or char_length(btrim(about_company)) between 50 and 2000'),
      ('jobs_company_url_len',     'company_url is null or char_length(btrim(company_url)) between 5 and 200'),
      ('jobs_experience_level_len','experience_level is null or char_length(btrim(experience_level)) between 2 and 20'),
      ('jobs_years_experience_rng','years_experience is null or years_experience between 0 and 60'),
      ('jobs_openings_rng',        'openings is null or openings between 1 and 999'),
      ('jobs_responsibilities_len','responsibilities is null or char_length(btrim(responsibilities)) between 50 and 3000'),
      ('jobs_requirements_len',    'requirements is null or char_length(btrim(requirements)) between 50 and 3000'),
      ('jobs_required_skills_len', 'required_skills is null or char_length(btrim(required_skills)) between 10 and 1000'),
      ('jobs_nice_skills_len',     'nice_to_have_skills is null or char_length(btrim(nice_to_have_skills)) between 10 and 1000'),
      ('jobs_benefits_len',        'benefits is null or char_length(btrim(benefits)) between 20 and 2000'),
      ('jobs_work_mode_vals',      'work_mode is null or work_mode in (''remote'',''onsite'',''hybrid'')'),
      ('jobs_timezone_len',        'timezone is null or char_length(btrim(timezone)) between 3 and 50'),
      ('jobs_working_hours_len',   'working_hours is null or char_length(btrim(working_hours)) between 3 and 100'),
      ('jobs_schedule_len',        'schedule is null or char_length(btrim(schedule)) between 3 and 100'),
      ('jobs_contract_dur_len',    'contract_duration is null or char_length(btrim(contract_duration)) between 2 and 100'),
      ('jobs_apply_url_len',       'apply_url is null or char_length(btrim(apply_url)) between 10 and 200'),
      ('jobs_apply_email_len',     'apply_email is null or char_length(btrim(apply_email)) between 5 and 254'),
      ('jobs_app_instructions_len','application_instructions is null or char_length(btrim(application_instructions)) between 20 and 1500'),
      ('jobs_app_materials_len',   'application_materials is null or char_length(btrim(application_materials)) between 10 and 1000'),
      ('jobs_app_questions_len',   'application_questions is null or char_length(btrim(application_questions)) between 5 and 1000'),
      ('jobs_visibility_vals',     'visibility in (''public'',''unlisted'',''private'')'),
      ('jobs_salary_nonneg',       '(salary_min is null or salary_min >= 0) and (salary_max is null or salary_max >= 0)'),
      ('jobs_city_len',            'location_city is null or char_length(btrim(location_city)) between 2 and 100'),
      ('jobs_applicant_countries_n','cardinality(applicant_countries) <= 60')
    ) as t(name, expr)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.jobs'::regclass and conname = c.name) then
      execute format('alter table public.jobs add constraint %I check (%s) not valid', c.name, c.expr);
      execute format('alter table public.jobs validate constraint %I', c.name);
    end if;
  end loop;
end $$;

-- ---- grants ---------------------------------------------------------------
-- Every privilege on this table is column level, so a column nobody was
-- granted is a column the client cannot read, write, or even name in a select
-- list without failing the whole request. New columns need saying out loud.
grant select (
  about_company, experience_level, years_experience, openings, responsibilities,
  requirements, required_skills, nice_to_have_skills, benefits, work_mode,
  timezone, working_hours, schedule, start_date, contract_duration,
  application_instructions, application_materials, application_questions,
  portfolio_required, resume_required, cover_letter_required, visibility, featured
) on public.jobs to anon, authenticated;

grant insert (
  about_company, experience_level, years_experience, openings, responsibilities,
  requirements, required_skills, nice_to_have_skills, benefits, work_mode,
  timezone, working_hours, schedule, start_date, contract_duration,
  application_instructions, application_materials, application_questions,
  portfolio_required, resume_required, cover_letter_required, visibility, featured
) on public.jobs to anon, authenticated;

grant update (
  about_company, experience_level, years_experience, openings, responsibilities,
  requirements, required_skills, nice_to_have_skills, benefits, work_mode,
  timezone, working_hours, schedule, start_date, contract_duration,
  application_instructions, application_materials, application_questions,
  portfolio_required, resume_required, cover_letter_required, visibility, featured
) on public.jobs to anon, authenticated;

-- The list only ever shows public postings, and it sorts featured first. Both
-- of those are one index away from being a sort of the whole table.
create index if not exists jobs_feed_idx
  on public.jobs (status, visibility, featured desc, created_at desc);
