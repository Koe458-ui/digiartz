/* ── cookie.js · cookie consent ── */
/* Cookie consent — key: 'dga_cookie_consent', values: 'accepted'|'rejected', banner delay: 5 min */
(function(){

  var STORAGE_KEY  = 'dga_cookie_consent';
  var DELAY_MS     = 5 * 60 * 1000; /* 5 minutes */
  var banner       = document.getElementById('cookieBanner');
  var acceptBtn    = document.getElementById('ckAcceptBtn');
  var hideTimer    = null;

  /* ── localStorage helpers — fail silently in restricted contexts ── */
  function getChoice(){
    try{ return localStorage.getItem(STORAGE_KEY); }
    catch(e){ return null; }
  }
  function saveChoice(v){
    try{ localStorage.setItem(STORAGE_KEY, v); }
    catch(e){}
  }

  /* ── GA4 consent mode helpers ── */
  function enableAnalytics(){
    if(typeof gtag === 'function'){
      gtag('consent','update',{analytics_storage:'granted',ad_storage:'granted'});
    }
  }
  function disableAnalytics(){
    if(typeof gtag === 'function'){
      gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied'});
    }
  }

  /* ── Show / hide ── */
  function showBanner(){
    if(!banner) return;
    banner.removeAttribute('aria-hidden');
    banner.classList.remove('ck--dismiss');
    void banner.offsetWidth; /* force reflow so transition fires */
    banner.classList.add('ck--visible');
    if(acceptBtn) setTimeout(function(){ acceptBtn.focus(); }, 420);
  }

  function hideBanner(){
    if(!banner) return;
    banner.classList.remove('ck--visible');
    banner.classList.add('ck--dismiss');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){
      banner.setAttribute('aria-hidden','true');
    }, 300);
  }

  /* ── Public handlers ── */
  window.ckAccept = function(){
    saveChoice('accepted');
    enableAnalytics();
    hideBanner();
  };
  window.ckReject = function(){
    saveChoice('rejected');
    disableAnalytics();
    hideBanner();
  };

  /* Escape key: soft dismiss only — no stored choice, banner will
     reappear on the next visit if the user hasn't decided yet. */
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && banner && banner.classList.contains('ck--visible')){
      hideBanner();
    }
  });

  /* ── Initialise ── */
  var stored = getChoice();
  if(stored){
    /* Prior choice found — apply silently, never show banner again */
    if(stored === 'accepted') enableAnalytics();
    else disableAnalytics();
  } else {
    /* No prior choice — privacy-first default, show banner after 5 min */
    disableAnalytics();
    setTimeout(showBanner, DELAY_MS);
  }

})();
