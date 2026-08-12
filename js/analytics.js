/* DigiArtz Analytics — Profile → Settings → Activity → Analytics
 *
 * Two halves in one file, because they are two ends of one thing.
 *
 * THE FIRST HALF is four or five lines of context every visitor's browser
 * knows and the database cannot: where this visit came from, what it is being
 * read on, and roughly where. It is worked out once per session and handed to
 * the RPCs that record a view, a like, a download, a share or a search. Every
 * call is fire-and-forget: analytics must never be the reason an action fails,
 * so nothing here is awaited and nothing here throws.
 *
 * THE SECOND HALF is the dashboard. Twelve sections, four RPC calls, and a
 * repaint. It is only ever about the signed-in member: the readers are scoped
 * to auth.uid() server-side, so there is no id to pass and no way to ask for
 * somebody else's.
 *
 * WHY THE CHARTS ARE HAND-DRAWN SVG. A charting library is a network fetch
 * this page cannot make — the service worker precaches a fixed shell and the
 * site is meant to open offline — and the six chart shapes here are a path
 * builder, an arc, and a rectangle. The whole drawing layer is under 200 lines
 * and it costs nothing to load.
 *
 * WHY IT IS ARTWORKS ONLY. The marketplace, the blog and resources are coming;
 * they are not here. Every number on this page is an artwork's, the readers
 * filter for it, and nothing pretends to speak for the rest.
 */
