// login, signup, notifications

  // state
  var currentUser = null; // null when logged out
  var currentUserAvatarUrl = null; // user photo, kept in sync
  var authMode = 'login'; // login or signup

  // avatar helpers

  // paint one avatar chip
  function paintAvatarChip(imgId, txtId, url, letter){
    var img = document.getElementById(imgId);
    var txt = document.getElementById(txtId);
    if(!img || !txt) return;
    if(url){
      // use small resized image
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

  // sync navbar button
  function syncAuthBtn() {
    var loginBtn  = document.getElementById('navLoginBtn');
    var avatarBtn = document.getElementById('navAvatarBtn');

    if (currentUser) {
      // logged in
      var letter = cpGetAvatarLetter(); // reuse existing helper
      paintAvatarChip('navAvatarImg', 'navAvatarLetter', currentUserAvatarUrl, letter);
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (avatarBtn) {
        avatarBtn.style.display = 'flex';
        avatarBtn.title = 'Profile — ' + cpGetDisplayName();
      }
    } else {
      // logged out
      if (loginBtn)  loginBtn.style.display  = '';
      if (avatarBtn) avatarBtn.style.display  = 'none';
    }

    // sync card and comment bar
    syncSubOverviewCard();
    // cpSyncAvatar is in js/mywork.js, seven script tags below this file, and
    // the first auth event fires before that one is parsed. The chip it
    // paints is on the community composer, which cpOpenChannel paints again
    // when the bar is actually on screen — so there is nothing to catch up on
    // here, only a throw to not do.
    if (typeof cpSyncAvatar === 'function') cpSyncAvatar();
  }

  // sync subscription card
  function syncSubOverviewCard() {
    var avatarEl   = document.getElementById('subOvAvatarLetter');
    var nameEl     = document.getElementById('subOvUsernameLabel');
    var badgeEl    = document.getElementById('subOvBadge');
    var profileCard = document.getElementById('subOvProfileCard');
    if (!avatarEl || !nameEl || !badgeEl) return;

    // set tier border class
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
      // guest gets default border
    }

    if (currentUser) {
      var letter = cpGetAvatarLetter();
      var name   = cpGetDisplayName();
      paintAvatarChip('subOvAvatarImg', 'subOvAvatarTxt', currentUserAvatarUrl, letter);
      nameEl.textContent   = name;

      // badge label and tier
      var plan   = (typeof userPlan === 'string') ? userPlan : 'guest';
      // dev tier
      if (typeof isDev !== 'undefined' && isDev) plan = 'dev';
      var labels = { guest:'FREE', lite:'LITE', premium:'PREMIUM', max:'MAX', dev:'DEV' };
      var label  = labels[plan] || 'FREE';
      badgeEl.textContent = label;

      // badge class
      badgeEl.className = 'subOvPlanBadge subOvPlanBadge--' + (labels[plan] ? plan : 'guest');
      // card border
      setProfileTier(plan);
    } else {
      // logged out, reset
      paintAvatarChip('subOvAvatarImg', 'subOvAvatarTxt', null, '?');
      nameEl.textContent   = 'Profile';
      badgeEl.textContent  = 'FREE';
      badgeEl.className    = 'subOvPlanBadge subOvPlanBadge--guest';
      setProfileTier('guest');
    }
  }

  // settings page

  var setLastFocus = null;
  var setBackMo = null;      // watches the sub-page Settings handed off to

  function openSettingsPage() {
    var pg = document.getElementById('setPage');
    if (!pg) return;
    setDropBack();
    // coming back from a sub-page, the menu still holds the button that
    // opened it — what has focus now is a control on the page just closed
    if (!setLastFocus || setLastFocus.isConnected === false) setLastFocus = document.activeElement;
    pg.classList.add('open');
    document.body.style.overflow = 'hidden';
    pfMenuRefreshCounts(); // fire and forget
  }

  // keepBack is for setGo, which closes the menu only to put a page of its
  // own in front of it. Every other caller — the back arrow, Escape, logging
  // out — means the menu is done, and takes the pending return with it.
  function closeSettingsPage(keepBack) {
    var pg = document.getElementById('setPage');
    if (pg) pg.classList.remove('open');
    restoreScroll();
    // handing off to a sub-page: the menu is coming back, so it keeps both
    // the pending return and the button to hand focus to when it really goes
    if (keepBack === true) return;
    setDropBack();
    if (setLastFocus && setLastFocus.focus) { try { setLastFocus.focus(); } catch (e) {} }
    setLastFocus = null;
  }

  // Settings is a menu, and the page each item opens is a step further in,
  // not a step sideways: closing it belongs back at the menu. The items used
  // to just close Settings outright, so the back arrow on any sub-page
  // dropped you onto the profile and the menu had to be opened again for the
  // next item.
  function setGo(open, id) {
    closeSettingsPage(true);
    if (typeof open === 'function') open();
    setWatchBack(id);
  }

  function setWatchBack(id) {
    setDropBack();
    var el = id && document.getElementById(id);
    if (!el || !el.classList.contains('open')) {
      // nothing opened — a signed-out tap answers with a toast and stays
      // where it is. The menu goes straight back rather than leaving you on
      // the profile, and in the same frame, so it never appears to move.
      openSettingsPage();
      return;
    }
    if (!window.MutationObserver) return;
    setBackMo = new MutationObserver(function () {
      if (el.classList.contains('open')) return;
      setDropBack();
      // the menu sits over the profile; if that has gone too, the page was
      // left by some other route and Settings has no business reappearing
      var prof = document.getElementById('profilePage');
      if (prof && prof.classList.contains('open')) openSettingsPage();
    });
    setBackMo.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  function setDropBack() {
    if (setBackMo) { setBackMo.disconnect(); setBackMo = null; }
  }

  // likes, bookmarks, friends counts
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

  // logout
  //
  // The Log Out row asks before it acts. Signing out is one tap from the
  // bottom of a list people scroll through for everything else, and it used
  // to happen on that tap alone, with no way back except signing in again.
  var loLastFocus = null;

  function pfMenuLogout() {
    var m = document.getElementById('loConfirm');
    // no dialog in the page — sign out rather than leave the row dead
    if (!m) { doLogout(); return; }
    loLastFocus = document.activeElement;
    m.classList.add('open');
    // Cancel takes focus, not the button that signs you out
    var no = document.getElementById('loConfirmNo');
    if (no) { try { no.focus(); } catch (e) {} }
  }

  function closeLogoutConfirm() {
    var m = document.getElementById('loConfirm');
    if (m) m.classList.remove('open');
    if (loLastFocus && loLastFocus.focus && loLastFocus.isConnected !== false) {
      try { loLastFocus.focus(); } catch (e) {}
    }
    loLastFocus = null;
  }

  function confirmLogout() {
    closeLogoutConfirm();
    doLogout();
  }

  function doLogout() {
    closeSettingsPage();
    if (sb) {
      sb.auth.signOut()
        .then(function(){ showToast('Signed out'); })
        .catch(function(e){ console.error('Error: ' + e.message); });
    }
  }

  // Escape and a tap on the backdrop both mean cancel — the same two ways
  // out every other sheet on the site answers to
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var m = document.getElementById('loConfirm');
    if (m && m.classList.contains('open')) { e.stopPropagation(); closeLogoutConfirm(); }
  }, true);

  document.addEventListener('click', function (e) {
    var m = document.getElementById('loConfirm');
    if (m && m.classList.contains('open') && e.target === m) closeLogoutConfirm();
  });

  // Where the address bar was when the sign-in sheet took it over. Null when
  // the page was opened at /login and there is nothing behind it.
  var authReturnUrl = null;
  window.addEventListener('popstate', function(){ authReturnUrl = null; });

  function openAuthMod() {
    document.getElementById('authUser').value  = '';
    document.getElementById('authEmail').value = '';
    document.getElementById('authPass').value  = '';
    var err = document.getElementById('authErr');
    err.textContent = ''; err.classList.remove('show');
    var msg = document.getElementById('authMsg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
    // always open in login mode
    switchAuthMode('login');
    document.getElementById('authMod').classList.add('open');
    document.body.style.overflow = 'hidden';
    if (window.location.pathname !== '/login') {
      // where to put the address bar back when this closes
      authReturnUrl = window.location.pathname + window.location.search;
      try{ history.pushState({},'', '/login'); }catch(e){}
    }
    // focus first field
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
    /* REPLACE, do not push, and go back to where the sheet was opened from.
       Two bugs in one line before: pushing meant an open-and-close left two
       entries behind and Back re-opened the sheet, and '/' was hard-coded —
       so tapping a sign-in gate while reading /artwork/<id> and then
       dismissing the sheet rewrote the address to the home page while the
       artwork was still on screen behind it. Sharing or refreshing at that
       point lost the artwork. */
    if (revertUrl !== false && window.location.pathname === '/login') {
      try{ history.replaceState({},'', authReturnUrl || '/'); }catch(e){}
      authReturnUrl = null;
    }
  }

  // login
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
      // auth listener closes the modal
    } catch (e) {
      err.textContent = e.message || 'Login failed. Check your credentials.';
      err.classList.add('show');
    } finally {
      btn.textContent = 'Log In'; btn.disabled = false;
    }
  }

  // oauth sign in
  var OAUTH_LABELS = { google:'Google', discord:'Discord', apple:'Apple' };

  // apple unavailable notice
  function showAppleUnavailable(){
    if (document.getElementById('appleNaDlg')) return;
    var ov = document.createElement('div');
    ov.id = 'appleNaDlg';
    ov.setAttribute('role','dialog');
    ov.setAttribute('aria-modal','true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;display:flex;'
      + 'align-items:center;justify-content:center;padding:1.5rem;'
      + 'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);'
      + '-webkit-backdrop-filter:blur(4px);';
    var box = document.createElement('div');
    box.style.cssText = 'max-width:340px;width:100%;'
      + 'background:var(--sur,#16161c);color:var(--tx,#fff);'
      + 'border:1px solid var(--bdr,#2c2c36);border-radius:16px;'
      + 'padding:1.4rem 1.3rem 1.15rem;box-shadow:0 20px 60px rgba(0,0,0,.5);'
      + 'font-family:var(--fb,sans-serif);text-align:center;';
    box.innerHTML =
      '<div style="font-size:.96rem;line-height:1.5;margin-bottom:1.15rem;">'
      + 'Apple sign-in isn\u2019t available at the moment. You can still '
      + 'continue with Google or Discord.</div>'
      + '<button type="button" id="appleNaOk" style="border:0;cursor:pointer;'
      + 'background:var(--pg,#8B5CF6);color:var(--text-on-accent,#fff);'
      + 'font-family:var(--fm,inherit);font-weight:700;letter-spacing:.06em;'
      + 'padding:.62rem 1.7rem;border-radius:10px;font-size:.85rem;">OK</button>';
    ov.appendChild(box);
    function close(){ if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.addEventListener('click', function(e){ if (e.target === ov) close(); });
    document.body.appendChild(ov);
    var ok = document.getElementById('appleNaOk');
    if (ok){ ok.addEventListener('click', close); ok.focus(); }
  }

  async function doOAuth(provider, btnEl) {
    // apple not wired up
    if (provider === 'apple') { showAppleUnavailable(); return; }
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }
    var label = OAUTH_LABELS[provider] || provider;
    var err = document.getElementById('authErr');
    err.textContent = ''; err.classList.remove('show');

    // lock the social row
    var row = document.querySelector('.laSocial');
    var btns = row ? row.querySelectorAll('.laSocialBtn') : [];
    Array.prototype.forEach.call(btns, function(b){ b.disabled = true; });

    try {
      var opts = { redirectTo: window.location.origin };
      // let google pick account
      if (provider === 'google') opts.queryParams = { prompt: 'select_account' };

      var result = await sb.auth.signInWithOAuth({ provider: provider, options: opts });
      if (result.error) throw result.error;
      // navigating to provider
    } catch (e) {
      Array.prototype.forEach.call(btns, function(b){ b.disabled = false; });
      var raw = (e && e.message || '').toLowerCase();
      if (raw.includes('provider is not enabled') || raw.includes('unsupported provider')) {
        // plain user facing error
        err.textContent = label + ' sign-in isn\u2019t available right now. Try another method.';
      } else {
        err.textContent = (e && e.message) ? (label + ' sign-in failed: ' + e.message)
                                           : (label + ' sign-in is unavailable right now.');
      }
      err.classList.add('show');
    }
  }

  // toggle login and signup
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

    // reset error state
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
      // show username on signup
      if (userWrap) userWrap.style.display = '';
      passField.setAttribute('autocomplete', 'new-password');
      // focus username
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
      // hide username on login
      if (userWrap) userWrap.style.display = 'none';
      passField.setAttribute('autocomplete', 'current-password');
    }
  }

  // password visibility toggle
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

  // signup
  async function doSignUp() {
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }

    var email    = document.getElementById('authEmail').value.trim();
    var pass     = document.getElementById('authPass').value;
    var username = (document.getElementById('authUser').value || '').trim();
    var err      = document.getElementById('authErr');
    var msg      = document.getElementById('authMsg');

    err.textContent = ''; err.classList.remove('show');
    msg.style.display = 'none'; msg.textContent = '';

    // validate username
    if (!username) {
      err.textContent = 'Please enter a username.';
      err.classList.add('show'); return;
    }

    // validate email
    if (!email) {
      err.textContent = 'Please enter your email address.';
      err.classList.add('show'); return;
    }
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email)) {
      err.textContent = 'Please enter a valid email address.';
      err.classList.add('show'); return;
    }

    // validate password
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
        // email confirm off, signed in
        showToast('Account created. Welcome!');
        // modal closes on auth change
      } else {
        // email confirm on, show notice
        document.getElementById('authEmail').value = '';
        document.getElementById('authPass').value  = '';
        msg.textContent = 'Check your email to confirm your account.';
        msg.style.display = 'block';
        btn.textContent = 'Create Account'; btn.disabled = false;
        // auto close after 5s
        setTimeout(function(){
          if (document.getElementById('authMod').classList.contains('open')) {
            closeAuthMod();
          }
        }, 5000);
        return; // keep modal open
      }
    } catch (e) {
      // friendly error copy
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
      // reset button text
      if (btn.disabled) {
        btn.textContent = 'Create Account'; btn.disabled = false;
      }
    }
  }

  // role check
  //
  // isDev is 'dev' and nothing else, and it stays that way. Five other files
  // read it — js/badwords.js waves a dev past the word filter, js/mywork.js
  // lets one post in a read-only channel, js/sections.js and js/upqueue.js
  // show one the moderation code behind a refusal — and every one of those is
  // a developer's privilege rather than a moderator's. Widening it to include
  // the partners would have handed all of that to an account type that is
  // meant to have reports and bans and nothing else.
  //
  // So the two questions this feature actually asks get their own answers.
  // userRole is the raw column; the two helpers below are what the admin panel
  // and the nav entry read.
  let isDev = false;
  let userRole = null;
  // user plan
  let userPlan = null;
  // What the admin panel and its nav entry ask. Two names for two different
  // powers, so no caller has to remember which roles are which.
  //
  // Neither is an authority. Both exist to decide what to DRAW — every action
  // behind them is refused again in Postgres by dz_is_staff() and
  // dz_may_moderate(), which are the copies that count. A member who edits
  // these in a console gets a panel with buttons that all answer 403.
  function dzIsStaff(){ return userRole === 'admin' || userRole === 'dev'; }
  function dzIsPartner(){ return userRole === 'partner'; }
  window.dzIsStaff = dzIsStaff;
  window.dzIsPartner = dzIsPartner;

  async function checkUserRole(){
    if(!sb || !currentUser){
      isDev=false; userRole=null; userPlan=null; currentUserAvatarUrl=null;
      dzSetPlan('guest', null); dzPaintLimits();
      if(typeof dzPaintAds === 'function') dzPaintAds();
      syncAdmBtn(); return;
    }
    try{
      const{data,error}=await sb.from('profiles')
        .select('role,subscription_tier,subscription_expires_at,avatar_url')
        .eq('id',currentUser.id).single();
      if(error) throw error;
      isDev    = !!data && data.role==='dev';
      userRole = (data && data.role) || null;
      userPlan = (data && data.subscription_tier) ? data.subscription_tier : 'guest';
      currentUserAvatarUrl = (data && data.avatar_url) ? data.avatar_url : null;
      // The expiry comes back with the tier now and goes to the one helper
      // that answers "what is this member allowed". The column on its own
      // still says 'max' the morning after a subscription lapses; the server
      // has always read dz_effective_tier() instead, and dzTier() is that
      // same rule on this side of the wire. A dev is given Max's ceilings
      // rather than their stored tier, which is usually none.
      dzSetPlan(isDev ? 'dev' : userPlan,
                (data && data.subscription_expires_at) || null);
      dzPaintLimits();
      if(typeof dzPaintAds === 'function') dzPaintAds();
    }catch(e){
      console.error(e);
      // The avatar goes with the rest of it. It used to be left alone here,
      // so a failed read — no profile row yet on a fresh signup, or simply
      // offline — kept the PREVIOUS account's photo on the nav chip and the
      // subscription card beside the new member's name. Nothing had leaked,
      // but on a shared device that is indistinguishable from something that
      // had. A letter is the honest fallback.
      isDev=false; userRole=null; userPlan='guest'; currentUserAvatarUrl=null;
      dzSetPlan('guest', null); dzPaintLimits();
      if(typeof dzPaintAds === 'function') dzPaintAds();
    }
    syncAdmBtn();
    syncAuthBtn(); // repaint avatar chips
    notifRefreshBadge();
    // queued upload after login
    if(currentUser && sessionStorage.getItem('pendPfUp')==='1'){
      sessionStorage.removeItem('pendPfUp');
      // open upload as a page
      setTimeout(function(){
        if(typeof bnCloseAllSections==='function') bnCloseAllSections();
        openPfUpload();
        if(typeof bnSetActive==='function') bnSetActive('bnUpload');
      },250);
    }
  }

  // WHICH AUTH EVENTS ACTUALLY CHANGE WHO IS SIGNED IN.
  //
  // supabase-js fires this handler for TOKEN_REFRESHED as well — every fifty
  // minutes or so, for as long as a tab stays open — and for INITIAL_SESSION on
  // load. Neither changes the member. Everything below used to run on all of
  // them, so an ordinary token renewal deleted every private record in
  // IndexedDB, threw away the marketplace tab, re-sorted and repainted the
  // gallery under whatever the reader was looking at, and blanked every like
  // and bookmark heart for the length of a round trip. It also put a burst of
  // Supabase traffic on the wire once an hour per open tab, which is precisely
  // what js/cache.js exists to avoid.
  //
  // The id is what decides, not the event name: a session object arrives on a
  // refresh too, and comparing the member is the question actually being asked.
  // A signed-out tab is 'guest' rather than null so the first event on a page
  // opened signed-out is not mistaken for a change.
  var dzLastAuthId = (function(){
    try { return currentUser && currentUser.id ? String(currentUser.id) : 'guest'; }
    catch (e) { return 'guest'; }
  })();

  if (sb) {
    sb.auth.onAuthStateChange(function(event, session) {
      currentUser = session ? session.user : null;
      var nowId = currentUser && currentUser.id ? String(currentUser.id) : 'guest';
      var switched = nowId !== dzLastAuthId;
      dzLastAuthId = nowId;

      // Who the session belongs to, and what has to be forgotten because of
      // it, is settled before anything is drawn. This used to run after
      // syncAuthBtn(), which reaches into a file loaded further down the page
      // and threw on the first event every time — taking the scope bump, all
      // the cache wipes, the hidden-artwork list and the tag preferences down
      // with it, because they were all sitting behind it in the same handler.
      // Painting is allowed to fail. Deciding whose data this is, is not.

      // ALL OF THIS IS GATED ON THE MEMBER ACTUALLY CHANGING. On a token
      // refresh it is not just unnecessary, it is destructive: it throws away
      // a cache that is still correct and repaints the page under the reader.
      if (switched) {
        // Every stamp taken before this line was taken for the account that
        // just went away. Bumping first means anything still in flight is
        // already stale by the time it lands, whichever order it lands in.
        dzScopeBump();
        // wipe caches on auth change
        pfRowCache = {}; cmMineRows = []; cpMsgCache = {}; cmMineCache = {};
        // Likes, Bookmarks, albums and the profile media cache are one
        // member's. They are not carried across a sign-in.
        try{ albResetMine(); }catch(e){}
        // the read/unread marks belong to whoever was signed in
        notifList = []; notifReadIds = {};
        /* And everything the cache service wrote down for them. Every private
           record is stamped with a member id and would be refused for the next
           session anyway, but "would be refused" is not the same as "is not
           there": their conversations, friends, bookmarks, settings and
           analytics come off this device now rather than sitting in IndexedDB
           waiting for a bug to hand them over. Public records — the gallery,
           the section tabs — stay, because they are the same for everybody and
           the next visit is faster for having them. */
        try{ if(window.dzCache) window.dzCache.dropPrivate(); }catch(e){}
        try{
          pf.albums = []; pf.albumsLoaded = false;
          pf.galleryRows = []; pf.galleryIds = Object.create(null);
          pf.galleryOffset = 0; pf.galleryDone = false;
          pfMediaCache = {};
        }catch(e){}
        // Now the painting. Every one of these reaches into a file that loads
        // after this one, so each is on its own: one that fails takes nothing
        // else with it.
        try{ syncAuthBtn(); }catch(e){ console.error('syncAuthBtn: '+(e.message||e)); }
        // repaint ranking boards
        try{ if (typeof window.rkRefresh === 'function') window.rkRefresh(); }catch(e){}
        // reload hide list
        try{
          loadHiddenArtworks().then(function(){
            try{ renderHome(); }catch(e){}
            try{ renderFG(); }catch(e){}
          }, function(){ /* offline, keep what is on screen */ });
        }catch(e){ console.error('loadHiddenArtworks: '+(e.message||e)); }
        // reload tag preferences
        try{ if(typeof tgLoad === 'function') tgLoad(true); }catch(e){}
      }

      // Outside the gate on purpose: signing in as the account already signed
      // in is not a change of member, but the sheet still has to close and the
      // greeting still belongs to the act of signing in.
      if (event === 'SIGNED_IN') {
        closeAuthMod();
        checkUserRole();
        // greet by username
        var greetName = (currentUser && currentUser.user_metadata && currentUser.user_metadata.username)
          ? currentUser.user_metadata.username
          : '';
        afterIntro(function(){
          setTimeout(function(){
            showToast(greetName ? ('Welcome, ' + greetName) : 'Signed in');
          }, 460);
        });
      }
      if (event === 'SIGNED_OUT') {
        currentUserAvatarUrl = null;
        syncAuthBtn();
        isDev=false; userRole=null; userPlan=null; syncAdmBtn();
        dzSetPlan('guest', null); dzPaintLimits();
        if(typeof dzPaintAds === 'function') dzPaintAds();
        syncSubOverviewCard(); // reset card to guest
        notifRefreshBadge(); // clear unread dot
        // close owner only pages
        closeProfilePage();
        closeMyWorkPage();
        // The admin panel is loaded per account; on sign-out it gives up its
        // shell and its menu entry rather than merely closing, so the next
        // account cannot inherit either. Guarded because a member who was
        // never entitled to it never loaded the module that defines this.
        if(typeof dzOpsReset === 'function') dzOpsReset();
      }
    });


    // restore session on load
    sb.auth.getSession().then(function(res) {
      if (res.data && res.data.session) {
        currentUser = res.data.session.user;
        syncAuthBtn();
        checkUserRole();
      }
    });
  }


  // notifications
  var notifList = [];       // loaded rows, newest first
  var notifReadIds = {};    // read state per user

  function openNotifications(){
    var el = document.getElementById('notifPage');
    if(!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    notifLoad();
  }

  function closeNotifPage(){
    var el = document.getElementById('notifPage');
    if(!el) return;
    el.classList.remove('open');
    restoreScroll();
  }

  function notifIcon(type){
    if(type==='artwork_approved' || type==='comic_approved') return '✓';
    if(type==='artwork_rejected' || type==='comic_rejected') return '✕';
    return '🔔';
  }

  // relative time
  function notifRelTime(iso){
    var d = new Date(iso), diff = Math.max(0, (Date.now()-d.getTime())/1000);
    if(diff < 60) return 'Just now';
    if(diff < 3600) return Math.floor(diff/60)+'m ago';
    if(diff < 86400) return Math.floor(diff/3600)+'h ago';
    if(diff < 604800) return Math.floor(diff/86400)+'d ago';
    return d.toLocaleDateString();
  }

  /* The list and the unread dot have to ask about the same notifications.
     The list read the newest 60 and marked exactly those read; the dot read
     200 and lit if any of them was unread — so on an account with more than
     sixty, rows 61 to 200 could never be marked and the dot came back on every
     repaint, with nothing the member could do about it. One number, used by
     both. */
  var NOTIF_WINDOW = 60;

  async function notifLoad(){
    if(!sb){ notifList=[]; notifRender(); return; }
    try{
      const{data,error} = await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(NOTIF_WINDOW);
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
    }catch(e){
      console.error('Error loading notifications: '+e.message);
      // no list and no read marks, rather than the last member's read marks
      notifList=[]; notifReadIds={};
    }
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

  // mark visible as read
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
    }catch(e){ /* non critical */ }
    notifRefreshBadge();
  }

  // unread dot — the home screen bell and the one in the profile bar carry
  // the same mark, so it cannot say unread in one place and read in the other
  function notifPaintBadges(on){
    ['hNotifBtn','pfTopNotifBtn'].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.classList.toggle('hasUnread', !!on);
    });
  }
  async function notifRefreshBadge(){
    var btn = document.getElementById('hNotifBtn');
    if(!btn) return;
    if(!sb || !currentUser){ notifPaintBadges(false); return; }
    try{
      // Same window, and the same order, as notifLoad — the dot must be
      // asking about the notifications opening the page can actually clear.
      const{data:all,error:e1} = await sb.from('notifications').select('id')
        .order('created_at',{ascending:false}).limit(NOTIF_WINDOW);
      if(e1) throw e1;
      const{data:reads,error:e2} = await sb.from('notification_reads').select('notification_id').eq('user_id',currentUser.id);
      if(e2) throw e2;
      var readSet = {}; (reads||[]).forEach(function(r){ readSet[r.notification_id]=true; });
      var hasUnread = (all||[]).some(function(n){ return !readSet[n.id]; });
      notifPaintBadges(hasUnread);
    }catch(e){ /* silent failure */ }
  }

  // The broadcast composer and the list of what has been sent used to be here.
  // Both are part of the admin panel, so both moved with it into the module
  // /api/ops serves — see the note in js/gallery.js. Nothing in this file
  // names them any more.

// admin upload removed

