// ═══════════════════════════════════════════════════════════════
// DigiArtz — TEMPORARY Edge Function: "backfill-t600"
//
// Creates the __t600.webp derivative for images uploaded before that size
// existed. DELETE THIS once the backfill has run — maintenance
// scaffolding, not part of the product.
//
// WHY IT EXISTS HERE RATHER THAN AS A SCRIPT
// security/backfill-t600.mjs does the same job from a laptop, but needs
// Node, a network route to Storage and the service role key. This is the
// only place that already has all three.
//
// WHAT IT WILL AND WILL NOT DO
//   • only ever CREATES <base>__t600.webp in koe-media
//   • upsert:false, so an existing object is never rewritten
//   • never opens koe-originals at all, never deletes anything
//   • idempotent: re-running skips whatever is already there
//
// SOURCE IS f1600, NOT THE ORIGINAL — deliberate.
// Decoding a full-size original is tens of MB of raw ImageData and the
// worker is killed with WORKER_RESOURCE_LIMIT. The existing 1600px
// derivative decodes in about a quarter of that and is already a faithful
// downscale, so 1600 -> 600 costs one extra generation of lossy encoding
// at a size where it does not show. It also means only the WebP codec has
// to be resident instead of PNG and JPEG as well, which is most of the
// memory saving. The laptop script has no such limit and still works from
// the originals; expect a few percent size difference between the two.
//
// ENCODER CHOICE — this was not free.
// ImageMagick does not work here: imagemagick_deno dies with "require is
// not defined" (the edge runtime exposes a `process` global, so emscripten
// takes the Node/CommonJS branch), and both the upstream npm build and a
// newer imagemagick_deno take the whole worker down with a 503. jSquash
// works, but ONLY via root imports — "npm:@jsquash/webp/encode" fails to
// resolve in this bundler while "npm:@jsquash/webp" is fine. Keep these
// imports exactly as they are.
// ═══════════════════════════════════════════════════════════════
import { createClient } from "npm:@supabase/supabase-js@2";
import * as webp from "npm:@jsquash/webp@1.4.0";
import * as resizeMod from "npm:@jsquash/resize@2.1.0";

const resize: any = (resizeMod as any).default ?? resizeMod;

const SECRET = "b6aa13661e183d9c0964e796460dce0217956b254c30e163";

// must match DERIVE_SPEC.t600 in js/app-core.js
const WIDTH = 600;
const QUALITY = 52;

const BUCKET = "koe-media";
const SRC_SUFFIX = "__f1600.webp";
const OUT_SUFFIX = "__t600.webp";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

// length-independent comparison, so a wrong secret leaks nothing by timing
function secretOk(given: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(SECRET);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// storage list() is per-prefix and caps at 100, so walk the tree
async function walk(sb: any, bucket: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || !data.length) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // a row with no id is a folder, not an object
      if (entry.id === null) out.push(...(await walk(sb, bucket, full)));
      else out.push(full);
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!secretOk(req.headers.get("x-backfill-secret") ?? "")) {
    return json({ error: "forbidden" }, 403);
  }

  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return json({ error: "service role key not available" }, 500);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* defaults are fine */ }
  // small batches on purpose: the worker is killed outright, not gracefully,
  // if a decode runs it out of memory
  const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(10, body.limit)) : 2;
  const dryRun = body.dryRun === true;

  let all: string[];
  try {
    all = await walk(sb, BUCKET);
  } catch (e) {
    return json({ stage: "walk", error: String((e as Error).message || e) }, 502);
  }

  const have = new Set(all);
  const sources = all.filter((p) => p.endsWith(SRC_SUFFIX));
  const missing = sources.filter((p) => !have.has(p.slice(0, -SRC_SUFFIX.length) + OUT_SUFFIX));
  const todo = missing.slice(0, limit);

  if (dryRun) {
    return json({
      dryRun: true, mediaObjects: all.length, sources: sources.length,
      missing: missing.length,
      wouldCreate: todo.map((p) => p.slice(0, -SRC_SUFFIX.length) + OUT_SUFFIX),
    });
  }

  const results: Array<Record<string, unknown>> = [];
  let done = 0, failed = 0;

  for (const src of todo) {
    const target = src.slice(0, -SRC_SUFFIX.length) + OUT_SUFFIX;
    try {
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(src);
      if (dlErr) throw new Error(`download: ${dlErr.message}`);
      const input = new Uint8Array(await blob.arrayBuffer());

      const decoded = await webp.decode(input);

      // mirrors imgDerive's Math.min(1, maxWidth/sw): never upscale, so a
      // source narrower than 600px is re-encoded at its own width
      const sw = decoded.width, sh = decoded.height;
      const scale = Math.min(1, WIDTH / sw);
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const sized = scale < 1 ? await resize(decoded, { width: w, height: h }) : decoded;

      const out = new Uint8Array(await webp.encode(sized, { quality: QUALITY }));
      if (!out.length) throw new Error("encode produced nothing");

      const { error: upErr } = await sb.storage.from(BUCKET).upload(target, out, {
        contentType: "image/webp",
        upsert: false,          // never clobber an object already there
      });
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      done++;
      results.push({ target, kb: Math.round(out.length / 1024), dims: `${sw}x${sh} -> ${w}x${h}` });
    } catch (e) {
      failed++;
      results.push({ target, error: String((e as Error)?.message || e).slice(0, 300) });
    }
  }

  return json({
    sources: sources.length,
    missingBefore: missing.length,
    processed: done,
    failed,
    remaining: missing.length - done,
    results,
  });
});
