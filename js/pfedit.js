/* ── pfedit.js · edit profile page ── */
  /* =========================================================
     EDIT PROFILE PAGE
     ├─ openPfEditPage/closePfEditPage — slide-in layer above
     │   #profilePage; pre-fills username/bio from pf.profile,
     │   photos are already kept in sync by pfRenderAvatarBanner().
     └─ savePfEditProfile() — saves username + bio together.
         Username is checked for availability (case-insensitive,
         excluding the user's own row) before writing; on success
         the profile URL/header/nav are updated in place so nothing
         is left pointing at the old handle.
     ========================================================= */
  function openPfEditPage(){
    if(!pf.isOwner || !pf.profile){ showToast('You can only edit your own profile'); return; }
    document.getElementById('pfEditDisplayName').value = pf.profile.display_name || '';
    document.getElementById('pfEditUsername').value = pf.profile.username || '';
    /* @handle changes: any user, once every 90 days (enforced by the
       guard_profile_update trigger via username_changed_at, which only the
       trigger itself can write). Mirror that honestly in the UI: inside the
       cooldown the field locks with the exact unlock date. */
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
    /* Full-page overlay, same treatment as notifications/community chat —
       the floating nav pill shouldn't float over the edit form. */
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = 'none';
  }
  function closePfEditPage(){
    document.getElementById('pfEditPage').classList.remove('open');
    restoreScroll();
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = '';
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

    /* Validate every Connect field up front — first mismatch wins,
       nothing is saved (not even the valid ones) until it's fixed,
       so the profile never ends up half-updated. */
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
        /* Client-side cooldown pre-check (input should already be locked —
           this is the seatbelt; the trigger is the real enforcer). */
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
      /* Keep the SWR cache honest: refresh this row and drop the old
         username key, or a rename would leave a stale entry behind that
         repaints the previous name on the next open. */
      try{
        delete pfRowCache[String(oldUsername||'').toLowerCase()];
        pfRowCache[String(newUsername).toLowerCase()] = pf.profile;
      }catch(e){}
      pf.profile.bio = newBio;
      pf.profile.social_links = newSocialLinks;
      if(usernameChanged){
        /* Mirror the trigger's clock stamp locally so re-opening Edit
           Profile shows the lock immediately, without a refetch. */
        pf.profile.username_changed_at = new Date().toISOString();
      }
      /* Live update — the big name shows display name (fallback: username);
         the @handle always shows the username; avatar letters follow the
         visible name so the initial matches what people see. */
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
        /* Keep the auth-side copy in sync too — non-fatal if it fails,
           profiles.username stays the source of truth everywhere else. */
        try{ await sb.auth.updateUser({ data:{ username:newUsername } }); }catch(e){}
      }
      showToast('Profile updated ✦');
      closePfEditPage();
    }catch(err){
      /* Backstop: if a stale tab slipped past the pre-check, the trigger
         raises USERNAME_COOLDOWN — show it instead of console-only. */
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

  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeLB();closeFG();closeMenu();closeFilterPanel();closeAuthMod();closeCommunityPage();closeShowcasePicker();closeSettingsPage();closePfUploadMenu();closeSubscription();closeSubModal();closePfEditPage();closeProfilePage();closePfUpload();cancelPfAvBCrop();
    /* FIX: these overlays previously ignored Escape entirely */
    cancelPfCrop();closeNotifPage();closeAdmPage();closeMyWorkPage();
  }});

  /* ── BOTTOM NAVIGATION ──────────────────────────────────
     closeMenu() is kept as a harmless no-op: many existing
     open*()/close*() functions across the file call it
     defensively before opening another panel. */
  function closeMenu(){}

  /* ── Active-state highlighting for the 5 bottom nav items ── */
  var BN_IDS = ['bnHome','bnGallery','bnUpload','bnCommunity','bnProfile'];
  function bnSetActive(id){
    BN_IDS.forEach(function(bid){
      var el = document.getElementById(bid);
      if(el) el.classList.toggle('bnActive', bid === id);
    });
  }

  /* Close every full-page section before opening the next one, so
     tabs behave like Instagram/YouTube's bottom nav — exactly one
     screen visible at a time, never stacked on top of each other. */
  function bnCloseAllSections(){
    closeFG();
    closeCommunityPage();
    closeProfilePage();
    closeSubscription();
    closeAuthMod();
    closeAdmPage();
    /* FIX: Edit My Work (z:520) keeps the bottom nav visible, so a
       nav tap used to open the next section invisibly BEHIND it.
       Notifications added too for symmetry/safety. */
    closeMyWorkPage();
    closeNotifPage();
    /* Upload is a full page now too — a nav tap away from it must
       close it like any other section. (Safe in edit mode as well:
       My Work is closed just above, so no stale lock is left.) */
    closePfUpload();
  }

  function bnGoHome(){
    bnCloseAllSections();
    var hero = document.getElementById('hero');
    if(hero) hero.scrollIntoView({behavior:'smooth', block:'start'});
    else window.scrollTo({top:0, behavior:'smooth'});
    bnSetActive('bnHome');
  }
  function bnGoGallery(){
    bnCloseAllSections();
    ddOpenGallery();
    bnSetActive('bnGallery');
  }
  /* Upload (+) — now a real DESTINATION like Profile / Community:
     it closes every other section, opens the full-page upload
     screen (#pfUpMod in page mode) and takes the active-tab
     highlight. openPfUpload() is the single universal upload flow
     (login-only). */
  function bnGoUpload(){
    /* Universal upload — one flow for everyone. Guests can VIEW the
       page too; pfGuestGate() steps in only when they try to pick /
       drop files or submit, queueing pendPfUp so login brings them
       straight back here. */
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
    closeFG();
    closeCommunityPage();
    closeSubscription();
    if(currentUser){ closeAuthMod(); openOwnProfile(); } else { closeProfilePage(); openAuthMod(); }
    bnSetActive('bnProfile');
  }
  /* Default state on load */
  bnSetActive('bnHome');

  function ddOpenGallery(){
    closeMenu();
    /* Always reset to full gallery when opening from nav or VIEW GALLERY button */
    filterCat = 'all';
    var catR = document.querySelector('input[name="fltCat"][value="all"]');
    if(catR) catR.checked = true;
    openFG();
    if(typeof zeoSectionTrigger==='function') zeoSectionTrigger();
  }
  function ddOpenCommunity(){ openCommunityHome(); }
  /* Tapping "Admin Panel" in the profile ⋮ menu opens the #admPage
     panel: hero slides + broadcast notifications + reports only. */
  function smHandleAdm(){
    if(!isDev){
      /* Defensive fallback — button shouldn't be in the DOM at all unless isDev,
         but guard anyway in case of a stale click or race condition. */
      closeMenu();
      if(!currentUser){ showToast('Sign in with a dev account to access admin'); openAuthMod(); }
      else { showToast('This account does not have dev access'); }
      return;
    }
    closeMenu();
    openAdmPage();
  }

  /* ── ADMIN PANEL PAGE ──
     Dev-only. Holds exactly three things: the hero slides editor,
     the broadcast-notification composer, and the open-reports
     queue. No other admin capability exists anywhere in the app
     or the database. */
  var admTab = 'noti';

  function openAdmPage(){
    var el = document.getElementById('admPage');
    if(!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    admLoadNotifSent();
    admLoadReports();   /* populates the REPORT tab badge on open */
  }

  function closeAdmPage(){
    var el = document.getElementById('admPage');
    if(!el) return;
    el.classList.remove('open');
    restoreScroll();
  }



  function admSwitchTab(tab){
    admTab = tab;
    ['Noti','Rpt'].forEach(function(t){
      var key = t.toLowerCase();
      document.getElementById('admTab'+t).classList.toggle('active', key===tab);
      document.getElementById('admPanel'+t).classList.toggle('active', key===tab);
    });
    if(tab==='noti') admLoadNotifSent();
    if(tab==='rpt')  admLoadReports();
  }

  /* ── Reports queue (dev-only; RLS blocks everyone else) ── */
  var RPT_LABELS = {
    copyright:'Copyright infringement', ai_undisclosed:'AI-generated without disclosure',
    nudity:'Nudity / Sexual content', violence:'Violence / Gore',
    hate:'Hate speech / Harassment', spam:'Spam / Advertising',
    misinformation:'Misinformation', impersonation:'Impersonation',
    illegal:'Illegal content', offtopic:'Off-topic / Wrong category',
    lowquality:'Low-quality / Broken upload', other:'Other'
  };

  async function admLoadReports(){
    var list = document.getElementById('admRptList');
    var empty = document.getElementById('admRptEmpty');
    if(!list || !sb) return;
    list.innerHTML = '';
    try{
      var r = await sb.from('artwork_reports')
        .select('id,artwork_id,reason,details,created_at,reporter_id,artworks(name,image_url,user_id)')
        .eq('status','open').order('created_at',{ascending:false}).limit(100);
      if(r.error) throw r.error;
      var rows = r.data || [];
      admSetRptCount(rows.length);
      if(!rows.length){ empty.style.display='block'; return; }
      empty.style.display='none';
      rows.forEach(function(rep){
        var card = document.createElement('div');
        card.className = 'pfStatCard';
        card.style.textAlign = 'left';
        var art = rep.artworks || {};
        /* textContent throughout — details/name are user input */
        var h = document.createElement('div');
        h.style.cssText = 'font-family:var(--fm);font-size:.7rem;letter-spacing:.08em;color:var(--danger);margin-bottom:.4rem;';
        h.textContent = '🚩 ' + (RPT_LABELS[rep.reason] || rep.reason);
        card.appendChild(h);
        var n = document.createElement('div');
        n.style.cssText = 'font-family:var(--fd);font-weight:700;color:var(--tx);margin-bottom:.3rem;';
        n.textContent = art.name || '(untitled artwork)';
        card.appendChild(n);
        if(rep.details){
          var d = document.createElement('div');
          d.style.cssText = 'font-family:var(--fb);font-size:.82rem;color:var(--txd);margin-bottom:.5rem;white-space:pre-wrap;';
          d.textContent = rep.details;
          card.appendChild(d);
        }
        var when = document.createElement('div');
        when.style.cssText = 'font-family:var(--fm);font-size:.65rem;color:var(--txd);margin-bottom:.6rem;';
        when.textContent = new Date(rep.created_at).toLocaleString();
        card.appendChild(when);
        var acts = document.createElement('div');
        acts.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;';
        var view = document.createElement('button');
        view.className = 'rptBtn'; view.textContent = 'VIEW';
        view.onclick = function(){
          /* openArtworkById fetches the full row and opens the viewer —
             safer than reconstructing a partial artwork object here. */
          openArtworkById(String(rep.artwork_id), false);
        };
        var res = document.createElement('button');
        res.className = 'rptBtn'; res.textContent = 'RESOLVE';
        res.onclick = function(){ admResolveReport(rep.id, 'resolved'); };
        var dis = document.createElement('button');
        dis.className = 'rptBtn'; dis.textContent = 'DISMISS';
        dis.onclick = function(){ admResolveReport(rep.id, 'dismissed'); };
        acts.appendChild(view); acts.appendChild(res); acts.appendChild(dis);
        card.appendChild(acts);
        list.appendChild(card);
      });
    }catch(e){
      console.error('admLoadReports:', e);
      empty.style.display='block';
      empty.textContent = 'Couldn\u2019t load reports.';
    }
  }

  function admSetRptCount(n){
    var b = document.getElementById('admCountRpt');
    if(!b) return;
    b.textContent = n;
    b.style.display = n ? '' : 'none';
  }

  async function admResolveReport(id, status){
    try{
      var r = await sb.from('artwork_reports').update({ status: status }).eq('id', id);
      if(r.error) throw r.error;
      showToast(status === 'resolved' ? 'Report resolved ✦' : 'Report dismissed');
      admLoadReports();
    }catch(e){ showToast('Action failed — try again'); }
  }

