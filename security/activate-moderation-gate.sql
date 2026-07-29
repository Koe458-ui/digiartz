-- ============================================================
-- DigiArtz — Moderation Gate ACTIVATION  (run this to switch it ON)
-- ============================================================
-- WHAT THIS DOES
--   Closes the "moderation bypass": today the browser sets
--   status='approved' after calling the AI check, so a technical user
--   can skip the check and post straight to the gallery. After this is
--   active, an insert can only be trusted as 'approved' if it carries a
--   valid, unexpired, single-use approval ticket that ONLY the server
--   moderation function can mint. Anything else is quietly downgraded to
--   status='pending' (manual review) — never an error, so a
--   misconfiguration can never break uploads.
--
-- RUN THIS ONLY AFTER BOTH:
--   1. The security branch is deployed to production (the updated
--      functions/api/moderate-upload.js and js/upqueue.js are live), AND
--   2. You have added an environment variable in Cloudflare Pages:
--        Settings -> Environment variables -> Production
--        Name:  MOD_SIGNING_SECRET
--        Value: <the secret Claude gave you in chat>
--      ...and redeployed so it takes effect.
--
--   Then paste that SAME secret into the INSERT below and run this file
--   in the Supabase SQL editor.
--
-- TO ROLL BACK (instantly, no data loss):
--   drop trigger if exists trg_artwork_mod_gate on public.artworks;
--   -- or wipe the secret to make the gate inert:
--   update private.mod_config set secret = '' where id = true;
-- ============================================================

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

-- Singleton secret row (must match Cloudflare's MOD_SIGNING_SECRET).
create table if not exists private.mod_config (
  id     boolean primary key default true,
  secret text not null,
  constraint mod_config_singleton check (id)
);

-- >>> PASTE THE SAME SECRET YOU SET IN CLOUDFLARE HERE <<<
insert into private.mod_config (id, secret)
values (true, '__PASTE_YOUR_SECRET_HERE__')
on conflict (id) do update set secret = excluded.secret;

-- Consumed tickets — enforces one moderation pass = one approved insert.
create table if not exists private.used_mod_tokens (
  jti     text primary key,
  user_id uuid,
  used_at timestamptz not null default now()
);

-- The gate. SECURITY DEFINER so it can read the secret + consume tickets.
create or replace function public.dz_artwork_mod_gate()
returns trigger
language plpgsql
security definer
set search_path = 'extensions, public'
as $$
declare
  v_secret text;
  v_uid    uuid := auth.uid();
  parts    text[];
  v_exp    bigint;
  v_jti    text;
  v_sig    text;
  v_calc   text;
begin
  -- Only gate client attempts to publish as approved.
  if NEW.status is distinct from 'approved' then return NEW; end if;

  -- Server/cron/service context (no JWT) is already trusted.
  if v_uid is null then return NEW; end if;

  -- Inert until a secret is configured — keeps the flow unchanged
  -- before you activate.
  select secret into v_secret from private.mod_config where id = true;
  if v_secret is null or v_secret = '' then return NEW; end if;

  -- Admins / devs are trusted.
  if public.is_dev() then NEW.mod_token := null; return NEW; end if;

  -- Ticket format: "<exp>.<jti>.<hexsig>",
  --   sig = HMAC_SHA256(secret, "<uid>.<exp>.<jti>")
  parts := string_to_array(coalesce(NEW.mod_token, ''), '.');
  if array_length(parts, 1) is distinct from 3 then
    NEW.status := 'pending'; NEW.mod_token := null; return NEW;
  end if;

  v_exp  := (parts[1])::bigint;
  v_jti  := parts[2];
  v_sig  := parts[3];
  v_calc := encode(hmac(v_uid::text || '.' || parts[1] || '.' || v_jti, v_secret, 'sha256'), 'hex');

  if v_sig = v_calc and v_exp > extract(epoch from now())::bigint then
    begin
      -- First use wins; a replay hits the primary-key and is rejected.
      insert into private.used_mod_tokens (jti, user_id) values (v_jti, v_uid);
      NEW.mod_token := null;
      return NEW;                              -- valid + fresh -> allow approved
    exception when unique_violation then
      NEW.status := 'pending'; NEW.mod_token := null; return NEW;
    end;
  end if;

  -- Invalid / expired -> review queue, never an error.
  NEW.status := 'pending'; NEW.mod_token := null; return NEW;
end;
$$;

drop trigger if exists trg_artwork_mod_gate on public.artworks;
create trigger trg_artwork_mod_gate
  before insert on public.artworks
  for each row execute function public.dz_artwork_mod_gate();

-- Sanity check after running:
--   select tgname from pg_trigger where tgrelid = 'public.artworks'::regclass;
--   -- expect trg_artwork_mod_gate in the list
