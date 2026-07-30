// ═══════════════════════════════════════════════════════════════
// DigiArtz — Supabase Edge Function: "s3-sign"
// Secure bridge between the static site and S3. The browser NEVER
// holds AWS credentials; it asks this function (with the user's
// Supabase JWT) for a presigned PUT URL, or for a delete.
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
// PUT URL is cheap to mint but each one can push bytes into S3, so a
// scripted account could otherwise inflate storage/egress cost. The
// limit is FAIL-OPEN: any error in the ledger lets the upload through
// (a real artist is never blocked by a hiccup); the only new hard
// outcome is a 429 when one account mints far more upload URLs than
// any human workflow needs. Counts live in public.upload_events.
//
// v16 — "download" action, so the S3 bucket can stop being public.
// It mints a short-lived presigned GET for an artwork's ORIGINAL, and
// it charges the caller's daily quota through dz_request_download
// before doing so. The gate lives here, beside the credentials, which
// is the whole point: a presigned GET cannot come into existence
// without a download having been spent, so calling this function
// directly buys nothing that the Download button does not. Unlike
// upload/delete it takes an artwork ID rather than a key, so no
// caller can aim it at an arbitrary object. FAIL-CLOSED, unlike the
// upload limiter: if the quota cannot be checked, nothing is signed.
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

// A presigned GET only has to survive the hop to our own worker.
const DOWNLOAD_URL_TTL = 120;

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
      .from("artworks").select("name,image_url").eq("id", artwork).maybeSingle();
    if (!row || !row.image_url) return json({ reason: "not_found", error: "artwork not found" }, 404);

    // the key is whatever we wrote at upload time, read back off the row
    let key = "";
    try { key = new URL(row.image_url).pathname.replace(/^\/+/, ""); } catch { key = ""; }
    if (!/^koe-media\//.test(key)) return json({ error: "unsupported source" }, 502);

    // Paid tiers take the original straight out of the bucket. Free tiers are
    // pointed at the public resized derivative instead, which the image CDN
    // already serves for display — so locking the bucket costs them nothing
    // and exposes nothing new.
    let url: string | null = null;
    if (gate.full) {
      const u = new URL(`https://${s3Host}/${key}`);
      u.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_TTL));
      const signed = await aws.sign(new Request(u, { method: "GET" }), { aws: { signQuery: true } });
      url = signed.url;
    }
    return json({ gate, name: row.name || "", imageUrl: row.image_url, url });
  }

  const path = String(body.path || "");

  if (!/^[a-zA-Z0-9_\-./]{3,300}$/.test(path) || path.includes("..") || path.startsWith("/"))
    return json({ error: "bad path" }, 400);
  if (!/^koe-media\//.test(path))
    return json({ error: "unknown prefix" }, 400);

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

    // ── Per-user rate limit (AWS-bill abuse guard). FAIL-OPEN: any
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

    const url = new URL(`https://${s3Host}/${path}`);
    url.searchParams.set("X-Amz-Expires", "300");
    const signed = await aws.sign(new Request(url, { method: "PUT", headers: { "content-type": ct } }),
                                 { aws: { signQuery: true } });
    return json({ uploadUrl: signed.url, key: path, publicUrl: `${CDN}/${path}` });
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
    const del = await aws.fetch(`https://${s3Host}/${path}`, { method: "DELETE" });
    return json({ ok: del.ok }, del.ok ? 200 : 500);
  }

  return json({ error: "unknown action" }, 400);
});
