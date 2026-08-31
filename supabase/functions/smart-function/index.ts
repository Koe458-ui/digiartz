// ═══════════════════════════════════════════════════════════════
// DigiArtz — Supabase Edge Function: "s3-sign"
// Secure bridge between the static site and storage. The browser
// never gets to write anywhere on its own; it asks this function
// (with the user's Supabase JWT) for a signed upload target, a
// signed download, or a delete.
//
// The name is historical. Nothing here talks to S3 any more.
//
// v13 — asset uploads. Images keep the original rules unchanged
// (25MB, strict image/* allowlist). Two new key prefixes carry the
// downloadable files behind Resources and Marketplace, where the
// gate is the file EXTENSION rather than the content type: browsers
// report .abr / .procreate / .blend / .clip as octet-stream, so a
// content-type allowlist would reject exactly the files these
// sections exist to host. Executables are excluded by omission.
//
// v14 — hero banner slides removed from the product, so the
// hero-slides/ prefix and its admin gate are gone with them. Only
// koe-media/ keys are signable now.
//
// v15 — per-user upload rate limit (bill abuse guard). A signed
// PUT URL is cheap to mint but each one can push bytes into storage, so
// a scripted account could otherwise inflate storage/egress cost. The
// limit is FAIL-OPEN: any error in the ledger lets the upload through
// (a real artist is never blocked by a hiccup); the only new hard
// outcome is a 429 when one account mints far more upload URLs than
// any human workflow needs. Counts live in public.upload_events.
//
// v16 — "download" action, so the bucket can stop being public.
// It mints a short-lived signed GET for an artwork's ORIGINAL, and
// it charges the caller's daily quota through dz_request_download
// before doing so. The gate lives here, which is the whole point: a
// signed GET cannot come into existence without a download having
// been spent, so calling this function directly buys nothing that the
// Download button does not. Unlike upload/delete it takes an artwork
// ID rather than a key, so no caller can aim it at an arbitrary
// object. FAIL-CLOSED, unlike the upload limiter: if the quota cannot
// be checked, nothing is signed.
//
// v17 — storage migration. Media moved to Supabase Storage, and this
// function kept its job of being the only thing that authorises a
// write. Uploads get SUPABASE signed upload URLs: the point is that
// every check below — mime allowlist, size ceilings, extension
// allowlist, per-user flood limit — stays on the server. Letting the
// browser talk to Supabase Storage directly would have thrown all of
// it away and left only what RLS can express.
//
// An image yields FOUR signed targets, because sizes are generated
// once at upload rather than resized per request (Supabase image
// transformations are paid-plan only):
//   original -> koe-originals  (private)
//   t300 / v1000 / f1600 -> koe-media  (public derivatives)
// Non-images get a single public target, which is what they had before;
// changing that would silently alter the security model of a feature
// rather than migrating it.
//
// The upload signing client is the CALLER's, not the service role, so
// the storage RLS policies still apply on top of these checks.
//
// v18 — delete removes with the service role instead of the caller's
// client. The ownership test above it was always the real gate; RLS
// underneath was not a second line of defence but a broken one. No
// koe-media policy matches artworks/* except one pinned to a single dev
// email, and koe-originals tests foldername(name)[2] = auth.uid(), which
// is NULL for the twenty pre-convention artworks stored flat as
// artworks/<file>. Since remove() on a blocked object returns an empty
// list and no error, deletes reported success while the bytes stayed —
// hidden only by the S3 leg doing the real work. The response now counts
// what actually went rather than trusting a missing error.
//
// v18 also completes the migration: aws4fetch, the five AWS secrets and
// every dual-mode S3 branch are gone. They were reachable only for a row
// whose url still pointed at CloudFront, and there are none left. Note
// that upload no longer returns the legacy uploadUrl/publicUrl pair, so a
// browser running pre-migration JS out of its service worker cache will
// fail its next upload until the worker updates. That path was going to
// break regardless, because it uploaded to a bucket that is being deleted.
//
// v19 — a fourth derivative, t600. t300 was the only grid size and the
// grid is not 300px wide on a desktop, so cards were being served an
// upscaled thumbnail. The new size is negotiated rather than assumed:
// the caller sends the roles it can encode and gets signed targets for
// those only.
//
// That negotiation is the whole point of the version. The client derives
// the bytes for each target, and sbUploadTargets falls through to
// `body = file` for a role it does not recognise — so handing a t600
// target to a build that predates t600 would upload the untouched
// original, up to 25MB, under a thumbnail's name, with nothing
// downstream to catch it. A caller that says nothing gets exactly the
// three sizes v17 gave it, which makes this function safe to deploy
// before, after, or independently of the site, and safe against clients
// still running old JS out of a service worker cache.
//
// v20 — a non-image upload can ask to land in the private bucket, for
// the one kind of file where a public url is the whole problem: a
// marketplace product file is the thing being sold, so anyone holding
// its url holds the goods. Passing visibility:"private" signs the
// object into koe-originals and returns supabasePublicUrl:null, because
// there is no url to return — the bytes come back only through
// /api/market-download, which asks the database whether this caller has
// paid before it signs anything.
//
// It is a flag, not a change of default: a caller that does not send it
// gets the public object it got before, so this deploys independently of
// the site and an older cached bundle keeps working. delete already
// sweeps both buckets for the same key, so removing one of these needs
// nothing new.
//
// v21 — delete authorises on the object KEY rather than on a row that
// claims it. The old test asked whether the caller owned a row whose
// storage_path matched, across nine columns; every one of those columns
// is written by the browser, so inserting a row naming somebody else's
// key was enough to have it removed on the service role. Ownership now
// comes from the second path segment, which is where every upload here
// puts the uploader and where koe-media's own policies already look for
// it. Two consequences worth knowing before deploying: the twenty
// pre-convention artworks stored flat as artworks/<file> are staff-only
// to delete, and a failed upload can now clean up its own objects before
// a row exists — which the row check had been silently refusing.
//
// v22 (Round 4 security review) — the CORS wildcard is gone, and the
// signing error no longer comes back as text. See the notes at each.
// ═══════════════════════════════════════════════════════════════
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_IMG_BYTES   = 25 * 1024 * 1024;
const MAX_ASSET_BYTES     = 200 * 1024 * 1024;
const MAX_ASSET_BYTES_MAX = 400 * 1024 * 1024;
const IMG_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/;

