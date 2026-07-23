/* ── app-core.js · supabase + S3 helpers, loaders, categories, infinite scroll ── */

  // config.js must define window.KOE_CONFIG = { SB_URL, SB_KEY }
  const SB_URL = (window.KOE_CONFIG && window.KOE_CONFIG.SB_URL) || '';
  const SB_KEY = (window.KOE_CONFIG && window.KOE_CONFIG.SB_KEY) || '';

  // Admin role derived from profiles.role in Supabase, enforced via RLS
  const BUCKET   = 'koe-media';
  const S3_FN_URL = (window.KOE_CONFIG && window.KOE_CONFIG.S3_FN_URL) || '';

  /* ── S3 upload/delete — replaces sb.storage.from(...).upload/remove.
     Images now live in AWS S3 (via CloudFront); Supabase Storage is
     no longer used for new uploads. Both helpers throw on failure
     with a `.message`, matching the shape every call site's existing
     `catch(err){ ...err.message }` already expects — so none of
     that error handling needed to change.

     `bucket` keeps meaning what it always meant at each call site
     (BUCKET) — here it's used as the S3 key prefix (koe-media/...)
     instead of a Supabase bucket name, matching what the s3-sign
     edge function expects. */
  /* ── S3 key sanitizer ──
     FIX ("bad path" upload error): artwork titles were dropped straight
     into the S3 key with only whitespace replaced (nm.replace(/\s+/g,'_')).
     A title containing '/', '#', '?', '%', '&', '\', or certain unicode/
     emoji produces an invalid or dangerous key — '/' silently creates
     extra "folders", and '#'/'?'/'%' break URL parsing — which the
     s3-sign edge function (correctly) rejects as a bad path.
     safeSlug() strips everything down to a plain, S3-safe token so any
     title can be uploaded. The file extension goes through the same
     sanitizer as a second layer of defense. */
  function safeSlug(str, maxLen){
    var s = String(str || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')  /* fold accents (é→e) */
      .replace(/[^a-zA-Z0-9]+/g, '_')                    /* anything not alnum → _ */
      .replace(/_+/g, '_')                               /* collapse repeats */
      .replace(/^_+|_+$/g, '');                          /* trim edges */
    if(!s) s = 'untitled';
    return s.slice(0, maxLen || 60);
  }
  async function s3AuthHeader(){
    if(!sb) throw new Error('Backend not configured');
    const{data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Sign in required');
    return 'Bearer '+session.access_token;
  }
  async function s3Upload(bucket, path, file){
    if(!S3_FN_URL) throw new Error('Storage endpoint not configured (S3_FN_URL missing in config.js)');
    const auth = await s3AuthHeader();
    const key = bucket+'/'+path;
    /* Step 1 — ask the s3-sign edge function for a presigned PUT URL.
       A network-level failure here means the endpoint itself is
       unreachable (bad S3_FN_URL, function not deployed, or its CORS). */
    let signRes;
    try{
      signRes = await fetch(S3_FN_URL, {
        method:'POST',
        headers:{'content-type':'application/json', 'authorization':auth},
        body: JSON.stringify({action:'upload', path:key, contentType:file.type, size:file.size})
      });
    }catch(e){
      throw new Error('Could not reach the upload service — check S3_FN_URL and the edge function\u2019s CORS');
    }
    const signJson = await signRes.json().catch(function(){return{};});
    if(!signRes.ok) throw new Error(signJson.error || ('Upload authorization failed ('+signRes.status+')'));
    if(!signJson.uploadUrl) throw new Error('Upload service returned no uploadUrl');
    /* Step 2 — PUT the file to S3. A network-level failure here is
       almost always the S3 bucket's CORS policy not allowing PUT
       from this origin (the browser blocks it before any bytes move). */
    let putRes;
    try{
      putRes = await fetch(signJson.uploadUrl, {method:'PUT', headers:{'content-type':file.type}, body:file});
    }catch(e){
      throw new Error('Upload blocked by the storage server — add this site\u2019s origin with PUT to the S3 bucket\u2019s CORS policy');
    }
    if(!putRes.ok) throw new Error('Upload failed ('+putRes.status+') — presigned URL rejected by S3');
    return signJson.publicUrl;
  }
  async function s3Delete(bucket, path){
    if(!path) return;
    if(!S3_FN_URL) throw new Error('Storage endpoint not configured');
    const auth = await s3AuthHeader();
    const res = await fetch(S3_FN_URL, {
      method:'POST',
      headers:{'content-type':'application/json', 'authorization':auth},
      body: JSON.stringify({action:'delete', path:bucket+'/'+path})
    });
    const j = await res.json().catch(function(){return{};});
    if(!res.ok || j.ok===false) throw new Error(j.error || 'Delete failed');
  }


  /* SEO defaults read from <head> so resetArtworkSEO() stays in sync */
  var SITE_DEFAULT_TITLE = document.title;
  var SITE_DEFAULT_DESC  = (document.querySelector('meta[name="description"]')||{}).content || '';
  var SITE_DEFAULT_IMAGE = (document.querySelector('meta[property="og:image"]')||{}).content || '';

  let sb = null;
  if (SB_URL && SB_KEY) {
    sb = supabase.createClient(SB_URL , SB_KEY )
  } else {
    /* User-facing copy only. This used to print the whole dev setup guide
       ("create a config.js ... Get a free Supabase project"), which named
       our backend, leaked the config shape, and meant nothing to a visitor.
       The real cause is logged for us; the visitor just sees a plain notice. */
    console.error('KOE_CONFIG missing SB_URL/SB_KEY \u2014 backend client not created.');
    var _sb = document.getElementById('sBanner');
    if(_sb){
      _sb.textContent = '\u26a0 Can\u2019t connect right now. Please refresh, or try again in a moment.';
      _sb.classList.add('show');
    }
  }

  let images = [];
  let filterCat = 'all', filterSrt = 'trending';

  function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  /* Only ever show the user a message WE wrote. Raw backend errors leak schema
     details ("new row violates row-level security policy for table \"comments\"",
     "duplicate key value violates unique constraint ...") and tell a visitor
     nothing useful. Anything that smells internal is logged and swapped for the
     caller's plain-English fallback. */
  function safeErr(e, fallback){
    var m = (e && e.message) ? String(e.message) : '';
    var internal = /row-level security|violates|constraint|relation |column |permission denied|JWT|supabase|postgres|duplicate key|null value|schema cache|Failed to fetch|NetworkError|\b(42501|23505|23503)\b|PGRST/i;
    if(!m || internal.test(m)){
      if(m) console.error('Suppressed internal error:', m);
      return fallback;
    }
    return m;
  }
  /* Normalizes the `category` column into a clean array of lowercase-
     trimmed strings, whether it comes back from Supabase as a real
     text[] array (current schema) or a legacy comma-joined string
     (pre-migration rows) — every read of art.category should go
     through this instead of calling .split(',') directly. */
  /* Slugs kept out of the UI. The rows keep their value — this only
     stops it being shown, offered as a filter, or title-cased into a
     stray chip. Empty this list to bring one back. */
  var CAT_HIDDEN = { 'ai-art':1 };
  function catList(val){
    var out = Array.isArray(val)
      ? val.map(function(c){return String(c).trim();})
      : String(val||'').split(',').map(function(c){return c.trim();});
    return out.filter(function(c){ return c && !CAT_HIDDEN[c]; });
  }

  /* ═══════════════════════════════════════════════════════════════
     SITE_CATEGORIES — the single source of truth for categories.
     ───────────────────────────────────────────────────────────────
     Order here is the order everywhere: the homepage tab strip
     (.awTabs), the gallery filter panel, and both upload pickers are
     all generated from this array. To add/remove/reorder a category,
     edit this list and nothing else.

       slug  → what's written to artworks.category (NEVER change an
               existing slug: live rows reference it)
       label → what the user sees

     Two deliberate quirks:
     • 'landscapes' keeps its legacy plural slug (labelled "Landscape")
       so the artworks already tagged with it aren't orphaned.
     • 'others' isn't in the design list but stays last — it's the
       fallback the upload code writes when nothing is picked. ── */
  /* ═══════════════════════════════════════════════════════════════
     FILTER OPTION ICONS
     A shared glyph table plus a slug → glyph map, so every filter row
     (artwork categories, sort, and the five section lists) gets a
     leading icon from ONE source instead of markup repeating SVG.
     Glyphs are reused deliberately — three vehicle categories reading
     as three near-identical trucks would be noise, so related slugs
     share. Anything unmapped falls back to 'dots' rather than
     rendering a hole.
     Strokes use currentColor: .fltIco owns the colour, which follows
     the row's selected state.
     ═══════════════════════════════════════════════════════════════ */
  var FLT_GLYPH = {
    'anchor'   :'<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21"/><path d="M7.5 11h9"/><path d="M4 15a8 8 0 0 0 16 0"/>',
    'archive'  :'<rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10"/><path d="M10 12.5h4"/>',
    'atom'     :'<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/>',
    'bag'      :'<path d="M6 2.5 3.5 6.5v13A1.5 1.5 0 0 0 5 21h14a1.5 1.5 0 0 0 1.5-1.5v-13L18 2.5z"/><path d="M3.5 6.5h17"/><path d="M15.5 10a3.5 3.5 0 0 1-7 0"/>',
    'bike'     :'<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><path d="M6 16.5l4-8h5l3 8"/><path d="M9 8.5h4"/>',
    'book'     :'<path d="M12 7c-1.8-1.3-4-2-6.5-2H3v13h2.5c2.5 0 4.7.7 6.5 2 1.8-1.3 4-2 6.5-2H21V5h-2.5C16 5 13.8 5.7 12 7z"/><path d="M12 7v13"/>',
    'briefcase':'<rect x="2.5" y="7" width="19" height="13.5" rx="2"/><path d="M16 20.5V5.5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v15"/>',
    'brush'    :'<path d="M15.5 3.5a2.1 2.1 0 0 1 3 3L9.5 15.5l-4 1 1-4z"/><path d="M5 18.5c1.5 0 2.5 1 2.5 2.5H3c0-1.5.5-2.5 2-2.5z"/>',
    'building' :'<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8.5 7.5h2"/><path d="M13.5 7.5h2"/><path d="M8.5 12h2"/><path d="M13.5 12h2"/><path d="M10 21v-4h4v4"/>',
    'calendar' :'<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    'cap'      :'<path d="M2.5 8.5 12 4l9.5 4.5L12 13z"/><path d="M6.5 10.5V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-5.5"/>',
    'car'      :'<path d="M3.5 16.5v-4l2-5h13l2 5v4z"/><path d="M5 16.5v2.5h2.5v-2.5"/><path d="M16.5 16.5V19H19v-2.5"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
    'card'     :'<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h3"/>',
    'cart'     :'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.8 1.8 0 0 0 1.8 1.4h8.4a1.8 1.8 0 0 0 1.8-1.4L21.5 7H6"/>',
    'chart'    :'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M21 20H3"/>',
    'clock'    :'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    'cpu'      :'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5V6"/><path d="M15 2.5V6"/><path d="M9 18v3.5"/><path d="M15 18v3.5"/><path d="M2.5 9H6"/><path d="M2.5 15H6"/><path d="M18 9h3.5"/><path d="M18 15h3.5"/>',
    'cube'     :'<path d="M12 2.5l8 4.5v9l-8 4.5-8-4.5v-9z"/><path d="M4 7l8 4.5L20 7"/><path d="M12 11.5v9"/>',
    'cup'      :'<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M4 21.5h13"/>',
    'dots'     :'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    'download' :'<path d="M12 3v11"/><path d="M7.5 10L12 14.5 16.5 10"/><path d="M4 18.5h16"/>',
    'droplet'  :'<path d="M12 3s6 6.3 6 10.2A6 6 0 0 1 6 13.2C6 9.3 12 3 12 3z"/>',
    'feather'  :'<path d="M19.5 4.5a5.7 5.7 0 0 0-8 0L5 11v8h8l6.5-6.5a5.7 5.7 0 0 0 0-8z"/><path d="M13 4.5 5 19"/>',
    'file'     :'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    'flame'    :'<path d="M12 21c3.6 0 6.5-2.7 6.5-6 0-4.5-4.5-6.5-4-12-2.5 1.5-5 4.5-5 7.5 0 1.5-1 2-1.5 1.2-.6-.9-.5-2.2-.5-2.2C6 10.5 5.5 12.6 5.5 15c0 3.3 2.9 6 6.5 6z"/>',
    'flower'   :'<circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="6.5" r="2.8"/><circle cx="12" cy="17.5" r="2.8"/><circle cx="6.5" cy="12" r="2.8"/><circle cx="17.5" cy="12" r="2.8"/>',
    'grid'     :'<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
    'heart'    :'<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    'home'     :'<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5v10h13v-10"/><path d="M10 19.5v-5h4v5"/>',
    'image'    :'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
    'layers'   :'<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    'layout'   :'<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18"/><path d="M9.5 9v12"/>',
    'leaf'     :'<path d="M4 20s-.5-8 4.5-12.5S20 4 20 4s.5 8-4.5 12.5S4 20 4 20z"/><path d="M8 16l8-8"/>',
    'megaphone':'<path d="M4 10.5v3A1.5 1.5 0 0 0 5.5 15H8l7 4.5v-15L8 9H5.5A1.5 1.5 0 0 0 4 10.5z"/><path d="M18.5 9.5a4 4 0 0 1 0 5"/>',
    'message'  :'<path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.4A7.5 7.5 0 1 1 20.5 12.5z"/>',
    'mic'      :'<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
    'monitor'  :'<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7"/><path d="M12 16.5v4"/>',
    'moon'     :'<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
    'mountain' :'<path d="M3 19l6-9 4 5.5 2.5-3.5L21 19z"/><circle cx="8" cy="6.5" r="1.8"/>',
    'palette'  :'<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.7-1.5-.7-2.3c0-.9.7-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="12.5" r="1.1"/><circle cx="9.8" cy="7.8" r="1.1"/><circle cx="14.6" cy="7.8" r="1.1"/>',
    'paw'      :'<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M12 11c-2.8 0-5 2.2-5 4.5S9 21 12 21s5-3.2 5-5.5S14.8 11 12 11z"/>',
    'pencil'   :'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    'plane'    :'<path d="M2.5 13.5 21 4l-4 15-4.5-4.5-2.5 4-1-5.5z"/><path d="M10.5 13.5 21 4"/>',
    'puzzle'   :'<path d="M5 8h3V6a2.5 2.5 0 0 1 5 0v2h3a1 1 0 0 1 1 1v3h2a2.5 2.5 0 0 1 0 5h-2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/>',
    'shield'   :'<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/><path d="M9 12l2 2 4-4"/>',
    'smile'    :'<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01"/><path d="M15 9.5h.01"/>',
    'sparkle'  :'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.3 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    'star'     :'<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6.1L12 16.8 6.7 19.7l1.1-6.1L3.4 9.4l6-.8z"/>',
    'tag'      :'<path d="M11 3H3v8l10 10 8-8z"/><circle cx="7" cy="7" r="1.4"/>',
    'trophy'   :'<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5V7a3 3 0 0 0 3 3"/><path d="M16 5.5h3V7a3 3 0 0 1-3 3"/><path d="M12 13v4"/><path d="M8.5 20.5h7"/>',
    'truck'    :'<rect x="2.5" y="7" width="11" height="9.5" rx="1.5"/><path d="M13.5 10.5h4l3 3v3h-7z"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>',
    'type'     :'<path d="M4 6V4.5h16V6"/><path d="M12 4.5V20"/><path d="M9 20h6"/>',
    'user'     :'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    'users'    :'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M18 14.4a6.5 6.5 0 0 1 3.5 5.6"/>',
    'wifi'     :'<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M6 12.5a9 9 0 0 1 12 0"/><path d="M9.5 16a4 4 0 0 1 5 0"/><circle cx="12" cy="19.5" r="1"/>',
    'zap'      :'<path d="M13.5 2.5 4.5 13.5h6l-.5 8 9-11h-6z"/>'
  };
  var FLT_ICO_MAP = {
    '3d-art'            :'cube',
    '3d-assets'         :'cube',
    '3d-models'         :'cube',
    'abstract'          :'layers',
    'aesthetic-art'     :'sparkle',
    'aircraft'          :'plane',
    'all'               :'grid',
    'animals'           :'paw',
    'anime'             :'smile',
    'announcements'     :'megaphone',
    'architecture'      :'building',
    'artist-spotlights' :'star',
    'artwork'           :'image',
    'bikes'             :'bike',
    'birds'             :'feather',
    'brushes'           :'brush',
    'buildings'         :'building',
    'buses'             :'truck',
    'cars'              :'car',
    'challenges'        :'trophy',
    'characters'        :'user',
    'checkout'          :'card',
    'chibi'             :'sparkle',
    'cityscape'         :'building',
    'collaboration'     :'users',
    'color-palettes'    :'palette',
    'comic'             :'book',
    'commissions'       :'user',
    'community'         :'users',
    'concept-art'       :'palette',
    'contest'           :'trophy',
    'digital-art'       :'monitor',
    'digital-downloads' :'download',
    'downloads'         :'download',
    'dragons'           :'flame',
    'events'            :'calendar',
    'fan-art'           :'brush',
    'fantasy'           :'sparkle',
    'flowers'           :'flower',
    'fonts'             :'type',
    'food-art'          :'cup',
    'freelance'         :'briefcase',
    'full-time'         :'building',
    'hiring-artists'    :'user',
    'icons'             :'smile',
    'illustrations'     :'file',
    'interior-design'   :'home',
    'internship'        :'cap',
    'interviews'        :'mic',
    'landscapes'        :'mountain',
    'licenses'          :'shield',
    'logos'             :'tag',
    'manga'             :'book',
    'marine-life'       :'droplet',
    'mecha'             :'cpu',
    'mockups'           :'monitor',
    'monsters'          :'flame',
    'mythology'         :'flame',
    'nature'            :'leaf',
    'new'               :'clock',
    'news'              :'file',
    'old'               :'archive',
    'orders'            :'archive',
    'others'            :'dots',
    'part-time'         :'clock',
    'patterns'          :'grid',
    'pixel-art'         :'grid',
    'plugins'           :'puzzle',
    'poster-art'        :'tag',
    'prints'            :'tag',
    'psd-files'         :'file',
    'references'        :'image',
    'releases'          :'archive',
    'remote'            :'wifi',
    'reviews'           :'message',
    'robots'            :'cpu',
    'saved-for-later'   :'heart',
    'scenery'           :'mountain',
    'sci-fi'            :'atom',
    'services'          :'bag',
    'ships'             :'anchor',
    'shopping-cart'     :'cart',
    'sketches'          :'pencil',
    'space'             :'moon',
    'templates'         :'layout',
    'textures'          :'grid',
    'tips-guides'       :'cube',
    'traditional-art'   :'brush',
    'trees'             :'leaf',
    'trending'          :'chart',
    'trucks'            :'truck',
    'tutorials'         :'book',
    'typography'        :'type',
    'ui-kits'           :'layout',
    'wallpapers'        :'image',
    'weapons'           :'zap',
    'website-templates' :'monitor'
  };
  function fltIco(key){
    var g = FLT_GLYPH[FLT_ICO_MAP[key] || 'dots'] || FLT_GLYPH.dots;
    return '<span class="fltIco" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" '+
           'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" '+
           'stroke-linejoin="round">'+g+'</svg></span>';
  }

  var SITE_CATEGORIES = [
    {slug:'characters',      label:'Characters'},
    {slug:'anime',           label:'Anime'},
    {slug:'manga',           label:'Manga'},
    {slug:'comic',           label:'Comic'},
    {slug:'fan-art',         label:'Fan Art'},
    {slug:'chibi',           label:'Chibi'},
    {slug:'sketches',        label:'Sketches'},
    {slug:'illustrations',   label:'Illustrations'},
    {slug:'concept-art',     label:'Concept Art'},
    {slug:'digital-art',     label:'Digital Art'},
    {slug:'traditional-art', label:'Traditional Art'},
    {slug:'abstract',        label:'Abstract'},
    {slug:'typography',      label:'Typography'},
    {slug:'poster-art',      label:'Poster Art'},
    {slug:'logos',           label:'Logos'},
    {slug:'icons',           label:'Icons'},
    {slug:'wallpapers',      label:'Wallpapers'},
    {slug:'cars',            label:'Cars'},
    {slug:'bikes',           label:'Bikes'},
    {slug:'trucks',          label:'Trucks'},
    {slug:'buses',           label:'Buses'},
    {slug:'aircraft',        label:'Aircraft'},
    {slug:'ships',           label:'Ships'},
    {slug:'robots',          label:'Robots'},
    {slug:'mecha',           label:'Mecha'},
    {slug:'weapons',         label:'Weapons'},
    {slug:'fantasy',         label:'Fantasy'},
    {slug:'dragons',         label:'Dragons'},
    {slug:'monsters',        label:'Monsters'},
    {slug:'mythology',       label:'Mythology'},
    {slug:'sci-fi',          label:'Sci-Fi'},
    {slug:'space',           label:'Space'},
    {slug:'nature',          label:'Nature'},
    {slug:'animals',         label:'Animals'},
    {slug:'birds',           label:'Birds'},
    {slug:'marine-life',     label:'Marine Life'},
    {slug:'landscapes',      label:'Landscape'},
    {slug:'scenery',         label:'Scenery'},
    {slug:'cityscape',       label:'Cityscape'},
    {slug:'architecture',    label:'Architecture'},
    {slug:'buildings',       label:'Buildings'},
    {slug:'interior-design', label:'Interior Design'},
    {slug:'food-art',        label:'Food Art'},
    {slug:'flowers',         label:'Flowers'},
    {slug:'trees',           label:'Trees'},
    {slug:'patterns',        label:'Patterns'},
    {slug:'3d-art',          label:'3D Art'},
    {slug:'pixel-art',       label:'Pixel Art'},
    {slug:'aesthetic-art',   label:'Aesthetic Art'},
    {slug:'others',          label:'Others'}
  ];
  var CAT_SLUGS = SITE_CATEGORIES.map(function(c){ return c.slug; });
  /* slug → label, for rendering a stored category back to the user.
     Unknown slugs (from older rows) fall back to a title-cased slug. */
  var CAT_LABELS = SITE_CATEGORIES.reduce(function(m,c){ m[c.slug]=c.label; return m; },{});
  function catLabel(slug){
    if(!slug) return '';
    if(CAT_LABELS[slug]) return CAT_LABELS[slug];
    return String(slug).replace(/-/g,' ').replace(/\b\w/g,function(ch){ return ch.toUpperCase(); });
  }

  /* Paints every category-driven UI from SITE_CATEGORIES:
       1. #fltCatOpts    — gallery filter radios (after "ALL CATEGORIES")
       2. #pfUpCatPanel  — universal upload checkboxes
       4. #awTabs        — homepage tab strip (before the indicator)
     Runs once on DOMContentLoaded. Element ids are built with
     getElementById-safe names, so slugs starting with a digit
     ('3d-art') are fine — they're never used as CSS selectors. */
  function buildCategoryUI(){
    /* 1. Filter panel radios */
    var fo = document.getElementById('fltCatOpts');
    if(fo){
      fo.insertAdjacentHTML('beforeend', SITE_CATEGORIES.map(function(c){
        return '<label class="fltOpt"><input type="radio" name="fltCat" value="'+esc(c.slug)+'">'+
               '<div class="fltDot"></div>'+fltIco(c.slug)+
               '<span class="fltLbl">'+esc(c.label.toUpperCase())+'</span></label>';
      }).join(''));
    }
    /* 2. Profile upload checkboxes — 'others' is the default check */
    var pp = document.getElementById('pfUpCatPanel');
    if(pp){
      pp.innerHTML = SITE_CATEGORIES.map(function(c){
        return '<label class="upCatOpt"><input type="checkbox" id="pfUpCat_'+esc(c.slug)+'" value="'+esc(c.slug)+'"'+
               (c.slug==='others'?' checked':'')+' onchange="updatePfCatDisplay()"/> '+esc(c.label)+'</label>';
      }).join('');
    }
    /* 4. Homepage tab strip — inserted after the "Artworks" tab and
          before the sliding indicator, which must stay the last child. */
    var awInd = document.getElementById('awTabIndicator');
    if(awInd){
      awInd.insertAdjacentHTML('beforebegin', SITE_CATEGORIES.map(function(c){
        return '<button class="awTabBtn" id="awTab_'+esc(c.slug)+'" role="tab" aria-selected="false"'+
               ' onclick="awSwitchTab(\''+esc(c.slug)+'\')">'+esc(c.label)+'</button>';
      }).join(''));
    }
  }
  /* Every container above is parsed earlier in the document than this
     script, so paint synchronously rather than waiting for
     DOMContentLoaded — the tab-strip indicator is measured by a later
     DOMContentLoaded handler and must find the tabs already in place. */
  buildCategoryUI();
  function restoreScroll(){
    /* FIX: list now includes every overlay that locks body scroll —
       notifPage, admPage and zeoPage were
       missing, so closing any other panel while one of them was open
       silently re-enabled background scrolling behind it.
       FIX 2: frdPage (Friends) and bmPage (Bookmarks/Likes) also lock
       scroll and were missing from this list.
       FIX 3: rankPage (full ranking) locks scroll too — without it,
       closing any other panel while the ranking page was open would
       silently re-enable scrolling of the home page behind it.
       FIX 4: pfUpMod is a full PAGE now (nav ➕ destination) and
       locks scroll in openPfUpload() — it must sit in this list or
       closing any other panel while the upload page is open would
       re-enable background scrolling behind it. */
    /* FIX 5: albPage (Settings ▸ Albums) and albViewPage (one album's
       contents) both lock scroll — without them, closing any other
       panel while an album is open would re-enable scrolling behind it. */
    var locks=['fg','artModal','communityPage','adsPanel','legalBackdrop','subPage','profilePage','pfEditPage','pfMyWorkPage','authMod','notifPage','admPage','zeoPage','frdPage','bmPage','xpPage','setPage','rankPage','pfUpMod','albPage','albViewPage','tgMod'];
    var anyOpen=locks.some(function(id){
      var el=document.getElementById(id);
      return el&&(el.classList.contains('open')||el.getAttribute('data-state')==='open');
    });
    if(!anyOpen){ document.body.style.overflow=''; document.documentElement.style.overflow=''; }
  }

  /* ═══════════════════════════════════════════════════════════════
     MERGED ARTWORKS TABLE
     ───────────────────────────────────────────────────────────────
     Everything lives in `artworks`. Rows carry kind='art'; the legacy
     kind='comic' rows left over from the retired ComicArts feature are
     filtered out of every query below, so they stay dormant in the DB
     rather than surfacing as broken cards. An artwork with several
     images keeps them in `pages` (see avBuildStrip). ── */
  var ART_KIND_ART = 'art';

  /* ══ Offline data snapshots ═══════════════════════════════
     localStorage copies (≈50 items per section) saved on every
     successful load and served back when the network is gone, so
     the site stays browsable offline. Image files themselves are
     cached by /sw.js (top-50 thumbnails prefetched on launch,
     last-50 clicked artworks cached on view). */
  var DZC_PREFIX = 'dzc1:';
  function dzcSet(key, val){
    try{ localStorage.setItem(DZC_PREFIX+key, JSON.stringify({t:Date.now(), v:val})); }
    catch(e){ /* quota — offline copies are best-effort */ }
  }
  function dzcGet(key){
    try{
      var r = JSON.parse(localStorage.getItem(DZC_PREFIX+key) || 'null');
      return (r && r.v) || null;
    }catch(e){ return null; }
  }
  /* Warm the top-50 grid thumbnails through the service worker at
     idle priority — one at a time so it never competes with the
     page's own image loads. */
  function dzcPrefetchThumbs(list){
    if(!('serviceWorker' in navigator)) return;
    var urls = (list||[]).slice(0,50)
      .map(function(a){ return getThumbnailUrl(a.image_url); })
      .filter(function(u){ return typeof u === 'string' && u.indexOf('http') === 0; });
    var i = 0;
    function next(){
      if(i >= urls.length) return;
      var u = urls[i++];
      try{ fetch(u, { mode:'no-cors' }).then(next, next); }
      catch(e){ next(); }
    }
    if('requestIdleCallback' in window) requestIdleCallback(next, { timeout: 4000 });
    else setTimeout(next, 2500);
  }

  async function loadDB(){
    if(!sb)return;
    try{
      /* Public-facing load — the status:'approved' filter is kept
         as a defensive guard even though every upload now inserts
         as 'approved' directly. */
      const{data:imgs}=await sb.from('artworks').select('*').eq('status','approved').eq('kind',ART_KIND_ART).order('created_at',{ascending:false});
      images=imgs||[];
      if(images.length){
        /* offline snapshot: top 50, trimmed to the fields renderers use */
        dzcSet('artworks', images.slice(0,50).map(function(a){
          return { id:a.id, name:a.name, image_url:a.image_url,
                   thumb_x:a.thumb_x, thumb_y:a.thumb_y, thumb_zoom:a.thumb_zoom,
                   category:a.category, tags:a.tags||null, kind:a.kind,
                   status:a.status, created_at:a.created_at,
                   user_id:a.user_id||null, description:a.description||null,
                   software:a.software||null, pages:a.pages||null };
        }));
        dzcPrefetchThumbs(images); /* warm top-50 thumbs into sw.js cache */
      }
    }catch(e){
      console.error(e);
      /* offline → serve the saved copy so the gallery still shows */
      var cached = dzcGet('artworks');
      if(cached && cached.length && !images.length){
        images = cached;
        showToast('Offline \u2014 showing saved artworks \u2726');
      }
    }
  }

  /* ── Responsive image sizing (AWS Dynamic Image Transformation) ──────
     Full-size originals live in S3 behind CloudFront. A second CloudFront
     distribution — the "Dynamic Image Transformation for CloudFront"
     solution — resizes and re-encodes on the fly via Thumbor-style URLs:

       https://<DIT_HOST>/fit-in/<W>x0/filters:format(webp):quality(<Q>)/<key>

     where <key> is the object path in the source bucket (e.g.
     koe-media/artworks/<id>/<file>.png). We serve a small WebP for grid
     thumbnails and a medium WebP in the viewer; Download always uses the
     untouched original (its stored URL, which we never rewrite).

     DIT_HOST is your image-resizer distribution. Override it in config.js
     with window.KOE_CONFIG.DIT_HOST if it ever changes. */
  var DIT_HOST = (window.KOE_CONFIG && window.KOE_CONFIG.DIT_HOST) || 'https://d1l8dn7jegdgem.cloudfront.net';
  var DIT_HOSTNAME = '';
  try{ DIT_HOSTNAME = new URL(DIT_HOST).hostname; }catch(e){}

  function imgResize(url, width, quality){
    if(!url || typeof url !== 'string') return url;
    var u;
    try{ u = new URL(url); }catch(e){ return url; }        /* data:/blob:/relative → leave alone */
    if(DIT_HOSTNAME && u.hostname === DIT_HOSTNAME) return url; /* already a resizer URL */
    /* Supabase Storage objects can't be read by DIT (which reads from the
       S3 source bucket), so leave those old URLs untouched. */
    if(u.hostname.endsWith('.supabase.co')) return url;
    var key = u.pathname.replace(/^\/+/, '');              /* S3 object key */
    if(!key) return url;
    return DIT_HOST.replace(/\/$/,'') + '/fit-in/' + width + 'x0/filters:format(webp):quality(' + quality + ')/' + key;
  }
  /* Grid thumbnail — small + low quality to minimise egress cost. */
  function getThumbnailUrl(url){ return imgResize(url, 300, 55); }
  /* Lightbox viewing size — modest + low quality (full original is on Download). */
  function getViewUrl(url){ return imgResize(url, 1000, 68); }
  /* Download = the untouched original. Stored URLs are already originals,
     so just return them (strip any stray query string as a safeguard). */
  function getFullUrl(url){
    if(!url || typeof url !== 'string') return url;
    try{ var u = new URL(url); u.search=''; return u.toString(); }
    catch(e){ return url; }
  }

  function itemHTML(img){
    /* FIX(A1): resize FIRST, escape AFTER. esc() ran before getThumbnailUrl,
       so a source URL containing & or quotes got HTML-entity-mangled inside
       the CloudFront resize path → broken thumbnail. esc() is for embedding
       the finished URL in the attribute, matching every other card builder. */
    const thumbSrc=esc(getThumbnailUrl(img.image_url||''));
    /* thumbStyle handles the null/NaN fallbacks AND the optional
       thumb_zoom transform in one place — same markup as every
       other thumbnail surface. */
    const thumbPos=thumbStyle(img.thumb_x, img.thumb_y, img.thumb_zoom);
    const fullSrc=esc(img.image_url);
    const cats=catList(img.category).length?catList(img.category):['others'];
    const extraCats=cats.slice(1);
    const moreBadge=extraCats.length?`<span class="cBadgeMore" tabindex="0" role="text" aria-label="Also tagged: ${esc(extraCats.join(', '))}" title="${esc(extraCats.join(', '))}">+${extraCats.length}</span>`:'';
    const idStr=esc(String(img.id));
    /* alt text falls back to artwork title for image search */
    const altText=esc(img.name||'Untitled artwork');
    /* Multi-image marker — mirrors the stacked-frames convention so the
       grid hints that there's more than one image behind this card. */
    let pgs=img.pages;
    if(typeof pgs==='string'){ try{ pgs=JSON.parse(pgs); }catch(e){ pgs=null; } }
    const extraCount=Array.isArray(pgs)?pgs.length:0;
    const multiBadge=extraCount?`<span class="gMulti" aria-label="${extraCount+1} images">⧉ ${extraCount+1}</span>`:'';
    /* Wrap item in a crawlable <a href="/artwork/{id}"> — JS intercepts clicks for modal UX */
    return`<div class="gItem" data-id="${idStr}" data-fullsrc="${fullSrc}" data-name="${altText}" data-cat="${esc(cats[0]||'')}" data-desc="${esc(img.description||'')}">
      <a class="gItemLink" href="/artwork/${idStr}" onclick="return handleArtClick(event,'${idStr}')" aria-label="View ${altText}">
        <div class="cBadgeWrap"><span class="cBadge">${esc(cats[0]||'others')}</span>${moreBadge}</div>${multiBadge}
        <img src="${thumbSrc}" alt="${altText}" loading="lazy" decoding="async" itemprop="contentUrl" style="${thumbPos}" onload="this.classList.add('imgDone')" onerror="this.classList.add('imgDone')">
        <div class="gOv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
        <div class="gNm" itemprop="name">${esc(img.name)}</div>
      </a>
    </div>`;
  }


  /* ── Shared sort utility — TRENDING first (replaces most-liked) ──
     Score  = (views × 1) + (bookmarks × 8) + (downloads × 6)
     Final  = Score / (age_in_hours + 2) ^ 1.35
     view_count / bookmark_count / download_count are denormalized,
     trigger-guarded counters on `artworks`, so the client just reads them.
     The age-decay divisor means a fresh post with strong engagement can
     outrank an old post with a huge raw view total — and stale posts sink
     unless people keep engaging. `now` is passed in (snapshotted once per
     sort) so the comparator stays internally consistent mid-sort.
     Ties fall back to newest, then id, so ordering is always deterministic
     (ids are uuids, so they're compared as strings, not parseInt'd). */
  function trendingScore(a, now){
    var v=parseInt(a.view_count,10)||0,
        b=parseInt(a.bookmark_count,10)||0,
        d=parseInt(a.download_count,10)||0;
    var base=(v*1)+(b*8)+(d*6);
    var t=a.created_at?new Date(a.created_at).getTime():0;
    /* Missing timestamp → treat as a year old so it can't fake-trend */
    var ageH=t?Math.max(0,(now-t)/3600000):(365*24);
    return base/Math.pow(ageH+2,1.35);
  }
  function sortByTrending(arr){
    var now=Date.now();
    return arr.sort(function(a,b){
      var sA=trendingScore(a,now), sB=trendingScore(b,now);
      if(sB!==sA) return sB-sA;
      var tA=a.created_at?new Date(a.created_at).getTime():0;
      var tB=b.created_at?new Date(b.created_at).getTime():0;
      if(tB!==tA) return tB-tA;
      var iA=String(a.id||''), iB=String(b.id||'');
      return iA<iB?1:(iA>iB?-1:0);
    });
  }

  /* ── Shared sort utility — newest first, id as tie-breaker.
     Used by the "Latest" tab / "Latest" gallery sort, which deliberately
     bypass the most-liked default so brand-new posts stay discoverable. ── */
  function sortByNewest(arr){
    return arr.sort(function(a,b){
      var tA=a.created_at?new Date(a.created_at).getTime():0;
      var tB=b.created_at?new Date(b.created_at).getTime():0;
      if(tB!==tA)return tB-tA;
      var iA=String(a.id||''), iB=String(b.id||'');
      return iA<iB?1:(iA>iB?-1:0);
    });
  }

  function renderHome(){
    /* Sort by TRENDING before rendering (was most-liked-first). The gallery
       carousels below read from this same `images` array, so every category
       row inherits the same trending order — each category is then a
       mini-ranking of trending posts inside that category only. */
    sortByTrending(images);
    /* Rebuild all gallery carousels from current images array */
    if(window.rebuildGalCarousels) window.rebuildGalCarousels(images);
    const g=document.getElementById('homeGrid');
    if(g) g.innerHTML = images.map(itemHTML).join('');
  }

  /* ── Column-aware batch sizes — shared by every artwork grid ──
     The unified responsive grid is 2 columns on phones, 3 from
     700px, 4 from 1280px (see .fgGrid/.awGrid/.pfGridArt CSS).
     Batches follow the layout so every append lands as whole rows:
       4-col → 16 first, then 8   (4 rows, then 2)
       3-col → 12 first, then 6   (4 rows, then 2)
       2-col → 10 first, then 4   (5 rows, then 2)
     Sizes are read at call time, so rotating a tablet or resizing
     the window simply changes the NEXT batch — nothing re-renders. */
  function gridCols(){
    var w = window.innerWidth || document.documentElement.clientWidth || 1280;
    return w >= 1280 ? 4 : (w >= 700 ? 3 : 2);
  }
  function gridInitialBatch(){ var c = gridCols(); return c === 4 ? 16 : (c === 3 ? 12 : 10); }
  function gridStepBatch(){    var c = gridCols(); return c === 4 ?  8 : (c === 3 ?  6 :  4); }

  /* ── Shared infinite-scroll sentinel ──
     Wraps one IntersectionObserver around a trip-wire element; when
     it comes within 700px of the viewport (or of `rootEl`, for
     overlays that scroll themselves like #fg / #profilePage), onHit
     appends the next batch. recheck() matters: after an append the
     sentinel may STILL be inside the viewport, and an observer only
     fires on threshold CROSSINGS — re-observing forces the spec's
     initial delivery, so short content keeps filling until the
     sentinel is genuinely pushed out of range. Fallback for
     museum-piece browsers is a passive scroll listener doing the
     same proximity test. */
  function makeGridSentinel(rootEl, onHit, existingEl){
    var sent = existingEl || document.createElement('div');
    if(!existingEl){
      sent.className = 'igSentinel';
      sent.setAttribute('aria-hidden','true');
    }
    var io = null, fb = null;
    if('IntersectionObserver' in window){
      io = new IntersectionObserver(function(entries){
        for(var i = 0; i < entries.length; i++){
          if(entries[i].isIntersecting){ onHit(); break; }
        }
      }, { root: rootEl || null, rootMargin: '700px 0px' });
      io.observe(sent);
    } else {
      fb = function(){
        if(sent.style.display === 'none' || !sent.parentNode) return;
        var r = sent.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        if(r.top < vh + 700) onHit();
      };
      (rootEl || window).addEventListener('scroll', fb, { passive: true });
    }
    return {
      el: sent,
      /* Force the observer to re-evaluate — call after every append. */
      recheck: function(){
        if(io){ io.unobserve(sent); io.observe(sent); }
        else if(fb){ fb(); }
      },
      /* One-shot grids (fg / aw rebuild per render) destroy;
         static sentinels (profile) just hide + recheck instead. */
      destroy: function(){
        if(io){ io.disconnect(); io = null; }
        if(fb){ (rootEl || window).removeEventListener('scroll', fb); fb = null; }
        if(sent.parentNode) sent.parentNode.removeChild(sent);
      }
    };
  }

  /* ── Gallery pagination state ──
     fgList: the current filtered+sorted list backing the grid.
     fgVisible: how many of those are in the DOM.
     First batch renders immediately on open; scrolling appends the
     rest automatically — no Load More button. */
  var fgVisible = 0;
  var fgList = [];
  var fgSent = null;

  /* Merit gates are enforced by RLS, so a blocked action comes back as a
     generic row-level-security error. Translate it into something the user
     can actually act on, instead of a vague "failed". */
  window.MERIT_GATES = { upload:80, chat:60, like:40 };
  window.meritDenied = function(err, action){
    if(!err) return false;
    var msg = (err.message || '') + ' ' + (err.code || '');
    if(!/row-level security|violates row-level|42501/i.test(msg)) return false;
    var t = { upload:'Your merit is below 80 — uploads are paused until it recovers (+2/day).',
              chat:'Your merit is 60 or below — community chat is paused until it recovers (+2/day).',
              like:'Your merit is 40 or below — likes and bookmarks are paused until it recovers (+2/day).' };
    if(typeof showToast === 'function') showToast(t[action] || 'Action blocked by your merit score');
    return true;
  };

  /* ── Per-user hidden artworks ("Hide this artwork from my feed") ──
     Backed by public.hidden_artworks (own-rows-only via RLS). Kept as an
     in-memory Set so the render path stays synchronous. Loaded on session
     restore and on sign-in; cleared on sign-out (a signed-out visitor has
     no hide list, so nothing is filtered). */
  var hiddenArtworks = new Set();

  async function loadHiddenArtworks(){
    hiddenArtworks = new Set();
    if(!sb || !currentUser) return;
    try{
      var r = await sb.from('hidden_artworks').select('artwork_id')
        .eq('user_id', currentUser.id).limit(2000);
      (r.data || []).forEach(function(row){ hiddenArtworks.add(String(row.artwork_id)); });
    }catch(e){ /* offline → nothing hidden, fail open rather than blanking the feed */ }
  }

  /* Drop hidden artworks from any list about to be rendered. */
  function filterHidden(list){
    if(!hiddenArtworks.size) return list;
    return (list || []).filter(function(a){ return !hiddenArtworks.has(String(a.id)); });
  }

  /* Called by the report modal after a successful hide. */
  window.markArtworkHidden = function(id){
    hiddenArtworks.add(String(id));
    try{ renderHome(); }catch(e){}
    try{ if(typeof renderFG === 'function') renderFG(); }catch(e){}
  };

  function renderFG(){
    _renderFGPage();
  }

  function _renderFGPage(){
    /* The query lives on the in-bar field now — the .fgHdr row that
       owned #fgQ was removed when the gallery gained section tabs. */
    const _fgIn=document.getElementById('fgSearchIn');
    const q=(_fgIn?_fgIn.value:'').toLowerCase().trim();
    const c=document.getElementById('fgC');
    let imgs=filterHidden([...images]);
    if(filterCat!=='all')imgs=imgs.filter(i=>(catList(i.category).length?catList(i.category):['others']).includes(filterCat));
    if(q)imgs=imgs.filter(i=>(i.name||'').toLowerCase().includes(q));

    /* ── Sort. 'trending' (default) = trending score high → low, applied to
       every category alike (each category filter yields its own mini-ranking).
       'new'/'old' remain available from the filter panel.
       Guards against null timestamps; id tie-breaker keeps ordering
       deterministic when two items share the same created_at. ── */
    if(filterSrt==='trending'){
      sortByTrending(imgs);
    } else {
      imgs.sort(function(a,b){
        var tA=a.created_at?new Date(a.created_at).getTime():0;
        var tB=b.created_at?new Date(b.created_at).getTime():0;
        var diff=filterSrt==='new'?(tB-tA):(tA-tB);
        if(diff!==0)return diff;
        /* FIX(A2): ids are uuids — parseInt always gave 0, so the tie-breaker
           never fired and equal-timestamp items shuffled between renders.
           Compare as strings, mirroring sortByNewest/sortByTrending. */
        var iA=String(a.id||''), iB=String(b.id||'');
        if(iA===iB) return 0;
        var asc = iA<iB ? -1 : 1;
        return filterSrt==='new' ? -asc : asc;
      });
    }

    /* Any prior sentinel belongs to a grid we're about to throw away */
    if(fgSent){ fgSent.destroy(); fgSent = null; }
    fgList = imgs;

    if(!imgs.length){c.innerHTML='<div class="fgEmp">NO ARTWORK FOUND</div>';_fgSyncFilterBtn();return;}

    /* First batch paints immediately; the rest streams in as the
       user scrolls (fgAppendBatch via the sentinel below).
       IMPORTANT: fgVisible is PRESERVED across re-renders — renderFG
       fires mid-session after likes/edits/deletes while the user may
       be scrolled deep into the grid, and collapsing back to the
       first batch would yank their scroll position. Only openFG /
       applyFilters zero it for a genuine fresh start. */
    fgVisible = Math.min(Math.max(gridInitialBatch(), fgVisible||0), imgs.length);
    c.innerHTML = `<div class="fgGrid" id="fgGridEl">${imgs.slice(0, fgVisible).map(itemHTML).join('')}</div>`;

    if(fgVisible < imgs.length){
      /* #fg is the scroll container (overflow-y:auto), so it is the
         observer root — viewport intersection would never fire while
         the overlay pans in from the right. */
      fgSent = makeGridSentinel(document.getElementById('fg'), fgAppendBatch);
      c.appendChild(fgSent.el);
    }
    _fgSyncFilterBtn();
  }

  /* Append the next column-sized batch into the EXISTING grid —
     never a full re-render, so already-decoded images don't flicker
     and the scroll position never moves. */
  function fgAppendBatch(){
    var grid = document.getElementById('fgGridEl');
    if(!grid || fgVisible >= fgList.length) return;
    var next = fgList.slice(fgVisible, fgVisible + gridStepBatch());
    fgVisible += next.length;
    grid.insertAdjacentHTML('beforeend', next.map(itemHTML).join(''));
    if(fgVisible >= fgList.length){
      if(fgSent){ fgSent.destroy(); fgSent = null; }
    } else if(fgSent){
      fgSent.recheck();
    }
  }
  /* Keep the filter button's "active" dot in sync with current sort/category. */
  function _fgSyncFilterBtn(){
    const isFiltered=(filterCat!=='all'||filterSrt!=='trending');
    const btn=document.getElementById('fgFltBtn');
    if(btn)btn.classList.toggle('active',isFiltered);
  }

  function openFilterPanel(){
    /* Artworks mode — show the category/sort body, hide the generic one. */
    fgFltMode = 'artworks';
    var _t=document.getElementById('fltPTitle'); if(_t) _t.textContent='FILTERS';
    var _a=document.getElementById('fltArtBody'); if(_a) _a.style.display='';
    var _s=document.getElementById('fltSecBody'); if(_s) _s.style.display='none';
    /* Sync radio buttons to current state before opening */
    var catR=document.querySelector('input[name="fltCat"][value="'+filterCat+'"]');
    if(catR)catR.checked=true;
    var srtR=document.querySelector('input[name="fltSrt"][value="'+filterSrt+'"]');
    if(srtR)srtR.checked=true;
    document.getElementById('fgFltOvr').classList.add('open');
    document.getElementById('fgFltPanel').classList.add('open');
  }
  function closeFilterPanel(){
    document.getElementById('fgFltOvr').classList.remove('open');
    document.getElementById('fgFltPanel').classList.remove('open');
  }
  function applyFilters(){
    /* One DONE button, two panels — hand off when a stub section owns
       the panel, otherwise fall through to the artwork category/sort. */
    if(fgFltMode!=='artworks'){ applySecFilter(); return; }
    var catR=document.querySelector('input[name="fltCat"]:checked');
    var srtR=document.querySelector('input[name="fltSrt"]:checked');
    filterCat=catR?catR.value:'all';
    filterSrt=srtR?srtR.value:'trending';
    fgVisible=0; /* filters changed — restart from the first batch */
    closeFilterPanel();
    renderFG();
  }
  function openFG(){
    document.getElementById('fg').classList.add('open');
    document.body.style.overflow='hidden';
    fgSwitchSection('artworks'); /* every open lands on Artworks */
    fgVisible=0; /* fresh open — start from the first batch */
    renderFG();
  }

