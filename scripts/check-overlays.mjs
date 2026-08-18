// Every dialog is actually an overlay.
//
// This exists because of one bug, and the bug is worth stating because it is
// the kind that looks fine in every review.
//
// The artwork report sheet was styled by ID:
//
//     #rptMod { position:fixed; inset:0; display:none; }
//     #rptMod.open { display:flex; }
//
// Three things live in there — the full-screen overlay, and the fact that the
// sheet is HIDDEN until .open is added. When an account-report sheet was added
// beside it, copying the markup and the inner class names, it matched none of
// those rules. It was not positioned and it was never hidden, so it rendered
// in the normal page flow at the bottom of the document, permanently visible,
// under the hero. Every class INSIDE it was styled correctly, which is why
// checking the classes did not catch it.
//
// So: for every element with role="dialog", find a rule that positions it.
// Fixed or absolute is fine; static is not, because a static dialog is a
// paragraph.
//
// No dependencies and no browser, in keeping with the other checks here.

import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');

// Comments first — a selector quoted inside one is prose, not a rule, and
// matching them is how a naive version of this check passes everything.
const css = readdirSync('css')
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync('css/' + f, 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Every selector that positions whatever it matches.
const positioning = [];
for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/position\s*:\s*(fixed|absolute|sticky)/.test(body)) continue;
  for (const sel of selectors.split(',')) {
    // The rightmost simple selector is what the rule actually lands on, minus
    // any pseudo-class: `html.x #y:hover` targets #y.
    const last = sel.trim().split(/\s+|>/).pop() || '';
    for (const token of last.split(':')[0].match(/[#.][\w-]+/g) || []) {
      positioning.push(token);
    }
  }
}
const positions = new Set(positioning);

// The dialog itself, or anything it sits inside.
//
// Both shapes are in use here and both are correct: #rptMod puts role="dialog"
// on the overlay, and #vwCfm puts it on the card with the overlay as its
// parent. A check that only looked at the element itself would call the second
// one broken, so the enclosing elements are walked too — which needs the tag
// stack below rather than a regex over one tag.
const VOID = new Set(['area','base','br','col','embed','hr','img','input',
                      'link','meta','param','source','track','wbr']);
const stack = [];
const problems = [];

for (const m of html.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
  const [, closing, tag, attrs, selfClose] = m;
  if (closing) { 
    // Unwind to the matching open tag; malformed nesting must not desync it.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag === tag) { stack.length = i; break; }
    }
    continue;
  }

  const id = (attrs.match(/\bid="([^"]+)"/) || [])[1] || '';
  const classes = ((attrs.match(/\bclass="([^"]+)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
  const keys = [id && '#' + id, ...classes.map((c) => '.' + c)].filter(Boolean);
  const frame = { tag, id, classes, keys };

  if (/\brole="dialog"/.test(attrs)) {
    const covered = [frame, ...stack].some((f) => f.keys.some((k) => positions.has(k)));
    if (!covered) {
      problems.push(
        `<${tag}${id ? ' id="' + id + '"' : ''}` +
        `${classes.length ? ' class="' + classes.join(' ') + '"' : ''}>`);
    }
  }

  if (!selfClose && !VOID.has(tag)) stack.push(frame);
}

if (problems.length) {
  console.error('These dialogs have no rule giving them a position, so they render');
  console.error('in the page flow instead of over it:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nGive each one a class that is already an overlay (.rptMod, .upPop)');
  console.error('or a rule of its own. See css/viewer.css for why this check exists.');
  process.exit(1);
}

const count = [...html.matchAll(/\brole="dialog"/g)].length;
console.log(`overlays ok — ${count} dialogs, every one positioned over the page`);
