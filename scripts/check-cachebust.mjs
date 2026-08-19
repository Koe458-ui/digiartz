#!/usr/bin/env node
// Did a changed stylesheet or script get a new ?v=?
//
// _headers pins /css/* and /js/* with `immutable, max-age=31536000`, and the
// service worker answers them cache-first out of the static cache. Both are
// correct ONLY while the URL changes whenever the bytes do: a browser that has
// already fetched /css/overrides.css?v=16 is told, by us, that it need not ask
// again for a year — so shipping different bytes at that same URL is shipping
// them to nobody. The deploy succeeds, the file on the edge is right, and the
// returning visitor keeps the old copy until their cache is cleared by hand.
//
// That is what "the update did not apply" looks like. It is invisible in
// review, because the diff of the stylesheet is correct; the fault is in the
// line that was NOT changed. It has happened repeatedly — a walk of the history
// finds it in dozens of commits, and it was live in three assets when this
// check was written, one of them a real fix to js/dm.js that no returning
// visitor ever received.
//
// scripts/check-precache.mjs holds the neighbouring invariant: index.html and
// sw.js must name the same versions. This one holds the other half: the version
// must move when the file does.
//
// Run: node scripts/check-cachebust.mjs [baseRef] [--each]
//
// baseRef defaults to origin/main. Without --each the whole range is read as
// one diff — what production serves now against what this branch would deploy —
// and that is the mode CI runs, because main is the branch Pages builds
// production from. A version that only ever existed part-way through a branch
// was never served to anybody, so it is not a stale url; the merge takes the
// file from the number production has to the number it will have, in one step.
//
// --each checks every commit in the range on its own instead. That is the
// stricter reading, and the one to use when auditing history or when a branch
// is being deployed directly: it catches a commit that changed an asset without
// touching its number even though a later commit in the same branch bumped it.
// An asset index.html did not reference at the start of a commit is exempt for
// that commit — nothing was published under a url that did not exist yet.
//
// Exits 0 when every changed asset carries a new version, 1 when one does not,
// and says exactly which number to raise.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const each = args.includes('--each');
const base = args.filter((a) => a !== '--each')[0] || 'origin/main';

function git(args, allowFail = false) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

function fail(msg) {
  console.error('check-cachebust: ' + msg);
  process.exit(1);
}

// The base has to exist. A shallow checkout without it is a check that would
// silently pass everything, which is worse than not running.
if (git(['rev-parse', '--verify', '--quiet', base + '^{commit}'], true) === null) {
  fail(`cannot resolve base ref "${base}".\n` +
       '  In CI, check out with fetch-depth: 0 so the base commit is present.');
}

// Every /css/ and /js/ url index.html asks for, with the version it asks for.
// index.html is the authority here for the same reason it is in
// check-precache.mjs: it is the only document that references these files, so
// what it names is what a browser fetches.
const REF_RE = /\/((?:css|js)\/[A-Za-z0-9._/-]+?)\?v=(\d+)/g;

function versionsIn(html) {
  const out = new Map();
  for (const m of html.matchAll(REF_RE)) {
    // A file referenced twice at two versions is its own fault and
    // check-precache.mjs already refuses it; keep the first and move on.
    if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/* One step: the html and the tree as they were at `from`, against the html and
   the tree at `to`. `to` is null for the working tree, so an uncommitted change
   is checked the same way a pushed one is. */
function step(from, to) {
  const headHtml = to === null
    ? readFileSync(join(root, 'index.html'), 'utf8')
    : git(['show', `${to}:index.html`], true);
  const baseHtml = git(['show', `${from}:index.html`], true);
  if (headHtml === null || baseHtml === null) return [];

  const now = versionsIn(headHtml);
  const was = versionsIn(baseHtml);

  const stale = [];
  for (const [path, version] of now) {
    const before = was.get(path);
    // Not referenced at `from`: no url of ours was published for it to be
    // stale against, whatever number it carries now.
    if (before === undefined) continue;
    // The bytes are what decides. `git diff --quiet` exits 1 when they differ.
    let changed = false;
    const range = to === null ? [from, '--', path] : [from, to, '--', path];
    try {
      execFileSync('git', ['diff', '--quiet', ...range], { cwd: root });
    } catch {
      changed = true;
    }
    if (changed && before === version) stale.push({ path, version, at: to });
  }
  return stale;
}

let stale = [];
if (each) {
  // Oldest first, and the working tree last so a change that is staged but not
  // committed is caught before it is pushed rather than after.
  const commits = (git(['rev-list', '--reverse', `${base}..HEAD`], true) || '')
                    .split('\n').filter(Boolean);
  let prev = base;
  for (const c of commits) {
    stale = stale.concat(step(prev, c));
    prev = c;
  }
  stale = stale.concat(step(prev, null));
} else {
  stale = step(base, null);
}

if (stale.length) {
  console.error(
    'check-cachebust: these files changed but kept the version they already shipped under.\n' +
    '\n' +
    '  /css/* and /js/* are served `immutable, max-age=31536000` (_headers) and\n' +
    '  answered cache-first by the service worker. A visitor who already has one\n' +
    '  of these urls will not fetch it again — the change below reaches new\n' +
    '  visitors only.\n');
  for (const { path, version, at } of stale) {
    const where = at ? `  [${git(['log', '-1', '--format=%h %s', at], true).trim().slice(0, 60)}]` : '';
    console.error(`  /${path}?v=${version}  ->  ?v=${Number(version) + 1}` +
                  '   (in index.html AND in sw.js SHELL_URLS)' + where);
  }
  console.error(
    '\n  Bump both copies, then run scripts/check-precache.mjs to confirm they agree.\n' +
    '  CACHE_VERSION does not need bumping: sw.js prunes the orphaned entry itself\n' +
    '  (see pruneStatic), and renaming the caches would re-download every image.\n' +
    '\n  If a change really is byte-for-byte invisible to a browser — a comment, or\n' +
    '  a rule that was already dead — bump it anyway. A wasted refetch costs one\n' +
    '  request; a pinned stale file costs a year.');
  process.exit(1);
}

console.log('check-cachebust ok — no /css/ or /js/ asset changed without a new ' +
            `version since ${base}${each ? ', commit by commit' : ''}`);
