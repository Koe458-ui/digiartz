/* =====================================================================
   uploadVerifier.js  —  DigiArtz automated upload gate
   ---------------------------------------------------------------------
   Exposes: window.UploadVerifier.verify(file, meta) -> Promise<result>

   meta = {
     sb:      Supabase client (required),
     userId:  auth user id     (required),
     kind:    'art' | 'comic',
     pages:   [File, ...]       (comic page files, optional — AI-scanned),
     onStep:  fn(stepId, state, detail)   // 'ratelimit'|'duplicate'|'ai',
                                          // state 'run'|'pass'|'flag'|'block'
   }

   result = {
     verdict: 'approve' | 'review' | 'block',
     reason:  string,          // human-readable (shown to the user)
     phash:   string | null,   // 16-hex perceptual fingerprint to store
     checks:  [ {name, ...} ]  // per-check detail
   }

   verdict meaning (wired in index.html doPfUp):
     approve -> insert status:'approved'  (goes live immediately)
     review  -> insert status:'pending'   (falls back to #admPage review)
     block   -> aborted before any S3 upload; nothing is stored

   ---------------------------------------------------------------------
   WHAT IS AND ISN'T REAL (be honest about this):
   - Rate limit ....... REAL. Counts this user's rows in Supabase.
   - Duplicate ........ REAL. Perceptual dHash compared against stored
                        hashes. Exact match = block, near match = review.
   - AI detection ..... PARTIAL, hard-coded, no API. Reads the file's
                        embedded metadata for known generator signatures
                        (Stable Diffusion / ComfyUI / NovelAI / Midjourney
                        / DALL·E / Firefly / C2PA "AI" credentials, etc).
                        Catches files uploaded straight from an AI tool.
                        CANNOT catch a screenshotted / re-saved image whose
                        metadata was stripped — no honest client-side code
                        can. Those pass this check by design and rely on the
                        community / manual review.  A future pixel-level
                        model would go through _aiApiHook (left disabled —
                        "no API" per project decision).
   ===================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    rate10min:     10,       // max uploads per 10 minutes (art + comics combined)
    rateDay:       40,       // max uploads per rolling 24h
    nearThreshold: 6,        // Hamming distance (of 64) counted as a "near" match
    scanBytes:     524288,   // bytes of each file head scanned for AI markers (512 KB)
    recentPull:    800,      // most-recent phashes pulled per table for near-match
    aiApiEnabled:  false     // keep false — no external AI-detection API wired
  };

  /* ---- perceptual hash (difference hash, 64-bit -> 16 hex chars) ------ */
  function fileToBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file);
    }
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read image')); };
      img.src = url;
    });
  }

  async function computeDHash(file) {
    var bmp = await fileToBitmap(file);
    var W = 9, H = 8;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, W, H);
    if (bmp.close) { try { bmp.close(); } catch (e) {} }
    var d = ctx.getImageData(0, 0, W, H).data;
    var gray = new Array(W * H);
    for (var i = 0; i < W * H; i++) {
      gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    /* build 64 bits: each row compares adjacent pixels (8 comparisons x 8 rows) */
    var hex = '';
    var nibble = 0, bitCount = 0;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W - 1; x++) {
        var bit = gray[y * W + x] < gray[y * W + x + 1] ? 1 : 0;
        nibble = (nibble << 1) | bit;
        bitCount++;
        if (bitCount === 4) { hex += nibble.toString(16); nibble = 0; bitCount = 0; }
      }
    }
    return hex; // 16 chars
  }

  var POP = [0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    var d = 0;
    for (var i = 0; i < a.length; i++) {
      d += POP[(parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 15];
    }
    return d;
  }

  /* ---- AI-metadata scan (hard-coded signatures, no API) --------------- */
  var STRONG_SIGS = [
    { k: 'negative prompt',        label: 'SD prompt params' },
    { k: 'denoising strength',     label: 'SD params' },
    { k: 'cfg scale',              label: 'SD params' },
    { k: 'sampler:',               label: 'SD params' },
    { k: 'automatic1111',          label: 'AUTOMATIC1111' },
    { k: 'stable-diffusion',       label: 'Stable Diffusion' },
    { k: 'stable diffusion',       label: 'Stable Diffusion' },
    { k: 'comfyui',                label: 'ComfyUI' },
    { k: '"class_type"',           label: 'ComfyUI workflow' },
    { k: 'invokeai',               label: 'InvokeAI' },
    { k: 'novelai',                label: 'NovelAI' },
    { k: 'stealth_pnginfo',        label: 'NovelAI stealth data' },
    { k: 'midjourney',             label: 'Midjourney' },
    { k: 'dall-e',                 label: 'DALL\u00b7E' },
    { k: 'dall\u00b7e',            label: 'DALL\u00b7E' },
    { k: 'openai.com',             label: 'OpenAI' },
    { k: 'adobe firefly',          label: 'Adobe Firefly' },
    { k: 'firefly generative',     label: 'Adobe Firefly' },
    { k: 'leonardo.ai',            label: 'Leonardo.Ai' },
    { k: 'stability.ai',           label: 'Stability AI' },
    { k: 'trainedalgorithmicmedia',label: 'C2PA AI credential' },
    { k: 'c2pa.assertions',        label: 'C2PA credential' },
    { k: 'contentauthenticity',    label: 'Content Authenticity' },
    { k: 'ai generated',           label: 'AI-generated tag' },
    { k: 'ai-generated',           label: 'AI-generated tag' },
    { k: 'generated by ai',        label: 'AI-generated tag' },
    { k: 'made with ai',           label: 'AI-generated tag' }
  ];

  function latin1(u8) {
    var out = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return out;
  }

  function utf8(u8) {
    try { return new TextDecoder('utf-8').decode(u8); }
    catch (e) { return latin1(u8); }
  }

  /* ---- FIX 1: compressed PNG text chunks -----------------------------
     The old scan was a raw byte search over the file. That only ever
     saw tEXt chunks, which store their payload as plain text. PNG also
     allows zTXt (always zlib-deflated) and iTXt (optionally deflated),
     and plenty of generators — plus any PNG that has been through an
     optimiser like oxipng/pngcrush, which rewrites tEXt as zTXt — put
     the exact same "Negative prompt / Steps / Sampler / CFG scale"
     block in there. Deflated bytes look like noise, so a byte search
     finds nothing and the image sails through as clean.

     So: walk the chunk table properly and inflate what needs it. */
  async function inflate(u8) {
    if (typeof DecompressionStream !== 'function') return null;   // old browser: skip, never throw
    try {
      var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }                                   // corrupt/odd chunk: ignore
  }

  function isPNG(u8) {
    return u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  }

  async function pngTextChunks(u8) {
    var out = '', p = 8;
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var guard = 0;
    while (p + 8 <= u8.length && guard++ < 4096) {
      var len  = dv.getUint32(p);
      var type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      var at   = p + 8;
      if (len < 0 || len > u8.length - at) break;                  // truncated / malformed
      var d = u8.subarray(at, at + len);

      if (type === 'tEXt') {
        out += latin1(d) + '\n';
      } else if (type === 'zTXt') {
        /* keyword \0 method(1) deflate(...) */
        var z = d.indexOf(0);
        if (z !== -1) {
          var inf = await inflate(d.subarray(z + 2));
          out += latin1(d.subarray(0, z)) + '\n' + (inf ? utf8(inf) : '') + '\n';
        }
      } else if (type === 'iTXt') {
        /* keyword \0 flag(1) method(1) lang \0 transKeyword \0 payload */
        var k = d.indexOf(0);
        if (k !== -1) {
          var flag = d[k + 1];
          var l1 = d.indexOf(0, k + 3);
          var l2 = l1 === -1 ? -1 : d.indexOf(0, l1 + 1);
          if (l2 !== -1) {
            var pay = d.subarray(l2 + 1);
            var txt = (flag === 1) ? await inflate(pay) : pay;
            out += latin1(d.subarray(0, k)) + '\n' + (txt ? utf8(txt) : '') + '\n';
          }
        }
      } else if (type === 'IEND') break;

      p = at + len + 4;                                            // + CRC
    }
    return out;
  }

  async function scanAIMeta(file) {
    try {
      var buf  = new Uint8Array(await file.arrayBuffer());
      var head = buf.subarray(0, Math.min(buf.length, CONFIG.scanBytes));
      var tail = buf.length > 65536 ? buf.subarray(buf.length - 65536) : new Uint8Array(0);

      var raw = latin1(head) + '\n' + latin1(tail);

      /* FIX 1 — pull the real text out of every PNG text chunk,
         inflating zTXt / compressed iTXt on the way. */
      if (isPNG(buf)) {
        try { raw += '\n' + await pngTextChunks(buf); } catch (e) {}
      }

      /* FIX 2 — UTF-16 metadata. EXIF UserComment (and anything written
         by a Windows-side tool) is frequently UTF-16, i.e. the bytes read
         as  N \0 e \0 g \0 a \0 …  — so indexOf('negative prompt') never
         matched. Scanning a NUL-stripped copy alongside the raw one costs
         nothing and catches it. Stripping NULs out of compressed pixel
         data can't create a false hit: the signatures are long ASCII
         phrases, not byte pairs. */
      var s = (raw + '\n' + raw.replace(/\u0000/g, '')).toLowerCase();

      var found = [];
      for (var i = 0; i < STRONG_SIGS.length; i++) {
        if (s.indexOf(STRONG_SIGS[i].k) !== -1 && found.indexOf(STRONG_SIGS[i].label) === -1) {
          found.push(STRONG_SIGS[i].label);
        }
      }
      return found;
    } catch (e) { return []; }
  }

  /* ---- individual checks --------------------------------------------- */
  async function rateCheck(sb, userId) {
    var now = Date.now();
    var t10 = new Date(now - 10 * 60 * 1000).toISOString();
    var t24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    function q(tbl, since) {
      return sb.from(tbl).select('id', { count: 'exact', head: true })
               .eq('user_id', userId).gte('created_at', since);
    }
    var r = await Promise.all([q('artworks', t10), q('comics', t10), q('artworks', t24), q('comics', t24)]);
    var n10 = (r[0].count || 0) + (r[1].count || 0);
    var n24 = (r[2].count || 0) + (r[3].count || 0);
    if (n10 >= CONFIG.rate10min)
      return { block: true, detail: 'Rate limit: max ' + CONFIG.rate10min + ' uploads per 10 min. Please wait a moment.' };
    if (n24 >= CONFIG.rateDay)
      return { block: true, detail: 'Daily limit reached (' + CONFIG.rateDay + ' per day).' };
    return { block: false, detail: n10 + '/' + CONFIG.rate10min + ' in 10 min' };
  }

  async function dupCheck(sb, phash) {
    if (!phash) return { block: false, flag: false, detail: 'skipped' };
    /* exact match — indexed, scales, unambiguous -> hard block */
    var ex = await Promise.all([
      sb.from('artworks').select('id', { count: 'exact', head: true }).eq('phash', phash),
      sb.from('comics').select('id', { count: 'exact', head: true }).eq('phash', phash)
    ]);
    if (((ex[0].count || 0) + (ex[1].count || 0)) > 0)
      return { block: true, flag: false, detail: 'This exact image is already on DigiArtz.' };
    /* near match — client-side Hamming over recent hashes -> review.
       NOTE: bounded to the most-recent CONFIG.recentPull rows per table so
       it never pulls the whole DB. Reposts almost always cluster in recent
       uploads. A whole-table fuzzy match would need a Postgres bit-distance
       function (future upgrade). */
    var rc = await Promise.all([
      sb.from('artworks').select('phash').not('phash', 'is', null)
        .order('created_at', { ascending: false }).limit(CONFIG.recentPull),
      sb.from('comics').select('phash').not('phash', 'is', null)
        .order('created_at', { ascending: false }).limit(CONFIG.recentPull)
    ]);
    var pool = [];
    (rc[0].data || []).forEach(function (r) { if (r.phash) pool.push(r.phash); });
    (rc[1].data || []).forEach(function (r) { if (r.phash) pool.push(r.phash); });
    var best = 64;
    for (var i = 0; i < pool.length; i++) {
      var dd = hamming(phash, pool[i]);
      if (dd < best) best = dd;
      if (best === 0) break;
    }
    if (best >= 1 && best <= CONFIG.nearThreshold)
      return { block: false, flag: true, detail: 'Very similar to an existing upload (possible repost).' };
    return { block: false, flag: false, detail: 'no duplicates' };
  }

  /* Future paid pixel-model detector plugs in here. Disabled by design.
     Should resolve to { flag:Boolean, detail:String } when implemented. */
  var _aiApiHook = null; // TODO: wire an AI-image-detection API + set CONFIG.aiApiEnabled=true

  async function aiCheck(file, pages) {
    var files = [file].concat(pages || []);
    var hits = [];
    for (var i = 0; i < files.length; i++) {
      var m = await scanAIMeta(files[i]);
      for (var j = 0; j < m.length; j++) if (hits.indexOf(m[j]) === -1) hits.push(m[j]);
    }
    if (CONFIG.aiApiEnabled && typeof _aiApiHook === 'function') {
      try {
        var api = await _aiApiHook(file);
        if (api && api.flag && hits.indexOf(api.detail || 'AI model') === -1) hits.push(api.detail || 'AI model');
      } catch (e) { /* API failures never block an upload */ }
    }
    if (hits.length)
      return { flag: true, detail: 'AI markers in file metadata: ' + hits.slice(0, 3).join(', ') + (hits.length > 3 ? '…' : '') };
    return { flag: false, detail: 'no AI metadata' };
  }

  /* ---- orchestrator --------------------------------------------------- */
  function fire(onStep, id, state, detail) {
    if (typeof onStep === 'function') { try { onStep(id, state, detail); } catch (e) {} }
  }

  async function verify(file, meta) {
    meta = meta || {};
    var onStep = meta.onStep;
    if (!meta.sb || !meta.userId) throw new Error('Verifier misconfigured (missing sb/userId)');
    if (!file) throw new Error('No file to verify');
    var checks = [];

    /* 1 — rate / spam */
    fire(onStep, 'ratelimit', 'run');
    var rl = await rateCheck(meta.sb, meta.userId);
    checks.push({ name: 'ratelimit', result: rl });
    fire(onStep, 'ratelimit', rl.block ? 'block' : 'pass', rl.detail);
    if (rl.block) return { verdict: 'block', reason: rl.detail, phash: null, checks: checks };

    /* 2 — perceptual duplicate */
    fire(onStep, 'duplicate', 'run');
    var phash = null;
    try { phash = await computeDHash(file); } catch (e) { phash = null; }
    var dup = await dupCheck(meta.sb, phash);
    checks.push({ name: 'duplicate', result: dup });
    fire(onStep, 'duplicate', dup.block ? 'block' : (dup.flag ? 'flag' : 'pass'), dup.detail);
    if (dup.block) return { verdict: 'block', reason: dup.detail, phash: phash, checks: checks };

    /* 3 — AI metadata */
    fire(onStep, 'ai', 'run');
    var ai = await aiCheck(file, meta.pages);
    checks.push({ name: 'ai', result: ai });
    fire(onStep, 'ai', ai.flag ? 'flag' : 'pass', ai.detail);

    if (dup.flag || ai.flag) {
      var reason = [dup.flag ? dup.detail : null, ai.flag ? ai.detail : null].filter(Boolean).join(' · ');
      return { verdict: 'review', reason: reason, phash: phash, checks: checks };
    }
    return { verdict: 'approve', reason: 'All checks passed', phash: phash, checks: checks };
  }

  window.UploadVerifier = {
    config: CONFIG,
    verify: verify,
    computeDHash: computeDHash,
    hamming: hamming,
    scanAIMeta: scanAIMeta,
    _aiApiHook: _aiApiHook
  };
})();
