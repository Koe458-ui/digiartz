#!/usr/bin/env node
// Storage migration, phase 2: copy S3/CloudFront objects into Supabase Storage.
//
// Run this from your own machine, NOT from CI: it needs the service-role key,
// and it reads from the CloudFront URLs, so it has to run BEFORE you lock the
// bucket or disable either distribution.
//
//   node scripts/migrate-storage.mjs                 # plan only, writes nothing
//   node scripts/migrate-storage.mjs --copy          # upload objects, leave the DB alone
//   node scripts/migrate-storage.mjs --copy --commit # also rewrite the URL columns
//
// env:
//   SB_URL                    https://<ref>.supabase.co
//   SB_SERVICE_ROLE_KEY       service_role key (Supabase → Project Settings → API)
//
// Zero dependencies: Node 18+ has fetch built in.
//
// WHY NO IMAGE LIBRARY: the resizer distribution already produces every
// derivative the site serves, at the exact quality settings the app asks for.
// So each size is one GET away and the sizes come out byte-identical to what
// users see today. Nothing is re-encoded locally.
//
// Layout it produces:
//   koe-originals  artworks/<uid>/<base>.<ext>            the untouched original
//   koe-media      artworks/<uid>/<base>__t300.webp       grid thumbnail
//   koe-media      artworks/<uid>/<base>__v1000.webp      lightbox / detail
//   koe-media      artworks/<uid>/<base>__f1600.webp      free-tier download, og:image
//
// The size lives in the FILENAME, not a path prefix, on purpose: koe-media's
// pre-existing policies check foldername(name)[2] = auth.uid(), so a size prefix
// like t300/artworks/<uid>/… would break them. Keeping <prefix>/<uid>/<file>
// means every existing policy keeps working untouched.

const ORIGIN_CDN  = 'https://dn8x0csx6ii8w.cloudfront.net';
const RESIZER_CDN = 'https://d1l8dn7jegdgem.cloudfront.net';

// must match imgResize() call sites in js/app-core.js so output is identical
const SIZES = [
  { suffix: '__t300.webp',  width: 300,  quality: 55 },
  { suffix: '__v1000.webp', width: 1000, quality: 68 },
  { suffix: '__f1600.webp', width: 1600, quality: 82 },
];

const PUBLIC_BUCKET  = 'koe-media';
const PRIVATE_BUCKET = 'koe-originals';

const SB_URL = (process.env.SB_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SB_SERVICE_ROLE_KEY || '';

const COPY   = process.argv.includes('--copy');
const COMMIT = process.argv.includes('--commit');

if (!SB_URL || !SB_KEY) {
  console.error('Set SB_URL and SB_SERVICE_ROLE_KEY first.');
  process.exit(1);
}
if (COMMIT && !COPY) {
  console.error('--commit requires --copy: do not rewrite URLs before the objects exist.');
  process.exit(1);
}

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
};

// ---------------------------------------------------------------- helpers

