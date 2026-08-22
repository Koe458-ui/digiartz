// supabase and s3 helpers, loaders

  // config.js defines window.KOE_CONFIG
  const SB_URL = (window.KOE_CONFIG && window.KOE_CONFIG.SB_URL) || '';
  const SB_KEY = (window.KOE_CONFIG && window.KOE_CONFIG.SB_KEY) || '';

  // admin role from profiles.role
  const BUCKET   = 'koe-media';
  const S3_FN_URL = (window.KOE_CONFIG && window.KOE_CONFIG.S3_FN_URL) || '';

  // s3 upload and delete
  // s3 key sanitizer
  function safeSlug(str, maxLen){
    var s = String(str || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')  // fold accents
      .replace(/[^a-zA-Z0-9]+/g, '_')                    // non alnum to underscore
      .replace(/_+/g, '_')                               // collapse repeats
      .replace(/^_+|_+$/g, '');                          // trim edges
    if(!s) s = 'untitled';
    return s.slice(0, maxLen || 60);
  }
  async function s3AuthHeader(){
    if(!sb) throw new Error('Backend not configured');
    const{data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Sign in required');
    return 'Bearer '+session.access_token;
  }
  // opts.private asks the signer for an object in the private bucket instead of
  // the public one, and comes back with no url — the only file that wants this
  // is a marketplace product file, whose whole value is that holding its url
  // does not mean holding the goods. Non-images only; the signer ignores it
  // otherwise, since an image already puts its original out of public reach.
  async function s3Upload(bucket, path, file, opts){
    if(!S3_FN_URL) throw new Error('Storage endpoint not configured (S3_FN_URL missing in config.js)');
    const auth = await s3AuthHeader();
    const key = bucket+'/'+path;
    const wantPrivate = !!(opts && opts.private);
    // step 1, presigned put url
    let signRes;
    try{
      signRes = await fetch(S3_FN_URL, {
        method:'POST',
        headers:{'content-type':'application/json', 'authorization':auth},
        // derivatives tells the signer which sizes this build knows how to
        // produce. Without it the signer assumes the pre-t600 set, because a
        // target we cannot derive for is worse than a missing one: the loop in
        // sbUploadTargets falls through to `body = file` on an unrecognised
        // role and would PUT the untouched original under a thumbnail's name.
        body: JSON.stringify({
          action:'upload', path:key, contentType:file.type, size:file.size,
          derivatives: Object.keys(DERIVE_SPEC),
          visibility: wantPrivate ? 'private' : 'public'
        })
      });
    }catch(e){
      throw new Error('Could not reach the upload service — check S3_FN_URL and the edge function\u2019s CORS');
    }
    const signJson = await signRes.json().catch(function(){return{};});
    if(!signRes.ok) throw new Error(signJson.error || ('Upload authorization failed ('+signRes.status+')'));

    // Supabase Storage when the signer offers it, S3 when it does not. The
    // signer returns both shapes during the migration, so this works against
    // either version of it and there is no deploy-order trap.
    if(Array.isArray(signJson.targets) && signJson.targets.length){
      await sbUploadTargets(signJson.targets, file);
      // Where it actually landed, reported by the signer rather than assumed
      // here. This matters for a private upload: an older signer that has not
      // learned the flag yet signs the public bucket and says so, and a caller
      // that recorded its own guess instead would write a path pointing at a
      // bucket the object is not in. Deploy order stays a non-event.
      if(opts){
        var landed = null;
        for(var ti=0; ti<signJson.targets.length; ti++){
          if(signJson.targets[ti].role === 'file' || signJson.targets[ti].role === 'original'){
            landed = signJson.targets[ti]; break;
          }
        }
        opts.landed = landed
          ? { bucket: landed.bucket || BUCKET, path: landed.path || path }
          : { bucket: BUCKET, path: path };
      }
      // a private upload has no public url to hand back, and saying so with
      // null is the point — a caller that stores it stores nothing useful
      if(wantPrivate) return signJson.private === false ? (signJson.supabasePublicUrl || null) : null;
      return signJson.supabasePublicUrl || signJson.publicUrl;
    }
    if(wantPrivate) throw new Error('This upload service cannot store private files yet');

    if(!signJson.uploadUrl) throw new Error('Upload service returned no uploadUrl');
    // step 2, put to s3
    let putRes;
    try{
      putRes = await fetch(signJson.uploadUrl, {method:'PUT', headers:{'content-type':file.type}, body:file});
    }catch(e){
      throw new Error('Upload blocked by the storage server — add this site\u2019s origin with PUT to the S3 bucket\u2019s CORS policy');
    }
    if(!putRes.ok) throw new Error('Upload failed ('+putRes.status+') — presigned URL rejected by S3');
    return signJson.publicUrl;
  }

  // Downscale in the browser. Sizes are generated once here rather than resized
  // per request, because Supabase image transformations are a paid-plan feature
  // and this has to work without one. Never upscales: a small source is just
  // re-encoded at its own width, which keeps the filename contract intact so
  // every size a caller asks for actually exists.
  async function imgDerive(file, maxWidth, quality){
    var bmp;
    try{
      bmp = await createImageBitmap(file);
    }catch(e){
      bmp = await new Promise(function(res, rej){
        var url = URL.createObjectURL(file), im = new Image();
        im.onload  = function(){ URL.revokeObjectURL(url); res(im); };
        im.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('Could not decode image')); };
        im.src = url;
      });
    }
    var sw = bmp.width || bmp.naturalWidth, sh = bmp.height || bmp.naturalHeight;
    if(!sw || !sh) throw new Error('Could not read image size');
    var scale = Math.min(1, maxWidth / sw);
    var w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, w, h);
    if(bmp.close) try{ bmp.close(); }catch(e){}
    var blob = await new Promise(function(res){ cv.toBlob(res, 'image/webp', quality); });
    // a browser that cannot encode webp hands back null or another type
    if(!blob || blob.type !== 'image/webp'){
      blob = await new Promise(function(res){ cv.toBlob(res, 'image/jpeg', quality); });
    }
    if(!blob) throw new Error('Could not encode image');
    return blob;
  }

  // The sizes imgResize() can ask for. Widths match its thresholds, and the
  // qualities are the ones the retired resizer used, so images uploaded now
  // look like the ones migrated out of it.
  //
  // t600 is the odd one out: it was added after the migration because t300 was
  // the only grid size and the grid is not 300px wide on a desktop. .fgGrid
  // runs four columns across the full viewport, so a 1920px screen lays each
  // cell out at ~480 CSS px and the 300px file was being upscaled 1.6x — worse
  // on a high-DPI panel. Its quality is a shade below t300's because artefacts
  // are less visible the more pixels you spread them over.
  var DERIVE_SPEC = {
    t300:  { width: 300,  quality: 0.55 },
    t600:  { width: 600,  quality: 0.52 },
    v1000: { width: 1000, quality: 0.68 },
    f1600: { width: 1600, quality: 0.82 }
  };

  // PUT each signed target. The original goes up untouched; every other target
  // is a derivative generated here first.
  async function sbUploadTargets(targets, file){
    for(var i=0;i<targets.length;i++){
      var t = targets[i];
      var body = file, type = file.type;
      if(t.role && DERIVE_SPEC[t.role]){
        var spec = DERIVE_SPEC[t.role];
        body = await imgDerive(file, spec.width, spec.quality);
        type = body.type || 'image/webp';
      }
      var res;
      try{
        res = await fetch(t.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': type, 'x-upsert': 'true' },
          body: body
        });
      }catch(e){
        throw new Error('Upload blocked by storage, check the bucket CORS policy');
      }
      if(!res.ok){
        var detail = await res.text().catch(function(){ return ''; });
        throw new Error('Upload failed ('+res.status+') on '+(t.role||'file')+(detail?': '+detail.slice(0,120):''));
      }
    }
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

  // ── media bookkeeping ────────────────────────────────────────────────────
  // Every upload button gets its own table. The site still reads the flat
  // columns (artworks.image_url, profiles.avatar_url, resources.file_url …);
  // these rows are the structured record beside them, so nothing here may ever
  // fail a publish that has already succeeded. Every call is fail-soft.
  //
  // parent   the owning row's id column, null for the two profile tables which
  //          are keyed on the user and therefore upserted instead of inserted
  // url      true for the image tables, which also carry width/height. The file
  //          tables carry original_filename instead and have no url: what they
  //          point at is not public.
  var DZ_MEDIA = {
    artworkImage : { table:'artwork_image',        parent:'artwork_id',  url:true  },
    artworkFile  : { table:'artwork_file',         parent:'artwork_id',  url:false },
    resourceImage: { table:'resources_image',      parent:'resource_id', url:true  },
    resourceFile : { table:'resources_file',       parent:'resource_id', url:false },
    marketImage  : { table:'marketplace_image',    parent:'item_id',     url:true  },
    marketFile   : { table:'marketplace_file',     parent:'item_id',     url:false },
    blogImage    : { table:'blog_image',           parent:'post_id',     url:true  },
    avatar       : { table:'profile_image',        parent:null,          url:true, onConflict:'user_id' },
    banner       : { table:'profile_banner_image', parent:null,          url:true, onConflict:'user_id' }
  };

  // Where an upload actually landed, worked out from the url s3Upload handed
  // back rather than guessed from the filename. An image becomes four objects
  // (the untouched original in koe-originals, three sizes in koe-media);
  // anything else becomes one public object. The __f1600 suffix is the tell.
  function dzUploadTargets(uploadedUrl, uploadPath, isPrivate){
    var isImg = /__f1600\.webp$/.test(uploadedUrl || '');
    var base  = String(uploadPath || '').replace(/\.[a-z0-9]+$/i, '');
    // a private non-image landed in koe-originals and has no url at all, so
    // there is no image half to record and no link to record beside it
    if(isPrivate && !isImg){
      return { image: null, file: { bucket:'koe-originals', path: uploadPath } };
    }
    return isImg
      ? { image: { bucket:'koe-media',     path: base + '__f1600.webp', url: uploadedUrl },
          file:  { bucket:'koe-originals', path: uploadPath } }
      : { image: null,
          file:  { bucket:'koe-media',     path: uploadPath, url: uploadedUrl } };
  }

  // best effort, never throws: dimensions are nice to have, not worth a failure
  async function dzImgDims(blob){
    try{
      if(!blob || !/^image\//.test(blob.type || '')) return {};
      var bmp = await createImageBitmap(blob);
      var d = { width: bmp.width, height: bmp.height };
      if(bmp.close) try{ bmp.close(); }catch(e){}
      return d;
    }catch(e){ return {}; }
  }

  async function dzRecordMedia(kind, opts){
    try{
      var spec = DZ_MEDIA[kind];
      if(!spec || !sb || !currentUser || !opts || !opts.path) return false;
      if(spec.parent && !opts.parentId) return false;

      var row = {
        user_id: currentUser.id,
        storage_bucket: opts.bucket || 'koe-media',
        storage_path: opts.path,
        mime: (opts.file && opts.file.type) || opts.mime || null,
        bytes: (opts.file && typeof opts.file.size === 'number') ? opts.file.size
             : (typeof opts.bytes === 'number' ? opts.bytes : null)
      };
      if(spec.parent) row[spec.parent] = opts.parentId;

      // position exists on every table except the two profile ones
      if(spec.parent) row.position = opts.position || 0;

      if(spec.url){
        row.url = opts.url || null;
        var d = await dzImgDims(opts.file);
        if(d.width)  row.width  = d.width;
        if(d.height) row.height = d.height;
      } else if(opts.file && opts.file.name){
        row.original_filename = String(opts.file.name).slice(0, 260);
      }

      var res = spec.onConflict
        ? await sb.from(spec.table).upsert(row, { onConflict: spec.onConflict })
        : await sb.from(spec.table).insert(row);
      if(res && res.error) throw res.error;
      return true;
    }catch(e){
      // bookkeeping must not sink a publish that already worked
      console.warn('media record failed (' + kind + '):', (e && e.message) || e);
      return false;
    }
  }

  // Record one uploaded asset into both halves it can occupy: the public image
  // table and the private file table. imageKind/fileKind may each be null when
  // that half does not apply to this upload button.
  async function dzRecordUpload(o){
    var t = dzUploadTargets(o.url, o.path, o.private);
    if(o.imageKind && t.image){
      await dzRecordMedia(o.imageKind, {
        parentId: o.parentId, bucket: t.image.bucket, path: t.image.path,
        url: t.image.url, file: o.file, position: o.position || 0
      });
    }
    if(o.fileKind && t.file){
      await dzRecordMedia(o.fileKind, {
        parentId: o.parentId, bucket: t.file.bucket, path: t.file.path,
        file: o.file, position: o.position || 0
      });
    }
  }


  // seo defaults from head
  var SITE_DEFAULT_TITLE = document.title;
  var SITE_DEFAULT_DESC  = (document.querySelector('meta[name="description"]')||{}).content || '';
  var SITE_DEFAULT_IMAGE = (document.querySelector('meta[property="og:image"]')||{}).content || '';

  let sb = null;

  // one way to say it, wherever the client failed to appear
  function dzNoBackend(why){
    console.error(why);
    var _sb = document.getElementById('sBanner');
    if(_sb){
      _sb.textContent = '\u26a0 Can\u2019t connect right now. Please refresh, or try again in a moment.';
      _sb.classList.add('show');
    }
  }

  if (SB_URL && SB_KEY) {
    /* This line used to be called bare, and it is the first thing in the file
       that depends on anything outside it. If the script defining
       createClient had not arrived — or it threw for any other reason — the
       throw landed here and took the rest of the file with it: the 62
       function declarations below hoisted and kept answering clicks, while
       the 20 let/const bindings under it, images and filterCat among them,
       stayed in the temporal dead zone and threw on every access. A page
       that renders, responds, and is dead underneath.
       sb stays null instead. That is a state the rest of the code already
       knows how to be in: of the 71 functions that touch it, 37 check it
       first and the rest reach it only inside a try. */
    try{
      sb = supabase.createClient(SB_URL, SB_KEY);
    }catch(e){
      dzNoBackend('Backend client could not be created: ' + ((e && e.message) || e));
    }
  } else {
    dzNoBackend('KOE_CONFIG missing SB_URL/SB_KEY \u2014 backend client not created.');
  }

  let images = [];
  let filterCat = 'all', filterSrt = 'trending';

  function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  // never show raw backend errors
  function safeErr(e, fallback){
    var m = (e && e.message) ? String(e.message) : '';
    var internal = /row-level security|violates|constraint|relation |column |permission denied|JWT|supabase|postgres|duplicate key|null value|schema cache|Failed to fetch|NetworkError|\b(42501|23505|23503)\b|PGRST/i;
    if(!m || internal.test(m)){
      if(m) console.error('Suppressed internal error:', m);
      return fallback;
    }
    return m;
  }
  // normalize category column
  // slugs hidden from the ui
  var CAT_HIDDEN = { 'ai-art':1 };
  // shared hidden check
  function catHidden(slug){ return !!CAT_HIDDEN[String(slug||'').trim()]; }
  function catList(val){
    var out = Array.isArray(val)
      ? val.map(function(c){return String(c).trim();})
      : String(val||'').split(',').map(function(c){return c.trim();});
    return out.filter(function(c){ return c && !CAT_HIDDEN[c]; });
  }

  // site categories
  // filter option icons
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
  // slug to label
  var CAT_LABELS = SITE_CATEGORIES.reduce(function(m,c){ m[c.slug]=c.label; return m; },{});
  function catLabel(slug){
    if(!slug) return '';
    if(CAT_LABELS[slug]) return CAT_LABELS[slug];
    return String(slug).replace(/-/g,' ').replace(/\b\w/g,function(ch){ return ch.toUpperCase(); });
  }

  // paint category driven ui
  function buildCategoryUI(){
    // 1. filter radios
    var fo = document.getElementById('fltCatOpts');
    if(fo){
      fo.insertAdjacentHTML('beforeend', SITE_CATEGORIES.map(function(c){
        return '<label class="fltOpt"><input type="radio" name="fltCat" value="'+esc(c.slug)+'">'+
               '<div class="fltDot"></div>'+fltIco(c.slug)+
               '<span class="fltLbl">'+esc(c.label.toUpperCase())+'</span></label>';
      }).join(''));
    }
    // 2. upload checkboxes
    var pp = document.getElementById('pfUpCatPanel');
    if(pp){
      pp.innerHTML = SITE_CATEGORIES.map(function(c){
        return '<label class="upCatOpt"><input type="checkbox" id="pfUpCat_'+esc(c.slug)+'" value="'+esc(c.slug)+'"'+
               (c.slug==='others'?' checked':'')+' onchange="updatePfCatDisplay()"/> '+esc(c.label)+'</label>';
      }).join('');
    }
  }
  // paint synchronously
  buildCategoryUI();
  /* One path segment, decoded, without throwing on a malformed escape.
     decodeURIComponent raises URIError on a lone '%' — which a hand-typed or
     truncated url supplies — and a throw here takes the whole boot sequence
     with it. The raw segment is the right fallback: it is what the readers
     that never decoded were using anyway. */
  function dzDecodeSeg(s){
    try{ return decodeURIComponent(String(s)); }catch(e){ return String(s); }
  }
  window.dzDecodeSeg = dzDecodeSeg;

  /* ── what a tier is allowed ────────────────────────────────────────────────
     One table, read by every gate that asks a size question, so a limit
     changes in one place and the panel, the picker and the hint cannot
     disagree about it.

     These are courtesies. The signer refuses the bytes and the row's own
     check constraint refuses the number, both without asking the browser —
     what this table decides is whether somebody is told before the upload or
     after it. Any limit that would matter if a client lied is enforced in
     supabase/functions/smart-function and in the migrations, not here.

     A dev sees Max's ceilings: the alternative is testing the paid path by
     buying it. */
  var DZ_TIER_LIMITS = {
    guest:   { image: 20, asset: 200 },
    lite:    { image: 20, asset: 200 },
    premium: { image: 20, asset: 200 },
    max:     { image: 25, asset: 400 },
    dev:     { image: 25, asset: 400 }
  };

  /* The tier this member is actually on, expiry included.
     userPlan in js/auth.js is profiles.subscription_tier as stored, and that
     column keeps saying 'max' after the subscription has run out — the server
     reads dz_effective_tier() precisely because the raw column is not the
     answer. The expiry is read alongside it there and parked here, so every
     client-side gate asks this rather than the column. */
  var dzPlanTier = 'guest', dzPlanExpires = 0;
  function dzSetPlan(tier, expiresAt){
    dzPlanTier = String(tier || 'guest');
    var t = expiresAt ? new Date(expiresAt).getTime() : 0;
    dzPlanExpires = isFinite(t) ? t : 0;
  }
  function dzTier(){
    if(dzPlanExpires && dzPlanExpires < Date.now()) return 'guest';
    return DZ_TIER_LIMITS[dzPlanTier] ? dzPlanTier : 'guest';
  }
  function dzLimits(){ return DZ_TIER_LIMITS[dzTier()] || DZ_TIER_LIMITS.guest; }
  /* the two questions every caller actually asks, in bytes and in whole MB */
  function dzImageMax(){ return dzLimits().image * 1024 * 1024; }
  function dzAssetMax(){ return dzLimits().asset * 1024 * 1024; }
  function dzImageMaxMb(){ return dzLimits().image; }
  function dzAssetMaxMb(){ return dzLimits().asset; }
  window.dzSetPlan    = dzSetPlan;
  window.dzTier       = dzTier;
  window.dzImageMax   = dzImageMax;
  window.dzAssetMax   = dzAssetMax;
  window.dzImageMaxMb = dzImageMaxMb;
  window.dzAssetMaxMb = dzAssetMaxMb;

  /* Every place that prints a ceiling into a sentence carries data-dz-mb, and
     is repainted whenever the tier lands or changes. The attribute names which
     ceiling — "image" or "asset" — and the element's text has exactly one
     number in it to replace, so buying Max changes 20 to 25 and changes
     nothing else about the sentence. */
  function dzPaintLimits(){
    var els = document.querySelectorAll('[data-dz-mb]');
    for(var i = 0; i < els.length; i++){
      var el = els[i];
      var mb = el.getAttribute('data-dz-mb') === 'asset' ? dzAssetMaxMb() : dzImageMaxMb();
      el.textContent = String(el.textContent).replace(/\d+(?=\s*MB)/i, mb);
    }
  }
  window.dzPaintLimits = dzPaintLimits;

  /* Resolves once every classic script in the page has run.
     This file is the third script tag; there are thirty-odd after it, and
     js/startup.js — which boots the page — is in the middle of them. Anything
     it calls that lives in a later file is only there if the parser has got
     that far, and an `await` hands control back to the parser mid-flight, so
     "later" is not a guarantee of "not yet". readyState leaves 'loading' at
     DOMContentLoaded, which is precisely the point the last script tag has
     executed. */
  function dzDomReady(){
    if(document.readyState !== 'loading') return Promise.resolve();
    return new Promise(function(res){
      document.addEventListener('DOMContentLoaded', function(){ res(); }, { once:true });
    });
  }
  window.dzDomReady = dzDomReady;

  /* ---- every panel this app can put on screen, in one table ---------------

     There were three lists of these ids, in two files, and each of them was a
     different partial answer to the same question — which panels are open on
     top of the page:

       restoreScroll's `locks`   who is holding the scroll lock
       NAV_OVER                  who hides the bottom nav
       OVERLAY_IDS (sections.js) who hides the floating widgets

     and a fourth answer, bnCloseAllSections in js/pfedit.js, was written out
     by hand as nine close() calls. That last one is where the bugs were. It
     predated the ranking board, the theme page, the artwork viewer, the item
     viewer, the album pages, Settings and every page Settings opens — so
     tapping Home with any of those up closed the section UNDER them and left
     the panel itself on screen, over the home page, with the nav lit up as if
     you were home. "I tap home and a section is still showing" is exactly
     that list of omissions.

     One table now, and a panel joins the app by being added to it once. The
     flags say what the panel does; `close` says how to shut it, by the name
     of the function that owns the closing, so this table never becomes a
     second implementation of a close.

       lock    holds the scroll lock while it is open
       nav     hides the bottom navigation bar
       widget  hides the floating widgets and the assistant bubble

     Order is the order the sweep shuts them in: a page that sits INSIDE
     another one comes first, so nothing is ever closed out from under a child
     that is still up. */
  var DZ_PANELS = [
    // small things over a section. Each of these four is a sheet or a
    // backdrop written at the top of the document rather than inside the
    // panel it belongs to, which is why they need shutting on their own: the
    // gallery closing does not take the filter sheet with it, because the
    // sheet is not inside the gallery.
    { id:'dlQuotaMod',      close:['dzQuotaClose'] },
    { id:'upqBackdrop',     close:['upqCloseModal'] },
    { id:'fgFltPanel',      close:['closeFilterPanel'] },
    { id:'fgFltOvr',        close:['closeFilterPanel'] },
    { id:'tgMod',           close:['tgModClose'],           lock:1 },
    { id:'legalBackdrop',   close:['closeLegal'],           lock:1, widget:1 },
    { id:'legalPage',       close:['closeLegalPage'],       lock:1, nav:1, widget:1 },
    { id:'showcasePicker',  close:['closeShowcasePicker'] },
    // search pages, each over the section it searches
    { id:'pfSearchPage',    close:['closePfSearch', true],           widget:1 },
    { id:'fgSearchPage',    close:['closeFgSearch', true],  lock:1,  widget:1 },
    { id:'cmSearchPage',    close:['cmCloseSearch'],        lock:1, nav:1, widget:1 },
    { id:'cmBrowsePage',    close:['cmCloseBrowse'],        lock:1, nav:1, widget:1 },
    { id:'cmInfoPage',      close:['cmiClose'],             lock:1, nav:1, widget:1 },
    { id:'frdPage',         close:['closeFriendsPage'],     lock:1, nav:1, widget:1 },
    // pages opened from a profile, from Settings, or from the quick links
    { id:'albViewPage',     close:['albCloseView'],         lock:1, nav:1, widget:1 },
    { id:'albPage',         close:['albClosePage'],         lock:1, nav:1, widget:1 },
    { id:'bmPage',          close:['closeBookmarksPage'],   lock:1, nav:1, widget:1 },
    { id:'anPage',          close:['closeAnalyticsPage'],   lock:1, nav:1, widget:1 },
    { id:'xpPage',          close:['closeXpPage'],          lock:1, nav:1, widget:1 },
    { id:'themePage',       close:['closeThemePage'],               nav:1, widget:1 },
    { id:'rankPage',        close:['closeRankPage'],        lock:1, nav:1, widget:1 },
    { id:'dzPanelHost',     close:['dzClosePanel'],         lock:1, nav:1, widget:1 },
    { id:'admPage',         close:['dzOpsClose'],           lock:1, nav:1, widget:1 },
    { id:'notifPage',       close:['closeNotifPage'],       lock:1, nav:1, widget:1 },
    { id:'pfMyWorkPage',    close:['closeMyWorkPage'],      lock:1, nav:1, widget:1 },
    { id:'pfEditPage',      close:['closePfEditPage'],      lock:1, nav:1, widget:1 },
    { id:'setPage',         close:['closeSettingsPage'],    lock:1, nav:1, widget:1 },
    { id:'subPage',         close:['closeSubscription'],    lock:1, nav:1, widget:1 },
    { id:'zeoPage',         close:['zeoCloseChat'],         lock:1 },
    /* The two item views. The artwork viewer's own close hands its address
       and its page title back, so it is used as it is; the item viewer's
       silent close is the one that leaves history alone, because a sweep is
       the first half of a move and the second half writes the address for
       wherever the member is going. Neither of them steps history back any
       more — that is the bug in the note on dzNavBegin below.

       The artwork viewer fades for 230ms before its class comes off, so it is
       still "open" when the move finishes. Nothing here waits for it: the
       address audit in js/routes.js runs again when the class does come off,
       which is exactly the kind of late close it exists for. */
    { id:'artModal',        close:['closeLB'],              lock:1, widget:1 },
    { id:'dzView',          close:['dzCloseViewSilent'],    lock:1, widget:1 },
    /* The work on the screen with nothing else on it, opened by clicking the
       picture in the viewer. A panel like any other: it holds the lock while
       it is up, it hides the floating widgets, and a sweep closes it — which
       matters, because it is the one panel that opens OVER another one, and
       leaving it standing over a swept viewer would leave a picture on the
       screen belonging to a section the member has left. */
    { id:'dzLight',         close:['dzLightClose'],         lock:1, widget:1 },
    // the five destinations the bottom nav leads to
    { id:'authMod',         close:['closeAuthMod'],         lock:1, widget:1 },
    { id:'pfUpMod',         close:['closePfUpload'],        lock:1, widget:1 },
    { id:'profilePage',     close:['closeProfilePage', false], lock:1, widget:1 },
    // The chat slides over the community grid and is written beside it rather
    // than inside it. closeCommunityPage resets it on the way out; listing it
    // here as well is what makes the sweep complete on its own terms — the
    // table is the answer to "what is on screen", and this is on screen.
    { id:'cmChatPanel',     close:['cmCloseChat'] },
    { id:'communityPage',   close:['closeCommunityPage'],   lock:1, widget:1 },
    { id:'fg',              close:['closeFG'],              lock:1, widget:1 }
  ];

  function dzPanelEl(id){ return document.getElementById(id); }
  function dzPanelIsOpen(el){
    return !!el && (el.classList.contains('open') ||
                    el.getAttribute('data-state') === 'open');
  }
  // The ids carrying one flag, for the watchers below and for js/sections.js.
  function dzPanelIds(flag){
    return DZ_PANELS.filter(function(p){ return !!p[flag]; })
                    .map(function(p){ return p.id; });
  }
  window.dzPanelIds = dzPanelIds;
  window.dzAnyPanelOpen = function(flag){
    return DZ_PANELS.some(function(p){
      return (!flag || p[flag]) && dzPanelIsOpen(dzPanelEl(p.id));
    });
  };

  /* Shut everything.

     A panel whose close function is absent — the admin panel for an ordinary
     member, a page whose module failed to load — is shut by its class, which
     is the one thing every panel here agrees on. That is a fallback and not
     the path: a closer knows about polls to stop and state to drop, and this
     does not. */
  function dzCloseAllPanels(){
    DZ_PANELS.forEach(function(p){
      var el = dzPanelEl(p.id);
      if(!dzPanelIsOpen(el)) return;
      var fn = p.close && window[p.close[0]];
      if(typeof fn === 'function'){
        try{ fn.apply(null, p.close.slice(1)); return; }catch(e){}
      }
      el.classList.remove('open');
      // Only the panels that keep one — writing data-state onto a panel that
      // has never had one is inventing state for somebody else's element.
      if(el.hasAttribute('data-state')) el.setAttribute('data-state','closed');
    });
    restoreScroll();
  }
  window.dzCloseAllPanels = dzCloseAllPanels;

  /* ---- one move at a time -------------------------------------------------

     Switching section is not one action, it is a sweep followed by an open,
     and half of what runs in between is asynchronous: a MutationObserver
     watching a panel's class (js/routes.js, and the Settings back-watcher in
     js/auth.js) runs on a microtask after the switch has finished, and an
     opener that needs a row out of the database — your own profile — finishes
     after a network round trip.

     Every glitch reported against fast switching came out of that gap:

       - js/routes.js stepped history BACK when the panel its address named
         closed. Tapping Upload while the community page was up therefore
         closed community, which stepped back onto /profile/<name> — the entry
         from two taps ago — and the popstate handler in js/gallery.js opened
         the profile over the upload page. "I tap upload and the profile comes
         up" is that, exactly.

       - the same step left the address reading /profile/<name> while the
         upload page was on screen, so a refresh opened the profile nobody had
         asked for. That is the second report, and it is the first one's
         shadow.

       - the Settings back-watcher re-opens Settings when a page opened from
         it closes and the profile is still up. Sweep the pages, open the
         profile, and by the time the watcher runs both of its conditions are
         true — so Settings slid in over a profile the member had just
         navigated to.

     So a move is a transaction. dzNavBegin stamps it and holds a flag up;
     everything that reacts late asks whether a move is in progress before
     touching history, and everything that finishes late asks whether ITS move
     is still the current one before touching the screen.

     The flag is dropped a task later rather than at dzNavEnd, because the
     watchers this exists for are microtasks queued DURING the move: releasing
     synchronously would drop it before the first of them ran. */
  var navSeq = 0, navHold = 0, navTimer = null;

  window.dzNavBegin = function(){
    navHold++;
    if(navTimer){ clearTimeout(navTimer); navTimer = null; }
    return ++navSeq;
  };
  window.dzNavEnd = function(){
    if(navHold > 1){ navHold--; return; }
    navHold = 1;
    if(navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(function(){ navTimer = null; navHold = 0; }, 0);
  };
  // A move is in progress: do not touch the address bar, and do not react to
  // a panel closing — it is closing because something else is opening.
  window.dzNavMoving = function(){ return navHold > 0; };
  // The move this token was taken for is still the current one. An async
  // opener that finds otherwise has been superseded and must not paint.
  window.dzNavCurrent = function(token){ return token === navSeq; };
  // The current move, without starting one. For work that begins before any
  // move and finishes after one may have happened — the deep links in
  // js/startup.js, which wait on the database and then open a panel.
  window.dzNavToken = function(){ return navSeq; };

  /* The scroll lock belongs to whatever is left on screen, so it is released
     only when nothing is holding it. Who holds it is the `lock` flag in the
     table above — it used to be a list written out here, which is how dzView
     came to be missing from it and any overlay closing underneath the item
     viewer handed the lock back out from under it. */
  function restoreScroll(){
    if(window.dzAnyPanelOpen('lock')) return;
    document.body.style.overflow=''; document.documentElement.style.overflow='';
  }

  // The bottom nav belongs to the five sections it links to. Anything that
  // slides in over one of them has to take it down, and that used to be each
  // panel's own job: a hide on the way in, paired with a show on the way out.
  // A panel written without the pair kept the nav floating over its own
  // content — which is what happened to Settings and to every page Settings
  // opens. One watcher owns it now: the panels say whether they are open and
  // this decides what the nav does, so a new page inherits the behaviour
  // by being listed here rather than by remembering to write both halves.
  // Panels the nav itself leads to are absent on purpose — the nav stays up
  // over the gallery, community, upload, login and profile pages, and marks
  // which of them you are in.
  // Which panels those are is the `nav` flag in the table above.
  var NAV_OVER=dzPanelIds('nav');
  function dzNavSync(){
    var nav=document.getElementById('bnNav');
    if(!nav) return;
    var over=window.dzAnyPanelOpen('nav');
    nav.style.display=over?'none':'';
  }
  window.dzNavSync=dzNavSync;
  function dzNavWatch(){
    if(window.MutationObserver){
      var mo=new MutationObserver(dzNavSync);
      NAV_OVER.forEach(function(id){
        var el=document.getElementById(id);
        if(el) mo.observe(el,{attributes:true,attributeFilter:['class']});
      });
    }
    dzNavSync();
  }
  // half these panels are written below this script in the page
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',dzNavWatch);
  else dzNavWatch();

  // merged artworks table
  var ART_KIND_ART = 'art';

  /* ---- the data cache --------------------------------------------------
     What used to be here was a set of hand-written localStorage snapshots
     — one member's profile, their friends, their conversations, the top
     fifty artworks — read only when a fetch had already failed. They are
     gone. js/cache.js is the one cache service now: memory, IndexedDB and
     a small synchronous tier, one TTL table, single-flight requests and
     invalidation by key rather than by clearing everything. The rules
     about whose data may be read by whom did not get more relaxed in the
     move; they got enforced in one place instead of five.

     Everything below goes through dzCache, and every one of them works
     without it: if the file failed to load, or IndexedDB is unavailable,
     or the browser is in a mode where storage throws, dzCached() hands
     back a shim that just calls the loader. Slower, never broken. */
  var DZ_CACHE_SHIM = {
    getOrSet: function(k, loader){ return Promise.resolve().then(loader); },
    warm:     function(k, loader){ return Promise.resolve().then(loader); },
    peek:     function(){ return null; },
    recall:   function(){ return Promise.resolve(null); },
    get:      function(){ return Promise.resolve(null); },
    set:      function(k, v){ return Promise.resolve(v); },
    delete:   function(){ return Promise.resolve(); },
    deleteByPrefix: function(){ return Promise.resolve(); },
    key:      function(){ return [].slice.call(arguments).join(':'); },
    ukey:     function(){ return 'user:' + [].slice.call(arguments).join(':'); },
    norm:     function(s){ return String(s == null ? '' : s).toLowerCase().trim(); },
    params:   function(){ return ''; },
    warmImages: function(){},
    purgeImages: function(){},
    dropPrivate: function(){ return Promise.resolve(); },
    invalidateArtwork: noop2, invalidateProfile: noop2, invalidateCommunity: noop2,
    invalidateSection: noop2, invalidateComments: noop2, invalidateStats: noop2,
    invalidateRanking: noop2, invalidateSearch: noop2, invalidateFriends: noop2,
    invalidateThread: noop2, invalidateAnalytics: noop2, invalidateUserList: noop2
  };
  function noop2(){ return Promise.resolve(); }
  function dzCached(){ return window.dzCache || DZ_CACHE_SHIM; }
  window.dzCached = dzCached;

  // The home page and the gallery read the same rows: one list of approved,
  // published artwork, newest first. So it is one cache record, and the two
  // surfaces sort and filter their own copy of it rather than each asking for
  // it. Every page of every listing derived from these rows is invalidated
  // together, by prefix, when a piece is added, edited or removed.
  var GAL_ALL = 'gallery:latest:all:page:1';
  // The first twenty, trimmed to the columns a card needs and small enough to
  // sit in the synchronous tier. This is what paints before the network has
  // been asked at all, on the home page and in the gallery.
  var GAL_TOP = 'gallery:latest:top20';

  function galTrim(a){
    return { id:a.id, name:a.name, image_url:a.image_url,
             thumb_x:a.thumb_x, thumb_y:a.thumb_y, thumb_zoom:a.thumb_zoom,
             category:a.category, tags:a.tags||null, kind:a.kind,
             status:a.status, created_at:a.created_at,
             user_id:a.user_id||null, description:a.description||null,
             software:a.software||null, pages:a.pages||null };
  }

  async function galFetch(){
    // public load: approved, and published. A draft is kept and not shown,
    // and a hidden piece is reachable by its own link and nowhere else.
    const{data:imgs,error}=await sb.from('artworks').select('*')
      .eq('status','approved').eq('visibility','published').eq('kind',ART_KIND_ART)
      .order('created_at',{ascending:false});
    if(error) throw error;
    return imgs||[];
  }

  // Applied in one place, whether the rows came from the cache, from the
  // network, or from a background refresh that landed after the page had
  // already painted. `repaint` is false on the first pass because startup
  // renders as soon as loadDB returns; it is true for a refresh, which is the
  // only case where nobody else is going to draw the new rows.
  function galApply(rows, repaint){
    if(!rows || !rows.length) return;
    /* A COPY of the array, not the array. renderHome sorts `images` in place
       by trending score, and `rows` here may be the very array the cache is
       holding in memory — sorting that would quietly reorder a record other
       readers are about to be handed, and leave the copy in memory disagreeing
       with the copy on disk. The row objects are shared, which is intended:
       an edit patches them and dzGalleryStore writes them back. */
    images = rows.slice();
    if(repaint){
      renderHome();
      if(typeof injectGallerySEO === 'function') injectGallerySEO();
      var fgEl = document.getElementById('fg');
      if(fgEl && fgEl.classList.contains('open') && typeof renderFG === 'function') renderFG();
    }
  }

  // The newest twenty, whatever order the caller happens to be holding. Sorted
  // here rather than trusted, because `images` is trending-sorted for most of
  // its life and the first paint of the gallery reads this expecting latest.
  function galStore(rows){
    dzCached().set(GAL_TOP, rows.slice().sort(artTieBreak).slice(0,20).map(galTrim),
                   'gallery:latest');
  }

  async function loadDB(){
    if(!sb)return;
    var c = dzCached();

    /* The saved copy goes on screen first. This is the whole reason the top
       twenty are written down: on a repeat visit the grid is populated in the
       time it takes to read one localStorage key, rather than after a round
       trip to Supabase. It may be a few minutes old — or a day old, offline —
       and the load below corrects it either way. */
    var snap = c.peek(GAL_TOP, 'gallery:latest', { any:true });
    if(snap && snap.length) images = snap;

    try{
      // One record, one request however many panels want it, and a stale copy
      // served immediately while the refresh runs behind it.
      var rows = await c.getOrSet(GAL_ALL, galFetch, 'gallery:latest', function(fresh){
        galApply(fresh, true);
        galStore(fresh);
      });
      galApply(rows, false);
      if(rows && rows.length){
        galStore(rows);
        // Warm the thumbnails the first screens will ask for, at idle. Bounded
        // and predictable — the top of the list, not the whole collection.
        c.warmImages(rows.slice(0,50).map(function(a){ return getThumbnailUrl(a.image_url); }), 50);
      }
    }catch(e){
      console.error(e);
      /* Nothing fresh, and nothing inside the stale window either. Fall back to
         whatever was last saved, however old, and say so — an old gallery with a
         notice beats an empty page. The full list is preferred over the trimmed
         twenty; the twenty is what is there when the full one was never stored,
         or was swept. */
      var old = await c.recall(GAL_ALL, 'gallery:latest');
      if(!old || !old.length) old = c.peek(GAL_TOP, 'gallery:latest', { any:true });
      if(old && old.length){
        images = old.slice();
        showToast('Offline — showing saved artworks');
      }
    }
  }

  /* The grid, the viewer and a profile all edit rows in `images` in place —
     a like counted, a piece removed. When they do, the cached copy has to
     follow, or the next visit paints the state from before the edit. */
  function dzGalleryStore(){
    if(!images || !images.length) return;
    var c = dzCached();
    c.set(GAL_ALL, images.slice(), 'gallery:latest');
    galStore(images);
  }
  window.dzGalleryStore = dzGalleryStore;

  /* Called after a confirmed write to an artwork: an upload, an edit, a
     delete. It drops the listings the piece can appear in and nothing else —
     not the section tabs, not communities, not anybody's private data — and
     for a delete it also asks the service worker to drop that piece's images,
     since the objects behind them are on their way out of storage.

     Order matters and is not negotiable: this runs AFTER the database has
     confirmed the write. Invalidating first means a refresh can land in the
     window before the commit and cache the state the mutation was replacing. */
  function dzArtworkChanged(id, opts){
    var o = opts || {};
    var c = dzCached();
    if(o.images && o.images.length) c.purgeImages(o.images);
    return Promise.resolve(c.invalidateArtwork(id, { userId:o.userId, ranking:o.ranking }))
      .catch(function(){});
  }
  window.dzArtworkChanged = dzArtworkChanged;

  // Sizes are generated once at upload and live beside each other in
  // koe-media, distinguished by a filename suffix:
  //
  //     <base>__t300.webp   __t600.webp   __v1000.webp   __f1600.webp
  //
  // The stored url is always the __f1600 one, so picking another size is a
  // suffix swap. Supabase image transformations are a paid-plan feature and are
  // deliberately not relied on. A url with no suffix to swap comes back
  // untouched: there is no resizer to fall back to any more.
  var SB_SIZE_RE = /__(?:t300|t600|v1000|f1600)\.webp$/;

  // t600 arrived after the migration, so it exists only for images uploaded
  // since. Everything that can emit a t600 url is gated on this until the
  // backfill has run and config.js sets it, because a MISSING srcset candidate
  // is not survivable: the browser does not fall back to another entry in the
  // list, it just fails the image. Left unset, every path below behaves exactly
  // as it did before t600 existed.
  // Accept a real boolean or the string spellings of one. A bare !! would read
  // the string "false" as ON, which is exactly how someone turning this back
  // off would write it.
  function dzFlagOn(v){
    return v === true || /^(1|true|yes|on)$/i.test(String(v == null ? '' : v).trim());
  }
  var T600_READY = dzFlagOn(window.KOE_CONFIG && window.KOE_CONFIG.T600_READY);

  function sbSwapSize(url, suffix){
    return SB_SIZE_RE.test(url) ? url.replace(SB_SIZE_RE, suffix) : url;
  }

  // width is the size being ASKED for; it maps to the nearest generated size at
  // or above it. The quality argument is gone with the resizer that honoured it.
  function imgResize(url, width){
    if(!url || typeof url !== 'string') return url;
    if(width <= 300)  return sbSwapSize(url, '__t300.webp');
    if(width <= 600 && T600_READY) return sbSwapSize(url, '__t600.webp');
    if(width <= 1000) return sbSwapSize(url, '__v1000.webp');
    return sbSwapSize(url, '__f1600.webp');
  }
  function getThumbnailUrl(url){ return imgResize(url, 300); }
  function getViewUrl(url){ return imgResize(url, 1000); }

  // ── responsive grid thumbnails ───────────────────────────────────────────
  // One fixed file cannot serve every screen. A grid cell is ~195 CSS px on a
  // phone and ~480 on a 1080p desktop, so srcset hands the browser the list of
  // sizes that exist and lets it pick: it computes (sizes value x DPR) and
  // takes the smallest candidate at or above that.
  //
  // f1600 is deliberately NOT a candidate. It is the download size; letting a
  // 4K screen pull 138KB per cell for a grid would cost more egress than the
  // blur it fixes is worth.
  var DZ_SRCSET_WIDTHS = [300, 600, 1000];

  // Effective DPR is capped at 2. Left uncapped, a DPR-3 phone with a ~215 CSS
  // px cell asks for 645px and pulls v1000 (~60KB) instead of t600 (~28KB) —
  // double the bytes on the connection least able to afford them, for a
  // difference no eye resolves at that physical size. sizes is scaled down by
  // cap/DPR so the browser's own multiply lands back on the capped figure.
  var DZ_DPR_CAP = 2;
  function dzDprScale(){
    var dpr = window.devicePixelRatio || 1;
    return dpr > DZ_DPR_CAP ? (DZ_DPR_CAP / dpr) : 1;
  }

  // Mirrors the artwork grids in css: 4 columns at >=1280px, 3 at >=700px,
  // 2 below. If those breakpoints move, these move with them or the browser
  // picks against a layout that is not there any more.
  function dzGridSizes(){
    var s = dzDprScale();
    var f = function(vw){ return +(vw * s).toFixed(2); };
    return '(min-width:1280px) ' + f(25) + 'vw, (min-width:700px) ' + f(33.33) + 'vw, ' + f(50) + 'vw';
  }

  function dzSrcset(url){
    if(!T600_READY || !url || !SB_SIZE_RE.test(url)) return '';
    return DZ_SRCSET_WIDTHS.map(function(w){
      return sbSwapSize(url, '__' + (w === 1000 ? 'v1000' : 't' + w) + '.webp') + ' ' + w + 'w';
    }).join(', ');
  }

  // The src/srcset/sizes attribute triplet for a grid thumbnail, ready to drop
  // into a template string. src stays t300 on its own so anything that ignores
  // srcset behaves exactly as it did before.
  function dzThumbAttrs(url){
    var attrs = 'src="' + esc(getThumbnailUrl(url || '')) + '"';
    var ss = dzSrcset(url || '');
    if(ss) attrs += ' srcset="' + esc(ss) + '" sizes="' + esc(dzGridSizes()) + '"';
    return attrs;
  }

  // Same choice for an <img> built through the DOM rather than a template.
  function dzApplyThumb(im, url){
    if(!im) return;
    var ss = dzSrcset(url || '');
    if(ss){ im.srcset = ss; im.sizes = dzGridSizes(); }
    im.src = getThumbnailUrl(url || '');
  }
  function itemHTML(img){
    const thumbAttrs=dzThumbAttrs(img.image_url||'');
    const thumbPos=thumbStyle(img.thumb_x, img.thumb_y, img.thumb_zoom);
    const fullSrc=esc(img.image_url);
    const cats=catList(img.category).length?catList(img.category):['others'];
    const extraCats=cats.slice(1);
    const moreBadge=extraCats.length?`<span class="cBadgeMore" tabindex="0" role="text" aria-label="Also tagged: ${esc(extraCats.join(', '))}" title="${esc(extraCats.join(', '))}">+${extraCats.length}</span>`:'';
    const idStr=esc(String(img.id));
    const altText=esc(img.name||'Untitled artwork');
    let pgs=img.pages;
    if(typeof pgs==='string'){ try{ pgs=JSON.parse(pgs); }catch(e){ pgs=null; } }
    const extraCount=Array.isArray(pgs)?pgs.length:0;
    const multiBadge=extraCount?`<span class="gMulti" aria-label="${extraCount+1} images">⧉ ${extraCount+1}</span>`:'';
    const artistChip=img.user_id?`<div class="gArtist" data-uid="${esc(String(img.user_id))}" aria-hidden="true">
          <div class="gArtistAv"><span class="gArtistLtr"></span></div>
          <div class="gArtistName"></div>
          <div class="gArtistHandle"></div>
        </div>`:'';
    return`<div class="gItem" data-id="${idStr}" data-fullsrc="${fullSrc}" data-name="${altText}" data-cat="${esc(cats[0]||'')}" data-desc="${esc(img.description||'')}">
      <a class="gItemLink" href="/artwork/${idStr}" onclick="return handleArtClick(event,'${idStr}')" aria-label="View ${altText}">
        <div class="cBadgeWrap"><span class="cBadge">${esc(cats[0]||'others')}</span>${moreBadge}</div>${multiBadge}
        <img ${thumbAttrs} alt="${altText}" loading="lazy" decoding="async" itemprop="contentUrl" style="${thumbPos}" onload="this.classList.add('imgDone')" onerror="this.classList.add('imgDone')">
        <div class="gOv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
        ${artistChip}
        <div class="gNm" itemprop="name">${esc(img.name)}</div>
      </a>
    </div>`;
  }

  var dzArtistCache   = {};
  var _dzArtistWanted = {};
  var _dzArtistFlight = {};
  var _dzArtistTimer  = null;

  function dzBuildHoverReveal(uid){
    var frag = document.createDocumentFragment();
    var ov = document.createElement('div');
    ov.className = 'gOv';
    ov.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
    frag.appendChild(ov);
    if(uid){
      var chip = document.createElement('div');
      chip.className = 'gArtist';
      chip.setAttribute('data-uid', String(uid));
      chip.setAttribute('aria-hidden', 'true');
      chip.innerHTML = '<div class="gArtistAv"><span class="gArtistLtr"></span></div>' +
                       '<div class="gArtistName"></div><div class="gArtistHandle"></div>';
      frag.appendChild(chip);
    }
    return frag;
  }

  function dzPaintArtistChip(el, p){
    var name = (p && (p.display_name || p.username)) || 'Artist';
    var av  = el.querySelector('.gArtistAv');
    var ltr = el.querySelector('.gArtistLtr');
    var nm  = el.querySelector('.gArtistName');
    var hd  = el.querySelector('.gArtistHandle');
    if(nm) nm.textContent = name;
    if(hd) hd.textContent = p && p.username ? '@' + p.username : '';
    if(av){
      if(p && p.avatar_url){
        var im = av.querySelector('img');
        if(!im){
          im = document.createElement('img');
          im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
          av.appendChild(im);
        }
        im.src = getThumbnailUrl(p.avatar_url);
        if(ltr) ltr.style.display = 'none';
      } else if(ltr){
        ltr.textContent = name.charAt(0).toUpperCase();
        ltr.style.display = '';
      }
    }
    el.dataset.painted = '1';
  }

  function dzPaintArtistChips(uid){
    var p = dzArtistCache[uid];
    if(p === undefined) return;
    var sel = (window.CSS && CSS.escape) ? CSS.escape(uid) : String(uid).replace(/["\\]/g,'\\$&');
    var els = document.querySelectorAll('.gArtist[data-uid="' + sel + '"]');
    for(var i=0;i<els.length;i++){
      if(els[i].dataset.painted !== '1') dzPaintArtistChip(els[i], p);
    }
  }

  function dzFlushArtists(){
    _dzArtistTimer = null;
    var ids = Object.keys(_dzArtistWanted).filter(function(u){
      return dzArtistCache[u] === undefined && !_dzArtistFlight[u];
    });
    _dzArtistWanted = {};
    if(!ids.length || !sb) return;
    ids.forEach(function(u){ _dzArtistFlight[u] = true; });
    // banner_url rides along for the artist board's card background — one
    // column, and it keeps every reader of this cache seeing the same shape
    sb.from('profiles').select('id,username,display_name,avatar_url,banner_url,bio').in('id', ids)
      .then(function(res){
        var rows = (res && res.data) || [];
        rows.forEach(function(p){ if(p && p.id) dzArtistCache[p.id] = p; });
        ids.forEach(function(u){
          if(dzArtistCache[u] === undefined) dzArtistCache[u] = null;
          delete _dzArtistFlight[u];
          dzPaintArtistChips(u);
        });
      })
      .catch(function(){
        ids.forEach(function(u){ delete _dzArtistFlight[u]; });
      });
  }

  function dzResolveArtist(uid){
    if(!uid) return;
    if(dzArtistCache[uid] !== undefined){ dzPaintArtistChips(uid); return; }
    _dzArtistWanted[uid] = true;
    if(!_dzArtistTimer) _dzArtistTimer = setTimeout(dzFlushArtists, 60);
  }

  document.addEventListener('pointerover', function(e){
    var t = e.target;
    if(!t || !t.closest) return;
    var card = t.closest('.gItem,.awCard');
    if(!card) return;
    var chip = card.querySelector('.gArtist');
    if(!chip || chip.dataset.painted === '1') return;
    dzResolveArtist(chip.getAttribute('data-uid'));
  }, {passive:true});


  // What an artwork has earned, before any decay: a view is worth 1, a
  // bookmark 8, a download 6. Every board below scores on these same points
  // and differs only in how fast they fade.
  function artPoints(a){
    var v=parseInt(a.view_count,10)||0,
        b=parseInt(a.bookmark_count,10)||0,
        d=parseInt(a.download_count,10)||0;
    return (v*1)+(b*8)+(d*6);
  }
  // Hours since upload. An artwork with no date is treated as a year old, so
  // it sinks rather than floats.
  function artAgeH(a, now){
    var t=a.created_at?new Date(a.created_at).getTime():0;
    return t?Math.max(0,(now-t)/3600000):(365*24);
  }

  // Trending fades by the hour: today's uploads move constantly.
  function trendingScore(a, now){
    return artPoints(a)/Math.pow(artAgeH(a,now)+2,1.35);
  }
  // Weekly hits fade by the week. Age is counted in whole weeks, so
  // everything uploaded inside the current week is divided by the same
  // number and the board is a straight points race for seven days; come the
  // next week that week's entries drop a step and the one after that drops
  // another.
  function weeklyScore(a, now){
    var weeks=Math.floor(artAgeH(a,now)/168);
    return artPoints(a)/Math.pow(weeks+2,1.35);
  }
  // Monthly hits fade by the month, and harder: each 30 days past upload
  // halves what an artwork's points are worth here.
  function monthlyScore(a, now){
    var months=Math.floor(artAgeH(a,now)/720);
    return artPoints(a)/Math.pow(2,months);
  }

  // Newest first, then id, so the order never shuffles between renders.
  function artTieBreak(a, b){
    var tA=a.created_at?new Date(a.created_at).getTime():0;
    var tB=b.created_at?new Date(b.created_at).getTime():0;
    if(tB!==tA) return tB-tA;
    var iA=String(a.id||''), iB=String(b.id||'');
    return iA<iB?1:(iA>iB?-1:0);
  }
  function sortByScore(arr, score){
    var now=Date.now();
    return arr.sort(function(a,b){
      var sA=score(a,now), sB=score(b,now);
      if(sB!==sA) return sB-sA;
      return artTieBreak(a,b);
    });
  }
  function sortByTrending(arr){ return sortByScore(arr, trendingScore); }
  function sortByWeekly(arr){   return sortByScore(arr, weeklyScore);   }
  function sortByMonthly(arr){  return sortByScore(arr, monthlyScore);  }
  function sortByNewest(arr){   return arr.sort(artTieBreak);           }

  function renderHome(){
    sortByTrending(images);
    if(window.rebuildGalCarousels) window.rebuildGalCarousels(images);
  }

  /* ---- scope guard -----------------------------------------------------
     Every list on this site belongs to somebody: the signed-in member, or
     the profile being looked at. A fetch is slow and a session is not, so
     a reply can land after the thing it was asked for has already changed
     — a different account signed in, a different profile opened — and
     paint one member's rows under another member's name.

     So a caller stamps the scope it is fetching for before it awaits, and
     checks the stamp before it paints. If the stamp no longer matches, the
     reply is stale by definition and is dropped rather than rendered. The
     stamp carries the signed-in id, so nothing fetched for one account can
     ever paint for another, whatever is sitting in a cache. */
  var DZ_SCOPE_SEQ = 0;
  function dzScope(){
    var uid = (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser.id) : 'guest';
    return uid + '|' + DZ_SCOPE_SEQ;
  }
  // called when the session changes: every stamp taken before now is stale
  function dzScopeBump(){ DZ_SCOPE_SEQ++; }
  function dzScopeStill(token){ return token != null && token === dzScope(); }

  function gridCols(){
    var w = window.innerWidth || document.documentElement.clientWidth || 1280;
    return w >= 1280 ? 4 : (w >= 700 ? 3 : 2);
  }
  function gridInitialBatch(){ var c = gridCols(); return c === 4 ? 16 : (c === 3 ? 12 : 10); }
  function gridStepBatch(){    var c = gridCols(); return c === 4 ?  8 : (c === 3 ?  6 :  4); }

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
      recheck: function(){
        if(io){ io.unobserve(sent); io.observe(sent); }
        else if(fb){ fb(); }
      },
      destroy: function(){
        if(io){ io.disconnect(); io = null; }
        if(fb){ (rootEl || window).removeEventListener('scroll', fb); fb = null; }
        if(sent.parentNode) sent.parentNode.removeChild(sent);
      }
    };
  }

  var fgVisible = 0;
  var fgList = [];
  var fgSent = null;

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

  var hiddenArtworks = new Set();

  async function loadHiddenArtworks(){
    hiddenArtworks = new Set();
    if(!sb || !currentUser) return;
    try{
      var r = await sb.from('hidden_artworks').select('artwork_id')
        .eq('user_id', currentUser.id).limit(2000);
      (r.data || []).forEach(function(row){ hiddenArtworks.add(String(row.artwork_id)); });
    }catch(e){  }
  }

  function filterHidden(list){
    if(!hiddenArtworks.size) return list;
    return (list || []).filter(function(a){ return !hiddenArtworks.has(String(a.id)); });
  }

  window.markArtworkHidden = function(id){
    hiddenArtworks.add(String(id));
    try{ renderHome(); }catch(e){}
    try{ if(typeof renderFG === 'function') renderFG(); }catch(e){}
  };

  function renderFG(){
    _renderFGPage();
  }
  /* The gallery's search page looks in this rather than asking the database:
     it is every approved artwork on the site, already loaded, already the
     rows the grid draws — and already without whatever the viewer hid. */
  window.galleryImages = function(){ return filterHidden(images); };

  function _renderFGPage(){
    const _fgIn=document.getElementById('fgSearchIn');
    const q=(_fgIn?_fgIn.value:'').toLowerCase().trim();
    const c=document.getElementById('fgC');
    let imgs=filterHidden([...images]);
    if(filterCat!=='all')imgs=imgs.filter(i=>(catList(i.category).length?catList(i.category):['others']).includes(filterCat));
    if(q)imgs=imgs.filter(i=>(i.name||'').toLowerCase().includes(q));

    if(filterSrt==='trending'){
      sortByTrending(imgs);
    } else {
      imgs.sort(function(a,b){
        var tA=a.created_at?new Date(a.created_at).getTime():0;
        var tB=b.created_at?new Date(b.created_at).getTime():0;
        var diff=filterSrt==='new'?(tB-tA):(tA-tB);
        if(diff!==0)return diff;
        // compare ids as strings
        var iA=String(a.id||''), iB=String(b.id||'');
        if(iA===iB) return 0;
        var asc = iA<iB ? -1 : 1;
        return filterSrt==='new' ? -asc : asc;
      });
    }

    /* Picked tags move matching artwork to the top, which is what the tag
       picker has always said they do. Everything below keeps the order the
       chosen sort just gave it — this lifts, it does not re-sort. */
    var picked = (typeof tgPickedTags === 'function') ? tgPickedTags() : null;
    if(picked && picked.size){
      var lifted=[], rest=[];
      for(var pi=0; pi<imgs.length; pi++){
        var cats=catList(imgs[pi].category), hit=false;
        for(var ci=0; ci<cats.length; ci++){ if(picked.has(cats[ci])){ hit=true; break; } }
        (hit?lifted:rest).push(imgs[pi]);
      }
      imgs = lifted.concat(rest);
    }

    if(fgSent){ fgSent.destroy(); fgSent = null; }
    fgList = imgs;

    if(!imgs.length){c.innerHTML='<div class="fgEmp">NO ARTWORK FOUND</div>';_fgSyncFilterBtn();return;}

    fgVisible = Math.min(Math.max(gridInitialBatch(), fgVisible||0), imgs.length);
    c.innerHTML = `<div class="fgGrid" id="fgGridEl">${imgs.slice(0, fgVisible).map(itemHTML).join('')}</div>`;

    if(fgVisible < imgs.length){
      fgSent = makeGridSentinel(document.getElementById('fg'), fgAppendBatch);
      c.appendChild(fgSent.el);
    }
    _fgSyncFilterBtn();
  }

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
  function _fgSyncFilterBtn(){
    if(typeof fgSyncFilterBtn==='function') fgSyncFilterBtn();
  }
  // read by the one filter button in the bar
  window.fgArtFiltered = function(){
    return filterCat!=='all' || filterSrt!=='trending';
  };

  function openFilterPanel(){
    fgFltMode = 'artworks';
    var _t=document.getElementById('fltPTitle'); if(_t) _t.textContent='FILTERS';
    var _a=document.getElementById('fltArtBody'); if(_a) _a.style.display='';
    var _s=document.getElementById('fltSecBody'); if(_s) _s.style.display='none';
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
    if(fgFltMode!=='artworks'){ applySecFilter(); return; }
    var catR=document.querySelector('input[name="fltCat"]:checked');
    var srtR=document.querySelector('input[name="fltSrt"]:checked');
    filterCat=catR?catR.value:'all';
    filterSrt=srtR?srtR.value:'trending';
    fgVisible=0;
    closeFilterPanel();
    renderFG();
  }
  function openFG(){
    document.getElementById('fg').classList.add('open');
    document.body.style.overflow='hidden';
    fgSwitchSection('artworks');
    // the grid comes back at roughly the size it was left at, so returning
    // to the gallery can land back on the row you were reading. capped,
    // because past this depth the thumbs have aged out of the image cache
    // and rebuilding them all would cost a fresh fetch each
    fgVisible=Math.min(fgVisible||0, gridInitialBatch()+gridStepBatch()*8);
    renderFG();
    // the showcase over the chip row reads the same artworks the grid does,
    // so it is refreshed with it rather than on a clock of its own
    if(typeof window.fgShowRender === 'function') window.fgShowRender();
  }

