// template, copy to config.js

window.KOE_CONFIG = {
  SB_URL: 'YOUR_SUPABASE_URL',              // e.g. https://xxxxxxxxxxxx.supabase.co
  SB_KEY: 'YOUR_SUPABASE_PUBLISHABLE_KEY',  // starts with sb_publishable_
  S3_FN_URL: 'YOUR_SUPABASE_FUNCTIONS_URL', // e.g. https://xxxxxxxxxxxx.supabase.co/functions/v1/smart-function

  // Grid thumbnails are served through srcset (300/600/1000) instead of a lone
  // 300px file, which was being upscaled on every desktop. The 600px size only
  // exists for images uploaded after it was added, so this MUST stay false
  // until security/backfill-t600.mjs has been run over the existing ones —
  // a srcset candidate that 404s breaks the image, it does not fall back.
  //
  // Set the matching T600_READY on the Cloudflare Pages project at the same
  // time, so the server-rendered homepage cards agree with the client.
  T600_READY: false
};
