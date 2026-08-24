// The bar at the top of the document, and the two menus that hang off it.
//
// The bar itself is markup and stylesheet — a wordmark, a row of words, a
// bell. What needs a script is the opening and closing: the hamburger's
// drawer, and the Upload menu on the wide bar. Both want the same care —
// shutting on every way out a menu has (a destination picked, Escape, a click
// on the page, the window crossing the width where that menu has nothing left
// to hang off) and keeping aria-expanded honest for a screen reader that
// cannot see the three rules fold into a cross or the chevron turn over.
//
// Upload is five destinations rather than one, and the second half of this
// file is that list in its two shapes: a panel under the word for a mouse, and
// a row that rolls open inside the drawer for a finger. Both end in dzUpPick,
// so there is one list of five and one way to reach any of them.
//
// Both panels are listed in DZ_PANELS (js/app-core.js) like every other thing
// this app puts on screen, so changing section sweeps them shut without this
// file being asked. That is also why dzMenuClose and dzUpClose are published
// on window: the table names its closers by name.
(function () {
  'use strict';

  var WIDE = '(min-width: 900px)';

  function el(id) { return document.getElementById(id); }
  function menu()  { return el('dzTopMenu'); }
  function ham()   { return el('dzHamBtn'); }
  function scrim() { return el('dzMenuScrim'); }

  function isOpen() {
    var m = menu();
    return !!m && m.classList.contains('open');
  }

  function dzMenuOpen() {
    var m = menu(), h = ham(), s = scrim();
    if (!m || isOpen()) return;
    m.classList.add('open');
    if (s) s.classList.add('on');
    if (h) h.setAttribute('aria-expanded', 'true');
    // The first item, so a keyboard lands inside the panel it just opened
    // rather than behind it. Not on a touch open: focusing an item there
    // leaves it drawn as if the finger were still on it.
    if (!window.matchMedia || !matchMedia('(hover: none)').matches) {
      var first = m.querySelector('.dzMenuItem');
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
    }
  }

  function dzMenuClose() {
    var m = menu(), h = ham(), s = scrim();
    if (!m || !isOpen()) return;
    m.classList.remove('open');
    if (s) s.classList.remove('on');
    if (h) h.setAttribute('aria-expanded', 'false');
    // A sub-list left open would be the state the drawer opens in next time,
    // which is not where anybody left off — it is where somebody left off
    // three sections ago. It folds with the drawer.
    dzMenuSubClose();
    // Hand focus back to the button that opened it, but only if it is still
    // inside the panel: a member who has tapped a destination is on their way
    // somewhere, and pulling focus back to the hamburger would take it off
    // whatever the section they are opening puts up.
    if (h && m.contains(document.activeElement)) {
      try { h.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function dzMenuToggle() {
    if (isOpen()) dzMenuClose(); else dzMenuOpen();
  }

  /* Search, from wherever you are.
     One search on this site — every approved artwork, plus the listings,
     posts, resources and jobs — and it is the page the gallery's own search
     button opens. This is the same call, so the two cannot become two
     searches. */
  function dzOpenSearch() {
    dzMenuClose();
    if (typeof window.openFgSearch === 'function') window.openFgSearch();
  }

  /* ── Upload, and the five things it means ───────────────────────────────
     An artwork, a product listing, a blog post, a resource and a job posting
     are five forms with five sets of rules. Upload used to be one word that
     opened the artwork form with a row of chips above it, so four of the five
     were somewhere else than where the member had been sent. The word names
     all five now, and each of them opens its own form.

     Two shapes for the one list, because the two inputs want different things.
     A mouse wants the panel under the word on the way past it — no click to
     open, no click to shut. A finger has no hover and no room for a panel that
     hangs off a bar, so in the drawer the same five roll out under a row.

     Both end in dzUpPick, so there is one list and one destination table. */

  var UP_SECS = { artwork:1, marketplace:1, blog:1, resources:1, jobs:1 };

  function upWrap() { return el('dzUpWrap'); }
  function upBtn()  { return el('dzUpBtn'); }
  function upIsOpen() {
    var w = upWrap();
    return !!w && w.classList.contains('open');
  }

  // Closing on the pointer leaving is on a short delay. The panel sits a few
  // pixels below the word, and a pointer crossing that gap has left the word
  // before it has arrived at the panel — shutting on that reading is a menu
  // that cannot be reached with a mouse.
  var upTimer = null;
  function upCancel() { if (upTimer) { clearTimeout(upTimer); upTimer = null; } }

  function dzUpOpen() {
    upCancel();
    var w = upWrap(), b = upBtn();
    if (!w || upIsOpen()) return;
    w.classList.add('open');
    if (b) b.setAttribute('aria-expanded', 'true');
  }

  function dzUpClose() {
    upCancel();
    var w = upWrap(), b = upBtn();
    if (!w || !upIsOpen()) return;
    w.classList.remove('open');
    if (b) b.setAttribute('aria-expanded', 'false');
    // Focus goes back to the word only if it is still inside the panel being
    // shut: somebody who has chosen a destination is on their way there, and
    // pulling focus back to the bar takes it off what they just opened.
    if (b && w.contains(document.activeElement)) {
      try { b.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  // The click half, for a keyboard and for a touch screen wide enough to be
  // showing the bar's own links. A mouse has usually opened it on the way in,
  // so a click on the word closes it again rather than re-opening it.
  function dzUpToggle(e) {
    if (e) e.preventDefault();
    if (upIsOpen()) dzUpClose(); else dzUpOpen();
  }

  /* ── the drawer's Upload row ───────────────────────────────────────────── */
  function upGrp() { return el('dzMenuUpGrp'); }

  function dzMenuSubToggle() {
    var g = upGrp(), b = el('dzMenuUpBtn');
    if (!g) return;
    var on = !g.classList.contains('open');
    g.classList.toggle('open', on);
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function dzMenuSubClose() {
    var g = upGrp(), b = el('dzMenuUpBtn');
    if (!g || !g.classList.contains('open')) return;
    g.classList.remove('open');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  /* Where all ten of those buttons end up. Both menus shut first — the one
     that was used and the one that was not — so nothing is left hanging over
     the form that is about to open. */
  function dzUpPick(sec) {
    if (!UP_SECS[sec]) sec = 'artwork';
    dzUpClose();
    dzMenuClose();
    if (typeof window.bnGoUpload === 'function') window.bnGoUpload(sec);
  }

  // dzMenuOpen is not published: the only ways in are the button and the
  // toggle, and an exported opener nothing calls is a promise to keep.
  window.dzMenuClose     = dzMenuClose;
  window.dzMenuToggle    = dzMenuToggle;
  window.dzMenuSubToggle = dzMenuSubToggle;
  window.dzMenuSubClose  = dzMenuSubClose;
  window.dzOpenSearch    = dzOpenSearch;
  window.dzUpToggle      = dzUpToggle;
  window.dzUpClose       = dzUpClose;
  window.dzUpPick        = dzUpPick;

  // A tap anywhere but the drawer and the button that opened it. The scrim
  // starts under the bar and catches the page; this catches the rest, which is
  // the bar itself — without it a tap on the wordmark or the bell would leave
  // the drawer hanging open under a bar nobody is pointing at any more.
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    var m = menu(), h = ham();
    var t = e.target;
    if ((m && m.contains(t)) || (h && h.contains(t))) return;
    dzMenuClose();
  }, true);

  /* The Upload menu's own way out. Same reading as the drawer's: a click that
     landed neither in the panel nor on the word that owns it is a click
     somewhere else, and somewhere else closes it. */
  document.addEventListener('click', function (e) {
    if (!upIsOpen()) return;
    var w = upWrap();
    if (w && w.contains(e.target)) return;
    dzUpClose();
  }, true);

  /* Hover, for a pointer that has one. Bound on the wrapper, which contains
     the panel as well as the word, so moving down the list is not a series of
     leavings. Delegated rather than bound to the node, because this file runs
     before nothing in particular and the bar is markup either way. */
  if (!window.matchMedia || matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', function (e) {
      var w = upWrap();
      if (w && w.contains(e.target)) dzUpOpen();
    });
    document.addEventListener('mouseout', function (e) {
      var w = upWrap();
      if (!w || !upIsOpen()) return;
      if (!w.contains(e.target)) return;
      // Where the pointer went, not where it was: moving from the word to the
      // panel leaves the word but never the wrapper.
      var to = e.relatedTarget;
      if (to && w.contains(to)) return;
      upCancel();
      upTimer = setTimeout(dzUpClose, 180);
    });
  }

  // Escape, before anything else this app closes on Escape: the menu is the
  // topmost thing on screen while it is up, and the handler in js/pfedit.js
  // would otherwise close the section underneath it instead.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // The Upload menu is the shallower of the two and goes first: it can be
    // open on the wide bar with no drawer behind it at all.
    if (upIsOpen()) { e.stopPropagation(); dzUpClose(); return; }
    if (!isOpen()) return;
    e.stopPropagation();
    dzMenuClose();
  }, true);

  // The hamburger is gone past 900px and its panel hangs off nothing. A window
  // dragged wider with the menu up used to be the one way to see that.
  if (window.matchMedia) {
    var mq = matchMedia(WIDE);
    // Narrowing puts the bar's links away, and with them the word the Upload
    // panel hangs off. Widening puts the hamburger away, and with it the
    // drawer. Each direction closes what the other width does not have.
    var onWide = function () { if (mq.matches) dzMenuClose(); else dzUpClose(); };
    if (mq.addEventListener) mq.addEventListener('change', onWide);
    else if (mq.addListener) mq.addListener(onWide);
  }
})();
