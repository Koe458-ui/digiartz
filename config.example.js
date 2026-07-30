// TEMPLATE ONLY — the site never loads this file.
//
// index.html loads /config.js. Editing THIS file changes nothing that runs:
// copy it to config.js and edit that. config.js is gitignored, which is why
// it is not in this repo and cannot be committed here.
//
// The values below are this project's real ones, so the file can be copied
// across verbatim. The publishable key is designed to be public — it already
// ships in every page load and is committed in functions/api/download.js —
// so nothing here is a secret. The service_role key must NEVER appear in this
// file; it bypasses every RLS policy and this file is served to browsers.

window.KOE_CONFIG = {
  SB_URL: 'https://tmqzqlrpjpydiftlrzmj.supabase.co',
  SB_KEY: 'sb_publishable_x7xlsCx-ZsvpNLCXRxyvMw_PsJQT2xy',

  // Despite the name this is NOT AWS. It is the Supabase edge function that
  // authorises every upload and delete, and has had nothing to do with S3
  // since the storage migration. Deleting it while clearing out S3 leftovers
  // looks like tidying up and instead breaks artwork, avatar, banner,
  // resource, marketplace and blog uploads with "Storage endpoint not
  // configured". It is required.
  S3_FN_URL: 'https://tmqzqlrpjpydiftlrzmj.supabase.co/functions/v1/smart-function',

  // Serves grid thumbnails at 300/600/1000 through srcset instead of one
  // upscaled 300px file. Every existing image already has its 600px size, so
  // this is just the on switch.
  //
  // The SAME name must also be set as an environment variable on the
  // Cloudflare Pages project — the worker renders the homepage cards
  // server-side and the browser hydrates over them, so if only one side is on
  // the two disagree. Pages variables are typed as text, so there it is the
  // string true; here it is the boolean.
  T600_READY: true
};
