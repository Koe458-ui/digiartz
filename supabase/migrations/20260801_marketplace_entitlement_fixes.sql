-- Two corrections to the entitlement functions, found while wiring the
-- composer to them.
--
-- 1. The legacy grant assumed koe-media. That was true of every listing
--    published before this change and false of every listing published after
--    it: the composer now keeps the first product file's path on the item row
--    as well (the storage delete gate matches a seller against that column), so
--    a listing whose marketplace_file rows failed to write would fall back to
--    the legacy branch and be signed against the wrong bucket. The bucket is
--    not a guess to make — storage.objects knows which one holds the object.
--
-- 2. file_count added the item's own file column to the marketplace_file count,
--    so a listing that carries both — which is now every new listing — reported
--    one file more than it has.
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
      select coalesce(
               (select o.bucket_id::text
                  from storage.objects o
                 where o.name = i.file_storage_path
                   and o.bucket_id in ('koe-originals', 'koe-media')
                 order by (o.bucket_id = 'koe-originals') desc
                 limit 1),
               'koe-media'),
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
         -- the same rule dz_market_files uses: attached files if there are any,
         -- otherwise the one file the item row carries by itself
         (case
            when (select count(*) from public.marketplace_file f where f.item_id = i.id) > 0
              then (select count(*) from public.marketplace_file f where f.item_id = i.id)
            when i.file_storage_path is not null or i.file_url is not null then 1
            else 0
          end)::integer,
         (i.id is null)
    from public.payments p
    left join public.marketplace_items i on i.id = p.item_id
    left join public.profiles pr         on pr.id = i.user_id
   where p.user_id = auth.uid()
     and p.kind    = 'marketplace'
     and p.status  = 'paid'
   order by coalesce(p.paid_at, p.created_at) desc;
$$;

revoke execute on function public.dz_market_file_grant(uuid,uuid) from public, anon;
revoke execute on function public.dz_my_purchases()               from public, anon;
grant  execute on function public.dz_market_file_grant(uuid,uuid) to authenticated;
grant  execute on function public.dz_my_purchases()               to authenticated;
