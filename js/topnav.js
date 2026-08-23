// The bar at the top of the document, and the menu behind its hamburger.
//
// The bar itself is markup and stylesheet — a wordmark, a row of words, a
// bell. What needs a script is the hamburger: opening and closing the panel it
// owns, closing it again on every way out a menu has (a destination picked,
// Escape, a tap on the page, the window widening past the point where there is
// no hamburger any more), and keeping aria-expanded honest for a screen reader
// that cannot see the three rules fold into a cross.
//
// The panel is listed in DZ_PANELS (js/app-core.js) like every other thing
// this app puts on screen, so changing section sweeps it shut without this
// file being asked. That is also why dzMenuClose is published on window: the
// table names the closer by name.
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

  // dzMenuOpen is not published: the only ways in are the button and the
  // toggle, and an exported opener nothing calls is a promise to keep.
  window.dzMenuClose  = dzMenuClose;
  window.dzMenuToggle = dzMenuToggle;
  window.dzOpenSearch = dzOpenSearch;

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

  // Escape, before anything else this app closes on Escape: the menu is the
  // topmost thing on screen while it is up, and the handler in js/pfedit.js
  // would otherwise close the section underneath it instead.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation();
    dzMenuClose();
  }, true);

  // The hamburger is gone past 900px and its panel hangs off nothing. A window
  // dragged wider with the menu up used to be the one way to see that.
  if (window.matchMedia) {
    var mq = matchMedia(WIDE);
    var onWide = function () { if (mq.matches) dzMenuClose(); };
    if (mq.addEventListener) mq.addEventListener('change', onWide);
    else if (mq.addListener) mq.addListener(onWide);
  }
})();
