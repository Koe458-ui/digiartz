// ═══════════════════════════════════════════════════════════════
// DigiArtz — Supabase Edge Function: "s3-sign"
// Secure bridge between the static site and storage. The browser NEVER
// holds AWS credentials; it asks this function (with the user's
// Supabase JWT) for a signed upload target, or for a delete.
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
// v15 — per-user upload rate limit (AWS-bill abuse guard). A signed
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
// before doing so. The gate lives here, beside the credentials, which
// is the whole point: a signed GET cannot come into existence
// without a download having been spent, so calling this function
// directly buys nothing that the Download button does not. Unlike
// upload/delete it takes an artwork ID rather than a key, so no
// caller can aim it at an arbitrary object. FAIL-CLOSED, unlike the
// upload limiter: if the quota cannot be checked, nothing is signed.
//
// v17 — storage migration. Media moves to Supabase Storage, and this
// function keeps its job of being the only thing that authorises a
// write. Uploads now get SUPABASE signed upload URLs instead of an S3
// presigned PUT: the point is that every check below — mime allowlist,
// size ceilings, extension allowlist, per-user flood limit — stays on
// the server. Letting the browser talk to Supabase Storage directly
// would have thrown all of it away and left only what RLS can express.
//
// An image now yields FOUR signed targets, because sizes are generated
// once at upload rather than resized per request (Supabase image
// transformations are paid-plan only):
//   original -> koe-originals  (private)
//   t300 / v1000 / f1600 -> koe-media  (public derivatives)
// Non-images get a single public target, which is what they had before;
// changing that would silently alter the security model of a feature
// rather than migrating it.
//
// The signing client is the CALLER's, not the service role, so the
// storage RLS policies still apply on top of these checks.
//
// download and delete are dual-mode for the length of the migration:
// they handle objects that are already in Supabase and objects still in
// S3, so rows can be moved in batches without a cutover.
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
// ═══════════════════════════════════════════════════════════════
import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const AWS_KEY    = Deno.env.get("AWS_ACCESS_KEY_ID")!;
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;
const REGION     = Deno.env.get("AWS_REGION")!;
const BUCKET     = Deno.env.get("S3_BUCKET")!;
const CDN        = (Deno.env.get("CLOUDFRONT_URL") || "").replace(/\/$/, "");

const MAX_IMG_BYTES   = 25 * 1024 * 1024;    // unchanged
const MAX_ASSET_BYTES = 200 * 1024 * 1024;   // downloadable files
const IMG_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/;

// Upload-rate ceilings (per authenticated user). Generous enough that
// no human batch-upload session hits them; low enough to stop a script.
const RATE_10MIN = 40;
const RATE_24H   = 400;

// A signed GET only has to survive the hop to our own worker.
const DOWNLOAD_URL_TTL = 120;

// Supabase Storage buckets. koe-media keeps its eleven pre-existing
// policies; koe-originals is private and holds untouched originals.
const PUBLIC_BUCKET  = "koe-media";
const PRIVATE_BUCKET = "koe-originals";

// Derivative sizes, matching the imgResize() call sites in js/app-core.js.
// The size lives in the filename, never a path prefix: koe-media's policies
// test foldername(name)[2] = auth.uid(), and a prefix would shift the owner to
// position 3 and break every one of them.
const DERIVATIVES = [
  { role: "t300",  suffix: "__t300.webp" },
  { role: "v1000", suffix: "__v1000.webp" },
  { role: "f1600", suffix: "__f1600.webp" },
];

