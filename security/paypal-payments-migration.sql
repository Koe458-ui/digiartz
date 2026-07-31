-- payments: multi-provider ledger (Razorpay + PayPal)
--
-- Applied to the live project already. Kept here for the record, and so a
-- fresh database can be brought to the same shape.
--
-- The table was written when Razorpay was the only checkout: rzp_order_id was
-- NOT NULL and doubled as the replay guard. PayPal orders have their own ids
-- and no Razorpay order to name, so the column becomes nullable and each
-- provider carries its own reference, with a check constraint keeping a row
-- from claiming to be one provider while holding the other's ids.
--
-- Nothing downstream needed changing: dz_market_download and the subscription
-- lookups only ever read status = 'paid', which both providers write.

alter table public.payments
  add column if not exists provider      text not null default 'razorpay',
  add column if not exists pp_order_id   text,
  add column if not exists pp_capture_id text;

-- a PayPal row has no Razorpay order to name
alter table public.payments alter column rzp_order_id drop not null;

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('razorpay', 'paypal'));

-- exactly one provider reference per row, matching the provider column
alter table public.payments drop constraint if exists payments_provider_ref_check;
alter table public.payments add constraint payments_provider_ref_check check (
  (provider = 'razorpay' and rzp_order_id is not null and pp_order_id  is null) or
  (provider = 'paypal'   and pp_order_id  is not null and rzp_order_id is null)
);

-- same replay protection Razorpay gets: one ledger row per provider order.
-- Postgres allows repeated NULLs in a unique index, so Razorpay rows are
-- unaffected by this.
create unique index if not exists payments_pp_order_id_key
  on public.payments (pp_order_id);

-- ---------------------------------------------------------------------------
-- Nothing about money is answered to a signed-out visitor.
--
-- The UI shows a guest no price and no buy button, so the API must not hand
-- one over either — otherwise the listing endpoint is the hole the interface
-- just closed. Grants on this table are already column-level, so this removes
-- exactly one column from anon and leaves the rest of the listing (title,
-- preview, licence, delivery) public, which is what search engines index.
--
-- authenticated keeps it, and so does service_role — that is the role the
-- checkout backends read prices with when they build an order.
revoke select (price_cents) on public.marketplace_items from anon;

-- ---------------------------------------------------------------------------
-- Marketplace split, seller balances and payouts. Applied to the live project.
-- See the migration named marketplace_earnings_and_payouts for the full text:
-- marketplace_earnings (one row per sale, gross/fee/net + a hold window),
-- payout_methods (where a seller wants the money sent), payout_requests, and
-- dz_seller_balance() for the one honest answer about what may be withdrawn.
--
-- RLS on all three is select-own only. There are no insert or update policies
-- at all: every write goes through a Pages Function on the service role, so a
-- client cannot mint its own earnings or approve its own payout.
--
-- A payment can also come back now, so 'refunded' joined the status check on
-- payments — a row that lost its money must not keep reading as paid, since
-- dz_market_download and the subscription check both key off that word.

-- ---------------------------------------------------------------------------
-- Two live leaks found while auditing, both PRE-DATING the payments work.
--
-- 1. profiles.email was readable by anyone holding the publishable key, which
--    ships in config.js and is public by design. Six members' addresses were
--    one request away. The first attempt to fix it was a NO-OP and that is
--    worth remembering: profiles carries a TABLE-level SELECT grant, and
--    Postgres will not let a column-level REVOKE carve a hole in one. The
--    table grant has to be dropped and the surviving columns re-granted by
--    name, which also means a future column is unreadable until someone adds
--    it deliberately.
--
-- 2. Any signed-in member could set their own profiles.subscription_tier and
--    take the top plan for nothing. A row policy cannot see WHICH columns a
--    statement writes, so the fix is again column-level: UPDATE is granted
--    only on the fields a member genuinely edits. role, subscription_tier,
--    subscription_expires_at, merit, cred_received_count, email and
--    username_changed_at are now settable by service_role alone.
--
-- Both verified by attack, as the authenticated role with a forged jwt claim,
-- before and after.
revoke select on public.profiles from anon, authenticated;
grant select (
  id, role, created_at, subscription_tier, subscription_expires_at,
  username, bio, avatar_url, avatar_storage_path, avatar_updated_at,
  banner_url, banner_storage_path, banner_updated_at, social_links,
  display_name, username_changed_at, cred_received_count,
  merit, merit_updated_at, likes_public, bookmarks_public
) on public.profiles to anon, authenticated;

revoke update on public.profiles from anon, authenticated;
grant update (
  username, display_name, bio, social_links,
  avatar_url, avatar_storage_path, avatar_updated_at,
  banner_url, banner_storage_path, banner_updated_at,
  likes_public, bookmarks_public
) on public.profiles to authenticated;
