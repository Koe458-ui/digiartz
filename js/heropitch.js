(function(){
  'use strict';

  /* The hero used to be four tabs rendered from a data table. It is one static
     block in index.html now, so all that is left here is the navigation the two
     buttons need — the headline no longer waits on JS to paint. */

  function go(to){
    var path = typeof window.dzRoutePath === 'function' ? window.dzRoutePath(to) : null;
    if(path && typeof window.dzRouteGo === 'function' && window.dzRouteGo(path)) return;
    if(typeof openFG === 'function'){
      openFG();
      if(typeof fgSwitchSection === 'function') fgSwitchSection(to);
    }
  }

  function hpGo(){ go('artworks'); }

  /* /community has no `section`, so dzRoutePath cannot resolve it and go() would
     fall through to the gallery panel. It opens the way the top nav opens it,
     with the route push as the fallback. */
  function hpJoin(){
    var open = typeof window.bnGoCommunity === 'function' ? window.bnGoCommunity : null;
    if(open){ open(); return; }
    if(typeof window.dzRouteGo === 'function' && window.dzRouteGo('/community')) return;
    window.location.href = '/community';
  }

  window.hpGo   = hpGo;
  window.hpJoin = hpJoin;
})();
