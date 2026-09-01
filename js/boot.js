  var __introRevealed = false;
  var __afterIntroQueue = [];
  function afterIntro(cb){
    if(__introRevealed){ cb(); return; }
    __afterIntroQueue.push(cb);
  }
  function __flushAfterIntro(){
    if(__introRevealed) return;
    __introRevealed = true;
    var q = __afterIntroQueue; __afterIntroQueue = [];
    q.forEach(function(fn){ try{ fn(); }catch(e){} });
  }

  (function(){
    var introEl = document.getElementById('intro');
    var revealed = false;
    var progress = {dom:0, img:0, fonts:0};

    function total(){
      return (progress.dom + progress.img + progress.fonts) / 3;
    }

    function reveal(){
      if(revealed) return;
      revealed = true;
      if(introEl){
        introEl.classList.add('iHide');
        introEl.addEventListener('transitionend', function handler(e){
          if(e.propertyName === 'opacity'){
            introEl.classList.add('iGone');
            introEl.removeEventListener('transitionend', handler);
            __flushAfterIntro();
          }
        });
        setTimeout(__flushAfterIntro, 450);
      } else {
        __flushAfterIntro();
      }
    }

    function paint(){
      if(total() >= 100) reveal();
    }

    if(document.readyState === 'complete' || document.readyState === 'interactive'){
      progress.dom = 100; paint();
    } else {
      document.addEventListener('DOMContentLoaded', function(){ progress.dom = 100; paint(); });
    }

    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(function(){ progress.fonts = 100; paint(); });
    } else {
      progress.fonts = 100;
    }

    window._heroLoadCb = function(url){
      if(!url){ progress.img = 100; paint(); return; }
      var pre = new Image();
      pre.onload  = function(){ progress.img = 100; paint(); };
      pre.onerror = function(){ progress.img = 100; paint(); };
      pre.src = url;
      if(pre.complete){ progress.img = 100; paint(); }
    };

    paint();
    setTimeout(reveal, 9000);
  })();

(function(){
  'use strict';

  var SKIP = { intro:1, sBanner:1, rippleHost:1, dzTop:1, dzTopMenu:1, dzMenuScrim:1, toast:1 };

  function isPanel(el){
    if(el.nodeType !== 1) return false;
    if(el.id && SKIP[el.id]) return false;
    if(el.classList.contains('dzTop') || el.classList.contains('dzMenu')) return false;
    var cs = getComputedStyle(el);
    if(cs.position !== 'fixed') return false;
    if(cs.display === 'none') return true;
    var r = el.getBoundingClientRect();
    if(!r.width || !r.height) return true;
    return r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight;
  }

  if(!('inert' in HTMLElement.prototype)) return;

  var watched = [];

  function wake(el){
    var imgs = el.querySelectorAll('img[data-src]');
    for(var i = 0; i < imgs.length; i++){
      imgs[i].src = imgs[i].getAttribute('data-src');
      imgs[i].removeAttribute('data-src');
    }
  }

  function apply(el){
    var open = el.classList.contains('open');
    if(open) wake(el);
    if(el.inert === !open) return;
    el.inert = !open;
  }

  var classes = new MutationObserver(function(muts){
    for(var i = 0; i < muts.length; i++) apply(muts[i].target);
  });

  function adopt(el){
    if(!isPanel(el) || watched.indexOf(el) !== -1) return;
    watched.push(el);
    apply(el);
    classes.observe(el, { attributes:true, attributeFilter:['class'] });
  }

  var kids = document.body.children;
  for(var i = 0; i < kids.length; i++) adopt(kids[i]);

  new MutationObserver(function(muts){
    for(var i = 0; i < muts.length; i++)
      for(var j = 0; j < muts[i].addedNodes.length; j++) adopt(muts[i].addedNodes[j]);
  }).observe(document.body, { childList:true });
})();
