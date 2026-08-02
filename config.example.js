// REFERENCE ONLY — the site never loads this file, and on Cloudflare Pages
// nobody edits config.js by hand either. It is GENERATED at deploy time by the
// Pages build command, from environment variables.
//
// PASTE IT AS ONE LINE. The Pages build command field is a single-line input:
// it keeps backslashes and drops the newlines around them, so a command split
// with trailing "\" arrives as "; \ FN=..." and the shell reads the backslash
// as escaping the space rather than a line break. The next token is then a
// command whose name literally starts with a space, and the build dies with
//
//   /bin/sh: 1:  FN=https://...: not found
//   Failed: build command exited with code: 1
//
// leaving config.js unwritten and the whole deploy failed. Note the two spaces
// after "1:" — that is the giveaway. Copy the line below with no backslashes:
//
// [ "$T600_READY" = "true" ] && T6=true || T6=false; FN="${S3_FN_URL:-$SB_URL/functions/v1/smart-function}"; echo "window.KOE_CONFIG = { SB_URL: '$SB_URL', SB_KEY: '$SB_KEY', S3_FN_URL: '$FN', T600_READY: $T6 };" > config.js
//
// So adding a key here does nothing until the build command emits it. This
// file exists to record what the generated shape should look like.
//
// WHAT GOES IN HERE vs WHAT STAYS SERVER-SIDE
// Everything below is public: config.js is served to every visitor, so
// treat it as readable by anyone. The publishable key is designed for that
// and already ships in every page load.
//
// These must NEVER be emitted into config.js. They are read by the Pages
// FUNCTIONS at runtime (functions/api/*), which see env vars directly and
// never expose them to the browser:
//
//   GEMINI_API_KEY       upload moderation, functions/api/moderate-upload.js
//   GEMINI_MODEL         optional override for the above
//   MOD_SIGNING_SECRET   signs moderation approvals; a leak lets anyone forge one
//   SUPABASE_SERVICE_ROLE_KEY   bypasses every RLS policy. The payment and
//                               payout Functions also accept it spelled
//                               SB_SERVICE_KEY — this project grew two naming
//                               conventions and they read either, so bind
//                               whichever, but bind ONE or every money
//                               endpoint answers "not configured".
//   PAYPAL_CLIENT_ID            public half of the PayPal REST credentials
//   PAYPAL_CLIENT_SECRET        secret half; a leak lets anyone take payments
//                               as us
//   PAYPAL_WEBHOOK_ID           proves an incoming webhook is really PayPal.
//                               Without it the webhook refuses everything.
//   PAYPAL_ENV                  'sandbox' for testing, unset for live
//   RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET   the other checkout
//   RAZORPAY_WEBHOOK_SECRET     proves an incoming webhook is really Razorpay.
//                               NOT the key secret above and not something
//                               Razorpay hands you — you invent the string and
//                               paste the same one into Dashboard -> Settings
//                               -> Webhooks. Without it functions/api/
//                               rzp-webhook.js refuses every event, which
//                               means a buyer whose tab closed mid-payment is
//                               never settled and a refund is never heard.
//
// Setting any of those as a Pages environment variable is correct and safe.
// Echoing them into config.js publishes them to the world.
//
// T600_READY is the one name that belongs in both places: the build command
// copies it into config.js for the browser, and functions/_middleware.js reads
// the same Pages variable directly for the server-rendered homepage cards.

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
