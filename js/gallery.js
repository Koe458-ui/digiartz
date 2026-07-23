/* ── gallery.js · gallery sections + artwork viewer + report flow ── */
  /* ═══════════════════════════════════════════════════════════════
     GALLERY SECTIONS
     Artworks / Resources / Blog / Marketplace / Jobs / Cart.
     Artworks is the live one (grid + category/sort filter). The other
     five are shells: a search field and a filter whose options are
     listed below, with nothing to search yet. They are here so the
     navigation is real while the data lands behind it — each `opts`
     list is the menu that section's filter offers.
     ═══════════════════════════════════════════════════════════════ */
  var FG_SECTIONS = {
    resources:   { label:'Resources',   opts:['Tutorials','Brushes','Textures','Fonts','PSD Files','3D Assets','References','Color Palettes','Mockups','Templates','Icons','Plugins'] },
    blog:        { label:'Blog',        opts:['News','Community','Artist Spotlights','Tips & Guides','Interviews','Reviews','Events','Challenges','Releases','Announcements'] },
    marketplace: { label:'Marketplace', opts:['Artwork','Prints','Digital Downloads','Website Templates','UI Kits','Icons','Brushes','3D Models','Commissions','Services'] },
    jobs:        { label:'Jobs',        opts:['Freelance','Full-Time','Part-Time','Remote','Internship','Contest','Hiring Artists','Collaboration'] },
    cart:        { label:'Cart',        opts:['Shopping Cart','Saved for Later','Checkout','Orders','Downloads','Licenses'] }
  };
  var fgSection = 'artworks';           /* which tab is showing        */
  var fgFltMode = 'artworks';           /* which body the panel serves */
  var fgSecFilter = {};                 /* section id → chosen option  */
  var fgSecQuery  = {};                 /* section id → typed query    */

  function fgSwitchSection(id){
    if(!id) return;
    var secs=document.querySelectorAll('#fg .fgSec'), i;
    for(i=0;i<secs.length;i++) secs[i].classList.toggle('active', secs[i].id==='fgSec-'+id);
    var btns=document.querySelectorAll('#fgSecTabs .fgSecBtn'), on;
    for(i=0;i<btns.length;i++){
      on = btns[i].id==='fgSecBtn-'+id;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-selected', on?'true':'false');
    }
    fgSection=id;
    var fg=document.getElementById('fg'); if(fg) fg.scrollTop=0;
    /* The rail measures widths to pack its two rows, which it can only
       do while its section is actually displayed. */
    if(id==='artworks' && typeof tgRenderRail==='function'){ try{ tgRenderRail(false); }catch(e){} }
    /* Sections load on first visit, not on page load — five extra
       queries for tabs nobody opened would be wasted work. */
    if(id!=='artworks' && typeof dzSecEnter==='function') dzSecEnter(id);
  }

  /* Stub sections have nothing to filter yet, so the query is simply
     held. Wiring one up later means rendering into #fgSecC-<id> here. */
  var fgSecQTimer={};
  function fgSecSearchInput(id,v){
    fgSecQuery[id]=String(v||'');
    var w=document.getElementById(id+'SearchWrap');
    if(w) w.classList.toggle('tgHasQ', !!fgSecQuery[id].length);
    /* Debounced for the same reason the artwork bar is: repainting
       per keystroke makes typing feel like it's fighting back. */
    clearTimeout(fgSecQTimer[id]);
    fgSecQTimer[id]=setTimeout(function(){
      if(typeof dzSecRender==='function') dzSecRender(id);
    },140);
  }
  function fgSecSearchClear(id){
    var el=document.getElementById(id+'SearchIn');
    if(el){ el.value=''; el.focus(); }
    fgSecSearchInput(id,'');
  }

  /* Builds the shared panel's body from FG_SECTIONS[id].opts. */
  function openSecFilter(id){
    var sec=FG_SECTIONS[id]; if(!sec) return;
    fgFltMode=id;
    var cur=fgSecFilter[id]||'all', html='<div class="fltSec"><div class="fltSecLbl">'+
      sec.label.toUpperCase()+'</div><div class="fltOpts" id="fltSecOpts">'+
      '<label class="fltOpt"><input type="radio" name="fltSec" value="all"'+
      (cur==='all'?' checked':'')+'><div class="fltDot"></div>'+fltIco('all')+
      '<span class="fltLbl">ALL</span></label>';
    for(var i=0;i<sec.opts.length;i++){
      var o=sec.opts[i], v=o.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      html+='<label class="fltOpt"><input type="radio" name="fltSec" value="'+v+'"'+
        (cur===v?' checked':'')+'><div class="fltDot"></div>'+fltIco(v)+
        '<span class="fltLbl">'+o.toUpperCase()+'</span></label>';
    }
    html+='</div></div><div class="fltSep"></div>';
    var body=document.getElementById('fltSecBody');
    if(body){ body.innerHTML=html; body.style.display=''; }
    var art=document.getElementById('fltArtBody'); if(art) art.style.display='none';
    var t=document.getElementById('fltPTitle'); if(t) t.textContent=sec.label.toUpperCase();
    document.getElementById('fgFltOvr').classList.add('open');
    document.getElementById('fgFltPanel').classList.add('open');
  }
  function applySecFilter(){
    var id=fgFltMode, r=document.querySelector('input[name="fltSec"]:checked');
    fgSecFilter[id]=r?r.value:'all';
    var btn=document.getElementById('fgSecFltBtn-'+id);
    if(btn) btn.classList.toggle('active', fgSecFilter[id]!=='all');
    closeFilterPanel();
    if(typeof dzSecRender==='function') dzSecRender(id);
  }

  /* Reachable from inline handlers regardless of how this block is scoped. */
  window.fgSwitchSection=fgSwitchSection;
  window.fgSecSearchInput=fgSecSearchInput;
  window.fgSecSearchClear=fgSecSearchClear;
  window.openSecFilter=openSecFilter;
  window.applySecFilter=applySecFilter;
  function closeFG(){
    document.getElementById('fg').classList.remove('open');
    restoreScroll();
    /* Reset category filter to 'all' so next open is always clean */
    filterCat = 'all';
    var catR = document.querySelector('input[name="fltCat"][value="all"]');
    if(catR) catR.checked = true;
  }
  /* ── Artwork viewer: open/close ──
     #artModal is the fixed, blurred backdrop. .avBox is the fixed-size
     two-pane card inside it (image pane + scrollable detail sidebar).
     Closing plays the .closing animation class for ~220ms before the
     modal is fully hidden. */
  var amCloseTimer = null;
  var avNavList = [];
  var avNavIndex = -1;
  var avZoomLevel = 1, avPanX = 0, avPanY = 0;
  var avCurrentArt = null;
  /* ── Multi-image artworks ──
     avImages holds every image for the item currently open in the
     lightbox: the cover (image_url) first, then any extras from
     `pages`. avNav()'s prev/next arrows page between *artworks*;
     these page between images *within* one artwork. */
  var avImages = [];
  var avImgIdx = 0;

  /* Cover first, then extras, de-duplicated. Falls back to the raw src
     when we have no row object (e.g. a card clicked before load). */
  function avImageList(art, src){
    var list = [];
    if(art && art.image_url) list.push(art.image_url);
    else if(src) list.push(src);
    var pages = art && art.pages;
    if(typeof pages === 'string'){ try{ pages = JSON.parse(pages); }catch(e){ pages = null; } }
    if(Array.isArray(pages)){
      pages.forEach(function(u){ if(u && list.indexOf(u) === -1) list.push(u); });
    }
    return list;
  }
  /* Build the thumbnail strip. openLB has already painted image 0, so
     this only sets state + chrome — it never re-loads the main image. */
  function avBuildStrip(art, src){
    avImages = avImageList(art, src);
    avImgIdx = 0;
    var strip = document.getElementById('avStrip');
    var cnt   = document.getElementById('avImgCount');
    if(!strip) return;
    if(avImages.length < 2){
      strip.hidden = true; strip.innerHTML = '';
      if(cnt) cnt.hidden = true;
      var st0 = document.getElementById('avImgStack');
      if(st0){ st0.hidden = true; st0.innerHTML = ''; }
      return;
    }
    /* Stacked layout: image 1 stays in the zoomable viewport, images
       2..n render full-width below it. The strip stays retired. */
    strip.hidden = true; strip.innerHTML = '';
    if(cnt){ cnt.hidden = true; }   /* counter box retired */
    var stack = document.getElementById('avImgStack');
    if(stack){
      stack.hidden = false;
      stack.innerHTML = avImages.slice(1).map(function(u,n){
        return '<img src="'+esc(getViewUrl(u))+'" alt="Image '+(n+2)+' of '+avImages.length+'" loading="lazy" decoding="async">';
      }).join('');
    }
  }
  /* Swap the main image. Download always follows the visible image, so
     currentLightboxImageSrc is repointed at the untouched original. */
  function avShowImage(i){
    if(!avImages.length) return;
    avImgIdx = Math.max(0, Math.min(i, avImages.length - 1));
    var url = avImages[avImgIdx];
    currentLightboxImageSrc = url;
    var viewport = document.getElementById('avImgViewport');
    var imgEl    = document.getElementById('lbImg');
    if(viewport) viewport.classList.add('loading');
    avResetZoom();
    if(imgEl){
      imgEl.src = getViewUrl(url);
      /* A browser-cached image can finish before (or without) firing onload,
         which would leave the img stuck at opacity:0 behind the loading
         state. If it's already decoded, drop the loading class now. */
      if(imgEl.complete && imgEl.naturalWidth && viewport) viewport.classList.remove('loading');
    }
    var strip = document.getElementById('avStrip');
    if(strip){
      Array.prototype.forEach.call(strip.children, function(btn,n){
        btn.classList.toggle('active', n === avImgIdx);
        btn.setAttribute('aria-selected', n === avImgIdx ? 'true' : 'false');
      });
      /* With a lot of images the active thumb can sit off-screen. */
      var activeThumb = strip.children[avImgIdx];
      if(activeThumb && activeThumb.scrollIntoView){
        activeThumb.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
      }
    }
    var cnt = document.getElementById('avImgCount');
    if(cnt){ cnt.textContent = (avImgIdx+1)+' / '+avImages.length; cnt.hidden = avImages.length < 2; }
  }

  function avCap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

  function avFormatDate(iso){
    if(!iso) return null;
    try{
      var d = new Date(iso);
      if(isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    }catch(e){ return null; }
  }

  function avRenderMeta(m){
    /* Only include rows we actually have data for. A linked image with
       no backing artwork record (e.g. opened from a comment) has no
       category/medium/upload-date, so those rows are omitted entirely
       rather than rendered as "—" clutter. Resolution is always shown
       since it's read straight off the loaded image, not the record. */
    var rows = [];
    if(m.hasArt){
      if(m.category) rows.push(['Category', avCap(m.category)]);
      rows.push(['Medium', 'Digital Art']);
      if(m.software) rows.push(['Software', m.software]);
    }
    rows.push(['Resolution', '—', 'avMetaResVal']);
    if(m.hasArt && m.createdAt) rows.push(['Uploaded', avFormatDate(m.createdAt) || '—']);
    var list = document.getElementById('avMetaList');
    if(!list) return;
    list.innerHTML = rows.map(function(r){
      var valId = r[2] ? ' id="'+r[2]+'"' : '';
      return '<div class="avMetaRow"><span class="avMetaLbl">'+esc(r[0])+'</span><span class="avMetaVal"'+valId+'>'+esc(r[1])+'</span></div>';
    }).join('');
  }
  function avUpdateResolution(w,h){
    var el = document.getElementById('avMetaResVal');
    if(el && w && h) el.textContent = w+' × '+h+' px';
  }

  var avAuthorProfileCache = {};
  function avRenderAuthor(art){
    var row = document.getElementById('avAuthorRow');
    var nameEl = document.getElementById('avAuthorName');
    var handleEl = document.getElementById('avAuthorHandle');
    if(!row || !nameEl || !handleEl) return;
    if(!art || !art.user_id){ row.style.display='none'; return; }
    row.style.display='';
    var uid = art.user_id;
    function paint(uname, avatarUrl){
      paintAvatarChip('avAvatarImg', 'avAvatarTxt', avatarUrl||null, (uname||'?').charAt(0).toUpperCase());
      nameEl.textContent = uname || 'Artist';
      handleEl.textContent = '@'+(uname||'artist');
    }
    /* Own artwork: reuse the freshest copy rather than a possibly-stale
       cache entry — pf.profile.avatar_url is kept current by
       pfRenderAvatarBanner(), and currentUserAvatarUrl is equally fresh
       for the signed-in viewer's own uploads. */
    if(pf.profile && pf.profile.id===uid){ paint(pf.profile.username, pf.profile.avatar_url); return; }
    if(currentUser && currentUser.id===uid){ paint(cpGetDisplayName(), currentUserAvatarUrl); return; }
    if(avAuthorProfileCache[uid]){ paint(avAuthorProfileCache[uid].username, avAuthorProfileCache[uid].avatar_url); return; }
    paintAvatarChip('avAvatarImg', 'avAvatarTxt', null, '?'); nameEl.textContent='…'; handleEl.textContent='';
    if(sb){
      sb.from('profiles').select('username,avatar_url').eq('id',uid).single().then(function(res){
        var uname = res && res.data && res.data.username ? res.data.username : 'Artist';
        var avatarUrl = res && res.data ? res.data.avatar_url : null;
        avAuthorProfileCache[uid] = { username:uname, avatar_url:avatarUrl };
        if(!avCurrentArt || avCurrentArt.user_id!==uid) return; // modal moved on
        paint(uname, avatarUrl);
      }).catch(function(){});
    }
  }
  function avGoToAuthor(){
    if(!avCurrentArt || !avCurrentArt.user_id) return;
    var uname = (avAuthorProfileCache[avCurrentArt.user_id] && avAuthorProfileCache[avCurrentArt.user_id].username) || (pf.profile && pf.profile.id===avCurrentArt.user_id ? pf.profile.username : null);
    if(!uname) return;
    closeLB();
    openProfileByUsername(uname);
  }

  function avSetupNav(id, navSource){
    var prevBtn = document.getElementById('avPrevBtn');
    var nextBtn = document.getElementById('avNextBtn');
    var source = (navSource && navSource.length) ? navSource : images;
    if(!id || !source || !source.length){
      avNavList=[]; avNavIndex=-1;
      if(prevBtn) prevBtn.style.display='none';
      if(nextBtn) nextBtn.style.display='none';
      return;
    }
    avNavList = source;
    avNavIndex = avNavList.findIndex(function(a){ return String(a.id)===String(id); });
    var show = avNavIndex!==-1 && avNavList.length>1;
    if(prevBtn) prevBtn.style.display = show ? '' : 'none';
    if(nextBtn) nextBtn.style.display = show ? '' : 'none';
  }
  function avNav(dir){
    if(avNavIndex===-1 || !avNavList.length) return;
    var next=(avNavIndex+dir+avNavList.length)%avNavList.length;
    var art=avNavList[next];
    if(!art) return;
    var cats=catList(art.category).length?catList(art.category):['others'];
    /* Pass the same list we're already navigating (avNavList) through so
       stepping prev/next repeatedly stays within its source — e.g. a
       profile's gallery — instead of falling back to the global feed. */
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), true, avNavList);
  }

  function avResetZoom(){
    avZoomLevel=1; avPanX=0; avPanY=0;
    avApplyTransform();
  }
  function avApplyTransform(){
    var img=document.getElementById('lbImg');
    if(img) img.style.transform='translate('+avPanX+'px,'+avPanY+'px) scale('+avZoomLevel+')';
    var pct=document.getElementById('avZoomPct');
    if(pct) pct.textContent=Math.round(avZoomLevel*100)+'%';
  }
  function avZoom(dir){
    avZoomLevel=Math.max(1,Math.min(4,avZoomLevel+dir*0.25));
    if(avZoomLevel===1){ avPanX=0; avPanY=0; }
    avApplyTransform();
  }
  function avToggleFullscreen(){
    var box=document.querySelector('#artModal .avBox');
    if(!box) return;
    if(!document.fullscreenElement){ if(box.requestFullscreen) box.requestFullscreen(); }
    else { if(document.exitFullscreen) document.exitFullscreen(); }
  }
  async function avDownload(){
    var img=document.getElementById('lbImg');
    /* Download the untouched original — currentLightboxImageSrc holds the
       pristine URL (the on-screen image is a resized WebP). getFullUrl
       also strips any sizing params as a belt-and-braces guarantee. */
    var fullSrc=getFullUrl(currentLightboxImageSrc || (img && img.src) || '');
    if(!fullSrc) return;
    /* ── Tier gate ── the server decides the monthly quota and the
       quality (guest 5 · lite 30 · premium 200 · max 1000; originals
       for premium/max, 1600px for guest/lite; own artworks always
       free + full). If the RPC itself errors the gate fails OPEN —
       same philosophy as the upload verifier: an outage must never
       brick a core feature. */
    var gate={allowed:true, full:true};
    var artId=avCurrentArt && avCurrentArt.id;
    if(artId && sb){
      try{
        var gres=await sb.rpc('dz_request_download', {
          p_artwork: artId,
          p_anon_key: (typeof window.dzViewerKey==='function' ? window.dzViewerKey() : null)
        });
        if(!gres.error && gres.data) gate=gres.data;
      }catch(e){}
    }
    if(!gate.allowed){
      if(gate.reason==='limit'){
        showToast('Monthly download limit reached \u2014 upgrade for more');
        if(typeof openSubscription==='function') openSubscription();
      }else{
        showToast('Sign in to download');
        if(typeof openAuthMod==='function') openAuthMod();
      }
      return;
    }
    var href = gate.full ? fullSrc : imgResize(fullSrc, 1600, 82);
    var a=document.createElement('a');
    /* FIX: `download` is ignored for cross-origin URLs (S3/CloudFront),
       so the click used to navigate the whole app away to the raw image.
       Opening in a new tab keeps the site intact and still lets the
       browser save the file. */
    a.href=href; a.download=''; a.target='_blank'; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    if(typeof gate.remaining==='number' && gate.remaining<=3){
      showToast(gate.remaining+' download'+(gate.remaining===1?'':'s')+' left this month');
    }
    /* Count the download toward trending (server dedups per viewer per day).
       Also bump the in-memory counter so a re-render reflects it without a
       refetch — the guard trigger makes the DB the source of truth anyway. */
    if(artId){
      try{ window.registerArtworkDownload(artId); }catch(e){}
      avCurrentArt.download_count = (parseInt(avCurrentArt.download_count,10)||0) + 1;
    }
  }
  function avShare(){
    var url=window.location.href;
    var title=(document.getElementById('lbNm')||{}).textContent||'Artwork';
    if(navigator.share){ navigator.share({title:title,url:url}).catch(function(){}); }
    else if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){ showToast('Link copied ✦'); }); }
    else { showToast('Share not supported'); }
  }
  /* ── Report flow ──────────────────────────────────────────────
     Was a stub that toasted "Report submitted" without recording
     anything. Now writes to artwork_reports (dev-readable only) and
     optionally blocks the creator / hides the artwork for the reporter. */
  var rptArt = null, rptBusy = false;

  function avReport(){
    if(!currentUser){ showToast('Sign in to report artwork'); openAuthMod(); return; }
    if(!avCurrentArt){ showToast('Nothing to report'); return; }
    rptArt = avCurrentArt;
    var m = document.getElementById('rptMod'); if(!m) return;
    /* reset every field so a previous report never leaks into the next */
    var chosen = m.querySelector('input[name="rptReason"]:checked'); if(chosen) chosen.checked = false;
    document.getElementById('rptDetails').value = '';
    document.getElementById('rptBlock').checked = false;
    document.getElementById('rptHide').checked  = false;
    var isOwn = rptArt.user_id && currentUser && rptArt.user_id === currentUser.id;
    document.getElementById('rptBlock').closest('.rptCheck').style.display = isOwn ? 'none' : '';
    m.classList.add('open');
  }

  function rptClose(){
    var m = document.getElementById('rptMod');
    if(m) m.classList.remove('open');
    rptArt = null;
  }

  async function rptSubmit(){
    if(rptBusy || !rptArt) return;
    var m = document.getElementById('rptMod');
    var picked = m.querySelector('input[name="rptReason"]:checked');
    if(!picked){ showToast('Pick a reason first'); return; }
    var btn = document.getElementById('rptSubmit');
    rptBusy = true; btn.disabled = true; btn.textContent = 'SENDING…';
    var art = rptArt;
    try{
      var ins = await sb.from('artwork_reports').insert({
        artwork_id : art.id,
        reporter_id: currentUser.id,
        reason     : picked.value,
        details    : (document.getElementById('rptDetails').value.trim() || null)
      });
      /* 23505 = already reported by this user (unique artwork+reporter) —
         treat as success rather than scolding them for a double tap. */
      if(ins.error && ins.error.code !== '23505') throw ins.error;

      if(document.getElementById('rptHide').checked){
        await sb.from('hidden_artworks')
          .insert({ user_id: currentUser.id, artwork_id: art.id });
        /* remove it from the feed right away, no reload needed */
        if(window.markArtworkHidden) window.markArtworkHidden(art.id);
      }
      if(document.getElementById('rptBlock').checked && art.user_id && art.user_id !== currentUser.id){
        if(window.pfFriendBridge && window.pfFriendBridge.block){
          await window.pfFriendBridge.block(art.user_id);
        }
      }
      rptClose();
      showToast('Report submitted — thank you ✦');
    }catch(e){
      showToast('Couldn\u2019t submit report — try again');
    }finally{
      rptBusy = false; btn.disabled = false; btn.textContent = '🚩 Submit Report';
    }
  }
  function avCloseMoreMenu(){}

  /* Drag-to-pan the image once zoomed in; double-click/tap toggles 2x zoom */
  (function(){
    var dragging=false,startX=0,startY=0,origX=0,origY=0;
    document.addEventListener('DOMContentLoaded', function(){
      var vp=document.getElementById('avImgViewport');
      if(!vp) return;
      vp.addEventListener('pointerdown',function(e){
        if(avZoomLevel<=1) return;
        dragging=true; startX=e.clientX; startY=e.clientY; origX=avPanX; origY=avPanY;
        try{ vp.setPointerCapture(e.pointerId); }catch(err){}
        vp.classList.add('dragging');
      });
      vp.addEventListener('pointermove',function(e){
        if(!dragging) return;
        avPanX=origX+(e.clientX-startX); avPanY=origY+(e.clientY-startY);
        avApplyTransform();
      });
      ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
        vp.addEventListener(ev,function(){ dragging=false; vp.classList.remove('dragging'); });
      });
      vp.addEventListener('dblclick',function(){
        if(avZoomLevel>1){ avZoomLevel=1; avPanX=0; avPanY=0; } else { avZoomLevel=2; }
        avApplyTransform();
      });
    });
  })();

  function openLB(src,name,cat,desc,id,pushUrl,navSource){
    currentLightboxImageSrc=src;
    var art = id ? findArtworkById(id) : null;
    if(!art && id && navSource && navSource.length){
      art = navSource.find(function(a){ return String(a.id)===String(id); }) || null;
    }
    avCurrentArt = art;
    var modal=document.getElementById('artModal');
    if(amCloseTimer){clearTimeout(amCloseTimer);amCloseTimer=null;}
    if(modal) modal.classList.remove('closing');
    avResetZoom();
    avCloseMoreMenu();

    /* ── INSTANT RESET ── everything from the previous artwork is
       cleared SYNCHRONOUSLY before any async work, so prev/next never
       shows the old image, title, like state or comments for even a
       frame. The like/bookmark buttons get an explicit data-id and an
       immediate repaint — previously they resolved their id from the
       URL and only repainted when new buttons entered the DOM, so
       stepping through artworks left the old pressed state behind. */
    (function(){
      var btns=document.querySelectorAll('#artModal .engLike,#artModal .engBm');
      btns.forEach(function(b){ b.setAttribute('data-id', id?String(id):''); });
      if(typeof window.dzRepaintEng==='function') window.dzRepaintEng();
      var cl=document.getElementById('avCmList');
      if(cl) cl.innerHTML='<div class="avCmEmpty">LOADING\u2026</div>';
      var ci=document.getElementById('avCmIn'); if(ci) ci.value='';
      var st=document.getElementById('avImgStack'); if(st){ st.hidden=true; st.innerHTML=''; }
    })();

    var viewport=document.getElementById('avImgViewport');
    if(viewport) viewport.classList.add('loading');
    var imgEl=document.getElementById('lbImg');
    /* FIX(A5): guard imgEl like its sibling viewport — without it, any
       refactor that renames #lbImg turns every artwork open into a crash. */
    if(imgEl){
      /* Show the medium (~500 KB WebP) view; the untouched original is kept
         in currentLightboxImageSrc for Download. */
      imgEl.removeAttribute('src');   /* blank the old pixels instantly */
      imgEl.src=getViewUrl(src);
      /* SEO: the full-resolution image shown in the modal is the one
         most likely to be the actual indexed/served image in Google
         Image Search results, so it needs real alt text too — not
         just the gallery thumbnail. */
      imgEl.alt=name||'Untitled artwork';
      imgEl.onload=function(){
        if(viewport) viewport.classList.remove('loading');
        avUpdateResolution(imgEl.naturalWidth, imgEl.naturalHeight);
      };
      imgEl.onerror=function(){ if(viewport) viewport.classList.remove('loading'); };
      /* Cached images may never fire onload — don't leave the img hidden. */
      if(imgEl.complete && imgEl.naturalWidth){
        if(viewport) viewport.classList.remove('loading');
        avUpdateResolution(imgEl.naturalWidth, imgEl.naturalHeight);
      }
    }

    /* Multi-image support — populates the thumbnail strip + counter, or
       hides both when this artwork has a single image. */
    avBuildStrip(art, src);

    document.getElementById('lbNm').textContent=name||'';

    /* Retired categories must not reappear here either: art.tags is
       used raw (artist-typed tags aren't categories) and `cat` arrives
       straight from the caller, so both get the hidden-slug filter
       that catList() already applies to art.category. */
    var tags = art ? ((art.tags && art.tags.length) ? art.tags : catList(art.category)) : (cat ? [cat] : []);
    if(typeof catHidden === 'function') tags = (tags||[]).filter(function(t){ return !catHidden(t); });
    /* FIX(B1): renamed from `catLabel` — the old name shadowed the global
       catLabel() helper for this whole function scope, so any future call to
       catLabel(slug) inside openLB would crash with "not a function". */
    var catLabelStr = (cat && !(typeof catHidden === 'function' && catHidden(cat))) ? cat : (tags[0]||'');
    var subType = document.getElementById('avSubType');
    if(subType) subType.textContent = catLabelStr ? avCap(catLabelStr)+' Artwork' : 'Digital Artwork';

    /* Description: optional. Hides itself (and its divider) cleanly
       when there's no description text for this artwork. */
    var descEl=document.getElementById('lbDesc');
    var descBlock=document.getElementById('avDescBlock');
    var descDiv=document.getElementById('avDescDiv');
    if(descEl){
      if(desc){ descEl.textContent=desc; descBlock.hidden=false; descDiv.hidden=false; }
      else{ descEl.textContent=''; descBlock.hidden=true; descDiv.hidden=true; }
    }

    /* Tags */
    var tagListEl=document.getElementById('avTagList');
    var tagsBlock=document.getElementById('avTagsBlock');
    var tagsDiv=document.getElementById('avTagsDiv');
    if(tagListEl){
      if(tags && tags.length){
        tagListEl.innerHTML=tags.map(function(t){return '<span class="avTagChip">'+esc(avCap(t))+'</span>';}).join('');
        tagsBlock.hidden=false; tagsDiv.hidden=false;
      } else { tagListEl.innerHTML=''; tagsBlock.hidden=true; tagsDiv.hidden=true; }
    }

    avRenderMeta({ category:catLabelStr, software: art?art.software:null, createdAt: art?art.created_at:null, hasArt: !!art });
    avRenderAuthor(art);
    avSetupNav(id, navSource);
    if(id && typeof window.dzCmLoad==='function') window.dzCmLoad('artwork', String(id), 'avCmList');

    modal.setAttribute('data-state','open');
    modal.classList.add('open');
    document.body.style.overflow='hidden';
    setTimeout(function(){
      var closeBtn=document.querySelector('#artModal .avCloseBtn');
      if(closeBtn) closeBtn.focus();
    },50);
    /* Update URL + SEO meta when an id is supplied */
    if(id){
      if(pushUrl!==false && window.location.pathname!=='/artwork/'+id){
        try{ history.pushState({artId:id},'',  '/artwork/'+id); }catch(e){}
      }
      updateArtworkSEO({id:id,name:name,description:desc,category:cat,image_url:src});
    }
  }
  function closeLB(){
    var modal=document.getElementById('artModal');
    if(!modal || !modal.classList.contains('open'))return;
    modal.classList.add('closing');
    avCloseMoreMenu();
    if(amCloseTimer)clearTimeout(amCloseTimer);
    amCloseTimer=setTimeout(function(){
      modal.classList.remove('open');
      modal.classList.remove('closing');
      modal.setAttribute('data-state','closed');
      restoreScroll();
      var imgEl=document.getElementById('lbImg');
      if(imgEl){imgEl.src='';imgEl.alt='';}
      avCurrentArt=null;
    },230);
    /* Revert address bar + SEO meta when leaving an artwork URL */
    if(/^\/artwork\//.test(window.location.pathname)){
      try{ history.pushState({},'', '/'); }catch(e){}
      resetArtworkSEO();
    }
  }
  /* Click outside the card (on the backdrop itself) closes the modal */
  (function(){
    var modal=document.getElementById('artModal');
    if(modal){
      modal.addEventListener('click',function(e){
        if(e.target===modal)closeLB();
      });
    }
  })();

  /* Artwork URLs + SEO — gallery items use real <a href="/artwork/{id}"> so crawlers can
     index them; handleArtClick() intercepts clicks to keep the modal UX for real users */
  function handleArtClick(e,id){
    if(e){
      // Allow opening in a new tab/window via modifier-click or
      // middle-click — don't hijack that into the modal.
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1) return true;
      e.preventDefault();
    }
    var el = document.querySelector('.gItem[data-id="'+id+'"]');
    if(!el) return false;
    openLB(el.getAttribute('data-fullsrc'), el.getAttribute('data-name'), el.getAttribute('data-cat'), el.getAttribute('data-desc'), id);
    return false;
  }

  /* Look up a full artwork record by id from the in-memory `images`
     array (already loaded from Supabase by loadDB()). */
  function findArtworkById(id){
    if(!id) return null;
    var idS = String(id);
    for(var i=0;i<images.length;i++){
      if(String(images[i].id)===idS) return images[i];
    }
    return null;
  }

  /* Open an artwork's dedicated URL directly (used on initial page
     load when the user lands on /artwork/{id}, and by popstate). */
  function openArtworkById(id,pushUrl){
    var art = findArtworkById(id);
    if(!art) return false;
    var cats=catList(art.category).length?catList(art.category):['others'];
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), pushUrl);
    return true;
  }

  /* Update <head> meta for the open artwork; reset to site defaults on close */
  var SITE_NAME = 'Digiartz';
  var SITE_URL  = 'https://digiartz.net';
  function setMeta(selector, attr, value){
    var el = document.querySelector(selector);
    if(el) el.setAttribute(attr, value);
  }
  function updateArtworkSEO(art){
    if(!art) return;
    var title = (art.name||'Untitled artwork') + ' — ' + SITE_NAME;
    var desc = (art.description && art.description.trim())
      ? art.description.trim().slice(0,300)
      : ('View "'+(art.name||'this artwork')+'"'+(catList(art.category).length?(' in the '+catList(art.category).join(', ')+' collection'):'')+' on '+SITE_NAME+', the digital art community.');
    var url = SITE_URL + '/artwork/' + art.id;
    document.title = title;
    setMeta('meta[name="description"]','content',desc);
    setMeta('link[rel="canonical"]','href',url);
    setMeta('meta[property="og:title"]','content',title);
    setMeta('meta[property="og:description"]','content',desc);
    setMeta('meta[property="og:image"]','content',art.image_url||'');
    setMeta('meta[property="og:url"]','content',url);
    setMeta('meta[property="og:type"]','content','article');
    setMeta('meta[name="twitter:title"]','content',title);
    setMeta('meta[name="twitter:description"]','content',desc);
    setMeta('meta[name="twitter:image"]','content',art.image_url||'');
    setMeta('meta[name="twitter:card"]','content','summary_large_image');
    /* Replace any existing per-artwork JSON-LD block */
    var ld = document.getElementById('ldArtwork');
    if(!ld){
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'ldArtwork';
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify({
      '@context':'https://schema.org',
      '@type':'ImageObject',
      'contentUrl':art.image_url||'',
      'name':art.name||'Untitled artwork',
      'description':desc,
      'url':url,
      'creator':{'@type':'Organization','name':'DigiArtz'},
      'representativeOfPage':true
    });
  }
  function resetArtworkSEO(){
    document.title = SITE_DEFAULT_TITLE;
    setMeta('meta[name="description"]','content',SITE_DEFAULT_DESC);
    setMeta('link[rel="canonical"]','href',SITE_URL+'/');
    setMeta('meta[property="og:title"]','content',SITE_DEFAULT_TITLE);
    setMeta('meta[property="og:description"]','content',SITE_DEFAULT_DESC);
    setMeta('meta[property="og:image"]','content',SITE_DEFAULT_IMAGE);
    setMeta('meta[property="og:url"]','content',SITE_URL+'/');
    setMeta('meta[property="og:type"]','content','website');
    setMeta('meta[name="twitter:title"]','content',SITE_DEFAULT_TITLE);
    setMeta('meta[name="twitter:description"]','content',SITE_DEFAULT_DESC);
    setMeta('meta[name="twitter:image"]','content',SITE_DEFAULT_IMAGE);
    var ld = document.getElementById('ldArtwork');
    if(ld) ld.remove();
  }

  /* Keep modal + meta in sync with browser history */
  window.addEventListener('popstate', function(){
    var m = window.location.pathname.match(/^\/artwork\/([^/]+)\/?$/);
    var pm = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if(m){
      openArtworkById(m[1], false);
    } else if(pm){
      openProfileByUsername(decodeURIComponent(pm[1]), false);
    } else if(window.location.pathname === '/login'){
      openAuthMod();
    } else {
      closeLB();
      resetArtworkSEO();
      if(document.getElementById('profilePage').classList.contains('open')) closeProfilePage(false);
      closeAuthMod(false);
    }
  });

  function syncAdmBtn(){
    var b=document.getElementById('smAdmBtn');
    if(!b) return;
    b.classList.toggle('devOnly',isDev);
    b.textContent='⚙ ADMIN PANEL';
  }

