// gallery sections, viewer, report
  // gallery sections
  var FG_SECTIONS = {
    resources:   { label:'Resources',   opts:['Tutorials','Brushes','Textures','Fonts','PSD Files','3D Assets','References','Color Palettes','Mockups','Templates','Icons','Plugins'] },
    blog:        { label:'Blog',        opts:['News','Community','Artist Spotlights','Tips & Guides','Interviews','Reviews','Events','Challenges','Releases','Announcements'] },
    marketplace: { label:'Marketplace', opts:['Artwork','Prints','Digital Downloads','Website Templates','UI Kits','Icons','Brushes','3D Models','Commissions','Services'] },
    jobs:        { label:'Jobs',        opts:['Freelance','Full-Time','Part-Time','Remote','Internship','Contest','Hiring Artists','Collaboration'] },
    cart:        { label:'Cart',        opts:['Shopping Cart','Saved for Later','Checkout','Orders','Downloads','Licenses'] }
  };
  var fgSection = 'artworks';           // active tab
  var fgFltMode = 'artworks';           // panel owner
  var fgSecFilter = {};                 // chosen option per section
  var fgSecQuery  = {};                 // typed query per section
  // reading order of the chip row, and the order the arrow keys walk
  var FG_TABS = ['artworks','marketplace','blog','resources','jobs','cart'];

  // one place to ask, so every motion in here agrees about it
  function fgReduceMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function fgSwitchSection(id){
    if(!id) return;
    /* Back to the top before the swap, not after. The panel about to be shown
       is the one that decides how tall the page is, so a scroll reset landing
       after it has been drawn is a visible jump; landing before means the new
       panel is only ever drawn at the top, and its rise-in covers the move. */
    var fg=document.getElementById('fg'); if(fg) fg.scrollTop=0;
    var secs=document.querySelectorAll('#fg .fgSec'), i;
    for(i=0;i<secs.length;i++) secs[i].classList.toggle('active', secs[i].id==='fgSec-'+id);
    var btns=document.querySelectorAll('#fgSecTabs .fgSecBtn'), on;
    for(i=0;i<btns.length;i++){
      on = btns[i].id==='fgSecBtn-'+id;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-selected', on?'true':'false');
      // a tab rail is one stop on the page, not six: Tab lands on the
      // selected chip and the arrow keys move within
      btns[i].tabIndex = on ? 0 : -1;
    }
    fgSection=id;
    // One line at every width, which on a phone is wider than the screen, so
    // a section opened from somewhere else — a quick link, the hero CTA —
    // would land with its chip off the edge. Measured off the boxes rather
    // than offsetLeft, which is relative to whatever happens to be positioned
    // above the chip rather than to the scroller. This one does glide: the
    // row it moves through is not being replaced, so there is something to
    // watch it travel across.
    var rail=document.getElementById('fgSecRow');
    var tab=document.getElementById('fgSecBtn-'+id);
    if(rail && tab){
      var rr=rail.getBoundingClientRect(), tr=tab.getBoundingClientRect();
      var want=rail.scrollLeft+(tr.left-rr.left)-(rr.width-tr.width)/2;
      var max=rail.scrollWidth-rail.clientWidth;
      var left=Math.max(0,Math.min(want,max));
      if(!fgReduceMotion() && typeof rail.scrollTo==='function'){
        rail.scrollTo({left:left, behavior:'smooth'});
      } else {
        rail.scrollLeft=left;
      }
    }
    fgSyncFilterBtn();
    // load section on first visit
    if(id!=='artworks' && typeof dzSecEnter==='function') dzSecEnter(id);
  }

  /* One filter button in the bar, where there used to be one inside each
     section's own search box. It opens whichever panel belongs to the section
     on show, and wears the dot when that section is filtered — so the control
     is in one place and still says something true about six of them. */
  function fgOpenFilter(){
    if(fgSection==='artworks'){ openFilterPanel(); return; }
    openSecFilter(fgSection);
  }
  function fgSyncFilterBtn(){
    var btn=document.getElementById('fgFltBtn');
    if(!btn) return;
    var on = fgSection==='artworks'
      ? (typeof window.fgArtFiltered==='function' && window.fgArtFiltered())
      : ((fgSecFilter[fgSection]||'all') !== 'all');
    btn.classList.toggle('active', !!on);
  }
  window.fgOpenFilter=fgOpenFilter;
  window.fgSyncFilterBtn=fgSyncFilterBtn;

  /* Arrow keys along the chip row, Home and End to its ends — the tabs
     pattern anything with role="tablist" answers to. Selection follows the
     arrow: the panel is already in the page, so switching costs nothing. Up
     and Down are left alone; the row is horizontal. */
  function fgTabKey(e){
    var i = FG_TABS.indexOf(fgSection);
    if(i === -1) return;
    var next;
    if(e.key === 'ArrowRight')     next = (i + 1) % FG_TABS.length;
    else if(e.key === 'ArrowLeft') next = (i - 1 + FG_TABS.length) % FG_TABS.length;
    else if(e.key === 'Home')      next = 0;
    else if(e.key === 'End')       next = FG_TABS.length - 1;
    else return;
    e.preventDefault();
    fgSwitchSection(FG_TABS[next]);
    var btn = document.getElementById('fgSecBtn-' + FG_TABS[next]);
    if(btn) btn.focus();
  }
  (function(){
    var tabs = document.getElementById('fgSecTabs');
    if(tabs) tabs.addEventListener('keydown', fgTabKey);
  })();

  // stub sections hold the query
  var fgSecQTimer={};
  function fgSecSearchInput(id,v){
    fgSecQuery[id]=String(v||'');
    var w=document.getElementById(id+'SearchWrap');
    if(w) w.classList.toggle('tgHasQ', !!fgSecQuery[id].length);
    // debounced input
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

  // build panel body
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
    fgSyncFilterBtn();
    closeFilterPanel();
    if(typeof dzSecRender==='function') dzSecRender(id);
  }

  // expose for inline handlers
  window.fgSwitchSection=fgSwitchSection;
  window.fgSecSearchInput=fgSecSearchInput;
  window.fgSecSearchClear=fgSecSearchClear;
  window.openSecFilter=openSecFilter;
  window.applySecFilter=applySecFilter;
  function closeFG(){
    // the search page sits over the gallery — it goes with it, and the scroll
    // lock belongs to whatever is left on screen
    if(typeof closeFgSearch==='function') closeFgSearch(true);
    document.getElementById('fg').classList.remove('open');
    restoreScroll();
    // reset category filter
    filterCat = 'all';
    var catR = document.querySelector('input[name="fltCat"][value="all"]');
    if(catR) catR.checked = true;
  }
  // viewer open and close
  var amCloseTimer = null;
  var avNavList = [];
  var avNavIndex = -1;
  // opened from gallery overlay
  var avLbFromGallery = false;
  var avZoomLevel = 1, avPanX = 0, avPanY = 0;
  var avCurrentArt = null;
  // multi image artworks
  var avImages = [];
  var avImgIdx = 0;

  // cover first, then extras
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
  // build thumb strip
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
    // stacked layout
    strip.hidden = true; strip.innerHTML = '';
    if(cnt){ cnt.hidden = true; }   // counter retired
    var stack = document.getElementById('avImgStack');
    if(stack){
      stack.hidden = false;
      stack.innerHTML = avImages.slice(1).map(function(u,n){
        return '<img src="'+esc(getViewUrl(u))+'" alt="Image '+(n+2)+' of '+avImages.length+'" loading="lazy" decoding="async">';
      }).join('');
    }
  }
  // swap main image
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
      // cached image may skip onload
      if(imgEl.complete && imgEl.naturalWidth && viewport) viewport.classList.remove('loading');
    }
    var strip = document.getElementById('avStrip');
    if(strip){
      Array.prototype.forEach.call(strip.children, function(btn,n){
        btn.classList.toggle('active', n === avImgIdx);
        btn.setAttribute('aria-selected', n === avImgIdx ? 'true' : 'false');
      });
      // scroll active thumb into view
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
    // only rows with data
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
    // use freshest own avatar
    if(pf.profile && pf.profile.id===uid){ avAuthorProfileCache[uid] = { username:pf.profile.username, avatar_url:pf.profile.avatar_url }; paint(pf.profile.username, pf.profile.avatar_url); return; }
    if(currentUser && currentUser.id===uid){ var _ownU=(currentUser.user_metadata && currentUser.user_metadata.username)||null; if(_ownU) avAuthorProfileCache[uid]={ username:_ownU, avatar_url:currentUserAvatarUrl||null }; paint(cpGetDisplayName(), currentUserAvatarUrl); return; }
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
    var uid = avCurrentArt.user_id;
    // resolve author username
    var cached = avAuthorProfileCache[uid];
    var uname = (cached && cached.username)
      || (pf.profile && pf.profile.id===uid ? pf.profile.username : null)
      || (currentUser && currentUser.id===uid && currentUser.user_metadata ? currentUser.user_metadata.username : null)
      || null;
    if(uname){ closeLB(true); openProfileByUsername(uname); return; }
    if(!sb){ if(typeof showToast==='function') showToast('Can\u2019t open profile \u2014 try again'); return; }
    sb.from('profiles').select('username').eq('id',uid).single().then(function(res){
      var u = res && res.data && res.data.username;
      if(!u){ if(typeof showToast==='function') showToast('Profile not found'); return; }
      avAuthorProfileCache[uid] = avAuthorProfileCache[uid] || { username:u, avatar_url:null };
      closeLB(true);
      openProfileByUsername(u);
    }).catch(function(){ if(typeof showToast==='function') showToast('Couldn\u2019t open profile'); });
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
    // keep prev next within list
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
  // the download button is the only way out of the site with a file, so every
  // click has to clear the server side daily quota first
  var avDlBusy=false;

  // keep the extension the server settled on, but title the file with the
  // artwork name as it reads in the viewer
  function avDlFileName(serverName, name){
    var m=/\.([a-z0-9]{2,4})$/i.exec(serverName||'');
    var ext=m ? m[1].toLowerCase() : 'jpg';
    var base=String(name||'').replace(/[^\w\-. ]+/g,'').trim().replace(/\s+/g,'-').slice(0,60);
    if(!base) return serverName || ('artwork.'+ext);
    return base+'.'+ext;
  }

  // hand the browser a blob from our own origin, so the raw file url is never
  // navigated to and never lands in the tab history
  function avDlSaveBlob(blob, fileName){
    var obj=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=obj; a.download=fileName; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(obj); }, 60000);
  }

  async function avDownload(){
    if(avDlBusy) return;
    var artId=avCurrentArt && avCurrentArt.id;
    if(!artId){ showToast('Nothing to download'); return; }
    if(!sb){ showToast('Downloads are unavailable right now'); return; }
    if(!currentUser){
      showToast('Sign in to download');
      if(typeof openAuthMod==='function') openAuthMod();
      return;
    }

    var btns=document.querySelectorAll('#artModal .avDlBtn');
    avDlBusy=true;
    btns.forEach(function(b){ b.disabled=true; b.setAttribute('aria-busy','true'); });
    try{
      var token='';
      try{
        var sess=await sb.auth.getSession();
        token=(sess && sess.data && sess.data.session && sess.data.session.access_token) || '';
      }catch(e){}
      if(!token){
        showToast('Sign in to download');
        if(typeof openAuthMod==='function') openAuthMod();
        return;
      }

      // /api/download charges the daily quota before it streams anything back
      var res;
      try{
        res=await fetch('/api/download', {
          method:'POST',
          headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
          body:JSON.stringify({ artwork:String(artId) })
        });
      }catch(e){
        showToast('Download failed \u2014 check your connection');
        return;
      }

      if(!res.ok){
        var info={};
        try{ info=await res.json(); }catch(e){}
        if(res.status===429 && info.reason==='limit'){
          avPaintQuota({signed_in:true, remaining:0, limit:info.limit});
          dzQuotaOpen(info);
        }else if(res.status===429){
          // burst limit, not the daily cap — no upsell, just slow down
          showToast('Too many download requests — wait a moment');
        }else if(res.status===403 && info.reason!=='limit'){
          showToast(info.error || 'Download blocked');
        }else if(res.status===401){
          showToast('Sign in to download');
          if(typeof openAuthMod==='function') openAuthMod();
        }else if(res.status===404){
          showToast('This artwork is no longer available');
        }else{
          showToast(info.error || 'Download failed \u2014 try again');
        }
        return;
      }

      var blob=await res.blob();
      var name=(document.getElementById('lbNm')||{}).textContent || (avCurrentArt && avCurrentArt.name);
      avDlSaveBlob(blob, avDlFileName(dispName(res), name));

      var left=parseInt(res.headers.get('X-Dz-Remaining'),10);
      var cap =parseInt(res.headers.get('X-Dz-Limit'),10);
      if(!isNaN(left)){
        if(!isNaN(cap)) avPaintQuota({signed_in:true, remaining:left, limit:cap});
        showToast(left>0
          ? left+' download'+(left===1?'':'s')+' left today'
          : 'That was your last download for today');
      }
      // count download for trending
      try{ window.registerArtworkDownload(artId); }catch(e){}
      if(avCurrentArt) avCurrentArt.download_count = (parseInt(avCurrentArt.download_count,10)||0) + 1;
    }finally{
      avDlBusy=false;
      btns.forEach(function(b){ b.disabled=false; b.removeAttribute('aria-busy'); });
    }
  }

  // the server already picked the extension, reuse it
  function dispName(res){
    var cd=res.headers.get('Content-Disposition') || '';
    var m=/filename="([^"]+)"/.exec(cd);
    return m ? m[1] : '';
  }

  // "3 of 5 downloads left today" under the button, so the cap is visible
  // before someone runs into it
  function avPaintQuota(q){
    var note=document.getElementById('avDlNote');
    if(!note) return;
    if(!q || !q.signed_in || typeof q.remaining!=='number'){ note.hidden=true; note.textContent=''; return; }
    note.textContent=q.remaining+' of '+q.limit+' download'+(q.limit===1?'':'s')+' left today';
    note.classList.toggle('avDlNote--out', q.remaining<=0);
    note.hidden=false;
  }
  function avLoadQuota(){
    if(!sb || !currentUser){ avPaintQuota(null); return; }
    sb.rpc('dz_download_quota').then(function(res){
      if(!res.error) avPaintQuota(res.data);
    }, function(){});
  }

  // daily quota modal
  function dzQuotaOpen(gate){
    var m=document.getElementById('dlQuotaMod');
    if(!m){
      showToast('Daily download limit reached \u2014 upgrade for more');
      if(typeof openSubscription==='function') openSubscription();
      return;
    }
    var lim=gate && typeof gate.limit==='number' ? gate.limit : null;
    var sub=document.getElementById('dlQuotaSub');
    if(sub){
      sub.textContent='You have used '+(lim!==null?'all '+lim+' of your':'all of your')+
                      ' downloads for today. To continue downloading more, you need to buy a subscription.';
    }
    var meta=document.getElementById('dlQuotaMeta');
    if(meta){
      var bits=[];
      if(gate && gate.tier) bits.push((gate.tier==='guest'?'Free':avCap(gate.tier))+' plan');
      if(lim!==null) bits.push(lim+' downloads / day');
      if(gate && gate.resets_at){
        var d=new Date(gate.resets_at);
        if(!isNaN(d)) bits.push('Resets '+d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}));
      }
      meta.textContent=bits.join('  \u00b7  ');
    }
    m.classList.add('open');
    setTimeout(function(){
      var b=m.querySelector('.dlqBtn--go');
      if(b) b.focus();
    },40);
  }
  function dzQuotaClose(){
    var m=document.getElementById('dlQuotaMod');
    if(m) m.classList.remove('open');
  }
  function dzQuotaBuy(){
    dzQuotaClose();
    closeLB();
    if(typeof openSubscription==='function') openSubscription();
  }
  window.dzQuotaOpen=dzQuotaOpen;
  window.dzQuotaClose=dzQuotaClose;
  window.dzQuotaBuy=dzQuotaBuy;
  // escape closes the quota modal only, the viewer behind it stays open
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var m=document.getElementById('dlQuotaMod');
    if(m && m.classList.contains('open')){ dzQuotaClose(); e.stopPropagation(); }
  },true);
  function avShare(){
    var url=window.location.href;
    var title=(document.getElementById('lbNm')||{}).textContent||'Artwork';
    if(navigator.share){ navigator.share({title:title,url:url}).catch(function(){}); }
    else if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){ showToast('Link copied'); }); }
    else { showToast('Share not supported'); }
  }
  // report flow
  var rptArt = null, rptBusy = false;

  function avReport(){
    if(!currentUser){ showToast('Sign in to report artwork'); openAuthMod(); return; }
    if(!avCurrentArt){ showToast('Nothing to report'); return; }
    rptArt = avCurrentArt;
    var m = document.getElementById('rptMod'); if(!m) return;
    // reset fields
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
      // dup report counts as success
      if(ins.error && ins.error.code !== '23505') throw ins.error;

      if(document.getElementById('rptHide').checked){
        await sb.from('hidden_artworks')
          .insert({ user_id: currentUser.id, artwork_id: art.id });
        // hide from feed now
        if(window.markArtworkHidden) window.markArtworkHidden(art.id);
      }
      if(document.getElementById('rptBlock').checked && art.user_id && art.user_id !== currentUser.id){
        if(window.pfFriendBridge && window.pfFriendBridge.block){
          await window.pfFriendBridge.block(art.user_id);
        }
      }
      rptClose();
      showToast('Report submitted — thank you');
    }catch(e){
      showToast('Couldn\u2019t submit report — try again');
    }finally{
      rptBusy = false; btn.disabled = false; btn.textContent = '🚩 Submit Report';
    }
  }
  function avCloseMoreMenu(){}

  // drag to pan, double tap zoom
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
    var _fgAtOpen = document.getElementById('fg');
    avLbFromGallery = !!(_fgAtOpen && _fgAtOpen.classList.contains('open'));
    if(amCloseTimer){clearTimeout(amCloseTimer);amCloseTimer=null;}
    if(modal) modal.classList.remove('closing');
    avResetZoom();
    avCloseMoreMenu();

    // instant reset
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
    // guard missing img
    if(imgEl){
      // show medium size
      imgEl.removeAttribute('src');   // blank old pixels
      imgEl.src=getViewUrl(src);
      // alt text for seo
      imgEl.alt=name||'Untitled artwork';
      imgEl.onload=function(){
        if(viewport) viewport.classList.remove('loading');
        avUpdateResolution(imgEl.naturalWidth, imgEl.naturalHeight);
      };
      imgEl.onerror=function(){ if(viewport) viewport.classList.remove('loading'); };
      // cached image may skip onload
      if(imgEl.complete && imgEl.naturalWidth){
        if(viewport) viewport.classList.remove('loading');
        avUpdateResolution(imgEl.naturalWidth, imgEl.naturalHeight);
      }
    }

    // multi image support
    avBuildStrip(art, src);

    document.getElementById('lbNm').textContent=name||'';

    // filter hidden categories
    var tags = art ? ((art.tags && art.tags.length) ? art.tags : catList(art.category)) : (cat ? [cat] : []);
    if(typeof catHidden === 'function') tags = (tags||[]).filter(function(t){ return !catHidden(t); });
    // renamed to avoid shadowing
    var catLabelStr = (cat && !(typeof catHidden === 'function' && catHidden(cat))) ? cat : (tags[0]||'');
    var subType = document.getElementById('avSubType');
    if(subType) subType.textContent = catLabelStr ? avCap(catLabelStr)+' Artwork' : 'Digital Artwork';

    // description optional
    var descEl=document.getElementById('lbDesc');
    var descBlock=document.getElementById('avDescBlock');
    var descDiv=document.getElementById('avDescDiv');
    if(descEl){
      if(desc){ descEl.textContent=desc; descBlock.hidden=false; descDiv.hidden=false; }
      else{ descEl.textContent=''; descBlock.hidden=true; descDiv.hidden=true; }
    }

    // tags
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
    avPaintQuota(null); avLoadQuota();
    avSetupNav(id, navSource);
    if(id && typeof window.dzCmLoad==='function') window.dzCmLoad('artwork', String(id), 'avCmList');

    modal.setAttribute('data-state','open');
    modal.classList.add('open');
    document.body.style.overflow='hidden';
    setTimeout(function(){
      var closeBtn=document.querySelector('#artModal .avCloseBtn');
      if(closeBtn) closeBtn.focus();
    },50);
    // update url and meta
    if(id){
      if(pushUrl!==false && window.location.pathname!=='/artwork/'+id){
        try{ history.pushState({artId:id},'',  '/artwork/'+id); }catch(e){}
      }
      updateArtworkSEO({id:id,name:name,description:desc,category:cat,image_url:src});
    }
  }
  function closeLB(keepUrl){
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
    // revert url and meta
    if(!keepUrl && /^\/artwork\//.test(window.location.pathname)){
      try{ history.pushState({},'', '/'); }catch(e){}
      resetArtworkSEO();
    }
  }
  // backdrop click closes
  (function(){
    var modal=document.getElementById('artModal');
    if(modal){
      modal.addEventListener('click',function(e){
        if(e.target===modal)closeLB();
      });
    }
  })();

  // artwork urls and seo
  function handleArtClick(e,id){
    if(e){
      // allow new tab on modifier click
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1) return true;
      e.preventDefault();
    }
    var el = document.querySelector('.gItem[data-id="'+id+'"]');
    if(!el) return false;
    openLB(el.getAttribute('data-fullsrc'), el.getAttribute('data-name'), el.getAttribute('data-cat'), el.getAttribute('data-desc'), id);
    return false;
  }

  // find artwork by id
  function findArtworkById(id){
    if(!id) return null;
    var idS = String(id);
    for(var i=0;i<images.length;i++){
      if(String(images[i].id)===idS) return images[i];
    }
    return null;
  }

  // open artwork by id
  function openArtworkById(id,pushUrl){
    var art = findArtworkById(id);
    if(!art) return false;
    var cats=catList(art.category).length?catList(art.category):['others'];
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), pushUrl);
    return true;
  }

  // head meta per artwork
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
    // the resized derivative, never the stored original: the origin bucket is
    // not meant to stay publicly readable, and a preview that 403s is worse
    // than no preview. the edge middleware sets the same thing for scrapers,
    // which never run this code
    var ogImg = art.image_url ? imgResize(art.image_url, 1200) : '';
    setMeta('meta[property="og:image"]','content',ogImg);
    setMeta('meta[property="og:url"]','content',url);
    setMeta('meta[property="og:type"]','content','article');
    setMeta('meta[name="twitter:title"]','content',title);
    setMeta('meta[name="twitter:description"]','content',desc);
    setMeta('meta[name="twitter:image"]','content',ogImg);
    setMeta('meta[name="twitter:card"]','content','summary_large_image');
    // replace json ld block
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
      'contentUrl':ogImg,
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

  // sync with history
  window.addEventListener('popstate', function(){
    var m = window.location.pathname.match(/^\/artwork\/([^/]+)\/?$/);
    var pm = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if(m){
      // close profile, reopen viewer
      var _fromGal = avLbFromGallery;
      if(document.getElementById('profilePage').classList.contains('open')) closeProfilePage(false);
      if(_fromGal){
        var _fgBack = document.getElementById('fg');
        if(_fgBack && !_fgBack.classList.contains('open')){
          _fgBack.classList.add('open');
          if(typeof bnSetActive==='function') bnSetActive('bnGallery');
        }
      }
      openArtworkById(m[1], false);
    } else if(pm){
      openProfileByUsername(decodeURIComponent(pm[1]), false);
    } else if(window.location.pathname === '/login'){
      openAuthMod();
    } else {
      closeLB();
      resetArtworkSEO();
      if(document.getElementById('profilePage').classList.contains('open')) closeProfilePage(false, true);
      closeAuthMod(false);
    }
  });

  // The entry is built for a dev account and taken out again for anyone
  // else. It used to be written into the settings list and hidden with a
  // stylesheet, which is not hidden: it was in the page source of every
  // visit, it answered a click, and it named a panel that nobody outside
  // that account has any business knowing exists.
  function syncAdmBtn(){
    var b=document.getElementById('smAdmBtn');
    if(!isDev){ if(b && b.parentNode) b.parentNode.removeChild(b); return; }
    // the Account group's empty slot; the flat list is the older shape, kept
    // as a fallback so the entry still lands above Log Out either way
    var gate=document.getElementById('setAdmGate');
    var list=gate || document.querySelector('#setPage .setList');
    if(!list) return;
    if(!b){
      b=document.createElement('button');
      b.id='smAdmBtn';
      b.className='pfMenuItem';
      b.onclick=function(){ setGo(smHandleAdm,'admPage'); };
      if(gate) gate.appendChild(b);
      else list.insertBefore(b, list.querySelector('.pfMenuItem--danger'));
    }
    b.textContent='⚙ ADMIN PANEL';
  }

