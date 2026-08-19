// ripple, the ad slot, legal modals, faq
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
  /* One ad slot, four detail views.

     It replaces the Sponsor panel, which was a page of its own that a member
     had to choose to open — three ad cards behind a footer link, seen by
     almost nobody and worth almost nothing. The slot lives where a reader
     already is instead: on an artwork, a resource, a post and a listing,
     between the tags and the comments. That is the one seam on those pages
     where the work has finished and the conversation has not started, so an
     ad sits in it without interrupting either.

     Nothing is in the markup. Each view asks for the slot when it renders and
     this builds it, which is what keeps three promises at once:

       - Max is the plan without ads, and "without ads" is literal. No slot is
         drawn, the network's script is never fetched, and no third party is
         told that this member opened anything.
       - A visit that never opens a detail view never fetches the script
         either. It used to load on every page view, before anybody had asked
         for an ad.
       - A fresh <ins> per view. AdSense refuses a second push into an element
         it has already filled, and these viewers are one DOM node reused for
         every artwork, so the element has to be rebuilt rather than re-pushed
         or the second artwork opened would show the first one's ad forever.

     The site is not approved for ads yet, so the honest state today is the
     empty one: the label is always drawn, and under it "NO ADS" until the
     network actually returns something. Nothing about that needs changing on
     the day approval lands — a filled slot hides the placeholder itself. */
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

  /* The markup a view drops into its column. Built as a string because four
     of the five callers assemble their page as one innerHTML and the fifth
     writes it into a container it already owns. The box is empty here — the
     <ins> is added by mount(), once the element is in the document, because
     AdSense measures the width it is given at push time. */
  window.dzAdHtml = function(){
    if(adsFree()) return '';
    return '<div class="dzAd" data-dz-ad>' +
             '<div class="dzAdLbl"><span>Advertisement</span></div>' +
             '<div class="dzAdBox">' +
               '<div class="dzAdNone">NO ADS</div>' +
             '</div>' +
           '</div>';
  };

  /* "filled" is AdSense's own word for it, written onto the <ins> when an ad
     comes back. Anything else — "unfilled", the attribute never appearing at
     all because the script is blocked, or because this site is not approved
     yet — leaves the placeholder where it is. */
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
    // A stop either way: the observer is not left watching an element that
    // was thrown away when the reader moved to the next artwork.
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

  /* Called by each view after it has written its column. Given a root it
     mounts the slots inside it; given nothing it sweeps the document, which
     is what the tier repaint below wants. */
  window.dzAdMount = function(root){
    if(adsFree()){ window.dzPaintAds(); return; }
    var host = root || document;
    var slots = host.querySelectorAll ? host.querySelectorAll('[data-dz-ad]') : [];
    for(var i = 0; i < slots.length; i++) mount(slots[i]);
  };

  /* The artwork viewer is one node reused for every artwork, so its slot is
     rebuilt rather than mounted — the previous artwork's <ins> is already
     filled and AdSense will not touch it twice. The four section views get a
     new column each render and go through dzAdMount instead. */
  window.dzAdSlot = function(id){
    var host = document.getElementById(id || 'avAdSlot');
    if(!host) return;
    host.innerHTML = window.dzAdHtml();
    window.dzAdMount(host);
  };

  /* The tier lands after the page does, and it changes when somebody signs in
     or out. A slot drawn for a member who turns out to be on Max is taken
     back out here rather than left on screen. */
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

  // ---- the same documents, as a slide page --------------------------------
  //
  // Opened from the Settings menu, where a modal was the wrong shape: every
  // other item there — Theme, Edit My Work, Wallet, My Purchases — slides a
  // page in over the menu and its back arrow returns to it. A sheet floating
  // over a menu you cannot see behaves like nothing else in that list.
  //
  // The footer keeps the modal. At the bottom of the home page there is no
  // menu to go back to, and a sheet over the page is right there.
  //
  // Same text either way: both read window.DZ_LEGAL, so there is still one
  // copy of every document.
  // Looked up on use, not now. This script runs from partway down the body
  // and #legalPage is written out below it — resolving here would capture
  // null, openLegalPage would report that it could not open, and every row in
  // the menu would quietly navigate away instead of sliding. The modal gets
  // away with binding early only because #legalBackdrop happens to sit above
  // this script; that is an ordering accident, not something to rely on twice.
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

  // Returns false when it opened the page and true when it could not, so the
  // menu anchors can fall through to their href exactly as the footer's do.
  window.openLegalPage = function(type){
    var docs = window.DZ_LEGAL;
    var c = docs && docs[type];
    var els = lgEls();
    if(!c || !els) return true;
    els.title.innerHTML = c.title;
    els.body.innerHTML  = c.html;
    els.page.scrollTop  = 0;
    els.page.classList.add('open');
    lgPrevOverflow = document.body.style.overflow;
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

  // setGo hands the menu the page's id and watches for it to close, so the
  // back arrow lands on Settings rather than on the profile. Guarded: if the
  // documents have not loaded there is nothing to open, and returning true
  // lets the browser follow the row's href to the standalone page instead.
  window.setGoLegal = function(type){
    var docs = window.DZ_LEGAL;
    if(!docs || !docs[type] || !lgEls() || typeof setGo !== 'function') return true;
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
