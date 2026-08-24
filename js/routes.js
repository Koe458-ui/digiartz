// Public section routes.
//
// Every important public destination on this site is a panel that slides over
// the home document — the gallery overlay (#fg) and the community page
// (#communityPage) — and until now the only way into one was a click handler.
// That is fine for a member and invisible to everyone else: a crawler cannot
// press a button, a member cannot bookmark what they are reading, and the
// address bar said "digiartz.net" whichever of the sections was open.
//
// So each of those destinations gets a real url, and this file is the one
// place that knows which url opens which panel. Nothing here replaces the
// panels or duplicates them; it opens the same functions the buttons always
// called, and puts the address bar in step.
//
//   /explore      gallery, Artworks
//   /marketplace  gallery, Marketplace
//   /resources    gallery, Resources
//   /blog         gallery, Blog
//   /community    the community page
//   /             home, every panel shut
//
// /login is deliberately absent: js/auth.js has owned that path since the
// sign-in sheet learned to write it, and two owners for one url is how the
// address ends up fighting itself. Clicking a /login link falls through to
// openAuthMod below, which is auth.js's own function.
//
// Each of these paths is also an SPA fallback in _redirects and a cache rule
// in _headers — a route with no fallback is a hosting-level 404, which is
// exactly what /explore was before this file existed. Keep the three lists in
// step.
(function () {
  'use strict';

  // Which panel each path opens, and how. `section` is the gallery chip the
  // route lands on; `panel` is the element whose open class means "this route
  // is on screen", and is what tells the watcher below which route a closing
  // panel belongs to.
  var ROUTES = {
    '/':            { panel: null,            open: home },
    '/explore':     { panel: 'fg',            open: gallery('artworks'),    section: 'artworks' },
    '/marketplace': { panel: 'fg',            open: gallery('marketplace'), section: 'marketplace' },
    '/resources':   { panel: 'fg',            open: gallery('resources'),   section: 'resources' },
    '/blog':        { panel: 'fg',            open: gallery('blog'),        section: 'blog' },
    '/community':   { panel: 'communityPage', open: community },
    // Not a panel route — auth.js pushes and restores /login itself — but
    // listed so a click on a /login link opens the sheet rather than
    // reloading the whole app to arrive at the same place.
    '/login':       { panel: null,            open: login, foreign: true }
  };

  // Which gallery chip is a route, for the watcher that follows the chip row.
  var SECTION_PATH = {};
  Object.keys(ROUTES).forEach(function (p) {
    if (ROUTES[p].section) SECTION_PATH[ROUTES[p].section] = p;
  });

  // The item viewer's own urls (js/sections.js), and the artwork and profile
  // deep links. This file does not own any of them and must not close a panel
  // that another module opened, so a popstate onto one of these is left alone.
  var FOREIGN_RE = /^\/(?:artwork|profile|resource|blog|listing|job)\/./;

  function el(id) { return document.getElementById(id); }
  function isOpen(id) {
    var n = el(id);
    return !!(n && n.classList.contains('open'));
  }
  function fn(name) {
    return typeof window[name] === 'function' ? window[name] : null;
  }

  // Which of the gallery's sections is showing. Read off the panel that is
  // open rather than out of gallery.js, whose fgSection is private to that
  // file — and the open panel is the thing the member is actually looking at.
  // It used to read the lit chip, back when there was a chip row to read.
  function activeSection() {
    var p = document.querySelector('#fg .fgSec.active');
    return p ? String(p.id).replace('fgSec-', '') : null;
  }

  // Openers. Each one calls the function the button always called, so a route
  // and a tap land in exactly the same state.
  function gallery(section) {
    return function () {
      var go = fn('bnGoGallery') || fn('openFG');
      if (go) go();
      var sw = fn('fgSwitchSection');
      if (sw && section) sw(section);
    };
  }
  function community() {
    var go = fn('bnGoCommunity');
    if (go) go();
  }
  function home() {
    var go = fn('bnGoHome');
    if (go) go();
  }
  function login() {
    var go = fn('openAuthMod');
    if (go) go();
  }

  // History bookkeeping, the same shape the artwork viewer and the sign-in
  // sheet already use: one entry for the whole visit to these panels, and the
  // address the visit started from so closing can hand it back.
  //
  // `pushed` means the entry currently in the bar is this visit's, and so is
  // ours to swap the address on rather than stack another one over. A
  // popstate clears it: the browser has moved, and the entry it landed on
  // belongs to wherever it came from.
  var pushed = false;
  var returnUrl = null;
  // True while a route is being opened, so the chip watcher does not rewrite
  // the address off the intermediate section openFG lands on first.
  var opening = false;
  // Whether the panel on screen was opened by a route. Not the same question
  // as `pushed`, which a popstate clears, and the difference is a regression
  // this flag exists to prevent: the gallery can also be opened by the hero
  // call to action with the address left on the home page, and stepping Back
  // out of an artwork opened from there has always returned the reader to the
  // grid. Without this, "Back to /" would read as "close the gallery" and
  // shut it under them.
  var owns = false;

  function run(r) {
    opening = true;
    try { r.open(); } finally { opening = false; }
    if (r.panel) owns = true;
  }

  /* THE ADDRESS OF THE SECTION ON SCREEN, and the one function that writes it.

     One entry for the whole visit into these panels, however many sections it
     walks through: the first one pushes, every one after it swaps. So Back is
     a single press out of the app's panels from anywhere inside them, rather
     than a walk back through every section you looked at.

     `path` null means the member is somewhere with no public address — home,
     or the upload page, which is one member's draft and not a page. The bar
     goes back to where the visit came from. It used to be left alone, and
     that is a bug with a delay on it: the address went on naming the section
     that had just been closed, so the next refresh opened it again.

     This does NOT step history back, and that is the whole of the first
     report. Closing the community page used to do exactly that, which walked
     onto whatever entry happened to be behind it — /profile/<name>, two taps
     ago — and js/gallery.js's popstate handler then opened the profile over
     the page the member had just tapped through to. A step back is a
     navigation: it is asynchronous, it fires popstate, and every other module
     that answers popstate answers it too. Closing a panel is not a
     navigation, so it swaps the address in place and nothing else moves. */
  function address(path) {
    try {
      if (path) {
        owns = true;
        if (window.location.pathname === path) {
          /* Already the address in the bar, so there is nothing to write and
             — this is the part that matters — nothing to record as the way
             back. We arrived here by Back, or by opening this url directly,
             and in both cases the entry under us is the browser's rather than
             ours. Claiming it as a return address pointed the way out of the
             gallery AT the gallery. The entry is still ours to swap on the
             next move, which is what `pushed` means from here. */
          pushed = true;
          return;
        }
        if (pushed) {
          history.replaceState({ dzr: 1 }, '', path);
        } else {
          returnUrl = window.location.pathname + window.location.search;
          history.pushState({ dzr: 1 }, '', path);
          pushed = true;
        }
      } else {
        owns = false;
        // The way back, unless it is an address that would itself open
        // something. The visit may have started at an artwork, and handing
        // the bar back to /artwork/<id> with the viewer shut is the very
        // thing being fixed, one step removed. '/' is the only address that
        // opens nothing.
        var back = returnUrl && !addressOfAClosedPanel(returnUrl) ? returnUrl : '/';
        // Nothing to hand back if the bar is already somewhere harmless.
        if (window.location.pathname !== '/' &&
            window.location.pathname + window.location.search !== back) {
          history.replaceState({ dzr: 1 }, '', back);
        }
      }
    } catch (e) {}
  }
  window.dzRouteAddress = address;

  function enter(path) {
    var r = ROUTES[path];
    if (!r) return;
    if (r.foreign) { r.open(); return; }   // auth.js writes its own address

    if (window.dzNavBegin) window.dzNavBegin();
    try { run(r); } finally { if (window.dzNavEnd) window.dzNavEnd(); }
    // After the open, not before it: the openers sweep whatever was up on
    // their way in, and a sweep is where the stale-address handlers live.
    // Writing the address last means the move gets the last word on it.
    // Home has no address of its own, so it asks for the bar to be made true
    // rather than claiming one.
    if (r.panel) address(path); else audit();
  }

  /* Which panel the address currently in the bar is the address OF.

     Every one of these paths re-opens its panel on a reload — that is what
     makes them worth having — so an address naming a panel that is not open
     is a refresh away from opening something the member did not ask for.
     Listed by pattern rather than by exact path because four of them belong
     to a row of items rather than to one page. */
  var ADDRESSED = [
    { re: /^\/(?:explore|marketplace|resources|blog)\/?$/, panel: 'fg' },
    { re: /^\/community\/?$/,                             panel: 'communityPage' },
    { re: /^\/profile\/./,                                panel: 'profilePage' },
    { re: /^\/artwork\/./,                                panel: 'artModal' },
    { re: /^\/(?:resource|blog|listing|job)\/./,          panel: 'dzView' },
    { re: /^\/login\/?$/,                                 panel: 'authMod' }
  ];

  /* THE INVARIANT: the address never names a panel that is not on screen.

     Every module that opens a panel with an address of its own is supposed to
     hand that address back when the panel closes, and most of the time each
     of them does. What none of them can see is the other five: a panel closed
     by somebody else's sweep, by a close that bailed out early because the
     class had already gone, by a failed load — each of those leaves an
     address behind that the next reload will act on.

     So rather than one more rule per module, the rule is checked. Any panel
     closing sets this off; if the bar names a panel that is not open, the bar
     is wrong and is put back. It cannot fix a missing close, and it is not
     meant to: it makes the address bar's claim true, which is what a reload,
     a share and the Back button all read. */
  // Does this url name a panel that is not on screen? True means a reload of
  // it would open something the member is not looking at.
  function addressOfAClosedPanel(url) {
    var p = String(url).split('#')[0].split('?')[0];
    for (var i = 0; i < ADDRESSED.length; i++) {
      if (ADDRESSED[i].re.test(p)) return !isOpen(ADDRESSED[i].panel);
    }
    return false;
  }

  var auditTimer = null;
  function audit() {
    auditTimer = null;
    if (addressOfAClosedPanel(window.location.pathname)) address(null);
  }
  /* Called after a move that had no address of its own to write — Home, the
     upload page — where "no address" is not the same as "the home address".
     A guest tapping Profile gets the sign-in sheet, and /login is the right
     thing for the bar to say; the audit knows that because the sheet is open.
     Overwriting it with '/' unconditionally would have been the same class of
     bug this whole file is about, in the other direction. */
  window.dzRouteAudit = audit;

  /* A panel closed. Which panel, and by whose hand, does not matter: the
     question is only whether the address is still true, and it is asked one
     task later — a close and the open that replaces it are two separate
     statements, and the moment between them is not a state to judge. A move
     in progress answers it itself, at the end, so this stands down for one. */
  function auditSoon() {
    if (window.dzNavMoving && window.dzNavMoving()) return;
    if (auditTimer) return;
    auditTimer = setTimeout(function () {
      auditTimer = null;
      if (window.dzNavMoving && window.dzNavMoving()) return;
      audit();
    }, 0);
  }

  // The browser moved. Put the panels where the new address says they should
  // be — and only where it says: an address this file does not own belongs to
  // whichever module pushed it.
  function sync() {
    var path = window.location.pathname;
    var r = ROUTES[path];

    // An artwork, a profile, a listing — js/gallery.js, js/profile.js and
    // js/sections.js each answer their own deep links, and one of those
    // panels standing over an open gallery is a normal state to be in.
    if (FOREIGN_RE.test(path)) return;
    // /login, likewise: js/auth.js opens and closes the sheet on its own.
    if (r && r.foreign) return;

    if (!r || !r.panel) {
      // Back out of a route, so the panel that route opened goes with it —
      // but only that one. A gallery opened from the hero, with the address
      // never having left the home page, is not this file's to close.
      if (owns) home();
      return;
    }

    if (!isOpen(r.panel)) run(r);
    else {
      owns = true;
      if (r.section && activeSection() !== r.section) {
        var sw = fn('fgSwitchSection');
        if (sw) sw(r.section);
      }
    }
  }

  window.addEventListener('popstate', function () {
    pushed = false;
    returnUrl = null;
    sync();
  });

  // Links. Every routed destination on the page is a real anchor with a real
  // href, so this listener is an enhancement and not the mechanism: with it
  // the panel slides open and the app keeps its state, without it the browser
  // follows the href and the page boots into the same section. Modified
  // clicks — a new tab, a download, a middle button — are left to the browser,
  // which is the whole point of them.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.origin !== window.location.origin) return;
    if (!ROUTES[a.pathname] || a.search || a.hash) return;
    e.preventDefault();
    enter(a.pathname);
  });

  // The address follows whichever section is on screen: landing on Blog
  // leaves the bar reading /blog, and that url shares and refreshes to the
  // same place.
  //
  // Watched rather than wrapped around fgSwitchSection, because the section
  // moves by more than one route — the bar's Explore menu, a route arriving,
  // openFG resetting to Artworks — and only a watcher sees all of them.
  function chipMoved() {
    if (opening || !owns) return;
    if (!isOpen('fg')) return;
    var path = SECTION_PATH[activeSection()];
    var here = ROUTES[window.location.pathname];
    // Only rewrite an address this file put there. Jobs has no public url —
    // the section is deliberately not one this site puts forward to search,
    // see functions/_middleware.js — and a section opened while the bar is on
    // an artwork or a listing has not taken the address over.
    if (!here || here.panel !== 'fg') return;
    try {
      if (path) { if (path !== window.location.pathname) history.replaceState({ dzr: 1 }, '', path); }
      else {
        // Jobs. No public url, so the address goes back to where the visit
        // came from rather than inventing one.
        history.replaceState({}, '', returnUrl || '/');
        pushed = false; returnUrl = null; owns = false;
      }
    } catch (e) {}
  }

  if (window.MutationObserver) {
    /* The gallery's own panels. One of the five carries .active at a time and
       fgSwitchSection is what moves it, so watching the container catches
       every way that class can land — including the ones this file did not
       cause. It watched the chip row for the same reason, until there stopped
       being one. */
    var gal = el('fg');
    if (gal) {
      new MutationObserver(chipMoved)
        .observe(gal, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    /* Every panel with an address, and not just this file's two. The two are
       the ones this file opens; the rest are opened by js/gallery.js,
       js/profile.js, js/sections.js and js/auth.js, and it is precisely the
       ones nobody here is watching whose addresses were being left behind. */
    ADDRESSED.forEach(function (a) {
      var node = el(a.panel);
      if (!node) return;
      var was = node.classList.contains('open');
      new MutationObserver(function () {
        var now = node.classList.contains('open');
        if (was && !now) auditSoon();
        was = now;
      }).observe(node, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // Anything else that wants to move between these destinations — the hero
  // call to action, the quick links rail — goes through here, so there is one
  // answer to "what happens when you go to the marketplace" rather than one
  // per caller.
  window.dzRouteGo = function (path) {
    if (!ROUTES[path]) return false;
    enter(path);
    return true;
  };
  /* The gallery's own name for a section, mapped to that section's url —
     `artworks` is what the chip row, the hero call to action and the feed's
     log rows all call the grid, and it is /explore. Only the gallery chips are
     here: those are the only names that reach this, because the community page
     and the sign-in sheet are linked by anchors that carry their url already.

     There was an alias table beside this for `community` and `explore`. Every
     id that can arrive here comes from one of three lists — the hero's tabs,
     the quick link onclicks, and LOG_KINDS in js/feed.js — and neither name
     appears in any of them, so both entries were unreachable from the day
     they were written. */
  window.dzRoutePath = function (id) { return SECTION_PATH[id] || null; };

  // Boot. A member who opened /marketplace directly, or followed one out of a
  // search result, arrives at the home document with nothing open — this is
  // what opens it. '/' is the one entry with nothing to do.
  //
  // /login is opened here as well. It used to be opened by js/startup.js,
  // after that file's await on the gallery load, which made the sign-in sheet
  // wait on a fetch it has nothing to do with. Nothing on this line needs the
  // database.
  var r0 = ROUTES[window.location.pathname];
  if (r0 && (r0.panel || r0.foreign)) run(r0);
})();
