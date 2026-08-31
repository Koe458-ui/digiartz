-- Round 4 — the AI moderation check was skippable for everything except art.
--
-- The composer in js/sections.js does the right thing on its face: it posts the
-- preview to /api/moderate-upload, refuses to continue if Gemini says no, and
-- receives a signed ticket back. It then threw the ticket away and inserted the
-- row itself with status = 'approved'. Nothing on the database side ever asked
-- whether the check had happened.
--
-- So the check was a courtesy extended by the client to itself. The RLS policy
-- on resources / marketplace_items / blog_posts is `auth.uid() = user_id AND
-- current_merit() >= 80` and says nothing about status, and the publishable key
-- is public by design, so:
--
--   POST /rest/v1/resources
--   { "user_id": "<me>", "title": "...", "status": "approved",
--     "visibility": "published", ... }
--
-- published straight to the front page, past Gemini, from curl. Given what the
-- 2026-08-20 incident was — a two-minute-old account putting a phishing link in
-- front of readers — this is the same door with a different handle.
--
-- artworks has been gated since Round 3 by dz_artwork_mod_gate(): an HMAC over
-- uid.exp.jti, checked against a secret only the database and the Worker hold,
-- burnt on first use so a ticket cannot be replayed. This migration
-- generalises that function and hangs it on the three tables that were missing
-- it. The scheme, the secret and the used-ticket table are shared, because one
-- moderation pass should buy one publish, whatever section it lands in.
--
-- It fails the way the artwork gate fails: safe and quiet. A missing, malformed,
-- expired or already-spent ticket does not raise — it rewrites status to
-- 'pending' and lets the insert through, so a bad deploy sends work to review
-- rather than breaking the composer.
--
-- ORDERING. The gate starts INERT and must stay inert until the browser is
-- actually sending tickets. private.mod_config.sections_enforced defaults to
-- false for exactly that reason; the artwork secret is already live, so reusing
-- it without this flag would send every new listing to 'pending' the moment the
-- migration ran, before the deploy that fixes it.
--
--   1. apply this migration            (gate installed, inert)
--   2. deploy the branch               (browser starts sending mod_token)
--   3. publish one resource, one listing and one blog post — confirm each one
--      still goes live
--   4. then, and only then:
--        update private.mod_config set sections_enforced = true where id;
--   5. re-test: a normal publish still works; a direct PostgREST insert with
--      status='approved' and no token now lands in 'pending'
--
-- Roll back at any time without dropping anything:
--        update private.mod_config set sections_enforced = false where id;

alter table private.mod_config
  add column if not exists sections_enforced boolean not null default false;

alter table public.resources          add column if not exists mod_token text;
alter table public.blog_posts         add column if not exists mod_token text;
alter table public.marketplace_items  add column if not exists mod_token text;

-- Write-only, and only on the way in. The gate nulls the column before the row
-- lands, so there is nothing to read back and no reason to grant SELECT; and
-- the gate is BEFORE INSERT, so an UPDATE grant would buy a caller nothing but
-- a place to store junk.
grant insert (mod_token) on public.resources         to authenticated;
grant insert (mod_token) on public.blog_posts        to authenticated;
grant insert (mod_token) on public.marketplace_items to authenticated;

create or replace function public.dz_section_mod_gate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_secret text;
  v_on     boolean;
  v_uid    uuid := auth.uid();
  v_imgcol text;
  v_img    text;
  parts    text[];
  v_exp    bigint;
  v_jti    text;
  v_sig    text;
  v_calc   text;
begin
  -- only a row asking to be public is gated; a draft needs no ticket
  if NEW.status is distinct from 'approved' then return NEW; end if;

  -- no jwt means a service-role or trigger context (the scheduled publisher
  -- runs here), which is already trusted
  if v_uid is null then return NEW; end if;

  -- Optional trigger argument: the column carrying the image a ticket would
  -- have covered. A blog cover is optional (FORMS.blog in js/sections.js marks
  -- it so) and /api/moderate-upload cannot mint a ticket for an image nobody
  -- uploaded, so demanding one unconditionally would send every cover-less post
  -- to a review queue nobody staffs. That is not moderation, it is breakage.
  -- resources and marketplace_items pass NO argument on purpose: their preview
  -- is required, and an insert must not be able to buy itself an exemption by
  -- leaving the column out. A cover-less post is still not unguarded --
  -- dz_content_guard runs on blog_posts.body, which is the control the 2026-08
  -- phishing incident actually called for.
  if TG_NARGS >= 1 then
    v_imgcol := TG_ARGV[0];
    execute format('select ($1).%I::text', v_imgcol) into v_img using NEW;
    if v_img is null or v_img = '' then NEW.mod_token := null; return NEW; end if;
  end if;

  select secret, sections_enforced into v_secret, v_on
    from private.mod_config where id = true;

  if coalesce(v_on, false) is not true then NEW.mod_token := null; return NEW; end if;
  if v_secret is null or v_secret = ''  then NEW.mod_token := null; return NEW; end if;

  if public.is_dev() then NEW.mod_token := null; return NEW; end if;

  -- ticket shape: exp.jti.hexsig, signed over uid.exp.jti
  parts := string_to_array(coalesce(NEW.mod_token, ''), '.');
  if array_length(parts, 1) is distinct from 3 then
    NEW.status := 'pending'; NEW.mod_token := null; return NEW;
  end if;

  begin
    v_exp := (parts[1])::bigint;
  exception when others then
    NEW.status := 'pending'; NEW.mod_token := null; return NEW;
  end;

  v_jti  := parts[2];
  v_sig  := parts[3];
  v_calc := encode(
    extensions.hmac(v_uid::text || '.' || parts[1] || '.' || v_jti, v_secret, 'sha256'),
    'hex');

  if v_sig = v_calc and v_exp > extract(epoch from now())::bigint then
    begin
      insert into private.used_mod_tokens (jti, user_id) values (v_jti, v_uid);
      NEW.mod_token := null;
      return NEW;                                    -- valid, stays approved
    exception when unique_violation then
      NEW.status := 'pending'; NEW.mod_token := null; return NEW;   -- replay
    end;
  end if;

  NEW.status := 'pending'; NEW.mod_token := null; return NEW;       -- bad/expired
end;
$function$;

revoke all on function public.dz_section_mod_gate() from public, anon, authenticated;

drop trigger if exists trg_resources_mod_gate   on public.resources;
drop trigger if exists trg_blog_mod_gate        on public.blog_posts;
drop trigger if exists trg_marketplace_mod_gate on public.marketplace_items;

create trigger trg_resources_mod_gate
  before insert on public.resources
  for each row execute function public.dz_section_mod_gate();

create trigger trg_blog_mod_gate
  before insert on public.blog_posts
  for each row execute function public.dz_section_mod_gate('cover_url');

create trigger trg_marketplace_mod_gate
  before insert on public.marketplace_items
  for each row execute function public.dz_section_mod_gate();