(function () {
  'use strict';

  function db() { return (typeof sb !== 'undefined' && sb) ? sb : null; }
  function me() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function $(id) { return document.getElementById(id); }
  function toast(m) { if (typeof showToast === 'function') showToast(m); }

  /* =======================================================================
     1. WHAT A VISIT CARRIES
     ======================================================================= */

  var SESS_KEY = 'dzAnSrc1';

  // Hosts worth naming. Everything else that referred a visit is a 'referral'
  // and keeps its hostname, which is the more useful answer anyway — an artist
  // wants to see the actual forum, not a bucket called "other".
  var SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|search\.brave|startpage|qwant|naver|seznam)\./;
  var SOCIAL_HOSTS = /(^|\.)(instagram|facebook|fb|twitter|x|t|pinterest|reddit|tiktok|youtube|youtu|tumblr|linkedin|discord|telegram|whatsapp|threads|artstation|deviantart|behance|vk|weibo|line|snapchat|mastodon|bsky)\.[a-z.]+$/;

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  // Worked out from the referrer of the FIRST page of this session and then
  // frozen. Reading document.referrer per event would call every in-app
  // navigation a referral from ourselves; where a visitor came from is a fact
  // about the visit, not about the tap.
  function entry() {
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESS_KEY) || 'null'); } catch (e) {}
    if (saved && saved.source) return saved;

    var ref = '';
    try { ref = document.referrer || ''; } catch (e) {}
    var host = hostOf(ref);
    var out;
    if (!host || host === location.hostname.replace(/^www\./, '')) {
      out = { source: 'direct', ref: '' };
    } else if (SEARCH_HOSTS.test('.' + host + '.')) {
      out = { source: 'search', ref: host };
    } else if (SOCIAL_HOSTS.test(host)) {
      out = { source: 'social', ref: host };
    } else {
      out = { source: 'referral', ref: host };
    }
    try { sessionStorage.setItem(SESS_KEY, JSON.stringify(out)); } catch (e) {}
    return out;
  }

  function device() {
    try {
      var uad = navigator.userAgentData;
      if (uad && typeof uad.mobile === 'boolean') {
        // the hint only says mobile-or-not, so a tablet still needs the string
        if (!uad.mobile) return 'desktop';
      }
      var ua = navigator.userAgent || '';
      if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
      // Android without "Mobile" is a tablet, by Google's own convention
      if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
      if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
      // a touch screen with a narrow viewport, for browsers that say nothing
      if (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 500) return 'mobile';
      return 'desktop';
    } catch (e) { return 'unknown'; }
  }

  // A hint and nothing more. The database prefers the country Cloudflare put
  // on the request and only falls back to this, because a locale is a setting
  // and an edge header is a measurement.
  function countryHint() {
    try {
      var tags = [];
      if (navigator.languages && navigator.languages.length) tags = tags.concat(navigator.languages);
      if (navigator.language) tags.push(navigator.language);
      for (var i = 0; i < tags.length; i++) {
        var m = /-([A-Za-z]{2})(?:$|-)/.exec(String(tags[i]));
        if (m) return m[1].toUpperCase();
      }
    } catch (e) {}
    return null;
  }

  var ctxCache = null;
  function ctx() {
    if (ctxCache) return ctxCache;
    var e = entry();
    ctxCache = {
      source: e.source, ref: e.ref, device: device(), country: countryHint(),
      key: (typeof window.dzViewerKey === 'function') ? window.dzViewerKey() : null
    };
    return ctxCache;
  }
  window.dzAnCtx = ctx;

  // The four dimensions, named the way both register_artwork_view and
  // dz_analytics_track spell them, so a caller of either passes the same
  // object through.
  window.dzAnDims = function () {
    var c = ctx();
    return { p_source: c.source, p_ref: c.ref || null, p_device: c.device, p_country: c.country };
  };

  function track(event, subject, extra) {
    var c = db();
    if (!c) return;
    var x = ctx();
    var args = {
      p_event: event,
      p_subject: subject || null,
      p_scope: (extra && extra.scope) || 'artwork',
      p_owner: (extra && extra.owner) || null,
      p_source: x.source,
      p_ref: x.ref || null,
      p_device: x.device,
      p_country: x.country,
      p_term: (extra && extra.term) || null,
      p_anon_key: x.key
    };
    try { c.rpc('dz_analytics_track', args).then(noop, noop); } catch (e) {}
  }
  function noop() {}

  window.dzAnTrack = track;

  // One call for a page of results rather than one per row.
  window.dzAnSearch = function (ids, term, scope) {
    var c = db();
    if (!c || !term || !ids || !ids.length) return;
    var x = ctx();
    try {
      c.rpc('dz_analytics_track_search', {
        p_subjects: ids.slice(0, 12).map(String),
        p_term: String(term).slice(0, 80),
        p_source: x.source, p_ref: x.ref || null,
        p_device: x.device, p_country: x.country, p_anon_key: x.key,
        p_scope: scope || 'artwork'
      }).then(noop, noop);
    } catch (e) {}
  };

  // A view of a listing, a post or a resource. Artworks have their own
  // function and their own dedup table; these three had neither until now,
  // so this is the only thing that records that they were opened at all.
  // Same client-side cooldown the gallery uses, so a page reopened three
  // times in a minute is not three calls before the database even sees it.
  var ITEM_SEEN_KEY = 'dzAnItemSeen', ITEM_COOLDOWN = 6 * 3600 * 1000;
  window.dzAnItemView = function (kind, id) {
    var c = db();
    if (!c || !id) return;
    if (kind === 'resources') kind = 'resource';
    if (['marketplace', 'blog', 'resource'].indexOf(kind) === -1) return;
    var mapKey = kind + ':' + id, now = Date.now(), map = {};
    try { map = JSON.parse(localStorage.getItem(ITEM_SEEN_KEY) || '{}'); } catch (e) {}
    if (map[mapKey] && now - map[mapKey] < ITEM_COOLDOWN) return;
    map[mapKey] = now;
    for (var k in map) if (now - map[k] > 8 * ITEM_COOLDOWN) delete map[k];
    try { localStorage.setItem(ITEM_SEEN_KEY, JSON.stringify(map)); } catch (e) {}
    var x = ctx();
    try {
      c.rpc('register_item_view', {
        p_kind: kind, p_subject: String(id), p_anon_key: x.key,
        p_source: x.source, p_ref: x.ref || null,
        p_device: x.device, p_country: x.country
      }).then(noop, noop);
    } catch (e) {}
  };

  /* =======================================================================
     2. THE DASHBOARD
     ======================================================================= */

  // Four dashboards, one page. The order is the order they appear in the
  // Settings menu and the order they are listed everywhere else.
  var SCOPES = [
    { key: 'artwork',     label: 'Artwork',     noun: 'artwork',  nouns: 'artworks',
      title: 'ARTWORK ANALYTICS',     sub: 'Everything your artworks did, and where it came from.' },
    { key: 'marketplace', label: 'Marketplace', noun: 'listing',  nouns: 'listings',
      title: 'MARKETPLACE ANALYTICS', sub: 'Everything your listings did, and where it came from.' },
    { key: 'blog',        label: 'Blog',        noun: 'post',     nouns: 'posts',
      title: 'BLOG ANALYTICS',        sub: 'Everything your posts did, and where it came from.' },
    { key: 'resource',    label: 'Resources',   noun: 'resource', nouns: 'resources',
      title: 'RESOURCES ANALYTICS',   sub: 'Everything your resources did, and where it came from.' }
  ];
  function scopeOf(key) {
    for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i].key === key) return SCOPES[i];
    return SCOPES[0];
  }

  var RANGES = [
    { d: 7,   label: 'Last 7 days' },
    { d: 30,  label: 'Last 30 days' },
    { d: 90,  label: 'Last 90 days' },
    { d: 365, label: 'Last 12 months' }
  ];

  // The hex is what the SVG gets — a chart stroke cannot be a CSS variable
  // that resolves differently per theme. These six match css/analytics.css and
  // must stay in step with it. None of them is purple: this site's three
  // themes are dark, graydark and light.
  var METRICS = [
    { key: 'views',     label: 'Views',     ico: '👁', color: 'var(--an-views)',     hex: '#00A6FF' },
    { key: 'likes',     label: 'Likes',     ico: '❤️', color: 'var(--an-likes)',     hex: '#FF3D3D' },
    { key: 'bookmarks', label: 'Saves',     ico: '🔖', color: 'var(--an-bookmarks)', hex: '#00D9B8' },
    { key: 'downloads', label: 'Downloads', ico: '⬇️', color: 'var(--an-downloads)', hex: '#FFB300' },
    { key: 'comments',  label: 'Comments',  ico: '💬', color: 'var(--an-comments)',  hex: '#FF3DE0' },
    // Shares, not cred. Every tile in this row has to be a number this
    // section earned, and cred is given to a person on their profile — it has
    // no section to belong to, so it lives in the account block instead.
    { key: 'shares',    label: 'Shares',    ico: '↗',  color: 'var(--an-cred)',      hex: '#16D95F' }
  ];
  function metric(key) {
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === key) return METRICS[i];
    return METRICS[0];
  }
  // Nothing is downloaded from the marketplace — it is bought. Same slot in
  // the row, same colour, the word that is true for the section.
  function metricsFor(sc) {
    return METRICS.map(function (m) {
      if (m.key === 'downloads' && sc === 'marketplace') {
        return { key: 'sales', label: 'Sales', ico: '🛒', color: m.color, hex: m.hex };
      }
      return m;
    });
  }

  var SOURCE_LABEL = {
    direct: 'Direct', social: 'Social media', search: 'Search engines',
    referral: 'Referrals', internal: 'Within DigiArtz'
  };
  var SOURCE_HEX = {
    direct: '#00A6FF', social: '#FF3DE0', search: '#00D9B8',
    referral: '#FFB300', internal: '#16D95F'
  };
  var DEVICE_LABEL = { mobile: 'Phone', tablet: 'Tablet', desktop: 'Desktop', unknown: 'Unknown' };
  var DEVICE_HEX   = { mobile: '#00A6FF', tablet: '#00D9B8', desktop: '#16D95F', unknown: '#8A8F98' };
  // twelve slices for the country donut, walked in order. No violet in it:
  // this site's themes are dark, graydark and light, and none of them has a
  // purple in its palette for these to sit beside.
  var WHEEL = ['#00A6FF', '#FF3DE0', '#00D9B8', '#FFB300', '#16D95F', '#FF3D3D',
               '#4DC3FF', '#FF85EC', '#5BE7D2', '#FFD24D', '#5BE88F', '#8A8F98'];

  // Enough of ISO 3166 to name what the site actually sees, and the raw code
  // for anywhere else — a two-letter code is a worse label than a name and a
  // better one than nothing.
  var COUNTRY = {
    IN:'India', US:'United States', GB:'United Kingdom', ID:'Indonesia', BR:'Brazil',
    PH:'Philippines', CA:'Canada', AU:'Australia', DE:'Germany', FR:'France',
    JP:'Japan', KR:'South Korea', CN:'China', RU:'Russia', MX:'Mexico', ES:'Spain',
    IT:'Italy', NL:'Netherlands', PL:'Poland', TR:'Türkiye', VN:'Vietnam',
    TH:'Thailand', MY:'Malaysia', SG:'Singapore', PK:'Pakistan', BD:'Bangladesh',
    NG:'Nigeria', EG:'Egypt', ZA:'South Africa', AR:'Argentina', CO:'Colombia',
    CL:'Chile', PE:'Peru', UA:'Ukraine', SE:'Sweden', NO:'Norway', FI:'Finland',
    DK:'Denmark', BE:'Belgium', CH:'Switzerland', AT:'Austria', PT:'Portugal',
    IE:'Ireland', NZ:'New Zealand', SA:'Saudi Arabia', AE:'United Arab Emirates',
    IL:'Israel', RO:'Romania', CZ:'Czechia', HU:'Hungary', GR:'Greece', TW:'Taiwan',
    HK:'Hong Kong', LK:'Sri Lanka', NP:'Nepal', MM:'Myanmar', KH:'Cambodia'
  };
  function countryName(cc) { return COUNTRY[cc] || cc || 'Unknown'; }
  function flag(cc) {
    if (!/^[A-Z]{2}$/.test(cc || '')) return '🏳️';
    try {
      return String.fromCodePoint(cc.charCodeAt(0) + 127397, cc.charCodeAt(1) + 127397);
    } catch (e) { return '🏳️'; }
  }

  var WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---- formatting -------------------------------------------------------- */
  // Every number on this page is written out in full. 238393 reads as
  // "238,393", never "238K": an artist looking at their own numbers wants the
  // number, and the rounding a dashboard usually does to save space hides
  // exactly the digits that moved since yesterday. num and full are the same
  // function under two names — num is kept because the call sites read better
  // with it, and having one of them quietly abbreviate is the bug this note
  // exists to prevent.
  function full(n) { return Number(n || 0).toLocaleString(); }
  function num(n) { return full(n); }
  function pct(n) { return (Math.round(Number(n || 0) * 10) / 10) + '%'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // The wording matters more than it looks. An earlier version said "level
  // with last period" under a number, and on a tile labelled CRED that reads
  // as a level — which cred is not. Nothing here says level, rank or tier.
  function delta(cur, prev) {
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    if (prev === 0) {
      return cur > 0 ? { dir: 'up', txt: 'all new this period' }
                     : { dir: '', txt: 'none this period' };
    }
    var p = ((cur - prev) / prev) * 100;
    var r = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
    if (r === 0) return { dir: '', txt: 'same as last period' };
    return { dir: p > 0 ? 'up' : 'down', txt: (p > 0 ? '↑ ' : '↓ ') + Math.abs(r) + '% on previous' };
  }
  function shortDate(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function longDate(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function ago(ts) {
    var t = new Date(ts).getTime();
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ---- drawing ----------------------------------------------------------- */

  // A path through the points, smoothed with a monotone cubic so the curve
  // never dips below zero between two zero days — a plain Catmull-Rom does,
  // and a chart of views that swings negative is a lie a tooltip cannot fix.
  function smoothPath(pts) {
    if (!pts.length) return '';
    if (pts.length < 3) return 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join('L');
    var d = 'M' + pts[0][0] + ',' + pts[0][1];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i === 0 ? 0 : i - 1], p1 = pts[i], p2 = pts[i + 1],
          p3 = pts[i + 2 > pts.length - 1 ? pts.length - 1 : i + 2];
      var t = 0.28;
      var c1x = p1[0] + (p2[0] - p0[0]) * t, c1y = p1[1] + (p2[1] - p0[1]) * t;
      var c2x = p2[0] - (p3[0] - p1[0]) * t, c2y = p2[1] - (p3[1] - p1[1]) * t;
      // clamp the control points inside the segment's own value range, which
      // is what stops the overshoot
      var lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
      c1y = Math.max(lo - (hi - lo) * 0.4, Math.min(hi + (hi - lo) * 0.4, c1y));
      c2y = Math.max(lo - (hi - lo) * 0.4, Math.min(hi + (hi - lo) * 0.4, c2y));
      d += 'C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + p2[0] + ',' + p2[1];
    }
    return d;
  }

  function sparkline(values, hex) {
    var W = 120, H = 34, P = 2;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    var max = Math.max.apply(null, values.concat([1]));
    var n = values.length;
    var pts = values.map(function (v, i) {
      var x = n === 1 ? W / 2 : P + (i / (n - 1)) * (W - P * 2);
      var y = H - P - (Number(v) / max) * (H - P * 2);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    var id = 'anSp' + Math.random().toString(36).slice(2, 8);
    var defs = svgEl('defs');
    var grad = svgEl('linearGradient', { id: id, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': hex, 'stop-opacity': '.32' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': hex, 'stop-opacity': '0' }));
    defs.appendChild(grad); svg.appendChild(defs);
    var line = smoothPath(pts);
    svg.appendChild(svgEl('path', {
      d: line + 'L' + pts[pts.length - 1][0] + ',' + H + 'L' + pts[0][0] + ',' + H + 'Z',
      fill: 'url(#' + id + ')'
    }));
    svg.appendChild(svgEl('path', {
      d: line, fill: 'none', stroke: hex, 'stroke-width': '1.6',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke'
    }));
    return svg;
  }

  // The big one. Series is [{key,hex,values:[]}], labels is the day strings.
  //
  // The viewBox is measured from the container rather than fixed, so one SVG
  // unit is one CSS pixel at every width. A fixed viewBox would have locked
  // the chart to one aspect ratio: on a 340px phone a 720×240 box renders 113px
  // tall with 4px axis text, which is not a chart. Measured, the phone gets a
  // shorter chart with readable labels and the desktop gets a taller one.
  // paint() re-runs on resize, so a rotation redraws at the new width.
  function lineChart(host, labels, series) {
    host.innerHTML = '';
    var wrap = el('div', 'anChartWrap');
    host.appendChild(wrap);

    var avail = Math.round(wrap.clientWidth || host.clientWidth || 320);
    var W = Math.max(280, avail);
    var narrow = W < 520;
    var H = narrow ? 200 : 250;
    var R = 10, T = 12, B = narrow ? 22 : 26;

    var max = 1;
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (Number(v) > max) max = Number(v); });
    });
    // a round ceiling, so the gridline labels are numbers a person would say
    var step = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var top = Math.ceil(max / step) * step;
    if (top / max > 2 && step > 1) { step = step / 2; top = Math.ceil(max / step) * step; }

    // How many gridlines, chosen so every label is a whole number and no two
    // read the same. Four lines over a ceiling of 3 gives 0, 1, 2, 2, 3 —
    // which looks like a rendering bug and is really just rounding, and a
    // chart of cred or uploads is exactly where the ceiling is that small.
    var ticks = 4;
    if (top <= 4) {
      ticks = Math.max(1, Math.round(top));
    } else {
      var opts = [4, 5, 3, 2];
      for (var oi = 0; oi < opts.length; oi++) {
        if (top % opts[oi] === 0) { ticks = opts[oi]; break; }
      }
    }

    // Axis labels are written out in full like everything else, so the gutter
    // is measured from the widest one rather than guessed at — "1,250,000" and
    // "40" need very different amounts of room.
    var axisFont = narrow ? 11 : 12;
    var widest = 0;
    for (var gi = 0; gi <= ticks; gi++) {
      widest = Math.max(widest, full(Math.round((top / ticks) * gi)).length);
    }
    var L = Math.min(Math.round(W * 0.28), 12 + Math.ceil(widest * axisFont * 0.62));
    var iw = Math.max(40, W - L - R), ih = H - T - B;

    var svg = svgEl('svg', {
      class: 'anChart', viewBox: '0 0 ' + W + ' ' + H,
      role: 'img', 'aria-label': 'Daily totals over the selected period'
    });
    svg.style.fontSize = axisFont + 'px';

    var n = labels.length;
    function xAt(i) { return n === 1 ? L + iw / 2 : L + (i / (n - 1)) * iw; }
    function yAt(v) { return T + ih - (Number(v) / top) * ih; }

    // gridlines
    var seenLabel = null;
    for (var g = 0; g <= ticks; g++) {
      var v = (top / ticks) * g, y = yAt(v);
      svg.appendChild(svgEl('line', { class: 'anGridLine', x1: L, y1: y, x2: W - R, y2: y }));
      var text = full(Math.round(v));
      if (text === seenLabel) continue;   // belt and braces against the above
      seenLabel = text;
      var lbl = svgEl('text', { class: 'anAxis', x: L - 6, y: y + 3.5, 'text-anchor': 'end' });
      lbl.textContent = text;
      svg.appendChild(lbl);
    }

    // x labels: first, last, and however many fit between them without
    // touching. A date is about 34px wide at this size, so the count comes off
    // the real width rather than off a guess that only holds on a laptop.
    var fit = Math.max(2, Math.floor(iw / (narrow ? 52 : 74)));
    var every = Math.max(1, Math.ceil(n / fit));
    for (var i = 0; i < n; i += every) {
      var tx = svgEl('text', {
        class: 'anAxis', x: xAt(i), y: H - 6,
        'text-anchor': i === 0 ? 'start' : 'middle'
      });
      tx.textContent = shortDate(labels[i]);
      svg.appendChild(tx);
    }

    series.forEach(function (s, si) {
      var pts = s.values.map(function (v, i) { return [xAt(i), yAt(v)]; });
      var d = smoothPath(pts);
      if (si === 0) {
        var id = 'anLg' + Math.random().toString(36).slice(2, 8);
        var defs = svgEl('defs');
        var grad = svgEl('linearGradient', { id: id, x1: '0', y1: '0', x2: '0', y2: '1' });
        grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': s.hex, 'stop-opacity': '.26' }));
        grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': s.hex, 'stop-opacity': '0' }));
        defs.appendChild(grad); svg.appendChild(defs);
        svg.appendChild(svgEl('path', {
          d: d + 'L' + xAt(n - 1) + ',' + (T + ih) + 'L' + xAt(0) + ',' + (T + ih) + 'Z',
          fill: 'url(#' + id + ')'
        }));
      }
      svg.appendChild(svgEl('path', {
        d: d, fill: 'none', stroke: s.hex, 'stroke-width': '2',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke'
      }));
    });

    // hover marker
    var mark = svgEl('line', { x1: 0, y1: T, x2: 0, y2: T + ih, stroke: 'var(--bdrh)', 'stroke-width': 1, opacity: 0 });
    svg.appendChild(mark);
    var dots = series.map(function (s) {
      var c = svgEl('circle', { r: 3.5, fill: s.hex, stroke: 'var(--bg)', 'stroke-width': 2, opacity: 0 });
      svg.appendChild(c);
      return c;
    });

    wrap.appendChild(svg);
    var tip = el('div', 'anTip');
    wrap.appendChild(tip);

    function at(clientX) {
      var box = svg.getBoundingClientRect();
      if (!box.width) return;
      var rel = ((clientX - box.left) / box.width) * W;
      var i = n === 1 ? 0 : Math.round(((rel - L) / iw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      var x = xAt(i);
      mark.setAttribute('x1', x); mark.setAttribute('x2', x); mark.setAttribute('opacity', 1);
      var html = '<div class="anTipD">' + esc(longDate(labels[i])) + '</div>';
      series.forEach(function (s, si) {
        dots[si].setAttribute('cx', x);
        dots[si].setAttribute('cy', yAt(s.values[i]));
        dots[si].setAttribute('opacity', 1);
        html += '<div class="anTipRow"><span class="anTipDot" style="background:' + s.hex + '"></span>' +
                esc(s.label) + '<span class="anTipN">' + full(s.values[i]) + '</span></div>';
      });
      tip.innerHTML = html;
      tip.classList.add('on');
      // keep the card inside the chart on a narrow screen: centred on the day
      // where there is room, nudged in where there is not
      var px = (x / W) * box.width;
      var half = (tip.offsetWidth || 120) / 2;
      tip.style.left = Math.max(half + 2, Math.min(box.width - half - 2, px)) + 'px';
      tip.style.top = ((T + ih * 0.35) / H) * box.height + 'px';
    }
    function off() {
      mark.setAttribute('opacity', 0);
      dots.forEach(function (d) { d.setAttribute('opacity', 0); });
      tip.classList.remove('on');
    }
    svg.addEventListener('pointermove', function (e) { at(e.clientX); });
    svg.addEventListener('pointerdown', function (e) { at(e.clientX); });
    svg.addEventListener('pointerleave', off);
    svg.addEventListener('pointercancel', off);
  }

  function donut(host, items, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var total = items.reduce(function (a, b) { return a + (Number(b.n) || 0); }, 0);
    var row = el('div', 'anDonutRow');

    var box = el('div', 'anDonut');
    var svg = svgEl('svg', { viewBox: '0 0 42 42', 'aria-hidden': 'true' });
    var R = 15.9155, C = 2 * Math.PI * R;
    svg.appendChild(svgEl('circle', {
      cx: 21, cy: 21, r: R, fill: 'none',
      stroke: 'rgba(var(--tx2-rgb),.10)', 'stroke-width': 5
    }));
    var acc = 0;
    items.forEach(function (it) {
      var share = total > 0 ? (Number(it.n) || 0) / total : 0;
      if (share <= 0) return;
      svg.appendChild(svgEl('circle', {
        cx: 21, cy: 21, r: R, fill: 'none', stroke: it.hex, 'stroke-width': 5,
        'stroke-dasharray': (share * C).toFixed(3) + ' ' + C.toFixed(3),
        'stroke-dashoffset': (-acc * C).toFixed(3),
        transform: 'rotate(-90 21 21)', 'stroke-linecap': 'butt'
      }));
      acc += share;
    });
    box.appendChild(svg);
    var mid = el('div', 'anDonutMid');
    var midWrap = el('div');
    midWrap.appendChild(el('div', 'anDonutMidN', num(total)));
    midWrap.appendChild(el('div', 'anDonutMidL', opts.midLabel || 'total'));
    mid.appendChild(midWrap);
    box.appendChild(mid);
    row.appendChild(box);

    var list = el('div', 'anLegList');
    items.forEach(function (it) {
      var r = el('div', 'anLegRow');
      var dot = el('span', 'anTipDot');
      dot.style.background = it.hex;
      r.appendChild(dot);
      r.appendChild(el('span', 'anLegName', it.label));
      r.appendChild(el('span', 'anLegPct',
        (total > 0 ? Math.round(((Number(it.n) || 0) / total) * 1000) / 10 : 0) + '% · ' + full(it.n)));
      list.appendChild(r);
    });
    row.appendChild(list);
    host.appendChild(row);
  }

  function bars(host, items, hex) {
    host.innerHTML = '';
    var max = items.reduce(function (a, b) { return Math.max(a, Number(b.n) || 0); }, 1);
    var wrap = el('div', 'anBars');
    items.forEach(function (it) {
      var row = el('div', 'anBar');
      row.appendChild(el('div', 'anBarLbl', it.label));
      var track = el('div', 'anBarTrack');
      var fill = el('div', 'anBarFill');
      fill.style.width = Math.max(2, ((Number(it.n) || 0) / max) * 100) + '%';
      if (hex) fill.style.background = hex;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'anBarVal', it.sub || full(it.n)));
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  function ring(host, value, label, hex) {
    host.innerHTML = '';
    var box = el('div', 'anRing');
    var svg = svgEl('svg', { viewBox: '0 0 42 42', 'aria-hidden': 'true' });
    var R = 16, C = 2 * Math.PI * R;
    var share = Math.max(0, Math.min(1, Number(value) / 100));
    svg.appendChild(svgEl('circle', {
      cx: 21, cy: 21, r: R, fill: 'none',
      stroke: 'rgba(var(--tx2-rgb),.10)', 'stroke-width': 4
    }));
    svg.appendChild(svgEl('circle', {
      cx: 21, cy: 21, r: R, fill: 'none', stroke: hex, 'stroke-width': 4,
      'stroke-linecap': 'round',
      'stroke-dasharray': (share * C).toFixed(2) + ' ' + C.toFixed(2)
    }));
    box.appendChild(svg);
    var mid = el('div', 'anRingMid');
    var w = el('div');
    w.appendChild(el('div', 'anRingN', pct(value)));
    w.appendChild(el('div', 'anRingL', label));
    mid.appendChild(w);
    box.appendChild(mid);
    host.appendChild(box);
  }

  function facts(host, list) {
    host.innerHTML = '';
    var wrap = el('div', 'anFacts');
    list.forEach(function (f) {
      var c = el('div', 'anFact');
      c.appendChild(el('div', 'anFactN', f.n));
      var l = el('div', 'anFactL', f.l);
      l.title = f.l;
      c.appendChild(l);
      wrap.appendChild(c);
    });
    host.appendChild(wrap);
  }

  // How many rows a dashboard card shows before it stops being a dashboard.
  var CARD_ROWS = 10;

  function moreBtn(label, onTap) {
    var b = el('button', 'anMore', label);
    b.type = 'button';
    b.addEventListener('click', onTap);
    return b;
  }

  function empty(host, msg) {
    host.innerHTML = '';
    host.appendChild(el('div', 'anEmpty', msg));
  }

  /* ---- state ------------------------------------------------------------- */
  var state = {
    scope: 'artwork',
    days: 30,
    open: false,
    seq: 0,
    loading: false,
    data: { overview: null, content: null, reach: null, activity: null },
    chartMetrics: { views: true, likes: true },
    artSort: 'views',
    lastFocus: null,
    poll: null,
    channel: null,
    dirty: null,
    retry: null,
    again: false
  };

  try {
    var savedDays = parseInt(localStorage.getItem('dzAnDays') || '30', 10);
    if ([7, 30, 90, 365].indexOf(savedDays) !== -1) state.days = savedDays;
  } catch (e) {}

  /* ---- page shell -------------------------------------------------------- */

  function buildShell() {
    var body = $('anBdy');
    if (!body || body.dataset.built === '1') return;
    body.dataset.built = '1';

    var top = el('div', 'anTop');
    var left = el('div');
    var hi = el('div', 'anHi');
    hi.id = 'anHi';
    hi.textContent = 'Your analytics';
    left.appendChild(hi);
    var sub = el('div', 'anSub');
    sub.id = 'anSub';
    sub.textContent = scopeOf(state.scope).sub;
    left.appendChild(sub);
    top.appendChild(left);

    var right = el('div', 'anTopRight');
    var live = el('div', 'anLive');
    live.id = 'anLive';
    live.appendChild(el('span', 'anLiveDot'));
    live.appendChild(el('span', null, 'Live'));
    right.appendChild(live);

    var sel = el('select', 'anRange');
    sel.id = 'anRangeSel';
    sel.setAttribute('aria-label', 'Time range');
    RANGES.forEach(function (r) {
      var o = el('option', null, r.label);
      o.value = String(r.d);
      if (r.d === state.days) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      state.days = parseInt(sel.value, 10) || 30;
      try { localStorage.setItem('dzAnDays', String(state.days)); } catch (e) {}
      load(true);
    });
    right.appendChild(sel);
    top.appendChild(right);
    body.appendChild(top);

    // No scope switcher. Artwork Analytics is artworks and nothing else —
    // the row you tapped in Settings is the dashboard you get, and there is
    // no control on the page that quietly turns it into a different one.
    var nav = el('div', 'anNav');
    nav.id = 'anNav';
    body.appendChild(nav);

    sectionsFor(state.scope).forEach(function (s) {
      var btn = el('button', 'anNavBtn', s.short);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var target = $('anSec_' + s.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      nav.appendChild(btn);

      var sec = el('section', 'anSec');
      sec.id = 'anSec_' + s.id;
      var hd = el('div', 'anSecHd');
      hd.appendChild(el('h2', 'anSecTitle', s.title));
      if (s.note) hd.appendChild(el('span', 'anSecNote', s.note));
      sec.appendChild(hd);
      var host = el('div', 'anBox');
      host.id = 'anBox_' + s.id;
      host.appendChild(el('div', 'anEmpty', 'Loading…'));
      sec.appendChild(host);
      body.appendChild(sec);
    });

    watchNav();
  }


  // The chip row marks where you are. An observer rather than a scroll
  // handler, so it costs nothing while the page sits still.
  function watchNav() {
    if (!window.IntersectionObserver) return;
    var nav = $('anNav');
    if (!nav) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var id = e.target.id.replace('anSec_', '');
        var idx = sectionsFor(state.scope).findIndex(function (s) { return s.id === id; });
        Array.prototype.forEach.call(nav.children, function (c, i) {
          c.classList.toggle('on', i === idx);
        });
      });
    }, { rootMargin: '-120px 0px -70% 0px', threshold: 0 });
    sectionsFor(state.scope).forEach(function (s) {
      var t = $('anSec_' + s.id);
      if (t) io.observe(t);
    });
  }

  var SECTIONS = [
    { id: 'overview',  short: 'Overview',   title: 'Overview',              note: 'the period at a glance' },
    { id: 'growth',    short: 'Growth',     title: 'Growth & Trends',       note: 'day by day' },
    // the one section whose name is the section it is in
    { id: 'artworks',  short: 'Artworks',   title: 'Artwork Performance',   note: 'piece by piece',
      per: { marketplace: ['Listings',  'Listing Performance',  'listing by listing'],
             blog:        ['Posts',     'Post Performance',     'post by post'],
             resource:    ['Resources', 'Resource Performance', 'one by one'] } },
    { id: 'content',   short: 'Content',    title: 'Content Insights',      note: 'what you make' },
    { id: 'audience',  short: 'Audience',   title: 'Audience',              note: 'who is looking' },
    { id: 'traffic',   short: 'Traffic',    title: 'Traffic Sources',       note: 'how they arrived' },
    { id: 'search',    short: 'Search',     title: 'Search Analytics',      note: 'what they typed' },
    { id: 'engage',    short: 'Engagement', title: 'Engagement',            note: 'what a view turns into' },
    // marketplace only — the page drops it when the reader sends no revenue
    { id: 'revenue',   short: 'Revenue',    title: 'Revenue',               note: 'what your listings earned',
      only: 'marketplace' },
    { id: 'account',   short: 'Account',    title: 'Account & Cred',        note: 'you, not this section' },
    { id: 'community', short: 'Community',  title: 'Community Analytics',   note: 'your part in the place' },
    { id: 'goals',     short: 'Goals',      title: 'Goals & Achievements',  note: 'what you are aiming at' },
    { id: 'compare',   short: 'Compare',    title: 'Comparisons',           note: 'against yourself, and the site' }
  ];
  function sectionsFor(sc) {
    return SECTIONS.filter(function (s) { return !s.only || s.only === sc; })
      .map(function (s) {
        var p = s.per && s.per[sc];
        return p ? { id: s.id, short: p[0], title: p[1], note: p[2] } : s;
      });
  }

  /* ---- loading ----------------------------------------------------------- */

  async function load(showSkeleton) {
    var c = db();
    if (!c || !me()) return;
    var seq = ++state.seq;
    state.loading = true;
    if (showSkeleton) {
      sectionsFor(state.scope).forEach(function (s) {
        var b = $('anBox_' + s.id);
        if (b) empty(b, 'Loading…');
      });
    }
    var d = state.days, sc = state.scope;
    var jobs = [
      c.rpc('dz_analytics_overview', { p_days: d, p_scope: sc }),
      c.rpc('dz_analytics_content',  { p_days: d, p_scope: sc }),
      c.rpc('dz_analytics_reach',    { p_days: d, p_scope: sc }),
      c.rpc('dz_analytics_activity', { p_days: d, p_scope: sc })
    ];
    var out;
    try { out = await Promise.all(jobs); }
    catch (e) {
      if (seq !== state.seq) return;
      state.loading = false;
      state.again = false;
      failAll();
      return;
    }
    if (seq !== state.seq) return;
    state.loading = false;

    // One section failing takes its own card, not the page. Every reader
    // returns an object, so a null here means the call itself came back bad.
    state.data.overview = (out[0] && !out[0].error) ? out[0].data : null;
    state.data.content  = (out[1] && !out[1].error) ? out[1].data : null;
    state.data.reach    = (out[2] && !out[2].error) ? out[2].data : null;
    state.data.activity = (out[3] && !out[3].error) ? out[3].data : null;

    paint();

    // something landed while this was in flight
    if (state.again) { state.again = false; if (state.open) load(false); }
  }

  function failAll() {
    sectionsFor(state.scope).forEach(function (s) {
      var b = $('anBox_' + s.id);
      if (!b) return;
      b.innerHTML = '';
      b.appendChild(el('div', 'anErr', 'COULDN’T LOAD THIS SECTION'));
      var r = el('button', 'anRetry', 'Try again');
      r.type = 'button';
      r.addEventListener('click', function () { load(true); });
      b.appendChild(r);
    });
  }

  // The greeting wants a name, and nothing on the page holds the signed-in
  // member's own profile row — pf.profile is whichever profile is being
  // looked at, which is usually somebody else's. One small query, cached for
  // the session, and the heading reads "Your analytics" until it lands rather
  // than flashing a wrong name.
  var myName = null;
  async function loadMyName() {
    var c = db(), u = me();
    if (!c || !u || myName !== null) return;
    myName = '';
    try {
      var r = await c.from('profiles').select('username,display_name').eq('id', u.id).maybeSingle();
      if (!r.error && r.data) myName = r.data.display_name || r.data.username || '';
    } catch (e) {}
    var hi = $('anHi');
    if (hi && myName && state.open) hi.textContent = 'Welcome back, ' + myName;
  }

  function paint() {
    var sc = scopeOf(state.scope);
    var hi = $('anHi');
    if (hi) hi.textContent = myName ? ('Welcome back, ' + myName) : 'Your analytics';
    var sb2 = $('anSub');
    if (sb2) sb2.textContent = sc.sub;
    var ttl = document.querySelector('#anPage .subPgTitle');
    if (ttl) ttl.textContent = sc.title;
    var pg = $('anPage');
    if (pg) pg.setAttribute('aria-label', sc.title.toLowerCase());
    paintOverview();
    paintGrowth();
    paintArtworks();
    paintContent();
    paintAudience();
    paintTraffic();
    paintSearch();
    paintEngagement();
    paintRevenue();
    paintAccount();
    paintCommunity();
    paintGoals();
    paintCompare();
  }

  function box(id) { return $('anBox_' + id); }
  function noData(id, msg) {
    var b = box(id);
    if (b) empty(b, msg);
  }

  /* ---- 1. Overview ------------------------------------------------------- */
  function paintOverview() {
    var b = box('overview'), o = state.data.overview;
    if (!b) return;
    if (!o || o.error) { empty(b, 'COULDN’T LOAD THE OVERVIEW'); return; }
    b.innerHTML = '';

    var series = o.series || [];
    var win = o['window'] || {}, prev = o.prev || {};

    var grid = el('div', 'anKpis');
    metricsFor(state.scope).forEach(function (m) {
      var tile = el('div', 'anKpi');
      var top = el('div', 'anKpiTop');
      var ico = el('div', 'anKpiIco', m.ico);
      ico.style.background = m.hex + '22';
      top.appendChild(ico);
      top.appendChild(el('div', 'anKpiLbl', m.label));
      tile.appendChild(top);
      tile.appendChild(el('div', 'anKpiVal', num(win[m.key])));
      var dl = delta(win[m.key], prev[m.key]);
      var dEl = el('div', 'anKpiDelta ' + dl.dir, dl.txt);
      tile.appendChild(dEl);
      var sp = el('div', 'anKpiSpark');
      sp.appendChild(sparkline(series.map(function (r) { return r[m.key]; }), m.hex));
      tile.appendChild(sp);
      grid.appendChild(tile);
    });
    b.appendChild(grid);

    var t = o.totals || {};
    var sc = scopeOf(state.scope);
    var card = el('div', 'anCard');
    card.classList.add('anStack');
    var hd = el('div', 'anCardHd');
    hd.appendChild(el('div', 'anCardTitle', 'All time'));
    hd.appendChild(el('div', 'anSecNote', sc.nouns + ' only'));
    card.appendChild(hd);
    var fbox = el('div');
    var tiles = [
      { n: full(t.items), l: sc.nouns.charAt(0).toUpperCase() + sc.nouns.slice(1) },
      { n: full(t.views_all), l: 'Total views' },
      { n: full(t.likes_all), l: 'Total likes' },
      { n: full(t.bookmarks_all), l: 'Total saves' },
      { n: full(t.comments_all), l: 'Comments' },
      { n: full(t.shares_all), l: 'Shares' }
    ];
    tiles.push(state.scope === 'marketplace'
      ? { n: full(t.sales_all), l: 'Sales' }
      : { n: full(t.downloads_all), l: 'Downloads' });
    tiles.push({ n: t.items > 0 ? full(Math.round((t.views_all || 0) / t.items)) : '0',
                 l: 'Views / ' + sc.noun });
    facts(fbox, tiles);
    card.appendChild(fbox);
    b.appendChild(card);
  }

  /* ---- 2. Growth & Trends ------------------------------------------------ */
  function paintGrowth() {
    var b = box('growth'), o = state.data.overview;
    if (!b) return;
    if (!o || o.error || !(o.series || []).length) { empty(b, 'NOTHING TO CHART YET'); return; }
    b.innerHTML = '';

    var series = o.series;
    var labels = series.map(function (r) { return r.d; });

    var card = el('div', 'anCard');
    var hd = el('div', 'anCardHd');
    hd.appendChild(el('div', 'anCardTitle', 'Daily totals'));
    var mx = metricsFor(state.scope);
    var legend = el('div', 'anLegend');
    mx.forEach(function (m) {
      var btn = el('button', 'anLegBtn' + (state.chartMetrics[m.key] ? '' : ' off'));
      btn.type = 'button';
      var dot = el('span', 'anTipDot');
      dot.style.background = m.hex;
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(m.label));
      btn.addEventListener('click', function () {
        var on = !!state.chartMetrics[m.key];
        // one line has to stay, or the chart is an empty box with a legend
        if (on && Object.keys(state.chartMetrics).filter(function (k) { return state.chartMetrics[k]; }).length === 1) return;
        state.chartMetrics[m.key] = !on;
        paintGrowth();
      });
      legend.appendChild(btn);
    });
    hd.appendChild(legend);
    card.appendChild(hd);

    var chartHost = el('div');
    card.appendChild(chartHost);
    b.appendChild(card);

    var picked = mx.filter(function (m) { return state.chartMetrics[m.key]; });
    lineChart(chartHost, labels, picked.map(function (m) {
      return { key: m.key, label: m.label, hex: m.hex, values: series.map(function (r) { return Number(r[m.key]) || 0; }) };
    }));

    // the facts a curve does not say out loud
    var views = series.map(function (r) { return Number(r.views) || 0; });
    var best = 0, bestI = 0, sum = 0, active = 0;
    views.forEach(function (v, i) { sum += v; if (v > best) { best = v; bestI = i; } if (v > 0) active++; });
    var half = Math.floor(views.length / 2);
    var firstHalf = views.slice(0, half).reduce(function (a, x) { return a + x; }, 0);
    var lastHalf = views.slice(half).reduce(function (a, x) { return a + x; }, 0);
    var trend = firstHalf === 0
      ? (lastHalf > 0 ? 'Rising' : 'Flat')
      : (lastHalf > firstHalf * 1.1 ? 'Rising' : lastHalf < firstHalf * 0.9 ? 'Cooling' : 'Steady');

    // the current run of days with at least one view, counted back from today
    var streak = 0;
    for (var i = views.length - 1; i >= 0 && views[i] > 0; i--) streak++;

    var f = el('div', 'anCard');
    f.classList.add('anStack');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Trend read'));
    f.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: trend, l: 'Second half vs first' },
      { n: full(best), l: best > 0 ? 'Best day · ' + shortDate(labels[bestI]) : 'Best day' },
      { n: full(Math.round((sum / Math.max(1, views.length)) * 10) / 10), l: 'Views per day' },
      { n: streak + 'd', l: 'Current viewed streak' },
      { n: active + '/' + views.length, l: 'Days with a view' },
      { n: full((o['window'] || {}).uploads), l: 'Uploads this period' },
      { n: full((o['window'] || {}).views), l: 'Views this period' },
      { n: full((o.prev || {}).views), l: 'Views previous period' }
    ]);
    f.appendChild(fb);
    b.appendChild(f);
  }

  /* ---- 3. Artwork Performance ------------------------------------------- */
  var ART_SORTS = [
    { key: 'views', label: 'Views' },
    { key: 'likes', label: 'Likes' },
    { key: 'bookmarks', label: 'Saves' },
    { key: 'downloads', label: 'Downloads' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'created_at', label: 'Newest' }
  ];

  // One row builder for both places the list appears: the ten on the
  // dashboard and all of them on the page behind "View all". They have to be
  // the same row — a different-looking list on the full page would read as a
  // different list.
  function artRows(rows, limit) {
    var list = el('div', 'anArts');
    var show = limit ? rows.slice(0, limit) : rows;
    show.forEach(function (r, i) {
      var row = el('button', 'anArt');
      row.type = 'button';
      row.appendChild(el('div', 'anArtRank', String(i + 1)));

      // An empty src is not "no image", it is a request for the current page
      // that comes back as a broken-image icon. A row whose file never landed
      // gets a tile instead.
      var src = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(r.thumb || '') : (r.thumb || '');
      if (src) {
        var img = document.createElement('img');
        img.className = 'anArtThumb';
        img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
        img.src = src;
        img.addEventListener('error', function () {
          var ph = el('div', 'anArtNoThumb', '\uD83D\uDDBC');
          if (img.parentNode) img.parentNode.replaceChild(ph, img);
        });
        row.appendChild(img);
      } else {
        row.appendChild(el('div', 'anArtNoThumb', '\uD83D\uDDBC'));
      }

      var txt = el('div', 'anArtTxt');
      txt.appendChild(el('div', 'anArtName', r.title));
      var metaBits = [];
      if (typeof catLabel === 'function') metaBits.push(catLabel(r.category) || r.category);
      else metaBits.push(r.category);
      metaBits.push(pct(r.engagement) + ' engaged');
      if (r.visibility && r.visibility !== 'published') metaBits.push('unlisted');
      txt.appendChild(el('div', 'anArtMeta', metaBits.filter(Boolean).join(' \u00B7 ')));
      row.appendChild(txt);

      var nums = el('div', 'anArtNums');
      var last = state.scope === 'marketplace'
        ? ['\uD83D\uDED2', r.sales] : ['\u2B07\uFE0F', r.downloads];
      [['\uD83D\uDC41', r.views], ['\u2764\uFE0F', r.likes],
       ['\uD83D\uDD16', r.bookmarks], last].forEach(function (p) {
        var n = el('span', 'anArtNum');
        n.appendChild(document.createTextNode(p[0] + ' '));
        n.appendChild(el('b', null, num(p[1])));
        nums.appendChild(n);
      });
      row.appendChild(nums);

      row.addEventListener('click', function () {
        closeAnList();
        closeAnalyticsPage();
        var id = String(r.id);
        if (state.scope === 'artwork') {
          // the gallery owns the viewer; where it is not loaded, the URL is
          if (typeof window.handleArtClick === 'function' &&
              document.querySelector('.gItem[data-id="' + CSS.escape(id) + '"]')) {
            window.handleArtClick({ preventDefault: function () {}, stopPropagation: function () {} }, id);
          } else {
            location.href = '/artwork/' + encodeURIComponent(id);
          }
          return;
        }
        // the other three share one viewer, opened by path segment and id
        var seg = { marketplace: 'listing', blog: 'blog', resource: 'resource' }[state.scope];
        if (typeof window.dzOpenById === 'function') window.dzOpenById(seg, id);
        else location.href = '/' + seg + '/' + encodeURIComponent(id);
      });
      list.appendChild(row);
    });
    return list;
  }

  function paintArtworks() {
    var b = box('artworks'), c = state.data.content;
    if (!b) return;
    if (!c || c.error) { empty(b, 'COULDN’T LOAD YOUR ARTWORKS'); return; }
    var rows = (c.artworks || []).slice();
    var scw = scopeOf(state.scope);
    if (!rows.length) {
      empty(b, 'NO ' + scw.nouns.toUpperCase() + ' YET — PUBLISH ONE AND THIS FILLS IN');
      return;
    }
    b.innerHTML = '';

    var card = el('div', 'anCard');
    var hd = el('div', 'anCardHd');
    hd.appendChild(el('div', 'anCardTitle', 'Ranked over the period'));
    var sorts = el('div', 'anSort');
    ART_SORTS.forEach(function (s) {
      var btn = el('button', 'anSortBtn' + (state.artSort === s.key ? ' on' : ''), s.label);
      btn.type = 'button';
      btn.addEventListener('click', function () { state.artSort = s.key; paintArtworks(); });
      sorts.appendChild(btn);
    });
    hd.appendChild(sorts);
    card.appendChild(hd);

    var k = state.artSort;
    rows.sort(function (x, y) {
      if (k === 'created_at') return String(y.created_at).localeCompare(String(x.created_at));
      return (Number(y[k]) || 0) - (Number(x[k]) || 0);
    });

    var list = artRows(rows, CARD_ROWS);
    card.appendChild(list);
    if (rows.length > CARD_ROWS) {
      card.appendChild(moreBtn('View all ' + full(rows.length) + ' ' + scw.nouns,
                               function () { openAnList('items'); }));
    }
    b.appendChild(card);

    // best and quietest, said plainly
    var byViews = rows.slice().sort(function (x, y) { return (y.views || 0) - (x.views || 0); });
    var top = byViews[0], low = byViews[byViews.length - 1];
    var f = el('div', 'anCard');
    f.classList.add('anStack');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Highs and lows'));
    f.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: num(top ? top.views : 0), l: top ? 'Best: ' + top.title : 'Best' },
      { n: num(low ? low.views : 0), l: low ? 'Quietest: ' + low.title : 'Quietest' },
      { n: full(rows.reduce(function (a, r) { return a + (Number(r.views) || 0); }, 0)), l: 'Views in period' },
      { n: pct(rows.reduce(function (a, r) { return a + (Number(r.engagement) || 0); }, 0) / rows.length),
        l: 'Average engagement' }
    ]);
    f.appendChild(fb);
    b.appendChild(f);
  }

  /* ---- 4. Content Insights ---------------------------------------------- */
  function paintContent() {
    var b = box('content'), c = state.data.content;
    if (!b) return;
    if (!c || c.error) { empty(b, 'COULDN’T LOAD CONTENT INSIGHTS'); return; }
    b.innerHTML = '';

    var g = el('div', 'anGrid2');

    var catCard = el('div', 'anCard');
    var ch = el('div', 'anCardHd');
    ch.appendChild(el('div', 'anCardTitle', 'Views by category'));
    catCard.appendChild(ch);
    var catHost = el('div');
    var cats = (c.by_category || []).map(function (r, i) {
      return {
        label: (typeof catLabel === 'function' ? (catLabel(r.key) || r.key) : r.key),
        n: r.views, hex: WHEEL[i % WHEEL.length],
        sub: full(r.views) + ' · ' + r.artworks + (r.artworks === 1 ? ' piece' : ' pieces')
      };
    });
    if (cats.length) bars(catHost, cats); else empty(catHost, 'NO CATEGORIES YET');
    catCard.appendChild(catHost);
    g.appendChild(catCard);

    var tagCard = el('div', 'anCard');
    var th = el('div', 'anCardHd');
    th.appendChild(el('div', 'anCardTitle', 'Views by tag'));
    tagCard.appendChild(th);
    var tagHost = el('div');
    var tags = (c.by_tag || []).slice(0, 10).map(function (r) {
      return { label: '#' + r.key, n: r.views, sub: full(r.views) };
    });
    if (tags.length) bars(tagHost, tags, '#FF3DE0');
    else empty(tagHost, 'TAG YOUR WORK AND THIS FILLS IN');
    tagCard.appendChild(tagHost);
    g.appendChild(tagCard);

    var softCard = el('div', 'anCard');
    var sh = el('div', 'anCardHd');
    sh.appendChild(el('div', 'anCardTitle', 'Views by software'));
    softCard.appendChild(sh);
    var softHost = el('div');
    var softs = (c.by_software || []).map(function (r) {
      return { label: r.key, n: r.views, sub: full(r.views) };
    });
    if (softs.length) bars(softHost, softs, '#00D9B8');
    else empty(softHost, 'NAME THE SOFTWARE ON AN UPLOAD AND THIS FILLS IN');
    softCard.appendChild(softHost);
    g.appendChild(softCard);

    var cadCard = el('div', 'anCard');
    var dh = el('div', 'anCardHd');
    dh.appendChild(el('div', 'anCardTitle', 'Uploads per month'));
    cadCard.appendChild(dh);
    var cadHost = el('div');
    var cad = (c.cadence || []).map(function (r) {
      var parts = String(r.month).split('-');
      var dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
      return {
        label: dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        n: r.uploads, sub: full(r.uploads)
      };
    });
    if (cad.length) bars(cadHost, cad, '#16D95F');
    else empty(cadHost, 'NO UPLOADS IN THE LAST YEAR');
    cadCard.appendChild(cadHost);
    g.appendChild(cadCard);

    b.appendChild(g);

    var s = c.shape || {};
    var f = el('div', 'anCard');
    f.classList.add('anStack');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Your body of work'));
    f.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: full(s.artworks), l: scopeOf(state.scope).nouns.charAt(0).toUpperCase() +
                                 scopeOf(state.scope).nouns.slice(1) },
      { n: full(s.approved), l: 'Approved' },
      { n: full(s.unlisted), l: 'Unlisted' },
      { n: full(s.featured), l: 'Featured' },
      { n: full(s.avg_views), l: 'Average views' },
      { n: full(s.avg_likes), l: 'Average likes' },
      { n: full(s.licensed), l: 'With a licence' },
      { n: s.last_upload ? ago(s.last_upload) : '—', l: 'Last upload' }
    ]);
    f.appendChild(fb);
    b.appendChild(f);
  }

  /* ---- 5. Audience ------------------------------------------------------- */
  function paintAudience() {
    var b = box('audience'), r = state.data.reach;
    if (!b) return;
    if (!r || r.error) { empty(b, 'COULDN’T LOAD AUDIENCE'); return; }
    b.innerHTML = '';
    var a = r.audience || {};

    var f = el('div', 'anCard');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Who came by'));
    f.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: full(a.viewers), l: 'Unique viewers' },
      { n: full(a['new']), l: 'Saw you once' },
      { n: full(a.returning), l: 'Came back' },
      { n: full(a.signed_in), l: 'Signed in' },
      { n: full(a.days_per_viewer), l: 'Days per viewer' },
      { n: a.viewers > 0 ? Math.round((a.returning / a.viewers) * 100) + '%' : '0%', l: 'Return rate' },
      { n: full((r.countries || []).length), l: 'Countries seen' },
      { n: full((a.top_fans || []).length), l: 'Active fans' }
    ]);
    f.appendChild(fb);
    b.appendChild(f);

    var g = el('div', 'anGrid2');

    var cCard = el('div', 'anCard');
    var chd = el('div', 'anCardHd');
    chd.appendChild(el('div', 'anCardTitle', 'Countries'));
    cCard.appendChild(chd);
    var cHost = el('div');
    var countries = (r.countries || []).map(function (x, i) {
      return { label: flag(x.key) + '  ' + countryName(x.key), n: x.n, hex: WHEEL[i % WHEEL.length] };
    });
    if (countries.length) donut(cHost, countries, { midLabel: 'views' });
    else empty(cHost, dimNote(r));
    cCard.appendChild(cHost);
    g.appendChild(cCard);

    var fanCard = el('div', 'anCard');
    var fhd = el('div', 'anCardHd');
    fhd.appendChild(el('div', 'anCardTitle', 'Top fans'));
    fanCard.appendChild(fhd);
    var fanHost = el('div');
    var fans = a.top_fans || [];
    if (fans.length) {
      var wrap = el('div', 'anPeople');
      fans.forEach(function (p) { wrap.appendChild(personRow(p, p.n + (p.n === 1 ? ' action' : ' actions'))); });
      fanHost.appendChild(wrap);
    } else empty(fanHost, 'NOBODY HAS LIKED, SAVED OR COMMENTED YET');
    fanCard.appendChild(fanHost);
    g.appendChild(fanCard);

    var wdCard = el('div', 'anCard');
    var whd = el('div', 'anCardHd');
    whd.appendChild(el('div', 'anCardTitle', 'Busiest weekday'));
    wdCard.appendChild(whd);
    var wdHost = el('div');
    var wd = (a.by_weekday || []).map(function (x) {
      return { label: WEEKDAY[x.w] || String(x.w), n: x.n, sub: full(x.n) };
    });
    if (wd.some(function (x) { return x.n > 0; })) bars(wdHost, wd);
    else empty(wdHost, 'NO VIEWS IN THIS PERIOD');
    wdCard.appendChild(wdHost);
    g.appendChild(wdCard);

    var hCard = el('div', 'anCard');
    var hhd = el('div', 'anCardHd');
    hhd.appendChild(el('div', 'anCardTitle', 'Views by hour (UTC)'));
    hCard.appendChild(hhd);
    var hHost = el('div');
    var hours = a.by_hour || [];
    if (hours.some(function (x) { return x.n > 0; })) {
      var maxH = hours.reduce(function (m, x) { return Math.max(m, x.n); }, 1);
      var heat = el('div', 'anHeat');
      hours.forEach(function (x) {
        var col = el('div', 'anHeatCol');
        col.style.height = Math.max(3, (x.n / maxH) * 100) + '%';
        col.title = x.h + ':00 — ' + full(x.n) + ' views';
        heat.appendChild(col);
      });
      hHost.appendChild(heat);
      var ax = el('div', 'anHeatAxis');
      ['00', '06', '12', '18', '23'].forEach(function (t) { ax.appendChild(el('span', null, t)); });
      hHost.appendChild(ax);
    } else empty(hHost, dimNote(r));
    hCard.appendChild(hHost);
    g.appendChild(hCard);

    b.appendChild(g);
  }

  // A name on this page is a person the artist may well want to go and look
  // at — the artist who gave them cred, the one who has liked nine of their
  // pieces. So the row opens that profile, the same way every other list of
  // people on the site does. A row with no handle has nothing to open and
  // stays a plain div rather than a button that does nothing.
  function personRow(p, sub) {
    var row = el(p && p.handle ? 'button' : 'div', 'anPerson');
    if (p && p.handle) {
      row.type = 'button';
      row.setAttribute('aria-label', 'Open ' + (p.name || p.handle) + '’s profile');
      row.addEventListener('click', function () {
        if (typeof openProfileByUsername !== 'function') return;
        closeAnalyticsPage();
        openProfileByUsername(p.handle, true);
      });
    }
    if (p.avatar) {
      var img = document.createElement('img');
      img.className = 'anAva';
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
      img.src = p.avatar;
      row.appendChild(img);
    } else {
      row.appendChild(el('div', 'anAvaTxt', String(p.name || '?').charAt(0).toUpperCase()));
    }
    var txt = el('div');
    txt.style.minWidth = '0';
    txt.appendChild(el('div', 'anPersonName', p.name || 'Artist'));
    if (p.handle) txt.appendChild(el('div', 'anPersonSub', '@' + p.handle));
    row.appendChild(txt);
    row.appendChild(el('div', 'anPersonN', sub));
    return row;
  }

  // The one honest thing to say when a breakdown chart is empty: these
  // dimensions only exist from the day the site started recording them.
  function dimNote(r) {
    return (r && r.dimension_rows > 0)
      ? 'NOTHING RECORDED IN THIS PERIOD'
      : 'NOTHING YET — THIS FILLS IN AS PEOPLE VISIT YOUR WORK FROM NOW ON';
  }

  /* ---- 6. Traffic Sources ------------------------------------------------ */
  function paintTraffic() {
    var b = box('traffic'), r = state.data.reach;
    if (!b) return;
    if (!r || r.error) { empty(b, 'COULDN’T LOAD TRAFFIC'); return; }
    b.innerHTML = '';

    var g = el('div', 'anGrid2');

    var sCard = el('div', 'anCard');
    var sh = el('div', 'anCardHd');
    sh.appendChild(el('div', 'anCardTitle', 'How people arrived'));
    sCard.appendChild(sh);
    var sHost = el('div');
    var srcs = (r.sources || []).map(function (x) {
      return { label: SOURCE_LABEL[x.key] || x.key, n: x.n, hex: SOURCE_HEX[x.key] || '#8A8F98' };
    });
    if (srcs.length) donut(sHost, srcs, { midLabel: 'views' });
    else empty(sHost, dimNote(r));
    sCard.appendChild(sHost);
    g.appendChild(sCard);

    var dCard = el('div', 'anCard');
    var dh = el('div', 'anCardHd');
    dh.appendChild(el('div', 'anCardTitle', 'Devices'));
    dCard.appendChild(dh);
    var dHost = el('div');
    var devs = (r.devices || []).map(function (x) {
      return { label: DEVICE_LABEL[x.key] || x.key, n: x.n, hex: DEVICE_HEX[x.key] || '#8A8F98' };
    });
    if (devs.length) donut(dHost, devs, { midLabel: 'views' });
    else empty(dHost, dimNote(r));
    dCard.appendChild(dHost);
    g.appendChild(dCard);

    b.appendChild(g);

    var rCard = el('div', 'anCard');
    rCard.classList.add('anStack');
    var rh = el('div', 'anCardHd');
    rh.appendChild(el('div', 'anCardTitle', 'Sites that sent people'));
    rCard.appendChild(rh);
    var rHost = el('div');
    var refs = (r.referrers || []).map(function (x) {
      return { label: x.key, n: x.n, sub: full(x.n) };
    });
    if (refs.length) bars(rHost, refs, '#FFB300');
    else empty(rHost, 'NO OUTSIDE LINKS RECORDED — SHARE A PIECE AND WATCH THIS');
    rCard.appendChild(rHost);
    b.appendChild(rCard);
  }

  /* ---- 7. Search Analytics ----------------------------------------------- */
  function paintSearch() {
    var b = box('search'), r = state.data.reach;
    if (!b) return;
    if (!r || r.error) { empty(b, 'COULDN’T LOAD SEARCH'); return; }
    b.innerHTML = '';
    var s = r.search || {};
    var terms = s.terms || [];

    var f = el('div', 'anCard');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'On-site search'));
    f.appendChild(fh);
    var fb = el('div');
    var ctr = s.impressions > 0 ? Math.round((s.clicks / s.impressions) * 1000) / 10 : 0;
    facts(fb, [
      { n: full(s.impressions), l: 'Times you appeared' },
      { n: full(s.clicks), l: 'Times you were opened' },
      { n: ctr + '%', l: 'Click-through rate' },
      { n: full(terms.length), l: 'Distinct terms' }
    ]);
    f.appendChild(fb);
    b.appendChild(f);

    var card = el('div', 'anCard');
    card.classList.add('anStack');
    var hd = el('div', 'anCardHd');
    hd.appendChild(el('div', 'anCardTitle', 'What people searched'));
    card.appendChild(hd);
    if (!terms.length) {
      empty(card, dimNote(r));
    } else {
      var wrap = el('div', 'anTerms');
      var head = el('div', 'anTermHd');
      head.appendChild(el('div', null, 'Term'));
      var h2 = el('div', null, 'Shown'); h2.style.textAlign = 'right'; head.appendChild(h2);
      var h3 = el('div', null, 'Opened'); h3.style.textAlign = 'right'; head.appendChild(h3);
      var h4 = el('div', null, 'CTR'); h4.style.textAlign = 'right'; head.appendChild(h4);
      wrap.appendChild(head);
      terms.forEach(function (t) {
        var row = el('div', 'anTerm');
        row.appendChild(el('div', 'anTermTxt', t.term));
        row.appendChild(el('div', 'anTermN', full(t.impressions)));
        row.appendChild(el('div', 'anTermN', full(t.clicks)));
        row.appendChild(el('div', 'anTermN' + (t.ctr >= 20 ? ' hi' : ''), t.ctr + '%'));
        wrap.appendChild(row);
      });
      card.appendChild(wrap);
    }
    b.appendChild(card);
  }

  /* ---- 8. Engagement ----------------------------------------------------- */
  function paintEngagement() {
    var b = box('engage'), a = state.data.activity;
    if (!b) return;
    if (!a || a.error) { empty(b, 'COULDN’T LOAD ENGAGEMENT'); return; }
    b.innerHTML = '';
    var e = a.engagement || {};

    var g = el('div', 'anGrid2w');

    var rCard = el('div', 'anCard');
    var rh = el('div', 'anCardHd');
    rh.appendChild(el('div', 'anCardTitle', 'What a view turns into'));
    rCard.appendChild(rh);
    var row = el('div', 'anRingRow');
    var ringHost = el('div');
    ring(ringHost, e.rate, 'engaged', '#00A6FF');
    row.appendChild(ringHost.firstChild);
    var rates = el('div');
    rates.style.flex = '1 1 200px';
    var rateHost = el('div');
    bars(rateHost, [
      { label: 'Liked',     n: e.like_rate,    sub: pct(e.like_rate) },
      { label: 'Saved',     n: e.save_rate,    sub: pct(e.save_rate) },
      { label: 'Commented', n: e.comment_rate, sub: pct(e.comment_rate) }
    ], '#FF3D3D');
    rates.appendChild(rateHost);
    row.appendChild(rates);
    rCard.appendChild(row);
    g.appendChild(rCard);

    var fCard = el('div', 'anCard');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Totals'));
    fCard.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: num(e.views), l: 'Views' },
      { n: num(e.likes), l: 'Likes' },
      { n: num(e.bookmarks), l: 'Saves' },
      { n: num(e.comments), l: 'Comments' },
      { n: num(e.shares), l: 'Shares' },
      { n: num(e.downloads), l: 'Downloads' },
      { n: pct(e.rate), l: 'Engagement rate' },
      { n: full(e.views > 0 ? Math.round((e.likes / e.views) * 100) / 100 : 0), l: 'Likes per view' }
    ]);
    fCard.appendChild(fb);
    g.appendChild(fCard);
    b.appendChild(g);

    var feed = a.activity || [];
    var card = el('div', 'anCard');
    card.classList.add('anStack');
    var hd = el('div', 'anCardHd');
    hd.appendChild(el('div', 'anCardTitle', 'Latest on your work'));
    card.appendChild(hd);
    if (!feed.length) {
      empty(card, 'NOTHING YET');
    } else {
      var ICO = { like: ['❤️', '#FF3DE0'], bookmark: ['🔖', '#00A6FF'], comment: ['💬', '#FFB300'] };
      var list = el('div', 'anFeed');
      feed.slice(0, CARD_ROWS).forEach(function (x) {
        var r2 = el('div', 'anFeedRow');
        var pair = ICO[x.event] || ['•', '#8A8F98'];
        var ic = el('div', 'anFeedIco', pair[0]);
        ic.style.background = pair[1] + '22';
        r2.appendChild(ic);
        var t = el('div', 'anFeedTxt');
        var verb = x.event === 'like' ? 'Someone liked ' : x.event === 'bookmark' ? 'Someone saved ' : 'New comment on ';
        t.appendChild(document.createTextNode(verb));
        t.appendChild(el('b', null, x.title));
        r2.appendChild(t);
        r2.appendChild(el('div', 'anFeedAt', ago(x.at)));
        list.appendChild(r2);
      });
      card.appendChild(list);
      if (feed.length > CARD_ROWS) {
        card.appendChild(moreBtn('View all ' + full(feed.length),
                                 function () { openAnList('activity'); }));
      }
    }
    b.appendChild(card);
  }

  /* ---- 9. Followers ------------------------------------------------------ */
  /* ---- Revenue — the marketplace only ------------------------------------ */
  function paintRevenue() {
    var b = box('revenue'), a = state.data.activity;
    if (!b) return;                                  // not drawn for this scope
    if (!a || a.error) { empty(b, 'COULDN\u2019T LOAD REVENUE'); return; }
    var r = a.revenue;
    if (!r) { empty(b, 'NOTHING SOLD IN THIS PERIOD'); return; }
    b.innerHTML = '';

    var cur = r.currency || 'USD';
    function money(cents) {
      var n = (Number(cents) || 0) / 100;
      try {
        return n.toLocaleString(undefined, { style: 'currency', currency: cur,
                                             minimumFractionDigits: 2 });
      } catch (e) { return cur + ' ' + n.toFixed(2); }
    }

    var fCard = el('div', 'anCard');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Earned in this period'));
    fh.appendChild(el('div', 'anSecNote', 'after the platform fee'));
    fCard.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: money(r.net), l: 'Net this period' },
      { n: money(r.gross), l: 'Gross' },
      { n: money(r.fees), l: 'Fees' },
      { n: full(r.sales), l: 'Sales' },
      { n: money(r.net_all), l: 'Net all time' },
      { n: money(r.available), l: 'Available' },
      { n: money(r.pending), l: 'Clearing' },
      { n: r.sales > 0 ? money(Math.round(r.net / r.sales)) : money(0), l: 'Average sale' }
    ]);
    fCard.appendChild(fb);
    b.appendChild(fCard);

    var cCard = el('div', 'anCard anStack');
    var ch = el('div', 'anCardHd');
    ch.appendChild(el('div', 'anCardTitle', 'Earned per day'));
    cCard.appendChild(ch);
    var cHost = el('div');
    var srs = r.series || [];
    if (srs.some(function (x) { return Number(x.net) > 0; })) {
      lineChart(cHost, srs.map(function (x) { return x.d; }), [{
        key: 'net', label: 'Net (' + cur + ')', hex: '#16D95F',
        values: srs.map(function (x) { return (Number(x.net) || 0) / 100; })
      }]);
    } else empty(cHost, 'NOTHING EARNED IN THIS PERIOD');
    cCard.appendChild(cHost);
    b.appendChild(cCard);
  }

  /* ---- Account & Cred — the one block that is not this section ----------- */
  function paintAccount() {
    var b = box('account'), a = state.data.activity;
    if (!b) return;
    if (!a || a.error) { empty(b, 'COULDN\u2019T LOAD YOUR ACCOUNT'); return; }
    b.innerHTML = '';
    var f = a.account || {};

    var fCard = el('div', 'anCard');
    var fh = el('div', 'anCardHd');
    fh.appendChild(el('div', 'anCardTitle', 'Cred received'));
    // The one thing on the page that is deliberately not a section number,
    // and it says so rather than being mistaken for one. Cred is given to a
    // person on their profile — there is no blog cred or artwork cred.
    fh.appendChild(el('div', 'anSecNote', 'account-wide \u2014 cred is given to you, not to a ' +
                                          scopeOf(state.scope).noun));
    fCard.appendChild(fh);
    var fb = el('div');
    facts(fb, [
      { n: full(f.cred_total), l: 'Cred all time' },
      { n: '+' + full(f.cred_gained), l: 'This period' },
      { n: full(f.cred_givers), l: 'Artists who gave it' },
      { n: full(f.cred_given), l: 'Cred you gave' }
    ]);
    fCard.appendChild(fb);
    b.appendChild(fCard);

    var g = el('div', 'anGrid2 anStack');

    var cCard = el('div', 'anCard');
    var ch = el('div', 'anCardHd');
    ch.appendChild(el('div', 'anCardTitle', 'Cred per day'));
    cCard.appendChild(ch);
    var cHost = el('div');
    var srs = f.cred_series || [];
    if (srs.some(function (x) { return x.gained > 0; })) {
      lineChart(cHost, srs.map(function (x) { return x.d; }), [{
        key: 'cred', label: 'Cred', hex: '#16D95F',
        values: srs.map(function (x) { return Number(x.gained) || 0; })
      }]);
    } else empty(cHost, 'NO CRED IN THIS PERIOD');
    cCard.appendChild(cHost);
    g.appendChild(cCard);

    var rCard = el('div', 'anCard');
    var rh = el('div', 'anCardHd');
    rh.appendChild(el('div', 'anCardTitle', 'Who gave it'));
    rCard.appendChild(rh);
    var rHost = el('div');
    var recent = f.cred_recent || [];
    if (recent.length) {
      var wrap = el('div', 'anPeople');
      recent.forEach(function (p) { wrap.appendChild(personRow(p, ago(p.at))); });
      rHost.appendChild(wrap);
    } else empty(rHost, 'NOBODY HAS GIVEN YOU CRED YET');
    rCard.appendChild(rHost);
    g.appendChild(rCard);

    b.appendChild(g);
  }

  /* ---- 10. Community ----------------------------------------------------- */
  function paintCommunity() {
    var b = box('community'), a = state.data.activity;
    if (!b) return;
    if (!a || a.error) { empty(b, 'COULDN’T LOAD COMMUNITY'); return; }
    b.innerHTML = '';
    var c = a.account || {};

    var card = el('div', 'anCard');
    var hd = el('div', 'anCardHd');
    hd.appendChild(el('div', 'anCardTitle', 'Your part in the place'));
    hd.appendChild(el('div', 'anSecNote', 'account-wide'));
    card.appendChild(hd);
    var fb = el('div');
    facts(fb, [
      { n: full(c.communities_joined), l: 'Communities joined' },
      { n: full(c.communities_owned), l: 'Communities you run' },
      { n: full(c.messages), l: 'Messages sent' },
      { n: full(c.dms), l: 'Direct messages sent' },
      { n: full(c.comments_made), l: 'Comments you left' },
      { n: full(c.friends), l: 'Friends' },
      { n: full(c.profile_views), l: 'Profile views' },
      { n: full(c.merit), l: 'Merit' }
    ]);
    card.appendChild(fb);
    b.appendChild(card);
  }

  /* ---- 11. Goals & Achievements ------------------------------------------ */
  var GOAL_METRICS = [
    { key: 'views', label: 'Views' }, { key: 'likes', label: 'Likes' },
    { key: 'bookmarks', label: 'Saves' }, { key: 'downloads', label: 'Downloads' },
    { key: 'comments', label: 'Comments' }, { key: 'uploads', label: 'Uploads' },
    { key: 'sales', label: 'Sales', only: 'marketplace' }
  ];
  function goalMetricsFor(sc) {
    return GOAL_METRICS.filter(function (m) {
      if (m.only) return m.only === sc;
      return !(m.key === 'downloads' && sc === 'marketplace');
    });
  }
  var GOAL_PERIODS = [
    { key: '7d', label: 'in 7 days' }, { key: '30d', label: 'in 30 days' },
    { key: '90d', label: 'in 90 days' }, { key: 'all', label: 'all time' }
  ];
  function goalLabel(k) {
    for (var i = 0; i < GOAL_METRICS.length; i++) if (GOAL_METRICS[i].key === k) return GOAL_METRICS[i].label;
    return k;
  }
  function periodLabel(k) {
    for (var i = 0; i < GOAL_PERIODS.length; i++) if (GOAL_PERIODS[i].key === k) return GOAL_PERIODS[i].label;
    return k;
  }

  function paintGoals() {
    var b = box('goals'), a = state.data.activity;
    if (!b) return;
    if (!a || a.error) { empty(b, 'COULDN’T LOAD GOALS'); return; }
    b.innerHTML = '';

    var gCard = el('div', 'anCard');
    var gh = el('div', 'anCardHd');
    gh.appendChild(el('div', 'anCardTitle', 'Goals'));
    gh.appendChild(el('div', 'anSecNote', 'for ' + scopeOf(state.scope).nouns));
    gCard.appendChild(gh);

    var goals = a.goals || [];
    var list = el('div', 'anGoals');
    if (!goals.length) {
      list.appendChild(el('div', 'anEmpty', 'NO GOALS YET — SET ONE BELOW'));
    }
    goals.forEach(function (g) {
      var card = el('div', 'anGoal');
      var top = el('div', 'anGoalTop');
      top.appendChild(el('div', 'anGoalName', full(g.target) + ' ' + goalLabel(g.metric).toLowerCase()));
      top.appendChild(el('div', 'anGoalWhen', periodLabel(g.period)));
      if (g.achieved_at) top.appendChild(el('div', 'anGoalDone', 'Reached'));
      var x = el('button', 'anGoalX', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove goal');
      x.addEventListener('click', function () { removeGoal(g.id); });
      top.appendChild(x);
      card.appendChild(top);

      var track = el('div', 'anBarTrack');
      var fill = el('div', 'anBarFill');
      var share = Math.min(100, (Number(g.progress) / Math.max(1, Number(g.target))) * 100);
      fill.style.width = Math.max(2, share) + '%';
      if (g.achieved_at) fill.style.background = 'var(--an-up)';
      track.appendChild(fill);
      card.appendChild(track);

      var nums = el('div', 'anGoalNums');
      nums.appendChild(el('span', null, full(g.progress) + ' of ' + full(g.target)));
      nums.appendChild(el('span', null, Math.round(share) + '%'));
      card.appendChild(nums);
      list.appendChild(card);
    });
    gCard.appendChild(list);

    var form = el('div', 'anGoalNew');
    var mSel = el('select');
    mSel.setAttribute('aria-label', 'Goal metric');
    goalMetricsFor(state.scope).forEach(function (m) {
      var o = el('option', null, m.label); o.value = m.key; mSel.appendChild(o);
    });
    var tIn = el('input');
    tIn.type = 'number'; tIn.min = '1'; tIn.max = '100000000';
    tIn.placeholder = 'Target';
    tIn.setAttribute('aria-label', 'Goal target');
    var pSel = el('select');
    pSel.setAttribute('aria-label', 'Goal period');
    GOAL_PERIODS.forEach(function (p) {
      var o = el('option', null, p.label); o.value = p.key;
      if (p.key === '30d') o.selected = true;
      pSel.appendChild(o);
    });
    var add = el('button', 'anGoalAdd', 'Set goal');
    add.type = 'button';
    add.addEventListener('click', function () {
      var target = parseInt(tIn.value, 10);
      if (!target || target < 1) { toast('Type a target first'); return; }
      add.disabled = true;
      addGoal(mSel.value, target, pSel.value).then(function () {
        add.disabled = false; tIn.value = '';
      }, function () { add.disabled = false; });
    });
    form.appendChild(mSel); form.appendChild(tIn); form.appendChild(pSel); form.appendChild(add);
    gCard.appendChild(form);
    b.appendChild(gCard);

    var aCard = el('div', 'anCard');
    aCard.classList.add('anStack');
    var ah = el('div', 'anCardHd');
    ah.appendChild(el('div', 'anCardTitle', 'Achievements'));
    var done = (a.achievements || []).filter(function (x) { return x.done; }).length;
    ah.appendChild(el('div', 'anSecNote', done + ' of ' + (a.achievements || []).length + ' earned'));
    aCard.appendChild(ah);
    var grid = el('div', 'anAch');
    (a.achievements || []).forEach(function (x) {
      var card = el('div', 'anAchCard' + (x.done ? ' done' : ''));
      card.appendChild(el('div', 'anAchIco', x.done ? '🏆' : '🔒'));
      var txt = el('div', 'anAchTxt');
      txt.appendChild(el('div', 'anAchTitle', x.title));
      txt.appendChild(el('div', 'anAchNote', x.done ? x.note : (full(x.have) + ' / ' + full(x.need))));
      if (!x.done) {
        var bar = el('div', 'anAchBar');
        var fill = el('div', 'anAchBarFill');
        fill.style.width = Math.min(100, (Number(x.have) / Math.max(1, Number(x.need))) * 100) + '%';
        bar.appendChild(fill);
        txt.appendChild(bar);
      }
      card.appendChild(txt);
      grid.appendChild(card);
    });
    aCard.appendChild(grid);
    b.appendChild(aCard);
  }

  // Goals are plain rows under RLS, so they are written straight rather than
  // through an RPC. The unique index means "set 500 views in 30 days" twice is
  // one goal with the newer target, which is what a person means by it.
  async function addGoal(metric, target, period) {
    var c = db(), u = me();
    if (!c || !u) return;
    try {
      var r = await c.from('analytics_goals')
        .upsert({ user_id: u.id, scope: state.scope, metric: metric,
                  target: target, period: period, achieved_at: null },
                { onConflict: 'user_id,scope,metric,period' });
      if (r.error) throw r.error;
      toast('Goal set');
      await refresh();
    } catch (e) {
      toast((e && e.message && /limit/i.test(e.message)) ? 'You already have 12 goals' : 'Could not save the goal');
      throw e;
    }
  }
  async function removeGoal(id) {
    var c = db(), u = me();
    if (!c || !u) return;
    try {
      var r = await c.from('analytics_goals').delete().eq('id', id).eq('user_id', u.id);
      if (r.error) throw r.error;
      await refresh();
    } catch (e) { toast('Could not remove the goal'); }
  }

  /* ---- 12. Comparisons --------------------------------------------------- */
  function paintCompare() {
    var b = box('compare'), o = state.data.overview;
    if (!b) return;
    if (!o || o.error) { empty(b, 'COULDN’T LOAD COMPARISONS'); return; }
    b.innerHTML = '';
    var cmp = o.compare || {}, win = o['window'] || {}, prev = o.prev || {};

    var pCard = el('div', 'anCard');
    var ph = el('div', 'anCardHd');
    ph.appendChild(el('div', 'anCardTitle', 'This period vs the one before'));
    pCard.appendChild(ph);
    var pHost = el('div');
    bars(pHost, metricsFor(state.scope).map(function (m) {
      var cur = Number(win[m.key]) || 0, pv = Number(prev[m.key]) || 0;
      var d = delta(cur, pv);
      return { label: m.label, n: cur, sub: full(cur) + ' vs ' + full(pv) + ' · ' + d.txt.replace(' on previous', '') };
    }));
    pCard.appendChild(pHost);
    b.appendChild(pCard);

    var sCard = el('div', 'anCard');
    sCard.classList.add('anStack');
    var sh = el('div', 'anCardHd');
    sh.appendChild(el('div', 'anCardTitle', 'Against the rest of DigiArtz'));
    sh.appendChild(el('div', 'anSecNote', 'views over the same window'));
    sCard.appendChild(sh);

    var top = Math.max(Number(cmp.my_views) || 0, Number(cmp.median_views) || 0, Number(cmp.avg_views) || 0, 1);
    var wrap = el('div', 'anCmpWrap');
    var bar = el('div', 'anCmpBar');
    var fill = el('div', 'anCmpFill');
    fill.style.width = Math.max(2, ((Number(cmp.my_views) || 0) / top) * 100) + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);

    // The marks go on the wrapper, not in the bar: the bar clips its fill, so
    // a label hung below it inside is a label nobody can see. Two references
    // that land on top of each other — which is what happens when an artist is
    // far ahead of both — are stacked rather than overprinted.
    var marks = [['median_views', 'median'], ['avg_views', 'average']]
      .map(function (pair) { return { v: Number(cmp[pair[0]]) || 0, name: pair[1] }; })
      .filter(function (m) { return m.v > 0; })
      .sort(function (x, y) { return x.v - y.v; });
    var lastPct = -99;
    marks.forEach(function (m) {
      var p = Math.min(99, (m.v / top) * 100);
      var tick = el('div', 'anCmpMark');
      tick.style.left = p + '%';
      wrap.appendChild(tick);
      var lb = el('div', 'anCmpMarkL', m.name + ' ' + full(m.v));
      // past 70% the label would run off the right edge, so it hangs left
      if (p > 70) { lb.style.right = (100 - p) + '%'; lb.style.textAlign = 'right'; }
      else lb.style.left = p + '%';
      if (p - lastPct < 18) lb.style.top = '58px';
      lastPct = p;
      wrap.appendChild(lb);
    });
    sCard.appendChild(wrap);
    sCard.appendChild(el('div', 'anCmpMine', 'Your ' + full(cmp.my_views) + ' views this period'));

    // the reference labels under the bar own the space above this
    var fb = el('div', 'anStack');
    facts(fb, [
      { n: full(cmp.my_views), l: 'Your views' },
      { n: full(cmp.median_views), l: 'Site median' },
      { n: full(cmp.avg_views), l: 'Site average' },
      { n: (cmp.percentile == null ? 0 : cmp.percentile) + '%', l: 'You beat this share' }
    ]);
    sCard.appendChild(fb);
    b.appendChild(sCard);
  }

  /* ---- live -------------------------------------------------------------- */

  // Two ways to hear about a change, because neither is enough alone.
  // Realtime is instant and can be blocked by a proxy, a corporate firewall or
  // a flaky socket; the poll is slow and always works. Both funnel into one
  // debounced refresh, so a burst of ten likes is one repaint.
  //
  // A refresh asked for while one is already in flight is not dropped — it is
  // remembered and run once the first lands. Dropping it is how a dashboard
  // ends up one event behind and stays there: the very moment something
  // happens is the moment a load is most likely to be running.
  function refresh() {
    if (state.loading) { state.again = true; return Promise.resolve(); }
    return load(false);
  }

  function markDirty() {
    clearTimeout(state.dirty);
    state.dirty = setTimeout(function () { if (state.open) refresh(); }, 1200);
  }

  function startLive() {
    stopLive();
    var c = db(), u = me();
    if (!c || !u) return;

    state.poll = setInterval(function () {
      if (state.open && !document.hidden) refresh();
    }, 45000);

    if (typeof c.channel !== 'function') { setLive(false); return; }

    // Realtime reads the same RLS policy the table carries, so the socket has
    // to be carrying this member's token or the server has nothing to check
    // and sends nothing. supabase-js sets it on its own when the session
    // changes; a page that has been open since before this panel existed may
    // never have had that moment, so it is set here too.
    try {
      if (c.realtime && typeof c.realtime.setAuth === 'function' &&
          c.auth && typeof c.auth.getSession === 'function') {
        c.auth.getSession().then(function (r) {
          var tok = r && r.data && r.data.session && r.data.session.access_token;
          if (tok) { try { c.realtime.setAuth(tok); } catch (e) {} }
        }, function () {});
      }
    } catch (e) {}

    try {
      state.channel = c.channel('dz-analytics-' + u.id)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'analytics_events', filter: 'owner_id=eq.' + u.id },
            markDirty)
        .subscribe(function (status) {
          setLive(status === 'SUBSCRIBED');
          // A dropped socket is the case the poll exists for, so nothing is
          // lost while this is down — but it should come back rather than
          // leave the page on the slow path for the rest of the session.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(state.retry);
            state.retry = setTimeout(function () {
              if (state.open) startLive();
            }, 15000);
          }
        });
    } catch (e) { setLive(false); }
  }

  function stopLive() {
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
    clearTimeout(state.dirty);
    clearTimeout(state.retry);
    var c = db();
    if (state.channel && c && typeof c.removeChannel === 'function') {
      try { c.removeChannel(state.channel); } catch (e) {}
    }
    state.channel = null;
  }

  function setLive(on) {
    var n = $('anLive');
    if (!n) return;
    n.setAttribute('data-state', on ? 'on' : 'off');
    var txt = n.lastChild;
    if (txt) txt.textContent = on ? 'Live' : 'Auto-refresh';
    n.title = on ? 'Updating the moment something happens'
                 : 'Refreshing every 45 seconds';
  }

  // Coming back to a tab that has been asleep should not show yesterday.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.open) refresh();
  });

  /* ---- fitting the screen ------------------------------------------------ */

  // The charts are drawn at the width they were measured at, so a rotation or
  // a window drag has to redraw them. It is a repaint from data already in
  // hand — no request goes out — and it is debounced, because a drag fires
  // this a hundred times.
  var fitTimer = null;
  function refit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      if (!state.open) return;
      measureHeader();
      if (state.data.overview) paint();
    }, 180);
  }
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);

  // The chip row sits under the page header, and the header is not the same
  // height on a phone as on a desktop. Measured rather than hardcoded, so the
  // chips never hide behind it or float below a gap.
  function measureHeader() {
    var pg = $('anPage');
    if (!pg) return;
    var hdr = pg.querySelector('.subPgHdr');
    if (hdr) pg.style.setProperty('--an-hdr', Math.round(hdr.getBoundingClientRect().height) + 'px');
  }

  /* ---- the full list, on a page of its own -------------------------------
   * The dashboard shows ten of anything. Everything else is here: the same
   * rows, the same sort buttons, no cap. It is built on demand and it sits
   * over the dashboard rather than replacing it, so closing it puts you back
   * exactly where you were — the same way every other sub-page on this site
   * behaves.
   */
  var anListMode = 'items';

  function anListHost() {
    var pg = $('anListPage');
    if (pg) return pg;
    pg = document.createElement('div');
    pg.id = 'anListPage';
    pg.setAttribute('role', 'dialog');
    pg.setAttribute('aria-modal', 'true');

    var hdr = el('div', 'subPgHdr');
    var back = el('button', 'subPgX', '\u2190');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to analytics');
    back.addEventListener('click', closeAnList);
    hdr.appendChild(back);
    var t = el('div', 'subPgTitle');
    t.id = 'anListTitle';
    hdr.appendChild(t);
    pg.appendChild(hdr);

    var body = el('div', 'anBdy');
    body.id = 'anListBdy';
    pg.appendChild(body);
    document.body.appendChild(pg);
    return pg;
  }

  function openAnList(mode) {
    anListMode = mode === 'activity' ? 'activity' : 'items';
    var pg = anListHost();
    pg.classList.add('open');
    var hdr = pg.querySelector('.subPgHdr');
    if (hdr) pg.style.setProperty('--an-hdr', Math.round(hdr.getBoundingClientRect().height) + 'px');
    paintAnList();
    pg.scrollTop = 0;
  }

  function closeAnList() {
    var pg = $('anListPage');
    if (!pg) return;
    pg.classList.remove('open');
    // the dashboard is still open underneath, so the scroll lock stays on
    document.body.style.overflow = 'hidden';
  }

  function paintAnList() {
    var pg = $('anListPage');
    if (!pg || !pg.classList.contains('open')) return;
    var body = $('anListBdy'), ttl = $('anListTitle');
    if (!body) return;
    var sc = scopeOf(state.scope);
    body.innerHTML = '';

    if (anListMode === 'activity') {
      var feed = (state.data.activity && state.data.activity.activity) || [];
      if (ttl) ttl.textContent = 'LATEST ON YOUR WORK';
      pg.setAttribute('aria-label', 'Everything that happened on your work');
      var card = el('div', 'anCard');
      var hd = el('div', 'anCardHd');
      hd.appendChild(el('div', 'anCardTitle', full(feed.length) + ' most recent'));
      card.appendChild(hd);
      if (!feed.length) { empty(card, 'NOTHING YET'); body.appendChild(card); return; }
      var ICO = { like: ['\u2764\uFE0F', '#FF3D3D'], bookmark: ['\uD83D\uDD16', '#00D9B8'],
                  comment: ['\uD83D\uDCAC', '#FF3DE0'] };
      var list = el('div', 'anFeed');
      feed.forEach(function (x) {
        var row = el('div', 'anFeedRow');
        var pair = ICO[x.event] || ['\u2022', '#8A8F98'];
        var ic = el('div', 'anFeedIco', pair[0]);
        ic.style.background = pair[1] + '22';
        row.appendChild(ic);
        var t = el('div', 'anFeedTxt');
        var verb = x.event === 'like' ? 'Someone liked ' :
                   x.event === 'bookmark' ? 'Someone saved ' : 'New comment on ';
        t.appendChild(document.createTextNode(verb));
        t.appendChild(el('b', null, x.title));
        row.appendChild(t);
        row.appendChild(el('div', 'anFeedAt', ago(x.at)));
        list.appendChild(row);
      });
      card.appendChild(list);
      body.appendChild(card);
      return;
    }

    var rows = ((state.data.content && state.data.content.artworks) || []).slice();
    if (ttl) ttl.textContent = 'ALL ' + sc.nouns.toUpperCase();
    pg.setAttribute('aria-label', 'All ' + sc.nouns);

    var card2 = el('div', 'anCard');
    var hd2 = el('div', 'anCardHd');
    hd2.appendChild(el('div', 'anCardTitle', full(rows.length) + ' ' + sc.nouns));
    var sorts = el('div', 'anSort');
    ART_SORTS.forEach(function (so) {
      if (so.key === 'downloads' && state.scope === 'marketplace') so = { key: 'sales', label: 'Sales' };
      var btn = el('button', 'anSortBtn' + (state.artSort === so.key ? ' on' : ''), so.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        state.artSort = so.key;
        paintAnList();
        paintArtworks();     // the card behind agrees with the page in front
      });
      sorts.appendChild(btn);
    });
    hd2.appendChild(sorts);
    card2.appendChild(hd2);

    if (!rows.length) { empty(card2, 'NOTHING HERE YET'); body.appendChild(card2); return; }

    var k = state.artSort;
    rows.sort(function (x, y) {
      if (k === 'created_at') return String(y.created_at).localeCompare(String(x.created_at));
      return (Number(y[k]) || 0) - (Number(x[k]) || 0);
    });
    card2.appendChild(artRows(rows, 0));
    body.appendChild(card2);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var pg = $('anListPage');
    if (!pg || !pg.classList.contains('open')) return;
    closeAnList();
    // stopImmediatePropagation, not stopPropagation: the dashboard's own
    // Escape handler is on this same node, and stopPropagation does not hold
    // off a listener on the node the event is already at. Without this, one
    // press closes the list and then the dashboard behind it.
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  /* ---- open / close ------------------------------------------------------ */

  function openAnalyticsPage(scope) {
    if (!me()) {
      toast('Sign in to see your analytics');
      if (typeof openAuthMod === 'function') openAuthMod();
      return;
    }
    var pg = $('anPage');
    if (!pg) return;
    // Rebuilt every time rather than repainted: the section list differs by
    // scope — Revenue exists under Marketplace and nowhere else — and a card
    // left behind from the last dashboard would be a lie.
    var want = scopeOf(scope || 'artwork').key;
    state.scope = want;
    var body = $('anBdy');
    if (body) { body.innerHTML = ''; body.dataset.built = ''; }
    state.data = { overview: null, content: null, reach: null, activity: null };
    buildShell();
    state.lastFocus = document.activeElement;
    state.open = true;
    pg.classList.add('open');
    document.body.style.overflow = 'hidden';
    measureHeader();
    loadMyName();
    load(true);
    startLive();
  }

  function closeAnalyticsPage() {
    var pg = $('anPage');
    if (!pg) return;
    state.open = false;
    stopLive();
    pg.classList.remove('open');
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
    var back = state.lastFocus;
    state.lastFocus = null;
    if (back && back.isConnected && back.focus) {
      try { back.focus({ preventScroll: true }); } catch (e) { try { back.focus(); } catch (e2) {} }
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // The full list sits over the dashboard and closes first. Both handlers
    // are capture-phase listeners on document, so stopPropagation in the
    // other one cannot hold this one off — it has to check for itself, and
    // then the order the two were registered in stops mattering.
    var list = $('anListPage');
    if (list && list.classList.contains('open')) return;
    var pg = $('anPage');
    if (pg && pg.classList.contains('open')) { closeAnalyticsPage(); e.stopPropagation(); }
  }, true);

  // Signing out with the page open must not leave one member's numbers on
  // screen for the next one.
  document.addEventListener('DOMContentLoaded', function () {
    var c = db();
    if (c && c.auth && c.auth.onAuthStateChange) {
      c.auth.onAuthStateChange(function () {
        // the cached name belongs to whoever was signed in a moment ago
        myName = null;
        if (!state.open) return;
        if (!me()) closeAnalyticsPage();
        else { stopLive(); loadMyName(); load(true); startLive(); }
      });
    }
  });

  window.openAnalyticsPage = openAnalyticsPage;
  window.closeAnalyticsPage = closeAnalyticsPage;
})();
