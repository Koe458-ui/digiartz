#!/usr/bin/env node
// Does the service worker precache what the page actually loads?
//
// index.html and sw.js each carry their own copy of every versioned asset url,
// and nothing has ever forced them to agree. They drifted twice: once before
// sw.js v69, and again by v129, when eight assets were loaded at one version
// and precached at the version before it.
//
// That is not a cosmetic mismatch. It costs twice on the same file. The
// install warms a url nobody ever requests, and the url that IS requested was
// never precached — so it is a network round trip on every cold start and
// missing outright offline. A third of the shell cache was in that state.
//
// index.html is the authority. It is the only place these assets are
// referenced, so what it asks for is by definition what the browser fetches;
// sw.js has to follow it, never the other way round.
//
// Run: node scripts/check-precache.mjs
// Exits 0 when they agree, 1 when they do not, and says exactly what to change.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Assets index.html loads that are deliberately NOT precached. Empty, and it
// should stay that way unless there is a real reason — add the url with the
// reason beside it, so the next person reads why rather than guessing.
const ALLOW_UNCACHED = new Set([
  // '/js/example.js?v=1',  // why it is not in the shell
]);

const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

// The precache list, read out of its literal. Bounded by name rather than by
// line number so it survives the file moving around underneath it.
const open = sw.indexOf('const SHELL_URLS');
if (open === -1) fail('could not find `const SHELL_URLS` in sw.js');
const close = sw.indexOf('];', open);
if (close === -1) fail('could not find the end of SHELL_URLS in sw.js');
const shellRaw = [...sw.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);

// Every css/js asset is governed, not only the ?v= ones. The vendored
// Supabase build carries its version in the filename instead of a query
// string, and an upgrade that lands in index.html and not here is the same
// drift wearing a different hat. The rest of the list — '/', '/index.html',
// the icons, config.js — is left alone: nothing there is versioned at all.
const GOVERNED = /^\/(?:js|css)\//;

// Paired on the path, so a ?v= bump reads as one drift rather than as an
// unrelated add and remove. A vendored file whose VERSION is in its name
// changes path, so it reports as both — which is right, it is a different
// file, and both edits are needed.
const split = (u) => {
  const i = u.indexOf('?v=');
  return i === -1 ? [u, null] : [u.slice(0, i), u.slice(i + 3)];
};
const show = (v) => (v === null ? 'no ?v=' : `?v=${v}`);
const withVersion = (p, v) => (v === null ? p : `${p}?v=${v}`);

const shell = new Map();
const dupes = [];
for (const url of shellRaw) {
  if (!GOVERNED.test(url)) continue;
  const [path, version] = split(url);
  if (shell.has(path)) dupes.push(path);
  shell.set(path, version);
}

const loaded = new Map();
for (const [, url] of html.matchAll(/(?:src|href)="(\/(?:js|css)\/[^"]+)"/g)) {
  if (!GOVERNED.test(url)) continue;
  if (ALLOW_UNCACHED.has(url)) continue;
  const [path, version] = split(url);
  loaded.set(path, version);
}

const problems = [];
for (const [path, want] of loaded) {
  const got = shell.get(path);
  if (!shell.has(path)) {
    problems.push({
      kind: 'not precached',
      path,
      detail: `index.html loads ${show(want)}, sw.js has no entry`,
      fix: `add '${withVersion(path, want)}' to SHELL_URLS`,
    });
  } else if (got !== want) {
    problems.push({
      kind: 'version drift',
      path,
      detail: `index.html loads ${show(want)}, sw.js precaches ${show(got)}`,
      fix: `change SHELL_URLS to '${withVersion(path, want)}'`,
    });
  }
}
for (const [path, version] of shell) {
  if (loaded.has(path)) continue;
  problems.push({
    kind: 'precached but unused',
    path,
    detail: `sw.js precaches ${show(version)}, index.html does not load it`,
    fix: `drop '${withVersion(path, version)}' from SHELL_URLS, or load it in index.html`,
  });
}
for (const path of dupes) {
  problems.push({
    kind: 'duplicate',
    path,
    detail: 'listed more than once in SHELL_URLS',
    fix: `remove the extra '${path}' entry`,
  });
}

if (problems.length === 0) {
  console.log(`precache ok — ${loaded.size} versioned assets, index.html and sw.js agree`);
  process.exit(0);
}

console.error(`\nprecache check FAILED — ${problems.length} problem(s)\n`);
for (const p of problems) {
  console.error(`  ${p.kind}: ${p.path}`);
  console.error(`    ${p.detail}`);
  console.error(`    fix: ${p.fix}\n`);
}
console.error('index.html is the authority: it is the only place these assets are');
console.error('referenced, so sw.js follows it. Bump CACHE_VERSION with the fix so');
console.error('installed clients refill against the corrected list.\n');
process.exit(1);

function fail(msg) {
  console.error(`precache check could not run: ${msg}`);
  process.exit(1);
}
