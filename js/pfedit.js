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
    closeLB();closeFG();closeMenu();closeFilterPanel();closeAuthMod();closeCommunityPage();closeShowcasePicker();closeSettingsPage();closeSubscription();closePfEditPage();closeProfilePage();closePfUpload();cancelPfAvBCrop();
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

  // bottom navigation
  function closeMenu(){}

  // active tab highlight
  var BN_IDS = ['bnHome','bnGallery','bnUpload','bnCommunity','bnProfile'];
  function bnSetActive(id){
    BN_IDS.forEach(function(bid){
      var el = document.getElementById(bid);
      if(el) el.classList.toggle('bnActive', bid === id);
    });
  }

  // one section at a time
  function bnCloseAllSections(){
    closeFG();
    closeCommunityPage();
    closeProfilePage();
    closeSubscription();
    closeAuthMod();
    if(typeof dzOpsClose === 'function') dzOpsClose();
    // close my work too
    closeMyWorkPage();
    closeNotifPage();
    // close upload too
    closePfUpload();
  }

  function bnGoHome(){
    bnCloseAllSections();
    // the nav keeps each section's place: coming back to home lands where
    // you left it, and tapping home from home is what rides to the top.
    // without that script this is still the only way up, so it stays
    if(!window.bnScrollMemory){
      var hero = document.getElementById('hero');
      if(hero) hero.scrollIntoView({behavior:'smooth', block:'start'});
      else window.scrollTo({top:0, behavior:'smooth'});
    }
    bnSetActive('bnHome');
  }
  function bnGoGallery(){
    bnCloseAllSections();
    ddOpenGallery();
    bnSetActive('bnGallery');
  }
  // upload is a destination
  function bnGoUpload(){
    // guests can view, gate on submit
    bnCloseAllSections();
    openPfUpload();
    bnSetActive('bnUpload');
  }
  function bnGoCommunity(){
    bnCloseAllSections();
    ddOpenCommunity();
    bnSetActive('bnCommunity');
  }
  function bnGoProfile(e){
    if(e) e.stopPropagation();
    // route through close all
    bnCloseAllSections();
    if(currentUser){ openOwnProfile(); } else { openAuthMod(); }
    bnSetActive('bnProfile');
  }
  // default state
  bnSetActive('bnHome');

  function ddOpenGallery(){
    closeMenu();
    // reset to full gallery
    filterCat = 'all';
    var catR = document.querySelector('input[name="fltCat"][value="all"]');
    if(catR) catR.checked = true;
    openFG();
    if(typeof zeoSectionTrigger==='function') zeoSectionTrigger();
  }
  function ddOpenCommunity(){ openCommunityHome(); }
  // The admin panel used to be opened from here. It is served by /api/ops now
  // and builds its own Settings entry, holding its opener in a closure — so
  // there is no longer a function in this bundle that opens it, and no name
  // for a console to call. See the note in js/gallery.js.
