-- Production security audit, 2026-08-30, part two: grants.
--
-- Part one (20260830_audit_hardening.sql) worked on policies and functions.
-- This file works on the layer underneath them — Postgres GRANTs — which RLS
-- sits on top of and does not replace. A policy decides which ROWS a role may
-- touch. A grant decides whether the role may touch the table at all, and two
-- of the privileges here are not row-filtered by RLS in the first place.
--
-- Applied to the live project on 2026-08-30. Every revoke below was measured
-- before it was issued and re-measured after; see security/rls-regression.sql
-- for the assertions that keep it true.

-- 1 ------------------------------------------------------------------------
-- TRUNCATE, REFERENCES and TRIGGER on every table in public, held by BOTH anon
-- and authenticated. Supabase's default privileges grant ALL on new tables to
-- those roles, and ALL includes these three; 51 tables for anon, 54 for
-- authenticated.
--
-- TRUNCATE is the one that matters: **RLS does not filter TRUNCATE**. There is
-- no policy that can narrow it and no USING clause it consults — holding the
-- privilege is the whole check. It is not reachable through PostgREST, which
-- speaks SELECT/INSERT/UPDATE/DELETE and RPC and has no TRUNCATE verb, so this
-- was a latent privilege rather than an open door. But it is a
-- delete-every-row primitive sitting on the ANONYMOUS role, exempt from the one
-- control the rest of this schema relies on, and it should not exist.

do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
  loop
    execute format(
      'revoke truncate, references, trigger, maintain on public.%I from anon, authenticated',
      r.relname);
  end loop;
end $$;

-- and so that the next table created does not quietly get them back. SELECT,
-- INSERT, UPDATE and DELETE are deliberately left in the default: a new table
-- should still work behind its policies the way the developer expects.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- NOTE: there is a second default-privilege entry owned by supabase_admin that
-- still grants the full set. It could not be altered from the postgres role and
-- only applies to tables created BY supabase_admin, which migrations are not.
-- If a table ever appears with TRUNCATE granted again, that is where it came
-- from. security/rls-regression.sql asserts the count stays at zero.

-- 2 ------------------------------------------------------------------------
-- Every DML grant held where RLS has no matching policy. These are inert today
-- — the grant lets you reach the table, the missing policy refuses every row,
-- so the answer is already no. They are removed because "inert" is a property
-- of the current policy set, not of the grant: the day somebody adds a
-- convenience `FOR ALL` policy to one of these tables, the write privilege is
-- already sitting there waiting for it. Least privilege is what makes that
-- mistake survivable.
--
-- Generated from the live catalogue rather than typed out, so the set applied
-- is exactly the set measured.

do $$
declare r record;
begin
  for r in
    with tbl as (
      select c.oid, c.relname from pg_class c join pg_namespace nn on nn.oid = c.relnamespace
       where nn.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
    ),
    cmds(priv, code) as (values ('SELECT','r'),('INSERT','a'),('UPDATE','w'),('DELETE','d')),
    roles(rr)        as (values ('anon'),('authenticated')),
    grants as (
      select t.relname, t.oid, c.priv, c.code, ro.rr
        from tbl t cross join cmds c cross join roles ro
       where has_table_privilege(ro.rr, t.oid, c.priv)
    )
    select g.relname, g.rr, string_agg(g.priv, ', ') as privs
      from grants g
     where not exists (
       select 1 from pg_policy p
        where p.polrelid = g.oid
          and (p.polcmd = g.code or p.polcmd = '*')
          and (p.polroles = '{0}'::oid[]
               or (select oid from pg_roles where rolname = g.rr) = any(p.polroles))
     )
     group by g.relname, g.rr
  loop
    execute format('revoke %s on public.%I from %I', r.privs, r.relname, r.rr);
  end loop;
end $$;

-- The one deliberate exception. js/auth.js upserts notification_reads, and an
-- upsert is INSERT ... ON CONFLICT DO UPDATE, which Postgres requires the
-- UPDATE privilege to PLAN whether or not a row actually conflicts. Revoking it
-- broke marking notifications read — caught by the write-path regression, not
-- by reading. The missing UPDATE *policy* stays missing: an existing row is
-- still not rewritten.
--
-- js/auth.js now passes ignoreDuplicates, making it ON CONFLICT DO NOTHING,
-- which needs no UPDATE privilege at all. Once that is deployed this grant can
-- come off too — it is left in place so the order of deploy cannot break
-- production either way.
grant update on public.notification_reads to authenticated;

-- 3 ------------------------------------------------------------------------
-- EXECUTE on the 43 trigger functions, held by anon and authenticated, which
-- made every one of them an addressable /rest/v1/rpc endpoint name.
--
-- Both halves of this were tested before it was applied, not assumed:
--   * calling one directly is refused by Postgres itself —
--     `0A000 trigger functions can only be called as triggers` — so the grant
--     was never exploitable, only noisy;
--   * revoking EXECUTE does NOT stop a trigger firing, because the privilege is
--     checked at CREATE TRIGGER, not per row. An insert into artwork_likes was
--     accepted with the ban gate, the write limiter and the content guard all
--     revoked, and every one of them still ran.
-- The gain is the RPC surface being exactly what is meant to be callable, and
-- 30 fewer advisor findings to read past when a real one appears.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- 4 ------------------------------------------------------------------------
-- Storage: content types.
--
-- koe-media is PUBLIC and accepted any content type at all. An object stored as
-- text/html is a page the storage domain will render, on a hostname close
-- enough to ours to be worth a phishing attempt — three weeks after a phishing
-- incident. image/svg+xml is the same thing wearing an image's name: navigate
-- straight to it and its <script> runs. Neither can touch a digiartz.net
-- session (different origin, and the CSP names no supabase.co host in
-- script-src or frame-src), but neither has any business being served from us.
--
-- The list below is deliberately generous about download formats and closed
-- about renderable ones. It is not the reason a .svg or .pdf still uploads:
-- js/app-core.js now declares application/octet-stream for everything that is
-- not one of the five image types the pipeline actually stores, because every
-- asset is fetched back through /api/*-download, which sets its own
-- Content-Type and Content-Disposition from the database row. The type stored
-- beside the bytes is never read on the way out. This list is what holds when
-- somebody skips the client and PUTs to a signed URL by hand.
--
-- Ground truth at the time of writing: koe-media held 152 objects, every one of
-- them image/webp. Nothing in either bucket is orphaned by this.

update storage.buckets set allowed_mime_types = array[
  'image/png','image/jpeg','image/webp','image/gif','image/avif',
  'application/octet-stream',
  'image/tiff','image/bmp','image/vnd.adobe.photoshop',
  'application/zip','application/x-zip-compressed','application/x-rar-compressed',
  'application/vnd.rar','application/x-7z-compressed','application/x-tar',
  'application/gzip','application/x-gzip',
  'application/postscript',
  'font/ttf','font/otf','font/woff','font/woff2',
  'application/font-sfnt','application/vnd.ms-opentype','application/x-font-ttf',
  'video/mp4','video/webm','video/quicktime',
  'audio/mpeg','audio/wav',
  'model/gltf-binary','model/gltf+json','model/obj','model/stl'
]
where id in ('koe-media','koe-originals');

-- Not on that list, on purpose: text/html, application/xhtml+xml, every other
-- text/*, image/svg+xml, application/xml and application/pdf. Each of those
-- renders in a browser window rather than landing in a downloads folder.
