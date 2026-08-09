// ripple, ads panel, legal modals, faq
  // global ripple
  (function(){
    var host = document.getElementById('rippleHost');
    var SIZE = 40;          // 40px dot
    var HALF = SIZE / 2;
    var DUR  = 250;         // ms

    function spawnRipple(cx, cy){
      var el = document.createElement('div');
      el.style.position     = 'absolute';
      el.style.width        = SIZE + 'px';
      el.style.height       = SIZE + 'px';
      el.style.left         = (cx - HALF) + 'px';
      el.style.top          = (cy - HALF) + 'px';
      el.style.borderRadius = '50%';
      el.style.background   = 'rgba(var(--pg-rgb),0.9)';
      el.style.filter       = 'blur(2px)';   // soft edges
      el.style.pointerEvents= 'none';

      host.appendChild(el);
      void el.getBoundingClientRect();
      el.style.animation = 'rplGrow ' + DUR + 'ms ease-out both';

      setTimeout(function(){
        if(el.parentNode) el.parentNode.removeChild(el);
      }, DUR + 60);
    }

    // skip synthesized click twin
    var lastTouch = 0;

    // mouse click
    document.addEventListener('click', function(e){
      if (Date.now() - lastTouch < 700) return;
      spawnRipple(e.clientX, e.clientY);
    }, {capture:true, passive:true});

    // touch
    document.addEventListener('touchstart', function(e){
      lastTouch = Date.now();
      for(var i = 0; i < e.changedTouches.length; i++){
        spawnRipple(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
      }
    }, {capture:true, passive:true});

  })();

// image linked comments

(function(){
  var panel  = document.getElementById('adsPanel');
  var wrap   = document.getElementById('apTrackWrap');
  var dots   = document.querySelectorAll('#apDots .apDot');
  var cards  = document.querySelectorAll('#apTrack .apCard');
  var adsInit = false;

  // open
  window.openAdsPanel = function(){
    closeMenu();
    panel.classList.add('open');
    var hint = panel.querySelector('.apHint');
    if (hint) {
      hint.style.animation = 'none';
      void hint.offsetWidth; // force reflow
      hint.style.animation = '';
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if(typeof zeoSectionTrigger==='function') zeoSectionTrigger();
    if(!adsInit){
      adsInit = true;
      setTimeout(function(){
        var slots = panel.querySelectorAll('ins.adsbygoogle');
        slots.forEach(function(ins, i){
          setTimeout(function(){
            try{ (adsbygoogle = window.adsbygoogle || []).push({}); }catch(e){}
          }, i * 150);
        });
      }, 800); // staggered push
    }
  };

  // close
  window.closeAdsPanel = function(){
    panel.classList.remove('open');
    // restore scroll
    if (typeof restoreScroll === 'function') restoreScroll();
    else { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; }
  };

  // dot updater on scroll
  function updateDots(){
    if(!wrap || !cards.length) return;
    var scrollLeft = wrap.scrollLeft;
    var cardW = cards[0].offsetWidth + 16; // width + gap
    var idx = Math.round(scrollLeft / cardW);
    idx = Math.max(0, Math.min(idx, cards.length - 1));
    dots.forEach(function(d, i){ d.classList.toggle('active', i === idx); });
  }
  if(wrap) wrap.addEventListener('scroll', updateDots, {passive:true});

  // dot click scrolls
  dots.forEach(function(dot){
    dot.addEventListener('click', function(){
      var idx = parseInt(dot.getAttribute('data-idx'), 10);
      var cardW = cards[0] ? cards[0].offsetWidth + 16 : 0;
      wrap.scrollTo({ left: idx * cardW, behavior: 'smooth' });
    });
  });

  // drag to scroll
  var isDragging = false, startX = 0, scrollStart = 0;
  if(wrap){
    wrap.addEventListener('mousedown', function(e){
      isDragging = true;
      startX = e.pageX - wrap.offsetLeft;
      scrollStart = wrap.scrollLeft;
      wrap.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', function(e){
      if(!isDragging) return;
      var x = e.pageX - wrap.offsetLeft;
      wrap.scrollLeft = scrollStart - (x - startX);
    });
    document.addEventListener('mouseup', function(){
      isDragging = false;
      if(wrap) wrap.style.cursor = 'grab';
    });
  }

  // close on escape
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && panel.classList.contains('open')) closeAdsPanel();
  });
})();

(function(){
  // The documents themselves live in js/legal-content.js, which is loaded as a
  // module and also feeds the standalone /privacy, /terms, /refund-policy and
  // sibling pages served by functions/legal-page.js. Read at click time, not at
  // load time: this classic script runs before the module does, so binding it
  // here would capture undefined.

  var backdrop = document.getElementById('legalBackdrop');
  var titleEl  = document.getElementById('lmTitleText');
  var bodyEl   = document.getElementById('lmBody');
  // local escaper
  function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  // Returns FALSE when it opened the modal and TRUE when it could not.
  //
  // The footer links are real anchors pointing at the standalone pages, and
  // they call this from onclick as `return openLegal('privacy')`. So the return
  // value is the fallback: handled here, the navigation is cancelled and the
  // modal opens as it always did; not handled — the module has not loaded, or
  // this document is unknown — the browser follows the href and the buyer lands
  // on the real page instead of clicking a dead button.
  window.openLegal = function(type){
    var docs = window.DZ_LEGAL;
    var c = docs && docs[type];
    if(!c) return true;
    titleEl.innerHTML = c.title;
    bodyEl.innerHTML  = c.html;
    bodyEl.scrollTop  = 0;
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    // focus close button
    var closeBtn = backdrop.querySelector('.lmClose');
    if(closeBtn) setTimeout(function(){ closeBtn.focus(); }, 80);
    return false;
  };

  window.closeLegal = function(){
    backdrop.classList.remove('open');
    // restore scroll
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
  };

  // verification status modal
  window.handleBackdropClick = function(e){
    if(e.target === backdrop) closeLegal();
  };

  // close on escape
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && backdrop.classList.contains('open')) closeLegal();
  });

})();

(function(){

  // mount faq
  function mountFaq(){
    var faqEl  = document.getElementById('faqSection');
    var subBdy = document.querySelector('.subPgBdy');
    if(!faqEl || !subBdy){ return; }
    // unhide faq
    faqEl.removeAttribute('hidden');
    subBdy.appendChild(faqEl);
    // unhide answer panels
    var panels = faqEl.querySelectorAll('.faqA[hidden]');
    panels.forEach(function(p){ p.removeAttribute('hidden'); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFaq);
  } else {
    mountFaq();
  }

  // toggle accordion
  window.faqToggle = function(btn){
    var item   = btn.closest('.faqItem');
    var panel  = document.getElementById(btn.getAttribute('aria-controls'));
    var icon   = btn.querySelector('.faqIcon');
    var isOpen = item.classList.contains('faq--open');

    // collapse others
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

    // toggle clicked item
    if(isOpen){
      item.classList.remove('faq--open');
      btn.setAttribute('aria-expanded','false');
      if(icon) icon.textContent = '+';
    } else {
      item.classList.add('faq--open');
      btn.setAttribute('aria-expanded','true');
      if(icon) icon.textContent = '+'; // css rotates the plus
    }
  };

  // keyboard nav
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
