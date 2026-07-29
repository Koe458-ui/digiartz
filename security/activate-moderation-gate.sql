-- moderation gate activation
-- approved insert needs a server-minted ticket, else pending
--
-- run only after both:
--   1. moderate-upload.js and upqueue.js are live in production
--   2. MOD_SIGNING_SECRET is set in cloudflare pages and redeployed
--   then paste the same secret below and run in the supabase sql editor
--
-- roll back:
--   drop trigger if exists trg_artwork_mod_gate on public.artworks;
--   update private.mod_config set secret = '' where id = true;

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

-- secret row, matches MOD_SIGNING_SECRET
create table if not exists private.mod_config (
  id     boolean primary key default true,
  secret text not null,
  constraint mod_config_singleton check (id)
);

-- paste the cloudflare secret here
insert into private.mod_config (id, secret)
values (true, '__PASTE_YOUR_SECRET_HERE__')
on conflict (id) do update set secret = excluded.secret;

-- consumed tickets, one pass one insert
create table if not exists private.used_mod_tokens (
  jti     text primary key,
  user_id uuid,
  used_at timestamptz not null default now()
);

-- the gate
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
  -- only gate approved inserts
  if NEW.status is distinct from 'approved' then return NEW; end if;

  -- no jwt means server context, trusted
  if v_uid is null then return NEW; end if;

  -- inert until a secret is set
  select secret into v_secret from private.mod_config where id = true;
  if v_secret is null or v_secret = '' then return NEW; end if;

  -- devs are trusted
  if public.is_dev() then NEW.mod_token := null; return NEW; end if;

  -- ticket format: exp.jti.hexsig
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
      -- first use wins, replay hits the key
      insert into private.used_mod_tokens (jti, user_id) values (v_jti, v_uid);
      NEW.mod_token := null;
      return NEW;                              -- valid, allow approved
    exception when unique_violation then
      NEW.status := 'pending'; NEW.mod_token := null; return NEW;
    end;
  end if;

  -- invalid or expired, send to review
  NEW.status := 'pending'; NEW.mod_token := null; return NEW;
end;
$$;

drop trigger if exists trg_artwork_mod_gate on public.artworks;
create trigger trg_artwork_mod_gate
  before insert on public.artworks
  for each row execute function public.dz_artwork_mod_gate();

-- check: select tgname from pg_trigger where tgrelid = 'public.artworks'::regclass;
