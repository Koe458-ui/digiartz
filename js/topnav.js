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
// Explore and Upload are each five destinations rather than one, and the
// second half of this file is those two lists in their two shapes: a panel
// under the word for a mouse, and a row that rolls open inside the drawer for
// a finger. One set of functions drives both menus — they differ only in which
// five they list and where a pick goes.
//
// The panels are listed in DZ_PANELS (js/app-core.js) like every other thing
// this app puts on screen, so changing section sweeps them shut without this
// file being asked. That is also why the closers are published on window: the
// table names them by name.
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
    // three sections ago. Both fold with the drawer.
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

  /* ── The two menus on the bar ───────────────────────────────────────────
     Explore is five sections and Upload is five forms. Both used to be one
     word: Explore opened the gallery on its Artworks grid with a chip row
     above it for the other four, and Upload opened the artwork form with a
     chip row above it for the other four. In both cases four of the five were
     somewhere other than where the member had been sent, and the page they
     landed on named none of them.

     The bar names all ten now, in two menus that behave identically — the
     code below is one implementation with a table of two, because a second
     copy of it is how the two would start drifting apart.

     Two shapes for each list, because the two inputs want different things. A
     mouse wants the panel under the word on the way past it — no click to
     open, no click to shut. A finger has no hover and no room for a panel
     hanging off a bar, so in the drawer the same five roll out under a row.

     Every entry in both shapes ends in the menu's own `pick`, so each list has
     one destination table however it was reached. */

  var MENUS = {
    ex: {
      wrap:'dzExWrap', btn:'dzExBtn', grp:'dzMenuExGrp', grpBtn:'dzMenuExBtn',
      secs:{ artworks:1, marketplace:1, blog:1, resources:1, jobs:1 },
      fallback:'artworks',
      /* Four of the five have a url, so the entry is an anchor and the router
         is what opens it — the click is left alone and only the menus are
         shut. Jobs has none (see functions/_middleware.js on why), so it is a
         button and goes straight to the gallery. */
      pick: function (sec, e) {
        var path = (typeof window.dzRoutePath === 'function') ? window.dzRoutePath(sec) : null;
        if (path && typeof window.dzRouteGo === 'function' && window.dzRouteGo(path)) {
          if (e) e.preventDefault();
          return;
        }
        if (e) e.preventDefault();
        if (typeof window.bnGoGallery === 'function') window.bnGoGallery();
        else if (typeof window.openFG === 'function') window.openFG();
        if (typeof window.fgSwitchSection === 'function') window.fgSwitchSection(sec);
      }
    },
    up: {
      wrap:'dzUpWrap', btn:'dzUpBtn', grp:'dzMenuUpGrp', grpBtn:'dzMenuUpBtn',
      secs:{ artwork:1, marketplace:1, blog:1, resources:1, jobs:1 },
      fallback:'artwork',
      pick: function (sec) {
        if (typeof window.bnGoUpload === 'function') window.bnGoUpload(sec);
      }
    }
  };

  function wrapOf(k) { return el(MENUS[k].wrap); }
  function ddIsOpen(k) {
    var w = wrapOf(k);
    return !!w && w.classList.contains('open');
  }
  // which menu, if any, this node belongs to
  function menuAt(node) {
    for (var k in MENUS) {
      var w = wrapOf(k);
      if (w && w.contains(node)) return k;
    }
    return null;
  }

  // Closing on the pointer leaving is on a short delay. The panel sits a few
  // pixels below the word, and a pointer crossing that gap has left the word
  // before it has arrived at the panel — shutting on that reading is a menu
  // that cannot be reached with a mouse.
  var ddTimer = null;
  function ddCancel() { if (ddTimer) { clearTimeout(ddTimer); ddTimer = null; } }

  function ddOpen(k) {
    ddCancel();
    // One at a time. The two words sit next to each other, and a pointer
    // sliding from one to the other would otherwise leave both panels down.
    for (var o in MENUS) if (o !== k) ddClose(o);
    var w = wrapOf(k), b = el(MENUS[k].btn);
    if (!w || ddIsOpen(k)) return;
    w.classList.add('open');
    if (b) b.setAttribute('aria-expanded', 'true');
  }

  function ddClose(k) {
    var w = wrapOf(k), b = el(MENUS[k].btn);
    if (!w || !w.classList.contains('open')) return;
    w.classList.remove('open');
    if (b) b.setAttribute('aria-expanded', 'false');
    // Focus goes back to the word only if it is still inside the panel being
    // shut: somebody who has chosen a destination is on their way there, and
    // pulling focus back to the bar takes it off what they just opened.
    if (b && w.contains(document.activeElement)) {
      try { b.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function ddCloseAll() {
    ddCancel();
    for (var k in MENUS) ddClose(k);
  }

  // The click half, for a keyboard and for a touch screen wide enough to be
  // showing the bar's own links. A mouse has usually opened it on the way in,
  // so a click on the word closes it again rather than re-opening it.
  function ddToggle(k, e) {
    if (e) e.preventDefault();
    if (ddIsOpen(k)) ddClose(k); else ddOpen(k);
  }

  /* ── the drawer's own rows ─────────────────────────────────────────────── */
  function dzMenuSubToggle(k) {
    var m = MENUS[k]; if (!m) return;
    var g = el(m.grp), b = el(m.grpBtn);
    if (!g) return;
    var on = !g.classList.contains('open');
    // One open at a time here too, so the drawer never grows past the screen
    // with both lists of five down at once.
    if (on) for (var o in MENUS) if (o !== k) subClose(o);
    g.classList.toggle('open', on);
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function subClose(k) {
    var m = MENUS[k]; if (!m) return;
    var g = el(m.grp), b = el(m.grpBtn);
    if (!g || !g.classList.contains('open')) return;
    g.classList.remove('open');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function dzMenuSubClose() { for (var k in MENUS) subClose(k); }

  /* Where all twenty of those entries end up. Both menus and the drawer shut
     first — the one that was used and the ones that were not — so nothing is
     left hanging over the page that is about to open. */
  function pick(k, sec, e) {
    var m = MENUS[k];
    if (!m.secs[sec]) sec = m.fallback;
    ddCloseAll();
    dzMenuClose();
    m.pick(sec, e);
  }
  function dzExPick(sec, e) { pick('ex', sec, e); }
  function dzUpPick(sec, e) { pick('up', sec, e); }

  // dzMenuOpen is not published: the only ways in are the button and the
  // toggle, and an exported opener nothing calls is a promise to keep.
  window.dzMenuClose     = dzMenuClose;
  window.dzMenuToggle    = dzMenuToggle;
  window.dzMenuSubToggle = dzMenuSubToggle;
  window.dzMenuSubClose  = dzMenuSubClose;
  window.dzOpenSearch    = dzOpenSearch;
  window.dzExToggle      = function (e) { ddToggle('ex', e); };
  window.dzUpToggle      = function (e) { ddToggle('up', e); };
  // named closers, because DZ_PANELS names its closers by name
  window.dzExClose       = function () { ddClose('ex'); };
  window.dzUpClose       = function () { ddClose('up'); };
  window.dzExPick        = dzExPick;
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

  /* The bar menus' own way out. Same reading as the drawer's: a click that
     landed in neither panel nor on either word is a click somewhere else, and
     somewhere else closes them. */
  document.addEventListener('click', function (e) {
    if (!menuAt(e.target)) ddCloseAll();
  }, true);

  /* Hover, for a pointer that has one. Read off the wrapper, which contains
     the panel as well as the word, so moving down a list is not a series of
     leavings. Delegated rather than bound to the nodes, because this file runs
     before nothing in particular and the bar is markup either way. */
  if (!window.matchMedia || matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', function (e) {
      var k = menuAt(e.target);
      if (k) ddOpen(k);
    });
    document.addEventListener('mouseout', function (e) {
      var k = menuAt(e.target);
      if (!k || !ddIsOpen(k)) return;
      // Where the pointer went, not where it was: moving from the word to the
      // panel leaves the word but never the wrapper. Landing on the other
      // word is a leaving, and its own mouseover opens that one.
      var to = e.relatedTarget;
      if (to && wrapOf(k).contains(to)) return;
      ddCancel();
      ddTimer = setTimeout(function () { ddClose(k); }, 180);
    });
  }

  // Escape, before anything else this app closes on Escape: the menu is the
  // topmost thing on screen while it is up, and the handler in js/pfedit.js
  // would otherwise close the section underneath it instead.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // A bar menu is the shallowest thing here and goes first: one can be open
    // on the wide bar with no drawer behind it at all.
    for (var k in MENUS) {
      if (ddIsOpen(k)) { e.stopPropagation(); ddClose(k); return; }
    }
    if (!isOpen()) return;
    e.stopPropagation();
    dzMenuClose();
  }, true);

  // The hamburger is gone past 900px and its panel hangs off nothing. A window
  // dragged wider with the menu up used to be the one way to see that.
  if (window.matchMedia) {
    var mq = matchMedia(WIDE);
    // Narrowing puts the bar's links away, and with them the words the two
    // panels hang off. Widening puts the hamburger away, and with it the
    // drawer. Each direction closes what the other width does not have.
    var onWide = function () { if (mq.matches) dzMenuClose(); else ddCloseAll(); };
    if (mq.addEventListener) mq.addEventListener('change', onWide);
    else if (mq.addListener) mq.addListener(onWide);
  }
})();
