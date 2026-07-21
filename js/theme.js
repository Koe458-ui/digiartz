/* ── theme.js · theme engine ── */
/* ── Theme engine ─────────────────────────────────────────
   Pairs with the pre-paint boot script in <head>. Owns the
   switcher UI, persistence, live prefers-color-scheme
   tracking, page open/close, and keyboard interaction. */
(function () {
  'use strict';

  var KEY   = 'koeTheme';
  var VALID = { dark:1, graydark:1, darkviolet:1, light:1, system:1 };
  var META  = { darkviolet:'#08080D', dark:'#0A0A0E', graydark:'#131317', light:'#F6F6F9' };
  var mq    = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  var page  = document.getElementById('themePage');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.thmCard'));
  var lastFocus = null;
  var prevOverflow = { body:'', doc:'' };

  function savedPref () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return VALID[v] ? v : 'dark';
  }
  function resolve (pref) {
    if (pref !== 'system') return pref;
    return (mq && mq.matches) ? 'light' : 'dark';
  }

  /* Swap every token set at once — one attribute write, so the
     whole app repaints in a single style pass (no reload, no CLS:
     nothing changes size, only colors). */
  function paint (pref) {
    var t = resolve(pref), root = document.documentElement;
    root.setAttribute('data-theme-pref', pref);
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', META[t] || META.dark);
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', t === 'light' ? 'light' : 'dark');
    syncCards(pref);
  }

  /* Smooth cross-browser fade: add html.thmFade in the same style
     pass as the token swap, so every color transition eases; the
     class is removed once the longest transition (.35s) is done. */
  var fadeTimer = null;
  function fade () {
    var root = document.documentElement;
    root.classList.add('thmFade');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { root.classList.remove('thmFade'); }, 360);
  }

  function apply (pref) {
    if (!VALID[pref]) return;
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    var reduce = window.matchMedia &&
                 matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && pref !== document.documentElement.getAttribute('data-theme-pref')) fade();
    paint(pref);
  }

  /* Roving tabindex — the checked card is the group's tab stop. */
  function syncCards (pref) {
    cards.forEach(function (c) {
      var on = c.getAttribute('data-theme') === pref;
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
  }

  cards.forEach(function (c, i) {
    c.addEventListener('click', function () { apply(c.getAttribute('data-theme')); });
    c.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % cards.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + cards.length) % cards.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End')  j = cards.length - 1;
      if (j === null) return;
      e.preventDefault();
      apply(cards[j].getAttribute('data-theme'));
      cards[j].focus();
    });
  });

  /* Follow the OS while "System" is selected. */
  if (mq) {
    var onMq = function () {
      if (savedPref() !== 'system') return;
      var reduce = window.matchMedia &&
                   matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) fade();
      paint('system');
    };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq); /* older Safari */
  }

  /* ── Page open/close — same pattern as the Notifications page ── */
  function openThemePage () {
    if (!page) return;
    lastFocus = document.activeElement;
    syncCards(savedPref());
    page.classList.add('open');
    prevOverflow.body = document.body.style.overflow;
    prevOverflow.doc  = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    var nav = document.getElementById('bnNav');
    if (nav) nav.style.display = 'none';
    var sel = cards.filter(function (c) { return c.tabIndex === 0; })[0];
    if (sel) sel.focus({ preventScroll: true });
  }
  function closeThemePage () {
    if (!page) return;
    page.classList.remove('open');
    document.body.style.overflow = prevOverflow.body;
    document.documentElement.style.overflow = prevOverflow.doc;
    var nav = document.getElementById('bnNav');
    if (nav) nav.style.display = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && page && page.classList.contains('open')) closeThemePage();
  });

  window.openThemePage  = openThemePage;
  window.closeThemePage = closeThemePage;

  /* Boot script already painted pre-render; sync card state now. */
  syncCards(savedPref());
})();
