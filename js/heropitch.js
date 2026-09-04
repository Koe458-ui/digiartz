(function(){
  'use strict';

  var TABS = [
    { id:'explore', label:'Explore',
      lead:'Discover the world\u2019s best', em:'Digital Art',
      list:['Browse stunning galleries from top artists',
            'Discover high-quality design resources',
            'Find inspiration for your next project'],
      sub:'Browse stunning galleries from top artists, discover high-quality design resources, and find inspiration for your next project.',
      cta:'\u2728 Start Exploring', to:'artworks' },
    { id:'learn', label:'Learn',
      lead:'Master new skills in', em:'Design & Art',
      list:['Read in-depth tutorials on our blog',
            'Download free educational resources',
            'Stay updated with industry trends'],
      sub:'Read in-depth tutorials on our blog, download free educational resources, and stay updated with industry trends.',
      cta:'\ud83d\udcda Read the Blog', to:'blog' },
    { id:'buy', label:'Buy',
      lead:'Shop premium', em:'Creative Assets',
      list:['Purchase exclusive digital artworks directly',
            'Find premium resources for your workflow',
            'Enjoy a fast, secure checkout process'],
      sub:'Purchase exclusive digital artworks directly, find premium resources for your workflow, and enjoy a fast, secure checkout.',
      cta:'\ud83d\uded2 Browse Marketplace', to:'marketplace' },
    { id:'sell', label:'Sell',
      lead:'Monetize your', em:'Creative Work',
      list:['Set up your creator profile in minutes',
            'List your digital assets and artworks easily',
            'Keep more of what you earn as an artist'],
      sub:'Set up your creator profile in minutes, list your digital assets and artworks easily, and keep more of what you earn.',
      cta:'\ud83d\ude80 Become a Seller', to:'sell' }
  ];

  var ARROW = '<svg class="hpArrow" viewBox="0 0 24 24" aria-hidden="true">'+
              '<line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
  var cur = 0;

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
             ' onclick="hpSelect('+i+')">'+esc(t.label)+'</button>';
    }).join('');
  }

  function paintPanel(){
    var p = document.getElementById('hpPanel');
    if(!p) return;
    var t = TABS[cur];
    p.innerHTML =
      '<h1 class="hpHead">'+esc(t.lead)+' <em>'+esc(t.em)+'</em></h1>'+
      '<p class="hpSub">'+esc(t.sub)+'</p>'+
      '<div class="hpActions">'+
        '<button class="hpCta" type="button" onclick="hpGo()">'+esc(t.cta)+'</button>'+
        '<button class="hpAlt" type="button" onclick="hpJoin()">Join Community'+ARROW+'</button>'+
      '</div>';
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
  /* /community has no `section`, so dzRoutePath can't resolve it and go() would
     fall through to the gallery panel. It opens the same way the top nav opens
     it, with the route push as the fallback. */
  function hpJoin(){
    var open = typeof window.bnGoCommunity === 'function' ? window.bnGoCommunity : null;
    if(open){ open(); return; }
    if(typeof window.dzRouteGo === 'function' && window.dzRouteGo('/community')) return;
    window.location.href = '/community';
  }

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
  window.hpJoin   = hpJoin;
})();
