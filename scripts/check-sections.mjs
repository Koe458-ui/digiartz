#!/usr/bin/env node
// Does the section layer still hold together?
//
// A "section" here is any panel that slides in over the page — the gallery,
// community, the upload page, a profile, the artwork viewer, Settings and
// every page Settings opens. Between them they had four separate answers to
// "which panels are there", and each of those answers was a hand-written list
// somebody had to remember to add to. Three bugs came straight out of that:
//
//   - tapping Home left the ranking board, the theme page, the artwork viewer
//     and half a dozen others standing over the home page, because the bottom
//     nav's sweep predated all of them;
//   - closing a panel stepped history BACK, which is a navigation, which the
//     popstate handlers in three other files then answered — so tapping
//     Upload could land you on a profile;
//   - and the address bar was left naming a section that had been closed, so
//     the next reload opened it again.
//
// The lists are one table now (DZ_PANELS in js/app-core.js) and the address
// bar has one writer (js/routes.js). This check is what keeps it that way: it
// fails when a panel exists that the table does not know about, when the
// table names a close function that does not exist, and when a step back
// creeps into the panel layer again.
//
// No dependencies and no browser, in keeping with the other checks here.
//
// Run: node scripts/check-sections.mjs

import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const jsFiles = readdirSync('js')
  .filter((f) => f.endsWith('.js'))
  .map((f) => ['js/' + f, readFileSync('js/' + f, 'utf8')]);
const js = jsFiles.map(([, s]) => s).join('\n');
const core = readFileSync('js/app-core.js', 'utf8');
const routes = readFileSync('js/routes.js', 'utf8');

const problems = [];
const fail = (msg) => problems.push(msg);

// ---- the table ------------------------------------------------------------
//
// Read out of the source rather than imported: js/app-core.js is a classic
// script that reaches for window and for config.js on the first line, and
// none of that exists here.
const tableSrc = core.match(/var DZ_PANELS = \[([\s\S]*?)\n  \];/);
if (!tableSrc) fail('js/app-core.js: DZ_PANELS is gone, or its shape changed — nothing else here can run');

const panels = [...(tableSrc ? tableSrc[1] : '').matchAll(
  /\{\s*id:\s*'([^']+)'\s*(?:,\s*close:\s*\[\s*'([^']+)'([^\]]*)\])?([^}]*)\}/g
)].map((m) => ({ id: m[1], close: m[2] || null }));

if (panels.length < 20) fail(`js/app-core.js: only ${panels.length} panels parsed out of DZ_PANELS — the table or this parser is wrong`);

// ---- every panel in the table is real --------------------------------------
//
// dzPanelHost is built at runtime by the signed-in module (functions/api/ops.js
// serves it) and is absent from the document on purpose.
const BUILT_AT_RUNTIME = new Set(['dzPanelHost']);

// A closer is real if it is declared at the top level of a classic script —
// which puts it on window — or assigned to window outright. Depth is counted
// in braces, skipping comments and strings, because every one of these files
// is a mix of top-level declarations and IIFEs.
function topLevelNames(file, src) {
  const names = new Set();
  const depth = new Array(src.length).fill(0);
  let d = 0, i = 0;
  // The last thing that was not whitespace or a comment. It is what tells a
  // regex literal from a division, and getting that wrong is not academic:
  // /filename="([^"]+)"/ in js/gallery.js reads as a quoted string to a
  // scanner without this, and every brace after it is counted in the wrong
  // scope.
  let prev = '';
  const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'do', 'else', 'yield', 'await']);
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') { depth[i] = d; i++; } continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i);
      const stop = e === -1 ? src.length : e + 2;
      while (i < stop) { depth[i] = d; i++; }
      continue;
    }
    if (c === '/' && REGEX_AFTER.has(prev)) {
      depth[i] = d; i++;
      let inClass = false;
      while (i < src.length) {
        depth[i] = d;
        if (src[i] === '\\') { if (i + 1 < src.length) depth[i + 1] = d; i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        else if (src[i] === '\n') break;
        i++;
      }
      prev = '/';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; depth[i] = d; i++;
      while (i < src.length) {
        depth[i] = d;
        if (src[i] === '\\') { if (i + 1 < src.length) depth[i + 1] = d; i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      prev = q;
      continue;
    }
    if (c === '{') { depth[i] = d; d++; i++; prev = c; continue; }
    if (c === '}') { d--; depth[i] = d; i++; prev = c; continue; }
    depth[i] = d;
    // Identifiers accumulate so `return` and `typeof` are seen whole;
    // whitespace leaves the last token standing.
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) && /[\w$]/.test(prev) ? prev + c : c;
    i++;
  }
  // A scanner that ends anywhere but back at the top has lost its place, and
  // every answer it gave is suspect. Say so rather than reporting names.
  if (d !== 0) fail(`${file}: the scope scanner in this check ended at brace depth ${d} — it has misread the file, so its answers cannot be trusted`);
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (depth[m.index] === 0) names.add(m[1]);
  }
  for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  return names;
}
const reachable = new Set();
for (const [name, src] of jsFiles) for (const n of topLevelNames(name, src)) reachable.add(n);
// The admin panel is served from functions/api/ops.js and only to an admin.
for (const n of topLevelNames('functions/api/ops.js', readFileSync('functions/api/ops.js', 'utf8'))) reachable.add(n);

