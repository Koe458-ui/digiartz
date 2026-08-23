// Each section keeps its place.
//
// Leaving a section and coming back puts you where you were, and choosing the
// section you are already in is what takes you to the top — a glide you can
// stop by touching the page.
//
// This file used to do a second thing as well: the dot under the active
// bottom-nav icon stretched into a line that tracked how far the section was
// scrolled, drawn clockwise around the icon. There are no icons. The bar at
// the top of the document names its destinations in words, and a progress
// ring has nowhere to be drawn on a word — so the ring is gone and the memory,
// which was never about the ring, is what is left.
//
// Which section is on screen is read off one attribute: js/pfedit.js writes
// data-section on the document root whenever the section changes. That used to
// be five elements' class attributes watched at once, which is the same fact
// stated five times — and it stopped being findable at all when the two copies
// of every destination arrived (the bar's own row, and the same words inside
// the hamburger).
(function () {
  'use strict';

  // where each section's content lives; an empty list means the page scrolls
  var ROOTS = {
    bnHome:      [],
    bnGallery:   ['#fg'],
    bnUpload:    ['#pfUpMod'],
    bnCommunity: ['#communityPage'],
    bnProfile:   ['#profilePage', '#authMod']
  };

  var RANGE = 8;                  // px of overflow before a box counts as scrollable
  var DEPTH = 5;                  // how deep to hunt for a section's scroller
  var POLL  = 380;                // ms between growth checks

  var activeId = '';
  var root     = null;            // section box, null = the document
  var scroller = null;            // box that actually scrolls, null = the document
  var timer = 0;
  var saved   = {};               // id -> the offset that section was left at
  var pending = '';               // section still waiting to be put back
  var pendingUntil = 0, hurry = 0;
  var glide = 0, wasLocked = false;
  var mqReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  // ---- measuring ----------------------------------------------------

  function docBox () { return document.scrollingElement || document.documentElement; }

  function overflow (el) {
    return el ? (el.scrollHeight - el.clientHeight) : 0;
  }

  function scrolls (el) {
    if (overflow(el) <= RANGE) return false;
    var oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  // the first open box for this section, or null for the document
  function findRoot (id) {
    var sel = ROOTS[id] || [], i, el, fallback = null;
    for (i = 0; i < sel.length; i++) {
      el = document.querySelector(sel[i]);
      if (!el) continue;
      if (el.classList.contains('open')) return el;
      if (!fallback) fallback = el;
    }
    return sel.length ? fallback : null;
  }

  // sections scroll either on the panel itself or on one box inside it
  function findScroller (box) {
    if (!box) return null;
    if (scrolls(box)) return box;
    var best = null, bestOver = RANGE;
    var level = [box], depth = 0;
    while (level.length && depth < DEPTH) {
      var next = [];
      for (var i = 0; i < level.length; i++) {
        var kids = level[i].children;
        for (var k = 0; k < kids.length; k++) {
          var el = kids[k];
          if (el.nodeType !== 1 || (window.SVGElement && el instanceof SVGElement)) continue;
          var over = overflow(el);
          if (over > bestOver && scrolls(el)) { best = el; bestOver = over; }
          next.push(el);
        }
      }
      level = next;
      depth++;
    }
    return best;
  }

  // ---- memory -------------------------------------------------------

  function boxOf () { return scroller || docBox(); }

  // panels lock the page while they are up, and a locked page reports no
  // room to scroll — so an offset is only worth keeping while there is some
  function room (box) { return box ? (box.scrollHeight - box.clientHeight) : 0; }

  function locked () {
    return document.body.style.overflow === 'hidden' ||
           document.documentElement.style.overflow === 'hidden';
  }

  function setScroll (box, y) {
    // the page scrolls smoothly by stylesheet, which would fight every one
    // of these; each step here is meant to land where it is put
    try { box.scrollTo({ top: y, behavior: 'instant' }); }
    catch (e) { box.scrollTop = y; }
  }

  function remember () {
    if (!activeId || pending) return;
    var box = boxOf();
    if (room(box) <= RANGE) return;
    saved[activeId] = box.scrollTop;
  }

  // sections rebuild their content on the way in, so the offset cannot be
  // handed back until there is something to hand it back onto
  function restoreLater (id) {
    if (!saved[id] || saved[id] <= RANGE) return;
    pending = id;
    pendingUntil = Date.now() + 1500;
    if (!hurry) hurry = setInterval(applyPending, 70);
    applyPending();
  }

  function dropPending () {
    pending = '';
    if (hurry) { clearInterval(hurry); hurry = 0; }
  }

  function applyPending () {
    if (!pending) { dropPending(); return; }
    if (Date.now() > pendingUntil) { dropPending(); return; }
    if (pending !== activeId) return;      // the section has yet to come up
    var box = boxOf(), max = room(box);
    if (max <= RANGE) return;              // nor has its content
    var y = Math.min(saved[pending], max);
    if (Math.abs(box.scrollTop - y) > 1) setScroll(box, y);
    // short of the remembered spot means more is still rendering
    if (y >= saved[pending] - 1) { dropPending(); }
  }

  // choosing the section you are already in rides back up to the top
  function stopGlide () { if (glide) { cancelAnimationFrame(glide); glide = 0; } }

  function toTop (start) {
    if ((scroller && !scroller.isConnected) || (root && !root.isConnected)) relink();
    var box = boxOf();
    if (!box) return;
    // a section that rebuilt itself on the way in is already sitting at the
    // top, so the ride starts from where the tap found it, not from there
    var from = Math.max(box.scrollTop, Math.min(start || 0, room(box)));
    if (from <= 0) return;
    stopGlide();
    dropPending();
    if (mqReduce && mqReduce.matches) { setScroll(box, 0); return; }
    if (box.scrollTop < from - 1) setScroll(box, from);   // before the frame paints
    var t0 = 0;
    var dur = Math.min(760, 260 + from * 0.22);   // a longer way up takes longer
    glide = requestAnimationFrame(function step (now) {
      if (!t0) t0 = now;
      var k = (now - t0) / dur;
      if (k > 1) k = 1;
      setScroll(box, from * (1 - (1 - Math.pow(1 - k, 3))));
      glide = k < 1 ? requestAnimationFrame(step) : 0;
    });
  }

  // any touch of your own outranks a glide or a restore in flight
  function interrupt () { stopGlide(); dropPending(); }

  // ---- state --------------------------------------------------------

  function relink () {
    root = findRoot(activeId);
    scroller = findScroller(root);
  }

  function measure () {
    if (!activeId) return;
    if ((root && !root.isConnected) || (scroller && !scroller.isConnected)) relink();
    else if (!scroller && root) scroller = findScroller(root);
    remember();
  }

  function setActive (id) {
    if (!id || id === activeId) return;
    remember();                 // hold the place the section is being left at
    stopGlide();
    activeId = id;
    relink();
    restoreLater(id);
  }

  function currentId () {
    return document.documentElement.getAttribute('data-section') || '';
  }

  // ---- wiring -------------------------------------------------------

  function onScroll (e) {
    var t = e.target;
    if (t === document || t === window || t === docBox() || t === document.body) {
      if (!root) measure();
      return;
    }
    if (t && t.nodeType === 1 && root && root.contains(t)) {
      // learn the real scroller from whatever the section actually scrolls
      if (t !== scroller && overflow(t) > RANGE) scroller = t;
      if (t === scroller) measure();
    }
  }

  // a lock that ends with the page at the top threw the offset away rather
  // than the reader doing it, so home gets put back where it was
  function watchLock () {
    var now = locked();
    if (wasLocked && !now && activeId === 'bnHome' && docBox().scrollTop <= 1) restoreLater('bnHome');
    wasLocked = now;
  }

  function startPoll () {
    if (timer) return;
    // sections grow while you read them; polling catches the new height
    timer = setInterval(function () {
      if (document.hidden) return;
      watchLock();
      applyPending();
      measure();
    }, POLL);
  }

  /* Choosing the section you are already in is what sends it to the top.

     The handler behind that tap runs first and may rebuild the section from
     scratch — the gallery does — which drops it to the top before the ride can
     start, so the offset is taken here, while it still stands. Listened for on
     the document because there are two copies of every destination: the row on
     the wide bar and the same words inside the hamburger. */
  function onNavTap (e) {
    var el = e.target, item = null;
    while (el && el !== document) {
      if (el.getAttribute && el.hasAttribute('data-bn')) { item = el; break; }
      el = el.parentNode;
    }
    if (!item) return;
    if (item.getAttribute('data-bn') !== activeId) return;
    var box = boxOf();
    var from = box ? box.scrollTop : 0;
    requestAnimationFrame(function () { toTop(from); });
  }

  setActive(currentId() || 'bnHome');

  // js/pfedit.js writes the section onto the document root, whichever path
  // opened it — a tap on the bar, a url, the hero's call to action.
  if (window.MutationObserver) {
    new MutationObserver(function () {
      var id = currentId();
      if (id) setActive(id);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-section'] });
  }

  addEventListener('scroll', onScroll, { capture: true, passive: true });
  addEventListener('pageshow', measure);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) measure(); });

  document.addEventListener('click', onNavTap, true);
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) {
    addEventListener(ev, interrupt, { capture: true, passive: true });
  });

  wasLocked = locked();
  startPoll();

  // bnGoHome checks for this before scrolling home to the top itself
  window.bnScrollMemory = { toTop: toTop, saved: saved };
})();