async function rest(path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`rest ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

// the S3 key is the pathname of the stored CloudFront url. keys are written as
// koe-media/<prefix>/<uid>/<file>, and the bucket segment is dropped because in
// Supabase the bucket is named separately from the object path.
function keyOf(url) {
  try {
    const p = new URL(url).pathname.replace(/^\/+/, '');
    return p.startsWith('koe-media/') ? p.slice('koe-media/'.length) : p;
  } catch { return null; }
}

const isCloudFront = (u) => typeof u === 'string' && /\.cloudfront\.net\//.test(u);
const stripExt     = (p) => p.replace(/\.[a-z0-9]+$/i, '');
const resizerUrl   = (key, w, q) =>
  `${RESIZER_CDN}/fit-in/${w}x0/filters:format(webp):quality(${q})/koe-media/${key}`;

const publicUrl = (bucket, path) =>
  `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${res.status} ${url.slice(0, 120)}`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    type: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function putObject(bucket, path, bytes, contentType) {
  // x-upsert makes the whole script idempotent: re-running overwrites rather
  // than erroring, so a partial run can simply be repeated.
  const res = await fetch(`${SB_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`PUT ${res.status} ${bucket}/${path}: ${(await res.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------- the work

const report = { planned: 0, copied: 0, skipped: 0, failed: 0, bytes: 0, items: [] };

async function migrateImage(label, storedUrl) {
  if (!isCloudFront(storedUrl)) { report.skipped++; return null; }
  const key = keyOf(storedUrl);
  if (!key) { report.skipped++; return null; }

  const base = stripExt(key);
  const entry = { label, key, original: null, derivatives: [], error: null };
  report.planned++;

  if (!COPY) {
    entry.original = `${PRIVATE_BUCKET}/${key}`;
    entry.derivatives = SIZES.map((s) => `${PUBLIC_BUCKET}/${base}${s.suffix}`);
    report.items.push(entry);
    return { key, base };
  }

  try {
    // 1. the original, straight from the origin distribution, byte for byte
    const orig = await fetchBytes(`${ORIGIN_CDN}/koe-media/${key}`);
    await putObject(PRIVATE_BUCKET, key, orig.body, orig.type);
    entry.original = `${PRIVATE_BUCKET}/${key}`;
    report.bytes += orig.body.length;

    // 2. each display size, produced by the resizer we are retiring
    for (const s of SIZES) {
      const d = await fetchBytes(resizerUrl(key, s.width, s.quality));
      const path = `${base}${s.suffix}`;
      await putObject(PUBLIC_BUCKET, path, d.body, d.type || 'image/webp');
      entry.derivatives.push(`${PUBLIC_BUCKET}/${path}`);
      report.bytes += d.body.length;
    }

    report.copied++;
    console.log(`  ok   ${label}  ${key}`);
  } catch (e) {
    entry.error = String(e.message || e);
    report.failed++;
    console.error(`  FAIL ${label}  ${key}\n       ${entry.error}`);
  }

  report.items.push(entry);
  return entry.error ? null : { key, base };
}

async function main() {
  console.log(`${COPY ? (COMMIT ? 'COPY + COMMIT' : 'COPY') : 'PLAN (no writes)'} — ${SB_URL}\n`);

  // ---- artworks: cover, extra pages, and the storage_path used for deletes
  const artworks = await rest('artworks?select=id,image_url,pages,storage_path&limit=5000');
  console.log(`artworks: ${artworks.length}`);
  for (const a of artworks) {
    const cover = await migrateImage(`artwork ${a.id}`, a.image_url);

    let pages = a.pages;
    if (typeof pages === 'string') { try { pages = JSON.parse(pages); } catch { pages = null; } }
    const newPages = [];
    if (Array.isArray(pages)) {
      for (const p of pages) {
        const r = await migrateImage(`artwork ${a.id} page`, p);
        newPages.push(r ? publicUrl(PUBLIC_BUCKET, `${r.base}__f1600.webp`) : p);
      }
    }

    if (COMMIT && cover) {
      const patch = {
        // f1600 is the canonical stored url: directly usable for og:image, and
        // the other sizes are a suffix swap away
        image_url: publicUrl(PUBLIC_BUCKET, `${cover.base}__f1600.webp`),
        // storage_path points at the ORIGINAL in the private bucket, which is
        // what the download gate signs and what deletes remove
        storage_path: cover.key,
      };
      if (Array.isArray(pages) && newPages.length) patch.pages = newPages;
      await rest(`artworks?id=eq.${a.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
      });
    }
  }

  // ---- avatars and banners: display only, no private original needed, but
  //      copying the original too keeps re-crops possible later
  const profiles = await rest(
    'profiles?select=id,avatar_url,avatar_storage_path,banner_url,banner_storage_path&limit=5000');
  const withMedia = profiles.filter((p) => isCloudFront(p.avatar_url) || isCloudFront(p.banner_url));
  console.log(`profiles with media: ${withMedia.length}`);
  for (const p of withMedia) {
    const av = await migrateImage(`avatar ${p.id}`, p.avatar_url);
    const bn = await migrateImage(`banner ${p.id}`, p.banner_url);
    if (COMMIT) {
      const patch = {};
      if (av) { patch.avatar_url = publicUrl(PUBLIC_BUCKET, `${av.base}__f1600.webp`); patch.avatar_storage_path = av.key; }
      if (bn) { patch.banner_url = publicUrl(PUBLIC_BUCKET, `${bn.base}__f1600.webp`); patch.banner_storage_path = bn.key; }
      if (Object.keys(patch).length) {
        await rest(`profiles?id=eq.${p.id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
        });
      }
    }
  }

  // ---- resources / marketplace / blog / comics. Empty today, handled so a
  //      later run picks them up without a code change. Preview images become
  //      derivatives; the downloadable FILE is copied verbatim, private only.
  for (const [table, cols] of [
    ['resources',         { preview: 'preview_url', file: 'file_url', filePath: 'file_storage_path', prevPath: 'preview_storage_path' }],
    ['marketplace_items', { preview: 'preview_url', file: 'file_url', filePath: 'file_storage_path', prevPath: 'preview_storage_path' }],
    ['blog_posts',        { preview: 'cover_url',                     prevPath: 'cover_storage_path' }],
    ['comics',            { preview: 'cover_url',                     prevPath: 'cover_storage_path' }],
  ]) {
    const sel = Object.values(cols).filter(Boolean).join(',');
    let rows = [];
    try { rows = await rest(`${table}?select=id,${sel}&limit=5000`); } catch { continue; }
    const todo = rows.filter((r) => Object.values(cols).some((c) => isCloudFront(r[c])));
    if (!todo.length) { console.log(`${table}: nothing to move`); continue; }
    console.log(`${table}: ${todo.length}`);
    for (const r of todo) {
      const prev = cols.preview ? await migrateImage(`${table} ${r.id} preview`, r[cols.preview]) : null;
      let filePath = null;
      if (cols.file && isCloudFront(r[cols.file])) {
        const key = keyOf(r[cols.file]);
        report.planned++;
        if (COPY) {
          try {
            const f = await fetchBytes(`${ORIGIN_CDN}/koe-media/${key}`);
            await putObject(PRIVATE_BUCKET, key, f.body, f.type);
            report.copied++; report.bytes += f.body.length; filePath = key;
            console.log(`  ok   ${table} ${r.id} file  ${key}`);
          } catch (e) { report.failed++; console.error(`  FAIL ${table} ${r.id} file: ${e.message}`); }
        } else { filePath = key; }
      }
      if (COMMIT) {
        const patch = {};
        if (prev) { patch[cols.preview] = publicUrl(PUBLIC_BUCKET, `${prev.base}__f1600.webp`); if (cols.prevPath) patch[cols.prevPath] = prev.key; }
        // the file url is intentionally NOT made public: it stays private and is
        // reached through a signed url, so only the path is recorded
        if (filePath && cols.filePath) patch[cols.filePath] = filePath;
        if (Object.keys(patch).length) {
          await rest(`${table}?id=eq.${r.id}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
          });
        }
      }
    }
  }

  const mb = (report.bytes / 1048576).toFixed(1);
  console.log(`\nplanned ${report.planned}  copied ${report.copied}  skipped ${report.skipped}  failed ${report.failed}  ${mb} MB`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync('migration-report.json', JSON.stringify(report, null, 2));
  console.log('wrote migration-report.json');
  if (report.failed) { console.error('\nSome objects failed. Fix, then re-run — uploads upsert, so repeats are safe.'); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