const stripExt   = (p: string) => p.replace(/\.[a-z0-9]+$/i, "");
const sbPublicUrl = (path: string) =>
  `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keys under these prefixes may carry non-image payloads.
const ASSET_PREFIX = /^koe-media\/(resources|market)\//;

// Extension allowlist for asset uploads. Archives, layered art,
// brush/preset packs, fonts, 3D and documents. No .exe/.js/.sh/.html
// — anything executable or script-like is absent on purpose.
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

const aws = new AwsClient({ accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, region: REGION, service: "s3" });
const s3Host = `${BUCKET}.s3.${REGION}.amazonaws.com`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

const extOf = (p: string) => (p.split(".").pop() || "").toLowerCase();

Deno.serve(async (req) => {
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

  // ── "download" is answered before the key rules below, because it is the one
  //    action that does not take a key. Everything it touches is derived from
  //    the artworks row, so a caller cannot aim it anywhere.
  if (body.action === "download") {
    const artwork = String(body.artwork || "");
    if (!UUID_RE.test(artwork)) return json({ error: "bad artwork id" }, 400);

    // Charge the daily quota and the burst limiter first. The RPC runs as this
    // user, so it counts against their own tier.
    const ip = typeof body.ip === "string" ? body.ip.slice(0, 64) : null;
    const { data: gate, error: gateErr } = await supa.rpc("dz_request_download", {
      p_artwork: artwork,
      p_ip: ip,
    });
    // fail closed: no quota answer, no signature
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

    // Paid tiers and owners take the untouched original. Free tiers are pointed
    // at the public resized derivative, which is already served for display, so
    // keeping originals private costs them nothing and exposes nothing new.
    let url: string | null = null;
    const migrated = /\.supabase\.co\//.test(row.image_url);

    if (gate.full) {
      if (migrated) {
        // Signed with the SERVICE ROLE on purpose: serving somebody else's
        // artwork has to bypass the owner-only select policy on koe-originals,
        // and it is only reached after the quota check above has passed.
        const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!svcKey) return json({ error: "storage signer not configured" }, 500);
        // storage_path is already stored without the bucket prefix
        const objPath = String(row.storage_path || "");
        if (!objPath || objPath.startsWith("/") || objPath.includes("..")) {
          return json({ error: "unsupported source" }, 502);
        }
        const svc = createClient(Deno.env.get("SUPABASE_URL")!, svcKey);
        const { data: sig, error: sigErr } =
          await svc.storage.from(PRIVATE_BUCKET).createSignedUrl(objPath, DOWNLOAD_URL_TTL);
        if (sigErr || !sig?.signedUrl) return json({ error: "could not sign the file" }, 502);
        url = sig.signedUrl.startsWith("http")
          ? sig.signedUrl
          : `${Deno.env.get("SUPABASE_URL")}${sig.signedUrl}`;
      } else {
        // legacy: still in S3 behind CloudFront
        let key = "";
        try { key = new URL(row.image_url).pathname.replace(/^\/+/, ""); } catch { key = ""; }
        if (!/^koe-media\//.test(key)) return json({ error: "unsupported source" }, 502);
        const u = new URL(`https://${s3Host}/${key}`);
        u.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_TTL));
        const signed = await aws.sign(new Request(u, { method: "GET" }), { aws: { signQuery: true } });
        url = signed.url;
      }
    }
    return json({ gate, name: row.name || "", imageUrl: row.image_url, url });
  }

  const path = String(body.path || "");

  if (!/^[a-zA-Z0-9_\-./]{3,300}$/.test(path) || path.includes("..") || path.startsWith("/"))
    return json({ error: "bad path" }, 400);
  if (!/^koe-media\//.test(path))
    return json({ error: "unknown prefix" }, 400);

  // The caller sends an S3 KEY, which carries the bucket name as its first
  // segment (koe-media/artworks/<uid>/file.png). In Supabase the bucket is
  // named separately, so the object path is that key minus the prefix. This is
  // not cosmetic: koe-media's policies test foldername(name)[2] = auth.uid(),
  // and leaving the prefix on would put 'artworks' in position 2 and make RLS
  // reject every upload. S3 keeps the prefixed form; Supabase uses objKey.
  const objKey = path.replace(/^koe-media\//, "");

  if (body.action === "upload") {
    const ct    = String(body.contentType || "");
    const size  = Number(body.size);
    const asset = ASSET_PREFIX.test(path);

    if (asset) {
      if (!ASSET_EXT.has(extOf(path)))
        return json({ error: "file type not allowed" }, 400);
      if (!(size > 0) || size > MAX_ASSET_BYTES)
        return json({ error: "file too large (max 200MB)" }, 400);
    } else {
      if (!IMG_TYPES.test(ct))
        return json({ error: "images only" }, 400);
      if (!(size > 0) || size > MAX_IMG_BYTES)
        return json({ error: "file too large" }, 400);
    }

    // ── Per-user rate limit (bill abuse guard). FAIL-OPEN: any
    //    error here lets the upload proceed, so a ledger hiccup never
    //    blocks a real artist. Only a genuine flood earns a 429.
    try {
      const now = Date.now();
      const since10m = new Date(now - 10 * 60 * 1000).toISOString();
      const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const [r10, r24] = await Promise.all([
        supa.from("upload_events").select("id", { count: "exact", head: true }).gte("created_at", since10m),
        supa.from("upload_events").select("id", { count: "exact", head: true }).gte("created_at", since24h),
      ]);
      if ((r10.count ?? 0) >= RATE_10MIN || (r24.count ?? 0) >= RATE_24H)
        return json({ error: "Upload limit reached — please try again in a little while." }, 429);
      await supa.from("upload_events").insert({ user_id: user.id });
    } catch (_e) {
      // fail-open: never block a real upload on a ledger error
    }

    // Every check above has passed, so hand out signed upload targets.
    // Signed with the CALLER's client, so storage RLS applies on top.
    const isImage = IMG_TYPES.test(ct);
    const targets: Array<Record<string, unknown>> = [];

    const sign = async (bucket: string, objPath: string, role: string) => {
      const { data, error } = await supa.storage.from(bucket).createSignedUploadUrl(objPath);
      if (error || !data) throw new Error(`could not sign ${role}: ${error?.message ?? "unknown"}`);
      targets.push({ role, bucket, path: objPath, signedUrl: data.signedUrl, token: data.token });
    };

    try {
      if (isImage) {
        // the untouched original goes somewhere the public cannot reach
        await sign(PRIVATE_BUCKET, objKey, "original");
        // display sizes, produced by the browser before it uploads
        const base = stripExt(objKey);
        for (const d of DERIVATIVES) await sign(PUBLIC_BUCKET, base + d.suffix, d.role);
      } else {
        // a downloadable asset, not an image: single public object, exactly
        // where it lived before. Gating these is separate work, not a silent
        // side effect of moving hosts.
        await sign(PUBLIC_BUCKET, objKey, "file");
      }
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }

    // Backward compatible on purpose. The service worker caches the site's JS,
    // so for a while after this deploys some browsers are still running the
    // client that expects an S3 presigned PUT. Both shapes are returned, and
    // each is internally consistent: an old client PUTs to uploadUrl and stores
    // publicUrl, both S3/CloudFront; a new client uses targets and stores
    // supabasePublicUrl. Neither can end up with a url that points at bytes
    // that were never written. The S3 pair goes away in phase 7.
    const legacy = new URL(`https://${s3Host}/${path}`);
    legacy.searchParams.set("X-Amz-Expires", "300");
    const legacySigned = await aws.sign(
      new Request(legacy, { method: "PUT", headers: { "content-type": ct } }),
      { aws: { signQuery: true } },
    );

    return json({
      storage: "supabase",
      key: path,
      // new client
      targets,
      // the f1600 derivative is the canonical stored url for an image: directly
      // usable for og:image, and the other sizes are a suffix swap away
      supabasePublicUrl: isImage ? sbPublicUrl(stripExt(objKey) + "__f1600.webp") : sbPublicUrl(objKey),
      // legacy client, still S3
      uploadUrl: legacySigned.url,
      publicUrl: `${CDN}/${path}`,
    });
  }

  if (body.action === "delete") {
    const like = "%" + path.split("/").slice(1).join("/") + "%";
    const owns = async (t: string, col: string, ownerCol = "user_id") => {
      const { data } = await supa.from(t).select("id").eq(ownerCol, user.id).ilike(col, like).limit(1);
      return !!(data && data.length);
    };
    const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).single();
    const isAdmin = !!prof && ["admin", "dev"].includes(prof.role ?? "");
    const allowed = isAdmin
      || await owns("artworks", "storage_path")
      || await owns("comics", "cover_storage_path")
      || await owns("profiles", "avatar_storage_path", "id")
      || await owns("profiles", "banner_storage_path", "id")
      || await owns("resources", "file_storage_path")
      || await owns("resources", "preview_storage_path")
      || await owns("marketplace_items", "file_storage_path")
      || await owns("marketplace_items", "preview_storage_path")
      || await owns("blog_posts", "cover_storage_path");
    if (!allowed) return json({ error: "not your object" }, 403);

    // The ownership test above is the gate: it checks the caller against every
    // column that can own an object. The removal itself runs with the SERVICE
    // ROLE, the same shape "download" already uses after its quota gate.
    //
    // It cannot run as the caller. koe-media has no delete policy that matches
    // artworks/* apart from one pinned to a single dev email, and every
    // koe-originals policy tests foldername(name)[2] = auth.uid(), which is
    // NULL for the twenty pre-convention artworks stored flat as
    // artworks/<file>. Worse, remove() on an object RLS will not surrender
    // returns an empty list and NO error, so the previous version reported
    // success while the bytes stayed put. That was survivable only because the
    // S3 leg did the real deleting; with the bucket gone it becomes silent
    // retention of art a user asked to have removed.
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!svcKey) return json({ error: "storage remover not configured" }, 500);
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, svcKey);

    // Dual-mode for the length of the migration. The caller only knows a path,
    // not which host holds it, so remove it from everywhere it could be:
    // Supabase (original plus the three derivatives) and S3. Every one of these
    // is idempotent, so hitting a home that never had the object is harmless.
    const base = stripExt(objKey);
    const results: Record<string, unknown> = {};
    try {
      // count what actually went, rather than trusting the absence of an error
      const { data: d1 } = await svc.storage.from(PRIVATE_BUCKET).remove([objKey]);
      results.original = (d1 ?? []).length;
      const { data: d2 } = await svc.storage.from(PUBLIC_BUCKET)
        .remove([objKey, ...DERIVATIVES.map((d) => base + d.suffix)]);
      results.derivatives = (d2 ?? []).length;
    } catch { /* fall through to S3 */ }

    let s3ok = false;
    try {
      const del = await aws.fetch(`https://${s3Host}/${path}`, { method: "DELETE" });
      s3ok = del.ok;
    } catch { /* the object may simply never have been in S3 */ }
    results.s3 = s3ok;

    // ok if it is gone from anywhere it plausibly lived
    const removed = Number(results.original ?? 0) + Number(results.derivatives ?? 0);
    return json({ ok: removed > 0 || s3ok, results });
  }

  return json({ error: "unknown action" }, 400);
});
