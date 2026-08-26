create or replace function public.dz_market_owns(p_item uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.marketplace_items i
     where i.id = p_item
       and (
         i.user_id = auth.uid()
         or coalesce(i.price_cents, 0) = 0
         or exists (
           select 1 from public.payments p
            where p.item_id = i.id
              and p.user_id = auth.uid()
              and p.kind    = 'marketplace'
              and p.status  = 'paid'
         )
       )
  );
$$;

create or replace function public.dz_market_owned(p_items uuid[])
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select i.id
    from public.marketplace_items i
   where i.id = any(coalesce(p_items, '{}'::uuid[]))
     and public.dz_market_owns(i.id);
$$;

create or replace function public.dz_market_files(p_item uuid)
returns table (
  file_id   uuid,
  name      text,
  ext       text,
  bytes     bigint,
  ordinal   smallint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_market_owns(p_item) then
    raise exception 'Purchase required';
  end if;

  return query
    select f.id,
           coalesce(f.original_filename, 'file')::text,
           (case when coalesce(f.original_filename, '') ~ '\.[A-Za-z0-9]{1,12}$'
                 then lower(regexp_replace(f.original_filename, '^.*\.', ''))
                 else 'file' end)::text,
           coalesce(f.bytes, 0)::bigint,
           f.position
      from public.marketplace_file f
     where f.item_id = p_item
     order by f.position, f.created_at;

  if found then
    return;
  end if;

  return query
    select i.id,
           coalesce(i.file_name, i.title, 'file')::text,
           lower(coalesce(nullif(i.file_ext, ''), 'file'))::text,
           coalesce(i.file_size, 0)::bigint,
           0::smallint
      from public.marketplace_items i
     where i.id = p_item
       and (i.file_storage_path is not null or i.file_url is not null);
end $$;

create or replace function public.dz_market_file_grant(p_item uuid, p_file uuid)
returns table (
  bucket    text,
  path      text,
  filename  text,
  mime      text,
  legacy_url text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.dz_market_owns(p_item) then
    raise exception 'Purchase required';
  end if;

  if p_file = p_item then
    return query
      select 'koe-media'::text,
             i.file_storage_path::text,
             coalesce(i.file_name, i.title, 'file')::text,
             null::text,
             i.file_url::text
        from public.marketplace_items i
       where i.id = p_item;
    return;
  end if;

  return query
    select f.storage_bucket::text,
           f.storage_path::text,
           coalesce(f.original_filename, 'file')::text,
           f.mime::text,
           null::text
      from public.marketplace_file f
     where f.id = p_file
       and f.item_id = p_item;
end $$;

create or replace function public.dz_my_purchases()
returns table (
  payment_id  uuid,
  item_id     uuid,
  title       text,
  preview_url text,
  item_type   text,
  license     text,
  seller_id   uuid,
  seller_name text,
  amount      bigint,
  currency    text,
  paid_at     timestamptz,
  provider    text,
  file_count  integer,
  delisted    boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.id,
         p.item_id,
         coalesce(i.title, p.order_label, 'Marketplace item')::text,
         i.preview_url::text,
         i.item_type::text,
         i.license::text,
         i.user_id,
         pr.username::text,
         p.amount,
         p.currency::text,
         coalesce(p.paid_at, p.created_at),
         p.provider::text,
         (
           coalesce((select count(*) from public.marketplace_file f where f.item_id = i.id), 0)
           + case when i.file_storage_path is not null or i.file_url is not null then 1 else 0 end
         )::integer,
         (i.id is null)
    from public.payments p
    left join public.marketplace_items i on i.id = p.item_id
    left join public.profiles pr         on pr.id = i.user_id
   where p.user_id = auth.uid()
     and p.kind    = 'marketplace'
     and p.status  = 'paid'
   order by coalesce(p.paid_at, p.created_at) desc;
$$;

revoke execute on function public.dz_market_owns(uuid)            from public, anon;
revoke execute on function public.dz_market_owned(uuid[])         from public, anon;
revoke execute on function public.dz_market_files(uuid)           from public, anon;
revoke execute on function public.dz_market_file_grant(uuid,uuid) from public, anon;
revoke execute on function public.dz_my_purchases()               from public, anon;

grant execute on function public.dz_market_owns(uuid)            to authenticated;
grant execute on function public.dz_market_owned(uuid[])         to authenticated;
grant execute on function public.dz_market_files(uuid)           to authenticated;
grant execute on function public.dz_market_file_grant(uuid,uuid) to authenticated;
grant execute on function public.dz_my_purchases()               to authenticated;

create index if not exists payments_item_user_status_idx
  on public.payments (item_id, user_id, status)
  where item_id is not null;
