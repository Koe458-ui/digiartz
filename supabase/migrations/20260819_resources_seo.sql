alter table public.resources
  add column if not exists seo_title       text,
  add column if not exists seo_description text,
  add column if not exists slug            text;

do $$
declare c record;
begin
  for c in
    select * from (values
      ('res_seo_title_len', 'seo_title is null or char_length(btrim(seo_title)) between 10 and 70', true),
      ('res_seo_desc_len',  'seo_description is null or char_length(btrim(seo_description)) between 50 and 160', true),
      ('res_slug_len',      'slug is null or char_length(btrim(slug)) between 3 and 120', true)
    ) as t(name, expr, do_validate)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.resources'::regclass and conname = c.name) then
      execute format('alter table public.resources add constraint %I check (%s) not valid', c.name, c.expr);
      if c.do_validate then
        execute format('alter table public.resources validate constraint %I', c.name);
      end if;
    end if;
  end loop;
end $$;

grant select (seo_title, seo_description, slug) on public.resources to anon, authenticated;
grant insert (seo_title, seo_description, slug) on public.resources to anon, authenticated;
grant update (seo_title, seo_description, slug) on public.resources to anon, authenticated;
