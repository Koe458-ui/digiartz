// community header modes
    (function () {
      'use strict';
      function $ (id) { return document.getElementById(id); }

      // the chat panel slides in over the community page, which stays mounted
      window.cmChatPanelOpen = function () {
        var p = $('cmChatPanel'); if (!p) return;
        p.style.paddingBottom = '';
        p.classList.add('open');
      };
      window.cmChatPanelClose = function () {
        var p = $('cmChatPanel'); if (!p) return;
        p.classList.remove('open');
        p.style.paddingBottom = ''; // drop any keyboard offset
      };
      // the whole section is leaving, so skip the slide
      window.cmChatPanelReset = function () {
        var p = $('cmChatPanel'); if (!p) return;
        p.classList.add('noAnim');
        p.classList.remove('open');
        p.style.paddingBottom = '';
        void p.offsetWidth;          // commit the closed state untransitioned
        p.classList.remove('noAnim'); // next open slides again
      };

      window.cmHdrChatMode = function (o) {
        o = o || {};
        var hdr = $('cmHdr'); if (!hdr) return;
        var img = $('cmHdrAvImg'), txt = $('cmHdrAvTxt'), av = $('cmHdrAv');
        var nm  = $('cmHdrName'), sub = $('cmHdrSub'), tap = $('cmHdrTap');

        if (av)  av.style.background = o.grad || 'linear-gradient(135deg,var(--pb),var(--pg))';
        if (img && txt) {
          if (o.avatar) {
            img.src = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(o.avatar) : o.avatar;
            img.style.display = 'block'; txt.style.display = 'none';
            // fallback to initial
            img.onerror = function () {
              img.style.display = 'none'; txt.style.display = '';
              txt.textContent = o.emoji || o.letter || '?';
            };
          } else {
            img.removeAttribute('src'); img.style.display = 'none';
            txt.style.display = ''; txt.textContent = o.emoji || o.letter || '?';
          }
        }
        if (nm)  nm.textContent = o.name || 'Chat';
        if (sub) {
          sub.innerHTML = '';
          if (o.subDot) { var d = document.createElement('span'); d.className = 'dot'; sub.appendChild(d); }
          if (o.sub) { var s = document.createElement('span'); s.textContent = o.sub; sub.appendChild(s); }
          sub.style.display = (o.sub || o.subDot) ? 'flex' : 'none';
        }
        if (tap) {
          tap.onclick = o.tap || null;
          tap.classList.toggle('on', !!o.tap);
          if (o.tap) { tap.setAttribute('role', 'button'); tap.setAttribute('tabindex', '0'); }
          else { tap.removeAttribute('role'); tap.removeAttribute('tabindex'); }
        }
        hdr.classList.add('chat');
        var back = $('cmHdrBack'); if (back) back.classList.add('show');
      };
      // the header lives in the chat panel, so leave its look alone while it
      // slides out — only the handlers need clearing
      window.cmHdrHomeMode = function () {
        var tap = $('cmHdrTap');
        if (tap) {
          tap.onclick = null;
          tap.classList.remove('on');
          tap.removeAttribute('role');
          tap.removeAttribute('tabindex');
        }
      };

      // ---- tabs -------------------------------------------------------------
      // Community and Friends are two panes under one banner. Which one is open
      // is also what the header search searches — there is one search box, not
      // one per pane, so it has to know where it is pointed.
      var tab = 'community', searchTimer = null;

      var TABS = {
        community: { btn: 'cmTabCommunity', pane: 'cmPaneCommunity',
                     hint: 'Search communities' },
        friends:   { btn: 'cmTabFriends',   pane: 'cmPaneFriends',
                     hint: 'Search artists by username' }
      };

      window.cmCurrentTab = function () { return tab; };

      window.cmSetTab = function (next) {
        if (!TABS[next]) return;
        tab = next;
        Object.keys(TABS).forEach(function (k) {
          var on = k === next;
          var b = $(TABS[k].btn), p = $(TABS[k].pane);
          if (b) { b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
          if (p) p.hidden = !on;
        });
        var inp = $('cmSearchInput');
        if (inp) inp.placeholder = TABS[next].hint;
        // a query typed against communities means nothing against people, so
        // the box is emptied rather than re-run against the other pane
        clearSearchValue();
        var scroll = $('cmGridScroll');
        if (scroll) scroll.scrollTop = 0;
      };

      // ---- header search ----------------------------------------------------
      function clearSearchValue () {
        var inp = $('cmSearchInput');
        if (inp) inp.value = '';
        clearTimeout(searchTimer);
        filterCommunities('');
        var box = $('dmResults'); if (box) box.innerHTML = '';
      }

      // opening a chat leaves the results behind it — dm.js calls this so the
      // page under the panel is not still showing a half-typed query
      window.cmSearchReset = function () {
        var bar = $('cmSearchBar'), btn = $('cmSearchBtn');
        clearSearchValue();
        if (bar) bar.hidden = true;
        if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
      };

      window.cmToggleSearch = function () {
        var bar = $('cmSearchBar'), btn = $('cmSearchBtn');
        if (!bar) return;
        var open = bar.hidden;              // about to open
        bar.hidden = !open;
        if (btn) { btn.classList.toggle('on', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        if (open) {
          var inp = $('cmSearchInput');
          if (inp) { inp.placeholder = TABS[tab].hint; inp.focus(); }
        } else {
          clearSearchValue();
        }
      };

      window.cmClearSearch = function () {
        clearSearchValue();
        var inp = $('cmSearchInput'); if (inp) inp.focus();
      };

      // Community search is a filter over what is already on the page. Every
      // community is rendered — there is no "view all" and nothing is held
      // back — so matching them needs no round trip.
      function matchGrid (grid, needle) {
        if (!grid) return 0;
        var cards = grid.querySelectorAll('.cmCard'), hits = 0;
        Array.prototype.forEach.call(cards, function (card) {
          var hit = !needle || (card.textContent || '').toLowerCase().indexOf(needle) !== -1;
          card.style.display = hit ? '' : 'none';
          if (hit) hits++;
        });
        return hits;
      }

      function filterCommunities (q) {
        var pane = $('cmPaneCommunity'); if (!pane) return;
        var needle = q.trim().toLowerCase(), searching = !!needle;
        var explore = matchGrid($('cmExploreGrid'), needle);
        var mineHits = matchGrid($('cmMineGrid'), needle);
        var mineTotal = $('cmMineGrid') ? $('cmMineGrid').querySelectorAll('.cmCard').length : 0;

        // a heading over nothing reads as a section that failed to load, so
        // each one goes with its cards
        var exploreHead = $('cmExploreHead');
        if (exploreHead) exploreHead.style.display = explore ? '' : 'none';
        var mine = $('cmMineWrap');
        if (mine) mine.style.display = (searching ? mineHits : mineTotal) ? '' : 'none';
        // create and join belong to the full list, not to a result set
        var cta = $('cmFooterCta');
        if (cta) cta.style.display = searching ? 'none' : '';
        var none = $('cmSearchEmpty');
        if (none) none.style.display = (searching && !explore && !mineHits) ? '' : 'none';
      }
      // cmRenderMine repaints the grid under us, so the filter has to be
      // re-applied against whatever is there now
      window.cmReapplySearch = function () {
        var inp = $('cmSearchInput');
        filterCommunities(inp ? inp.value : '');
        window.cmSyncCount();
      };

      function onSearchInput () {
        var inp = $('cmSearchInput'); if (!inp) return;
        var q = inp.value;
        clearTimeout(searchTimer);
        if (tab === 'community') { filterCommunities(q); return; }
        // people search is a query, so it waits for the typing to settle
        var box = $('dmResults'); if (!box) return;
        if (q.trim().length < 2) { box.innerHTML = ''; return; }
        searchTimer = setTimeout(function () {
          if (typeof window.dmPeopleSearch === 'function') window.dmPeopleSearch(q.trim(), box);
        }, 300);
      }

      // ---- pending friend requests badge ------------------------------------
      window.cmSetFriendBadge = function (n) {
        var el = $('cmFrdBadge'); if (!el) return;
        n = Number(n) || 0;
        el.textContent = n > 9 ? '9+' : String(n);
        el.hidden = n < 1;
      };

      // ---- the page opening -------------------------------------------------
      // Called by openCommunityHome. Every visit lands on Community with the
      // search closed, rather than on wherever the last visit left off.
      window.cmHomeReset = function () {
        var bar = $('cmSearchBar'), btn = $('cmSearchBtn');
        if (bar) bar.hidden = true;
        if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); }
        window.cmSetTab('community');
      };

      // ---- banner counters --------------------------------------------------
      // The member's own count, not a headline number: the six the site runs
      // plus whatever they have joined or created. Counted off the page rather
      // than fetched, which it can be because every community is rendered —
      // seven cards under the banner is seven on it.
      window.cmSyncCount = function () {
        var pane = $('cmPaneCommunity'), total = $('cmStatNum');
        if (total && pane) total.textContent = pane.querySelectorAll('.cmCard').length;
        paintCaps();
      };
      // dm.js owns the friendship map, so it pushes rather than us pulling
      window.cmSetFriendCount = function (n) {
        var el = $('cmStatFriends');
        if (el) el.textContent = Number(n) || 0;
      };
      // the two limits, written once from the constants the code enforces so
      // the page cannot claim a number the triggers disagree with
      function paintCaps () {
        var c = window.CM_MAX_JOINED, f = window.FR_MAX_FRIENDS;
        var max = $('cmCapMax');   if (max && c) max.textContent = c;
        var note = $('cmBannerNoteTxt');
        if (note && c && f) note.textContent = 'Join up to ' + c + ' communities and ' + f + ' friends.';
      }

      // ---- the chat gate, this side of it -----------------------------------
      // The database is what enforces the limits; this exists so a member is
      // told to wait before the round trip rather than watching a send quietly
      // do nothing. The bands are the same five, mirrored — when the two
      // disagree the server wins, and syncing from its answer is how they stop
      // disagreeing.
      var CHAT_BANDS = [
        { ms: 10000,    max: 5,    label: '5 messages in ten seconds' },
        { ms: 60000,    max: 30,   label: '30 messages in a minute' },
        { ms: 600000,   max: 150,  label: '150 messages in ten minutes' },
        { ms: 3600000,  max: 500,  label: '500 messages in an hour' },
        { ms: 86400000, max: 3000, label: '3000 messages in a day' }
      ];
      var CHAT_MAX_CHARS = 1000;
      var CHAT_MIN_GAP_MS = 1000;
      var CHAT_DUPE_MS = 30000;

      var sent = [];          // timestamps, newest last
      var lastText = '';      // normalised, for the identical check
      var lastTextAt = 0;
      var coolUntil = 0;
      var coolReason = '';
      var coolTimer = null;
      var coolTargets = [];   // [{btn, input, label}]

      function norm (s) { return String(s || '').trim().toLowerCase(); }
      function secsLeft () { return Math.max(0, Math.ceil((coolUntil - Date.now()) / 1000)); }

      function paintCooldown () {
        var left = secsLeft();
        coolTargets.forEach(function (t) {
          var btn = $(t.btn); if (!btn) return;
          btn.disabled = left > 0;
          btn.title = left > 0 ? (coolReason + ' — ' + left + 's') : (t.label || 'Send');
        });
        if (left > 0) return;
        clearInterval(coolTimer); coolTimer = null; coolReason = '';
      }

      function startCooldown (seconds, reason) {
        coolUntil = Date.now() + (Number(seconds) || 0) * 1000;
        coolReason = reason || 'Slow down';
        clearInterval(coolTimer);
        coolTimer = setInterval(paintCooldown, 500);
        paintCooldown();
      }

      window.dzChat = {
        MAX_CHARS: CHAT_MAX_CHARS,

        // register a composer so its send button carries the countdown
        watch: function (btnId, label) {
          if (!coolTargets.some(function (t) { return t.btn === btnId; })) {
            coolTargets.push({ btn: btnId, label: label });
          }
        },

        // may this text go? Returns null when it may, a message when it may not.
        check: function (text) {
          var now = Date.now();
          var left = secsLeft();
          if (left > 0) return coolReason + ' — try again in ' + left + 's';

          var t = String(text || '');
          if (t.length > CHAT_MAX_CHARS) {
            return 'That is over ' + CHAT_MAX_CHARS + ' characters — shorten it';
          }
          if (norm(t) && norm(t) === lastText && now - lastTextAt < CHAT_DUPE_MS) {
            return 'You just sent that — wait ' +
                   Math.ceil((CHAT_DUPE_MS - (now - lastTextAt)) / 1000) + 's';
          }
          if (sent.length && now - sent[sent.length - 1] < CHAT_MIN_GAP_MS) {
            return 'One message a second';
          }
          for (var i = CHAT_BANDS.length - 1; i >= 0; i--) {
            var b = CHAT_BANDS[i];
            var n = 0;
            for (var j = sent.length - 1; j >= 0 && now - sent[j] < b.ms; j--) n++;
            if (n >= b.max) return 'That is ' + b.label + ' — take a moment';
          }
          return null;
        },

        // a message actually landed
        note: function (text) {
          var now = Date.now();
          sent.push(now);
          // nothing older than the widest band can matter again
          var cut = now - CHAT_BANDS[CHAT_BANDS.length - 1].ms;
          while (sent.length && sent[0] < cut) sent.shift();
          lastText = norm(text); lastTextAt = now;
        },

        // The server dropped the row. It knows why and for how long, and this
        // is the only place that answer comes from.
        async fromServer (sb) {
          try {
            var r = await sb.rpc('dz_chat_status');
            var row = r && r.data && r.data[0];
            if (!row) return 'That didn’t send — try again';
            var s = Number(row.cooldown_seconds) || 0;
            var why = row.reason || 'Slow down';
            if (s > 0) startCooldown(s, why);
            return why + (s > 0 ? ' — try again in ' + s + 's' : '');
          } catch (e) {
            return 'That didn’t send — try again';
          }
        }
      };

      document.addEventListener('DOMContentLoaded', function () {
        window.dzChat.watch('cpBarSend', 'Send');
        window.dzChat.watch('dmSendBtn', 'Send');
        var inp = $('cmSearchInput');
        if (inp) {
          inp.addEventListener('input', onSearchInput);
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); window.cmToggleSearch(); }
          });
        }
        window.cmSyncCount();
      });
    })();