for (const p of panels) {
  if (!BUILT_AT_RUNTIME.has(p.id) && !html.includes(`id="${p.id}"`)) {
    fail(`DZ_PANELS lists #${p.id}, which is not in index.html`);
  }
  if (!p.close) {
    fail(`DZ_PANELS entry #${p.id} has no close function — it would be shut by its class, which skips whatever its own closer does`);
  } else if (!reachable.has(p.close)) {
    fail(`DZ_PANELS says #${p.id} is closed by ${p.close}(), which no script puts on window`);
  }
}

// ---- and every real panel is in the table ----------------------------------
//
// A panel is an element that (a) has a stylesheet rule making it visible when
// it carries `open`, and (b) sits directly inside <body> rather than inside
// another panel. Both halves matter: the first is what every panel in this app
// has in common however it is built, and the second is what tells a section
// apart from the filter sheet inside the gallery or the chat panel inside the
// community page — those go down with the panel that contains them, and
// sweeping them separately would be closing the same thing twice.
//
// Written this way rather than as "the ids some script opens" so that it
// catches the panel somebody adds next year without reading any of this: a new
// full-screen page cannot be styled or placed without tripping both halves.
const css = readdirSync('css')
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync('css/' + f, 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const styled = new Set();
for (const m of (css + '\n' + inlineCss).matchAll(/#([\w-]+)\.open\b/g)) styled.add(m[1]);
for (const m of (css + '\n' + inlineCss).matchAll(/#([\w-]+)\[data-state=["']open/g)) styled.add(m[1]);

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                      'link', 'meta', 'param', 'source', 'track', 'wbr']);
function bodyChildren(doc) {
  // Comments first. There is a `/legal/<slug>` inside one of them, and to a
  // tag scanner that is an element that never closes — every panel after it
  // then reads as nested inside it.
  doc = doc.replace(/<!--[\s\S]*?-->/g, '');
  const ids = [];
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(doc))) {
    const [, slash, tag, attrs, selfClose] = m;
    const name = tag.toLowerCase();
    if (name === 'script' || name === 'style' || name === 'svg') {
      if (!slash && !selfClose) {
        const end = doc.toLowerCase().indexOf(`</${name}`, tagRe.lastIndex);
        if (end !== -1) tagRe.lastIndex = end;
      }
      continue;
    }
    if (slash) { if (stack[stack.length - 1] === name) stack.pop(); continue; }
    if (VOID.has(name) || selfClose) continue;
    if (stack.length === 2 && stack[1] === 'body') {
      const id = /\bid="([^"]+)"/.exec(attrs);
      if (id) ids.push(id[1]);
    }
    stack.push(name);
  }
  if (stack.length) fail(`index.html: ${stack.length} unclosed element(s) — the tag scanner in this check cannot tell what is nested in what`);
  return ids;
}

const known = new Set(panels.map((p) => p.id));
const found = bodyChildren(html);
if (found.length < 20) fail(`index.html: only ${found.length} elements found directly inside <body> — the tag scanner has lost its place`);
for (const id of found) {
  if (!styled.has(id) || known.has(id)) continue;
  fail(`#${id} is a panel — it sits in <body> and its stylesheet shows it when it carries .open — and DZ_PANELS does not list it, so nothing sweeps it when the member changes section`);
}

// ---- nothing in the panel layer steps history back -------------------------
//
// A step back is a navigation: asynchronous, and answered by the popstate
// handler in every module that has one. Closing a panel is not a navigation.
// This is the bug where tapping Upload opened a profile.
for (const [name, src] of jsFiles) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/history\s*\.\s*(back|forward|go)\s*\(/.test(stripped)) {
    fail(`${name}: steps history to close a panel. Swap the entry with replaceState instead — a step back fires popstate, and every module answers it`);
  }
}

// ---- one writer for the address bar ----------------------------------------
if (!/window\.dzRouteAddress\s*=/.test(routes)) fail('js/routes.js no longer publishes dzRouteAddress — the section address has no owner');
if (!/window\.dzRouteAudit\s*=/.test(routes))   fail('js/routes.js no longer publishes dzRouteAudit — nothing checks that the address names an open panel');
for (const need of ['dzNavBegin', 'dzNavEnd', 'dzNavMoving', 'dzNavCurrent', 'dzNavToken', 'dzCloseAllPanels']) {
  if (!new RegExp(`window\\.${need}\\s*=`).test(core)) fail(`js/app-core.js no longer publishes ${need}`);
}

// Every panel the router calls addressable has to be a panel the table knows,
// or the audit is asking about something nothing can open or close.
for (const m of routes.matchAll(/panel:\s*'([^']+)'/g)) {
  if (!known.has(m[1])) fail(`js/routes.js addresses #${m[1]}, which is not in DZ_PANELS`);
}

if (problems.length) {
  console.error('Section layer: ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's'));
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('Section layer: ' + panels.length + ' panels, every one closable, swept and addressable.');
