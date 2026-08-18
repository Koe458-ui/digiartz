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
    if(!admMayOpen()) return;
    closeMenu();
    openAdmPage();
  }

  // ---- the admin panel ----------------------------------------------------
  //
  // One panel, two audiences, and the difference between them is the whole
  // reason this file grew.
  //
  //   STAFF (admin, dev) see everything: the live counters, the partner list
  //   and its invite button, the broadcast composer, both report queues and
  //   the ban engine.
  //
  //   A PARTNER sees two tabs — reports and moderation — because that is the
  //   whole of what the role is trusted with. Not a greyed-out version of the
  //   rest: the tabs are not built, so there is no telemetry in their document
  //   and no partner list to read out of it.
  //
  // NONE OF THIS IS A SECURITY BOUNDARY and it is worth saying so where the
  // markup is written. Everything below decides what to DRAW. Every action it
  // draws is refused again in Postgres — dz_is_staff() guards the telemetry,
  // the partner list and the revenue report; dz_may_moderate() decides every
  // ban one target at a time and will not let a partner touch an admin, a dev
  // or another partner whatever this file believes. A member who edits
  // userRole in a console gets a panel of buttons that all answer 403.

  var admTab = null;

  function admMayOpen(){
    return (typeof dzIsStaff === 'function' && dzIsStaff()) ||
           (typeof dzIsPartner === 'function' && dzIsPartner());
  }
  function admIsStaff(){
    return typeof dzIsStaff === 'function' && dzIsStaff();
  }

  // The collab endpoint. Everything privileged goes through it rather than
  // through the Supabase client, so the guard is a SECURITY DEFINER function
  // in Postgres and not an RLS policy that has to be right for every table the
  // panel touches.
  function admApi(action, body){
    if(!sb) return Promise.reject(new Error('Not signed in'));
    return sb.auth.getSession().then(function(s){
      var session = s && s.data && s.data.session;
      if(!session) throw new Error('Not signed in');
      return fetch('/api/collab', {
        method:'POST',
        headers:{'content-type':'application/json',
                 authorization:'Bearer ' + session.access_token},
        cache:'no-store',
        body:JSON.stringify(Object.assign({action:action}, body || {}))
      });
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(j){
        if(!res.ok) throw new Error((j && j.error) || 'That did not work');
        return j;
      });
    });
  }

  function admEsc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Which tabs this account gets, in the order they are useful. Reports leads
  // for a partner because it is the only queue they act on; telemetry leads
  // for staff because it is the thing anyone opening an admin panel looks at
  // first.
  function admTabs(){
    if(admIsStaff()){
      return [['tel','TELEMETRY'], ['rpt','REPORTS'], ['mod','MODERATION'],
              ['prt','PARTNERS'], ['log','AUDIT'], ['noti','NOTIFY']];
    }
    return [['rpt','REPORTS'], ['mod','MODERATION']];
  }

  // index.html carries an empty #admPage and this writes the inside of it.
  // Rebuilt when the role changes rather than only once: an account that
  // opened this as a partner and was promoted must not keep the partner's two
  // tabs, and one that was demoted must not keep the rest.
  function admBuild(el){
    var want = admIsStaff() ? 'staff' : 'partner';
    if(el.firstElementChild && el.dataset.admFor === want) return;
    el.dataset.admFor = want;

    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', admIsStaff() ? 'Admin panel' : 'Moderation');

    var tabs = admTabs();
    admTab = tabs[0][0];

    el.innerHTML =
      '<div class="subPgHdr">' +
        '<button class="subPgX" onclick="closeAdmPage()" aria-label="Close">←</button>' +
        '<div class="subPgTitle">' +
          (admIsStaff() ? 'ADMIN PANEL' : 'MODERATION') + '</div>' +
      '</div>' +
      '<div class="admBdy">' +
        '<div class="pfTabs" role="tablist">' +
          '<div class="pfTabGroup">' +
            tabs.map(function(t, i){
              return '<button class="pfTab' + (i===0 ? ' active' : '') +
                '" id="admTab-' + t[0] + '" role="tab" aria-selected="' +
                (i===0 ? 'true' : 'false') + '" onclick="admSwitchTab(\'' + t[0] + '\')">' +
                t[1] +
                (t[0]==='rpt' ? '<span class="admTabCount" id="admCountRpt" style="display:none;">0</span>' : '') +
              '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        tabs.map(function(t, i){
          return '<div class="pfPanel' + (i===0 ? ' active' : '') +
                 '" id="admPanel-' + t[0] + '">' + admPanelHtml(t[0]) + '</div>';
        }).join('') +
      '</div>';

    if(el.querySelector('#admModForm')) admWireMod(el);
    if(el.querySelector('#admAddPartner')) admWirePartners(el);
  }

  function admPanelHtml(tab){
    if(tab === 'tel') return '<div id="admTel" class="admTel"></div>';

    if(tab === 'rpt') return '' +
      '<div class="admRptSwitch" role="group" aria-label="Which reports">' +
        '<button type="button" class="admRptTog active" data-q="user" ' +
          'onclick="admRptKind(\'user\')">Accounts</button>' +
        '<button type="button" class="admRptTog" data-q="item" ' +
          'onclick="admRptKind(\'item\')">Uploads</button>' +
      '</div>' +
      '<div class="pfGrid" id="admRptList"></div>' +
      '<div class="pfEmpty" id="admRptEmpty" style="display:none;">' +
        '<span class="admEmptyIcon">✓</span>No open reports.</div>';

    if(tab === 'mod') return '' +
      '<div class="admModLbl">FIND A MEMBER</div>' +
      '<p class="admModNote">Search by username, email address or user ID. ' +
        'It has to be exact — this does not list members, it finds one.</p>' +
      '<form class="admModForm" id="admModForm">' +
        '<input type="text" id="admModQ" class="admModIn" autocomplete="off" ' +
          'spellcheck="false" placeholder="@handle, email, or ID" ' +
          'aria-label="Username, email address or user ID">' +
        '<button type="submit" class="admModGo">Find</button>' +
      '</form>' +
      '<div id="admModResult" class="admModResult"></div>';

    if(tab === 'log') return '' +
      '<div class="admModLbl">WHO DID WHAT</div>' +
      '<p class="admModNote">Every privileged action on this platform, newest ' +
        'first. Append-only — nothing here can be edited or deleted, by anyone.</p>' +
      '<div id="admLogList" class="admLogList"></div>' +
      '<div class="pfEmpty" id="admLogEmpty" style="display:none;">' +
        '<span class="admEmptyIcon">📋</span>Nothing logged yet.</div>';

    if(tab === 'prt') return '' +
      '<div class="admPrtTop">' +
        '<div class="admPrtLbl">PARTNERS</div>' +
        '<button type="button" class="admPrtAdd" id="admAddPartner" ' +
          'aria-label="Add a partner">+</button>' +
      '</div>' +
      '<div id="admPrtList" class="admPrtList"></div>' +
      '<div class="pfEmpty" id="admPrtEmpty" style="display:none;">' +
        '<span class="admEmptyIcon">🤝</span>No partners yet. Use + to invite one.</div>';

    // notify
    return '' +
      '<div class="admNotiLbl">SEND NOTIFICATION TO ALL USERS</div>' +
      '<div class="admNotiCompose">' +
        '<input type="text" id="admNotiTitle" class="admNotiInput" placeholder="Title" maxlength="80">' +
        '<textarea id="admNotiMsg" class="admNotiTextarea" placeholder="Message" maxlength="500" rows="3"></textarea>' +
        '<button class="admNotiSendBtn" id="admNotiSendBtn" onclick="admSendBroadcast()">Send to All Users</button>' +
      '</div>' +
      '<div class="admNotiSentLbl">RECENTLY SENT</div>' +
      '<div class="pfEmpty" id="admNotiEmpty" style="display:none;">' +
        '<span class="admEmptyIcon">🔔</span>No notifications sent yet.</div>' +
      '<div id="admNotiSentList" class="admNotiSentList"></div>';
  }

  function openAdmPage(){
    var el = document.getElementById('admPage');
    if(!el || !admMayOpen()) return;
    admBuild(el);
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    admLoadTab(admTab);
    admLoadReports();            // the tab badge, whichever tab is up
  }

  function closeAdmPage(){
    var el = document.getElementById('admPage');
    if(!el) return;
    el.classList.remove('open');
    restoreScroll();
  }

  function admSwitchTab(tab){
    admTab = tab;
    admTabs().forEach(function(t){
      var b = document.getElementById('admTab-' + t[0]);
      var p = document.getElementById('admPanel-' + t[0]);
      if(b){ b.classList.toggle('active', t[0]===tab); b.setAttribute('aria-selected', t[0]===tab ? 'true':'false'); }
      if(p) p.classList.toggle('active', t[0]===tab);
    });
    admLoadTab(tab);
  }

  function admLoadTab(tab){
    if(tab==='tel')  return admLoadTelemetry();
    if(tab==='rpt')  return admLoadReports();
    if(tab==='prt')  return admLoadPartners();
    if(tab==='log')  return admLoadAudit();
    if(tab==='noti') return admLoadNotifSent();
    // 'mod' has nothing to load until something is searched for
  }

  // ---- telemetry ----------------------------------------------------------
  //
  // One call. Nine separate fetches would show a submission count from one
  // second beside an active-user count from another, and somebody eventually
  // reconciles the two and finds a bug that is not there.
  function admLoadTelemetry(){
    var host = document.getElementById('admTel');
    if(!host) return;
    if(!host.dataset.once){ host.dataset.once = '1'; host.innerHTML = ''; }

    admApi('telemetry', {}).then(function(r){
      var t = r && r.telemetry;
      if(!t){ host.innerHTML = '<div class="pfEmpty">Could not read telemetry.</div>'; return; }
      var c = t.content || {}, day = c.today || {}, s = t.subscriptions || {},
          e = t.engagement || {}, d = t.devices || {}, m = t.moderation || {};

      host.innerHTML =
        admGroup('Live submissions', [
          admStat('Artworks',    c.artworks,    day.artworks),
          admStat('Resources',   c.resources,   day.resources),
          admStat('Marketplace', c.marketplace, day.marketplace),
          admStat('Blogs',       c.blogs,       day.blogs),
          admStat('Jobs',        c.jobs,        day.jobs),
          admStat('Communities', c.communities, null)
        ]) +
        admGroup('Subscriptions, live', [
          admStat('Lite',     s.lite),
          admStat('Premium',  s.premium),
          admStat('Max',      s.max),
          admStat('Free',     s.free),
          admStat('Partners', s.partners),
          admStat('Members',  s.total)
        ]) +
        admGroup('Engagement', [
          admStat('DAU', e.dau),
          admStat('MAU', e.mau),
          admStat('Signed-in DAU', e.dau_signed_in),
          admStat('Events, 24h', e.events_24h),
          admStat('New members, 24h', e.new_members_24h)
        ]) +
        admGroup('Devices, 24h', Object.keys(d).sort().map(function(k){
          return admStat(k.charAt(0).toUpperCase() + k.slice(1), d[k]);
        })) +
        admGroup('Moderation', [
          admStat('Open account reports', m.open_user_reports),
          admStat('Open upload reports',  m.open_item_reports),
          admStat('Active bans',          m.active_bans)
        ]) +
        '<p class="admTelAt">Read at ' +
          admEsc(t.at ? new Date(t.at).toLocaleTimeString() : '') +
          '. Subscription counts are live — a lapsed plan is not counted as ' +
          'active. Device and engagement figures cover recorded activity only.</p>';
    }, function(err){
      host.innerHTML = '<div class="pfEmpty">' + admEsc(err.message) + '</div>';
    });
  }

  function admGroup(title, cells){
    var body = cells.filter(Boolean).join('');
    if(!body) return '';
    return '<section class="admTelGrp">' +
      '<h3 class="admTelHd">' + admEsc(title) + '</h3>' +
      '<ul class="admTelGrid">' + body + '</ul>' +
    '</section>';
  }

  // A "today" figure is drawn only where there is one, and a zero is drawn as
  // a zero rather than hidden — "0 today" is information; a missing line is
  // ambiguous between none and not measured.
  function admStat(label, n, today){
    return '<li class="admTelCell">' +
      '<span class="admTelN">' + admEsc(Number(n) || 0) + '</span>' +
      '<span class="admTelL">' + admEsc(label) + '</span>' +
      (today == null ? '' :
        '<span class="admTelToday">+' + admEsc(Number(today) || 0) + ' today</span>') +
    '</li>';
  }

  // ---- reports ------------------------------------------------------------
  var RPT_LABELS = {
    copyright:'Copyright infringement', ai_undisclosed:'AI-generated without disclosure',
    nudity:'Nudity / Sexual content', violence:'Violence / Gore',
    hate:'Hate speech / Harassment', spam:'Spam / Advertising',
    misinformation:'Misinformation', impersonation:'Impersonation',
    illegal:'Illegal content', offtopic:'Off-topic / Wrong category',
    lowquality:'Low-quality / Broken upload', other:'Other',
    dmca:'DMCA / Copyright', harassment:'Harassment', fraud:'Fraud'
  };

  var admRptWhich = 'user';
  function admRptKind(kind){
    admRptWhich = kind;
    Array.prototype.forEach.call(
      document.querySelectorAll('.admRptTog'), function(b){
        b.classList.toggle('active', b.getAttribute('data-q') === kind);
      });
    admLoadReports();
  }

  function admLoadReports(){
    return admRptWhich === 'item' ? admLoadItemReports() : admLoadUserReports();
  }

  // Accounts. The queue a partner is here for, and the one the ban engine
  // below acts on.
  function admLoadUserReports(){
    var list = document.getElementById('admRptList');
    var empty = document.getElementById('admRptEmpty');
    if(!list) return;

    admApi('reports', {status:'pending'}).then(function(r){
      var rows = (r && r.reports) || [];
      admSetRptCount(rows.length);
      list.innerHTML = '';
      if(!rows.length){
        if(empty){ empty.style.display='block';
                   empty.innerHTML = '<span class="admEmptyIcon">✓</span>No open reports.'; }
        return;
      }
      if(empty) empty.style.display='none';

      rows.forEach(function(rep){
        var card = document.createElement('div');
        card.className = 'pfCard admRptCard';
        card.innerHTML =
          '<div class="admRptWhy">🚩 ' + admEsc(RPT_LABELS[rep.reason] || rep.reason) + '</div>' +
          '<div class="admRptWho">@' + admEsc(rep.target_username || 'unknown') +
            (rep.target_banned ? ' <span class="admRptBanned">banned</span>' : '') + '</div>' +
          (rep.details ? '<div class="admRptDet"></div>' : '') +
          '<div class="admRptMeta">by @' + admEsc(rep.reporter_username || 'someone') +
            ' · ' + admEsc(rep.created_at ? new Date(rep.created_at).toLocaleString() : '') +
          '</div>' +
          '<div class="admRptActs"></div>';

        // The reporter's own words, as text. This is the one field on the card
        // somebody else typed.
        if(rep.details) card.querySelector('.admRptDet').textContent = rep.details;

        var acts = card.querySelector('.admRptActs');
        acts.appendChild(admBtn('REVIEW', function(){
          admSwitchTab('mod');
          var q = document.getElementById('admModQ');
          if(q){ q.value = rep.target_id; admModSearch(rep.target_id); }
        }));
        acts.appendChild(admBtn('RESOLVE', function(){ admResolveUser(rep.id, 'resolved'); }));
        acts.appendChild(admBtn('DISMISS', function(){ admResolveUser(rep.id, 'dismissed'); }));
        list.appendChild(card);
      });
    }, function(err){
      list.innerHTML = '';
      if(empty){ empty.style.display='block'; empty.textContent = err.message; }
    });
  }

  function admBtn(text, fn){
    var b = document.createElement('button');
    b.className = 'rptBtn';
    b.textContent = text;
    b.onclick = fn;
    return b;
  }

  function admResolveUser(id, status){
    admApi('report-resolve', {id:id, status:status}).then(function(){
      showToast(status === 'resolved' ? 'Report resolved' : 'Report dismissed');
      admLoadReports();
    }, function(e){ showToast(e.message || 'Action failed'); });
  }

  // Uploads. The queue that was here before any of this, unchanged except for
  // where it is drawn.
  async function admLoadItemReports(){
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
      if(!rows.length){
        if(empty){ empty.style.display='block';
                   empty.innerHTML = '<span class="admEmptyIcon">✓</span>No open reports.'; }
        return;
      }
      if(empty) empty.style.display='none';
      rows.forEach(function(rep){
        var card = document.createElement('div');
        card.className = 'pfCard admRptCard';
        var art = rep.artworks || {};
        var h = document.createElement('div');
        h.className = 'admRptWhy';
        h.textContent = '🚩 ' + (RPT_LABELS[rep.reason] || rep.reason);
        card.appendChild(h);
        var n = document.createElement('div');
        n.className = 'admRptWho';
        n.textContent = art.name || '(untitled artwork)';
        card.appendChild(n);
        if(rep.details){
          var d = document.createElement('div');
          d.className = 'admRptDet';
          d.textContent = rep.details;
          card.appendChild(d);
        }
        var when = document.createElement('div');
        when.className = 'admRptMeta';
        when.textContent = rep.created_at ? new Date(rep.created_at).toLocaleString() : '';
        card.appendChild(when);
        var acts = document.createElement('div');
        acts.className = 'admRptActs';
        acts.appendChild(admBtn('VIEW', function(){ openArtworkById(String(rep.artwork_id), false); }));
        acts.appendChild(admBtn('RESOLVE', function(){ admResolveReport(rep.id, 'resolved'); }));
        acts.appendChild(admBtn('DISMISS', function(){ admResolveReport(rep.id, 'dismissed'); }));
        card.appendChild(acts);
        list.appendChild(card);
      });
    }catch(e){
      console.error('admLoadItemReports:', e);
      if(empty){ empty.style.display='block'; empty.textContent = 'Couldn’t load reports.'; }
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

  // ---- moderation ---------------------------------------------------------
  //
  // One member at a time, found exactly. dz_mod_find() refuses a prefix, so
  // this cannot be walked to enumerate accounts or harvest addresses — and the
  // reply carries can_moderate, computed by Postgres for THIS moderator
  // against THIS target, so the buttons drawn are the buttons that will work.
  function admWireMod(el){
    var form = el.querySelector('#admModForm');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var q = el.querySelector('#admModQ');
      admModSearch(q ? q.value : '');
    });
  }

  function admModSearch(query){
    var host = document.getElementById('admModResult');
    if(!host) return;
    var q = String(query || '').trim();
    if(q.length < 2){ host.innerHTML = '<div class="pfEmpty">Type a little more.</div>'; return; }
    host.innerHTML = '<div class="pfEmpty">Looking…</div>';

    admApi('mod-find', {query:q}).then(function(r){
      var u = r && r.user;
      if(!u){ host.innerHTML = '<div class="pfEmpty">No member matches that exactly.</div>'; return; }
      admRenderMember(host, u);
    }, function(err){
      host.innerHTML = '<div class="pfEmpty">' + admEsc(err.message) + '</div>';
    });
  }

  function admRenderMember(host, u){
    // role and email come back null for a partner — dz_mod_find() withholds
    // both, so that looking accounts up cannot be used to work out who the
    // other partners are. So neither is invented here. The role chip is drawn
    // only when there is a role to draw, which means a partner never sees one
    // and a staff member sees one on exactly the privileged accounts.
    //
    // The previous line read `u.role ? u.role : 'member'`, which would have
    // labelled every withheld role 'member' — a partner looking up an admin
    // would have been shown a badge saying the opposite of the truth, and then
    // refused when they acted on it.
    host.innerHTML =
      '<div class="admMemb">' +
        '<div class="admMembTop">' +
          '<div>' +
            '<div class="admMembName">@' + admEsc(u.username || '—') + '</div>' +
            (u.email ? '<div class="admMembSub">' + admEsc(u.email) + '</div>' : '') +
          '</div>' +
          '<div class="admMembTags">' +
            (u.role ? '<span class="admTag admTag--' + admEsc(u.role) + '">' +
                      admEsc(u.role) + '</span>' : '') +
            '<span class="admTag">' + admEsc(u.tier || 'guest') + '</span>' +
            (u.banned ? '<span class="admTag admTag--ban">banned</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="admMembId">' + admEsc(u.id) + '</div>' +
        (u.banned && u.ban_reason
          ? '<div class="admMembBan">Banned for ' + admEsc(u.ban_reason) +
            (u.ban_expires_at
              ? ' until ' + admEsc(new Date(u.ban_expires_at).toLocaleDateString())
              : ' — no end date') + '</div>'
          : '') +
        '<div class="admMembActs" id="admMembActs"></div>' +
      '</div>';

    var acts = host.querySelector('#admMembActs');

    // Postgres has already answered whether this moderator may touch this
    // member. Where it says no, the reason is said plainly rather than a
    // button being drawn that would answer 403.
    if(!u.can_moderate){
      var no = document.createElement('p');
      no.className = 'admMembNo';
      no.textContent = admIsStaff()
        ? 'Staff accounts cannot be banned from here.'
        : 'You can moderate ordinary members. Admins, devs and other partners ' +
          'are outside what this account may do.';
      acts.appendChild(no);
      return;
    }

    if(u.banned){
      acts.appendChild(admBtn('LIFT BAN', function(){
        admApi('unban', {userId:u.id}).then(function(){
          showToast('Ban lifted');
          admModSearch(u.id);
          admLoadReports();
        }, function(e){ showToast(e.message || 'Could not lift that ban'); });
      }));
      return;
    }

    var form = document.createElement('div');
    form.className = 'admBanForm';
    form.innerHTML =
      '<input type="text" id="admBanWhy" class="admModIn" maxlength="60" ' +
        'placeholder="Reason (shown in the audit log)" aria-label="Reason for the ban">' +
      '<div class="admBanRow">' +
        '<select id="admBanLen" class="admBanLen" aria-label="How long">' +
          '<option value="">Permanent</option>' +
          '<option value="1">1 day</option>' +
          '<option value="7">7 days</option>' +
          '<option value="30">30 days</option>' +
          '<option value="90">90 days</option>' +
        '</select>' +
        '<button type="button" class="admBanGo" id="admBanGo">Ban</button>' +
      '</div>';
    acts.appendChild(form);

    form.querySelector('#admBanGo').addEventListener('click', function(){
      var why = String((form.querySelector('#admBanWhy').value) || '').trim();
      if(why.length < 2){ showToast('Give a reason'); return; }
      var days = form.querySelector('#admBanLen').value;
      admApi('ban', {userId:u.id, reason:why, days:days ? Number(days) : null})
        .then(function(){
          showToast('@' + (u.username || 'member') + ' banned');
          admModSearch(u.id);
          admLoadReports();
        }, function(e){ showToast(e.message || 'Could not ban that account'); });
    });
  }

  // ---- the audit trail ----------------------------------------------------
  //
  // The actor's role is shown from the row rather than looked up now, because
  // that is how it was recorded: a partner demoted since must not make the ban
  // they placed look like a member placed it.
  var AUDIT_VERB = {
    ban_user:'banned', unban_user:'lifted the ban on',
    grant_partner:'made a partner', revoke_partner:'removed as a partner',
    create_promo:'created a promo code', claim_max:'claimed Max',
    resolve_report:'resolved a report about'
  };

  function admLoadAudit(){
    var list = document.getElementById('admLogList');
    var empty = document.getElementById('admLogEmpty');
    if(!list) return;

    admApi('audit', {limit:100}).then(function(r){
      var rows = (r && r.entries) || [];
      list.innerHTML = '';
      if(!rows.length){ if(empty) empty.style.display='block'; return; }
      if(empty) empty.style.display='none';

      rows.forEach(function(e){
        var row = document.createElement('div');
        row.className = 'admLog';
        var verb = AUDIT_VERB[e.action] || e.action;
        var who  = e.actor_username ? '@' + e.actor_username : 'someone';
        var whom = e.target_username ? '@' + e.target_username : '';
        // The reason a moderator typed is the one field here somebody else
        // wrote, so it goes in as text rather than as markup.
        var why = (e.metadata && e.metadata.reason) ? String(e.metadata.reason) : '';

        row.innerHTML =
          '<div class="admLogMain">' +
            '<span class="admLogWho">' + admEsc(who) + '</span>' +
            '<span class="admLogRole">' + admEsc(e.actor_role || 'member') + '</span>' +
            '<span class="admLogAct">' + admEsc(verb) + '</span>' +
            (whom ? '<span class="admLogTgt">' + admEsc(whom) + '</span>' : '') +
          '</div>' +
          (why ? '<div class="admLogWhy"></div>' : '') +
          '<div class="admLogWhen">' +
            admEsc(e.created_at ? new Date(e.created_at).toLocaleString() : '') +
          '</div>';
        if(why) row.querySelector('.admLogWhy').textContent = '\u201c' + why + '\u201d';
        list.appendChild(row);
      });
    }, function(err){
      list.innerHTML = '';
      if(empty){ empty.style.display='block'; empty.textContent = err.message; }
    });
  }

  // ---- partners -----------------------------------------------------------
  function admWirePartners(el){
    el.querySelector('#admAddPartner').addEventListener('click', admInvitePartner);
  }

  // The + button. An email address, because that is what an admin has to hand:
  // they are inviting somebody they have spoken to, not somebody they found in
  // a list. An unregistered address is refused rather than held as a pending
  // invitation — there is no state that could hand the role to whoever signs
  // up with that address later.
  function admInvitePartner(){
    var email = prompt('Email address of the member to make a partner:', '');
    if(email === null) return;
    email = String(email).trim();
    if(!email) return;

    admApi('add-partner', {email:email}).then(function(r){
      showToast(r && r.changed
        ? '@' + (r.username || 'they') + ' is now a partner'
        : 'That member was already a partner');
      admLoadPartners();
    }, function(e){ showToast(e.message || 'Could not add that partner'); });
  }

  function admLoadPartners(){
    var list = document.getElementById('admPrtList');
    var empty = document.getElementById('admPrtEmpty');
    if(!list) return;

    admApi('partners', {}).then(function(r){
      var rows = (r && r.partners) || [];
      list.innerHTML = '';
      if(!rows.length){ if(empty) empty.style.display='block'; return; }
      if(empty) empty.style.display='none';

      rows.forEach(function(p){
        // Every partner's earnings, unblurred, because this is the staff view
        // — the isolation rule is about what one PARTNER can see of another,
        // and dz_admin_partners() refuses anyone who is not staff outright.
        var earned = p.earned_json || {};
        var money = Object.keys(earned).map(function(c){
          return admEsc(c) + ' ' + admEsc(earned[c]);
        }).join(' · ');

        var row = document.createElement('div');
        row.className = 'admPrt';
        row.innerHTML =
          '<div class="admPrtMain">' +
            '<div class="admPrtName">@' + admEsc(p.username || '—') + '</div>' +
            '<div class="admPrtSub">' +
              (p.code
                ? '<span class="admPrtCode">' + admEsc(p.code) + '</span>' +
                  (p.code_active ? '' : ' <span class="admPrtOff">inactive</span>') +
                  ' · ' + admEsc(p.usage_count || 0) + ' uses'
                : 'No code yet') +
              (p.max_claimed ? ' · Max claimed' : '') +
            '</div>' +
            (money ? '<div class="admPrtMoney">' + money + ' earned (minor units)</div>' : '') +
          '</div>' +
          '<div class="admPrtActs"></div>';

        row.querySelector('.admPrtActs').appendChild(
          admBtn('REVOKE', function(){
            if(!confirm('Remove partner status from @' + (p.username || 'this member') +
                        '? Their code stops taking new orders. Anything already ' +
                        'earned stays theirs.')) return;
            admApi('revoke-partner', {userId:p.partner_id}).then(function(){
              showToast('Partner removed');
              admLoadPartners();
            }, function(e){ showToast(e.message || 'Could not remove that partner'); });
          }));
        list.appendChild(row);
      });
    }, function(err){
      list.innerHTML = '';
      if(empty){ empty.style.display='block'; empty.textContent = err.message; }
    });
  }
