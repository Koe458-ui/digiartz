-- Production security audit, 2026-08-30.
--
-- Five changes, each one closing a gap found by walking the schema rather than
-- the application. Nothing here removes a capability a member already has.

-- 1 ------------------------------------------------------------------------
-- profiles: the insert guard covered role, max_claimed and partner_since, and
-- stopped there. The INSERT grant, however, still covers every column on the
-- table, entitlement columns included.
--
-- Nothing exploits this today: handle_new_user() writes the row the moment the
-- account exists, so a member's own insert always collides on the primary key,
-- and an upsert would need UPDATE privilege on columns they do not hold. Both
-- of those are accidents of ordering, not decisions. A member must not be able
-- to name their own tier even if a row is ever missing.

create or replace function public.dz_profiles_guard_insert()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp' as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- Unchanged. Note that role is NOT NULL DEFAULT 'guest', so in practice
    -- this already refuses every member-side insert into profiles; the row is
    -- written by handle_new_user() the moment the account exists.
    if new.role is not null or new.max_claimed or new.partner_since is not null then
      raise exception 'role, max_claimed and partner_since are not yours to set';
    end if;

    -- Added. The check above holds today only because of that default, which
    -- is an accident of the schema rather than a decision — drop the NOT NULL
    -- from role and the guard opens silently. Entitlement and standing are
    -- earned through payment, moderation and the merit engine, so name them
    -- here too and compare against the value a fresh row is entitled to.
    if new.subscription_tier is distinct from 'guest'
       or new.subscription_expires_at is not null then
      raise exception 'subscription_tier and subscription_expires_at are not yours to set';
    end if;
    if new.merit is distinct from 100
       or new.cred_received_count is distinct from 0 then
      raise exception 'merit and cred_received_count are not yours to set';
    end if;
  end if;
  return new;
end $$;

-- The grant half, and the reason it is written this way.
--
-- The obvious form of this is a column-level revoke:
--
--   revoke insert (role, subscription_tier, ...) on public.profiles from authenticated;
--
-- That is a NO-OP here, and silently so. A column-level REVOKE cannot subtract
-- from a table-level GRANT — Postgres keeps conferring the privilege on every
-- column — and `authenticated` holds INSERT on public.profiles at the table
-- level. The revoke returns success and changes nothing. It was written that
-- way first, and the deployment check caught it only because the live catalogue
-- was compared against what this file claims.
--
-- So: drop the table-level grant, then re-grant per column. The safe set is
-- built from the catalogue rather than typed out, so a column added to profiles
-- later is granted by default and has to be named here to be withheld — the
-- failure mode is a member being unable to write a new display field, not a
-- member being able to write a new privileged one.

do $$
declare safe_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into safe_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name not in ('role','max_claimed','partner_since',
                             'subscription_tier','subscription_expires_at',
                             'merit','merit_updated_at','cred_received_count');

  execute 'revoke insert on public.profiles from anon, authenticated';
  execute format('grant insert (%s) on public.profiles to authenticated', safe_cols);
end $$;

-- After this, the two layers refuse different things and can be told apart:
--   insert naming subscription_tier -> 42501, refused by the GRANT
--   insert of {id, username}        -> P0001, refused by the TRIGGER
-- Before it, only the second refusal existed.

-- 2 ------------------------------------------------------------------------
-- dz_market_owns(): a free listing was downloadable by anyone signed in
-- whatever its status, so a listing pulled for moderation, or one still a
-- draft, kept serving its file to anybody holding the id.
--
-- A PAID purchase is deliberately left untouched by status: somebody who has
-- paid keeps their download even if the listing is later withdrawn. Only the
-- free path and the seller's own path are decided by status.

