#!/usr/bin/env node
/* Two endpoints ship JavaScript to the browser inside a template literal:
   the store module and the admin panel. A backtick anywhere in one of those
   literals — in a comment, most easily — ends it early and silently splices
   the rest of the file into the module. `node --check` still passes, because
   what is left is valid JavaScript; it is simply not the program that was
   written. This parses what each endpoint actually emits.

     node scripts/check-emitted.mjs                                        */

import { readFileSync } from 'node:fs';

let failed = 0;
for (const file of ['functions/api/ops.js', 'functions/api/store.js']) {
  const src = readFileSync(file, 'utf8');
  let body = '', n = 0;
  for (const m of src.matchAll(/const (\w+) = `([\s\S]*?)\n`;/g)) {
    if (/^STYLE/.test(m[1])) continue;          // stylesheets, not scripts
    body += m[2] + '\n';
    n++;
  }
  try {
    new Function(body);
    console.log(`ok    ${file} emits ${n} pieces, ${body.split('\n').length} lines that parse`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${file} emits something that does not parse: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
