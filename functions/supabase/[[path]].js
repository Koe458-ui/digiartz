// supabase/ is repo material, not a public directory
//
// Same problem security/ had, and the same fix. The repo root is the deploy
// output, so supabase/functions/smart-function/index.ts has been downloadable:
// that is the edge function authorising every upload and delete, and its
// source is a map of the validation rules, the bucket names and the exact
// shape of a request it will accept. It holds no hardcoded secrets — it reads
// them from Deno.env — but handing an attacker the checks they need to satisfy
// is most of the work done for them.
//
// A Function matching a route wins over a static asset at that path, so this
// takes the directory out of the deploy while the files stay in the repo.
export function onRequest() {
  return new Response('Not found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
