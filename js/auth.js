/* ── auth.js · login / signup / notifications ── */
  /* Auth — email+password via Supabase; session persists via localStorage */

  /* ── State ── */
  var currentUser = null; /* null = logged out, object = logged in */
  var currentUserAvatarUrl = null; /* logged-in user's photo, kept in sync with
       profiles.avatar_url — feeds every avatar chip app-wide (nav, comment
       bar, subscription card). Set on login/role-check and refreshed the
       instant a new photo is uploaded via doPfAvBUpload(). */
  var authMode = 'login'; /* 'login' | 'signup' */

  /* Avatar helpers — shared by navbar, profile page, and comment bar */

  /* ── Paint a single avatar chip: real photo if we have a URL, else the
     letter fallback. Every avatar chip in the app (nav, comment bar,
     subscription card, artwork-viewer author row) follows this same
     img-or-letter pattern so a new upload only has to update one URL. ── */
  function paintAvatarChip(imgId, txtId, url, letter){
    var img = document.getElementById(imgId);
    var txt = document.getElementById(txtId);
    if(!img || !txt) return;
    if(url){
      /* Avatar chips are tiny (≤36px) — serve the small resized WebP
         instead of the full original. imgResize is idempotent, so a
         caller that already passed a resized URL is left untouched. */
      img.src = getThumbnailUrl(url);
      img.style.display = 'block';
      txt.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      txt.style.display = '';
      txt.textContent = letter || '?';
    }
  }

  /* ── Sync the navbar: swap face icon ↔ avatar button ── */
  function syncAuthBtn() {
    var loginBtn  = document.getElementById('navLoginBtn');
    var avatarBtn = document.getElementById('navAvatarBtn');
    var letterEl  = document.getElementById('navAvatarLetter');

    if (currentUser) {
      /* Logged in: hide face icon, show avatar */
      var letter = cpGetAvatarLetter(); /* reuse existing helper */
      paintAvatarChip('navAvatarImg', 'navAvatarLetter', currentUserAvatarUrl, letter);
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (avatarBtn) {
        avatarBtn.style.display = 'flex';
        avatarBtn.title = 'Profile — ' + cpGetDisplayName();
      }
    } else {
      /* Logged out: show face icon, hide avatar */
      if (loginBtn)  loginBtn.style.display  = '';
      if (avatarBtn) avatarBtn.style.display  = 'none';
    }

    /* Also sync the subscription overview card and comment bar avatar */
    syncSubOverviewCard();
    cpSyncAvatar();
  }

  /* ── Sync the Subscription Overview profile card ── */
  function syncSubOverviewCard() {
    var avatarEl   = document.getElementById('subOvAvatarLetter');
    var nameEl     = document.getElementById('subOvUsernameLabel');
    var badgeEl    = document.getElementById('subOvBadge');
    var profileCard = document.getElementById('subOvProfileCard');
    if (!avatarEl || !nameEl || !badgeEl) return;

    /* Helper: remove all profile-tier border classes then add the right one */
    function setProfileTier(tier) {
      if (!profileCard) return;
      profileCard.classList.remove(
        'subOvCard--profile-lite',
        'subOvCard--profile-premium',
        'subOvCard--profile-max',
        'subOvCard--profile-dev'
      );
      if (tier === 'lite')    profileCard.classList.add('subOvCard--profile-lite');
      if (tier === 'premium') profileCard.classList.add('subOvCard--profile-premium');
      if (tier === 'max')     profileCard.classList.add('subOvCard--profile-max');
      if (tier === 'dev')     profileCard.classList.add('subOvCard--profile-dev');
      /* guest / null: no tier class → default grey border */
    }

    if (currentUser) {
      var letter = cpGetAvatarLetter();
      var name   = cpGetDisplayName();
      paintAvatarChip('subOvAvatarImg', 'subOvAvatarTxt', currentUserAvatarUrl, letter);
      nameEl.textContent   = name;

      /* Determine badge label and tier class — userPlan may not be set yet
         (checkUserRole is async) so fall back to 'guest' if null. */
      var plan   = (typeof userPlan === 'string') ? userPlan : 'guest';
      /* Dev role gets its own red tier */
      if (typeof isDev !== 'undefined' && isDev) plan = 'dev';
      var labels = { guest:'FREE', lite:'LITE', premium:'PREMIUM', max:'MAX', dev:'DEV' };
      var label  = labels[plan] || 'FREE';
      badgeEl.textContent = label;

      /* Sync badge pill class */
      badgeEl.className = 'subOvPlanBadge subOvPlanBadge--' + (labels[plan] ? plan : 'guest');
      /* Sync profile card border colour */
      setProfileTier(plan);
    } else {
      /* Logged out: reset to default */
      paintAvatarChip('subOvAvatarImg', 'subOvAvatarTxt', null, '?');
      nameEl.textContent   = 'Profile';
      badgeEl.textContent  = 'FREE';
      badgeEl.className    = 'subOvPlanBadge subOvPlanBadge--guest';
      setProfileTier('guest');
    }
  }

  /* SETTINGS PAGE (full page — replaced the old ⋮ drawer) */

  var setLastFocus = null;

  function openSettingsPage() {
    var pg = document.getElementById('setPage');
    if (!pg) return;
    setLastFocus = document.activeElement;
    pg.classList.add('open');
    document.body.style.overflow = 'hidden';
    pfMenuRefreshCounts(); /* fire-and-forget; badges fill in as data lands */
  }

  function closeSettingsPage() {
    var pg = document.getElementById('setPage');
    if (pg) pg.classList.remove('open');
    restoreScroll();
    if (setLastFocus && setLastFocus.focus) { try { setLastFocus.focus(); } catch (e) {} }
    setLastFocus = null;
  }

  /* Likes / Bookmarks / Friends counts. Errors leave the badge blank
     (CSS hides empty badges) — the page never blocks on this. */
  async function pfMenuRefreshCounts() {
    var L = document.getElementById('pfMenuLikeCount'),
        B = document.getElementById('pfMenuBmCount'),
        F = document.getElementById('pfMenuFrdCount');
    if (L) L.textContent = ''; if (B) B.textContent = ''; if (F) F.textContent = '';
    if (!sb || !currentUser) return;
    var uid = currentUser.id;
    sb.from('artwork_likes').select('artwork_id', { count: 'exact', head: true })
      .eq('user_id', uid).then(function (r) {
        if (L && !r.error && typeof r.count === 'number') L.textContent = r.count;
      });
    sb.from('artwork_bookmarks').select('artwork_id', { count: 'exact', head: true })
      .eq('user_id', uid).then(function (r) {
        if (B && !r.error && typeof r.count === 'number') B.textContent = r.count;
      });
    if (typeof window.__dmFetchPartners === 'function') {
      window.__dmFetchPartners().then(function (partners) {
        if (F) F.textContent = partners.length;
      }).catch(function(){});
    }
  }

  /* Logout — runs the existing signOut flow, then closes the settings page */
  function pfMenuLogout() {
    closeSettingsPage();
    if (sb) {
      sb.auth.signOut()
        .then(function(){ showToast('Signed out'); })
        .catch(function(e){ console.error('Error: ' + e.message); });
    }
  }

  /* ── Upload dropdown ── */
  var _pfUpMenuOpen = false;

  /* Profile upload dropdown removed — stubs kept because the global
     Escape/outside-click handlers still call closePfUploadMenu(). */
  function openPfUploadMenu() {}
  function closePfUploadMenu() {}
  function togglePfUploadMenu() {}


  /* Close the upload dropdown on outside click.
     (The ⋮ profile-menu branch was removed with the drawer.) */
  document.addEventListener('click', function(e) {
    if (_pfUpMenuOpen) {
      var umenu = document.getElementById('pfUploadMenu');
      var utrig = document.querySelector('.pfUpTrigger');
      if (umenu && !umenu.contains(e.target) && utrig && !utrig.contains(e.target)) closePfUploadMenu();
    }
  });

  function openAuthMod() {
    document.getElementById('authUser').value  = '';
    document.getElementById('authEmail').value = '';
    document.getElementById('authPass').value  = '';
    var err = document.getElementById('authErr');
    err.textContent = ''; err.classList.remove('show');
    var msg = document.getElementById('authMsg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    /* Always open in login mode */
    switchAuthMode('login');
    document.getElementById('authMod').classList.add('open');
    document.body.style.overflow = 'hidden';
    if (window.location.pathname !== '/login') {
      try{ history.pushState({},'', '/login'); }catch(e){}
    }
    /* Focus email on login (username field is hidden), focus username on signup */
    setTimeout(function(){
      var mode = authMode;
      var focusId = (mode === 'signup') ? 'authUser' : 'authEmail';
      var el = document.getElementById(focusId);
      if (el) el.focus();
    }, 120);
  }
  function closeAuthMod(revertUrl) {
    var panel = document.getElementById('authMod');
    if (!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    restoreScroll();
    if (revertUrl !== false && window.location.pathname === '/login') {
      try{ history.pushState({},'', '/'); }catch(e){}
    }
  }

  /* ── Perform login ── */
  async function doAuth() {
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }
    var email = document.getElementById('authEmail').value.trim();
    var pass  = document.getElementById('authPass').value;
    var err   = document.getElementById('authErr');

    if (!email) { err.textContent = 'Please enter your email.'; err.classList.add('show'); return; }
    if (!pass)  { err.textContent = 'Please enter your password.'; err.classList.add('show'); return; }

    var btn = document.getElementById('authBtn');
    btn.textContent = 'SIGNING IN…'; btn.disabled = true;
    err.textContent = ''; err.classList.remove('show');

    try {
      var result = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (result.error) throw result.error;
      /* onAuthStateChange fires automatically — it will close the modal & sync the button */
    } catch (e) {
      err.textContent = e.message || 'Login failed. Check your credentials.';
      err.classList.add('show');
    } finally {
      btn.textContent = 'Log In'; btn.disabled = false;
    }
  }

  /* ── OAuth sign-in (Google / Discord / Apple) ──
     signInWithOAuth redirects the browser to the provider; on return
     the Supabase client exchanges the code automatically and
     onAuthStateChange('SIGNED_IN') fires — which already closes the
     modal, syncs the nav button and runs checkUserRole(), exactly like
     password login. No username is set for OAuth users; their profiles
     row is seeded server-side by the on-signup trigger (see SQL) and
     self-healed by pfEnsureOwnProfile() as a fallback. */
  var OAUTH_LABELS = { google:'Google', discord:'Discord', apple:'Apple' };
  async function doOAuth(provider, btnEl) {
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }
    var label = OAUTH_LABELS[provider] || provider;
    var err = document.getElementById('authErr');
    err.textContent = ''; err.classList.remove('show');

    /* Lock the whole social row while we hand off to the provider */
    var row = document.querySelector('.laSocial');
    var btns = row ? row.querySelectorAll('.laSocialBtn') : [];
    Array.prototype.forEach.call(btns, function(b){ b.disabled = true; });

    try {
      var opts = { redirectTo: window.location.origin };
      /* Let Google users pick which account to use rather than silently
         reusing whichever one the browser is already signed into. */
      if (provider === 'google') opts.queryParams = { prompt: 'select_account' };

      var result = await sb.auth.signInWithOAuth({ provider: provider, options: opts });
      if (result.error) throw result.error;
      /* Success → browser is now navigating away to the provider. */
    } catch (e) {
      Array.prototype.forEach.call(btns, function(b){ b.disabled = false; });
      var raw = (e && e.message || '').toLowerCase();
      if (raw.includes('provider is not enabled') || raw.includes('unsupported provider')) {
        /* Was a dev instruction naming the backend console — useless and
           confusing to the person actually trying to sign in. */
        err.textContent = label + ' sign-in isn\u2019t available right now. Try another method.';
      } else {
        err.textContent = (e && e.message) ? (label + ' sign-in failed: ' + e.message)
                                           : (label + ' sign-in is unavailable right now.');
      }
      err.classList.add('show');
    }
  }

  /* ── Toggle between login and signup views ── */
  function switchAuthMode(mode) {
    authMode = mode;
    var title      = document.getElementById('authTitle');
    var subtitle   = document.getElementById('authSubtitle');
    var btn        = document.getElementById('authBtn');
    var toggleBtn  = document.getElementById('authToggleBtn');
    var leadText   = document.getElementById('authLeadText');
    var err        = document.getElementById('authErr');
    var msg        = document.getElementById('authMsg');
    var userWrap   = document.getElementById('authUserWrap');
    var passField  = document.getElementById('authPass');

    /* Reset error / success state */
    err.textContent = ''; err.classList.remove('show');
    msg.style.display = 'none'; msg.textContent = '';

    if (mode === 'signup') {
      title.textContent = 'Create Account';
      subtitle.textContent = 'Choose a username (your public display name), enter your email, and set a password of at least 6 characters.';
      subtitle.style.display = 'block';
      btn.textContent = 'Create Account';
      btn.onclick = doSignUp;
      leadText.textContent = 'Already have an account?';
      toggleBtn.textContent = 'Log in';
      toggleBtn.onclick = function(){ switchAuthMode('login'); };
      /* Show the username field in signup mode */
      if (userWrap) userWrap.style.display = '';
      passField.setAttribute('autocomplete', 'new-password');
      /* Focus username field when switching to signup */
      setTimeout(function(){ var u = document.getElementById('authUser'); if (u) u.focus(); }, 60);
    } else {
      title.textContent = 'Welcome Back';
      subtitle.textContent = 'Sign in to continue to your account.';
      subtitle.style.display = 'block';
      btn.textContent = 'Log In';
      btn.onclick = doAuth;
      leadText.textContent = "Don't have an account?";
      toggleBtn.textContent = 'Sign up';
      toggleBtn.onclick = function(){ switchAuthMode('signup'); };
      /* Hide username field on login — not needed */
      if (userWrap) userWrap.style.display = 'none';
      passField.setAttribute('autocomplete', 'current-password');
    }
  }

  /* ── Show/hide password text in the login form ── */
  var AUTH_EYE_OPEN = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
  var AUTH_EYE_OFF  = '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.86 13.86 0 0 0 1 11s4 7 11 7a9.26 9.26 0 0 0 5.39-1.61M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  function toggleAuthPassVis() {
    var inp  = document.getElementById('authPass');
    var icon = document.getElementById('authEyeIcon');
    if (!inp) return;
    var showing = inp.type === 'password';
    inp.type = showing ? 'text' : 'password';
    if (icon) icon.innerHTML = showing ? AUTH_EYE_OFF : AUTH_EYE_OPEN;
  }

  /* ── Perform signup ── */
  async function doSignUp() {
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }

    var email    = document.getElementById('authEmail').value.trim();
    var pass     = document.getElementById('authPass').value;
    var username = (document.getElementById('authUser').value || '').trim();
    var err      = document.getElementById('authErr');
    var msg      = document.getElementById('authMsg');

    err.textContent = ''; err.classList.remove('show');
    msg.style.display = 'none'; msg.textContent = '';

    /* ── Validate username ── */
    if (!username) {
      err.textContent = 'Please enter a username.';
      err.classList.add('show'); return;
    }

    /* ── Validate email ── */
    if (!email) {
      err.textContent = 'Please enter your email address.';
      err.classList.add('show'); return;
    }
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email)) {
      err.textContent = 'Please enter a valid email address.';
      err.classList.add('show'); return;
    }

    /* ── Validate password (min 6 chars) ── */
    if (!pass) {
      err.textContent = 'Please enter a password.';
      err.classList.add('show'); return;
    }
    if (pass.length < 6) {
      err.textContent = 'Password must be at least 6 characters long.';
      err.classList.add('show'); return;
    }

    var btn = document.getElementById('authBtn');
    btn.textContent = 'CREATING ACCOUNT…'; btn.disabled = true;

    try {
      var result = await sb.auth.signUp({ email: email, password: pass, options: { data: { username: username } } });
      if (result.error) throw result.error;

      var session = result.data && result.data.session;

      if (session) {
        /* ── Email confirmation DISABLED: user is signed in immediately ──
           onAuthStateChange('SIGNED_IN') fires → closes modal, syncs UI, shows toast.
           No extra work needed here. */
        showToast('Account created ✦ Welcome!');
        /* modal will close via onAuthStateChange */
      } else {
        /* ── Email confirmation ENABLED: show check-your-email notice ── */
        document.getElementById('authEmail').value = '';
        document.getElementById('authPass').value  = '';
        msg.textContent = '✦ Check your email to confirm your account.';
        msg.style.display = 'block';
        btn.textContent = 'Create Account'; btn.disabled = false;
        /* Auto-close modal after 5 s */
        setTimeout(function(){
          if (document.getElementById('authMod').classList.contains('open')) {
            closeAuthMod();
          }
        }, 5000);
        return; /* keep modal open to show message */
      }
    } catch (e) {
      /* ── Map Supabase error messages to user-friendly copy ── */
      var raw = (e.message || '').toLowerCase();
      var friendly;
      if (raw.includes('already registered') || raw.includes('already in use') || raw.includes('user already')) {
        friendly = 'This email is already registered. Try logging in instead.';
      } else if (raw.includes('weak password') || raw.includes('password should') || raw.includes('at least')) {
        friendly = 'Password is too weak. Use at least 6 characters.';
      } else if (raw.includes('invalid email') || raw.includes('unable to validate email')) {
        friendly = 'Invalid email address. Please check and try again.';
      } else if (raw.includes('network') || raw.includes('fetch') || raw.includes('failed to fetch')) {
        friendly = 'Network error. Please check your connection and try again.';
      } else if (raw.includes('rate limit') || raw.includes('too many')) {
        friendly = 'Too many attempts. Please wait a moment and try again.';
      } else {
        friendly = e.message || 'Sign-up failed. Please try again.';
      }
      err.textContent = friendly;
      err.classList.add('show');
    } finally {
      /* Only reset button text if we didn't return early (email-confirm path) */
      if (btn.disabled) {
        btn.textContent = 'Create Account'; btn.disabled = false;
      }
    }
  }

  /* ── Role check ──
     isDev reflects DB truth (profiles.role === 'dev') and controls whether
     the Admin Panel button exists in the DOM at all. The panel only holds
     hero slides, broadcast notifications and reports — devs have NO other
     powers anywhere on the site. Enforced server-side via RLS. */
  let isDev = false;
  /* userPlan: null = not logged in (guest/no session).
     Values mirror profiles.subscription_tier:
       'guest'        = logged in, no paid plan (DB default)
       'lite'         = Premium Lite subscriber
       'premium'      = Premium subscriber
       'max'          = Max subscriber
     'dev' role bypasses all checks via isDev. */
  let userPlan = null;
  async function checkUserRole(){
    if(!sb || !currentUser){ isDev=false; userPlan=null; currentUserAvatarUrl=null; syncAdmBtn(); return; }
    try{
      const{data,error}=await sb.from('profiles').select('role,subscription_tier,avatar_url').eq('id',currentUser.id).single();
      if(error) throw error;
      isDev    = !!data && data.role==='dev';
      userPlan = (data && data.subscription_tier) ? data.subscription_tier : 'guest';
      currentUserAvatarUrl = (data && data.avatar_url) ? data.avatar_url : null;
    }catch(e){ console.error(e); isDev=false; userPlan='guest'; }
    syncAdmBtn();
    syncAuthBtn(); /* repaints nav avatar + subscription card + comment bar with the fetched photo */
    notifRefreshBadge();
    /* Universal upload queued before login → open it now */
    if(currentUser && sessionStorage.getItem('pendPfUp')==='1'){
      sessionStorage.removeItem('pendPfUp');
      /* Upload is a full page now — open it as a destination
         (close everything else + take the ➕ tab highlight),
         exactly like tapping nav ➕ while signed in. */
      setTimeout(function(){
        if(typeof bnCloseAllSections==='function') bnCloseAllSections();
        openPfUpload();
        if(typeof bnSetActive==='function') bnSetActive('bnUpload');
      },250);
    }
  }

  /* ── Listen for auth state changes (login / logout / refresh) ── */
  if (sb) {
    sb.auth.onAuthStateChange(function(event, session) {
      currentUser = session ? session.user : null;
      syncAuthBtn();
      /* Wipe the stale-while-revalidate caches on any auth change — otherwise
         a signed-out (or newly signed-in) user could be shown the previous
         account's cached profile, community list or chat messages. */
      pfRowCache = {}; cmMineRows = []; cpMsgCache = {}; cmMineCache = {};
      /* Ranking boards: the "you" row highlight and the pinned Your-rank
         footer both follow the session, so repaint them on any auth change. */
      try{ if (typeof window.rkRefresh === 'function') window.rkRefresh(); }catch(e){}
      /* Hide-list follows the session: load on sign-in/restore, clear on
         sign-out, then repaint so the feed reflects it immediately. */
      loadHiddenArtworks().then(function(){
        try{ renderHome(); }catch(e){}
        try{ renderFG(); }catch(e){}
      });
      /* Tag preferences follow the session: the signed-in user's DB
         copy replaces whatever was in localStorage, and signing out
         falls back to the local mirror. */
      try{ if(typeof tgLoad === 'function') tgLoad(true); }catch(e){}
      if (event === 'SIGNED_IN') {
        closeAuthMod();
        checkUserRole();
        /* Greet by username only — never expose email.
           FIX: showToast used to fire in the same tick as closeAuthMod(),
           so the welcome toast animated in WHILE #authMod was still mid
           way through its .45s slide-close transition. Delaying it past
           that transition means the toast now appears only after the
           login panel has fully closed, instead of during its animation.
           FIX 2: on a page-load session restore this event fires while the
           #intro loading screen is still animating, so the greeting used to
           flash behind/over it. afterIntro() holds the toast until the intro
           has fully faded out; on a manual login (intro long gone) it runs
           immediately, so that path is unchanged. */
        var greetName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.username)
          ? currentUser.user_metadata.username
          : '';
        afterIntro(function(){
          setTimeout(function(){
            showToast(greetName ? ('Welcome, ' + greetName + ' ✦') : 'Signed in ✦');
          }, 460);
        });
      }
      if (event === 'SIGNED_OUT') {
        currentUserAvatarUrl = null;
        syncAuthBtn();
        isDev=false; userPlan=null; syncAdmBtn();
        syncSubOverviewCard(); /* reset profile card to guest state */
        notifRefreshBadge(); /* clears the dot — guests have no read-state to track */
        /* FIX: signing out from the profile ⋮ menu used to leave the
           now-stale profile page open, still painted with owner-only
           controls. Close it and the owner-only pages outright. */
        closeProfilePage();
        closeMyWorkPage();
        closeAdmPage();
      }
    });


    /* Restore session on page load (keeps user logged in after refresh) */
    sb.auth.getSession().then(function(res) {
      if (res.data && res.data.session) {
        currentUser = res.data.session.user;
        syncAuthBtn();
        checkUserRole();
      }
    });
  }


  /* ── NOTIFICATIONS ──
     Two sources feed the same #notifPage list:
       1) Admin broadcasts — notifications.user_id IS NULL, sent
          from the admin panel (admSendBroadcast) and visible to
          every visitor, signed in or not.
       2) Personal notices — notifications.user_id = the owner's
          id (e.g. legacy review notices; nothing sends these
          automatically anymore).
     The notifications table itself is read-only from the app —
     there is no update/delete anywhere in this UI, matching the
     "no one can edit a notification" requirement. Per-user read
     state lives in a separate notification_reads table so the
     notifications rows never need to be touched to mark them
     read. */
  var notifList = [];       /* rows currently loaded, newest first */
  var notifReadIds = {};    /* {notification_id: true} for the current user */

  function openNotifications(){
    var el = document.getElementById('notifPage');
    if(!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = 'none';
    notifLoad();
  }

  function closeNotifPage(){
    var el = document.getElementById('notifPage');
    if(!el) return;
    el.classList.remove('open');
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = '';
    restoreScroll();
  }

  function notifIcon(type){
    if(type==='artwork_approved' || type==='comic_approved') return '✓';
    if(type==='artwork_rejected' || type==='comic_rejected') return '✕';
    return '🔔';
  }

  /* Lightweight "2h ago" style relative time, falls back to a
     plain date once it's more than a week old. */
  function notifRelTime(iso){
    var d = new Date(iso), diff = Math.max(0, (Date.now()-d.getTime())/1000);
    if(diff < 60) return 'Just now';
    if(diff < 3600) return Math.floor(diff/60)+'m ago';
    if(diff < 86400) return Math.floor(diff/3600)+'h ago';
    if(diff < 604800) return Math.floor(diff/86400)+'d ago';
    return d.toLocaleDateString();
  }

  async function notifLoad(){
    if(!sb){ notifList=[]; notifRender(); return; }
    try{
      const{data,error} = await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(60);
      if(error) throw error;
      notifList = data||[];
      if(currentUser){
        const{data:reads,error:re} = await sb.from('notification_reads').select('notification_id').eq('user_id',currentUser.id);
        if(re) throw re;
        notifReadIds = {};
        (reads||[]).forEach(function(r){ notifReadIds[r.notification_id]=true; });
      } else {
        notifReadIds = {};
      }
    }catch(e){ console.error('Error loading notifications: '+e.message); notifList=[]; }
    notifRender();
    notifMarkAllVisibleRead();
  }

  function notifRender(){
    var wrap = document.getElementById('notifList'), empty = document.getElementById('notifEmpty');
    if(!wrap) return;
    if(!notifList.length){ wrap.innerHTML=''; if(empty) empty.style.display='block'; return; }
    if(empty) empty.style.display='none';
    wrap.innerHTML = notifList.map(function(n){
      var unread = !!currentUser && !notifReadIds[n.id];
      return '<div class="notifItem'+(unread?' unread':'')+'">'+
        '<div class="notifIcoWrap ico-'+esc(n.type||'admin')+'">'+notifIcon(n.type)+'</div>'+
        '<div class="notifBody">'+
          '<div class="notifTitle">'+esc(n.title)+'</div>'+
          '<div class="notifMsg">'+esc(n.message)+'</div>'+
          '<div class="notifTime">'+(n.created_at?notifRelTime(n.created_at):'')+'</div>'+
        '</div>'+
        (unread?'<span class="notifDot" aria-hidden="true"></span>':'')+
      '</div>';
    }).join('');
  }

  /* Marks every currently-loaded notification as read for the
     signed-in user. Writes only to notification_reads — never
     touches the notifications rows themselves. */
  async function notifMarkAllVisibleRead(){
    if(!sb || !currentUser){ notifRefreshBadge(); return; }
    var unread = notifList.filter(function(n){ return !notifReadIds[n.id]; });
    if(!unread.length){ notifRefreshBadge(); return; }
    try{
      var rows = unread.map(function(n){ return {user_id:currentUser.id, notification_id:n.id}; });
      const{error} = await sb.from('notification_reads').upsert(rows, {onConflict:'user_id,notification_id'});
      if(error) throw error;
      unread.forEach(function(n){ notifReadIds[n.id]=true; });
      notifRender();
    }catch(e){ /* non-critical — badge just stays on until next successful load */ }
    notifRefreshBadge();
  }

  /* Bell unread-dot (.hasUnread → .hNotifDot, already in the CSS).
     Guests have no read-state to compare against, so the dot only
     ever lights up for signed-in users. */
  async function notifRefreshBadge(){
    var btn = document.getElementById('hNotifBtn');
    if(!btn) return;
    if(!sb || !currentUser){ btn.classList.remove('hasUnread'); return; }
    try{
      const{data:all,error:e1} = await sb.from('notifications').select('id').limit(200);
      if(e1) throw e1;
      const{data:reads,error:e2} = await sb.from('notification_reads').select('notification_id').eq('user_id',currentUser.id);
      if(e2) throw e2;
      var readSet = {}; (reads||[]).forEach(function(r){ readSet[r.notification_id]=true; });
      var hasUnread = (all||[]).some(function(n){ return !readSet[n.id]; });
      btn.classList.toggle('hasUnread', hasUnread);
    }catch(e){ /* silent — badge just won't update this cycle */ }
  }

  /* ── Admin broadcast composer (inside #admPanelNoti) ── */
  async function admSendBroadcast(){
    if(!isDev) return;
    var titleEl = document.getElementById('admNotiTitle'), msgEl = document.getElementById('admNotiMsg');
    var title = (titleEl.value||'').trim(), msg = (msgEl.value||'').trim();
    if(!title || !msg){ showToast('Enter a title and message'); return; }
    var btn = document.getElementById('admNotiSendBtn');
    if(btn) btn.disabled = true;
    try{
      const{error} = await sb.from('notifications').insert({user_id:null, type:'admin', title:title, message:msg});
      if(error) throw error;
      titleEl.value=''; msgEl.value='';
      showToast('Notification sent to all users ✦');
      admLoadNotifSent();
    }catch(e){ console.error('Error: '+e.message); }
    if(btn) btn.disabled = false;
  }

  async function admLoadNotifSent(){
    var wrap = document.getElementById('admNotiSentList'), empty = document.getElementById('admNotiEmpty');
    if(!sb || !wrap) return;
    try{
      const{data,error} = await sb.from('notifications').select('*').is('user_id',null).order('created_at',{ascending:false}).limit(20);
      if(error) throw error;
      var rows = data||[];
      wrap.innerHTML = rows.map(function(r){
        return '<div class="admNotiSentItem">'+
          '<div class="admNotiSentTitle">'+esc(r.title)+'</div>'+
          '<div class="admNotiSentMsg">'+esc(r.message)+'</div>'+
          '<div class="admNotiSentTime">'+(r.created_at?new Date(r.created_at).toLocaleString():'')+'</div>'+
        '</div>';
      }).join('');
      if(empty) empty.style.display = rows.length ? 'none' : 'block';
    }catch(e){ console.error('Error loading sent notifications: '+e.message); }
  }

/* Admin upload/edit/delete removed — uploading is one universal
     flow for every signed-in user (nav ➕ → #pfUpMod), and artwork
     can only ever be edited/deleted by its owner (#pfMyWorkPage,
     enforced by "own rows only" RLS on the DB side). */

