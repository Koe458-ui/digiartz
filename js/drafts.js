/* ── drafts.js · upload drafts + scheduled uploads ── */
  /* =========================================================
     UPLOAD DRAFTS (updr) — device-local IndexedDB
     ├─ updrSave()        — snapshot the current form (image blob,
     │                      extra pages, fields, thumb focus+zoom)
     ├─ updrLoadStrip()   — purge expired (>7 days) then render
     ├─ updrResume(id)    — load a draft back into the form
     ├─ updrRemove(id,e)  — delete one draft
     └─ published drafts delete themselves (doPfUp → updrActiveId)

     Deliberately CLIENT-side: draft images never hit S3/Supabase,
     so they cost nothing, need no cleanup cron, and a resumed
     draft's File goes through the full upqRun verification exactly
     like a fresh pick. Trade-off: drafts live on this device only
     (stated in the strip's note). Blobs/Files structured-clone
     into IndexedDB natively. Capped at 12 drafts.
     ========================================================= */
  /* Ghost slots rendered = the DESKTOP slot count (4). CSS sizes the
     cards per breakpoint, so on mobile the extra ghosts simply sit
     off to the right of the rail — the visible count is 2/3/4 by
     viewport, and the rail is never short. */
  var UPDR_TTL = 7*24*60*60*1000, UPDR_MAX = 12, UPDR_SLOTS = 4;
  var updrActiveId = null;   // draft currently loaded in the form
  var updrUrls = [];         // object URLs to revoke on re-render
  function updrDb(){
    return new Promise(function(res, rej){
      var rq = indexedDB.open('digiartz-drafts', 1);
      rq.onupgradeneeded = function(){ rq.result.createObjectStore('drafts', {keyPath:'id'}); };
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error); };
    });
  }
  function updrTx(mode, fn){
    return updrDb().then(function(db){
      return new Promise(function(res, rej){
        var tx = db.transaction('drafts', mode);
        var out = fn(tx.objectStore('drafts'));
        tx.oncomplete = function(){ res(out && out.result); };
        tx.onerror = function(){ rej(tx.error); };
      });
    });
  }
  function updrAll(){ return updrTx('readonly', function(st){ return st.getAll(); }); }
  function updrDel(id){ return updrTx('readwrite', function(st){ st.delete(id); }); }
  async function updrSave(){
    if(pfGuestGate()) return;                       /* drafts are per-account-holder too */
    if(document.getElementById('pfUpEditId').value) return; /* no drafts of published pieces */
    if(!pf.upFile){ showToast('Pick an image first'); return; }
    try{
      var all = await updrAll();
      if(!updrActiveId && (all||[]).length >= UPDR_MAX){ showToast('Draft limit reached ('+UPDR_MAX+') — delete one first'); return; }
      var rec = {
        id: updrActiveId || ('dr_'+Date.now()+'_'+Math.random().toString(36).slice(2,7)),
        name: document.getElementById('pfUpNm').value.trim(),
        desc: document.getElementById('pfUpDesc').value.trim(),
        tags: document.getElementById('pfUpTags').value,
        cats: (pf.upCats||[]).slice(),
        software: document.getElementById('pfUpSoftware').value || '',
        file: pf.upFile, fname: pf.upFile.name || 'draft.png', ftype: pf.upFile.type || 'image/png',
        pages: (pf.upPageFiles||[]).slice(),
        thumb: pf.upThumbFocus ? {x:pf.upThumbFocus.x, y:pf.upThumbFocus.y, z:pf.upThumbFocus.z||1} : {x:50,y:50,z:1},
        created: Date.now()
      };
      await updrTx('readwrite', function(st){ st.put(rec); });
      updrActiveId = null;
      showToast('Saved to drafts \u2726 kept for 7 days');
      openPfUpload(); /* fresh form + re-rendered strip */
    }catch(e){ console.error('draft save: '+(e&&e.message)); showToast('Could not save draft on this device'); }
  }
  /* =========================================================
     DRAFT / SCHEDULED PREVIEW (upPv)
     One modal serving both rails. Intentionally carries none of the
     artwork lightbox's social layer (artist identity, report, like,
     bookmark, download, comments) — this is the artist looking at
     their own unpublished piece, so it shows the image plus the
     exact fields they filled in, and one closing action:
       · draft     → "Upload Now" button (plus Edit, so a draft is
                     still editable now that a tap opens preview
                     instead of loading it into the form)
       · scheduled → a countdown line, no action
     ========================================================= */
  var upPvUrl = null;   // object URL to revoke on close
  function upPvRow(label, val){
    if(val===null || val===undefined || val==='') return '';
    return '<div class="upPvRow"><div class="upPvLbl">'+esc(label)+'</div><div class="upPvVal">'+esc(String(val))+'</div></div>';
  }
  function upPvChips(label, arr){
    var list = (arr||[]).filter(function(v){ return v!==null && v!==undefined && String(v).trim()!==''; });
    if(!list.length) return '';
    return '<div class="upPvRow"><div class="upPvLbl">'+esc(label)+'</div><div class="upPvChips">'+
      list.map(function(v){ return '<span class="upPvChip">'+esc(String(v).trim())+'</span>'; }).join('')+'</div></div>';
  }
  function upPvClose(){
    document.getElementById('upPvMod').classList.remove('open');
    if(upPvUrl){ try{ URL.revokeObjectURL(upPvUrl); }catch(_){} upPvUrl = null; }
  }
  /* d = {kind,label,src,name,desc,tags[],cats[],software,pages,footHtml} */
  function upPvOpen(d){
    document.getElementById('upPvKind').textContent = d.label || '';
    var img = document.getElementById('upPvImg');
    img.src = d.src || '';
    img.alt = d.name || '';
    document.getElementById('upPvMeta').innerHTML =
      upPvRow('Title', d.name || 'Untitled') +
      upPvRow('Description', d.desc || '') +
      upPvChips('Categories', d.cats) +
      upPvChips('Tags', d.tags) +
      upPvRow('Software', d.software || '') +
      (d.pages ? upPvRow('Extra images', d.pages + (d.pages===1?' page':' pages')) : '');
    document.getElementById('upPvFoot').innerHTML = d.footHtml || '';
    document.getElementById('upPvMod').classList.add('open');
  }
  /* ── Draft preview ── */
  async function updrPreview(id){
    try{
      var rec = await updrTx('readonly', function(st){ return st.get(id); });
      if(!rec){ showToast('Draft not found'); updrLoadStrip(); return; }
      if(upPvUrl){ try{ URL.revokeObjectURL(upPvUrl); }catch(_){} }
      upPvUrl = URL.createObjectURL(rec.file);
      var daysLeft = Math.max(1, Math.ceil((rec.created + UPDR_TTL - Date.now())/(24*60*60*1000)));
      upPvOpen({
        label:'DRAFT', src:upPvUrl, name:rec.name, desc:rec.desc,
        tags:(rec.tags||'').split(','), cats:rec.cats, software:rec.software,
        pages:(rec.pages&&rec.pages.length)||0,
        footHtml:'<span class="upPvWhen">Auto-deletes in <b>'+daysLeft+'d</b></span>'+
          '<button class="upBtnSec" onclick="upPvClose();updrResume(\''+esc(String(id))+'\')">Edit</button>'+
          '<button class="upBtnPri" onclick="updrPublishNow(\''+esc(String(id))+'\')">📤 Upload Now</button>'
      });
    }catch(e){ showToast('Could not open that draft'); }
  }
  /* Load the draft into the form, then run the normal upload path —
     so it gets the identical verification pipeline as any upload. */
  async function updrPublishNow(id){
    upPvClose();
    await updrResume(id);
    /* let the pages handler finish painting previews before submit */
    setTimeout(function(){ doPfUp(); }, 350);
  }
  /* ── Scheduled preview ── */
  async function uschPreview(id){
    try{
      var res = await sb.from('scheduled_uploads')
        .select('id,name,description,tags,category,software,image_url,publish_at,publish_error,pages')
        .eq('id', id).single();
      var r = res && res.data;
      if(!r){ showToast('Schedule not found'); uschLoad(); return; }
      var foot;
      if(r.publish_error){
        foot = '<span class="upPvWhen bad">'+esc(r.publish_error)+'</span>'+
               '<button class="upBtnSec" onclick="upPvClose();uschCancel(\''+esc(String(id))+'\')">Dismiss</button>';
      }else{
        foot = '<span class="upPvWhen">Publishes in <b>'+esc(uschLeft(r.publish_at))+'</b> \u00B7 '+esc(uschFmt(r.publish_at))+'</span>'+
               '<button class="upBtnSec" onclick="upPvClose();uschCancel(\''+esc(String(id))+'\')">Cancel schedule</button>';
      }
      upPvOpen({
        label:'SCHEDULED', src:r.image_url, name:r.name, desc:r.description,
        tags:r.tags, cats:r.category, software:r.software,
        pages:(r.pages&&r.pages.length)||0, footHtml:foot
      });
    }catch(e){ showToast('Could not open that schedule'); }
  }

  /* =========================================================
     SCHEDULED UPLOADS (usch) — server-side (public.scheduled_uploads)
     ├─ uschPicked()  — the chosen instant as ISO, or '' for "now"
     ├─ uschLoad()    — render the SCHEDULED rail
     └─ uschCancel()  — drop a pending schedule (+ its S3 object)

     Unlike drafts (device-local), these live in Supabase so the
     schedule survives a device change and, crucially, publishes
     without the artist being online: pg_cron runs
     publish_due_scheduled_uploads() every 5 minutes, which moves
     due rows into artworks. Nothing else in the app needs to know
     scheduling exists — artworks only ever holds live rows.
     ========================================================= */
  var USCH_MIN_LEAD = 5*60*1000; /* must be at least 5 min out */
  /* ── Custom schedule picker ──
     A native datetime-local hands the panel to the browser, which
     can't be themed. This builds the same control out of the site's
     own dropdown parts. #pfUpSched (hidden input) still holds a
     "YYYY-MM-DDTHH:MM" local string, so uschPicked() and everything
     downstream is unchanged. ── */
  var pfSched = { y:null, m:null, d:null, vy:0, vm:0 };  /* picked + viewed month */
  function pfSchedPad(n){ return (n<10?'0':'')+n; }
  function pfSchedToggle(e){
    if(e){ e.stopPropagation(); }
    var dd = document.getElementById('pfUpSchedDd');
    var open = dd.classList.toggle('open');
    if(open){
      closePfCatDd();                       /* never two panels at once */
      if(pfSched.y===null){
        var n = new Date();
        pfSched.vy = n.getFullYear(); pfSched.vm = n.getMonth();
      }
      pfSchedBuildTime();
      pfSchedRender();
    }
  }
  function pfSchedClose(){
    var dd = document.getElementById('pfUpSchedDd');
    if(dd) dd.classList.remove('open');
  }
  /* Outside-click close, matching the other dropdowns' behaviour */
  document.addEventListener('click', function(ev){
    var dd = document.getElementById('pfUpSchedDd');
    if(dd && dd.classList.contains('open') && !dd.contains(ev.target)) pfSchedClose();
  });
  function pfSchedBuildTime(){
    var hs = document.getElementById('pfUpSchedH'), ms = document.getElementById('pfUpSchedM');
    if(!hs || hs.options.length) return;    /* build once */
    var i, o;
    for(i=0;i<24;i++){ o=document.createElement('option'); o.value=i; o.textContent=pfSchedPad(i); hs.appendChild(o); }
    for(i=0;i<60;i+=5){ o=document.createElement('option'); o.value=i; o.textContent=pfSchedPad(i); ms.appendChild(o); }
    /* default to roughly an hour out, snapped to 5 min */
    var t = new Date(Date.now()+60*60*1000);
    hs.value = t.getHours(); ms.value = Math.floor(t.getMinutes()/5)*5;
  }
  function pfSchedNav(delta, e){
    if(e){ e.stopPropagation(); }
    pfSched.vm += delta;
    if(pfSched.vm < 0){ pfSched.vm = 11; pfSched.vy--; }
    else if(pfSched.vm > 11){ pfSched.vm = 0; pfSched.vy++; }
    pfSchedRender();
  }
  function pfSchedRender(){
    var grid = document.getElementById('pfUpSchedGrid');
    var mon  = document.getElementById('pfUpSchedMon');
    if(!grid) return;
    var y = pfSched.vy, m = pfSched.vm;
    mon.textContent = new Date(y, m, 1).toLocaleString([], {month:'long', year:'numeric'});
    var first = new Date(y, m, 1).getDay();
    var days  = new Date(y, m+1, 0).getDate();
    var now = new Date();
    var todayKey = now.getFullYear()+'-'+now.getMonth()+'-'+now.getDate();
    var html = '';
    for(var p=0;p<first;p++) html += '<span class="upSchedDay pad"></span>';
    for(var d=1; d<=days; d++){
      /* a day is pickable only if it can still hold a future time */
      var end = new Date(y, m, d, 23, 59, 59);
      var past = end.getTime() < Date.now();
      var cls = 'upSchedDay';
      if(todayKey === y+'-'+m+'-'+d) cls += ' today';
      if(pfSched.y===y && pfSched.m===m && pfSched.d===d) cls += ' sel';
      html += '<button type="button" class="'+cls+'"'+(past?' disabled':'')+
              ' onclick="pfSchedPick('+y+','+m+','+d+',event)">'+d+'</button>';
    }
    grid.innerHTML = html;
  }
  function pfSchedPick(y, m, d, e){
    if(e){ e.stopPropagation(); }
    pfSched.y=y; pfSched.m=m; pfSched.d=d;
    pfSchedRender();
    pfSchedApply();
  }
  /* Writes the hidden input + trigger label from the current state */
  function pfSchedApply(){
    if(pfSched.y===null) return;
    var hs = document.getElementById('pfUpSchedH'), ms = document.getElementById('pfUpSchedM');
    var h = +hs.value || 0, mi = +ms.value || 0;
    document.getElementById('pfUpSched').value =
      pfSched.y+'-'+pfSchedPad(pfSched.m+1)+'-'+pfSchedPad(pfSched.d)+'T'+pfSchedPad(h)+':'+pfSchedPad(mi);
    pfSchedHint();
  }
  function pfSchedClear(e){
    if(e){ e.stopPropagation(); }
    pfSched.y = pfSched.m = pfSched.d = null;
    document.getElementById('pfUpSched').value = '';
    pfSchedRender();
    pfSchedHint();
    pfSchedClose();
  }
  function pfSchedDone(e){
    if(e){ e.stopPropagation(); }
    pfSchedClose();
  }
  /* Resets the control (called by openPfUpload) */
  function pfSchedReset(){
    pfSched.y = pfSched.m = pfSched.d = null;
    var n = new Date();
    pfSched.vy = n.getFullYear(); pfSched.vm = n.getMonth();
    var el = document.getElementById('pfUpSched'); if(el) el.value = '';
    pfSchedClose();
    pfSchedHint();
  }
  function pfSchedHint(){
    var el = document.getElementById('pfUpSched');
    var hint = document.getElementById('pfUpSchedHint');
    if(!el || !hint) return;
    /* trigger label doubles as the __/__/____ __:__ mask when empty */
    var lbl = document.getElementById('pfUpSchedLbl');
    if(lbl){
      if(el.value){
        lbl.textContent = uschFmt(new Date(el.value).toISOString());
        lbl.classList.remove('upSchedPh');
      }else{
        lbl.innerHTML = '__/__/____&nbsp;&nbsp;__:__';
        lbl.classList.add('upSchedPh');
      }
    }
    if(!el.value){ hint.textContent = 'Leave empty to publish immediately.'; hint.classList.remove('bad'); return; }
    var t = new Date(el.value).getTime();
    if(!isFinite(t) || t < Date.now() + USCH_MIN_LEAD){
      hint.textContent = 'Pick a time at least 5 minutes from now.'; hint.classList.add('bad');
    }else{
      hint.textContent = 'Publishes ' + uschFmt(new Date(t).toISOString()) + ' \u00B7 verified now, re-checked at publish.'; hint.classList.remove('bad');
    }
  }
  /* '' when empty or invalid — doPfUp treats that as "publish now",
     and pfSchedHint has already flagged an invalid time to the user. */
  function uschPicked(){
    var el = document.getElementById('pfUpSched');
    if(!el || !el.value) return '';
    var t = new Date(el.value).getTime();
    if(!isFinite(t) || t < Date.now() + USCH_MIN_LEAD) return '';
    return new Date(t).toISOString();
  }
  function uschFmt(iso){
    var d = new Date(iso);
    return d.toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  }
  /* Compact countdown for the corner mark: 6d / 5h / 20m */
  function uschLeft(iso){
    var ms = new Date(iso).getTime() - Date.now();
    if(ms <= 0) return 'due';
    var m = Math.round(ms/60000);
    if(m < 60) return m+'m';
    var h = Math.round(m/60);
    if(h < 24) return h+'h';
    return Math.round(h/24)+'d';
  }
  function uschGhost(){
    return '<div class="upDraftCard upDraftGhost" aria-hidden="true">'+
      '<span class="upDraftGhostIn">\u23F1</span>'+
      '<span class="upDraftExp upSchedMark">--</span></div>';
  }
  async function uschLoad(){
    var sec = document.getElementById('upSchedSec');
    var row = document.getElementById('upSchedRow');
    if(!sec || !row) return;
    var edEl = document.getElementById('pfUpEditId');
    if(edEl && edEl.value) return;   /* edit mode hides this card */
    sec.style.display = '';
    var list = [];
    if(currentUser && typeof sb!=='undefined'){
      try{
        var res = await sb.from('scheduled_uploads')
          .select('id,name,publish_at,image_url,storage_path,thumb_x,thumb_y,thumb_zoom,publish_error')
          /* preview pulls its own full row on open — the rail only
             needs what it renders */
          .eq('user_id', currentUser.id).order('publish_at', {ascending:true}).limit(24);
        list = (res && res.data) ? res.data : [];
      }catch(e){ list = []; }
    }
    row.innerHTML = list.map(function(r){
      /* A row that failed its publish-time gate keeps its card, but
         marked red with the reason — so a piece never fails silently
         (the artist also gets a notification). */
      var bad = !!r.publish_error;
      var tip = esc(r.name||'Untitled') + ' \u00B7 ' + (bad ? esc(r.publish_error) : esc(uschFmt(r.publish_at)));
      return '<div class="upDraftCard'+(bad?' upSchedBad':'')+'" onclick="uschPreview(\''+esc(String(r.id))+'\')" role="button" tabindex="0" title="'+tip+'" aria-label="'+(bad?'Failed: ':'Scheduled: ')+esc(r.name||'Untitled')+'">'+
        '<img src="'+esc(getThumbnailUrl(r.image_url))+'" alt="" style="'+thumbStyle(r.thumb_x, r.thumb_y, r.thumb_zoom)+'">'+
        '<button type="button" class="upDraftX" onclick="uschCancel(\''+esc(String(r.id))+'\',event)" aria-label="'+(bad?'Dismiss':'Cancel schedule')+'">✕</button>'+
        '<span class="upDraftExp'+(bad?'':' upSchedMark')+'">'+(bad?'!':uschLeft(r.publish_at))+'</span>'+
      '</div>';
    }).join('') + Array(Math.max(0, UPDR_SLOTS - list.length) + 1).join(uschGhost());
  }
  async function uschCancel(id, e){
    if(e){ e.stopPropagation(); }
    try{
      /* Read the storage path first so the orphaned S3 object goes
         with the row — cancelling should not leave paid storage. */
      var got = await sb.from('scheduled_uploads').select('storage_path').eq('id', id).single();
      var del = await sb.from('scheduled_uploads').delete().eq('id', id);
      if(del && del.error) throw del.error;
      if(got && got.data && got.data.storage_path){
        try{ await s3Delete(BUCKET, got.data.storage_path); }catch(_){}
      }
      uschLoad();
      showToast('Schedule cancelled');
    }catch(err){ showToast('Could not cancel that schedule'); }
  }

  /* One ghost slot — an inert placeholder with a real card's box
     metrics, used to keep the rail filled. */
  function updrGhost(){
    return '<div class="upDraftCard upDraftGhost" aria-hidden="true">'+
      '<span class="upDraftGhostIn">\u2726</span>'+
      '<span class="upDraftExp">7d</span></div>';
  }
  async function updrLoadStrip(){
    var sec = document.getElementById('upDraftSec');
    var row = document.getElementById('upDraftRow');
    if(!sec || !row) return;
    /* Edit mode hides this card outright — and because this runs
       async, it could otherwise re-show it after mwEditArt() hid
       it. Bail before touching display. */
    var edEl = document.getElementById('pfUpEditId');
    if(edEl && edEl.value){ return; }
    /* The card now ALWAYS shows: ghosts fill the space when there's
       nothing saved (or nothing readable — guests, private mode, no
       IndexedDB), so it never collapses to a blank box. */
    sec.style.display = '';
    var list = [];
    if(currentUser && window.indexedDB){
      try{
        list = (await updrAll()) || [];
        /* 1-week auto-delete — purge anything past its TTL */
        var now = Date.now(), dead = list.filter(function(r){ return (now - r.created) > UPDR_TTL; });
        for(var i=0;i<dead.length;i++){ await updrDel(dead[i].id); }
        if(dead.length) list = list.filter(function(r){ return (now - r.created) <= UPDR_TTL; });
      }catch(e){ list = []; }
    }
    updrUrls.forEach(function(u){ try{ URL.revokeObjectURL(u); }catch(_){}}); updrUrls = [];
    list.sort(function(a,b){ return b.created - a.created; });
    row.innerHTML = list.map(function(r){
      var daysLeft = Math.max(1, Math.ceil((r.created + UPDR_TTL - Date.now())/(24*60*60*1000)));
      var u = URL.createObjectURL(r.file); updrUrls.push(u);
      /* title lives in the tooltip now — the tile itself stays a
         clean square like an artwork card */
      return '<div class="upDraftCard" onclick="updrPreview(\''+r.id+'\')" role="button" tabindex="0" title="'+esc(r.name||'Untitled draft')+'" aria-label="Preview draft: '+esc(r.name||'Untitled draft')+'">'+
        '<img src="'+u+'" alt="" style="'+thumbStyle(r.thumb&&r.thumb.x, r.thumb&&r.thumb.y, r.thumb&&r.thumb.z)+'">'+
        '<button type="button" class="upDraftX" onclick="updrRemove(\''+r.id+'\',event)" aria-label="Delete draft">✕</button>'+
        '<span class="upDraftExp">'+daysLeft+'d</span>'+
      '</div>';
    }).join('') + Array(Math.max(0, UPDR_SLOTS - list.length) + 1).join(updrGhost());
  }
  async function updrResume(id){
    try{
      var rec = await updrTx('readonly', function(st){ return st.get(id); });
      if(!rec){ showToast('Draft not found'); updrLoadStrip(); return; }
      openPfUpload(); /* clean slate first (also re-renders the strip) */
      updrActiveId = rec.id;
      pf.upFile = new File([rec.file], rec.fname, {type:rec.ftype});
      pf.upThumbFocus = rec.thumb || {x:50,y:50,z:1};
      document.getElementById('pfUpNm').value = rec.name||'';
      document.getElementById('pfUpDesc').value = rec.desc||'';
      pfUpdateCount('pfUpNm','pfUpNmCount',100);
      pfUpdateCount('pfUpDesc','pfUpDescCount',1000);
      pfSetTagsFromArray((rec.tags||'').split(',').map(function(t){return t.trim();}).filter(Boolean));
      pfSetCats(rec.cats&&rec.cats.length?rec.cats:['others']);
      if(typeof pfSetSoftware==='function') pfSetSoftware(rec.software||'');
      /* preview straight from the blob — no FileReader round-trip */
      var u = URL.createObjectURL(pf.upFile); updrUrls.push(u);
      var p = document.getElementById('pfUpPrev');
      p.src = u;
      p.style.cssText = thumbStyle(pf.upThumbFocus.x, pf.upThumbFocus.y, pf.upThumbFocus.z);
      document.getElementById('pfUpPrevWrap').style.display = 'block';
      document.getElementById('pfUpThumbBtn').style.display = '';
      /* extra pages replay through the normal handler so previews +
         pf.upPageFiles stay in sync with the real pick path */
      if(rec.pages && rec.pages.length){
        handlePfPagesFile({target:{files:rec.pages.map(function(b,i){ return new File([b], 'page'+(i+1)+'.png', {type:b.type||'image/png'}); })}});
      }
      showToast('Draft loaded \u2726 finish it up');
    }catch(e){ console.error('draft resume: '+(e&&e.message)); showToast('Could not load that draft'); }
  }
  async function updrRemove(id, e){
    if(e){ e.stopPropagation(); }
    try{
      await updrDel(id);
      if(updrActiveId===id) updrActiveId=null;
      updrLoadStrip();
      showToast('Draft deleted');
    }catch(err){ showToast('Could not delete draft'); }
  }

  var pfCropPending = null; // the File waiting to become pf.upFile once confirmed
  var pfCrop = { natW:0, natH:0, stage:280, x:50, y:50, z:1, axis:null, dragging:false, sx:0, sy:0, ox:50, oy:50 };
  function openPfCrop(file, dataUrl, seed){
    /* seed ({x,y}) — passed by reopenPfCrop() so "Adjust Thumbnail"
       starts from the CURRENT focal point instead of resetting to
       center. First-time picks pass no seed and start at 50/50. */
    pfCropPending = file;
    var img = document.getElementById('pfCropImg');
    var ready = function(){
      var stageEl = document.getElementById('pfCropStage');
      pfCrop.stage = stageEl.getBoundingClientRect().width || 280;
      pfCrop.natW = img.naturalWidth; pfCrop.natH = img.naturalHeight;
      /* object-fit:cover only ever overflows on one axis (the longer
         one relative to the square box), so only that axis is
         draggable — matches how the CSS crop actually behaves. */
      pfCrop.axis = (pfCrop.natW/pfCrop.natH) > 1 ? 'x' : (pfCrop.natW/pfCrop.natH) < 1 ? 'y' : null;
      pfCrop.x = (seed && isFinite(+seed.x)) ? Math.max(0,Math.min(100,+seed.x)) : 50;
      pfCrop.y = (seed && isFinite(+seed.y)) ? Math.max(0,Math.min(100,+seed.y)) : 50;
      pfCrop.z = (seed && isFinite(+seed.z)) ? Math.max(1,Math.min(2,+seed.z)) : 1;
      var zs = document.getElementById('pfCropZoom');
      if(zs) zs.value = Math.round(pfCrop.z*100);
      pfCropRender();
      document.getElementById('pfCropMod').classList.add('open');
    };
    img.onload = ready;
    img.src = dataUrl;
    /* Re-opening with the SAME dataURL (Adjust Thumbnail) doesn't
       re-fire load in every browser — run directly if it's already
       decoded. Worst case ready() runs twice; it's idempotent. */
    if(img.complete && img.naturalWidth) ready();
  }
  /* ── Adjust Thumbnail — reopen the picker for the piece already
     in the form, seeded with the current focal point AND zoom. The
     preview src IS the original dataURL from the first pass, so no
     FileReader round-trip is needed. Cancel in the picker keeps the
     existing focal point + zoom untouched. ── */
  function reopenPfCrop(){
    var prev = document.getElementById('pfUpPrev');
    if(!pf.upFile || !prev.src){ showToast('Choose an image first'); return; }
    openPfCrop(pf.upFile, prev.src, pf.upThumbFocus);
  }
  function pfCropRender(){
    var img = document.getElementById('pfCropImg');
    img.style.objectPosition = pfCrop.x+'% '+pfCrop.y+'%';
    /* Scale about the focal point so the framed area stays anchored
       while zooming — the exact CSS the site's thumbnails render
       with (thumbStyle), so this preview IS the final crop. */
    img.style.transform = pfCrop.z>1 ? 'scale('+pfCrop.z+')' : '';
    img.style.transformOrigin = pfCrop.z>1 ? (pfCrop.x+'% '+pfCrop.y+'%') : '';
  }
  function pfCropSetZoom(v){
    pfCrop.z = Math.max(1, Math.min(2, (+v||100)/100));
    pfCropRender();
  }
  function pfCropNudgeZoom(d){
    var zs = document.getElementById('pfCropZoom');
    if(!zs) return;
    var v = Math.max(100, Math.min(200, (+zs.value||100) + d));
    zs.value = v;
    pfCropSetZoom(v);
  }
  (function initPfCropDrag(){
    var stageEl = null;
    function down(e){
      if(!pfCrop.axis && pfCrop.z<=1) return; // nothing to drag at 1× — image already matches the square
      stageEl = document.getElementById('pfCropStage');
      pfCrop.dragging = true; stageEl.classList.add('dragging');
      var p = e.touches ? e.touches[0] : e;
      pfCrop.sx = p.clientX; pfCrop.sy = p.clientY;
      pfCrop.ox = pfCrop.x; pfCrop.oy = pfCrop.y;
      /* FIX: move/up listeners attach only for the drag's duration.
         Registered permanently, the non-passive touchmove forced the
         browser to wait on this handler for EVERY touch scroll on the
         whole site — measurable scroll jank on mobile. */
      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, {passive:false});
      document.addEventListener('mouseup', up);
      document.addEventListener('touchend', up);
      e.preventDefault();
    }
    function move(e){
      if(!pfCrop.dragging) return;
      var p = e.touches ? e.touches[0] : e;
      /* Convert a screen-pixel drag into object-position % changes.
         At stage size S and zoom Z, the drawn image spans S*ratio*Z
         px per axis (ratio≥1 only on the long axis) against an S px
         window, so the pan range is S*(ratio*Z − 1). At Z=1 this
         collapses to the old single-axis long-side-only behavior;
         at Z>1 BOTH axes overflow and become draggable. Because the
         scale origin tracks the same focal %, object-position maps
         LINEARLY across the whole range even under the transform —
         so one % pair still describes the crop exactly. */
      var rx = pfCrop.natW>=pfCrop.natH ? pfCrop.natW/pfCrop.natH : 1;
      var ry = pfCrop.natH>pfCrop.natW ? pfCrop.natH/pfCrop.natW : 1;
      var oxPx = pfCrop.stage*(rx*pfCrop.z-1);
      var oyPx = pfCrop.stage*(ry*pfCrop.z-1);
      if(oxPx<=0 && oyPx<=0) return;
      /* dragging right/down reveals the left/top side */
      if(oxPx>0) pfCrop.x = Math.max(0, Math.min(100, pfCrop.ox - ((p.clientX-pfCrop.sx)/oxPx)*100));
      if(oyPx>0) pfCrop.y = Math.max(0, Math.min(100, pfCrop.oy - ((p.clientY-pfCrop.sy)/oyPx)*100));
      pfCropRender();
    }
    function up(){
      pfCrop.dragging = false;
      if(stageEl) stageEl.classList.remove('dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchend', up);
    }
    document.addEventListener('DOMContentLoaded', function(){
      var el = document.getElementById('pfCropStage');
      if(!el) return;
      el.addEventListener('mousedown', down);
      el.addEventListener('touchstart', down, {passive:false});
    });
  })();
  function cancelPfCrop(){
    document.getElementById('pfCropMod').classList.remove('open');
    pfCropPending = null;
    document.getElementById('pfUpF').value = '';
  }
  function confirmPfCrop(){
    pf.upFile = pfCropPending;
    pf.upThumbFocus = { x: Math.round(pfCrop.x), y: Math.round(pfCrop.y), z: Math.round(pfCrop.z*100)/100 };
    var p = document.getElementById('pfUpPrev');
    p.src = document.getElementById('pfCropImg').src;
    p.style.cssText = thumbStyle(pfCrop.x, pfCrop.y, pfCrop.z);
    var pw = document.getElementById('pfUpPrevWrap');
    if(pw) pw.style.display = 'block';
    /* A confirmed thumbnail can always be redone before uploading.
       This path only runs in NEW-upload mode (edit mode hides the
       dropzone entirely), so no edit-mode guard is needed here. */
    var tb = document.getElementById('pfUpThumbBtn');
    if(tb) tb.style.display = '';
    document.getElementById('pfCropMod').classList.remove('open');
    pfCropPending = null;
  }
  function handlePfPagesFile(e){
    if(pfGuestGate(e)) return; /* drop path bypasses the input's click gate */
    var files = Array.from(e.target.files||[]);
    pf.upPageFiles = pf.upPageFiles.concat(files);
    var wrap = document.getElementById('pfPagesPreview');
    files.forEach(function(f){
      var r = new FileReader();
      r.onload = function(ev){
        var img = document.createElement('img');
        img.src = ev.target.result;
        wrap.appendChild(img);
      };
      r.readAsDataURL(f);
    });
  }
  var pfDzEl = document.getElementById('pfDz');
  if(pfDzEl){
    ['dragenter','dragover'].forEach(function(ev){ pfDzEl.addEventListener(ev,function(e){e.preventDefault();pfDzEl.classList.add('over');}); });
    ['dragleave','drop'].forEach(function(ev){ pfDzEl.addEventListener(ev,function(e){e.preventDefault();pfDzEl.classList.remove('over');}); });
    pfDzEl.addEventListener('drop',function(e){ var f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('image/')) handlePfFile({target:{files:[f]}}); });
  }

  async function doPfUp(){
    if(pfGuestGate()) return; /* guest submit → login, back here after */
    var editIdEl = document.getElementById('pfUpEditId');
    var editId = editIdEl ? editIdEl.value : '';
    /* Universal upload — any signed-in user, from anywhere (nav ➕, home,
       or while viewing someone else's profile). Rows always insert with
       user_id: currentUser.id, and edits are ownership-checked by mwEditArt
       plus the "own rows only" RLS update policy. No pf.isOwner gate. */
    var nm = document.getElementById('pfUpNm').value.trim();
    var desc = document.getElementById('pfUpDesc').value.trim();
    var software = document.getElementById('pfUpSoftware').value;
    var tags = document.getElementById('pfUpTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean);
    if(!nm){ showToast('Enter a title'); return; }
    if(!editId && !pf.upFile){ showToast('Select an image'); return; }
    if(!software){ showToast('Select the software used'); return; }
    var btn = document.getElementById('pfUpBtn');
    btn.disabled = true;
    try{
      {
        if(editId){
          /* Edit reaches here from either the owner's profile-page
             upload menu, or the Edit My Work page (mwEditArt) —
             both are ownership-gated before this point. */
          btn.textContent='SAVING…';
          var editCats = pf.upCats.length ? pf.upCats : ['others'];
          const{error}=await sb.from('artworks').update({name:nm,description:desc||null,tags:tags,category:editCats,software:software||null}).eq('id',editId);
          if(error) throw error;
          /* Every in-memory copy of the row must be patched, or the DB and the
             screen disagree until a hard refresh. `images` also needs category +
             software — without them the gallery's category filter keeps sorting
             the piece under its OLD category. */
          var idx = images.findIndex(function(i){return String(i.id)===String(editId);});
          if(idx!==-1){ images[idx].name=nm; images[idx].description=desc||null; images[idx].tags=tags; images[idx].category=editCats; images[idx].software=software||null; }
          var mwIdx = mw.art.findIndex(function(i){return String(i.id)===String(editId);});
          if(mwIdx!==-1){ mw.art[mwIdx].name=nm; mw.art[mwIdx].description=desc||null; mw.art[mwIdx].tags=tags; mw.art[mwIdx].category=editCats; mw.art[mwIdx].software=software||null; }
          /* pfRenderGallery() paints from pf.galleryRows — patch that row too,
             otherwise the repaint below just re-draws the pre-edit data. */
          var pgIdx = Array.isArray(pf.galleryRows) ? pf.galleryRows.findIndex(function(i){return String(i.id)===String(editId);}) : -1;
          if(pgIdx!==-1){ pf.galleryRows[pgIdx].name=nm; pf.galleryRows[pgIdx].description=desc||null; pf.galleryRows[pgIdx].tags=tags; pf.galleryRows[pgIdx].category=editCats; pf.galleryRows[pgIdx].software=software||null; }
          pfRenderGallery();
          if(typeof mwRenderArt==='function') mwRenderArt();
          if(typeof renderHome==='function') renderHome();
          closePfUpload(); showToast('Artwork updated ✦');
        } else {
          /* ── Background pipeline — the popup closes IMMEDIATELY and
             the piece runs CHECKING → UPLOADING → ALMOST DONE → LIVE
             as a blurred card at the top of the uploader's own grids
             (profile gallery + My Work), so another piece can be
             queued while this one is still verifying. Everything the
             pipeline needs is snapshotted NOW — closePfUpload() wipes
             pf.upFile / pf.upPageFiles the moment it runs. The S3
             upload, DB insert and check-failure handling all live in
             upqRun() below. */
          var prevEl = document.getElementById('pfUpPrev');
          /* Read the schedule BEFORE anything resets the form */
          var _schedAt = uschPicked();
          upqStart({
            name: nm, desc: desc, tags: tags, software: software,
            cats: (pf.upCats && pf.upCats.length) ? pf.upCats.slice() : ['others'],
            file: pf.upFile,
            pageFiles: (pf.upPageFiles || []).slice(),
            thumbFocus: pf.upThumbFocus ? { x: pf.upThumbFocus.x, y: pf.upThumbFocus.y, z: pf.upThumbFocus.z || 1 } : { x: 50, y: 50, z: 1 },
            preview: (prevEl && prevEl.src) ? prevEl.src : '',
            /* Optional album ids — snapshotted NOW because
               pfUpResetSession() clears pf.upAlbums moments later. */
            albums: (pf.upAlbums || []).slice(),
            /* ISO instant or '' — set means the row goes to
               scheduled_uploads instead of artworks (see upqRun). */
            publishAt: _schedAt
          });
          /* A resumed draft that just queued is done being a draft */
          if(updrActiveId){ updrDel(updrActiveId); updrActiveId = null; }
          /* Scheduled pieces never appear on the profile yet, so the
             profile redirect would land on nothing. Stay on a fresh
             upload page instead — the SCHEDULED rail picks the new
             card up as soon as the row lands. openPfUpload() runs
             pfUpResetSession(), so the form is already clean and the
             artist can queue the next piece immediately. */
          if(_schedAt){
            openPfUpload();
            showToast('Scheduled \u2726 publishes ' + uschFmt(_schedAt));
            return;
          }
          /* Normal upload: the job now owns its own copies of the
             files, so clear the form right away — returning to
             Upload (or uploading again) always starts fresh. */
          pfUpResetSession();
          closePfUpload();
          /* Redirect straight to the uploader's OWN profile — the
             blurred verification card (CHECKING → UPLOADING →
             ALMOST DONE → LIVE) leads their gallery grid there via
             upqOwnQueueHTML(), so they watch verification start
             immediately. Fire-and-forget: the queue job runs in
             parallel regardless. */
          openOwnProfile();
          if(typeof bnSetActive==='function') bnSetActive('bnProfile');
          showToast('Verifying your artwork \u2726 watch it on your profile');
        }
      }
    }catch(err){ console.error('Error: '+err.message);
      /* Merit gate (<80) surfaces as a raw RLS error — explain it. */
      if(window.meritDenied && window.meritDenied(err, 'upload')) return;
      showToast(safeErr(err, 'Upload failed \u2014 try again')); }
    finally{ btn.disabled=false; btn.textContent = editId ? '📤 Save Changes' : '📤 Upload Artwork'; }
  }

