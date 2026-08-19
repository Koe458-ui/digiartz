// theme engine
(function () {
  'use strict';

  var KEY   = 'koeTheme';
  var VALID = { graydark:1, light:1 };
  var META  = { graydark:'#1A1A1F', light:'#F7F5EB' };
  var page  = document.getElementById('themePage');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.thmCard'));
  var lastFocus = null;
  var prevOverflow = { body:'', doc:'' };

  function saved () {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return VALID[v] ? v : 'graydark';
  }

  /* Which theme a card stands for, read from either carrier it ships with.
     index.html writes the id twice — data-theme for the stylesheet, value for
     this — because everything the picker does hangs off getting it back: the
     click applies it, syncCards ticks the matching card, and a card whose id
     does not resolve is a card that silently does nothing when tapped. Two
     independent attributes in the same tag cost nothing and mean one of them
     failing to arrive is not a dead picker. */
  function idOf (c) {
    var v = c.getAttribute('data-theme') || c.getAttribute('value');
    return VALID[v] ? v : null;
  }

  // swap tokens at once
  function paint (t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', META[t]);
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', t === 'light' ? 'light' : 'dark');
    syncCards(t);
  }

  // fade during swap
  var fadeTimer = null;
  function fade () {
    var root = document.documentElement;
    root.classList.add('thmFade');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { root.classList.remove('thmFade'); }, 360);
  }

  function apply (t) {
    if (!VALID[t]) return;
    try { localStorage.setItem(KEY, t); } catch (e) {}
    var reduce = window.matchMedia &&
                 matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && t !== document.documentElement.getAttribute('data-theme')) fade();
    paint(t);
  }

  // roving tabindex
  function syncCards (t) {
    cards.forEach(function (c) {
      var on = idOf(c) === t;
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
  }

  cards.forEach(function (c, i) {
    c.addEventListener('click', function () { apply(idOf(c)); });
    c.addEventListener('keydown', function (e) {
      var j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % cards.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + cards.length) % cards.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End')  j = cards.length - 1;
      if (j === null) return;
      e.preventDefault();
      apply(idOf(cards[j]));
      cards[j].focus();
    });
  });

  // page open and close
  function openThemePage () {
    if (!page) return;
    lastFocus = document.activeElement;
    syncCards(saved());
    page.classList.add('open');
    prevOverflow.body = document.body.style.overflow;
    prevOverflow.doc  = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    var sel = cards.filter(function (c) { return c.tabIndex === 0; })[0];
    if (sel) sel.focus({ preventScroll: true });
  }
  function closeThemePage () {
    if (!page) return;
    page.classList.remove('open');
    document.body.style.overflow = prevOverflow.body;
    document.documentElement.style.overflow = prevOverflow.doc;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && page && page.classList.contains('open')) closeThemePage();
  });

  window.openThemePage  = openThemePage;
  window.closeThemePage = closeThemePage;

  // sync cards on boot
  syncCards(saved());
})();
