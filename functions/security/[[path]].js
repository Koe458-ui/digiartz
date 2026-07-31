// security/ is repo material, not a public directory
//
// The repo root is the deploy output, so everything under security/ has been
// downloadable this whole time: the storage migration, the download-quota
// functions, the moderation gate, and now the payments schema. None of that is
// a secret in the sense of a key — but it is a map of the tables, the column
// names, the RLS policies and the SECURITY DEFINER functions the whole site
// rests on, handed to anyone who guesses a filename.
//
// A Function matching a route wins over a static asset at that path, so this
// takes the directory out of the deploy without moving the files out of the
// repo, where they are worth keeping. Everything under it answers 404, and
// says so to crawlers on the way out in case one indexed a path already.
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