create or replace function public.dz_market_owns(p_item uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select auth.uid() is not null and exists (
    select 1
      from public.marketplace_items i
     where i.id = p_item
       and (
         i.user_id = auth.uid()
         or (coalesce(i.price_cents, 0) = 0
             and i.status = 'approved'
             and i.visibility = 'published')
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

-- 2b -----------------------------------------------------------------------
-- dz_market_download() is the older download RPC, still reachable over
-- /rest/v1/rpc even though nothing in the client calls it any more. It carried
-- its OWN copy of the owner / free / paid test, and the copy had already
-- drifted from dz_market_owns(): it read a free listing as downloadable
-- whatever its visibility, and counted any paid payment carrying the item id
-- regardless of kind. Two copies of an authorization rule is how one of them
-- ends up wrong, so this one now asks the other.

create or replace function public.dz_market_download(p_item uuid)
returns text language plpgsql security definer
set search_path to 'public', 'pg_temp' as $function$
declare v record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select id, user_id, file_url, status into v
    from public.marketplace_items where id = p_item;
  if v.id is null or (v.status <> 'approved' and v.user_id <> auth.uid()) then
    raise exception 'Listing not found';
  end if;
  if v.file_url is null then
    raise exception 'This listing has no downloadable file';
  end if;

  if not public.dz_market_owns(p_item) then
    raise exception 'Purchase required';
  end if;

  return v.file_url;
end $function$;

-- 3 ------------------------------------------------------------------------
-- Engagement counters. artworks has protect_artwork_like_count and the item
-- tables have zz_protect_view_count, but like_count, bookmark_count,
-- download_count and sales_count on the item tables were writable by whoever
-- owns the row — which is a seller writing their own social proof.
--
-- The client never sends these; it only reads them. The guard fires only for a
-- direct PostgREST write (current_user is 'authenticated' or 'anon'), so the
-- SECURITY DEFINER counter paths — dz_resource_file_grant incrementing
-- download_count, the like/bookmark sync triggers — are untouched, and so is
-- the service role.

create or replace function public.dz_protect_social_counters()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if TG_TABLE_NAME = 'marketplace_items' then
    if TG_OP = 'INSERT' then
      new.like_count := 0; new.sales_count := 0;
    else
      new.like_count := old.like_count; new.sales_count := old.sales_count;
    end if;

  elsif TG_TABLE_NAME = 'resources' then
    if TG_OP = 'INSERT' then
      new.like_count := 0; new.download_count := 0;
    else
      new.like_count := old.like_count; new.download_count := old.download_count;
    end if;

  elsif TG_TABLE_NAME = 'blog_posts' then
    if TG_OP = 'INSERT' then
      new.like_count := 0; new.bookmark_count := 0;
    else
      new.like_count := old.like_count; new.bookmark_count := old.bookmark_count;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists zz_protect_social_counters on public.marketplace_items;
create trigger zz_protect_social_counters
  before insert or update on public.marketplace_items
  for each row execute function public.dz_protect_social_counters();

drop trigger if exists zz_protect_social_counters on public.resources;
create trigger zz_protect_social_counters
  before insert or update on public.resources
  for each row execute function public.dz_protect_social_counters();

drop trigger if exists zz_protect_social_counters on public.blog_posts;
create trigger zz_protect_social_counters
  before insert or update on public.blog_posts
  for each row execute function public.dz_protect_social_counters();

revoke all on function public.dz_protect_social_counters() from public, anon, authenticated;

-- 4 ------------------------------------------------------------------------
-- payments.rzp_order_id is unique; pp_order_id was not. Both are the key the
-- webhook settles on, and both should be able to match at most one row.

create unique index if not exists payments_pp_order_id_key
  on public.payments (pp_order_id) where pp_order_id is not null;

-- 5 ------------------------------------------------------------------------
-- search_path on the remaining functions that did not pin one. All nine are
-- SECURITY INVOKER, so this is not the classic definer escalation — but two of
-- them (dz_has_link, dz_phish_score) are the anti-phishing guard, and a guard
-- whose operator resolution depends on the caller's search_path is a guard with
-- a seam in it.

alter function public.dz_ledger_immutable()          set search_path to 'public', 'pg_temp';
alter function public.dz_add_business_days(timestamptz, integer)
                                                     set search_path to 'public', 'pg_temp';
alter function public.dz_an_days(integer)            set search_path to 'public', 'pg_temp';
alter function public.dz_an_scope(text)              set search_path to 'public', 'pg_temp';
alter function public.dz_deobfuscate(text)           set search_path to 'public', 'pg_temp';
alter function public.dz_has_link(text)              set search_path to 'public', 'pg_temp';
alter function public.dz_phish_score(text)           set search_path to 'public', 'pg_temp';
alter function public.dz_fold_name(text)             set search_path to 'public', 'pg_temp';
alter function public.dz_content_fingerprint(text)   set search_path to 'public', 'pg_temp';

-- 6 ------------------------------------------------------------------------
-- Storage. koe-media is the PUBLIC bucket and it carried no file_size_limit at
-- all, so the only size check on an upload was the one the edge function makes
-- against the size the CLIENT declares before it mints the signed URL. Declare
-- one byte, PUT a gigabyte. 400MB is the same ceiling smart-function grants a
-- Max member, so no legitimate upload changes.
--
-- Applied to the live project on 2026-08-30; kept here so a rebuilt project
-- gets it too.
--
-- Both buckets are named, not just koe-media. On the live project koe-originals
-- already carried this limit, so the original statement only had to fix the
-- public one — but that made this file describe the project it was written
-- against rather than the state it is supposed to produce. Replayed onto a
-- rebuilt project where koe-originals came up unbounded, it would have left it
-- unbounded. `is null` is kept so neither bucket is overwritten if an operator
-- has deliberately set a different ceiling.

update storage.buckets
   set file_size_limit = 419430400          -- 400 MB, = MAX_ASSET_BYTES_MAX
 where id in ('koe-media', 'koe-originals')
   and file_size_limit is null;

-- NOT done here, deliberately: allowed_mime_types on koe-media. The bucket has
-- to accept every extension in smart-function's ASSET_EXT — archives, fonts,
-- 3D formats, brush sets — and a list that misses one silently breaks that
-- upload. See security/SECURITY.md, "Remaining risks", for what is still open
-- and what closing it would take.
