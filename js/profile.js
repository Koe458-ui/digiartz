/* ── profile.js · profile page ── */
  /* =========================================================
     USER PROFILE PAGE
     ├─ openProfileByUsername / openOwnProfile / closeProfilePage
     ├─ pfSwitchTab — Gallery / Comic / About
     ├─ pfLoadMoreGallery — paginated (range()) with column-aware
     │   batches, appended automatically by an infinite-scroll
     │   sentinel (no Load More button)
     ├─ pfUpMod — shared upload modal for art + comic (own
     │   user_id only; never exposes edit/delete to the owner)
     ├─ Admin (isDev) sees Edit/Delete on every card regardless
     │   of whose profile is being viewed
     ========================================================= */
  var pf = {
    profile: null,        // profiles row currently being viewed
    isOwner: false,
    tab: 'gallery',
    galleryRows: [], galleryDone: false, galleryBusy: false,
    upFile: null,
    upThumbFocus: null,    // {x,y} percentages set by confirmPfCrop()
    upPageFiles: [],
    upAlbums: [],          // album ids ticked on the upload page (optional)
    albums: [], albumsLoaded: false   // ALBUMS tab strip for the viewed profile
  };

  /* ── Profile avatar/banner preload ──
     pfMediaCache remembers the last-known avatar_url/banner_url per
     username so a repeat visit to a profile can start loading those
     images the instant the panel opens — in parallel with the slide-in
     transition — instead of waiting on the profile row fetch first.
     pfPreloadImage() just primes the browser's HTTP cache; the actual
     <img> tags still get their src set as normal once data arrives. */
  var pfMediaCache = {};
  /* username(lower) -> profiles row. Powers the instant repaint above; kept
     fresh by every successful fetch and invalidated on profile edits. */
  var pfRowCache = {};
  var pfOpenSeq = 0;   /* guards against a stale profile fetch painting over a newer one */
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

  /* Every column the profile page needs — shared by the normal fetch
     in openProfileByUsername and the self-heal below so both paths
     always return an identically-shaped row. */
  var PF_PROFILE_COLS = 'id,username,display_name,bio,role,created_at,username_changed_at,cred_received_count,merit,avatar_url,avatar_storage_path,avatar_updated_at,banner_url,banner_storage_path,banner_updated_at,social_links';

  /* ── Self-heal: guarantee the signed-in user has a profiles row ──
     Accounts created before the on-signup trigger existed have a
     username in auth user_metadata but NO row in public.profiles,
     which made every "view my profile" attempt fail with
     "Profile not found" (and, since pf.isOwner never got set,
     blocked all uploads too). This checks for the row by id and
     creates it from session metadata if it's missing.
     Returns the full profiles row, or null if it truly can't
     be read/created (e.g. missing RLS insert policy). */
  async function pfEnsureOwnProfile(){
    if(!sb || !currentUser) return null;
    try{
      /* maybeSingle(): 0 rows is expected here, not an error */
      const{data:existing,error:se}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('id',currentUser.id).maybeSingle();
      if(se) throw se;
      if(existing){ dzcSet('ownProfile', existing); return existing; }
      /* No row — build a username from the session, matching the same
         charset/length rules savePfEditProfile() enforces. */
      var base = (currentUser.user_metadata && currentUser.user_metadata.username) ||
                 (currentUser.email ? currentUser.email.split('@')[0] : '') || 'user';
      base = base.replace(/[^a-zA-Z0-9_.]/g,'').slice(0,30) || 'user';
      var uname = base;
      for(var attempt=0; attempt<3; attempt++){
        const{data:ins,error:ie}=await sb.from('profiles').insert({id:currentUser.id,username:uname}).select(PF_PROFILE_COLS).single();
        if(!ie && ins){
          /* Keep the auth-side copy in sync (non-fatal if it fails) */
          if(uname !== (currentUser.user_metadata && currentUser.user_metadata.username)){
            try{ await sb.auth.updateUser({data:{username:uname}}); }catch(e){}
          }
          return ins;
        }
        var msg = (ie && ie.message) || '';
        if(/duplicate|unique|23505/i.test(msg)){
          /* Conflict on id → a row appeared concurrently, re-read it.
             Conflict on username → someone else owns it, add a suffix. */
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
      /* offline → the saved copy still opens your profile */
      var cachedProf = dzcGet('ownProfile');
      if(cachedProf){ showToast('Offline \u2014 showing saved profile \u2726'); return cachedProf; }
    }
    return null;
  }

  async function openOwnProfile(){
    if(!currentUser){ showToast('Sign in to view your profile'); openAuthMod(); return; }
    if(!sb){ showToast('Can\u2019t connect \u2014 try again'); return; }
    /* The signed-in session already carries the username (set at
       login/signup) — use it directly so the panel opens instantly,
       same as Gallery/Comic. If the profiles row turns out to be
       missing, openProfileByUsername self-heals it via
       pfEnsureOwnProfile(). Only hit the DB here as a rare fallback
       if the username is somehow missing from the session too. */
    var uname = currentUser.user_metadata && currentUser.user_metadata.username;
    if(uname){ openProfileByUsername(uname); return; }
    var row = await pfEnsureOwnProfile();
    if(row && row.username){ openProfileByUsername(row.username); return; }
    showToast('Could not load your profile — please try again');
  }

  async function openProfileByUsername(username, pushUrl){
    if(!sb){ showToast('Can\u2019t connect \u2014 try again'); return; }
    var panel = document.getElementById('profilePage');
    panel.classList.add('open');
    document.body.style.overflow='hidden';
    /* Preload avatar/banner right as the panel starts its slide-in
       transition — using any URL we already know (a cached URL from
       a previous visit to this profile, or the signed-in user's own
       cached avatar) so the image bytes are downloading in parallel
       with the animation + profile-row fetch below, instead of only
       starting once that fetch resolves. */
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
    pf.savedRows={like:[],bookmark:[]}; pf.savedShown={like:0,bookmark:0};
    /* Albums are per-profile too — drop the previous artist's strip so a
       fast re-open can never paint their collections under a new name. */
    pf.albumsLoaded=false; pf.albums=[]; pf.albumSaved={like:[],bookmark:[]};
    var _pgs=document.getElementById('pfGallerySentinel'); if(_pgs) _pgs.style.display='none';
    var _pls=document.getElementById('pfLikeSentinel'); if(_pls) _pls.style.display='none';
    var _pbs=document.getElementById('pfBookmarkSentinel'); if(_pbs) _pbs.style.display='none';
    /* Bumped on every open; a fetch that finishes after a newer open is stale. */
    var mySeq = ++pfOpenSeq;

    /* ── Stale-while-revalidate ──────────────────────────────────
       Re-opening a profile used to blank everything to "Loading…" and wait
       on the network before painting a single pixel — so you watched an
       empty skeleton every time, even for a profile you'd just viewed.
       If we already have the row, paint it NOW and refresh underneath. */
    var cachedRow = pfRowCache[String(username).toLowerCase()];
    if(cachedRow){
      pfSwitchTab('gallery');
      pfPaintProfile(cachedRow, cachedRow.username, pushUrl);
    } else {
      /* First visit — show the skeleton (nothing better to show). */
      document.getElementById('pfLikeGrid').innerHTML='';
      document.getElementById('pfBookmarkGrid').innerHTML='';
      document.getElementById('pfLikeEmpty').style.display='none';
      document.getElementById('pfBookmarkEmpty').style.display='none';
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
      /* Drop the previous artist's milestone colour immediately — otherwise
         their tint sits on the new name for as long as the fetch takes. */
      if(window.DZ_MS){
        DZ_MS.paintName(document.getElementById('pfUsername'), 0);
        DZ_MS.paintRibbon(document.getElementById('pfMsRibbon'), 0);
      }
      document.getElementById('pfGalleryGrid').innerHTML='';
      pfSwitchTab('gallery');
    }
    try{
      /* maybeSingle(): a missing row shouldn't surface as an error —
         we want to distinguish "not found" from a real query failure. */
      let{data,error}=await sb.from('profiles').select(PF_PROFILE_COLS).eq('username',username).maybeSingle();
      if(error) throw error;
      if(!data && currentUser){
        /* Row missing — if this is the signed-in user's own username
           (their session metadata says so), their profiles row was
           never created at signup. Create it now and carry on instead
           of dead-ending on "Profile not found". Case-insensitive so
           a stale-cased metadata copy still matches. */
        var metaName = currentUser.user_metadata && currentUser.user_metadata.username;
        if(metaName && metaName.toLowerCase() === String(username).toLowerCase()){
          data = await pfEnsureOwnProfile();
        }
      }
      if(!data){ showToast('Profile not found'); closeProfilePage(); return; }
      /* A slower fetch for a PREVIOUS profile must not overwrite the one the
         user has since opened — bail if another open superseded this call. */
      if(mySeq !== pfOpenSeq) return;
      /* The row is canonical — the username arg may differ in case or
         have been suffixed by the self-heal, so use the DB value from
         here on (cache key, URL, rendering). */
      username = data.username;
      pfRowCache[String(username).toLowerCase()] = data;   /* warm for next open */
      pfPaintProfile(data, username, pushUrl);
    }catch(e){
      console.error('Error: '+e.message);
      /* Only bail out if there's nothing on screen. When we already painted a
         cached row, a failed refresh (offline, flaky network) should leave the
         cached profile visible rather than slamming the page shut. */
      if(!cachedRow && mySeq === pfOpenSeq) closeProfilePage();
    }
  }

  /* Paints a profile row into the page. Split out of openProfileByUsername so
     a CACHED row can be painted instantly on re-open (stale-while-revalidate)
     instead of showing "Loading…" and an empty skeleton on every single visit. */
  function pfPaintProfile(data, username, pushUrl){
      pf.profile = data;
      pf.isOwner = !!(currentUser && currentUser.id === data.id);
      /* Cache for next time + preload immediately in case these
         URLs weren't already covered by the head-start above. */
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
      var _pfUpWrap = document.getElementById('pfUploadWrap'); if(_pfUpWrap) _pfUpWrap.style.display = 'none'; /* upload moved to nav ➕ */
      /* (pencil + ⋮ menu removed — owner's EDIT/SETTINGS live in the action row) */
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

  function closeProfilePage(revertUrl){
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
  }

  function pfSwitchTab(tab){
    pf.tab=tab;
    ['gallery','album','like','bookmark','progress','about'].forEach(function(t){
      document.getElementById('pfTab'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
      document.getElementById('pfPanel'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('active', t===tab);
    });
    /* on-demand tabs (data fetched once per profile) */
    if(tab==='progress' && typeof xpLoadInto==='function' && pf.profile){
      xpLoadInto('pfXpWrap', pf.profile.id, { leaderboard:true });
    }
    if(tab==='like' || tab==='bookmark') pfLoadSaved(tab);
    if(tab==='album') albLoadProfileTab();
  }

  /* ── LIKE / BOOKMARK tabs — read-only grids for any profile ── */
  /* ── thumbStyle — ONE inline-style builder for every thumbnail
     renderer (home feed, gallery masonry, profile grids, saved
     grids, My Work, upload queue, previews). Zoom keeps the same
     "small numbers only" model as the focal point: no second image
     file is ever generated — transform:scale about the focal
     origin re-crops live in CSS, and object-position % still maps
     linearly across the pan range under that transform. z is
     clamped to 1–2 (200% shows 1/4 of the image area). At z=1 the
     output is byte-identical to the old object-position-only
     markup, so existing rows render exactly as before. ── */
  /* ── CONTRACT ─────────────────────────────────────────────────────
     When thumb_zoom > 1 this returns a transform:scale(). A transform
     PAINTS outside the element's layout box, so the box staying square
     is not enough on its own.

     Every <img> this style is applied to MUST sit inside a wrapper that
     is square and overflow:hidden — .awImgWrap, .upqImgWrap,
     .admCardThumb, .upDraftCard and .upPrevWrap all do this. Applying
     it to an image whose nearest clip is the whole card lets a zoomed
     thumbnail bleed down over the card's title and buttons, which is
     exactly the bug .admCardThumb was added to close.

     New thumbnail surface? Give it a wrapper first. ── */
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
      '<div class="awImgWrap awLoading"><img loading="lazy" onload="this.parentNode.classList.remove(\'awLoading\')" onerror="this.parentNode.classList.remove(\'awLoading\')" src="'+esc(getThumbnailUrl(a.image_url))+'" alt="'+esc(a.name||'')+'" style="'+thumbStyle(a.thumb_x, a.thumb_y, a.thumb_zoom)+'"></div>'+
    '</div>';
  }
  async function pfSavedOpen(id){
    /* not necessarily in the home feed or this profile's gallery —
       fall back to fetching the single (approved-only via RLS) row */
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
  /* Rows arrive in one RPC (they're capped at 100), but they RENDER
     in column-sized batches through the same sentinel pattern as
     every other grid — first batch instantly, the rest on scroll. */
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
    if(pf[flag]) return; /* already fetched for this profile */
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
