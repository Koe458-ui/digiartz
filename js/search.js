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
