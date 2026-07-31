// profile page
  var pf = {
    profile: null,        // profiles row being viewed
    isOwner: false,
    tab: 'gallery',
    galleryRows: [], galleryDone: false, galleryBusy: false,
    upFile: null,
    upThumbFocus: null,    // crop position percent
    upPageFiles: [],
    upAlbums: [],          // album ids from upload
    albums: [], albumsLoaded: false   // albums strip
  };

  // avatar and banner preload
  var pfMediaCache = {};
  // row cache by username
  var pfRowCache = {};
  var pfOpenSeq = 0;   // guards stale fetch
  function pfPreloadImage(url){
    if(!url) return;
    var img = new Image();
    img.src = url;
  }

  function pfFormatDate(iso){
    if(!iso) return '';
    try{
      return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
    }catch(e){ return ''; }
  }

  // profile columns
  var PF_PROFILE_COLS = 'id,username,display_name,bio,role,created_at,username_changed_at,cred_received_count,merit,avatar_url,avatar_storage_path,avatar_updated_at,banner_url,banner_storage_path,banner_updated_at,social_links';

  // self heal missing row
  async function pfEnsureOwnProfile(){
    if(!sb || !currentUser) return null;
    try{
      // zero rows is expected
      const{data:existing,error:se}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('id',currentUser.id).maybeSingle();
      if(se) throw se;
      if(existing){ dzcSet('ownProfile', existing); return existing; }
      // build username from session
      var base = (currentUser.user_metadata && currentUser.user_metadata.username) ||
                 (currentUser.email ? currentUser.email.split('@')[0] : '') || 'user';
      base = base.replace(/[^a-zA-Z0-9_.]/g,'').slice(0,30) || 'user';
      var uname = base;
      for(var attempt=0; attempt<3; attempt++){
        const{data:ins,error:ie}=await sb.from('profiles').insert({id:currentUser.id,username:uname}).select(PF_PROFILE_COLS).single();
        if(!ie && ins){
          // sync auth copy
          if(uname !== (currentUser.user_metadata && currentUser.user_metadata.username)){
            try{ await sb.auth.updateUser({data:{username:uname}}); }catch(e){}
          }
          return ins;
        }
        var msg = (ie && ie.message) || '';
        if(/duplicate|unique|23505/i.test(msg)){
          // handle id or name conflict
          const{data:again}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('id',currentUser.id).maybeSingle();
          if(again) return again;
          uname = base.slice(0,24)+'_'+Math.random().toString(36).slice(2,6);
          continue;
        }
        console.error('pfEnsureOwnProfile: '+msg);
        return null;
      }
    }catch(e){
      console.error('pfEnsureOwnProfile: '+(e.message||e));
      // offline cached profile
      var cachedProf = dzcGet('ownProfile');
      if(cachedProf){ showToast('Offline \u2014 showing saved profile'); return cachedProf; }
    }
    return null;
  }

  async function openOwnProfile(){
    if(!currentUser){ showToast('Sign in to view your profile'); openAuthMod(); return; }
    if(!sb){ showToast('Can\u2019t connect \u2014 try again'); return; }
    // username from session
    var uname = currentUser.user_metadata && currentUser.user_metadata.username;
    if(uname){ openProfileByUsername(uname); return; }
    var row = await pfEnsureOwnProfile();
    if(row && row.username){ openProfileByUsername(row.username); return; }
    showToast('Could not load your profile — please try again');
  }

  // close competing overlays
  function pfCloseCompetingOverlays(){
    // remember overlay to return to
    try{
      var _dz = document.getElementById('dzView');
      var _fg = document.getElementById('fg');
      var _cm = document.getElementById('communityPage');
      var _rk = document.getElementById('rankPage');
      if(_dz && _dz.classList.contains('open')) window.pfReturnOverlay = 'dzView';
      else if(_fg && _fg.classList.contains('open')) window.pfReturnOverlay = 'fg';
      else if(_cm && _cm.classList.contains('open')) window.pfReturnOverlay = 'communityPage';
      else if(_rk && _rk.classList.contains('open')) window.pfReturnOverlay = 'rankPage';
      else window.pfReturnOverlay = null;
      // artworks keep their own url
    }catch(e){ window.pfReturnOverlay = null; }
    try{ if(typeof closeLB==='function') closeLB(true); }catch(e){}
    try{ if(typeof closeFG==='function') closeFG(); }catch(e){}
    try{ if(typeof closePfUpload==='function') closePfUpload(); }catch(e){}
    try{ if(typeof closeCommunityPage==='function') closeCommunityPage(); }catch(e){}
    try{ if(typeof window.closeRankPage==='function') window.closeRankPage(); }catch(e){}
    // silent close keeps history
    try{ if(typeof window.dzCloseViewSilent==='function') window.dzCloseViewSilent(); else if(typeof window.dzCloseView==='function') window.dzCloseView(); }catch(e){}
  }

  async function openProfileByUsername(username, pushUrl){
    if(!sb){ showToast('Can\u2019t connect \u2014 try again'); return; }
    pfCloseCompetingOverlays();
    var panel = document.getElementById('profilePage');
    panel.classList.add('open');
    document.body.style.overflow='hidden';
    // preload media on slide in
    var mediaCached = pfMediaCache[username];
    if(mediaCached){
      pfPreloadImage(getThumbnailUrl(mediaCached.avatar_url));
      pfPreloadImage(getViewUrl(mediaCached.banner_url));
    }
    if(currentUser && currentUser.user_metadata && currentUser.user_metadata.username===username){
      pfPreloadImage(getThumbnailUrl(currentUserAvatarUrl));
    }
    pf.profile=null; pf.galleryRows=[]; pf.galleryDone=false; pf.galleryBusy=false;
    pf.likeLoaded=false; pf.bmLoaded=false;
    pf.resLoaded=false; pf.mktLoaded=false; pf.blogLoaded=false; pf.resRows=[]; pf.mktRows=[]; pf.blogRows=[];
    pf.savedRows={like:[],bookmark:[]}; pf.savedShown={like:0,bookmark:0};
    // reset albums per profile
    pf.albumsLoaded=false; pf.albums=[]; pf.albumSaved={like:[],bookmark:[]};
    var _pgs=document.getElementById('pfGallerySentinel'); if(_pgs) _pgs.style.display='none';
    var _pls=document.getElementById('pfLikeSentinel'); if(_pls) _pls.style.display='none';
    var _pbs=document.getElementById('pfBookmarkSentinel'); if(_pbs) _pbs.style.display='none';
    // stale fetch guard
    var mySeq = ++pfOpenSeq;

    // stale while revalidate
    var cachedRow = pfRowCache[String(username).toLowerCase()];
    if(cachedRow){
      pfSwitchTab('gallery');
      pfPaintProfile(cachedRow, cachedRow.username, pushUrl);
    } else {
      // first visit, show skeleton
      // like and bookmark tabs removed
      var _lg=document.getElementById('pfLikeGrid');     if(_lg) _lg.innerHTML='';
      var _bg=document.getElementById('pfBookmarkGrid'); if(_bg) _bg.innerHTML='';
      var _le=document.getElementById('pfLikeEmpty');    if(_le) _le.style.display='none';
      var _be=document.getElementById('pfBookmarkEmpty');if(_be) _be.style.display='none';
      var _xpW=document.getElementById('pfXpWrap'); if(_xpW) _xpW.innerHTML='';
      document.getElementById('pfUsername').textContent='Loading…';
      document.getElementById('pfAvatarLetter').textContent='?';
      document.getElementById('pfAvatarImg').style.display='none';
      document.getElementById('pfBannerImg').style.display='none';
      document.getElementById('pfJoined').textContent='';
      var _hb=document.getElementById('pfHeadBio'); if(_hb) _hb.textContent='';
      var _hn=document.getElementById('pfHandle'); if(_hn) _hn.textContent='';
      var _sr=document.getElementById('pfStatsRow'); if(_sr) _sr.style.display='none';
      var _ar=document.getElementById('pfActionRow'); if(_ar) _ar.style.display='none';
      var _wm=document.getElementById('pfWarnMark'); if(_wm) _wm.classList.remove('on');
      // clear previous tint
      if(window.DZ_MS){
        DZ_MS.paintName(document.getElementById('pfUsername'), 0);
        DZ_MS.paintRibbon(document.getElementById('pfMsRibbon'), 0);
      }
      document.getElementById('pfGalleryGrid').innerHTML='';
      pfSwitchTab('gallery');
    }
    try{
      // missing row is not an error
      let{data,error}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('username',username).maybeSingle();
      if(error) throw error;
      if(!data && currentUser){
        // create own row if missing
        var metaName = currentUser.user_metadata && currentUser.user_metadata.username;
        if(metaName && metaName.toLowerCase() === String(username).toLowerCase()){
          data = await pfEnsureOwnProfile();
        }
      }
      if(!data){ showToast('Profile not found'); closeProfilePage(); return; }
      // bail if superseded
      if(mySeq !== pfOpenSeq) return;
      // use db username
      username = data.username;
      pfRowCache[String(username).toLowerCase()] = data;   // warm for next open
      pfPaintProfile(data, username, pushUrl);
    }catch(e){
      console.error('Error: '+e.message);
      // keep cached row on failure
      if(!cachedRow && mySeq === pfOpenSeq) closeProfilePage();
    }
  }

  // paint profile row
  function pfPaintProfile(data, username, pushUrl){
      pf.profile = data;
      pf.isOwner = !!(currentUser && currentUser.id === data.id);
      // cache and preload
      pfMediaCache[username] = { avatar_url: data.avatar_url||null, banner_url: data.banner_url||null };
      pfPreloadImage(getThumbnailUrl(data.avatar_url));
      pfPreloadImage(getViewUrl(data.banner_url));
      var pfVisibleName = data.display_name || data.username;
      document.getElementById('pfUsername').textContent = pfVisibleName;
      var _hnEl=document.getElementById('pfHandle'); if(_hnEl) _hnEl.textContent = '@' + data.username;
      document.getElementById('pfAvatarLetter').textContent = (pfVisibleName||'?').charAt(0).toUpperCase();
      document.getElementById('pfEditAvatarLetter').textContent = (pfVisibleName||'?').charAt(0).toUpperCase();
      pfRenderAvatarBanner();
      document.getElementById('pfJoined').textContent = data.created_at ? ('JOINED '+pfFormatDate(data.created_at).toUpperCase()) : '';
      var _pfUpWrap = document.getElementById('pfUploadWrap'); if(_pfUpWrap) _pfUpWrap.style.display = 'none'; // upload moved to nav
      // edit lives in action row
      pfRenderBio();
      pfRenderHeadBio();
      pfRenderConnect();
      pfLoadStats();
      pfLoadHeadStats();
      pfLoadActionRow();
      pfLoadMoreGallery();
      if(pushUrl!==false && window.location.pathname !== '/profile/'+encodeURIComponent(username)){
        try{ history.pushState({profileUser:username},'','/profile/'+encodeURIComponent(username)); }catch(e){}
      }
  }

  function closeProfilePage(revertUrl, restore){
    var panel = document.getElementById('profilePage');
    if(!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    closePfUploadMenu();
    document.getElementById('pfEditPage').classList.remove('open');
    restoreScroll();
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = '';
    if(revertUrl!==false && /^\/profile\//.test(window.location.pathname)){
      try{ history.pushState({},'', '/'); }catch(e){}
    }
    // back returns to overlay
    var ret = window.pfReturnOverlay; window.pfReturnOverlay = null;
    if(restore===true){
      if(ret==='fg'){
        var fg = document.getElementById('fg');
        if(fg && !fg.classList.contains('open')){
          fg.classList.add('open');
          document.body.style.overflow='hidden';
          if(typeof bnSetActive==='function') bnSetActive('bnGallery');
        }
      } else if(ret==='communityPage'){
        // re enter community properly
        if(typeof openCommunityHome==='function'){
          openCommunityHome();
          if(typeof bnSetActive==='function') bnSetActive('bnCommunity');
        }
      } else if(ret==='rankPage'){
        // re open same board
        if(typeof window.openRankPage==='function'){ window.openRankPage(); }
      } else if(ret==='dzView'){
        // re reveal detail view
        setTimeout(function(){
          // re reveal gallery behind
          var fg = document.getElementById('fg');
          if(fg && !fg.classList.contains('open')){
            fg.classList.add('open');
            if(typeof bnSetActive==='function') bnSetActive('bnGallery');
          }
          var dz = document.getElementById('dzView');
          if(dz && !dz.classList.contains('open')){
            dz.classList.add('open');
            document.body.style.overflow='hidden';
          }
        }, 0);
      }
    }
  }

  function pfSwitchTab(tab){
    pf.tab=tab;
    ['gallery','resources','blog','marketplace','album','progress','about'].forEach(function(t){
      document.getElementById('pfTab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
      document.getElementById('pfPanel'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
    });
    // on demand tabs
    if(tab==='progress' && typeof xpLoadInto==='function' && pf.profile){
      xpLoadInto('pfXpWrap', pf.profile.id, { leaderboard:true });
    }
    if(tab==='album') albLoadProfileTab();
    if(tab==='resources') pfLoadResources();
    if(tab==='blog') pfLoadBlog();
    if(tab==='marketplace') pfLoadMarket();
  }

  // resources and marketplace tabs
  function pfDzCard(sec){
    return function(r){
      var id = esc(String(r.id));
      var H  = window.dzHelpers || { bytes:function(){return '';}, money:function(){return '';} };
      var thumb = r.preview_url
        ? '<img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(r.preview_url))+'" alt="'+esc(r.title||'')+'">'
        : '<span class="dzExt">'+esc(String(sec==='resources'?(r.file_ext||'FILE'):(r.item_type||'ITEM')).toUpperCase())+'</span>';
      if(sec==='resources'){
        return '<div class="dzCard" onclick="pfDzOpen(\'resources\',\''+id+'\')">'+
          '<div class="dzThumb">'+thumb+'<span class="dzBadge">'+esc((r.file_ext||'').toUpperCase())+'</span></div>'+
          '<div class="dzBody"><div class="dzName">'+esc(r.title||'')+'</div>'+
          '<div class="dzMeta"><span>'+esc(H.bytes(r.file_size))+'</span>'+
          '<span>'+esc(String(r.download_count||0))+' downloads</span>'+
          '<span>'+esc(r.license||'')+'</span></div></div></div>';
      }
      // price and buy live in the slot, which only the signed-in module fills
      return '<div class="dzCard" onclick="pfDzOpen(\'marketplace\',\''+id+'\')">'+
        '<div class="dzThumb">'+thumb+'<span class="dzBadge">'+esc((r.item_type||'').toUpperCase())+'</span></div>'+
        '<div class="dzBody"><div class="dzName">'+esc(r.title||'')+'</div>'+
        (typeof window.dzSlot === 'function' ? window.dzSlot(r, id, r.file_ext?1:0, 'card') : '')+
        '<div class="dzMeta"><span>'+esc(r.license||'')+'</span>'+
        (r.delivery_days ? '<span>'+esc(String(r.delivery_days))+'d delivery</span>' : '')+
        '</div></div></div>';
    };
  }

  function pfDzOpen(sec, id){
    var arr = sec==='resources' ? (pf.resRows||[]) : sec==='blog' ? (pf.blogRows||[]) : (pf.mktRows||[]);
    var row = arr.find(function(x){ return String(x.id)===String(id); });
    if(row && typeof window.dzOpenRow==='function') window.dzOpenRow(sec, row);
  }

  async function pfLoadResources(){
    if(!pf.profile || pf.resLoaded) return;
    var grid = document.getElementById('pfResGrid'), empty = document.getElementById('pfResEmpty');
    if(!grid) return;
    if(empty) empty.style.display='none';
    grid.innerHTML='<div class="pfEmpty" style="display:block;">Loading…</div>';
    try{
      const{data,error}=await sb.from('resources')
        .select('id,user_id,title,description,category,tags,file_url,file_name,file_ext,file_size,preview_url,license,software,download_count,created_at')
        .eq('user_id', pf.profile.id).eq('status','approved')
        .order('created_at',{ascending:false}).limit(60);
      if(error) throw error;
      var rows = data||[];
      pf.resLoaded=true; pf.resRows=rows;
      grid.innerHTML = rows.map(pfDzCard('resources')).join('');
      if(empty) empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      grid.innerHTML=''; if(empty) empty.style.display='';
      showToast('Couldn\u2019t load \u2014 try again');
    }
  }

  async function pfLoadMarket(){
    if(!pf.profile || pf.mktLoaded) return;
    var grid = document.getElementById('pfMktGrid'), empty = document.getElementById('pfMktEmpty');
    if(!grid) return;
    if(empty) empty.style.display='none';
    grid.innerHTML='<div class="pfEmpty" style="display:block;">Loading…</div>';
    try{
      // file url not selected
      const{data,error}=await sb.from('marketplace_items')
        .select(typeof window.dzSelectFor === 'function'
          ? window.dzSelectFor('marketplace')
          : 'id,user_id,title,description,category,tags,item_type,currency,file_ext,file_size,preview_url,license,delivery_days,created_at')
        .eq('user_id', pf.profile.id).eq('status','approved')
        .order('created_at',{ascending:false}).limit(60);
      if(error) throw error;
      var rows = data||[];
      pf.mktLoaded=true; pf.mktRows=rows;
      grid.innerHTML = rows.map(pfDzCard('marketplace')).join('');
      if(typeof window.dzExtras === 'function') window.dzExtras();
      if(empty) empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      grid.innerHTML=''; if(empty) empty.style.display='';
      showToast('Couldn\u2019t load \u2014 try again');
    }
  }

  // blog rows, not grid
  function pfBlogRow(r){
    var id = esc(String(r.id));
    var H  = window.dzHelpers || { ago:function(){return '';} };
    var ico = r.cover_url
      ? '<img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(r.cover_url))+'" alt="">'
      : esc((r.title||'?').charAt(0).toUpperCase());
    var ex = r.excerpt || String(r.body||'').slice(0,140);
    return '<div class="dzRow" onclick="pfDzOpen(\'blog\',\''+id+'\')"><div class="dzRowIco">'+ico+'</div>'+
      '<div style="min-width:0;flex:1"><div class="dzName">'+esc(r.title||'')+'</div>'+
      '<div class="dzMeta" style="margin:.2rem 0 .3rem"><span>'+esc(H.ago(r.created_at))+'</span>'+
      '<span>'+esc(String(r.read_minutes||1))+' min read</span></div>'+
      '<div class="dzHint">'+esc(ex)+'</div></div></div>';
  }

  async function pfLoadBlog(){
    if(!pf.profile || pf.blogLoaded) return;
    var host = document.getElementById('pfBlogList'), empty = document.getElementById('pfBlogEmpty');
    if(!host) return;
    if(empty) empty.style.display='none';
    host.innerHTML='<div class="pfEmpty" style="display:block;">Loading…</div>';
    try{
      const{data,error}=await sb.from('blog_posts')
        .select('id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,created_at')
        .eq('user_id', pf.profile.id).eq('status','approved')
        .order('created_at',{ascending:false}).limit(60);
      if(error) throw error;
      var rows = data||[];
      pf.blogLoaded=true; pf.blogRows=rows;
      host.innerHTML = rows.map(pfBlogRow).join('');
      if(empty) empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      host.innerHTML=''; if(empty) empty.style.display='';
      showToast('Couldn\u2019t load \u2014 try again');
    }
  }

  // like and bookmark tabs
  // thumbstyle builder
  // contract
  function thumbStyle(x, y, z){
    var tx = (x!=null && isFinite(+x)) ? +x : 50;
    var ty = (y!=null && isFinite(+y)) ? +y : 50;
    var tz = (z!=null && isFinite(+z)) ? Math.max(1, Math.min(2, +z)) : 1;
    var s = 'object-position:'+tx+'% '+ty+'%';
    if(tz > 1) s += ';transform:scale('+tz+');transform-origin:'+tx+'% '+ty+'%';
    return s;
  }

  function pfSavedCardHTML(a){
    return '<div class="awCard" onclick="pfSavedOpen(\''+esc(String(a.id))+'\')">'+
      '<div class="awImgWrap awLoading"><img loading="lazy" onload="this.parentNode.classList.remove(\'awLoading\')" onerror="this.parentNode.classList.remove(\'awLoading\')" '+dzThumbAttrs(a.image_url)+' alt="'+esc(a.name||'')+'" style="'+thumbStyle(a.thumb_x, a.thumb_y, a.thumb_zoom)+'"></div>'+
    '</div>';
  }
  async function pfSavedOpen(id){
    // fetch single row fallback
    if(openArtworkById(id,false)) return;
    try{
      const{data}=await sb.from('artworks').select('*').eq('id',id).maybeSingle();
      if(!data) return;
      var cats=catList(data.category).length?catList(data.category):['others'];
      openLB(data.image_url, data.name, cats[0]||'', data.description||'', String(data.id), false);
    }catch(e){}
  }
  var pfSavedSent = { like:null, bookmark:null };
  function pfEnsureSavedSentinel(kind){
    if(pfSavedSent[kind]) return;
    var el = document.getElementById(kind==='like'?'pfLikeSentinel':'pfBookmarkSentinel');
    if(!el) return;
    pfSavedSent[kind] = makeGridSentinel(document.getElementById('profilePage'), function(){
      pfSavedAppend(kind);
    }, el);
  }
  // render in batches
  function pfSavedAppend(kind){
    if(!pf.savedRows) return;
    var rows  = pf.savedRows[kind]||[];
    var shown = (pf.savedShown && pf.savedShown[kind])||0;
    var grid  = document.getElementById(kind==='like'?'pfLikeGrid':'pfBookmarkGrid');
    var sentEl= document.getElementById(kind==='like'?'pfLikeSentinel':'pfBookmarkSentinel');
    if(!grid || shown >= rows.length){ if(sentEl) sentEl.style.display='none'; return; }
    var size = shown ? gridStepBatch() : gridInitialBatch();
    var next = rows.slice(shown, shown + size);
    pf.savedShown[kind] = shown + next.length;
    grid.insertAdjacentHTML('beforeend', next.map(pfSavedCardHTML).join(''));
    if(sentEl){
      var more = pf.savedShown[kind] < rows.length;
      sentEl.style.display = more ? '' : 'none';
      if(more && pfSavedSent[kind]) pfSavedSent[kind].recheck();
    }
  }
  async function pfLoadSaved(kind){
    if(!pf.profile) return;
    var like = kind==='like';
    var grid  = document.getElementById(like?'pfLikeGrid':'pfBookmarkGrid');
    var empty = document.getElementById(like?'pfLikeEmpty':'pfBookmarkEmpty');
    var flag  = like?'likeLoaded':'bmLoaded';
    if(pf[flag]) return; // already fetched
    empty.style.display='none';
    grid.innerHTML='<div class="pfEmpty" style="display:block;">Loading…</div>';
    try{
      const{data,error}=await sb.rpc(like?'get_user_liked_artworks':'get_user_bookmarked_artworks',
                                     {target: pf.profile.id, lim: 100, off: 0});
      if(error) throw error;
      var rows = data||[];
      pf[flag]=true;
      pf.savedRows  = pf.savedRows ||{like:[],bookmark:[]};
      pf.savedShown = pf.savedShown||{like:0,bookmark:0};
      pf.savedRows[kind] = rows;
      pf.savedShown[kind] = 0;
      grid.innerHTML = '';
      pfEnsureSavedSentinel(kind);
      pfSavedAppend(kind);
      empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      grid.innerHTML='';
      empty.style.display='';
      showToast('Couldn\u2019t load \u2014 try again');
    }
  }
