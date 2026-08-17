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

  // One member's own row. Private, so the cache stamps it with their id and
  // refuses it for anybody else; short, because it is what the header, the
  // greeting and every avatar chip read; and written down, so the profile
  // panel opens with a name in it rather than a blank while the query runs.
  function pfOwnKey(){
    var c = window.dzCached ? window.dzCached() : null;
    return (c && c.ukey) ? c.ukey('profile') : null;
  }
  function pfCacheOwn(row){
    var c = window.dzCached && window.dzCached(), k = pfOwnKey();
    if(c && k && row) c.set(k, row, 'user:profile');
  }
  window.pfOwnProfileCached = function(){
    var c = window.dzCached && window.dzCached(), k = pfOwnKey();
    return (c && k) ? c.peek(k, 'user:profile', { any:true }) : null;
  };

  async function pfEnsureOwnProfile(){
    if(!sb || !currentUser) return null;
    try{
      // zero rows is expected
      const{data:existing,error:se}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('id',currentUser.id).maybeSingle();
      if(se) throw se;
      if(existing){ pfCacheOwn(existing); return existing; }
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
          pfCacheOwn(ins);
          return ins;
        }
        var msg = (ie && ie.message) || '';
        if(/duplicate|unique|23505/i.test(msg)){
          // handle id or name conflict
          const{data:again}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('id',currentUser.id).maybeSingle();
          if(again){ pfCacheOwn(again); return again; }
          uname = base.slice(0,24)+'_'+Math.random().toString(36).slice(2,6);
          continue;
        }
        console.error('pfEnsureOwnProfile: '+msg);
        return null;
      }
    }catch(e){
      console.error('pfEnsureOwnProfile: '+(e.message||e));
      // Offline. Their own saved row, however old — refused outright if the
      // session it was written for is not this one.
      var cachedProf = window.pfOwnProfileCached();
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
    // the page window and the ids already on it belong to one profile
    pf.galleryOffset=0; pf.galleryIds=Object.create(null);
    // and so does any claim on the totals tiles
    ['pfStatLikes','pfStatViews'].forEach(function(id){
      var e=document.getElementById(id); if(e) delete e.dataset.total;
    });
    pf.resLoaded=false; pf.mktLoaded=false; pf.blogLoaded=false; pf.resRows=[]; pf.mktRows=[]; pf.blogRows=[];
    // reset albums per profile
    pf.albumsLoaded=false; pf.albums=[];
    /* And the panels themselves, which is the half this used to leave out.
       Everything above empties the ARRAYS a panel is drawn from; the drawn
       panel stayed in the document, holding the last profile opened.

       It cost two bugs, both of which read as caching because both only
       happened on a profile that had been opened before — the warm path is
       the one that skipped the clear:

       the gallery multiplied. Its loader appends a page rather than
       replacing the grid, and the id-dedupe it appends through was reset one
       line above. So a second open drew page one under page one, a third
       drew it a third time, and every artwork appeared once per visit.

       the other tabs showed the wrong member's work. A tab's loader starts
       `if(!pf.profile) return`, and pf.profile is null from here until the
       row lands, so tapping Albums in that window returned before the grid
       was cleared and left the previous profile's Likes and Bookmarks
       covers on screen, under this profile's name.

       Emptied here, beside the state each one mirrors, so a panel and the
       array behind it cannot disagree about whose profile this is. */
    ['pfGalleryGrid','pfAlbumGrid','pfResGrid','pfBlogList','pfMktGrid','pfXpWrap',
     'pfConnectList']
      .forEach(function(id){ var e=document.getElementById(id); if(e) e.innerHTML=''; });
    // About is painted from the row rather than fetched, so it has no loader
    // to clear it and was showing the last profile's bio, links and merit
    // under this profile's name for as long as the row took to arrive.
    var _bio=document.getElementById('pfBioText'); if(_bio) _bio.textContent='';
    var _mer=document.getElementById('pfStatMerit'); if(_mer) _mer.textContent='—';
    // an empty-state belongs to the panel it sits under, and none of them has
    // been answered for this profile yet
    ['pfGalleryEmpty','pfAlbumEmpty','pfResEmpty','pfBlogEmpty','pfMktEmpty']
      .forEach(function(id){ var e=document.getElementById(id); if(e) e.style.display='none'; });
    // a profile's search results belong to that profile
    pfSearchReset();
    var _pgs=document.getElementById('pfGallerySentinel'); if(_pgs) _pgs.style.display='none';
    // stale fetch guard
    var mySeq = ++pfOpenSeq;

    /* Stale while revalidate, now across visits rather than only within one.
       pfRowCache is this tab's memory and empties on reload; the cache service
       keeps the row on disk under the name it was opened by, so opening a
       profile you have seen before paints the header, avatar and banner
       immediately and the query behind it only corrects them. Public data, so
       it is not partitioned by viewer — a profile page looks the same to
       everybody, which is exactly why it is safe to share on a device. */
    var pfLc = String(username).toLowerCase();
    var pfCache = window.dzCached ? window.dzCached() : null;
    var pfKey = 'profile:public:name:' + (pfCache ? pfCache.norm(pfLc) : pfLc);
    var cachedRow = pfRowCache[pfLc] ||
                    (pfCache ? pfCache.peek(pfKey, 'profile:public', { any:true }) : null);
    if(cachedRow){
      pfSwitchTab('gallery');
      pfPaintProfile(cachedRow, cachedRow.username, pushUrl);
    } else {
      // first visit, show skeleton. The panels were emptied above, on both
      // paths — this branch only has the header left to blank.
      document.getElementById('pfUsername').textContent='Loading…';
      document.getElementById('pfAvatarLetter').textContent='?';
      document.getElementById('pfAvatarImg').style.display='none';
      document.getElementById('pfBannerImg').style.display='none';
      document.getElementById('pfJoined').textContent='';
      var _hb=document.getElementById('pfHeadBio'); if(_hb) _hb.textContent='';
      var _hn=document.getElementById('pfHandle'); if(_hn) _hn.textContent='';
      var _sr=document.getElementById('pfStatsRow'); if(_sr) _sr.hidden=true;
      var _ar=document.getElementById('pfActionRow'); if(_ar) _ar.hidden=true;
      var _wm=document.getElementById('pfWarnMark'); if(_wm) _wm.classList.remove('on');
      pfPaintTopBar(null);
      // clear previous tint
      if(window.DZ_MS){
        DZ_MS.paintName(document.getElementById('pfUsername'), 0);
        DZ_MS.paintRibbon(document.getElementById('pfMsRibbon'), 0);
      }
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
      if(pfCache) pfCache.set(pfKey, data, 'profile:public');   // and for the next visit
      pfPaintProfile(data, username, pushUrl);
    }catch(e){
      console.error('Error: '+e.message);
      // keep cached row on failure
      if(!cachedRow && mySeq === pfOpenSeq) closeProfilePage();
    }
  }

  // Search, the bell and the settings menu act on your own account, so they
  // are only drawn on your own profile. Somebody else's carries a way back
  // out of it instead — the bar is the only chrome the page has.
  // The bar names the page, not the person on it: it reads PROFILE on every
  // profile. Whose profile it is, is what the name under the banner is for.
  // Only the two things that act on your own account move — the back arrow,
  // which someone else's profile needs and yours does not, and the search,
  // bell and menu, which are yours. isOwner null means the row has not landed
  // yet: no back arrow, so opening your own does not flash one.
  function pfPaintTopBar(isOwner){
    var back = document.getElementById('pfTopBack');
    var acts = document.getElementById('pfTopActions');
    var known = (isOwner !== null && isOwner !== undefined);
    if(back) back.hidden = !known || !!isOwner;
    if(acts) acts.hidden = !isOwner;
  }

  // paint profile row
  function pfPaintProfile(data, username, pushUrl){
      pf.profile = data;
      pf.isOwner = !!(currentUser && currentUser.id === data.id);
      pfPaintTopBar(pf.isOwner);
      // Somebody else's profile, opened. Deduped per viewer per day in the
      // database, and dropped outright when the viewer is the owner, so this
      // does not need to know whether the page was already open.
      if(!pf.isOwner && typeof window.dzAnTrack === 'function'){
        window.dzAnTrack('profile_view', null, { scope: 'profile', owner: String(data.id) });
      }
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
      document.getElementById('pfJoined').textContent = data.created_at ? ('Joined '+pfFormatDate(data.created_at)) : '';
      pfRenderBio();
      pfRenderHeadBio();
      pfRenderConnect();
      pfLoadStats();
      pfLoadHeadStats();
      pfLoadActionRow();
      pfLoadMoreGallery();
      // the row exists now, so a tab that was opened before it arrived and
      // bailed out of its own loader gets the load it was waiting for
      if(pf.tab && pf.tab !== 'gallery') pfLoadTab(pf.tab);
      if(pushUrl!==false && window.location.pathname !== '/profile/'+encodeURIComponent(username)){
        // where to put the address bar back when this closes
        pfReturnUrl = window.location.pathname + window.location.search;
        try{ history.pushState({profileUser:username},'','/profile/'+encodeURIComponent(username)); }catch(e){}
      }
  }

  // Where the address bar was when this panel took it over. Null means the
  // profile was opened by its own url and there is nothing behind it.
  var pfReturnUrl = null;
  // A browser-driven move invalidates it: the recorded position is not where
  // we are any more.
  window.addEventListener('popstate', function(){ pfReturnUrl = null; });

  function closeProfilePage(revertUrl, restore){
    var panel = document.getElementById('profilePage');
    if(!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    closePfSearch(true);
    document.getElementById('pfEditPage').classList.remove('open');
    restoreScroll();
    /* REPLACE, do not push. Opening pushed /profile/<name>; closing pushed '/'
       on top of it, so each visit left two entries behind and Back re-opened
       the profile that had just been closed. And '/' was a guess: a profile
       opened from the gallery or from an artwork used to drop the reader on the
       home page instead of back where they were. */
    if(revertUrl!==false && /^\/profile\//.test(window.location.pathname)){
      try{ history.replaceState({},'', pfReturnUrl || '/'); }catch(e){}
      pfReturnUrl = null;
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

  // reading order of the rail, and the order the arrow keys walk
  var PF_TABS = ['gallery','album','resources','blog','marketplace','progress','about'];

  function pfSwitchTab(tab){
    pf.tab=tab;
    PF_TABS.forEach(function(t){
      var cap = t.charAt(0).toUpperCase()+t.slice(1);
      var btn = document.getElementById('pfTab'+cap);
      var pan = document.getElementById('pfPanel'+cap);
      var on  = (t===tab);
      if(btn){
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        // A tab rail is one stop on the page, not seven. Tab lands on the
        // selected one and the arrow keys move within — which is also why
        // the others are taken out of the tab order rather than hidden.
        btn.tabIndex = on ? 0 : -1;
        // seven tabs do not fit a phone, so the one in use is scrolled into
        // the rail rather than left off the end of it
        if(on && btn.scrollIntoView){
          try{ btn.scrollIntoView({behavior:'smooth', inline:'nearest', block:'nearest'}); }catch(e){}
        }
      }
      if(pan) pan.classList.toggle('active', on);
    });
    pfLoadTab(tab);
  }

  /* The four tabs that fetch when they are opened, and the one that needs the
     row to exist first. Every one of them starts by checking pf.profile, which
     is null from the moment a profile is opened until its row lands — so a tab
     tapped in that window used to load nothing and never try again. It is
     called from two places for that reason: when a tab is chosen, and when the
     row arrives, whichever happens second. Each loader keeps its own loaded
     flag, so being asked twice costs one call. */
  function pfLoadTab(tab){
    if(tab==='progress' && typeof xpLoadInto==='function' && pf.profile){
      xpLoadInto('pfXpWrap', pf.profile.id, { leaderboard:true });
    }
    if(tab==='album') albLoadProfileTab();
    if(tab==='resources') pfLoadResources();
    if(tab==='blog') pfLoadBlog();
    if(tab==='marketplace') pfLoadMarket();
  }

  /* Arrow keys along the rail, Home and End to its ends — the tabs pattern
     everything else with role="tablist" answers to. Selection follows the
     arrow, which is right here because switching a tab costs nothing: the
     panel is already in the page. Up and Down are left alone; this rail is
     horizontal and they belong to the scroll. */
  function pfTabKey(e){
    var i = PF_TABS.indexOf(pf.tab);
    if(i === -1) return;
    var next;
    if(e.key === 'ArrowRight')      next = (i + 1) % PF_TABS.length;
    else if(e.key === 'ArrowLeft')  next = (i - 1 + PF_TABS.length) % PF_TABS.length;
    else if(e.key === 'Home')       next = 0;
    else if(e.key === 'End')        next = PF_TABS.length - 1;
    else return;
    e.preventDefault();
    var t = PF_TABS[next];
    pfSwitchTab(t);
    var btn = document.getElementById('pfTab' + t.charAt(0).toUpperCase() + t.slice(1));
    // pfSwitchTab already scrolled it into the rail; focus must not fight that
    if(btn) try{ btn.focus({preventScroll:true}); }catch(e2){ btn.focus(); }
  }
  document.addEventListener('DOMContentLoaded', function(){
    var rail = document.getElementById('pfTabGroup');
    if(rail) rail.addEventListener('keydown', pfTabKey);
  });

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

  /* Whose profile a tab is being loaded for, checked again when the reply
     lands. All three of these await a query and then paint, and none of them
     used to look up afterwards — so opening one profile, tapping Resources
     and opening another before the reply arrived painted the first member's
     work into the second member's tab, and set the loaded flag, so the right
     rows were never fetched at all. The albums tab and the gallery pager have
     always checked; these three are brought into line with them. */
  function pfStillOn(forId){
    return !!pf.profile && String(pf.profile.id) === String(forId);
  }

  async function pfLoadResources(){
    if(!pf.profile || pf.resLoaded) return;
    var grid = document.getElementById('pfResGrid'), empty = document.getElementById('pfResEmpty');
    if(!grid) return;
    var forId = String(pf.profile.id);
    if(empty) empty.style.display='none';
    grid.innerHTML='<div class="pfEmpty" style="display:block;">Loading…</div>';
    try{
      const{data,error}=await sb.from('resources')
        .select('id,user_id,title,description,category,tags,file_storage_path,file_name,file_ext,file_size,preview_url,license,software,download_count,created_at')
        .eq('user_id', pf.profile.id).eq('status','approved')
        .order('created_at',{ascending:false}).limit(60);
      if(error) throw error;
      if(!pfStillOn(forId)) return;   // another profile owns this tab now
      var rows = data||[];
      pf.resLoaded=true; pf.resRows=rows;
      grid.innerHTML = rows.map(pfDzCard('resources')).join('');
      if(empty) empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      if(!pfStillOn(forId)) return;
      grid.innerHTML=''; if(empty) empty.style.display='';
      showToast('Couldn\u2019t load \u2014 try again');
    }
  }

  async function pfLoadMarket(){
    if(!pf.profile || pf.mktLoaded) return;
    var grid = document.getElementById('pfMktGrid'), empty = document.getElementById('pfMktEmpty');
    if(!grid) return;
    var forId = String(pf.profile.id);
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
      if(!pfStillOn(forId)) return;   // another profile owns this tab now
      var rows = data||[];
      pf.mktLoaded=true; pf.mktRows=rows;
      grid.innerHTML = rows.map(pfDzCard('marketplace')).join('');
      if(typeof window.dzExtras === 'function') window.dzExtras();
      if(empty) empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      if(!pfStillOn(forId)) return;
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
    var forId = String(pf.profile.id);
    if(empty) empty.style.display='none';
    host.innerHTML='<div class="pfEmpty" style="display:block;">Loading…</div>';
    try{
      const{data,error}=await sb.from('blog_posts')
        .select('id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,created_at')
        .eq('user_id', pf.profile.id).eq('status','approved')
        .order('created_at',{ascending:false}).limit(60);
      if(error) throw error;
      if(!pfStillOn(forId)) return;   // another profile owns this tab now
      var rows = data||[];
      pf.blogLoaded=true; pf.blogRows=rows;
      host.innerHTML = rows.map(pfBlogRow).join('');
      if(empty) empty.style.display = rows.length ? 'none' : '';
    }catch(e){
      if(!pfStillOn(forId)) return;
      host.innerHTML=''; if(empty) empty.style.display='';
      showToast('Couldn\u2019t load \u2014 try again');
    }
  }

  // thumbnail crop, shared by every grid card on the page
  function thumbStyle(x, y, z){
    var tx = (x!=null && isFinite(+x)) ? +x : 50;
    var ty = (y!=null && isFinite(+y)) ? +y : 50;
    var tz = (z!=null && isFinite(+z)) ? Math.max(1, Math.min(2, +z)) : 1;
    var s = 'object-position:'+tx+'% '+ty+'%';
    if(tz > 1) s += ';transform:scale('+tz+');transform-origin:'+tx+'% '+ty+'%';
    return s;
  }


  /* ---- search inside one profile -------------------------------------
     Scoped to the profile being viewed and to nothing else: this artist's
     artwork, blog posts, listings and resources. It is drawn on your own
     profile only, so in practice it is you searching your own work. */

  var pfSrch = { q:'', scope:'all', seq:0, timer:null, rows:{} };

  var PF_SRCH_GROUPS = [
    { key:'artwork',     label:'Artwork' },
    { key:'blog',        label:'Blog' },
    { key:'marketplace', label:'Marketplace' },
    { key:'resources',   label:'Resources' }
  ];

  // ilike takes a pattern, so the wildcards a user types are literal text to
  // them and syntax to us. Strip those, and the characters PostgREST reads as
  // filter punctuation, rather than searching for something nobody asked for.
  function pfSearchPattern(q){
    var clean = String(q||'').replace(/[%_*(),."\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
    return clean ? '%'+clean+'%' : '';
  }

  function pfSearchReset(){
    pfSrch.q=''; pfSrch.scope='all'; pfSrch.rows={};
    clearTimeout(pfSrch.timer); pfSrch.timer=null;
    pfSrch.seq++;
    var input = document.getElementById('pfSrchIn');
    if(input) input.value='';
    tgSearchChrome('pfSrchWrap','');
    pfSearchPaintScopes();
    var res = document.getElementById('pfSrchRes');
    if(res) res.innerHTML='';
    pfSearchNote('Type a name to search this profile.');
  }

  function pfSearchNote(msg){
    var n = document.getElementById('pfSrchNote');
    if(!n) return;
    n.textContent = msg || '';
    n.hidden = !msg;
  }

  /* The search page covers the profile but does not remove it, so without
     this Tab walks straight off the bottom of the search results and into
     the tabs, buttons and thumbnails still sitting underneath — a keyboard
     or screen reader ends up somewhere it cannot see. Tab is kept inside
     the dialog, and where focus came from is remembered so it can be handed
     back when the dialog closes. */
  var pfSrchLastFocus = null;

  function pfSrchFocusable(){
    var pg = document.getElementById('pfSearchPage');
    if(!pg) return [];
    var sel = 'a[href],button:not([disabled]),input:not([disabled]),' +
              'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(pg.querySelectorAll(sel), function(el){
      // the clear button only exists while there is something to clear
      return !el.hidden && el.offsetParent !== null;
    });
  }

  function pfSrchTrap(e){
    if(e.key !== 'Tab') return;
    var pg = document.getElementById('pfSearchPage');
    if(!pg || !pg.classList.contains('open')) return;
    var items = pfSrchFocusable();
    if(!items.length) return;
    var first = items[0], last = items[items.length - 1];
    // focus outside the dialog at all — a click through, or a stray tabindex —
    // comes back to the near end rather than being left where it was
    if(!pg.contains(document.activeElement)){
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', pfSrchTrap, true);

  function openPfSearch(){
    if(!pf.profile){ showToast('Profile still loading — try again'); return; }
    var pg = document.getElementById('pfSearchPage');
    if(!pg) return;
    pfSrchLastFocus = document.activeElement;
    pg.classList.add('open');
    document.body.style.overflow='hidden';
    var input = document.getElementById('pfSrchIn');
    // the keyboard should come up with the page, not after a second tap
    if(input) setTimeout(function(){ try{ input.focus(); }catch(e){} }, 60);
  }

  // silent is for the profile closing underneath it: the page goes with it,
  // and the scroll lock belongs to whatever is left on screen
  function closePfSearch(silent){
    var pg = document.getElementById('pfSearchPage');
    if(!pg || !pg.classList.contains('open')) return;
    pg.classList.remove('open');
    if(silent !== true) document.body.style.overflow='hidden';   // profile is still up
    // hand focus back to whatever opened the search — the bar button, usually.
    // Not when the profile went with it: that button is gone from the page too.
    var back = pfSrchLastFocus; pfSrchLastFocus = null;
    if(silent !== true && back && back.isConnected && back.focus){
      try{ back.focus({preventScroll:true}); }catch(e){ try{ back.focus(); }catch(e2){} }
    }
  }

  function pfSearchClear(){
    var input = document.getElementById('pfSrchIn');
    if(input){ input.value=''; try{ input.focus(); }catch(e){} }
    pfSearchInput('');
  }

  function pfSearchInput(v){
    pfSrch.q = String(v||'');
    tgSearchChrome('pfSrchWrap', pfSrch.q);
    clearTimeout(pfSrch.timer);
    pfSrch.timer = setTimeout(pfSearchRun, 220);
  }

  function pfSearchScope(scope){
    if(pfSrch.scope === scope) return;
    pfSrch.scope = scope;
    pfSearchPaintScopes();
    pfSearchRun();
  }

  function pfSearchPaintScopes(){
    var wrap = document.getElementById('pfSrchScopes');
    if(!wrap) return;
    var order = ['all'].concat(PF_SRCH_GROUPS.map(function(g){ return g.key; }));
    Array.prototype.forEach.call(wrap.children, function(btn, i){
      var on = order[i] === pfSrch.scope;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  async function pfSearchRun(){
    if(!pf.profile || !sb) return;
    var pattern = pfSearchPattern(pfSrch.q);
    var res = document.getElementById('pfSrchRes');
    if(!res) return;
    if(!pattern){
      pfSrch.rows = {};
      res.innerHTML='';
      pfSearchNote('Type a name to search this profile.');
      return;
    }
    var mySeq = ++pfSrch.seq, uid = pf.profile.id;
    pfSearchNote('Searching…');

    function want(key){ return pfSrch.scope === 'all' || pfSrch.scope === key; }

    var jobs = [];
    if(want('artwork')){
      jobs.push(sb.from('artworks')
        .select('id,name,description,category,tags,image_url,thumb_x,thumb_y,thumb_zoom,status,created_at')
        .eq('user_id',uid).eq('kind',ART_KIND_ART).ilike('name',pattern)
        .order('created_at',{ascending:false}).limit(30)
        .then(function(r){ return {key:'artwork', rows:(r&&r.data)||[]}; }));
    }
    if(want('blog')){
      jobs.push(sb.from('blog_posts')
        .select('id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,created_at')
        .eq('user_id',uid).eq('status','approved').ilike('title',pattern)
        .order('created_at',{ascending:false}).limit(30)
        .then(function(r){ return {key:'blog', rows:(r&&r.data)||[]}; }));
    }
    if(want('marketplace')){
      jobs.push(sb.from('marketplace_items')
        .select(typeof window.dzSelectFor === 'function'
          ? window.dzSelectFor('marketplace')
          : 'id,user_id,title,description,category,tags,item_type,currency,file_ext,file_size,preview_url,license,delivery_days,created_at')
        .eq('user_id',uid).eq('status','approved').ilike('title',pattern)
        .order('created_at',{ascending:false}).limit(30)
        .then(function(r){ return {key:'marketplace', rows:(r&&r.data)||[]}; }));
    }
    if(want('resources')){
      jobs.push(sb.from('resources')
        .select('id,user_id,title,description,category,tags,file_storage_path,file_name,file_ext,file_size,preview_url,license,software,download_count,created_at')
        .eq('user_id',uid).eq('status','approved').ilike('title',pattern)
        .order('created_at',{ascending:false}).limit(30)
        .then(function(r){ return {key:'resources', rows:(r&&r.data)||[]}; }));
    }

    var out;
    try{ out = await Promise.all(jobs); }
    catch(e){
      if(mySeq !== pfSrch.seq) return;
      res.innerHTML='';
      pfSearchNote('Couldn\u2019t search — try again.');
      return;
    }
    // a slower earlier query must not land on top of a newer one
    if(mySeq !== pfSrch.seq || !pf.profile || pf.profile.id !== uid) return;

    pfSrch.rows = {};
    out.forEach(function(o){ pfSrch.rows[o.key] = o.rows; });
    pfSearchRender();
  }

  function pfSearchRender(){
    var res = document.getElementById('pfSrchRes');
    if(!res) return;
    var total = 0, html = '';
    PF_SRCH_GROUPS.forEach(function(g){
      var rows = pfSrch.rows[g.key] || [];
      if(!rows.length) return;
      total += rows.length;
      html += '<section class="pfSrchGrp"><div class="pfSrchGrpHd">'+
                '<span class="pfSrchGrpTitle">'+esc(g.label)+'</span>'+
                '<span class="pfSrchGrpCount">'+rows.length+'</span>'+
              '</div><div class="pfSrchRows">'+
              rows.map(function(r){ return pfSearchRowHTML(g.key, r); }).join('')+
              '</div></section>';
    });
    res.innerHTML = html;
    pfSearchNote(total ? '' : 'Nothing here matches “'+pfSrch.q.trim()+'”.');
  }

  function pfSearchRowHTML(kind, r){
    var title = (kind==='artwork' ? r.name : r.title) || 'Untitled';
    var img   = kind==='artwork' ? r.image_url : (kind==='blog' ? r.cover_url : r.preview_url);
    var thumb = img
      ? '<img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(img))+'" alt="">'
      : esc(String(kind==='resources' ? (r.file_ext||'FILE')
                 : kind==='marketplace' ? (r.item_type||'ITEM')
                 : kind==='blog' ? 'POST' : 'ART').toUpperCase());
    var meta;
    if(kind==='artwork')          meta = (r.status && r.status!=='approved' ? String(r.status).toUpperCase()+' · ' : '') + pfFormatDate(r.created_at);
    else if(kind==='blog')        meta = (r.read_minutes||1)+' min read · '+pfFormatDate(r.created_at);
    else if(kind==='marketplace') meta = String(r.item_type||'Listing')+' · '+pfFormatDate(r.created_at);
    else                          meta = String(r.file_ext||'File').toUpperCase()+' · '+(r.download_count||0)+' downloads';
    return '<button type="button" class="pfSrchRow" onclick="pfSearchOpen(\''+esc(kind)+'\',\''+esc(String(r.id))+'\')">'+
      '<span class="pfSrchThumb">'+thumb+'</span>'+
      '<span class="pfSrchTxt">'+
        '<span class="pfSrchName">'+esc(title)+'</span>'+
        '<span class="pfSrchMeta">'+esc(meta)+'</span>'+
      '</span></button>';
  }

  // the results stay up behind whatever opens, so closing the artwork or the
  // listing puts you back on the same search rather than back at the profile
  function pfSearchOpen(kind, id){
    var rows = pfSrch.rows[kind] || [];
    var row  = rows.find(function(x){ return String(x.id)===String(id); });
    if(!row) return;
    if(kind==='artwork'){
      var cats = catList(row.category).length ? catList(row.category)
               : (catList(row.tags).length ? catList(row.tags) : ['others']);
      openLB(row.image_url, row.name, cats[0]||'', row.description||'', String(row.id), false, rows);
      return;
    }
    if(typeof window.dzOpenRow==='function') window.dzOpenRow(kind==='marketplace'?'marketplace':kind, row);
  }
