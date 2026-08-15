// Public section routes.
//
// Every important public destination on this site is a panel that slides over
// the home document — the gallery overlay (#fg) and the community page
// (#communityPage) — and until now the only way into one was a click handler.
// That is fine for a member and invisible to everyone else: a crawler cannot
// press a button, a member cannot bookmark what they are reading, and the
// address bar said "digiartz.net" whichever of the six sections was open.
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
//   /jobs         gallery, Jobs
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
    '/jobs':        { panel: 'fg',            open: gallery('jobs'),        section: 'jobs' },
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

  // Which gallery chip is showing. Read off the DOM rather than out of
  // gallery.js, whose fgSection is private to that file — and the chip row is
  // the thing the member is actually looking at.
  function activeSection() {
    var b = document.querySelector('#fgSecTabs .fgSecBtn.active');
    return b ? String(b.id).replace('fgSecBtn-', '') : null;
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
  // `pushed` means the entry currently in the bar is one this file pushed and
  // can therefore be stepped back off. A popstate clears it: the browser has
  // moved and whatever it landed on is not an entry to step off — stepping
  // back there would walk past where the member just arrived.
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

  function enter(path) {
    var r = ROUTES[path];
    if (!r) return;
    if (r.foreign) { r.open(); return; }   // auth.js writes its own address

    if (r.panel) {
      try {
        if (pushed) {
          // Already inside these panels. The gallery is one place, not one
          // place per section walked through, so the address is swapped
          // rather than stacked — Back leaves in a single press however far
          // along the row you are.
          if (window.location.pathname !== path) history.replaceState({ dzr: 1 }, '', path);
        } else {
          returnUrl = window.location.pathname + window.location.search;
          if (window.location.pathname !== path) history.pushState({ dzr: 1 }, '', path);
          pushed = true;
        }
      } catch (e) {}
    }
    // Home has no address of its own to write: the panel it closes hands the
    // bar back through the watcher below, which is the same path a tap on
    // Home has always taken.
    run(r);
  }

  // A panel that this file's address is pointing at has closed — by the nav,
  // by Escape, by its own close button, it does not matter which. Hand the
  // address back rather than leaving it naming a section nobody is looking at.
  function panelClosed(panelId) {
    var r = ROUTES[window.location.pathname];
    // Not the panel this address names, so this close is somebody else's:
    // moving between two routes shuts the outgoing panel on the way in, and
    // the address is already pointing at the incoming one by the time this
    // runs. Leaving `owns` alone matters — clearing it here left the panel
    // that had JUST opened disowned, and Back then walked off the route with
    // it still on screen.
    if (!r || r.panel !== panelId) return;
    owns = false;
    try {
      if (pushed) { pushed = false; history.back(); }
      else history.replaceState({}, '', returnUrl || '/');
    } catch (e) {}
    returnUrl = null;
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

  // The chip row is the gallery's own navigation and it is not going away, so
  // the address follows it: switching to Blog inside the gallery leaves the
  // bar reading /blog, and that url shares and refreshes to the same place.
  //
  // Watched rather than wrapped around fgSwitchSection, because the row moves
  // by three different routes — the onclick on each chip, the arrow keys in
  // gallery.js, and openFG resetting to Artworks — and only a watcher sees
  // all three.
  function chipMoved() {
    if (opening || !owns) return;
    if (!isOpen('fg')) return;
    var path = SECTION_PATH[activeSection()];
    var here = ROUTES[window.location.pathname];
    // Only rewrite an address this file put there. Cart has no public url —
    // it is one member's basket — and a section opened while the bar is on an
    // artwork or a listing has not taken the address over.
    if (!here || here.panel !== 'fg') return;
    try {
      if (path) { if (path !== window.location.pathname) history.replaceState({ dzr: 1 }, '', path); }
      else {
        // Cart. It is one member's basket and has no public url, so the
        // address goes back to where the visit came from rather than
        // inventing one.
        history.replaceState({}, '', returnUrl || '/');
        pushed = false; returnUrl = null; owns = false;
      }
    } catch (e) {}
  }

  if (window.MutationObserver) {
    var tabs = el('fgSecTabs');
    if (tabs) {
      new MutationObserver(chipMoved)
        .observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    ['fg', 'communityPage'].forEach(function (id) {
      var node = el(id);
      if (!node) return;
      var was = node.classList.contains('open');
      new MutationObserver(function () {
        var now = node.classList.contains('open');
        if (was && !now) panelClosed(id);
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
  // The names the rest of the app already uses for these destinations. The
  // gallery calls its grid `artworks` and the hero calls the same place
  // Explore; the community page is not a gallery chip at all and so is not in
  // SECTION_PATH. All of them resolve to the one url each destination has.
  var ALIAS = { community: '/community', explore: '/explore' };
  window.dzRoutePath = function (id) { return SECTION_PATH[id] || ALIAS[id] || null; };

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
