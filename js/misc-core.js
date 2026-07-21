/* ── misc-core.js · milestone colours + offline cache ── */
/* ── Milestone colour system (DZ_MS) ──────────────────────────
   The single source of truth for "what colour is this artist?".
   Anywhere a level is known, one call paints it — name and ribbon
   pull the SAME token, so they can never drift apart.

     DZ_MS.tierFor(level)          -> tier object, or null below LVL 5
     DZ_MS.paintName(el, level)    -> tints a display name
     DZ_MS.paintRibbon(el, level)  -> fills a .msRibbon chip
     DZ_MS.fill(t) / DZ_MS.ink(t)  -> raw css values, for custom surfaces

   Colours live in CSS (--ms1..--ms8), never here — that keeps the
   light-theme remap working and means a palette change is a one-line
   token edit, not a JS edit. */
(function () {
  'use strict';
  var TIERS = [
    { lvl: 5,   name: 'New Artist',      v: '--ms1' },
    { lvl: 10,  name: 'Sketch Explorer', v: '--ms2' },
    { lvl: 20,  name: 'Creative Soul',   v: '--ms3' },
    { lvl: 35,  name: 'Gallery Artist',  v: '--ms4' },
    { lvl: 50,  name: 'Community Star',  v: '--ms5' },
    { lvl: 70,  name: 'Master Creator',  v: '--ms6' },
    { lvl: 85,  name: 'Elite Artist',    v: '--ms7' },
    { lvl: 100, name: 'DigiArtz Legend', v: '--ms8' }
  ];

  /* Highest tier the level has reached. Below LVL 5 there is no tier —
     an unranked artist keeps the default name colour and shows no chip,
     which is what makes the first ribbon feel earned. */
  function tierFor (level) {
    var lv = Number(level) || 0, t = null;
    for (var i = 0; i < TIERS.length; i++) { if (lv >= TIERS[i].lvl) t = TIERS[i]; }
    return t;
  }
  function fill (t) { return t ? 'var(' + t.v + ')' : ''; }        /* chip background */
  function nameC (t) { return t ? 'var(' + t.v + '-name)' : ''; }  /* text on the page */

  function paintName (el, level) {
    if (!el) return;
    var t = tierFor(level);
    el.classList.toggle('msName', !!t);
    if (t) el.style.setProperty('--ms-c', nameC(t));
    else   el.style.removeProperty('--ms-c');
  }

  function paintRibbon (el, level) {
    if (!el) return;
    var t = tierFor(level);
    el.textContent = '';
    if (!t) { el.hidden = true; el.style.removeProperty('--ms-c'); return; }
    el.hidden = false;
    el.style.setProperty('--ms-c', fill(t));
    var lv = document.createElement('span');
    lv.className = 'msRibLvl';
    lv.textContent = 'LVL ' + t.lvl;
    el.appendChild(lv);
    el.appendChild(document.createTextNode(' ' + t.name));
    el.setAttribute('title', t.name + ' \u00B7 reached at level ' + t.lvl);
  }

  window.DZ_MS = {
    TIERS: TIERS,
    tierFor: tierFor,
    fill: fill,
    nameColor: nameC,
    paintName: paintName,
    paintRibbon: paintRibbon
  };
})();

/* ── Artist Progress ──────────────────────────────────────────
   XP / level / milestones / leaderboard. XP is derived server-side
   by get_artist_progress() / get_xp_leaderboard() (uploads x10,
   likes x2, bookmarks x2, comments x1) — nothing stored, nothing
   to tamper with. The level curve below is the site's exact 100-level
   table and matches public.xp_to_level() in the database. */
