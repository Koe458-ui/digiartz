// template, copy to config.js

window.KOE_CONFIG = {
  SB_URL: 'YOUR_SUPABASE_URL',              // e.g. https://xxxxxxxxxxxx.supabase.co
  SB_KEY: 'YOUR_SUPABASE_PUBLISHABLE_KEY',  // starts with sb_publishable_
  S3_FN_URL: 'YOUR_SUPABASE_FUNCTIONS_URL', // e.g. https://xxxxxxxxxxxx.supabase.co/functions/v1/smart-function

  // Grid thumbnails are served through srcset (300/600/1000) instead of a lone
  // 300px file, which was being upscaled on every desktop.
  //
  // The backfill is DONE — every existing image has its 600px size — so this
  // is now just the on switch. Turn it on with the boolean true.
  //
  // The SAME name must also be set as an environment variable on the
  // Cloudflare Pages project, because the worker renders the homepage cards
  // server-side and the client hydrates over them; if only one is on, the two
  // disagree about which markup the page has. Pages variables are strings, so
  // there it is the STRING "true".
  //
  //     config.js (here)   T600_READY: true      <- boolean
  //     Pages env var      T600_READY = true     <- string, typed in the UI
  //
  // Both sides accept true/1/yes/on in any case, and treat anything else —
  // including the strings "false" and "0" — as off, so this can be switched
  // back the obvious way without silently staying on.
  T600_READY: false
};
