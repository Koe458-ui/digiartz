// nav scroll progress
(function () {
  'use strict';

  // the dot under the active bottom-nav item stretches into a line that
  // tracks how far its section is scrolled: it starts where the dot sits
  // and runs clockwise around the icon. sections load in as you go, so the
  // line eases toward the reading instead of snapping to it — fresh
  // thumbnails push it back down as gently as scrolling up does.

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
  var mqReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  var NS = 'http://www.w3.org/2000/svg';

  // the viewBox is the item's own pixel box, so the line lands on the dot
  // at whatever size the nav is drawn — 58px, 52px on phones
  function size (id) {
    var ring = rings[id];
    if (!ring) return;
    var w = ring.svg.parentNode.clientWidth, h = ring.svg.parentNode.clientHeight;
    if (!w || !h || (w === ring.w && h === ring.h)) return;
    var r = Math.min(w, h) / 2 - DOT;
    ring.w = w; ring.h = h;
    ring.circ = 2 * Math.PI * r;
    ring.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    ring.bar.setAttribute('cx', String(w / 2));
    ring.bar.setAttribute('cy', String(h / 2));
    ring.bar.setAttribute('r', String(r));
    ring.bar.style.strokeDasharray = ring.circ.toFixed(2);
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

  function paint (id, p) {
    var ring = rings[id];
    if (!ring) return;
    if (!ring.circ) { size(id); if (!ring.circ) return; }
    ring.bar.style.strokeDashoffset = (ring.circ * (1 - p)).toFixed(2);
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

  // ---- state --------------------------------------------------------

  function relink () {
    root = findRoot(activeId);
    scroller = findScroller(root);
  }

  function measure () {
    if (!activeId) return;
    if ((root && !root.isConnected) || (scroller && !scroller.isConnected)) relink();
    else if (!scroller && root) scroller = findScroller(root);
    var next = reading();
    if (Math.abs(next - target) < 0.0004) return;
    target = next;
    animate();
  }

  function setActive (id) {
    if (!id || id === activeId) return;
    activeId = id;
    relink();
    // every other ring resets, so the next section starts its sweep at zero
    IDS.forEach(function (other) { if (other !== id) paint(other, 0); });
    shown = 0;
    paint(id, 0);
    target = reading();
    animate();
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

  function startPoll () {
    if (timer) return;
    // sections grow while you read them; polling catches the new height
    timer = setInterval(function () { if (!document.hidden) measure(); }, POLL);
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
  startPoll();
})();
