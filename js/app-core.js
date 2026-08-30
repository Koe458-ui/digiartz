  const SB_URL = (window.KOE_CONFIG && window.KOE_CONFIG.SB_URL) || '';
  const SB_KEY = (window.KOE_CONFIG && window.KOE_CONFIG.SB_KEY) || '';

  const BUCKET   = 'koe-media';
  const S3_FN_URL = (window.KOE_CONFIG && window.KOE_CONFIG.S3_FN_URL) || '';

  function safeSlug(str, maxLen){
    var s = String(str || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    if(!s) s = 'untitled';
    return s.slice(0, maxLen || 60);
  }
  async function s3AuthHeader(){
    if(!sb) throw new Error('Backend not configured');
    const{data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Sign in required');
    return 'Bearer '+session.access_token;
  }
  async function s3Upload(bucket, path, file, opts){
    if(!S3_FN_URL) throw new Error('Storage endpoint not configured (S3_FN_URL missing in config.js)');
    const auth = await s3AuthHeader();
    const key = bucket+'/'+path;
    const wantPrivate = !!(opts && opts.private);
    let signRes;
    try{
      signRes = await fetch(S3_FN_URL, {
        method:'POST',
        headers:{'content-type':'application/json', 'authorization':auth},
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

    if(Array.isArray(signJson.targets) && signJson.targets.length){
      await sbUploadTargets(signJson.targets, file);
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
      if(wantPrivate) return signJson.private === false ? (signJson.supabasePublicUrl || null) : null;
      return signJson.supabasePublicUrl || signJson.publicUrl;
    }
    if(wantPrivate) throw new Error('This upload service cannot store private files yet');

    if(!signJson.uploadUrl) throw new Error('Upload service returned no uploadUrl');
    let putRes;
    try{
      putRes = await fetch(signJson.uploadUrl, {method:'PUT', headers:{'content-type':safeUploadType(file.type)}, body:file});
    }catch(e){
      throw new Error('Upload blocked by the storage server — add this site\u2019s origin with PUT to the S3 bucket\u2019s CORS policy');
    }
    if(!putRes.ok) throw new Error('Upload failed ('+putRes.status+') — presigned URL rejected by S3');
    return signJson.publicUrl;
  }

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
    if(!blob || blob.type !== 'image/webp'){
      blob = await new Promise(function(res){ cv.toBlob(res, 'image/jpeg', quality); });
    }
    if(!blob) throw new Error('Could not encode image');
    return blob;
  }

  var DERIVE_SPEC = {
    t300:  { width: 300,  quality: 0.55 },
    t600:  { width: 600,  quality: 0.52 },
    v1000: { width: 1000, quality: 0.68 },
    f1600: { width: 1600, quality: 0.82 }
  };

  // The only content types the pipeline ever needs to store. Everything else is
  // a downloadable asset — a brush pack, a font, a .blend, a PDF — and every
  // one of those is fetched back through /api/*-download, which sets its own
  // Content-Type and Content-Disposition from the database row. The type stored
  // beside the bytes is never read on the way out.
  //
  // So it is declared octet-stream, and koe-media is a PUBLIC bucket: an object
  // stored as text/html or image/svg+xml is a page the storage domain will
  // render, on a hostname close enough to ours to be worth a phishing attempt.
  // The bucket's allowed_mime_types refuses those outright — this is the half
  // that keeps a legitimate .svg or .pdf upload working under that rule rather
  // than being refused with it.
  var UPLOAD_IMAGE_TYPES =
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
  function safeUploadType(type){
    var t = String(type || '').toLowerCase();
    return UPLOAD_IMAGE_TYPES.indexOf(t) >= 0 ? t : 'application/octet-stream';
  }

  async function sbUploadTargets(targets, file){
    for(var i=0;i<targets.length;i++){
      var t = targets[i];
      var body = file, type = safeUploadType(file.type);
      if(t.role && DERIVE_SPEC[t.role]){
        var spec = DERIVE_SPEC[t.role];
        body = await imgDerive(file, spec.width, spec.quality);
        type = safeUploadType(body.type || 'image/webp');
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

  function dzUploadTargets(uploadedUrl, uploadPath, isPrivate){
    var isImg = /__f1600\.webp$/.test(uploadedUrl || '');
    var base  = String(uploadPath || '').replace(/\.[a-z0-9]+$/i, '');
    if(isPrivate && !isImg){
      return { image: null, file: { bucket:'koe-originals', path: uploadPath } };
    }
    return isImg
      ? { image: { bucket:'koe-media',     path: base + '__f1600.webp', url: uploadedUrl },
          file:  { bucket:'koe-originals', path: uploadPath } }
      : { image: null,
          file:  { bucket:'koe-media',     path: uploadPath, url: uploadedUrl } };
  }

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
      console.warn('media record failed (' + kind + '):', (e && e.message) || e);
      return false;
    }
  }

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

  var SITE_DEFAULT_TITLE = document.title;
  var SITE_DEFAULT_DESC  = (document.querySelector('meta[name="description"]')||{}).content || '';
  var SITE_DEFAULT_IMAGE = (document.querySelector('meta[property="og:image"]')||{}).content || '';

  let sb = null;

  function dzNoBackend(why){
    console.error(why);
    var _sb = document.getElementById('sBanner');
    if(_sb){
      _sb.textContent = '\u26a0 Can\u2019t connect right now. Please refresh, or try again in a moment.';
      _sb.classList.add('show');
    }
  }

  if (SB_URL && SB_KEY) {
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

  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  function safeErr(e, fallback){
    var m = (e && e.message) ? String(e.message) : '';
    var internal = /row-level security|violates|constraint|relation |column |permission denied|JWT|supabase|postgres|duplicate key|null value|schema cache|Failed to fetch|NetworkError|\b(42501|23505|23503)\b|PGRST/i;
    if(!m || internal.test(m)){
      if(m) console.error('Suppressed internal error:', m);
      return fallback;
    }
    return m;
  }
  var CAT_HIDDEN = { 'ai-art':1 };
  function catHidden(slug){ return !!CAT_HIDDEN[String(slug||'').trim()]; }
  function catList(val){
    var out = Array.isArray(val)
      ? val.map(function(c){return String(c).trim();})
      : String(val||'').split(',').map(function(c){return c.trim();});
    return out.filter(function(c){ return c && !CAT_HIDDEN[c]; });
  }

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
  var CAT_LABELS = SITE_CATEGORIES.reduce(function(m,c){ m[c.slug]=c.label; return m; },{});
  function catLabel(slug){
    if(!slug) return '';
    if(CAT_LABELS[slug]) return CAT_LABELS[slug];
    return String(slug).replace(/-/g,' ').replace(/\b\w/g,function(ch){ return ch.toUpperCase(); });
  }

  function buildCategoryUI(){
    var fo = document.getElementById('fltCatOpts');
    if(fo){
      fo.insertAdjacentHTML('beforeend', SITE_CATEGORIES.map(function(c){
        return '<label class="fltOpt"><input type="radio" name="fltCat" value="'+esc(c.slug)+'">'+
               '<div class="fltDot"></div>'+fltIco(c.slug)+
               '<span class="fltLbl">'+esc(c.label.toUpperCase())+'</span></label>';
      }).join(''));
    }
    var pp = document.getElementById('pfUpCatPanel');
    if(pp){
      pp.innerHTML = SITE_CATEGORIES.map(function(c){
        return '<label class="upCatOpt"><input type="checkbox" id="pfUpCat_'+esc(c.slug)+'" value="'+esc(c.slug)+'"'+
               (c.slug==='others'?' checked':'')+' onchange="updatePfCatDisplay()"/> '+esc(c.label)+'</label>';
      }).join('');
    }
  }
  buildCategoryUI();
  function dzDecodeSeg(s){
    try{ return decodeURIComponent(String(s)); }catch(e){ return String(s); }
  }
  window.dzDecodeSeg = dzDecodeSeg;

  var DZ_TIER_LIMITS = {
    guest:   { image: 20, asset: 200 },
    lite:    { image: 20, asset: 200 },
    premium: { image: 20, asset: 200 },
    max:     { image: 25, asset: 400 },
    dev:     { image: 25, asset: 400 }
  };

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

  function dzPaintLimits(){
    var els = document.querySelectorAll('[data-dz-mb]');
    for(var i = 0; i < els.length; i++){
      var el = els[i];
      var mb = el.getAttribute('data-dz-mb') === 'asset' ? dzAssetMaxMb() : dzImageMaxMb();
      el.textContent = String(el.textContent).replace(/\d+(?=\s*MB)/i, mb);
    }
  }
  window.dzPaintLimits = dzPaintLimits;

  function dzDomReady(){
    if(document.readyState !== 'loading') return Promise.resolve();
    return new Promise(function(res){
      document.addEventListener('DOMContentLoaded', function(){ res(); }, { once:true });
    });
  }
  window.dzDomReady = dzDomReady;

  var DZ_PANELS = [
    { id:'dzTopMenu',       close:['dzMenuClose'] },
    { id:'dzExWrap',        close:['dzExClose'] },
    { id:'dzCmWrap',        close:['dzCmClose'] },
    { id:'dzUpWrap',        close:['dzUpClose'] },
    { id:'dzAcWrap',        close:['dzAcClose'] },
    { id:'dlQuotaMod',      close:['dzQuotaClose'] },
    { id:'upqBackdrop',     close:['upqCloseModal'] },
    { id:'fgFltPanel',      close:['closeFilterPanel'] },
    { id:'fgFltOvr',        close:['closeFilterPanel'] },
    { id:'tgMod',           close:['tgModClose'],           lock:1 },
    { id:'legalBackdrop',   close:['closeLegal'],           lock:1 },
    { id:'legalPage',       close:['closeLegalPage'],       lock:1 },
    { id:'showcasePicker',  close:['closeShowcasePicker'] },
    { id:'pfSearchPage',    close:['closePfSearch', true] },
    { id:'fgSearchPage',    close:['closeFgSearch', true],  lock:1 },
    { id:'cmSearchPage',    close:['cmCloseSearch'],        lock:1 },
    { id:'cmBrowsePage',    close:['cmCloseBrowse'],        lock:1 },
    { id:'cmInfoPage',      close:['cmiClose'],             lock:1 },
    { id:'frdPage',         close:['closeFriendsPage'],     lock:1 },
    { id:'albViewPage',     close:['albCloseView'],         lock:1 },
    { id:'albPage',         close:['albClosePage'],         lock:1 },
    { id:'bmPage',          close:['closeBookmarksPage'],   lock:1 },
    { id:'cartPage',        close:['closeCartPage'],        lock:1 },
    { id:'anPage',          close:['closeAnalyticsPage'],   lock:1 },
    { id:'anHubPage',       close:['anHubClose'],           lock:1 },
    { id:'payHubPage',      close:['payHubClose'],          lock:1 },
    { id:'xpPage',          close:['closeXpPage'],          lock:1 },
    { id:'themePage',       close:['closeThemePage'],       lock:1 },
    { id:'rankHub',         close:['closeRankHub'],         lock:1 },
    { id:'rankPage',        close:['closeRankPage'],        lock:1 },
    { id:'dzPanelHost',     close:['dzClosePanel'],         lock:1 },
    { id:'admPage',         close:['dzOpsClose'],           lock:1 },
    { id:'notifPage',       close:['closeNotifPage'],       lock:1 },
    { id:'pfMyWorkPage',    close:['closeMyWorkPage'],      lock:1 },
    { id:'pfEditPage',      close:['closePfEditPage'],      lock:1 },
    { id:'setPage',         close:['closeSettingsPage'],    lock:1 },
    { id:'subPage',         close:['closeSubscription'],    lock:1 },

    { id:'artModal',        close:['closeLB'],              lock:1 },
    { id:'dzView',          close:['dzCloseViewSilent'],    lock:1 },
    { id:'dzLight',         close:['dzLightClose'],         lock:1 },
    { id:'authMod',         close:['closeAuthMod'],         lock:1 },
    { id:'pfUpMod',         close:['closePfUpload'],        lock:1 },
    { id:'profilePage',     close:['closeProfilePage', false], lock:1 },
    { id:'cmChatPanel',     close:['cmCloseChat'] },
    { id:'communityPage',   close:['closeCommunityPage'],   lock:1 },
    { id:'fg',              close:['closeFG'],              lock:1 }
  ];

  function dzPanelEl(id){ return document.getElementById(id); }
  function dzPanelIsOpen(el){
    return !!el && (el.classList.contains('open') ||
                    el.getAttribute('data-state') === 'open');
  }
  window.dzAnyPanelOpen = function(flag){
    return DZ_PANELS.some(function(p){
      return (!flag || p[flag]) && dzPanelIsOpen(dzPanelEl(p.id));
    });
  };

  function dzCloseAllPanels(){
    DZ_PANELS.forEach(function(p){
      var el = dzPanelEl(p.id);
      if(!dzPanelIsOpen(el)) return;
      var fn = p.close && window[p.close[0]];
      if(typeof fn === 'function'){
        try{ fn.apply(null, p.close.slice(1)); return; }catch(e){}
      }
      el.classList.remove('open');
      if(el.hasAttribute('data-state')) el.setAttribute('data-state','closed');
    });
    restoreScroll();
  }
  window.dzCloseAllPanels = dzCloseAllPanels;

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
  window.dzNavMoving = function(){ return navHold > 0; };
  window.dzNavCurrent = function(token){ return token === navSeq; };
  window.dzNavToken = function(){ return navSeq; };

  function restoreScroll(){
    if(window.dzAnyPanelOpen('lock')) return;
    document.body.style.overflow=''; document.documentElement.style.overflow='';
  }

  var ART_KIND_ART = 'art';

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

  var GAL_ALL = 'gallery:latest:all:page:1';
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
    const{data:imgs,error}=await sb.from('artworks').select('*')
      .eq('status','approved').eq('visibility','published').eq('kind',ART_KIND_ART)
      .order('created_at',{ascending:false});
    if(error) throw error;
    return imgs||[];
  }

  function galApply(rows, repaint){
    if(!rows || !rows.length) return;
    images = rows.slice();
    if(repaint){
      renderHome();
      if(typeof injectGallerySEO === 'function') injectGallerySEO();
      var fgEl = document.getElementById('fg');
      if(fgEl && fgEl.classList.contains('open') && typeof renderFG === 'function') renderFG();
    }
  }

  function galStore(rows){
    dzCached().set(GAL_TOP, rows.slice().sort(artTieBreak).slice(0,20).map(galTrim),
                   'gallery:latest');
  }

  async function loadDB(){
    if(!sb)return;
    var c = dzCached();

    var snap = c.peek(GAL_TOP, 'gallery:latest', { any:true });
    if(snap && snap.length) images = snap;

    try{
      var rows = await c.getOrSet(GAL_ALL, galFetch, 'gallery:latest', function(fresh){
        galApply(fresh, true);
        galStore(fresh);
      });
      galApply(rows, false);
      if(rows && rows.length){
        galStore(rows);
        c.warmImages(rows.slice(0,50).map(function(a){ return getThumbnailUrl(a.image_url); }), 50);
      }
    }catch(e){
      console.error(e);
      var old = await c.recall(GAL_ALL, 'gallery:latest');
      if(!old || !old.length) old = c.peek(GAL_TOP, 'gallery:latest', { any:true });
      if(old && old.length){
        images = old.slice();
        showToast('Offline — showing saved artworks');
      }
    }
  }

  function dzGalleryStore(){
    if(!images || !images.length) return;
    var c = dzCached();
    c.set(GAL_ALL, images.slice(), 'gallery:latest');
    galStore(images);
  }
  window.dzGalleryStore = dzGalleryStore;

  function dzArtworkChanged(id, opts){
    var o = opts || {};
    var c = dzCached();
    if(o.images && o.images.length) c.purgeImages(o.images);
    return Promise.resolve(c.invalidateArtwork(id, { userId:o.userId, ranking:o.ranking }))
      .catch(function(){});
  }
  window.dzArtworkChanged = dzArtworkChanged;

  var SB_SIZE_RE = /__(?:t300|t600|v1000|f1600)\.webp$/;

  function dzFlagOn(v){
    return v === true || /^(1|true|yes|on)$/i.test(String(v == null ? '' : v).trim());
  }
  var T600_READY = dzFlagOn(window.KOE_CONFIG && window.KOE_CONFIG.T600_READY);

  function sbSwapSize(url, suffix){
    return SB_SIZE_RE.test(url) ? url.replace(SB_SIZE_RE, suffix) : url;
  }

  function imgResize(url, width){
    if(!url || typeof url !== 'string') return url;
    if(width <= 300)  return sbSwapSize(url, '__t300.webp');
    if(width <= 600 && T600_READY) return sbSwapSize(url, '__t600.webp');
    if(width <= 1000) return sbSwapSize(url, '__v1000.webp');
    return sbSwapSize(url, '__f1600.webp');
  }
  function getThumbnailUrl(url){ return imgResize(url, 300); }
  function getViewUrl(url){ return imgResize(url, 1000); }

  var DZ_SRCSET_WIDTHS = [300, 600, 1000];

  var DZ_DPR_CAP = 2;
  function dzDprScale(){
    var dpr = window.devicePixelRatio || 1;
    return dpr > DZ_DPR_CAP ? (DZ_DPR_CAP / dpr) : 1;
  }

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

  function dzThumbAttrs(url){
    var attrs = 'src="' + esc(getThumbnailUrl(url || '')) + '"';
    var ss = dzSrcset(url || '');
    if(ss) attrs += ' srcset="' + esc(ss) + '" sizes="' + esc(dzGridSizes()) + '"';
    return attrs;
  }

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
        <div class="gOv"></div>
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

  function artPoints(a){
    var v=parseInt(a.view_count,10)||0,
        b=parseInt(a.bookmark_count,10)||0,
        d=parseInt(a.download_count,10)||0;
    return (v*1)+(b*8)+(d*6);
  }
  function artAgeH(a, now){
    var t=a.created_at?new Date(a.created_at).getTime():0;
    return t?Math.max(0,(now-t)/3600000):(365*24);
  }

  function trendingScore(a, now){
    return artPoints(a)/Math.pow(artAgeH(a,now)+2,1.35);
  }
  function weeklyScore(a, now){
    var weeks=Math.floor(artAgeH(a,now)/168);
    return artPoints(a)/Math.pow(weeks+2,1.35);
  }
  function monthlyScore(a, now){
    var months=Math.floor(artAgeH(a,now)/720);
    return artPoints(a)/Math.pow(2,months);
  }

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

  var DZ_SCOPE_SEQ = 0;
  function dzScope(){
    var uid = (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser.id) : 'guest';
    return uid + '|' + DZ_SCOPE_SEQ;
  }
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
        var iA=String(a.id||''), iB=String(b.id||'');
        if(iA===iB) return 0;
        var asc = iA<iB ? -1 : 1;
        return filterSrt==='new' ? -asc : asc;
      });
    }

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
  window.fgArtFiltered = function(){
    return filterCat!=='all' || filterSrt!=='trending';
  };

  window.dzArtCat = function(slug){
    if(slug === undefined) return filterCat;
    filterCat = slug || 'all';
    var r = document.querySelector('input[name="fltCat"][value="'+filterCat+'"]');
    if(r) r.checked = true;
    fgVisible = 0;
    renderFG();
  };
  window.dzArtSearch = function(){
    fgVisible = 0;
    renderFG();
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
    if(typeof window.fgHeadSyncCat==='function') window.fgHeadSyncCat('artworks');
    renderFG();
  }
  function openFG(){
    document.getElementById('fg').classList.add('open');
    document.body.style.overflow='hidden';
    fgSwitchSection('artworks');
    fgVisible=Math.min(fgVisible||0, gridInitialBatch()+gridStepBatch()*8);
    renderFG();
  }
