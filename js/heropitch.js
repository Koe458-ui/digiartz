/* The four tabs above the fold and the quick links that share their router.
   This paints during boot, so unlike the rest of what was sections.js it
   ships with the shell. */
(function(){
  'use strict';

  var TABS = [
    { id:'explore', label:'Explore',
      lead:'Discover the world\u2019s best', em:'Digital Art',
      list:['Browse stunning galleries from top artists',
            'Discover high-quality design resources',
            'Find inspiration for your next project'],
      cta:'\u2728 Start Exploring', to:'artworks' },
    { id:'learn', label:'Learn',
      lead:'Master new skills in', em:'Design & Art',
      list:['Read in-depth tutorials on our blog',
            'Download free educational resources',
            'Stay updated with industry trends'],
      cta:'\ud83d\udcda Read the Blog', to:'blog' },
    { id:'buy', label:'Buy',
      lead:'Shop premium', em:'Creative Assets',
      list:['Purchase exclusive digital artworks directly',
            'Find premium resources for your workflow',
            'Enjoy a fast, secure checkout process'],
      cta:'\ud83d\uded2 Browse Marketplace', to:'marketplace' },
    { id:'sell', label:'Sell',
      lead:'Monetize your', em:'Creative Work',
      list:['Set up your creator profile in minutes',
            'List your digital assets and artworks easily',
            'Keep more of what you earn as an artist'],
      cta:'\ud83d\ude80 Become a Seller', to:'sell' }
  ];

  var TICK = '<span class="hpTick" aria-hidden="true"><svg viewBox="0 0 24 24">'+
             '<polyline points="20 6 9 17 4 12"/></svg></span>';
  var cur = 0;

  function esc2(s){ return (typeof esc === 'function') ? esc(s) : String(s); }

  function go(to){
    if(to === 'sell'){
      if(typeof bnGoUpload === 'function') bnGoUpload('marketplace');
      else if(typeof openPfUpload === 'function') openPfUpload('marketplace');
      return;
    }
    var path = typeof window.dzRoutePath === 'function' ? window.dzRoutePath(to) : null;
    if(path && typeof window.dzRouteGo === 'function' && window.dzRouteGo(path)) return;
    if(typeof openFG === 'function'){
      openFG();
      if(typeof fgSwitchSection === 'function') fgSwitchSection(to);
    }
  }

  function paintTabs(){
    var host = document.getElementById('hpTabs');
    if(!host) return;
    host.innerHTML = TABS.map(function(t, i){
      return '<button class="hpTab" type="button" role="tab" id="hpTab-'+t.id+'"'+
             ' aria-selected="'+(i === cur)+'" tabindex="'+(i === cur ? '0' : '-1')+'"'+
             ' onclick="hpSelect('+i+')">'+esc2(t.label)+'</button>';
    }).join('');
  }

  function paintPanel(){
    var p = document.getElementById('hpPanel');
    if(!p) return;
    var t = TABS[cur];
    p.innerHTML =
      '<h1 class="hpHead">'+esc2(t.lead)+' <em>'+esc2(t.em)+'</em></h1>'+
      '<ul class="hpList">'+ t.list.map(function(x){
        return '<li>'+TICK+'<span>'+esc2(x)+'</span></li>'; }).join('') +'</ul>'+
      '<button class="hpCta" type="button" onclick="hpGo()">'+esc2(t.cta)+'</button>';
    p.setAttribute('aria-labelledby', 'hpTab-'+t.id);
    p.classList.remove('hpIn');
    void p.offsetWidth;
    p.classList.add('hpIn');
  }

  function hpSelect(i, focus){
    if(i < 0 || i >= TABS.length || i === cur) {
      if(focus) { var b0 = document.getElementById('hpTab-'+TABS[cur].id); if(b0) b0.focus(); }
      return;
    }
    cur = i;
    paintTabs();
    paintPanel();
    if(focus){
      var b = document.getElementById('hpTab-'+TABS[cur].id);
      if(b) b.focus();
    }
  }
  function hpGo(){ go(TABS[cur].to); }

  var tabsEl = document.getElementById('hpTabs');
  if(tabsEl){
    tabsEl.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if(!d) return;
      e.preventDefault();
      hpSelect((cur + d + TABS.length) % TABS.length, true);
    });
  }

  paintTabs();
  paintPanel();

  window.hpSelect = hpSelect;
  window.hpGo     = hpGo;
})();

(function(){
  'use strict';

  var OWN = {
    community:    function(){ if(typeof bnGoCommunity === 'function') bnGoCommunity(); },
    upload:       function(){ if(typeof bnGoUpload === 'function') bnGoUpload(); },
    cart:         function(){ if(typeof dzGoCart === 'function') dzGoCart(); },
    subscription: function(){ if(typeof openSubscription === 'function') openSubscription(); },
    level:        function(){
      if(window.pf) window.pf.profile = null;
      if(typeof openXpPage === 'function') openXpPage();
    },
    theme:        function(){ if(typeof openThemePage === 'function') openThemePage(); },
    ranking:      function(){ if(typeof openRankHub === 'function') openRankHub(); }
  };

  var GALLERY = {
    artworks:1, marketplace:1, resources:1, blog:1, jobs:1
  };

  function shut(){
    if(typeof bnCloseAllSections === 'function') bnCloseAllSections();
  }

  window.qlGo = function(id){

    var path = typeof window.dzRoutePath === 'function' ? window.dzRoutePath(id) : null;
    if(path && typeof window.dzRouteGo === 'function' && window.dzRouteGo(path)) return;

    if(window.dzNavBegin) window.dzNavBegin();
    try{
      if(GALLERY[id]){
        if(typeof bnGoGallery === 'function') bnGoGallery();
        else if(typeof openFG === 'function') openFG();
        if(typeof fgSwitchSection === 'function') fgSwitchSection(id);
      } else {
        shut();
        if(OWN[id]) OWN[id]();
      }
    } finally {
      if(window.dzNavEnd) window.dzNavEnd();
      if(typeof window.dzRouteAudit === 'function') window.dzRouteAudit();
    }
  };
})();
