#!/usr/bin/env node

// Writes the sale_credit entries that functions/api/paypal-webhook.js failed to
// write while it carried its own copy of recordEarning.
//
// A marketplace sale settles down one of two paths. A buyer who comes back from
// PayPal hits /api/paypal action=capture, which calls lib/billing.js
// recordEarning and gets both the marketplace_earnings row and the sale_credit
// that follows it. A buyer who closes the tab is settled by the webhook, which
// wrote the earnings row and stopped there. payouts.js gates every withdrawal on
// dz_reconcile, which compares the wallet against the ledger, so those sellers
// have been blocked by a gap they did not cause.
//
// The route is fixed. This repairs the rows it already left behind.
//
// SCHEMA THIS ASSUMES, because ledger_entries is not in this repository:
//   ledger_entries(type, ref_table, ref_id, ...) with a sale_credit row per
//   payment. The script probes for those three columns before it writes
//   anything and stops if they are not there, rather than guessing.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node security/backfill-paypal-ledger.mjs
//
// Dry run unless you pass --apply. Read the plan first — it is money.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SB_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

const base = String(SUPABASE_URL).replace(/\/$/, '');
const headers = {
  apikey: SERVICE_KEY,
  authorization: 'Bearer ' + SERVICE_KEY,
  'content-type': 'application/json',
};

async function rest(path, init = {}) {
  const res = await fetch(base + '/rest/v1' + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && (body.message || body.hint)) || res.status;
    throw new Error(`${init.method || 'GET'} ${path.split('?')[0]} — ${msg}`);
  }
  return body;
}

// PostgREST caps a response; walk it rather than trusting one page.
async function page(pathNoRange, size = 1000) {
  const out = [];
  for (let from = 0; ; from += size) {
    const res = await fetch(base + '/rest/v1' + pathNoRange, {
      headers: { ...headers, range: `${from}-${from + size - 1}` },
    });
    if (!res.ok) throw new Error(`GET ${pathNoRange.split('?')[0]} — ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

const money = (minor, cur) =>
  (['JPY', 'HUF', 'TWD'].includes(cur) ? String(minor) : (minor / 100).toFixed(2)) + ' ' + cur;

async function main() {
  process.stdout.write('Checking ledger_entries is shaped the way this expects … ');
  try {
    await rest('/ledger_entries?select=type,ref_table,ref_id&limit=1');
  } catch (e) {
    console.log('no');
    console.error(`\n  ${e.message}\n\n  ledger_entries is not readable with the columns this script\n` +
                  '  needs (type, ref_table, ref_id). Nothing was written. Check the\n' +
                  '  live schema and update the queries here before re-running.');
    process.exit(1);
  }
  console.log('yes');

  console.log('Reading PayPal earnings that still count …');
  const earnings = await page(
    '/marketplace_earnings?provider=eq.paypal&status=neq.reversed' +
    '&select=id,payment_id,seller_id,net_amount,currency,status&order=created_at.asc');
  console.log(`  ${earnings.length} rows`);

  console.log('Reading sale_credit entries already in the ledger …');
  const credited = new Set(
    (await page('/ledger_entries?type=eq.sale_credit&ref_table=eq.payments&select=ref_id'))
      .map((r) => String(r.ref_id)));
  console.log(`  ${credited.size} payments already credited`);

  const missing = earnings.filter((e) => e.payment_id && !credited.has(String(e.payment_id)));
  if (!missing.length) {
    console.log('\nNothing missing — every counting PayPal sale has its credit.');
    return;
  }

  // pp_capture_id is what the webhook would have passed as p_provider_txn.
  const ids = [...new Set(missing.map((e) => e.payment_id))];
  const pays = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await rest('/payments?id=in.(' + chunk.join(',') + ')' +
                            '&select=id,pp_capture_id,status,kind');
    for (const p of rows || []) pays.set(String(p.id), p);
  }

  // A sale that never settled must not be credited.
  const todo = [];
  const skipped = [];
  for (const e of missing) {
    const p = pays.get(String(e.payment_id));
    if (!p || p.status !== 'paid' || p.kind !== 'marketplace') {
      skipped.push({ e, why: !p ? 'no payment row' : `payment is ${p.kind}/${p.status}` });
      continue;
    }
    todo.push({ e, p });
  }

  const plan = todo.slice(0, LIMIT);
  const bySeller = new Map();
  for (const { e } of plan) {
    const k = e.seller_id + ' ' + e.currency;
    bySeller.set(k, (bySeller.get(k) || 0) + (Number(e.net_amount) || 0));
  }

  console.log(`\n${plan.length} credit${plan.length === 1 ? '' : 's'} to write` +
              (skipped.length ? `, ${skipped.length} skipped` : '') +
              (APPLY ? '' : '  (dry run — pass --apply to write)'));
  console.log('\n  seller / currency                                        amount');
  for (const [k, amt] of [...bySeller].sort((a, b) => b[1] - a[1])) {
    const [seller, cur] = k.split(' ');
    console.log(`  ${seller}  ${cur}   ${money(amt, cur).padStart(16)}`);
  }
  for (const { e, why } of skipped) console.log(`  skip  earning ${e.id} — ${why}`);

  if (!APPLY) {
    console.log('\nNothing written. Re-run with --apply once the plan above looks right.');
    return;
  }

  let done = 0, failed = 0;
  for (const { e, p } of plan) {
    try {
      await rest('/rpc/dz_ledger_append', {
        method: 'POST',
        body: JSON.stringify({
          p_user: e.seller_id,
          p_type: 'sale_credit',
          p_direction: 'credit',
          p_amount: Number(e.net_amount) || 0,
          p_currency: e.currency,
          p_source: 'paypal',
          p_provider_txn: p.pp_capture_id || null,
          p_provider_amount: null,
          p_provider_currency: e.currency,
          p_ref_table: 'payments',
          p_ref_id: e.payment_id,
          p_note: 'backfill — settled by webhook before it wrote the ledger',
        }),
      });
      done++;
      console.log(`ok    ${e.payment_id}  ${money(Number(e.net_amount) || 0, e.currency)}`);
    } catch (err) {
      failed++;
      console.error(`FAIL  ${e.payment_id}: ${err.message}`);
    }
  }

  console.log(`\nwrote ${done}, failed ${failed}`);
  if (done) console.log('Re-run dz_reconcile for the sellers listed above and confirm they agree.');
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
