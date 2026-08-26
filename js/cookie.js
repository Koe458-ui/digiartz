(function(){

  var STORAGE_KEY  = 'dga_cookie_consent';
  var DELAY_MS     = 5 * 60 * 1000;
  var banner       = document.getElementById('cookieBanner');
  var acceptBtn    = document.getElementById('ckAcceptBtn');
  var hideTimer    = null;

  function getChoice(){
    try{ return localStorage.getItem(STORAGE_KEY); }
    catch(e){ return null; }
  }
  function saveChoice(v){
    try{ localStorage.setItem(STORAGE_KEY, v); }
    catch(e){}
  }

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

  function showBanner(){
    if(!banner) return;
    banner.removeAttribute('aria-hidden');
    banner.classList.remove('ck--dismiss');
    void banner.offsetWidth;
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

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && banner && banner.classList.contains('ck--visible')){
      hideBanner();
    }
  });

  var stored = getChoice();
  if(stored){
    if(stored === 'accepted') enableAnalytics();
    else disableAnalytics();
  } else {
    disableAnalytics();
    setTimeout(showBanner, DELAY_MS);
  }

})();
