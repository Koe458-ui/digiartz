/* ── ranking.js · ranking boards ── */
  /* ── Ranking boards ───────────────────────────────────────────
     Four independent boards, one card each. Every card owns its
     own paging cursor + scroll listener, so scrolling one board to
     the end never touches the others.

     Server side (SECURITY DEFINER, search_path pinned):
       get_rank_board(board, lim, off) -> rnk, uid, username,
                                          avatar_url, score, lvl, total
       get_rank_me(board)              -> rnk, score, lvl, total
     Scores are derived, never stored: LEVEL = the same XP formula as
     get_artist_progress(); CRED = profiles.cred_received_count;
     LIKES / BOOKMARKS = totals RECEIVED across the artist's approved
     artworks. Ties share a rank (two #1s, then #3) — rank() does that.

     Live update: a 45s tick, but only while the section is actually
     on screen (IntersectionObserver) and the tab is visible, so an
     idle page makes zero requests. A repaint only happens when the
     data signature really changed, and a board the user has scrolled
     into is left alone until they scroll back to the top — nothing
     ever yanks under their thumb. */
  (function () {
    'use strict';

    var TICK_MS = 45000;    /* live refresh cadence */
    var TOP = 10;           /* the box shows the TOP 10 only — everything else
                               lives on the full ranking page (openRankPage) */
    var PG_PAGE = 50;       /* full page: rows per fetch (server caps lim at 50) */
    var NEAR_END = 240;     /* px from the bottom that triggers the next page */

    /* The right-hand value on every row reads like the Artist Progress
       leaderboard's "LEVEL 23" — the board's own word, then the number. */
    var BOARDS = [
      { key:'level',     name:'LEVEL',     word:'LEVEL' },
      { key:'cred',      name:'CRED',      word:'CRED' },
      { key:'likes',     name:'LIKES',     word:'LIKES' },
      { key:'bookmarks', name:'BOOKMARKS', word:'SAVES' }
    ];

    var state = {};   /* key -> { rows, total, busy, sig, listEl, mineEl, headEl, allEl } */
    var timer = null, seen = false, started = false;

    function db () { return (typeof sb !== 'undefined' && sb) ? sb : null; }
    function me () { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
    function el (tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function num (n) { return (Number(n) || 0).toLocaleString(); }
    function thumb (u) {
      if (!u) return null;
      return (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(u) : u;
    }
    function valueOf (b, row) {
      return b.key === 'level'
        ? ('LEVEL ' + (Number(row.lvl) || 1))
        : (b.word + ' ' + num(row.score));
    }

    /* ── card shell ── */
    function buildCards () {
      var grid = document.getElementById('rkGrid');
      if (!grid) return false;
      grid.innerHTML = '';
      BOARDS.forEach(function (b) {
        /* .xpCard = the exact card the Artist Progress leaderboard uses.
           .rkCard only adds the strip sizing/snap on top of it. */
        var card = el('article', 'rkCard rkCard--' + b.key + ' xpCard');

        /* the clear heading: board name + how many artists are ranked */
        var head = el('div', 'rkHead');
        head.appendChild(el('div', 'rkHeadT', b.name + ' LEADERBOARD'));
        head.appendChild(el('div', 'rkHeadN', 'TOP 10'));
        card.appendChild(head);

        var list = el('div', 'rkList');
        list.appendChild(el('div', 'rkSkel'));
        list.appendChild(el('div', 'rkSkel'));
        list.appendChild(el('div', 'rkSkel'));
        card.appendChild(list);

        var mine = el('div', 'rkMine');
        mine.appendChild(el('span', 'rkMineLbl', 'Your rank'));
        card.appendChild(mine);

        var all = el('button', 'rkAll', 'VIEW FULL RANKING \u2192');
        all.type = 'button';
        all.onclick = function () { openRankPage(b.key); };
        card.appendChild(all);

        grid.appendChild(card);

        state[b.key] = { rows: [], total: 0, busy: false, sig: '',
                         listEl: list, mineEl: mine, headEl: head, allEl: all };
      });
      return true;
    }

    /* ── Carousel: ONE board per slide, on every device ───────────
       The track is a plain CSS snap-scroller, so a swipe is a native
       swipe — no drag JS, no jank. This only mirrors the scroll
       position into the dots/arrows, and drives the track on click. */
    var track, dotsWrap, prevBtn, nextBtn, cur = 0;

    /* A card is no longer one track wide (they're separate boxes with a
       gap and a peek), so slide/sync work off each card's real position
       inside the track rather than index × viewport width. */
    function cardAt (i) { return (track && track.children[i]) ? track.children[i] : null; }
    function centreOf (c) { return c.offsetLeft + c.clientWidth / 2; }

    function slideTo (i) {
      if (!track) return;
      i = Math.max(0, Math.min(BOARDS.length - 1, i));
      var c = cardAt(i);
      if (!c) return;
      track.scrollTo({ left: centreOf(c) - track.clientWidth / 2, behavior: 'smooth' });
    }
    function syncNav () {
      if (!track) return;
      /* whichever card sits nearest the middle of the strip is "current" */
      var mid = track.scrollLeft + track.clientWidth / 2, best = 0, bd = Infinity;
      for (var i = 0; i < BOARDS.length; i++) {
        var c = cardAt(i);
        if (!c) continue;
        var d = Math.abs(centreOf(c) - mid);
        if (d < bd) { bd = d; best = i; }
      }
      cur = best;
      if (dotsWrap) {
        var dots = dotsWrap.children;
        for (var k = 0; k < dots.length; k++) {
          dots[k].classList.toggle('on', k === cur);
          dots[k].setAttribute('aria-selected', k === cur ? 'true' : 'false');
        }
      }
      if (prevBtn) prevBtn.disabled = (cur === 0);
      if (nextBtn) nextBtn.disabled = (cur === BOARDS.length - 1);
    }
    function buildNav () {
      track    = document.getElementById('rkGrid');
      dotsWrap = document.getElementById('rkDots');
      prevBtn  = document.getElementById('rkPrev');
      nextBtn  = document.getElementById('rkNext');
      if (!track) return;

      if (dotsWrap) {
        dotsWrap.innerHTML = '';
        BOARDS.forEach(function (b, i) {
          var d = el('button', 'rkDot' + (i === 0 ? ' on' : ''));
          d.type = 'button';
          d.setAttribute('role', 'tab');
          d.setAttribute('aria-label', b.name);
          d.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
          d.onclick = function () { slideTo(i); };
          dotsWrap.appendChild(d);
        });
      }
      if (prevBtn) prevBtn.onclick = function () { slideTo(cur - 1); };
      if (nextBtn) nextBtn.onclick = function () { slideTo(cur + 1); };

      var raf = null;
      track.addEventListener('scroll', function () {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = null; syncNav(); });
      }, { passive: true });
      /* a rotate/resize changes the card width — re-anchor on the board the
         user was actually looking at, don't drift mid-way. Above 1000px the
         track is a grid (no scrolling), so this settles harmlessly at 0. */
      window.addEventListener('resize', function () {
        var c = cardAt(cur);
        if (c) track.scrollLeft = centreOf(c) - track.clientWidth / 2;
        syncNav();
      });
      syncNav();
    }

    /* ── fetch the TOP 10 for a box (one call, no paging) ── */
    async function loadTop (b) {
      var s = state[b.key], c = db();
      if (!s || s.busy) return;
      if (!c) { note(s, 'RANKING UNAVAILABLE'); return; }
      s.busy = true;
      try {
        var r = await c.rpc('get_rank_board', { board: b.key, lim: TOP, off: 0 });
        if (r.error) throw r.error;
        var rows = r.data || [];
        s.rows  = rows;
        s.total = rows.length ? (Number(rows[0].total) || 0) : 0;
        render(b);
      } catch (e) {
        if (!s.rows.length) note(s, 'COULDN\u2019T LOAD RANKING');
      } finally {
        s.busy = false;
      }
    }

    function note (s, msg) {
      s.listEl.innerHTML = '';
      s.listEl.appendChild(el('div', 'xpNote', msg));
    }

    /* ── one ranking row — the SAME .xpLbRow the Artist Progress
       leaderboard paints: 1ST/2ND/3RD medal (then #4…), 30px avatar,
       tier-painted name via DZ_MS, value on the right, .self highlight
       for you. Shared by the boxes and the full page.

       onTap decides what a row does: in a BOX it opens the full ranking
       page (tapping any rank goes to the dedicated page); on the PAGE it
       opens that artist's profile. */
    var MEDAL = ['1ST', '2ND', '3RD'];

    function rowEl (b, r, uid, onTap) {
      var row = el('div', 'xpLbRow' + (uid && r.uid === uid ? ' self' : ''));
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      /* real rank, not the array index — ties genuinely share a place */
      var pos = Number(r.rnk) || 0;
      row.appendChild(el('div',
        'xpLbRank' + (pos >= 1 && pos <= 3 ? ' m' + pos : ''),
        (pos >= 1 && pos <= 3) ? MEDAL[pos - 1] : ('#' + pos)));

      var ava = el('div', 'xpLbAva');
      var src = thumb(r.avatar_url);
      if (src) {
        var img = document.createElement('img');
        img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
        img.src = src;
        img.onerror = function () { ava.textContent = (r.username || '?').charAt(0).toUpperCase(); };
        ava.appendChild(img);
      } else {
        ava.textContent = (r.username || '?').charAt(0).toUpperCase();
      }
      row.appendChild(ava);

      var nameEl = el('div', 'xpLbName', r.username || 'Artist');
      /* same tier tint the rest of the site gives a display name */
      if (window.DZ_MS) DZ_MS.paintName(nameEl, Number(r.lvl) || 0);
      row.appendChild(nameEl);

      row.appendChild(el('div', 'xpLbLvl', valueOf(b, r)));

      row.onclick = function () { onTap(r); };
      row.onkeydown = function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onTap(r); }
      };
      return row;
    }

    /* ── paint a box: the heading, TOP 10 rows, then YOUR RANK + VIEW ALL.
       Signature-guarded, so the 45s tick never repaints when nothing moved. */
    function render (b) {
      var s = state[b.key];
      var uid = me() ? me().id : null;
      var sig = s.rows.map(function (r) { return r.rnk + ':' + r.uid + ':' + r.score + ':' + r.lvl; })
                      .join('|') + '#' + s.total + '#' + uid;
      if (sig === s.sig) return;
      s.sig = sig;

      /* heading count: "6 ARTISTS" once we know, "TOP 10" until then */
      var n = s.headEl && s.headEl.querySelector('.rkHeadN');
      if (n) n.textContent = s.total ? (num(s.total) + (s.total === 1 ? ' ARTIST' : ' ARTISTS')) : 'TOP 10';

      /* the button says how many are hidden behind it */
      if (s.allEl) {
        s.allEl.textContent = (s.total > s.rows.length)
          ? ('VIEW ALL ' + num(s.total) + ' \u2192')
          : 'VIEW FULL RANKING \u2192';
      }

      var list = s.listEl;
      list.innerHTML = '';

      if (!s.rows.length) {
        list.appendChild(el('div', 'xpNote', 'NO RANKED ARTISTS YET'));
        return;
      }

      s.rows.forEach(function (r) {
        list.appendChild(rowEl(b, r, uid, function () { openRankPage(b.key); }));
      });
    }

    /* ── the pinned "your rank" footer ── */
    async function loadMine (b) {
      var s = state[b.key], c = db(), u = me();
      if (!s) return;
      var f = s.mineEl;
      f.innerHTML = '';
      f.classList.remove('tap');
      f.onclick = null;

      if (!u) {
        f.appendChild(el('span', 'rkMineLbl', 'Sign in to see your rank'));
        f.classList.add('tap');
        f.onclick = function () { if (typeof openAuthMod === 'function') openAuthMod(); };
        return;
      }
      if (!c) { f.appendChild(el('span', 'rkMineLbl', 'Your rank')); return; }

      f.appendChild(el('span', 'rkMineLbl', 'Your rank'));
      /* signed in → the footer is a shortcut into the full ranking page */
      f.classList.add('tap');
      f.onclick = function () { openRankPage(b.key); };
      try {
        var r = await c.rpc('get_rank_me', { board: b.key });
        if (r.error) throw r.error;
        var d = (r.data && r.data[0]) || null;
        if (!d) {
          /* logged in but nothing scored on this board yet */
          var un = el('span', 'rkMinePos', 'UNRANKED');
          f.appendChild(un);
          return;
        }
        f.appendChild(el('span', 'rkMinePos',
          '#' + num(d.rnk) + ' OF ' + num(d.total) + ' \u00B7 ' + valueOf(b, d)));
      } catch (e) {
        f.appendChild(el('span', 'rkMinePos', '\u2014'));
      }
    }

    /* ── refresh one board ── */
    function reload (b) {
      loadTop(b);
      loadMine(b);
    }

    /* A tick refreshes every board. The box no longer scrolls (it's a fixed
       top 10), so there's nothing to yank under the user — and render() is
       signature-guarded, so an unchanged board doesn't even repaint. */
    function tick () {
      if (document.visibilityState !== 'visible' || !seen) return;
      BOARDS.forEach(reload);
    }

    function start () {
      if (started) return;
      started = true;
      BOARDS.forEach(reload);
      clearInterval(timer);
      timer = setInterval(tick, TICK_MS);
    }

    document.addEventListener('DOMContentLoaded', function () {
      if (!buildCards()) return;
      buildNav();
      var sec = document.getElementById('rankSec');
      /* Only wake up once the section is actually scrolled into view —
         the home page shouldn't fire four RPCs above the fold. */
      if (sec && 'IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            seen = en.isIntersecting;
            if (seen) start();
          });
        }, { rootMargin: '200px 0px' });
        io.observe(sec);
      } else {
        seen = true; start();
      }
      /* coming back to the tab after a while → refresh immediately */
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && started) tick();
      });
    });

    /* ═══════════════════════════════════════════════════════════
       FULL RANKING PAGE (#rankPage)
       A dedicated page — same overlay pattern as Notifications /
       Admin Panel: slides in from the right, its own header with a
       ← close button, and it takes the bottom nav out of the way.

       Tapping ANY rank in a box lands here. It lists EVERY ranked
       artist, not just the top 10, paging 50 at a time until the
       real end. Board tabs across the top switch between the four
       boards without leaving the page, and YOUR rank sits in a
       banner above the list. A row here opens that artist's profile.
       ═══════════════════════════════════════════════════════════ */
    var pg = { board: 'level', rows: [], off: 0, total: 0, done: false, busy: false, wired: false };

    function pgBoard () {
      for (var i = 0; i < BOARDS.length; i++) if (BOARDS[i].key === pg.board) return BOARDS[i];
      return BOARDS[0];
    }

    function pgBuildTabs () {
      var wrap = document.getElementById('rkPgTabs');
      if (!wrap) return;
      wrap.innerHTML = '';
      BOARDS.forEach(function (b) {
        var t = el('button', 'rkPgTab' + (b.key === pg.board ? ' on' : ''), b.name);
        t.type = 'button';
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', b.key === pg.board ? 'true' : 'false');
        t.onclick = function () {
          if (pg.board === b.key) return;
          pg.board = b.key;
          pgBuildTabs();
          pgReset();
        };
        wrap.appendChild(t);
      });
    }

    function pgReset () {
      pg.rows = []; pg.off = 0; pg.total = 0; pg.done = false;
      var list = document.getElementById('rkPgList');
      if (list) {
        list.innerHTML = '';
        list.appendChild(el('div', 'rkSkel'));
        list.appendChild(el('div', 'rkSkel'));
        list.appendChild(el('div', 'rkSkel'));
      }
      var page = document.getElementById('rankPage');
      if (page) page.scrollTop = 0;
      pgLoadMine();
      pgLoad();
    }

    /* everyone, 50 at a time, until the true end */
    async function pgLoad () {
      var c = db(), b = pgBoard();
      if (pg.busy || pg.done) return;
      var list = document.getElementById('rkPgList');
      if (!list) return;
      if (!c) { list.innerHTML = ''; list.appendChild(el('div', 'xpNote', 'RANKING UNAVAILABLE')); return; }
      pg.busy = true;
      try {
        var r = await c.rpc('get_rank_board', { board: b.key, lim: PG_PAGE, off: pg.off });
        if (r.error) throw r.error;
        var rows = r.data || [];
        if (!pg.off) list.innerHTML = '';               /* clear the skeletons */
        if (rows.length) pg.total = Number(rows[0].total) || pg.total;
        pg.rows = pg.rows.concat(rows);
        pg.off += rows.length;
        if (rows.length < PG_PAGE || (pg.total && pg.rows.length >= pg.total)) pg.done = true;

        var uid = me() ? me().id : null;
        rows.forEach(function (row) {
          list.appendChild(rowEl(b, row, uid, function (rr) {
            if (!rr.username || typeof openProfileByUsername !== 'function') return;
            closeRankPage();
            openProfileByUsername(rr.username, true);
          }));
        });

        var end = document.getElementById('rkPgEnd');
        if (end) {
          end.textContent = pg.done
            ? (pg.rows.length ? ('END \u00B7 ' + num(pg.total || pg.rows.length) + ' RANKED ARTISTS') : '')
            : 'LOADING\u2026';
        }
        if (!pg.rows.length) list.appendChild(el('div', 'xpNote', 'NO RANKED ARTISTS YET'));
      } catch (e) {
        if (!pg.rows.length) { list.innerHTML = ''; list.appendChild(el('div', 'xpNote', 'COULDN\u2019T LOAD RANKING')); }
      } finally {
        pg.busy = false;
      }
    }

    async function pgLoadMine () {
      var box = document.getElementById('rkPgMine'), c = db(), u = me(), b = pgBoard();
      if (!box) return;
      box.innerHTML = '';
      box.classList.remove('tap');
      box.onclick = null;

      if (!u) {
        box.appendChild(el('span', 'rkMineLbl', 'Sign in to see your rank'));
        box.classList.add('tap');
        box.onclick = function () { if (typeof openAuthMod === 'function') openAuthMod(); };
        return;
      }
      box.appendChild(el('span', 'rkMineLbl', 'Your rank'));
      if (!c) return;
      try {
        var r = await c.rpc('get_rank_me', { board: b.key });
        if (r.error) throw r.error;
        var d = (r.data && r.data[0]) || null;
        if (!d) { box.appendChild(el('span', 'rkMinePos', 'UNRANKED')); return; }
        box.appendChild(el('span', 'rkMinePos',
          '#' + num(d.rnk) + ' OF ' + num(d.total) + ' \u00B7 ' + valueOf(b, d)));
      } catch (e) {
        box.appendChild(el('span', 'rkMinePos', '\u2014'));
      }
    }

    window.openRankPage = function (boardKey) {
      var page = document.getElementById('rankPage');
      if (!page) return;
      pg.board = boardKey || 'level';

      if (!pg.wired) {
        pg.wired = true;
        /* the PAGE is the scroller — page in more rows as it nears the end */
        page.addEventListener('scroll', function () {
          if (pg.busy || pg.done) return;
          if (page.scrollHeight - page.scrollTop - page.clientHeight < NEAR_END) pgLoad();
        }, { passive: true });
      }

      page.classList.add('open');
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      var nav = document.getElementById('bnNav');
      if (nav) nav.style.display = 'none';

      pgBuildTabs();
      pgReset();
    };

    window.closeRankPage = function () {
      var page = document.getElementById('rankPage');
      if (!page) return;
      page.classList.remove('open');
      var nav = document.getElementById('bnNav');
      if (nav) nav.style.display = '';
      if (typeof restoreScroll === 'function') restoreScroll();
      else { document.body.style.overflow = ''; document.documentElement.style.overflow = ''; }
    };

    /* Esc closes it, same as the other overlays */
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var page = document.getElementById('rankPage');
      if (page && page.classList.contains('open')) closeRankPage();
    });

    /* Signing in/out changes the "you" highlight and the footer, so let the
       auth code nudge us. Safe to call any time; a no-op before start(). */
    window.rkRefresh = function () {
      if (started) BOARDS.forEach(reload);
      var page = document.getElementById('rankPage');
      if (page && page.classList.contains('open')) { pgLoadMine(); pgReset(); }
    };
  })();
