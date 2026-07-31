// nav scroll progress and section memory
(function () {
  'use strict';

  // the dot under the active bottom-nav item stretches into a line that
  // tracks how far its section is scrolled: it starts where the dot sits
  // and runs clockwise around the icon. sections load in as you go, so the
  // line eases toward the reading instead of snapping to it — fresh
  // thumbnails push it back down as gently as scrolling up does.

  // each section also keeps its place. leaving one and coming back puts you
  // where you were, and tapping the icon of the section you are already in
  // is what takes you to the top — a glide you can stop by touching the
  // page. the line follows either way, easing up to the restored spot from
  // zero and back down as the glide runs.

  // where each item's content lives; an empty list means the page scrolls
  var ROOTS = {
    bnHome:      [],
    bnGallery:   ['#fg'],
    bnUpload:    ['#pfUpMod'],
    bnCommunity: ['#communityPage'],
    bnProfile:   ['#profilePage', '#authMod']
  };
  var IDS = ['bnHome', 'bnGallery', 'bnUpload', 'bnCommunity', 'bnProfile'];

  var DOT   = 7;                  // px from an item's edge to the dot's centre
  var WIDE  = 4;                  // px the line is drawn at, matching the dot
  var HALO  = 2;                  // px of glow ring the avatar carries outside itself
  var GAIN  = 8.2;                // ease rate going forward, per second
  var LOSS  = 4.2;                // ease rate coming back, deliberately softer
  var RANGE = 8;                  // px of overflow before a box counts as scrollable
  var DEPTH = 5;                  // how deep to hunt for a section's scroller
  var POLL  = 380;                // ms between growth checks

  var nav = document.getElementById('bnNav');
  if (!nav) return;

  var rings    = {};              // id -> { svg, bar, circ }
  var activeId = '';
  var root     = null;            // section box, null = the document
  var scroller = null;            // box that actually scrolls, null = the document
  var target   = 0, shown = 0;
  var raf = 0, last = 0, timer = 0;
  var saved   = {};               // id -> the offset that section was left at
  var pending = '';               // section still waiting to be put back
  var pendingUntil = 0, hurry = 0;
  var glide = 0, wasLocked = false;
  var mqReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  var NS = 'http://www.w3.org/2000/svg';

  // the profile item is an avatar, not a line icon: it fills most of its
  // circle, and a line cut to the dot's radius would run straight across
  // its edge. measured, so it tracks the avatar at either nav size
  function clears (item) {
    var kids = item.querySelectorAll('.nAvatarBtn, .nLoginBtn');
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].offsetWidth) return kids[i].offsetWidth / 2 + HALO + WIDE / 2;
    }
    return 0;
  }

  // the viewBox is the item's own pixel box, so the line lands on the dot
  // at whatever size the nav is drawn — 58px, 52px on phones
  function size (id) {
    var ring = rings[id];
    if (!ring) return;
    var item = ring.svg.parentNode;
    var w = item.clientWidth, h = item.clientHeight;
    if (!w || !h || (w === ring.w && h === ring.h)) return;
    var half = Math.min(w, h) / 2;
    var r = half - DOT;
    // ride outside the avatar rather than through it, but never off the item
    var out = clears(item);
    if (out > r) r = Math.min(out, half - WIDE / 2);
    ring.w = w; ring.h = h;
    ring.circ = 2 * Math.PI * r;
    ring.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    ring.bar.setAttribute('cx', String(w / 2));
    ring.bar.setAttribute('cy', String(h / 2));
    ring.bar.setAttribute('r', String(r));
  }

  function build () {
    IDS.forEach(function (id) {
      var item = document.getElementById(id);
      if (!item || rings[id]) return;
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'bnRing');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var bar = document.createElementNS(NS, 'circle');
      bar.setAttribute('class', 'bnRingBar');
      svg.appendChild(bar);
      // behind the icon, so nothing about the icon itself moves
      item.insertBefore(svg, item.firstChild);
      rings[id] = { svg: svg, bar: bar, circ: 0, w: 0, h: 0 };
      size(id);
      paint(id, 0);
    });
    // the css dot steps aside only once the line is really there to draw it
    if (rings.bnHome) nav.classList.add('bnMarks');
  }

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

  // the first open box for this item, or null for the document
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

  function reading () {
    var box = scroller || docBox();
    if (!box || !box.isConnected) return 0;
    var max = box.scrollHeight - box.clientHeight;
    if (max <= RANGE) return 0;
    var p = box.scrollTop / max;
    return p < 0 ? 0 : (p > 1 ? 1 : p);
  }

  // ---- painting -----------------------------------------------------

  // the line is one dash with round caps, and it never drops below a
  // hairline — at zero that cap is the dot, drawn in the dot's own place
  function paint (id, p) {
    var ring = rings[id];
    if (!ring) return;
    if (!ring.circ) { size(id); if (!ring.circ) return; }
    var len = Math.max(0.01, ring.circ * p);
    ring.bar.style.strokeDasharray = len.toFixed(2) + ' ' + (ring.circ - len).toFixed(2);
  }

  function tick (now) {
    raf = 0;
    var dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (dt > 0.25) dt = 0.25;           // a backgrounded tab must not jump
    var gap = target - shown;
    if (Math.abs(gap) < 0.0004) shown = target;
    else if (dt > 0) shown += gap * (1 - Math.exp(-(gap > 0 ? GAIN : LOSS) * dt));
    paint(activeId, shown);
    if (Math.abs(target - shown) > 0.0004) raf = requestAnimationFrame(tick);
    else last = 0;
  }

  function animate () {
    if (mqReduce && mqReduce.matches) {
      shown = target;
      paint(activeId, shown);
      return;
    }
    if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
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
    if (y >= saved[pending] - 1) { dropPending(); measure(); }
  }

  // tapping the section you are already in rides back up to the top
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
    var next = reading();
    if (Math.abs(next - target) < 0.0004) return;
    target = next;
    animate();
  }

  function setActive (id) {
    if (!id || id === activeId) return;
    remember();                 // hold the place the section is being left at
    stopGlide();
    activeId = id;
    relink();
    // every other line resets, so the section comes back sweeping up from
    // zero rather than appearing already part-drawn
    IDS.forEach(function (other) { if (other !== id) paint(other, 0); });
    shown = 0;
    paint(id, 0);
    target = reading();
    animate();
    restoreLater(id);
  }

  function currentId () {
    for (var i = 0; i < IDS.length; i++) {
      var el = document.getElementById(IDS[i]);
      if (el && el.classList.contains('bnActive')) return IDS[i];
    }
    return '';
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

  // the nav shrinks under 640px, so the line has to be re-cut to the dot
  function reflow () {
    IDS.forEach(size);
    paint(activeId, shown);
    measure();
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

  function onNavTap (e) {
    var el = e.target, item = null;
    while (el && el !== nav) {
      if (el.classList && el.classList.contains('bnItem')) { item = el; break; }
      el = el.parentNode;
    }
    if (!item || !rings[item.id]) return;
    if (item.id !== activeId) return;
    // the section you are already in is the one the tap sends to the top.
    // the handler behind this tap runs first and may rebuild the section
    // from scratch — gallery does — which drops it to the top before the
    // ride can start, so the offset is taken here, while it still stands
    var box = boxOf();
    var from = box ? box.scrollTop : 0;
    requestAnimationFrame(function () { toTop(from); });
  }

  build();
  setActive(currentId() || 'bnHome');

  // the nav marks its own active item, whichever path opened the section
  if (window.MutationObserver) {
    var mo = new MutationObserver(function () {
      var id = currentId();
      if (id) setActive(id);
    });
    IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  addEventListener('scroll', onScroll, { capture: true, passive: true });
  addEventListener('resize', reflow, { passive: true });
  addEventListener('orientationchange', reflow, { passive: true });
  addEventListener('pageshow', measure);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) measure(); });

  nav.addEventListener('click', onNavTap, true);
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) {
    addEventListener(ev, interrupt, { capture: true, passive: true });
  });

  wasLocked = locked();
  startPoll();

  // bnGoHome checks for this before scrolling home to the top itself
  window.bnScrollMemory = { toTop: toTop, saved: saved };
})();
