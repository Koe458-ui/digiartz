  (function(){
    var host = document.getElementById('rippleHost');
    var SIZE = 40;
    var HALF = SIZE / 2;
    var DUR  = 250;

    function spawnRipple(cx, cy){
      var el = document.createElement('div');
      el.style.position     = 'absolute';
      el.style.width        = SIZE + 'px';
      el.style.height       = SIZE + 'px';
      el.style.left         = (cx - HALF) + 'px';
      el.style.top          = (cy - HALF) + 'px';
      el.style.borderRadius = '50%';
      el.style.background   = 'rgba(var(--pg-rgb),0.9)';
      el.style.filter       = 'blur(2px)';
      el.style.pointerEvents= 'none';

      host.appendChild(el);
      void el.getBoundingClientRect();
      el.style.animation = 'rplGrow ' + DUR + 'ms ease-out both';

      setTimeout(function(){
        if(el.parentNode) el.parentNode.removeChild(el);
      }, DUR + 60);
    }

    var lastTouch = 0;

    document.addEventListener('click', function(e){
      if (Date.now() - lastTouch < 700) return;
      spawnRipple(e.clientX, e.clientY);
    }, {capture:true, passive:true});

    document.addEventListener('touchstart', function(e){
      lastTouch = Date.now();
      for(var i = 0; i < e.changedTouches.length; i++){
        spawnRipple(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
      }
    }, {capture:true, passive:true});

  })();

(function(){

  var AD_CLIENT = 'ca-pub-1351696642556147';
  var AD_SLOT   = '7070525551';
  var AD_SRC    = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js' +
                  '?client=' + AD_CLIENT;

  function adsFree(){ return typeof dzTier === 'function' && dzTier() === 'max'; }

  function adsLoadScript(){
    if(document.querySelector('script[data-dz-ads]')) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = AD_SRC;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-dz-ads', '1');
    document.head.appendChild(s);
  }

  window.dzAdHtml = function(){
    if(adsFree()) return '';
    return '<div class="dzAd" data-dz-ad>' +
             '<div class="dzAdLbl"><span>Advertisement</span></div>' +
             '<div class="dzAdBox">' +
               '<div class="dzAdNone"><span>NO ADS</span></div>' +
             '</div>' +
           '</div>';
  };

  function watch(box, ins){
    function settle(){
      var st = ins.getAttribute('data-ad-status');
      if(st === 'filled'){ box.setAttribute('data-filled','1'); return true; }
      return false;
    }
    if(settle()) return;
    var obs = null;
    if(typeof MutationObserver === 'function'){
      obs = new MutationObserver(function(){
        if(settle() && obs){ obs.disconnect(); obs = null; }
      });
      obs.observe(ins, {attributes:true, attributeFilter:['data-ad-status']});
    }
    setTimeout(function(){
      settle();
      if(obs){ obs.disconnect(); obs = null; }
    }, 8000);
  }

  function mount(wrap){
    if(!wrap || wrap.getAttribute('data-dz-ad-on') === '1') return;
    var box = wrap.querySelector('.dzAdBox');
    if(!box) return;
    wrap.setAttribute('data-dz-ad-on', '1');

    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', AD_CLIENT);
    ins.setAttribute('data-ad-slot', AD_SLOT);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    box.appendChild(ins);

    adsLoadScript();
    watch(box, ins);
    try{ (window.adsbygoogle = window.adsbygoogle || []).push({}); }catch(e){}
  }

  window.dzAdMount = function(root){
    if(adsFree()){ window.dzPaintAds(); return; }
    var host = root || document;
    var slots = host.querySelectorAll ? host.querySelectorAll('[data-dz-ad]') : [];
    for(var i = 0; i < slots.length; i++) mount(slots[i]);
  };

  window.dzAdSlot = function(id){
    var host = document.getElementById(id || 'avAdSlot');
    if(!host) return;
    host.innerHTML = window.dzAdHtml();
    window.dzAdMount(host);
  };

  window.dzPaintAds = function(){
    if(!adsFree()) return;
    var slots = document.querySelectorAll('[data-dz-ad]');
    for(var i = 0; i < slots.length; i++){
      var s = slots[i];
      if(s.parentNode) s.parentNode.removeChild(s);
    }
  };
})();

(function(){

  var backdrop = document.getElementById('legalBackdrop');
  var titleEl  = document.getElementById('lmTitleText');
  var bodyEl   = document.getElementById('lmBody');

  window.openLegal = function(type){
    var docs = window.DZ_LEGAL;
    if(!docs && window.dzLazy){
      // The documents are a chunk now; fetch them and come straight back.
      window.dzLazy('legal').then(function(){ window.openLegal(type); });
      return false;
    }
    var c = docs && docs[type];
    if(!c) return true;
    titleEl.innerHTML = c.title;
    bodyEl.innerHTML  = c.html;
    bodyEl.scrollTop  = 0;
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    var closeBtn = backdrop.querySelector('.lmClose');
    if(closeBtn) setTimeout(function(){ closeBtn.focus(); }, 80);
    return false;
  };

  window.closeLegal = function(){
    backdrop.classList.remove('open');
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
  };

  window.handleBackdropClick = function(e){
    if(e.target === backdrop) closeLegal();
  };

  var lg = null;
  function lgEls(){
    if(lg) return lg;
    var page  = document.getElementById('legalPage');
    var title = document.getElementById('lgTitleText');
    var body  = document.getElementById('lgBody');
    if(!page || !title || !body) return null;
    lg = { page:page, title:title, body:body };
    return lg;
  }
  var lgPrevOverflow = '';

  window.openLegalPage = function(type){
    var docs = window.DZ_LEGAL;
    if(!docs && window.dzLazy){
      window.dzLazy('legal').then(function(){ window.openLegalPage(type); });
      return false;
    }
    var c = docs && docs[type];
    var els = lgEls();
    if(!c || !els) return true;
    els.title.innerHTML = c.title;
    els.body.innerHTML  = c.html;
    els.page.scrollTop  = 0;
    if (!els.page.classList.contains('open')) lgPrevOverflow = document.body.style.overflow;
    els.page.classList.add('open');
    document.body.style.overflow = 'hidden';
    var back = els.page.querySelector('.subPgX');
    if(back) setTimeout(function(){ back.focus({preventScroll:true}); }, 80);
    return false;
  };

  window.closeLegalPage = function(){
    var els = lgEls();
    if(!els) return;
    els.page.classList.remove('open');
    document.body.style.overflow = lgPrevOverflow;
  };

  window.setGoLegal = function(type){
    if(!lgEls() || typeof setGo !== 'function') return true;
    var docs = window.DZ_LEGAL;
    if(!docs && window.dzLazy){
      // Handle the click here rather than letting the link fall through to a
      // full page load: the documents are one fetch away.
      window.dzLazy('legal').then(function(){ window.setGoLegal(type); })
        ['catch'](function(){ location.href = '/legal/' + type; });
      return false;
    }
    if(!docs || !docs[type]) return true;
    setGo(function(){ window.openLegalPage(type); }, 'legalPage');
    return false;
  };

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var els = lgEls();
    if(els && els.page.classList.contains('open')){
      e.stopPropagation();
      closeLegalPage();
    }
  }, true);

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && backdrop.classList.contains('open')) closeLegal();
  });

})();

