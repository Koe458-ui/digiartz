/* Code that is not part of the shell.

   Everything the site could ever do used to be downloaded, parsed and run
   before the first tap: forty-six scripts, 1.2MB, of which a home page visit
   executed 22%. What is left here is the work that only starts when someone
   asks for it — the artist's analytics dashboard, the assistant and its
   dictionary, the share sheet, the legal documents.

   A chunk is fetched the first time one of its entry points is called. Until
   then a stub stands in its place, so an inline onclick written years ago
   still works: the stub loads the chunk and forwards the call. The real
   function replaces the stub on load, so each stub fires at most once.

   The chunks are still in the service worker's precache list, so a returning
   visitor has them before they ask. They are simply not in the way of the
   first paint. */
(function(){
  'use strict';

  var CHUNKS = {
    analytics: {
      src: ['/js/analytics.js?v=14'],
      api: ['openAnalyticsPage']
    },
    hubs: {
      src: ['/js/hubs.js?v=4'],
      api: ['anHubOpen', 'payHubOpen']
    },
    share: {
      src: ['/js/share.js?v=3'],
      api: ['openPfShare', 'closePfShare', 'pfShareCopy', 'pfShareNative']
    },
    zeo: {
      src: ['/aiAssistantData.js?v=6', '/js/zeo.js?v=6'],
      api: ['zeoOpen', 'zeoHide']
    },
    legal: {
      src: ['/js/legal-content.js?v=4'],
      module: true,
      api: []
    }
  };

  var pending = {};

  function inject(src, isModule){
    return new Promise(function(resolve, reject){
      var s = document.createElement('script');
      if(isModule) s.type = 'module';
      else s.async = false;               // keeps a multi-file chunk in order
      s.src = src;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('could not load ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function load(name){
    if(pending[name]) return pending[name];
    var c = CHUNKS[name];
    if(!c) return Promise.reject(new Error('no such chunk: ' + name));
    pending[name] = c.src.reduce(function(p, src){
      return p.then(function(){ return inject(src, c.module); });
    }, Promise.resolve());
    pending[name]['catch'](function(){ pending[name] = null; });  // a failure may be retried
    return pending[name];
  }

  window.dzLazy = load;
  window.dzLazyLoaded = function(name){ return !!pending[name]; };

  function stub(chunk, name){
    var placeholder = function(){
      var args = arguments, self = this;
      return load(chunk).then(function(){
        var real = window[name];
        if(typeof real === 'function' && real !== placeholder) return real.apply(self, args);
        console.error('chunk ' + chunk + ' loaded but did not define ' + name);
      })['catch'](function(err){
        console.error(err);
        if(typeof showToast === 'function') showToast('Could not load that just now — check your connection');
      });
    };
    placeholder.dzChunk = chunk;
    window[name] = placeholder;
  }

  Object.keys(CHUNKS).forEach(function(chunk){
    CHUNKS[chunk].api.forEach(function(name){
      if(typeof window[name] === 'function') return;   // the shell already owns it
      stub(chunk, name);
    });
  });
})();
