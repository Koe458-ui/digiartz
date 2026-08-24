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

      /* ---- search ------------------------------------------------------------
         A page, not a bar. Every other section on the site opens search the
         same way — back arrow, one field, results underneath — and this is
         that component (#fgSearchPage, #pfSearchPage) pointed at a different
         haystack.

         It searches communities and only communities. It used to carry two
         scope chips, because Community and Friends were two panes of one page
         and the search had to serve both; they are two pages now, and the
         friends page has a search of its own. */
      var searchTimer = null;
      var srchLastFocus = null;

      window.cmOpenSearch = function () {
        var pg = $('cmSearchPage'); if (!pg) return;
        srchLastFocus = document.activeElement;
        var inp = $('cmSearchInput');
        if (inp) { inp.value = ''; inp.placeholder = 'Search communities'; }
        runSearch();
        pg.classList.add('open');
        document.body.style.overflow = 'hidden';
        // the keyboard comes up with the page, not after a second tap
        if (inp) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
      };

      window.cmCloseSearch = function () {
        var pg = $('cmSearchPage');
        if (!pg || !pg.classList.contains('open')) return;
        pg.classList.remove('open');
        clearTimeout(searchTimer);
        // the community section is still up behind it and owns the lock
        var back = srchLastFocus; srchLastFocus = null;
        if (back && back.isConnected && back.focus) {
          try { back.focus({ preventScroll: true }); } catch (e) { try { back.focus(); } catch (e2) {} }
        }
      };
      // dm.js closes it when a chat opens out of a result
      window.cmSearchReset = window.cmCloseSearch;

      window.cmClearSearch = function () {
        var inp = $('cmSearchInput');
        if (inp) { inp.value = ''; try { inp.focus(); } catch (e) {} }
        runSearch();
      };

      function srchNote (msg) {
        var n = $('cmSrchNote');
        if (n) { n.textContent = msg || ''; n.hidden = !msg; }
      }

      // Communities are searched off the page rather than over the network:
      // every one of them is already rendered — there is no "view all" and
      // nothing held back — so the list under the banner is the whole set.
      // Each result clicks its own card, so a result opens exactly what the
      // card opens and neither can drift from the other.
      function searchCommunities (needle) {
        // the cards' container, which is the scroller itself now that the
        // Community pane wrapper has gone with the pair of chips above it
        var pane = $('cmGridScroll'), box = $('cmSrchRes');
        if (!pane || !box) return;
        box.innerHTML = '';
        var cards = pane.querySelectorAll('.cmCard'), hits = 0;
        Array.prototype.forEach.call(cards, function (card) {
          if ((card.textContent || '').toLowerCase().indexOf(needle) === -1) return;
          hits++;
          var row = card.cloneNode(true);
          row.removeAttribute('onclick');
          Array.prototype.forEach.call(row.querySelectorAll('[onclick]'), function (el) {
            el.removeAttribute('onclick');
          });
          // MANAGE belongs on the card, not in a result
          Array.prototype.forEach.call(row.querySelectorAll('button'), function (el) { el.remove(); });
          row.setAttribute('role', 'button');
          row.tabIndex = 0;
          function go () { window.cmCloseSearch(); card.click(); }
          row.addEventListener('click', go);
          row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
          });
          box.appendChild(row);
        });
        srchNote(hits ? '' : 'No communities match that.');
      }

      function runSearch () {
        var inp = $('cmSearchInput');
        var q = inp ? inp.value.trim() : '';
        var box = $('cmSrchRes');
        clearTimeout(searchTimer);
        if (box) box.innerHTML = '';

        if (!q) { srchNote('Type to search communities.'); return; }
        searchCommunities(q.toLowerCase());
      }

      /* The page covers the section but does not remove it, so without this
         Tab walks off the bottom of the results and into the cards still
         sitting underneath. #fgSearchPage earns its trap the same way. */
      function srchFocusable () {
        var pg = $('cmSearchPage'); if (!pg) return [];
        var sel = 'a[href],button:not([disabled]),input:not([disabled]),' +
                  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        return Array.prototype.filter.call(pg.querySelectorAll(sel), function (el) {
          return !el.hidden && el.offsetParent !== null;
        });
      }
      document.addEventListener('keydown', function (e) {
        var pg = $('cmSearchPage');
        if (!pg || !pg.classList.contains('open')) return;
        if (e.key === 'Escape') { e.stopImmediatePropagation(); window.cmCloseSearch(); return; }
        if (e.key !== 'Tab') return;
        var items = srchFocusable(); if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (!pg.contains(document.activeElement)) {
          e.preventDefault(); (e.shiftKey ? last : first).focus(); return;
        }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }, true);

      // ---- pending friend requests badge ------------------------------------
      window.cmSetFriendBadge = function (n) {
        var el = $('cmFrdBadge'); if (!el) return;
        n = Number(n) || 0;
        el.textContent = n > 9 ? '9+' : String(n);
        el.hidden = n < 1;
      };

      // ---- the page opening -------------------------------------------------
      // Called by openCommunityHome. Every visit lands at the top with the
      // search closed, rather than on wherever the last visit left off. It
      // used to set the Community chip as well, back when there was a pair of
      // them and a visit could arrive on the wrong one.
      window.cmHomeReset = function () {
        window.cmCloseSearch();
        var scroll = $('cmGridScroll');
        if (scroll) scroll.scrollTop = 0;
      };

      // ---- banner counters --------------------------------------------------
      // The member's own count, not a headline number: the six the site runs
      // plus whatever they have joined or created. Counted off the page rather
      // than fetched, which it can be because every community is rendered —
      // seven cards under the banner is seven on it.
      window.cmSyncCount = function () {
        var pane = $('cmGridScroll'), total = $('cmStatNum');
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
        if (inp) inp.addEventListener('input', runSearch);
        window.cmSyncCount();
      });
    })();
