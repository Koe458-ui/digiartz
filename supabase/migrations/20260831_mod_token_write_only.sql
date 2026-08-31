-- Round 4 follow-up — mod_token inherited grants it was never meant to have.
--
-- 20260831_section_mod_gate.sql issued `grant insert (mod_token)` and expected
-- that to be the whole of it. It was not: resources, blog_posts and artworks
-- already carry table-wide SELECT and UPDATE grants for `authenticated`, and a
-- table-level grant covers columns added afterwards. So the new column arrived
-- readable and writable — the same shape of surprise as the join_code revoke
-- earlier in this round, from the opposite direction.
--
-- Two things follow from that, and the second is the one that matters:
--
--   * Readable is harmless in practice. Both gates null the column before the
--     row lands, so a SELECT has only ever returned NULL.
--
--   * Writable is not. The gates are BEFORE INSERT, so an UPDATE never reaches
--     them — which left mod_token as a free-text column any member could write
--     after the fact and, on the three tables with a public read policy, anyone
--     could then read. dz_content_guard does not run on it. That is a small
--     unmoderated publishing channel bolted to the side of the moderation
--     system, which is a poor joke to leave in the schema.
--
-- Fixing it by grant would mean dropping each table's SELECT/UPDATE grant and
-- re-issuing it column by column across every column — a lot of moving parts
-- around the reads the whole site depends on, to protect a column that is
-- always NULL. Closing it at the data level instead: a BEFORE UPDATE trigger
-- that puts the column back to NULL for anon and authenticated. The column can
-- then never hold a value, which makes the inherited SELECT grant moot and the
-- inherited UPDATE grant inert.
--
-- artworks is included. Its gate has been live since Round 3 and has the same
-- inherited grants, so it has the same latent column.

create or replace function public.dz_mod_token_clear()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- A service-role or trigger context (the scheduled publisher) is trusted;
  -- a browser is not.
  if current_user in ('authenticated', 'anon') then
    NEW.mod_token := null;
  end if;
  return NEW;
end $function$;

drop trigger if exists zz_mod_token_clear on public.artworks;
drop trigger if exists zz_mod_token_clear on public.resources;
drop trigger if exists zz_mod_token_clear on public.blog_posts;
drop trigger if exists zz_mod_token_clear on public.marketplace_items;

create trigger zz_mod_token_clear before update on public.artworks
  for each row execute function public.dz_mod_token_clear();
create trigger zz_mod_token_clear before update on public.resources
  for each row execute function public.dz_mod_token_clear();
create trigger zz_mod_token_clear before update on public.blog_posts
  for each row execute function public.dz_mod_token_clear();
create trigger zz_mod_token_clear before update on public.marketplace_items
  for each row execute function public.dz_mod_token_clear();