(function(){

  function mountFaq(){
    var faqEl  = document.getElementById('faqSection');
    var subBdy = document.querySelector('.subPgBdy');
    if(!faqEl || !subBdy){ return; }
    faqEl.removeAttribute('hidden');
    subBdy.appendChild(faqEl);
    var panels = faqEl.querySelectorAll('.faqA[hidden]');
    panels.forEach(function(p){ p.removeAttribute('hidden'); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFaq);
  } else {
    mountFaq();
  }

  window.faqToggle = function(btn){
    var item   = btn.closest('.faqItem');
    var panel  = document.getElementById(btn.getAttribute('aria-controls'));
    var icon   = btn.querySelector('.faqIcon');
    var isOpen = item.classList.contains('faq--open');

    var section = item.closest('.faqCategory');
    if(section){
      section.querySelectorAll('.faqItem.faq--open').forEach(function(openItem){
        if(openItem === item) return;
        var ob  = openItem.querySelector('.faqQ');
        var op  = openItem.querySelector('.faqA');
        var oi  = openItem.querySelector('.faqIcon');
        openItem.classList.remove('faq--open');
        if(ob) ob.setAttribute('aria-expanded','false');
        if(oi) oi.textContent = '+';
      });
    }

    if(isOpen){
      item.classList.remove('faq--open');
      btn.setAttribute('aria-expanded','false');
      if(icon) icon.textContent = '+';
    } else {
      item.classList.add('faq--open');
      btn.setAttribute('aria-expanded','true');
      if(icon) icon.textContent = '+';
    }
  };

  document.addEventListener('keydown', function(e){
    var btn = e.target;
    if(!btn || !btn.classList.contains('faqQ')) return;

    var section = btn.closest('.faqCategory');
    if(!section) return;

    var btns = Array.from(section.querySelectorAll('.faqQ'));
    var idx  = btns.indexOf(btn);

    switch(e.key){
      case 'ArrowDown':
        e.preventDefault();
        if(idx < btns.length - 1) btns[idx + 1].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if(idx > 0) btns[idx - 1].focus();
        break;
      case 'Home':
        e.preventDefault();
        btns[0].focus();
        break;
      case 'End':
        e.preventDefault();
        btns[btns.length - 1].focus();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        faqToggle(btn);
        break;
    }
  });

})();
