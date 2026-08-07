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
    closeLB();closeFG();closeMenu();closeFilterPanel();closeAuthMod();closeCommunityPage();closeShowcasePicker();closeSettingsPage();closeSubscription();closeSubModal();closePfEditPage();closeProfilePage();closePfUpload();cancelPfAvBCrop();
    // escape closes overlays
    cancelPfCrop();closeNotifPage();closeAdmPage();closeMyWorkPage();
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
    closeAdmPage();
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
  // open admin panel
  // The menu entry only exists on an entitled account, so this is the second
  // check rather than the first — and it answers anyone else with nothing at
  // all. It used to say "sign in with a dev account to access admin", which
  // told every visitor who tripped it that there was something to sign in to.
  function smHandleAdm(){
    if(!isDev) return;
    closeMenu();
    openAdmPage();
  }

  // admin panel page
  var admTab = 'noti';

  // index.html carries an empty #admPage and this writes the inside of it,
  // once, on first open. Nothing here reaches a page that never opens it.
  function admBuild(el){
    if(el.firstElementChild) return;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Admin panel');
    el.innerHTML =
      '<div class="subPgHdr">' +
        '<button class="subPgX" onclick="closeAdmPage()" aria-label="Close admin panel">←</button>' +
        '<div class="subPgTitle">ADMIN PANEL</div>' +
      '</div>' +
      '<div class="admBdy">' +
        '<div class="pfTabs" role="tablist">' +
          '<div class="pfTabGroup">' +
            '<button class="pfTab active" id="admTabNoti" role="tab" aria-selected="true" onclick="admSwitchTab(\'noti\')">NOTIFICATIONS</button>' +
            '<button class="pfTab" id="admTabRpt" role="tab" aria-selected="false" onclick="admSwitchTab(\'rpt\')">REPORT<span class="admTabCount" id="admCountRpt" style="display:none;">0</span></button>' +
          '</div>' +
        '</div>' +
        '<div class="pfPanel" id="admPanelRpt">' +
          '<div class="pfGrid" id="admRptList"></div>' +
          '<div class="pfEmpty" id="admRptEmpty" style="display:none;"><span class="admEmptyIcon">✓</span>No open reports.</div>' +
        '</div>' +
        '<div class="pfPanel active" id="admPanelNoti">' +
          '<div class="admNotiLbl">SEND NOTIFICATION TO ALL USERS</div>' +
          '<div class="admNotiCompose">' +
            '<input type="text" id="admNotiTitle" class="admNotiInput" placeholder="Title" maxlength="80">' +
            '<textarea id="admNotiMsg" class="admNotiTextarea" placeholder="Message" maxlength="500" rows="3"></textarea>' +
            '<button class="admNotiSendBtn" id="admNotiSendBtn" onclick="admSendBroadcast()">Send to All Users</button>' +
          '</div>' +
          '<div class="admNotiSentLbl">RECENTLY SENT</div>' +
          '<div class="pfEmpty" id="admNotiEmpty" style="display:none;"><span class="admEmptyIcon">🔔</span>No notifications sent yet.</div>' +
          '<div id="admNotiSentList" class="admNotiSentList"></div>' +
        '</div>' +
      '</div>';
    admTab = 'noti';
  }

  function openAdmPage(){
    var el = document.getElementById('admPage');
    if(!el || !isDev) return;
    admBuild(el);
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    admLoadNotifSent();
    admLoadReports();   // report tab badge
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

  // reports queue
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
        card.className = 'pfCard';
        var art = rep.artworks || {};
        // user input, use textcontent
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
          // fetch full row
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
      showToast(status === 'resolved' ? 'Report resolved' : 'Report dismissed');
      admLoadReports();
    }catch(e){ showToast('Action failed — try again'); }
  }