const RATE_10MIN = 40;
const RATE_24H   = 400;

const DOWNLOAD_URL_TTL = 120;

const PUBLIC_BUCKET  = "koe-media";
const PRIVATE_BUCKET = "koe-originals";

const DERIVATIVES = [
  { role: "t300",  suffix: "__t300.webp" },
  { role: "t600",  suffix: "__t600.webp" },
  { role: "v1000", suffix: "__v1000.webp" },
  { role: "f1600", suffix: "__f1600.webp" },
];

const LEGACY_ROLES = ["t300", "v1000", "f1600"];

const stripExt   = (p: string) => p.replace(/\.[a-z0-9]+$/i, "");
const sbPublicUrl = (path: string) =>
  `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ASSET_PREFIX = /^koe-media\/(resources|market)\//;

const ASSET_EXT = new Set([
  "zip","rar","7z","tar","gz","tgz",
  "psd","psb","ai","eps","pdf","svg",
  "abr","atn","tpl","asl","grd","shx","pat","aco","ase",
  "brushset","brush","procreate","swatches",
  "clip","csp","sut","cmc",
  "ttf","otf","woff","woff2",
  "obj","fbx","blend","glb","gltf","stl","mtl","dae","c4d","ztl",
  "png","jpg","jpeg","webp","gif","avif","tif","tiff",
  "mp4","webm","mov",
]);

// The wildcard this used to carry was flagged as "not exploitable but wider
// than it needs to be" in Round 3, and that reading was right: the function
// authenticates by Authorization header, which a cross-origin page cannot make
// the browser attach on its behalf. Wide is still wide, though — with `*` any
// page on the internet could put this endpoint's signed-upload machinery behind
// its own UI, and the reply told them how it went. The allowlist costs nothing.
//
// ALLOWED_ORIGINS is a comma-separated list (preview deployments go here). An
// unknown or absent Origin gets no ACAO header at all, so a browser refuses to
// hand the response over while a server-to-server caller — which never sends
// Origin and is not bound by CORS — is unaffected.
const DEFAULT_ORIGINS = ["https://digiartz.net", "https://www.digiartz.net"];

function allowedOrigins(): string[] {
  const extra = String(Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

function corsFor(req: Request): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const origin = req.headers.get("Origin") ?? "";
  if (origin && allowedOrigins().includes(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

// Built per request inside the handler rather than held in a module-level
// binding: Deno.serve runs requests concurrently on one isolate, and a shared
// mutable would let a second request's Origin decide a first request's reply.
const replier = (cors: Record<string, string>) =>
  (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...cors, "content-type": "application/json" },
    });

const extOf = (p: string) => (p.split(".").pop() || "").toLowerCase();

function serviceClient() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return null;
  return createClient(Deno.env.get("SUPABASE_URL")!, key);
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = replier(cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return json({ error: "auth required" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  if (body.action === "download") {
    const artwork = String(body.artwork || "");
    if (!UUID_RE.test(artwork)) return json({ error: "bad artwork id" }, 400);

    const ip = typeof body.ip === "string" ? body.ip.slice(0, 64) : null;
    const { data: gate, error: gateErr } = await supa.rpc("dz_request_download", {
      p_artwork: artwork,
      p_ip: ip,
    });
    if (gateErr) return json({ error: "could not check your download quota" }, 502);

    if (!gate || !gate.allowed) {
      const reason = (gate && gate.reason) || "denied";
      if (reason === "rate")
        return json({ reason, retry_after: gate.retry_after ?? 60, error: "too many download requests" }, 429);
      if (reason === "limit")
        return json({ ...gate, reason, error: "daily download quota reached" }, 429);
      if (reason === "auth")      return json({ reason, error: "auth required" }, 401);
      if (reason === "not_found") return json({ reason, error: "artwork not found" }, 404);
      return json({ reason, error: "download not allowed" }, 403);
    }

    const { data: row } = await supa
      .from("artworks").select("name,image_url,storage_path").eq("id", artwork).maybeSingle();
    if (!row || !row.image_url) return json({ reason: "not_found", error: "artwork not found" }, 404);

    let url: string | null = null;

    if (gate.full) {
      const svc = serviceClient();
      if (!svc) return json({ error: "storage signer not configured" }, 500);
      const objPath = String(row.storage_path || "");
      if (!objPath || objPath.startsWith("/") || objPath.includes("..")) {
        return json({ error: "unsupported source" }, 502);
      }
      const { data: sig, error: sigErr } =
        await svc.storage.from(PRIVATE_BUCKET).createSignedUrl(objPath, DOWNLOAD_URL_TTL);
      if (sigErr || !sig?.signedUrl) return json({ error: "could not sign the file" }, 502);
      url = sig.signedUrl.startsWith("http")
        ? sig.signedUrl
        : `${Deno.env.get("SUPABASE_URL")}${sig.signedUrl}`;
    }
    return json({ gate, name: row.name || "", imageUrl: row.image_url, url });
  }

  const path = String(body.path || "");

  if (!/^[a-zA-Z0-9_\-./]{3,300}$/.test(path) || path.includes("..") || path.startsWith("/"))
    return json({ error: "bad path" }, 400);
  if (!/^koe-media\//.test(path))
    return json({ error: "unknown prefix" }, 400);

  const objKey = path.replace(/^koe-media\//, "");

  if (body.action === "upload") {
    const ct    = String(body.contentType || "");
    const size  = Number(body.size);
    const asset = ASSET_PREFIX.test(path);

    if (asset) {
      if (!ASSET_EXT.has(extOf(path)))
        return json({ error: "file type not allowed" }, 400);
      let assetCap = MAX_ASSET_BYTES;
      try {
        const tierSvc = serviceClient();
        if (tierSvc) {
          const { data: tier } = await tierSvc.rpc("dz_effective_tier", { p_user: user.id });
          if (tier === "max") assetCap = MAX_ASSET_BYTES_MAX;
        }
      } catch {   }
      if (!(size > 0) || size > assetCap)
        return json({ error: `file too large (max ${Math.round(assetCap / 1048576)}MB)` }, 400);
    } else {
      if (!IMG_TYPES.test(ct))
        return json({ error: "images only" }, 400);
      if (!(size > 0) || size > MAX_IMG_BYTES)
        return json({ error: "file too large" }, 400);
    }

    try {
      const now = Date.now();
      const since10m = new Date(now - 10 * 60 * 1000).toISOString();
      const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const [r10, r24] = await Promise.all([
        supa.from("upload_events").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).gte("created_at", since10m),
        supa.from("upload_events").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).gte("created_at", since24h),
      ]);
      if ((r10.count ?? 0) >= RATE_10MIN || (r24.count ?? 0) >= RATE_24H)
        return json({ error: "Upload limit reached — please try again in a little while." }, 429);
      await supa.from("upload_events").insert({ user_id: user.id });
    } catch (_e) {
    }

    const isImage = IMG_TYPES.test(ct);
    const isPrivate = body.visibility === "private" && !isImage;
    const targets: Array<Record<string, unknown>> = [];

    const sign = async (bucket: string, objPath: string, role: string) => {
      const { data, error } = await supa.storage.from(bucket).createSignedUploadUrl(objPath);
      if (error || !data) throw new Error(`could not sign ${role}: ${error?.message ?? "unknown"}`);
      targets.push({ role, bucket, path: objPath, signedUrl: data.signedUrl, token: data.token });
    };

    try {
      if (isImage) {
        await sign(PRIVATE_BUCKET, objKey, "original");
        const asked = Array.isArray(body.derivatives)
          ? body.derivatives.filter((r: unknown) => typeof r === "string")
          : LEGACY_ROLES;
        const wanted = DERIVATIVES.filter((d) => asked.includes(d.role));
        if (!wanted.some((d) => d.role === "f1600"))
          return json({ error: "f1600 is required" }, 400);
        const base = stripExt(objKey);
        for (const d of wanted) await sign(PUBLIC_BUCKET, base + d.suffix, d.role);
      } else if (isPrivate) {
        await sign(PRIVATE_BUCKET, objKey, "file");
      } else {
        await sign(PUBLIC_BUCKET, objKey, "file");
      }
    } catch (_e) {
      // createSignedUploadUrl()'s error text names buckets, object keys and the
      // policy that refused. The caller is a browser: it gets the fact.
      return json({ error: "Could not prepare the upload — try again." }, 500);
    }

    return json({
      storage: "supabase",
      key: path,
      targets,
      supabasePublicUrl: isPrivate ? null
        : isImage ? sbPublicUrl(stripExt(objKey) + "__f1600.webp")
        : sbPublicUrl(objKey),
      bucket: isPrivate ? PRIVATE_BUCKET : PUBLIC_BUCKET,
      private: isPrivate,
    });
  }

  if (body.action === "delete") {
    const seg = objKey.split("/");
    const pathOwner = seg.length >= 3 ? seg[1] : null;

    const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).single();
    const isAdmin = !!prof && ["admin", "dev"].includes(prof.role ?? "");
    const allowed = isAdmin || (!!pathOwner && pathOwner === user.id);
    if (!allowed) return json({ error: "not your object" }, 403);

    const svc = serviceClient();
    if (!svc) return json({ error: "storage remover not configured" }, 500);

    const base = stripExt(objKey);
    const results: Record<string, unknown> = {};
    const { data: d1 } = await svc.storage.from(PRIVATE_BUCKET).remove([objKey]);
    results.original = (d1 ?? []).length;
    const { data: d2 } = await svc.storage.from(PUBLIC_BUCKET)
      .remove([objKey, ...DERIVATIVES.map((d) => base + d.suffix)]);
    results.derivatives = (d2 ?? []).length;

    const removed = Number(results.original) + Number(results.derivatives);
    return json({ ok: removed > 0, results });
  }

  return json({ error: "unknown action" }, 400);
});