(function () {
  'use strict';
  var XP_TOTALS = [0,8,16,24,32,41,50,59,68,78,88,98,108,119,130,141,152,164,176,188,
    200,213,226,239,252,266,280,294,308,323,338,353,368,384,400,416,432,449,466,483,
    500,518,536,554,572,591,610,629,648,668,688,708,728,749,770,791,812,834,856,878,
    900,923,946,969,992,1016,1040,1064,1089,1115,1141,1167,1193,1220,1247,1274,1301,1329,1357,1385,
    1413,1442,1471,1500,1529,1559,1589,1619,1649,1680,1711,1742,1773,1805,1837,1869,1901,1934,1967,2000];
  var RANKS = [
    { lvl: 5,   name: 'New Artist' },
    { lvl: 10,  name: 'Sketch Explorer' },
    { lvl: 20,  name: 'Creative Soul' },
    { lvl: 35,  name: 'Gallery Artist' },
    { lvl: 50,  name: 'Community Star' },
    { lvl: 70,  name: 'Master Creator' },
    { lvl: 85,  name: 'Elite Artist' },
    { lvl: 100, name: 'DigiArtz Legend' }
  ];
  function levelOf (xp) {
    var l = 1;
    for (var i = 0; i < XP_TOTALS.length; i++) { if (xp >= XP_TOTALS[i]) l = i + 1; else break; }
    return l;
  }
  function rankTitle (level) {
    var t = 'Newcomer';
    RANKS.forEach(function (r) { if (level >= r.lvl) t = r.name; });
    return t;
  }
  function el (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgIcon (d) {
    var w = document.createElement('span');
    w.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    return w.firstChild;
  }
  var ICONS = {
    upload:   '<path d="M12 17V4m0 0 5 5m-5-5-5 5"/><path d="M4 20h16"/>',
    like:     '<path d="M12 20.3 4.8 13a4.6 4.6 0 1 1 6.5-6.5l.7.7.7-.7A4.6 4.6 0 1 1 19.2 13Z"/>',
    bookmark: '<path d="M6.5 3.5h11V21L12 16.8 6.5 21Z"/>',
    comment:  '<path d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12Z"/>'
  };

  /* ── data + render ── */
  function client () { return (typeof sb !== 'undefined' && sb) ? sb : null; }

  window.xpLoadInto = async function (wrapId, targetId, opts) {
    opts = opts || {};
    var wrap = document.getElementById(wrapId);
    if (!wrap) return;
    if (!targetId) { wrap.innerHTML = ''; wrap.appendChild(el('div', 'xpNote', 'SIGN IN TO SEE YOUR PROGRESS \u2726')); return; }
    var c = client();
    if (!c) { wrap.innerHTML = ''; wrap.appendChild(el('div', 'xpNote', 'PROGRESS UNAVAILABLE \u2014 TRY AGAIN')); return; }
    wrap.innerHTML = '';
    wrap.appendChild(el('div', 'xpNote', 'LOADING\u2026'));
    try {
      var calls = [c.rpc('get_artist_progress', { target: targetId })];
      if (opts.leaderboard) calls.push(c.rpc('get_xp_leaderboard', { lim: 10 }));
      var res = await Promise.all(calls);
      if (res[0].error) throw res[0].error;
      var p = (res[0].data && res[0].data[0]) || { uploads: 0, likes_given: 0, bookmarks_given: 0, comments_made: 0, xp: 0, level: 1 };
      var lb = (opts.leaderboard && res[1] && !res[1].error) ? (res[1].data || []) : null;
      renderAll(wrap, p, lb, targetId);
    } catch (e) {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'xpNote', 'COULDN\u2019T LOAD PROGRESS \u2014 TRY AGAIN'));
    }
  };

  function renderAll (wrap, p, lb, targetId) {
    wrap.innerHTML = '';
    var xp = Number(p.xp) || 0;
    var level = Number(p.level) || levelOf(xp);

    /* rank card */
    var rank = el('div', 'xpCard xpRank');
    rank.appendChild(el('div', 'xpRankLvl', 'LEVEL ' + level));
    rank.appendChild(el('div', 'xpRankTitle', '\u2726 ' + rankTitle(level) + ' \u2726'));
    var cur = XP_TOTALS[level - 1];
    var next = level < 100 ? XP_TOTALS[level] : null;
    var track = el('div', 'xpBarTrack');
    var fill = el('div', 'xpBarFill');
    track.appendChild(fill);
    rank.appendChild(track);
    var nums = el('div', 'xpBarNums');
    nums.appendChild(el('span', null, xp + ' XP'));
    nums.appendChild(el('span', null, next != null ? next + ' XP' : 'MAX'));
    rank.appendChild(nums);
    var nxt = el('div', 'xpNext');
    if (next != null) {
      nxt.appendChild(document.createTextNode(''));
      var b = el('b', null, String(next - xp) + ' XP');
      nxt.appendChild(b);
      nxt.appendChild(document.createTextNode(' UNTIL LEVEL ' + (level + 1)));
    } else {
      nxt.textContent = 'MAX LEVEL REACHED \u2726';
    }
    rank.appendChild(nxt);
    wrap.appendChild(rank);
    /* animate the fill after layout */
    var pct = next != null ? Math.max(0, Math.min(100, (xp - cur) * 100 / (next - cur))) : 100;
    requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + '%'; }); });

    /* how to earn */
    var earn = el('div', 'xpCard');
    earn.appendChild(el('div', 'xpCardLbl', 'HOW TO EARN XP'));
    var eg = el('div', 'xpGrid2');
    [['upload', 'Upload an artwork', '+10 XP'],
     ['like', 'Like an artwork', '+2 XP'],
     ['bookmark', 'Bookmark an artwork', '+2 XP'],
     ['comment', 'Comment', '+1 XP']].forEach(function (r) {
      var row = el('div', 'xpEarnRow');
      row.appendChild(svgIcon(ICONS[r[0]]));
      row.appendChild(el('span', null, r[1]));
      row.appendChild(el('span', 'xpEarnAmt', r[2]));
      eg.appendChild(row);
    });
    earn.appendChild(eg);
    wrap.appendChild(earn);

    /* stats */
    var stats = el('div', 'xpCard');
    stats.appendChild(el('div', 'xpCardLbl', 'COMMUNITY ACTIVITY'));
    var sg = el('div', 'xpGrid2');
    [[p.uploads, 'ARTWORKS UPLOADED'], [p.likes_given, 'LIKES GIVEN'],
     [p.bookmarks_given, 'BOOKMARKS GIVEN'], [p.comments_made, 'COMMENTS MADE']].forEach(function (s) {
      var t = el('div', 'xpStat');
      t.appendChild(el('div', 'xpStatNum', String(Number(s[0]) || 0)));
      t.appendChild(el('div', 'xpStatLbl', s[1]));
      sg.appendChild(t);
    });
    stats.appendChild(sg);
    wrap.appendChild(stats);

    /* milestones */
    var mile = el('div', 'xpCard');
    mile.appendChild(el('div', 'xpCardLbl', 'ARTIST MILESTONES'));
    var curTitle = rankTitle(level);
    RANKS.forEach(function (r) {
      var done = level >= r.lvl;
      var row = el('div', 'xpMile' + (done ? ' done' : '') + (done && r.name === curTitle ? ' cur' : ''));
      /* Each row carries its OWN tier colour — the list doubles as the
         palette key, so an artist can see exactly which colour they are
         climbing toward. Locked rows stay neutral: the colour is the
         reward. */
      var t = window.DZ_MS && DZ_MS.tierFor(r.lvl);
      if (t && done) {
        row.style.setProperty('--ms-c', DZ_MS.fill(t));
        row.style.setProperty('--ms-n', DZ_MS.nameColor(t));
      }
      row.appendChild(el('div', 'xpMileBadge', done ? '\u2713' : String(r.lvl)));
      row.appendChild(el('div', 'xpMileName', r.name));
      row.appendChild(el('div', 'xpMileLvl', 'LVL ' + r.lvl));
      mile.appendChild(row);
    });
    wrap.appendChild(mile);

    /* leaderboard */
    if (lb) {
      var board = el('div', 'xpCard');
      board.appendChild(el('div', 'xpCardLbl', 'COMMUNITY LEADERBOARD'));
      if (!lb.length) board.appendChild(el('div', 'xpNote', 'NO RANKED ARTISTS YET'));
      lb.forEach(function (row, i) {
        var r = el('div', 'xpLbRow' + (row.user_id === targetId ? ' self' : ''));
        r.appendChild(el('div', 'xpLbRank' + (i < 3 ? ' m' + (i + 1) : ''), i < 3 ? ['1ST', '2ND', '3RD'][i] : '#' + (i + 1)));
        var ava = el('div', 'xpLbAva');
        if (row.avatar_url) {
          var img = document.createElement('img');
          img.alt = ''; img.loading = 'lazy';
          img.src = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(row.avatar_url) : row.avatar_url;
          ava.appendChild(img);
        } else {
          ava.textContent = (row.username || '?').charAt(0).toUpperCase();
        }
        r.appendChild(ava);
        var lbName = el('div', 'xpLbName', row.username || 'Artist');
        if (window.DZ_MS) DZ_MS.paintName(lbName, Number(row.level) || 0);
        r.appendChild(lbName);
        r.appendChild(el('div', 'xpLbLvl', 'LEVEL ' + (Number(row.level) || 1)));
        board.appendChild(r);
      });
      wrap.appendChild(board);
    }
  }

  /* ── sliding page (profile hamburger) ── */
  var xpLastFocus = null;
  window.openXpPage = function () {
    var pg = document.getElementById('xpPage');
    if (!pg) return;
    xpLastFocus = document.activeElement;
    pg.classList.add('open');
    var nav = document.getElementById('bnNav');
    if (nav) nav.style.display = 'none';
    document.body.style.overflow = 'hidden';
    /* show the profile currently being viewed; fall back to self */
    var target = (window.pf && window.pf.profile && window.pf.profile.id) ||
                 (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null;
    window.xpLoadInto('xpPageWrap', target, { leaderboard: true });
  };
  window.closeXpPage = function () {
    var pg = document.getElementById('xpPage');
    if (!pg) return;
    pg.classList.remove('open');
    var nav = document.getElementById('bnNav');
    if (nav) nav.style.display = '';
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
    if (xpLastFocus && xpLastFocus.focus) xpLastFocus.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var pg = document.getElementById('xpPage');
    if (pg && pg.classList.contains('open')) window.closeXpPage();
  });
})();

/* ── Offline cache layer ──────────────────────────────────────
   Registers /sw.js (app shell + top-50 thumbnails + last-50
   viewed artworks + fonts, all cached on-device) and surfaces
   connectivity changes. Data snapshots are saved by the loaders
   above via dzcSet(); together they make the site browsable with
   no internet: gallery, community messages, friends, your
   profile and the conversation list all render from cache. */
(function () {
  'use strict';
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* registration is best-effort — the site works without it */
      });
    });
  }
  window.addEventListener('offline', function () {
    if (typeof showToast === 'function') showToast('You\u2019re offline \u2014 showing saved copies \u2726');
  });
  window.addEventListener('online', function () {
    if (typeof showToast === 'function') showToast('Back online \u2726');
  });
})();
