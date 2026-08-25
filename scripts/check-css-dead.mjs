#!/usr/bin/env node
// What in the stylesheets can never take effect?
//
// Fifteen stylesheets load in a fixed order and the later ones restate what the
// earlier ones said. That is how the overrides layer was built, and it is also
// how the sheets filled up with declarations nothing can ever read: a rule
// written in css/viewer.css that css/overrides.css restates at a higher weight
// is, on every screen there is, dead text. Two kinds of it, and they are not
// equally safe to delete:
//
//   SHADOWED   the same selector and property declared twice inside ONE file,
//              the later one winning. Deleting the earlier changes nothing at
//              all -- the winner sits in the same file and loads with it.
//
//   CROSS-FILE the same selector and property in two files. The later file
//              wins today, but deleting the earlier one makes the rule depend
//              on that later file arriving. That dependency is real: taking
//              css/viewer.css's own layout out, because css/overrides.css
//              restated it, is what left the artwork viewer with a zero-width
//              image pane the day overrides.css did not apply. So these are
//              REPORTED, not condemned -- the fix for them is to give the
//              component one owner, not to delete the loser.
//
// Progressive-enhancement fallbacks look exactly like shadowed declarations
// and must never be touched: `justify-content:center` before `safe center`,
// `min(90vh,..)` before `min(90dvh,..)`, a plain colour before color-mix().
// They are the reason the older browser still gets a layout. Anything whose
// winner names a newer feature than its loser is excluded below.
//
// A WARNING about the companion question, "is this class used at all". Do not
// answer it by grepping: class names get built rather than written. The top
// three rows of a leaderboard wear .m1/.m2/.m3, and the only place they exist
// is `'xpLbRank' + ' m' + (i + 1)` in js/misc-core.js and js/ranking.js. A
// search for "m1" finds nothing and the rule looks dead; deleting it takes the
// gold, silver and bronze off the board. Whole components are server-rendered
// too — functions/api/store.js writes the subscription cards, so .subCard and
// forty of its neighbours appear in no file under js/ at all. Opening the page
// and asking which selectors match nothing is no better: with no backend,
// 1876 of 3682 selectors match nothing, and almost all of them are simply
// waiting for data. Every candidate has to be read before it is believed.
//
// Run: node scripts/check-css-dead.mjs [--verbose]
// Exits 0 always; this reports, it does not gate.

import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ORDER = ['base.css','hero.css','viewer.css','community.css','connect.css','ranking.css',
  'profile.css','admin.css','auth.css','panels.css','upload.css','widgets.css','overrides.css',
  'select.css','analytics.css'];
const FILES = ORDER.filter((f) => existsSync('css/' + f));
const verbose = process.argv.includes('--verbose');

// a declaration whose value uses one of these is a newer spelling of the one
// above it, kept as a fallback for browsers that do not understand it
// `clip` is in this list for the same reason as the rest: it is newer than
// `hidden`, and #artModal .avBody says overflow-x:hidden at viewer.css:79
// and overflow-x:clip at viewer.css:1066 precisely so a browser without
// clip still gets a clipped box. Without it here this file reported that
// fallback as dead text that could simply go.
const NEWER = /dvh\b|dvw\b|\bsafe\s|color-mix\(|clamp\(|env\(|:has\(|\bclip\b/;

function declarations(file) {
  const raw = readFileSync('css/' + file, 'utf8');
  const txt = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const stack = [];
  const media = [];
  let buf = '', line = 1;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '\n') line++;
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@')) { stack.push('at'); media.push(head); }
      else stack.push(head);
      continue;
    }
    if (ch === '}') { const t = stack.pop(); if (t === 'at') media.pop(); buf = ''; continue; }
    if (ch === ';') {
      const decl = buf.trim(); buf = '';
      const sel = stack[stack.length - 1];
      if (sel && sel !== 'at' && decl.includes(':')) {
        const idx = decl.indexOf(':');
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const val = decl.slice(idx + 1).trim();
        if (prop && !prop.startsWith('/')) {
          const parts = sel.split(',').map((x) => x.trim()).filter(Boolean);
          for (const s of parts) {
            out.push({ file, line, media: media.join(' & '), sel: s, prop, val,
                       grouped: parts.length > 1, rule: sel.trim() });
          }
        }
      }
      continue;
    }
    buf += ch;
  }
  return out;
}

const all = FILES.flatMap(declarations);
const groups = new Map();
for (const d of all) {
  const k = `${d.media}||${d.sel}||${d.prop}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(d);
}

const shadowed = [], crossFile = [];
for (const list of groups.values()) {
  if (list.length < 2) continue;
  const winner = list[list.length - 1];
  for (const loser of list.slice(0, -1)) {
    if (loser.val === winner.val && loser.file === winner.file) { shadowed.push({ loser, winner }); continue; }
    // a fallback: the winner uses a feature the loser does not
    if (NEWER.test(winner.val) && !NEWER.test(loser.val)) continue;
    if (loser.file === winner.file) shadowed.push({ loser, winner });
    else crossFile.push({ loser, winner });
  }
}

const per = (rows) => {
  const c = new Map();
  for (const r of rows) c.set(r.loser.file, (c.get(r.loser.file) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};

const deletable = shadowed.filter((r) => !r.loser.grouped);
const grouped = shadowed.filter((r) => r.loser.grouped);
console.log(`SHADOWED — same file, later line wins: ${shadowed.length}`);
console.log(`   of those, ${deletable.length} sit in a single-selector rule and can simply go;`);
console.log(`   ${grouped.length} share their rule with other selectors, where the property is still live.`);
for (const [f, n] of per(shadowed)) console.log(`   ${f.padEnd(16)} ${n}`);
if (verbose) for (const { loser, winner } of deletable)
  console.log(`     ${loser.file}:${loser.line}  ${loser.sel} { ${loser.prop}: ${loser.val} }  <- ${winner.file}:${winner.line} wins with ${winner.val}`);

console.log(`\nCROSS-FILE — a later file restates it; report only: ${crossFile.length}`);
for (const [f, n] of per(crossFile)) console.log(`   ${f.padEnd(16)} ${n}`);
if (verbose) for (const { loser, winner } of crossFile)
  console.log(`     ${loser.file}:${loser.line}  ${loser.sel} { ${loser.prop} }  <- ${winner.file}:${winner.line}`);

console.log(`\n${all.length} declarations across ${FILES.length} stylesheets.`);
