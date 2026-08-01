-- Marketplace purchase entitlement
--
-- One question decides everything on the marketplace side: does this caller own
-- this listing? It is asked by the card, by the detail view, by My Purchases and
-- by the download endpoint, and it must answer the same way every time — so it
-- is written once here, as dz_market_owns, and every other function calls it.
--
-- Ownership is derived from payments rather than kept in a purchases table of
-- its own. A second table would be a second truth: a refund or a chargeback
-- moves the payment row to 'refunded'/'reversed' (paypal-webhook.js does this
-- already), and access has to move with it. Deriving means a reversed sale
-- withdraws the download in the same instant, with nothing left to keep in step.
--
-- Every function here is SECURITY DEFINER because the tables underneath are
-- closed to the buyer on purpose: marketplace_file is owner-only, and SELECT on
-- marketplace_items.file_url / file_storage_path is revoked for anon and
-- authenticated alike. A buyer never reads a storage path; they call these,
-- which hand the worker a path only after the ownership test passes.

-- ---------------------------------------------------------------------------
-- the one definition of ownership
--
-- Seller: their own listing, always. Free listing: nothing to buy. Otherwise a
-- payment of this item, by this caller, standing at 'paid' — 'created' is a
-- checkout that was opened, not money that arrived.
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

-- Which of these does the caller own? The grid asks once for every id on the
-- page rather than once per card, and gets back only the ids that unlock.
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

-- ---------------------------------------------------------------------------
-- what a buyer receives
--
-- Names and sizes only. The storage path is not in the result: it is not the
-- buyer's to hold, and handing it out would make the download reproducible
-- without coming back through the gate.
--
-- Listings published before multi-file upload carry a single file in the
-- marketplace_items columns instead of a marketplace_file row. Those still have
-- to be downloadable, so they come back as one synthetic row whose file_id is
-- the item's own id — the id dz_market_file_grant reads as "the legacy file".
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

-- ---------------------------------------------------------------------------
-- the one call that yields a storage path
--
-- Answered for the buyer's own worker request and nothing else: /api/market-
-- download calls it with the caller's own JWT, so auth.uid() is the buyer, and
-- signs what comes back with the service role. The path never reaches a browser.
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

  -- The pre-multi-file listing. Its single object was written to the public
  -- bucket, which is exactly what this feature stops doing — it is still served
  -- through the gate so old listings behave like new ones from the buyer's side,
  -- and legacy_url is the fallback for rows that kept a url but no path.
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

-- ---------------------------------------------------------------------------
-- My Purchases
--
-- Everything the caller has paid for, newest first, whether or not the listing
-- still exists. A seller who delists after the sale does not take the buyer's
-- copy with them, so the title falls back to the label written on the payment
-- at checkout and the row says plainly that the files are gone.
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

-- ---------------------------------------------------------------------------
-- Only a signed-in caller has any business asking any of this. anon is refused
-- at the grant rather than inside the function body.
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

-- The lookup every one of these makes on the way to an answer.
create index if not exists payments_item_user_status_idx
  on public.payments (item_id, user_id, status)
  where item_id is not null;
