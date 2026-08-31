-- Round 4 — take away the privileges anon was never going to be able to use.
--
-- Every grant dropped here sits in front of a policy that compares a column to
-- auth.uid(). For a signed-out caller auth.uid() is NULL, so the comparison is
-- NULL, so the policy has always refused — which is exactly why this is worth
-- doing rather than not worth doing. Today RLS is the only thing standing
-- between anon and, say, every row of marketplace_earnings. A policy dropped
-- by accident, a table rebuilt without one, an `alter table ... disable row
-- level security` typed in the wrong window: any of those turns a live grant
-- into a live read. A grant that was never there cannot.
--
-- Nothing here changes a single answer the API gives today. The revokes are
-- deliberately partial where a table has a genuinely public face: anon keeps
-- SELECT on artworks, albums, album_items, comics, comments and notifications,
-- and loses only the write privileges it could never have exercised.
--
-- Left alone on purpose: the wholly public read tables (artwork_image,
-- blog_image, blog_posts, fx_rates, item_comments, jobs, marketplace_image,
-- profile_image, profile_banner_image, resources, resources_image, settings),
-- and public.communities, whose grant was rewritten column-wise in
-- 20260831_community_join_code_scope.sql.

-- own-content writes
revoke insert, delete            on public.album_items        from anon;
revoke insert, update, delete    on public.albums             from anon;
revoke update, delete            on public.artworks           from anon;
revoke insert, update, delete    on public.comics             from anon;
revoke delete                    on public.comments           from anon;
revoke insert                    on public.direct_messages    from anon;
revoke insert                    on public.notifications      from anon;

-- tables that are entirely own-row: no public face at all
revoke select, insert, delete          on public.cart_items      from anon;
revoke select, insert, update, delete  on public.friendships     from anon;
revoke select, insert, delete          on public.item_bookmarks  from anon;
revoke select, insert, delete          on public.item_likes      from anon;
revoke select, insert                  on public.notification_reads from anon;
revoke select, insert, update, delete  on public.scheduled_sections from anon;
revoke select, insert, delete          on public.user_tag_prefs  from anon;

-- money: seller-scoped, and never anything a signed-out caller asks for
revoke select on public.marketplace_earnings from anon;
revoke select on public.payout_requests      from anon;
