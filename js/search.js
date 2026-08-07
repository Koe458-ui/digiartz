// gallery search
  var fgQTimer = null;

  function tgSearchChrome(wrapId, v){
    var w = document.getElementById(wrapId);
    if(w) w.classList.toggle('tgHasQ', !!String(v || '').length);
  }
  function fgSearchInput(v){
    tgSearchChrome('fgSearchInWrap', v);
    clearTimeout(fgQTimer);
    fgQTimer = setTimeout(function(){
      if(typeof renderFG === 'function') renderFG();
    }, 140);
  }
  function fgSearchClear(){
    var el = document.getElementById('fgSearchIn');
    if(el){ el.value = ''; el.focus(); }
    fgSearchInput('');
  }

  // The hero page has no search box of its own any more — the shortcut
  // belongs to the gallery, and only while it is open.
  document.addEventListener('keydown', function(e){
    if(e.key !== 'k' && e.key !== 'K') return;
    if(!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var fg = document.getElementById('fg');
    if(!fg || !fg.classList.contains('open')) return;
    // whichever section is open owns the box the shortcut lands in
    var el = fg.querySelector('.fgSearchBlock.active .tgSearchIn');
    if(!el) return;
    e.preventDefault();
    el.focus();
    el.select();
  });
  // the hint reads ⌘ in the markup, which is wrong everywhere but a Mac
  (function(){
    if(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')) return;
    var els = document.querySelectorAll('.tgSearchKbd .tgKbdMod');
    for(var i = 0; i < els.length; i++) els[i].textContent = 'Ctrl';
  })();


  function openSubscription() {
    closeMenu();
    var el = document.getElementById('subPage');
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if(typeof zeoSectionTrigger==='function') zeoSectionTrigger();
  }

  function closeSubscription() {
    var el = document.getElementById('subPage');
    if (!el) return;
    el.classList.remove('open');
    restoreScroll();
  }

  function openSubModal() {
    var m = document.getElementById('subModal');
    if (!m) return;
    m.classList.add('subModal--open');
    var btn = m.querySelector('.subModalClose');
    if (btn) setTimeout(function(){ btn.focus(); }, 40);
  }

  function closeSubModal() {
    var m = document.getElementById('subModal');
    if (!m) return;
    m.classList.remove('subModal--open');
  }

  function handleSubModalBackdrop(e) {
    if (e.target === document.getElementById('subModal')) closeSubModal();
  }
