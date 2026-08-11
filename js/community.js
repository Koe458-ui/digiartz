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

      document.addEventListener('DOMContentLoaded', function () {
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
