// cookie consent
(function(){

  var STORAGE_KEY  = 'dga_cookie_consent';
  var DELAY_MS     = 5 * 60 * 1000; // 5 minutes
  var banner       = document.getElementById('cookieBanner');
  var acceptBtn    = document.getElementById('ckAcceptBtn');
  var hideTimer    = null;

  // localstorage helpers
  function getChoice(){
    try{ return localStorage.getItem(STORAGE_KEY); }
    catch(e){ return null; }
  }
  function saveChoice(v){
    try{ localStorage.setItem(STORAGE_KEY, v); }
    catch(e){}
  }

  // ga4 consent helpers
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

  // show and hide
  function showBanner(){
    if(!banner) return;
    banner.removeAttribute('aria-hidden');
    banner.classList.remove('ck--dismiss');
    void banner.offsetWidth; // force reflow
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

  // public handlers
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

  // escape dismisses softly
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && banner && banner.classList.contains('ck--visible')){
      hideBanner();
    }
  });

  // init
  var stored = getChoice();
  if(stored){
    // apply stored choice
    if(stored === 'accepted') enableAnalytics();
    else disableAnalytics();
  } else {
    // no choice, show later
    disableAnalytics();
    setTimeout(showBanner, DELAY_MS);
  }

})();
