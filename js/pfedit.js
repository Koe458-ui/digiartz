// edit profile page
  function openPfEditPage(){
    if(!pf.isOwner || !pf.profile){ showToast('You can only edit your own profile'); return; }
    document.getElementById('pfEditDisplayName').value = pf.profile.display_name || '';
    document.getElementById('pfEditUsername').value = pf.profile.username || '';
    // handle change cooldown
    (function(){
      var uIn = document.getElementById('pfEditUsername');
      var uHint = document.getElementById('pfEditUsernameHint');
      var next = pfUsernameNextChange();
      if(next){
        uIn.disabled = true;
        if(uHint){ uHint.style.display=''; uHint.textContent = 'You can change your @handle again on ' + pfFormatDate(next.toISOString()) + '.'; }
      } else {
        uIn.disabled = false;
        if(uHint){ uHint.style.display=''; uHint.textContent = 'Your @handle can be changed once every 90 days.'; }
      }
    })();
    document.getElementById('pfEditBio').value = pf.profile.bio || '';
    pfUpdateEditBioCount();
    pfRenderAvatarBanner();
    var links = pf.profile.social_links || {};
    PF_SOCIAL_PLATFORMS.forEach(function(p){
      var input = document.getElementById('pfConnect_'+p.key);
      if(input){ input.value = links[p.key] || ''; input.classList.remove('err'); }
    });
    document.getElementById('pfEditPage').classList.add('open');
    document.body.style.overflow='hidden';
  }
  function closePfEditPage(){
    document.getElementById('pfEditPage').classList.remove('open');
    restoreScroll();
  }
  function pfUpdateEditBioCount(){
    var len = document.getElementById('pfEditBio').value.length;
    document.getElementById('pfEditBioCount').textContent = len+'/500';
  }
  document.addEventListener('DOMContentLoaded', function(){
    var ta = document.getElementById('pfEditBio');
    if(ta) ta.addEventListener('input', pfUpdateEditBioCount);
    PF_SOCIAL_PLATFORMS.forEach(function(p){
      var input = document.getElementById('pfConnect_'+p.key);
      if(input) input.addEventListener('input', function(){ input.classList.remove('err'); });
    });
  });

  async function savePfEditProfile(){
    if(!pf.isOwner || !pf.profile) return;
    var newUsername = document.getElementById('pfEditUsername').value.trim();
    var newDisplayName = document.getElementById('pfEditDisplayName').value.trim().slice(0,30);
    var newBio = document.getElementById('pfEditBio').value.trim().slice(0,500);
    if(!newUsername){ showToast('Username can\'t be empty'); return; }
    if(newUsername.length>30){ showToast('Username must be 30 characters or fewer'); return; }
    if(!/^[a-zA-Z0-9_.]+$/.test(newUsername)){ showToast('Username can only contain letters, numbers, "_" and "."'); return; }

    // validate connect fields first
    var newSocialLinks = {};
    for(var i=0;i<PF_SOCIAL_PLATFORMS.length;i++){
      var p = PF_SOCIAL_PLATFORMS[i];
      var input = document.getElementById('pfConnect_'+p.key);
      var res = pfValidateSocialLink(p, input.value);
      if(!res.ok){
        input.classList.add('err');
        input.scrollIntoView({behavior:'smooth', block:'center'});
        input.focus();
        showToast(res.msg);
        return;
      }
      input.classList.remove('err');
      newSocialLinks[p.key] = res.value;
    }

    var btn = document.getElementById('pfEditSaveBtn');
    btn.disabled = true; btn.textContent = 'SAVING…';
    try{
      var usernameChanged = newUsername.toLowerCase() !== (pf.profile.username||'').toLowerCase();
      var oldUsername = pf.profile.username || '';
      if(usernameChanged){
        // cooldown pre check
        var nextChg = pfUsernameNextChange();
        if(nextChg){ showToast('You can change your @handle again on ' + pfFormatDate(nextChg.toISOString())); return; }
        const{data:existing,error:ce}=await sb.from('profiles').select('id').ilike('username',newUsername).neq('id',pf.profile.id).maybeSingle();
        if(ce) throw ce;
        if(existing){ showToast('That username is already taken'); return; }
      }
      var updates = { username:newUsername, display_name:newDisplayName||null, bio:newBio||null, social_links:newSocialLinks };
      const{error:de}=await sb.from('profiles').update(updates).eq('id',pf.profile.id);
      if(de) throw de;
      pf.profile.username = newUsername;
      pf.profile.display_name = newDisplayName || null;
      // refresh swr cache
      try{
        delete pfRowCache[String(oldUsername||'').toLowerCase()];
        pfRowCache[String(newUsername).toLowerCase()] = pf.profile;
      }catch(e){}
      /* And the saved copies, both of them. A rename leaves a record under the
         old name that no lookup will ever ask for again, and a record under the
         new name that may hold the row from before the edit — dropped by name
         so the next open re-reads it, rather than by clearing profiles wholesale. */
      try{
        if(window.dzCache){
          window.dzCache.invalidateProfile(pf.profile.id, oldUsername);
          window.dzCache.invalidateProfile(pf.profile.id, newUsername);
        }
      }catch(e){}
      pf.profile.bio = newBio;
      pf.profile.social_links = newSocialLinks;
      if(usernameChanged){
        // stamp change time locally
        pf.profile.username_changed_at = new Date().toISOString();
      }
      // live name update
      var visibleName = newDisplayName || newUsername;
      document.getElementById('pfUsername').textContent = visibleName;
      var _hnSv=document.getElementById('pfHandle'); if(_hnSv) _hnSv.textContent = '@' + newUsername;
      document.getElementById('pfAvatarLetter').textContent = visibleName.charAt(0).toUpperCase();
      document.getElementById('pfEditAvatarLetter').textContent = visibleName.charAt(0).toUpperCase();
      pfRenderBio();
      pfRenderHeadBio();
      pfRenderConnect();
      if(usernameChanged){
        try{ history.replaceState({profileUser:newUsername},'','/profile/'+encodeURIComponent(newUsername)); }catch(e){}
        // sync auth copy
        try{ await sb.auth.updateUser({ data:{ username:newUsername } }); }catch(e){}
      }
      showToast('Profile updated');
      closePfEditPage();
    }catch(err){
      // trigger cooldown error
      if(err && /USERNAME_COOLDOWN/.test(err.message||'')){
        var m = /until\s+([0-9T:.\- +]+)/.exec(err.message);
        var when = m ? new Date(m[1].trim()) : null;
        showToast('You can change your @handle again' + (when && isFinite(+when) ? ' on ' + pfFormatDate(when.toISOString()) : ' in a while'));
      } else {
        console.error('Error: '+err.message);
        showToast('Couldn\u2019t save \u2014 try again');
      }
    }
    finally{ btn.disabled=false; btn.textContent='SAVE CHANGES'; }
  }

  document.addEventListener('keydown',e=>{if(e.key==='Escape'){
    // profile search sits on top of the profile: Escape leaves the search,
    // not the profile under it
    var _pfs=document.getElementById('pfSearchPage');
    if(_pfs && _pfs.classList.contains('open')){ closePfSearch(); return; }
    // the guidelines sheet sits over the upload page: Escape leaves the sheet,
    // not the page under it
    var _upg=document.getElementById('upGuideMod');
    if(_upg && _upg.classList.contains('open')){ upGuideClose(); return; }
    // Same rule for the two pages that slide in over the community section.
    // Without this the line below closes the section out from under them, so
    // one Escape on a community's page dropped the whole section — and the
    // friends page has been doing it for as long as it has existed. Each page
    // owns its own Escape (js/mywork.js, js/dm.js); this only has to stop
    // reaching past them.
    var _cmi=document.getElementById('cmInfoPage');
    if(_cmi && _cmi.classList.contains('open')) return;
    var _frd=document.getElementById('frdPage');
    if(_frd && _frd.classList.contains('open')) return;
    closeLB();closeFG();closeFilterPanel();closeAuthMod();closeCommunityPage();closeShowcasePicker();closeSettingsPage();closeSubscription();closePfEditPage();closeProfilePage();closePfUpload();cancelPfAvBCrop();
    // escape closes overlays
    cancelPfCrop();closeNotifPage();closeMyWorkPage();
    // The admin panel closes through the handle its module publishes;
    // an account that never loaded it has nothing to close.
    if(typeof dzOpsClose === 'function') dzOpsClose();
    // Wallet, payout methods and purchases were three page shells with three
    // close functions until they became one panel built by the signed-in
    // module. This line still called all three by their old names, so it
    // threw on the first and the two after it never ran either. The panel
    // owns its own close; it is absent for a signed-out visitor, hence the
    // guard.
    if(typeof window.dzClosePanel === 'function') window.dzClosePanel();
  }});

  // navigation
  /* Which section is on screen, said in one place.

     It used to be said by lighting one of five elements, found by id, in the
     bottom nav. There are two copies of every destination now — the row on the
     wide bar and the same words inside the hamburger — so the name of the
     section moved onto a data-bn attribute that both copies carry, and both
     light together.

     And it is written onto the document as well. js/navprogress.js keeps each
     section's scroll position and has to know when the section changes; it
     used to watch five elements' class attributes to find that out. One
     attribute on the root is the same fact stated once, and it is stated even
     for a section with no control of its own in the bar. */
  function bnSetActive(id){
    var nodes = document.querySelectorAll('[data-bn]');
    for(var i=0;i<nodes.length;i++){
      nodes[i].classList.toggle('bnActive', nodes[i].getAttribute('data-bn') === id);
    }
    try{ document.documentElement.setAttribute('data-section', id || ''); }catch(e){}
  }
  window.bnSetActive = bnSetActive;

  /* One section at a time, and every panel in the app counts as one.

     This used to be nine hand-written close() calls, and what was missing
     from them is what stayed on screen: the ranking board, the theme page,
     Artist Progress, the album pages, the artwork viewer, the item viewer,
     Settings and every page Settings opens. Tapping Home with any of those up
     closed the section UNDERNEATH and left the panel itself standing over the
     home page, with Home lit in the nav.

     The list lives on the panel table in js/app-core.js now, so a panel is
     swept because it exists rather than because somebody remembered to add a
     line here. */
  function bnCloseAllSections(){
    // Settings puts a page in front of itself and watches for that page to
    // close so it can come back. A sweep closes both, and the watcher would
    // fire afterwards, find a profile open — the one we are on our way to —
    // and slide Settings in over a section nobody opened it from.
    if(typeof window.dzSetDropBack === 'function') window.dzSetDropBack();
    window.dzCloseAllPanels();
  }

  /* Going somewhere is a sweep and an open, and the two have to be one move.

     Held open across both: the watchers that react to a panel closing run
     after this returns and must not read a half-finished switch as "the
     member closed the community page" (js/routes.js used to step history back
     there, which is how tapping Upload could land you on a profile). And the
     token is what an opener that has to wait for the database checks before
     it paints — by then the member may have tapped twice more, and the
     section they are looking at is not this one.

     `path` is the address of where this lands. Every move sets it, including
     the moves whose destination has no url of its own: leaving the address
     naming the section you just left is what made a refresh re-open it. */
  function bnGo(id, path, open){
    var token = window.dzNavBegin();
    try{
      bnCloseAllSections();
      // Lit before the open and not after it, so a slow opener cannot leave
      // the nav marking the section being left.
      bnSetActive(id);
      open(token);
    } finally {
      window.dzNavEnd();
      /* The move gets the last word on the address, after the sweep and after
         the open. A destination with a url of its own says so; one without —
         Home, Upload — asks js/routes.js to make the bar true instead of
         forcing it to '/', because "no address of my own" is not the same as
         "the home address": a guest tapping Profile lands on the sign-in
         sheet, and /login is the right thing for the bar to say. */
      if(path && typeof window.dzRouteAddress === 'function') window.dzRouteAddress(path);
      else if(!path && typeof window.dzRouteAudit === 'function') window.dzRouteAudit();
    }
  }

  function bnGoHome(){
    bnGo('bnHome', null, function(){
      // the nav keeps each section's place: coming back to home lands where
      // you left it, and tapping home from home is what rides to the top.
      // without that script this is still the only way up, so it stays
      if(!window.bnScrollMemory){
        var hero = document.getElementById('hero');
        if(hero) hero.scrollIntoView({behavior:'smooth', block:'start'});
        else window.scrollTo({top:0, behavior:'smooth'});
      }
    });
  }
  function bnGoGallery(){
    bnGo('bnGallery', '/explore', ddOpenGallery);
  }
  /* Upload is five destinations wearing one word.
     Posting an artwork, listing a product, writing a post, sharing a resource
     and posting a job are five forms with five sets of rules, and the top bar
     now names each of them (js/topnav.js). Which one was asked for travels
     through here to openPfUpload, whose default is still the artwork form —
     the quick-links tile, the hero's Sell tab and a resumed draft all call it
     with nothing to say, and all three mean what they always meant.

     Guests can view, gate on submit. No public url — one member's draft is
     not a page — so the address goes back to where the visit came from. */
  function bnGoUpload(sec){
    bnGo('bnUpload', null, function(){ openPfUpload(sec); });
  }
  function bnGoCommunity(){
    bnGo('bnCommunity', '/community', ddOpenCommunity);
  }
  function bnGoProfile(e){
    if(e) e.stopPropagation();
    /* No path: whose profile this is may take a round trip to answer, so
       js/profile.js writes /profile/<name> itself the moment the panel opens.
       Signed out this is the sign-in sheet, which owns /login the same way. */
    bnGo('bnProfile', null, function(token){
      if(currentUser) openOwnProfile(token);
      else openAuthMod();
    });
  }
  // default state
  bnSetActive('bnHome');

  function ddOpenGallery(){
    // reset to full gallery
    filterCat = 'all';
    var catR = document.querySelector('input[name="fltCat"][value="all"]');
    if(catR) catR.checked = true;
    openFG();
  }
  function ddOpenCommunity(){ openCommunityHome(); }
  // The admin panel used to be opened from here. It is served by /api/ops now
  // and builds its own Settings entry, holding its opener in a closure — so
  // there is no longer a function in this bundle that opens it, and no name
  // for a console to call. See the note in js/gallery.js.
