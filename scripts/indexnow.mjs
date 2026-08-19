// Tell the engines that are not Google.
//
// Google finds a new url by crawling and by the sitemap, and it renders the
// page before deciding what it is. Nothing else does both. Bing, Yandex,
// Seznam and Naver take submissions instead — one shared endpoint, the
// IndexNow protocol — and everything reading Bing's index second-hand
// (DuckDuckGo, Ecosia, and Brave where its own index has no answer) gets the
// url when Bing does.
//
// So this exists to close the gap the sitemap alone leaves: a sitemap is
// polled when the engine feels like it, and a submission is a push. The six
// section destinations in the footer never change their addresses, so in
// practice this is run once after a deploy that changes what they are, and
// again whenever a batch of items is published.
//
//   node scripts/indexnow.mjs                 # the sections, the home page, legal
//   node scripts/indexnow.mjs --sitemap       # everything in sitemap.xml
//   node scripts/indexnow.mjs --dry-run       # print the payload, submit nothing
//
// The key is not a secret. IndexNow verifies ownership by fetching it back
// from https://digiartz.net/<key>.txt, so it is published on purpose and
// committed next to this file for the same reason robots.txt is.

const HOST = 'digiartz.net';
const SITE = `https://${HOST}`;
const KEY  = '8968b78d9c9d0df0553bf47f2e121021';
const ENDPOINT = 'https://api.indexnow.org/IndexNow';

// The destinations the footer puts forward, which are the ones this is for,
// plus the home page above them. Kept in step with the SECTIONS table in
// functions/_middleware.js, the sectionEntries list in functions/sitemap.xml.js
// and the Browse column in index.html.
const SECTIONS = [
  '/', '/explore', '/marketplace', '/community', '/resources', '/blog', '/login'
];
const LEGAL = [
  'privacy', 'terms', 'refund', 'delivery', 'creator-terms', 'cookies', 'contact'
].map((s) => `/legal/${s}`);

async function fromSitemap() {
  const res = await fetch(`${SITE}/sitemap.xml`);
  if (!res.ok) throw new Error(`sitemap ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');

const urls = args.has('--sitemap')
  ? await fromSitemap()
  : [...SECTIONS, ...LEGAL].map((p) => SITE + p);

// IndexNow takes at most 10,000 urls per request.
const batches = [];
for (let i = 0; i < urls.length; i += 10000) batches.push(urls.slice(i, i + 10000));

console.log(`${urls.length} url${urls.length === 1 ? '' : 's'} in ${batches.length} batch(es)`);
for (const u of urls.slice(0, 20)) console.log('  ' + u);
if (urls.length > 20) console.log(`  … and ${urls.length - 20} more`);

if (dry) { console.log('\n--dry-run: nothing submitted'); process.exit(0); }

let failed = 0;
for (const [i, batch] of batches.entries()) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList: batch
  });
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body
  });
  // 200 accepted, 202 accepted but the key is still being verified. Both are
  // successes and the second one is what a first-ever submission looks like.
  const okish = res.status === 200 || res.status === 202;
  if (!okish) failed++;
  console.log(`batch ${i + 1}/${batches.length}: ${res.status} ${res.statusText}` +
              (okish ? '' : ` — ${(await res.text()).slice(0, 200)}`));
}

if (failed) { console.error(`\n${failed} batch(es) rejected`); process.exit(1); }
console.log('\nsubmitted');
