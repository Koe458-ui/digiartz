  var currentUser = null;
  var currentUserAvatarUrl = null;
  var authMode = 'login';

  function paintAvatarChip(imgId, txtId, url, letter){
    var img = document.getElementById(imgId);
    var txt = document.getElementById(txtId);
    if(!img || !txt) return;
    if(url){
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

  function syncAuthBtn() {
    var bar  = document.getElementById('dzTopAccount');
    var menu = document.getElementById('dzMenuAccount');
    var barTxt  = document.getElementById('dzTopAccountTxt')  || bar;
    var menuTxt = document.getElementById('dzMenuAccountTxt') || menu;

    var wrap = document.getElementById('dzAcWrap');
    var grp  = document.getElementById('dzMenuAcGrp');
    if (wrap) wrap.classList.toggle('dzHasMenu', !!currentUser);
    if (grp)  grp.classList.toggle('dzHasMenu', !!currentUser);
    if (!currentUser) {
      if (typeof window.dzAcClose === 'function') window.dzAcClose();
      if (grp) grp.classList.remove('open');
      if (bar)  bar.setAttribute('aria-expanded', 'false');
      if (menu) menu.setAttribute('aria-expanded', 'false');
    }

    if (currentUser) {
      var name = typeof cpGetDisplayName === 'function' ? cpGetDisplayName() : '';
      var href = name && name !== 'User' ? '/profile/' + encodeURIComponent(name) : '/login';
      if (bar) {
        bar.title = 'Profile — ' + (name || 'you');
        bar.setAttribute('href', href);
      }
      if (barTxt) barTxt.textContent = 'Profile';
      if (menu) {
        menu.title = 'Profile — ' + (name || 'you');
        menu.setAttribute('href', href);
      }
      if (menuTxt) menuTxt.textContent = 'Profile';
    } else {
      if (bar)  { bar.removeAttribute('title');  bar.setAttribute('href', '/login'); }
      if (menu) { menu.removeAttribute('title'); menu.setAttribute('href', '/login'); }
      if (barTxt)  barTxt.textContent  = 'Sign in';
      if (menuTxt) menuTxt.textContent = 'Login';
    }

    syncSubOverviewCard();
    if (typeof cpSyncAvatar === 'function') cpSyncAvatar();
  }

  function syncSubOverviewCard() {
    var avatarEl   = document.getElementById('subOvAvatarLetter');
    var nameEl     = document.getElementById('subOvUsernameLabel');
    var badgeEl    = document.getElementById('subOvBadge');
    var profileCard = document.getElementById('subOvProfileCard');
    if (!avatarEl || !nameEl || !badgeEl) return;

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
    }

    if (currentUser) {
      var letter = cpGetAvatarLetter();
      var name   = cpGetDisplayName();
      paintAvatarChip('subOvAvatarImg', 'subOvAvatarTxt', currentUserAvatarUrl, letter);
      nameEl.textContent   = name;

      var plan   = (typeof userPlan === 'string') ? userPlan : 'guest';
      if (typeof isDev !== 'undefined' && isDev) plan = 'dev';
      var labels = { guest:'FREE', lite:'LITE', premium:'PREMIUM', max:'MAX', dev:'DEV' };
      var label  = labels[plan] || 'FREE';
      badgeEl.textContent = label;

      badgeEl.className = 'subOvPlanBadge subOvPlanBadge--' + (labels[plan] ? plan : 'guest');
      setProfileTier(plan);
    } else {
      paintAvatarChip('subOvAvatarImg', 'subOvAvatarTxt', null, '?');
      nameEl.textContent   = 'Profile';
      badgeEl.textContent  = 'FREE';
      badgeEl.className    = 'subOvPlanBadge subOvPlanBadge--guest';
      setProfileTier('guest');
    }
  }

  var setLastFocus = null;
  var setBackMo = null;

  function openSettingsPage() {
    var pg = document.getElementById('setPage');
    if (!pg) return;
    setDropBack();
    if (!setLastFocus || setLastFocus.isConnected === false) setLastFocus = document.activeElement;
    pg.classList.add('open');
    document.body.style.overflow = 'hidden';
    pfMenuRefreshCounts();
  }

  function closeSettingsPage(keepBack) {
    var pg = document.getElementById('setPage');
    if (pg) pg.classList.remove('open');
    restoreScroll();
    if (keepBack === true) return;
    setDropBack();
    if (setLastFocus && setLastFocus.focus) { try { setLastFocus.focus(); } catch (e) {} }
    setLastFocus = null;
  }

  function setGo(open, id) {
    closeSettingsPage(true);
    if (typeof open === 'function') open();
    setWatchBack(id);
  }

  function setWatchBack(id) {
    setDropBack();
    var el = id && document.getElementById(id);
    if (!el || !el.classList.contains('open')) {
      openSettingsPage();
      return;
    }
    if (!window.MutationObserver) return;
    setBackMo = new MutationObserver(function () {
      if (el.classList.contains('open')) return;
      setDropBack();
      var prof = document.getElementById('profilePage');
      if (prof && prof.classList.contains('open')) openSettingsPage();
    });
    setBackMo.observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  function setDropBack() {
    if (setBackMo) { setBackMo.disconnect(); setBackMo = null; }
  }
  window.dzSetDropBack = setDropBack;

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

  var loLastFocus = null;

  function pfMenuLogout() {
    var m = document.getElementById('loConfirm');
    if (!m) { doLogout(); return; }
    loLastFocus = document.activeElement;
    m.classList.add('open');
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
      if (window.dzCaptcha) window.dzCaptcha.note('logout', null, true);
      sb.auth.signOut()
        .then(function(){ showToast('Signed out'); })
        .catch(function(e){ console.error('Error: ' + e.message); });
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var m = document.getElementById('loConfirm');
    if (m && m.classList.contains('open')) { e.stopPropagation(); closeLogoutConfirm(); }
  }, true);

  document.addEventListener('click', function (e) {
    var m = document.getElementById('loConfirm');
    if (m && m.classList.contains('open') && e.target === m) closeLogoutConfirm();
  });

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
    switchAuthMode('login');
    document.getElementById('authMod').classList.add('open');
    document.body.style.overflow = 'hidden';
    if (window.location.pathname !== '/login') {
      authReturnUrl = window.location.pathname + window.location.search;
      try{ history.pushState({},'', '/login'); }catch(e){}
    }
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
      try{ history.replaceState({},'', authReturnUrl || '/'); }catch(e){}
      authReturnUrl = null;
    }
  }

  function dzAuthErr(e, fallback) {
    var raw = ((e && e.message) || '').toLowerCase();
    if (raw.indexOf('captcha') !== -1) {
      var configured = !!(window.dzCaptcha && window.dzCaptcha.configured());
      if (!configured) {
        console.warn(
          '[DigiArtz] Sign-in was refused for a missing captcha token, and no ' +
          'TURNSTILE_SITE_KEY is present in config.js. CAPTCHA protection is ' +
          'enabled in Supabase but the page cannot satisfy it, so sign-in and ' +
          'sign-up are broken for everyone. Either set TURNSTILE_SITE_KEY (and ' +
          'emit it from the Pages build command), or turn CAPTCHA protection ' +
          'off in Supabase \u2192 Authentication \u2192 Attack Protection. ' +
          'See security/CAPTCHA-SETUP.md.');
      }
      return 'Couldn\u2019t verify you\u2019re human. Refresh the page and try again.';
    }
    return (e && e.message) || fallback;
  }

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
      var capTok = window.dzCaptcha ? await window.dzCaptcha.forAuth() : null;

      if (window.dzCaptcha && window.dzCaptcha.configured() && !capTok) {
        err.textContent = 'Couldn\u2019t verify you\u2019re human. Refresh the page and try again.';
        err.classList.add('show');
        btn.textContent = 'Log In'; btn.disabled = false;
        return;
      }

      var opts = capTok ? { captchaToken: capTok } : undefined;

      var result = await sb.auth.signInWithPassword(
        opts ? { email: email, password: pass, options: opts }
             : { email: email, password: pass });
      if (result.error) throw result.error;
      if (window.dzCaptcha) window.dzCaptcha.note('login', email, true);
    } catch (e) {
      if (window.dzCaptcha) {
        window.dzCaptcha.note('login', email, false);
        window.dzCaptcha.reset();
      }
      err.textContent = dzAuthErr(e, 'Login failed. Check your credentials.');
      err.classList.add('show');
    } finally {
      btn.textContent = 'Log In'; btn.disabled = false;
    }
  }

  var OAUTH_LABELS = { google:'Google', discord:'Discord', apple:'Apple' };

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
      + 'background:var(--sur,#24242c);color:var(--tx,#fff);'
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
    if (provider === 'apple') { showAppleUnavailable(); return; }
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }
    var label = OAUTH_LABELS[provider] || provider;
    var err = document.getElementById('authErr');
    err.textContent = ''; err.classList.remove('show');

    var row = document.querySelector('.laSocial');
    var btns = row ? row.querySelectorAll('.laSocialBtn') : [];
    Array.prototype.forEach.call(btns, function(b){ b.disabled = true; });

    try {
      var opts = { redirectTo: window.location.origin };
      if (provider === 'google') opts.queryParams = { prompt: 'select_account' };

      var result = await sb.auth.signInWithOAuth({ provider: provider, options: opts });
      if (result.error) throw result.error;
    } catch (e) {
      Array.prototype.forEach.call(btns, function(b){ b.disabled = false; });
      var raw = (e && e.message || '').toLowerCase();
      if (raw.includes('provider is not enabled') || raw.includes('unsupported provider')) {
        err.textContent = label + ' sign-in isn\u2019t available right now. Try another method.';
      } else {
        err.textContent = (e && e.message) ? (label + ' sign-in failed: ' + e.message)
                                           : (label + ' sign-in is unavailable right now.');
      }
      err.classList.add('show');
    }
  }

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
      if (userWrap) userWrap.style.display = '';
      passField.setAttribute('autocomplete', 'new-password');
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
      if (userWrap) userWrap.style.display = 'none';
      passField.setAttribute('autocomplete', 'current-password');
    }
  }

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

  async function doSignUp() {
    if (!sb) { showToast('Can\u2019t connect \u2014 try again'); return; }

    var email    = document.getElementById('authEmail').value.trim();
    var pass     = document.getElementById('authPass').value;
    var username = (document.getElementById('authUser').value || '').trim();
    var err      = document.getElementById('authErr');
    var msg      = document.getElementById('authMsg');

    err.textContent = ''; err.classList.remove('show');
    msg.style.display = 'none'; msg.textContent = '';

    if (!username) {
      err.textContent = 'Please enter a username.';
      err.classList.add('show'); return;
    }

    if (!email) {
      err.textContent = 'Please enter your email address.';
      err.classList.add('show'); return;
    }
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email)) {
      err.textContent = 'Please enter a valid email address.';
      err.classList.add('show'); return;
    }

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
      var capTok = window.dzCaptcha ? await window.dzCaptcha.forAuth() : null;
      if (window.dzCaptcha && window.dzCaptcha.configured() && !capTok) {
        err.textContent = 'Couldn\u2019t verify you\u2019re human. Refresh the page and try again.';
        err.classList.add('show');
        btn.textContent = 'Create Account'; btn.disabled = false;
        return;
      }
      var suOpts = { data: { username: username } };
      if (capTok) suOpts.captchaToken = capTok;

      var result = await sb.auth.signUp({ email: email, password: pass, options: suOpts });
      if (result.error) {
        if (window.dzCaptcha) {
          window.dzCaptcha.note('signup', email, false);
          window.dzCaptcha.reset();
        }
        throw result.error;
      }
      if (window.dzCaptcha) window.dzCaptcha.note('signup', email, true);

      var session = result.data && result.data.session;

      if (session) {
        showToast('Account created. Welcome!');
      } else {
        document.getElementById('authEmail').value = '';
        document.getElementById('authPass').value  = '';
        msg.textContent = 'Check your email to confirm your account.';
        msg.style.display = 'block';
        btn.textContent = 'Create Account'; btn.disabled = false;
        setTimeout(function(){
          if (document.getElementById('authMod').classList.contains('open')) {
            closeAuthMod();
          }
        }, 5000);
      }
    } catch (e) {
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
      } else if (raw.includes('captcha')) {
        friendly = dzAuthErr(e, 'Sign-up failed. Please try again.');
      } else {
        friendly = e.message || 'Sign-up failed. Please try again.';
      }
      err.textContent = friendly;
      err.classList.add('show');
    } finally {
      if (btn.disabled) {
        btn.textContent = 'Create Account'; btn.disabled = false;
      }
    }
  }

  let isDev = false;
  let userRole = null;
  let userPlan = null;
  function dzIsStaff(){ return userRole === 'admin' || userRole === 'dev'; }
  function dzIsPartner(){ return userRole === 'partner'; }
  window.dzIsStaff = dzIsStaff;
  window.dzIsPartner = dzIsPartner;

  // Anything the page remembers because of the plan it last read — the job
  // posting allowance among it — is stale the moment the plan is re-read.
  function dzForgetPlanCaches(){
    if(typeof window.dzJobQuotaForget === 'function') window.dzJobQuotaForget();
  }

  async function checkUserRole(){
    if(!sb || !currentUser){
      isDev=false; userRole=null; userPlan=null; currentUserAvatarUrl=null;
      dzSetPlan('guest', null); dzPaintLimits(); dzForgetPlanCaches();
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
      dzSetPlan(isDev ? 'dev' : userPlan,
                (data && data.subscription_expires_at) || null);
      dzPaintLimits();
      dzForgetPlanCaches();
      if(typeof dzPaintAds === 'function') dzPaintAds();
    }catch(e){
      console.error(e);
      isDev=false; userRole=null; userPlan='guest'; currentUserAvatarUrl=null;
      dzSetPlan('guest', null); dzPaintLimits(); dzForgetPlanCaches();
      if(typeof dzPaintAds === 'function') dzPaintAds();
    }
    syncAdmBtn();
    syncAuthBtn();
    notifRefreshBadge();
    if(currentUser && sessionStorage.getItem('pendPfUp')==='1'){
      sessionStorage.removeItem('pendPfUp');
      setTimeout(function(){
        if(typeof bnGoUpload==='function') bnGoUpload();
      },250);
    }
  }

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

      if (switched) {
        dzScopeBump();
        pfRowCache = {}; cmMineRows = []; cpMsgCache = {}; cmMineCache = {};
        try{ albResetMine(); }catch(e){}
        notifList = []; notifReadIds = {};
        try{ if(window.dzCache) window.dzCache.dropPrivate(); }catch(e){}
        try{
          pf.albums = []; pf.albumsLoaded = false;
          pf.galleryRows = []; pf.galleryIds = Object.create(null);
          pf.galleryOffset = 0; pf.galleryDone = false;
          pfMediaCache = {};
        }catch(e){}
        try{ syncAuthBtn(); }catch(e){ console.error('syncAuthBtn: '+(e.message||e)); }
        try{ if (typeof window.rkRefresh === 'function') window.rkRefresh(); }catch(e){}
        try{
          loadHiddenArtworks().then(function(){
            try{ renderHome(); }catch(e){}
            try{ renderFG(); }catch(e){}
          }, function(){   });
        }catch(e){ console.error('loadHiddenArtworks: '+(e.message||e)); }
        try{ if(typeof tgLoad === 'function') tgLoad(true); }catch(e){}
      }

      if (event === 'SIGNED_IN') {
        closeAuthMod();
        checkUserRole();
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
        syncSubOverviewCard();
        notifRefreshBadge();
        closeProfilePage();
        closeMyWorkPage();
        if(typeof dzOpsReset === 'function') dzOpsReset();
      }
    });

    sb.auth.getSession().then(function(res) {
      if (res.data && res.data.session) {
        currentUser = res.data.session.user;
        syncAuthBtn();
        checkUserRole();
      }
    });
  }

  var notifList = [];
  var notifReadIds = {};

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

  function notifRelTime(iso){
    var d = new Date(iso), diff = Math.max(0, (Date.now()-d.getTime())/1000);
    if(diff < 60) return 'Just now';
    if(diff < 3600) return Math.floor(diff/60)+'m ago';
    if(diff < 86400) return Math.floor(diff/3600)+'h ago';
    if(diff < 604800) return Math.floor(diff/86400)+'d ago';
    return d.toLocaleDateString();
  }

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

  async function notifMarkAllVisibleRead(){
    if(!sb || !currentUser){ notifRefreshBadge(); return; }
    var unread = notifList.filter(function(n){ return !notifReadIds[n.id]; });
    if(!unread.length){ notifRefreshBadge(); return; }
    try{
      var rows = unread.map(function(n){ return {user_id:currentUser.id, notification_id:n.id}; });
      // ignoreDuplicates, so this is ON CONFLICT DO NOTHING rather than DO UPDATE.
      // Marking a notification read is idempotent — there is nothing to rewrite
      // on the second attempt — and the DO UPDATE form needs an UPDATE policy
      // the table does not have, so a re-mark used to throw.
      const{error} = await sb.from('notification_reads')
        .upsert(rows, {onConflict:'user_id,notification_id', ignoreDuplicates:true});
      if(error) throw error;
      unread.forEach(function(n){ notifReadIds[n.id]=true; });
      notifRender();
    }catch(e){   }
    notifRefreshBadge();
  }

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
      const{data:all,error:e1} = await sb.from('notifications').select('id')
        .order('created_at',{ascending:false}).limit(NOTIF_WINDOW);
      if(e1) throw e1;
      const{data:reads,error:e2} = await sb.from('notification_reads').select('notification_id').eq('user_id',currentUser.id);
      if(e2) throw e2;
      var readSet = {}; (reads||[]).forEach(function(r){ readSet[r.notification_id]=true; });
      var hasUnread = (all||[]).some(function(n){ return !readSet[n.id]; });
      notifPaintBadges(hasUnread);
    }catch(e){   }
  }
