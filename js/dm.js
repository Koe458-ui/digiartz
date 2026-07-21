/* ── dm.js · direct messages ── */
/* ── Direct messages module ─────────────────────────────── */
(function () {
  'use strict';
  var LINK_RE = /(https?:\/\/|www\.|\S+\.(com|net|org|io|gg|xyz)\b)/i; /* mirror of the DB CHECK */
  var POLL_MS = 5000, MAX_LEN = 1000;
  var dmPartner = null;     /* {id, username} while a thread is open */
  var dmPoll = null, dmSending = false, searchTimer = null;
  /* Message paging: newest 25 first, +25 each time the user scrolls to
     the top. dmHasMore flags that older messages remain; dmLoadingOlder
     pins the scroll position while a load-older fetch is in flight.
     dmLastSig is a fingerprint of the last painted set so the 5s poll can
     skip re-rendering when nothing changed (no flicker). */
  var dmLimit = 25, DM_LOAD_STEP = 25, dmHasMore = false, dmLoadingOlder = false, dmLastSig = '';

  function $ (id) { return document.getElementById(id); }
  function me () { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function db () { return (typeof sb !== 'undefined' && sb) ? sb : null; }
  function escq (s) { /* reuse-safe HTML escape (mirrors site esc()) */
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function toast (m) { if (typeof showToast === 'function') showToast(m); }
  function when (iso) {
    var d = new Date(iso), diff = (Date.now() - d.getTime()) / 6e4;
    if (diff < 1)    return 'now';
    if (diff < 60)   return Math.floor(diff) + 'm';
    if (diff < 1440) return Math.floor(diff / 60) + 'h';
    if (diff < 10080)return Math.floor(diff / 1440) + 'd';
    return d.toLocaleDateString();
  }
  /* WhatsApp-style in-bubble clock time (e.g. "14:32" / "2:32 PM") */
  function hhmm (iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  /* WhatsApp-style date separator label: Today / Yesterday / 12 Jul 2026 */
  function dayChip (d) {
    var now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'TODAY';
    if (d.toDateString() === y.toDateString())   return 'YESTERDAY';
    try { return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase(); }
    catch (e) { return d.toDateString().toUpperCase(); }
  }

  /* ══ Friendships ══════════════════════════════════════════
     One row per pair in public.friendships (RLS + a transition
     trigger enforce everything server-side; the DM INSERT policy
     requires status='accepted'). frMap: other-user-id → row. */
  var frMap = {};
  async function loadFriendships () {
    frMap = {};
    if (!db() || !me()) return;
    try {
      var r = await db().from('friendships')
        .select('id,requester_id,addressee_id,status,blocked_by')
        .or('requester_id.eq.' + me().id + ',addressee_id.eq.' + me().id);
      if (r.error) throw r.error;
      (r.data || []).forEach(function (f) {
        frMap[f.requester_id === me().id ? f.addressee_id : f.requester_id] = f;
      });
      if (typeof dzcSet === 'function') dzcSet('frMap', frMap); /* offline snapshot */
    } catch (e) {
      /* offline → restore the saved map so friend states still work */
      if (!Object.keys(frMap).length && typeof dzcGet === 'function') {
        frMap = dzcGet('frMap') || {};
      }
    }
  }
  function frState (pid) {
    var f = frMap[pid];
    if (!f) return 'none';
    if (f.status === 'accepted') return 'friends';
    if (f.status === 'blocked') return f.blocked_by === (me() && me().id) ? 'blocked_by_me' : 'blocked_me';
    return f.requester_id === (me() && me().id) ? 'sent' : 'incoming';
  }
  async function refreshAfterFrChange () {
    await loadFriendships();
    if ($('frdPage') && $('frdPage').classList.contains('open')) loadFriendsPage();
    if (dmPartner) dmApplyGate();
    /* live-update any open search boxes */
    ['dmSearchInput', 'frdSearchInput'].forEach(function (id) {
      var i = $(id);
      if (i && i.value.trim().length >= 2) i.dispatchEvent(new Event('input'));
    });
  }
  async function frSendReq (pid) {
    if (!db() || !me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    try {
      var r = await db().from('friendships').insert({ requester_id: me().id, addressee_id: pid });
      if (r.error) throw r.error;
      toast('Friend request sent ✦');
    } catch (e) {
      toast(e && e.message && /duplicate|uniq/i.test(e.message) ? 'A request already exists' : 'Couldn\u2019t send the request');
    }
    await refreshAfterFrChange();
  }
  async function frAccept (pid) {
    var f = frMap[pid]; if (!f || !db()) return;
    try {
      var r = await db().from('friendships').update({ status: 'accepted' }).eq('id', f.id);
      if (r.error) throw r.error;
      toast('You are now friends ✦');
    } catch (e) { toast('Couldn\u2019t accept — try again'); }
    await refreshAfterFrChange();
  }
  /* delete row = cancel request / decline / unblock (back to strangers) */
  async function frRemove (pid, okMsg) {
    var f = frMap[pid]; if (!f || !db()) return;
    try {
      var r = await db().from('friendships').delete().eq('id', f.id);
      if (r.error) throw r.error;
      if (okMsg) toast(okMsg);
    } catch (e) { toast('Action failed — try again'); }
    await refreshAfterFrChange();
  }
  async function frBlock (pid) {
    if (!db() || !me()) return;
    try {
      var f = frMap[pid];
      if (f) {
        var r = await db().from('friendships').update({ status: 'blocked' }).eq('id', f.id);
        if (r.error) throw r.error;
      } else {
        /* blocking a stranger: create the pair row, then flip it */
        var i = await db().from('friendships').insert({ requester_id: me().id, addressee_id: pid }).select().single();
        if (i.error) throw i.error;
        var u = await db().from('friendships').update({ status: 'blocked' }).eq('id', i.data.id);
        if (u.error) throw u.error;
      }
      toast('Blocked');
    } catch (e) { toast('Couldn\u2019t block — try again'); }
    await refreshAfterFrChange();
  }
  /* small action pill that never triggers the row's click */
  function frBtnEl (label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'frBtn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    return b;
  }

  /* ── Username search ── */
  function initSearch () {
    var inp = $('dmSearchInput'), box = $('dmResults');
    if (!inp || !box) return;
    inp.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = inp.value.trim();
      if (q.length < 2) { box.innerHTML = ''; return; }
      searchTimer = setTimeout(function () { runSearch(q, box); }, 300);
    });
  }
  async function runSearch (q, box, onOpen) {
    if (!db()) { toast('Backend not configured'); return; }
    var safe = q.replace(/[%_]/g, '\\$&');
    try {
      var r = await db().from('profiles')
        .select('id,username,avatar_url')
        .ilike('username', '%' + safe + '%')
        .limit(8);
      if (r.error) throw r.error;
      await loadFriendships(); /* fresh states for the action buttons */
      var rows = (r.data || []).filter(function (p) {
        if (me() && p.id === me().id) return false;
        return frState(p.id) !== 'blocked_me'; /* users who blocked me stay invisible */
      });
      box.innerHTML = '';
      if (!rows.length) {
        box.innerHTML = '<div class="dmSearchNote">NO USERS FOUND</div>';
        return;
      }
      rows.forEach(function (p) { box.appendChild(userRow(p, true, null, null, onOpen)); });
    } catch (e) { box.innerHTML = '<div class="dmSearchNote">SEARCH FAILED — TRY AGAIN</div>'; }
  }

  /* One row — used for both search results and conversations.
     Built with createElement so usernames can't break out of
     attributes regardless of characters. */
  function userRow (p, isSearch, preview, ts, onOpen) {
    var item = document.createElement('div');
    item.className = 'cmFriendItem';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    var av = document.createElement('div');
    av.className = 'cmFriendAvatar';
    if (p.avatar_url) {
      var img = document.createElement('img');
      img.src = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(p.avatar_url) : p.avatar_url; img.alt = ''; img.draggable = false;
      img.onerror = function () { this.remove(); av.textContent = (p.username || '?')[0].toUpperCase(); };
      av.appendChild(img);
    } else {
      av.textContent = (p.username || '?')[0].toUpperCase();
    }
    var meta = document.createElement('div');
    meta.className = 'cmFriendMeta';
    var name = document.createElement('div');
    name.className = 'cmFriendName';
    name.textContent = p.username || 'Artist';
    var status = document.createElement('div');
    status.className = 'cmFriendStatus' + (preview ? ' dmPreview' : '');
    var st = isSearch ? frState(p.id) : null;
    status.textContent = isSearch
      ? ({ none: 'Send a friend request', sent: 'Request sent — waiting', incoming: 'Sent you a friend request', friends: 'Tap to message', blocked_by_me: 'Blocked' }[st] || '')
      : (preview || '');
    meta.appendChild(name); meta.appendChild(status);
    item.appendChild(av); item.appendChild(meta);
    if (isSearch) {
      /* Friend-gated actions: only accepted friends get MESSAGE ✦ */
      var acts = document.createElement('span');
      acts.className = 'frRowBtns';
      if (st === 'none')            acts.appendChild(frBtnEl('ADD FRIEND', '', function () { frSendReq(p.id); }));
      else if (st === 'sent')       acts.appendChild(frBtnEl('CANCEL', 'frBtn--ghost', function () { frRemove(p.id, 'Request cancelled'); }));
      else if (st === 'incoming')   acts.appendChild(frBtnEl('ACCEPT', '', function () { frAccept(p.id); }));
      else if (st === 'blocked_by_me') acts.appendChild(frBtnEl('UNBLOCK', 'frBtn--ghost', function () { frRemove(p.id, 'Unblocked'); }));
      else if (st === 'friends') {
        var go = document.createElement('span');
        go.className = 'dmGo'; go.textContent = 'MESSAGE ✦';
        acts.appendChild(go);
      }
      item.appendChild(acts);
    } else if (ts) {
      var w = document.createElement('span');
      w.className = 'dmWhen'; w.textContent = when(ts);
      item.appendChild(w);
    }
    var open = function () { (onOpen || openThread)(p); };
    item.addEventListener('click', open);
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return item;
  }

  /* ── Conversations (distinct partners from recent messages) ──
     Partner derivation is shared: convo list, Friends page, and the
     profile drawer's friends count all use fetchPartners(). */
  async function fetchPartners () {
    if (!db() || !me()) return [];
    var uid = me().id;
    var r = await db().from('direct_messages')
      .select('sender_id,recipient_id,content,created_at')
      .or('sender_id.eq.' + uid + ',recipient_id.eq.' + uid)
      .order('created_at', { ascending: false })
      .limit(120);
    if (r.error) throw r.error;
    var seen = {}, partners = [];
    (r.data || []).forEach(function (m) {
      var pid = m.sender_id === uid ? m.recipient_id : m.sender_id;
      if (seen[pid]) return;
      seen[pid] = true;
      partners.push({ id: pid, preview: (m.sender_id === uid ? 'You: ' : '') + m.content, ts: m.created_at });
    });
    return partners;
  }
  /* Profile drawer count — counts ACCEPTED FRIENDS now, not DM partners */
  window.__dmFetchPartners = async function () {
    await loadFriendships();
    return Object.keys(frMap)
      .filter(function (k) { return frMap[k].status === 'accepted'; })
      .map(function (k) { return { id: k }; });
  };

  async function refreshConvos () {
    var list = $('dmConvoList'), empty = $('dmEmpty'), head = $('dmConvoHead');
    if (!list || !db() || !me()) return;
    try {
      var partners = await fetchPartners();
      list.innerHTML = '';
      if (head) head.style.display = partners.length ? '' : 'none';
      if (empty) empty.style.display = partners.length ? 'none' : '';
      if (!partners.length) return;
      var pr = await db().from('profiles')
        .select('id,username,avatar_url')
        .in('id', partners.map(function (p) { return p.id; }));
      var byId = {};
      (pr.data || []).forEach(function (p) { byId[p.id] = p; });
      partners.forEach(function (pt) {
        var prof = byId[pt.id] || { id: pt.id, username: 'Artist' };
        list.appendChild(userRow(prof, false, pt.preview, pt.ts));
      });
      /* offline snapshot of the conversation list */
      if (typeof dzcSet === 'function') dzcSet('convos', { partners: partners, profiles: byId });
    } catch (e) {
      /* offline → rebuild the list from the saved snapshot */
      var snap = (typeof dzcGet === 'function') && dzcGet('convos');
      if (snap && snap.partners && snap.partners.length && list) {
        list.innerHTML = '';
        if (head) head.style.display = '';
        if (empty) empty.style.display = 'none';
        snap.partners.forEach(function (pt) {
          var prof = (snap.profiles && snap.profiles[pt.id]) || { id: pt.id, username: 'Artist' };
          list.appendChild(userRow(prof, false, pt.preview, pt.ts));
        });
      }
      /* otherwise leave list as-is; never crash */
    }
  }

  /* ── Thread ── */
  function openThread (p) {
    if (!db()) { toast('Backend not configured'); return; }
    if (!me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    dmPartner = p;
    var grid = $('cmGridScroll'), chat = $('dmChatView');
    if (grid) grid.style.display = 'none';
    if (chat) chat.style.display = 'flex';
    /* Header becomes the DM banner: avatar + username, tappable → profile */
    if (typeof cmHdrChatMode === 'function') {
      cmHdrChatMode({
        name  : p.username || 'Artist',
        sub   : 'Tap to view profile',
        avatar: p.avatar_url || null,
        letter: (p.username || '?').charAt(0).toUpperCase(),
        tap   : function () {
          if (!p.username) return;
          if (typeof closeCommunityPage === 'function') closeCommunityPage();
          if (typeof openProfileByUsername === 'function') openProfileByUsername(p.username, true);
        }
      });
    }
    var nav = $('bnNav');       if (nav) nav.style.display = 'none';
    var res = $('dmResults');   if (res) res.innerHTML = '';
    var inp = $('dmSearchInput'); if (inp) inp.value = '';
    $('dmBody').innerHTML = '<div class="dmSearchNote">LOADING…</div>';
    /* Friend gate: composer stays hidden until the friendship state
       is known; dmApplyGate() then shows either the input bar
       (friends) or the Add-Friend / request / blocked bar. */
    var gEl = $('dmGate'), bEl = document.querySelector('#dmChatView .dmBar');
    if (bEl) bEl.style.display = 'none';
    if (gEl) { gEl.style.display = 'flex'; gEl.innerHTML = '<div class="dmGateTxt">…</div>'; }
    loadFriendships().then(dmApplyGate);
    dmLimit = 25; dmHasMore = false; dmLoadingOlder = false; dmLastSig = '';
    loadThread(true);
    clearInterval(dmPoll);
    dmPoll = setInterval(function () {
      if (document.visibilityState === 'visible') loadThread(false);
    }, POLL_MS);
    /* FIX(A3): focus AFTER the 300ms entrance animation completes — the old
       250ms delay opened the keyboard (and its kbLift transform) while the
       view was still sliding in, causing a visible stutter on slower phones. */
    setTimeout(function () { var i = $('dmInput'); if (i) i.focus({ preventScroll: true }); }, 340);
  }
  function closeThread () {
    dmPartner = null;
    clearInterval(dmPoll); dmPoll = null;
    var chat = $('dmChatView'); if (chat) chat.style.display = 'none';
    var grid = $('cmGridScroll'); if (grid) grid.style.display = 'block';
    if (typeof cmHdrHomeMode === 'function') cmHdrHomeMode();
    var nav = $('bnNav');       if (nav) nav.style.display = '';
    refreshConvos();
  }
  async function loadThread (scrollToEnd) {
    if (!dmPartner || !db() || !me()) return;
    var uid = me().id, pid = dmPartner.id;
    try {
      /* Fetch the newest dmLimit messages (plus one probe row to learn
         whether older history still exists), then flip to chronological
         order for display. */
      var r = await db().from('direct_messages')
        .select('id,sender_id,content,created_at')
        .or('and(sender_id.eq.' + uid + ',recipient_id.eq.' + pid + '),and(sender_id.eq.' + pid + ',recipient_id.eq.' + uid + ')')
        .order('created_at', { ascending: false })
        .limit(dmLimit + 1);
      if (r.error) throw r.error;
      if (!dmPartner || dmPartner.id !== pid) return; /* stale response */
      var rows = r.data || [];
      dmHasMore = rows.length > dmLimit;
      if (dmHasMore) rows = rows.slice(0, dmLimit);
      rows.reverse(); /* oldest → newest for top-to-bottom display */

      /* Fingerprint the set about to be shown. On a background poll with
         no change, bail before touching the DOM so the thread never
         flickers. Opening the thread (scrollToEnd) or loading older
         messages (dmLoadingOlder) always renders. */
      var sig = dmLimit + '|' + dmHasMore + '|' + rows.map(function (m) { return m.id; }).join(',');
      if (!scrollToEnd && !dmLoadingOlder && sig === dmLastSig) return;
      dmLastSig = sig;

      var body = $('dmBody');
      var atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      var prevHeight = body.scrollHeight, prevTop = body.scrollTop;

      /* WhatsApp-style render: date separator chips between days,
         consecutive messages from the same sender within 5 minutes
         grouped (tighter spacing, squared shared corner), and a
         clock time floated into each bubble's last line. */
      var msgHtml = '';
      var lastDayKey = '', lastSender = null, lastTs = 0;
      rows.forEach(function (m) {
        var mine = m.sender_id === uid;
        var d = m.created_at ? new Date(m.created_at) : null;
        var dayKey = d ? d.toDateString() : '';
        if (dayKey && dayKey !== lastDayKey) {
          msgHtml += '<div class="chatDay"><span>' + dayChip(d) + '</span></div>';
          lastDayKey = dayKey;
          lastSender = null; /* new day always restarts the group */
        }
        var ts = d ? d.getTime() : 0;
        var cont = lastSender === m.sender_id && ts && (ts - lastTs) < 300000;
        lastSender = m.sender_id; lastTs = ts;
        msgHtml += '<div class="dmMsg ' + (mine ? 'dmMsg--me' : 'dmMsg--them') + (cont ? ' dmMsg--cont' : '') + '">' +
                 escq(m.content) +
                 '<span class="dmMsgTime">' + hhmm(m.created_at) + '</span>' +
               '</div>';
      });

      /* Load-older spinner pinned to the TOP, shown only while more
         history remains (reuses the community feed's .cpRefreshWrap). */
      var loaderHtml = dmHasMore
        ? '<div class="cpRefreshWrap visible" id="dmRefreshWrap" aria-hidden="true"><div class="cpRefreshSpinner"></div></div>'
        : '';

      body.innerHTML = loaderHtml + (msgHtml ||
        '<div class="dmSearchNote">SAY HI — THIS IS THE START OF YOUR CHAT ✦</div>');

      if (dmLoadingOlder) {
        /* Older messages just prepended — keep the reading position. */
        body.scrollTop = prevTop + (body.scrollHeight - prevHeight);
        dmLoadingOlder = false;
      } else if (scrollToEnd || atEnd) {
        body.scrollTop = body.scrollHeight;
      } else {
        /* Background poll while reading history — don't yank the view. */
        body.scrollTop = prevTop;
      }
    } catch (e) { dmLoadingOlder = false; /* keep last good render */ }
  }

  /* Reveal the next 25 older messages when the user scrolls to the top. */
  function dmMaybeLoadOlder () {
    if (dmLoadingOlder || !dmHasMore || !dmPartner) return;
    dmLoadingOlder = true;
    dmLimit += DM_LOAD_STEP;
    loadThread(false);
  }

  /* Show the composer for friends, the gate bar for everyone else. */
  function dmApplyGate () {
    var bar = document.querySelector('#dmChatView .dmBar'), gate = $('dmGate');
    if (!bar || !gate || !dmPartner) return;
    var st = frState(dmPartner.id);
    if (st === 'friends') {
      gate.style.display = 'none';
      bar.style.display = 'flex';
      var i = $('dmInput'); if (i) setTimeout(function () { i.focus({ preventScroll: true }); }, 60);
      return;
    }
    bar.style.display = 'none';
    gate.style.display = 'flex';
    gate.innerHTML = '';
    var txt = document.createElement('div'); txt.className = 'dmGateTxt';
    var row = document.createElement('div'); row.className = 'dmGateRow';
    var nm = (dmPartner.username || 'this artist').toUpperCase();
    if (st === 'none') {
      txt.textContent = 'YOU CAN ONLY MESSAGE FRIENDS';
      row.appendChild(frBtnEl('ADD FRIEND', '', function () { frSendReq(dmPartner.id); }));
    } else if (st === 'sent') {
      txt.textContent = 'FRIEND REQUEST SENT — WAITING FOR ' + nm;
      row.appendChild(frBtnEl('CANCEL REQUEST', 'frBtn--ghost', function () { frRemove(dmPartner.id, 'Request cancelled'); }));
    } else if (st === 'incoming') {
      txt.textContent = nm + ' WANTS TO BE FRIENDS';
      row.appendChild(frBtnEl('ACCEPT', '', function () { frAccept(dmPartner.id); }));
      row.appendChild(frBtnEl('DECLINE', 'frBtn--ghost', function () { frRemove(dmPartner.id); }));
    } else if (st === 'blocked_by_me') {
      txt.textContent = 'YOU BLOCKED ' + nm;
      row.appendChild(frBtnEl('UNBLOCK', 'frBtn--ghost', function () { frRemove(dmPartner.id, 'Unblocked'); }));
    } else {
      txt.textContent = 'YOU CAN’T MESSAGE THIS ARTIST';
    }
    gate.appendChild(txt);
    if (row.children.length) gate.appendChild(row);
  }

  /* ── Send (validation mirrors the DB constraints) ── */
  async function send () {
    var inp = $('dmInput'), btn = $('dmSendBtn');
    if (!inp || dmSending || !dmPartner) return;
    if (!me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    var text = inp.value.trim();
    if (!text) return;
    if (text.length > MAX_LEN) { toast('Message is too long (max 1000 characters)'); return; }
    if (LINK_RE.test(text)) { toast('Links aren\'t allowed in messages ✦'); return; }
    /* Friends-only — mirrors the dm_insert_friends_only RLS policy */
    if (frState(dmPartner.id) !== 'friends') { dmApplyGate(); toast('You can only message friends ✦'); return; }
    dmSending = true; if (btn) btn.disabled = true;
    try {
      var r = await db().from('direct_messages')
        .insert({ sender_id: me().id, recipient_id: dmPartner.id, content: text });
      if (r.error) throw r.error;
      inp.value = '';
      await loadThread(true);
    } catch (e) {
      var m = (e && e.message) || '';
      toast(/dm_no_links/.test(m) ? 'Links aren\'t allowed in messages ✦'
          : /row-level security|policy/i.test(m) ? 'You can only message friends ✦'
          : 'Message failed to send — try again');
      if (/row-level security|policy/i.test(m)) { loadFriendships().then(dmApplyGate); }
    } finally {
      dmSending = false; if (btn) btn.disabled = false;
    }
  }

  /* ── Friends page (#frdPage) — DM partners + user search ── */
  var frdLastFocus = null, frdSearchTimer = null;
  function frdStartChat (p) {
    closeFriendsPage();
    var page = document.getElementById('communityPage');
    var wasOpen = !!(page && page.classList.contains('open'));
    if (typeof window.openCommunityHome === 'function') window.openCommunityHome();
    /* Community page already on screen (e.g. from the Friends row inside it):
       no page transition will run, open the thread straight away. */
    if (wasOpen || !page) { openThread(p); return; }
    /* Coming from elsewhere (profile MESSAGE button, etc.): the page slide-in
       (.45s) and the thread's own slide-in used to run at the SAME time, so
       the thread finished animating while still in transit and looked like an
       instant pop. Wait for the page transition to land, THEN slide the
       thread in — same page → grid → chat sequence the community uses. */
    var fired = false;
    function go(){ if (fired) return; fired = true; openThread(p); }
    page.addEventListener('transitionend', function h(e){
      if (e.target !== page || e.propertyName !== 'transform') return;
      page.removeEventListener('transitionend', h);
      go();
    });
    setTimeout(go, 520);  /* fallback — never strand the tap if transitionend is missed */
  }
  async function loadFriendsPage () {
    /* Four sections driven by public.friendships:
       FRIEND REQUESTS (incoming, Accept/Decline) · REQUESTS SENT
       (outgoing pending, Cancel) · YOUR FRIENDS (chat + Block) ·
       BLOCKED (Unblock). */
    var list = $('frdList'), empty = $('frdEmptyState'),
        head = $('frdListHead'), cnt = $('frdCount'),
        reqHead = $('frdReqHead'), reqList = $('frdReqList'), reqCnt = $('frdReqCount'),
        sentHead = $('frdSentHead'), sentList = $('frdSentList'), sentCnt = $('frdSentCount'),
        blkHead = $('frdBlockHead'), blkList = $('frdBlockList'), blkCnt = $('frdBlockCount');
    if (!list) return;
    list.innerHTML = '<div class="dmSearchNote">LOADING…</div>';
    if (reqList) reqList.innerHTML = '';
    if (sentList) sentList.innerHTML = '';
    if (blkList) blkList.innerHTML = '';
    empty.style.display = 'none'; head.style.display = 'none';
    if (reqHead) reqHead.style.display = 'none';
    if (sentHead) sentHead.style.display = 'none';
    if (blkHead) blkHead.style.display = 'none';
    try {
      await loadFriendships();
      var uid = me().id, reqs = [], sent = [], friends = [], blocked = [];
      Object.keys(frMap).forEach(function (pid) {
        var f = frMap[pid];
        if (f.status === 'accepted') friends.push(pid);
        else if (f.status === 'pending' && f.addressee_id === uid) reqs.push(pid);
        else if (f.status === 'pending' && f.requester_id === uid) sent.push(pid);
        else if (f.status === 'blocked' && f.blocked_by === uid) blocked.push(pid);
      });
      list.innerHTML = '';
      if (cnt) cnt.textContent = friends.length;
      var allIds = reqs.concat(sent, friends, blocked);
      if (!allIds.length) { empty.style.display = ''; return; }
      var byId = {};
      try {
        var pr = await db().from('profiles')
          .select('id,username,avatar_url')
          .in('id', allIds);
        if (pr.error) throw pr.error;
        (pr.data || []).forEach(function (p) { byId[p.id] = p; });
        if (typeof dzcSet === 'function') dzcSet('frProfiles', byId); /* offline snapshot */
      } catch (ppe) {
        /* offline → cached usernames/avatars (frMap itself already
           restored by loadFriendships) */
        byId = (typeof dzcGet === 'function' && dzcGet('frProfiles')) || {};
      }
      function prof (pid) { return byId[pid] || { id: pid, username: 'Artist' }; }

      if (reqs.length && reqHead && reqList) {
        reqHead.style.display = '';
        if (reqCnt) reqCnt.textContent = reqs.length;
        reqs.forEach(function (pid) {
          var row = userRow(prof(pid), false, 'Wants to be friends', null, frdStartChat);
          var acts = document.createElement('span'); acts.className = 'frRowBtns';
          acts.appendChild(frBtnEl('ACCEPT', '', function () { frAccept(pid); }));
          acts.appendChild(frBtnEl('✕', 'frBtn--ghost', function () { frRemove(pid, 'Request declined'); }));
          row.appendChild(acts);
          reqList.appendChild(row);
        });
      }
      if (sent.length && sentHead && sentList) {
        sentHead.style.display = '';
        if (sentCnt) sentCnt.textContent = sent.length;
        sent.forEach(function (pid) {
          /* Outgoing pending — no chat until accepted. userRow falls back to
             openThread when the handler is null, so pass an explicit no-op;
             CANCEL deletes the friendship row (same frRemove as decline). */
          var row = userRow(prof(pid), false, 'Request pending…', null, function(){});
          var acts = document.createElement('span'); acts.className = 'frRowBtns';
          acts.appendChild(frBtnEl('CANCEL', 'frBtn--ghost', function () { frRemove(pid, 'Request cancelled'); }));
          row.appendChild(acts);
          sentList.appendChild(row);
        });
      }
      if (friends.length) {
        head.style.display = '';
        friends.forEach(function (pid) {
          var row = userRow(prof(pid), false, 'Friend ✦ tap to chat', null, frdStartChat);
          var acts = document.createElement('span'); acts.className = 'frRowBtns';
          acts.appendChild(frBtnEl('BLOCK', 'frBtn--danger', function () {
            var u = prof(pid).username || 'this artist';
            if (confirm('Block ' + u + '? They won\u2019t be able to message you, and you won\u2019t see their requests.')) frBlock(pid);
          }));
          row.appendChild(acts);
          list.appendChild(row);
        });
      }
      if (blocked.length && blkHead && blkList) {
        blkHead.style.display = '';
        if (blkCnt) blkCnt.textContent = blocked.length;
        blocked.forEach(function (pid) {
          var row = userRow(prof(pid), false, 'Blocked', null, frdStartChat);
          var acts = document.createElement('span'); acts.className = 'frRowBtns';
          acts.appendChild(frBtnEl('UNBLOCK', 'frBtn--ghost', function () { frRemove(pid, 'Unblocked'); }));
          row.appendChild(acts);
          blkList.appendChild(row);
        });
      }
    } catch (e) {
      list.innerHTML = '<div class="dmSearchNote">COULDN\u2019T LOAD FRIENDS — TRY AGAIN</div>';
    }
  }
  function openFriendsPage () {
    if (!me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    frdLastFocus = document.activeElement;
    $('frdPage').classList.add('open');
    var nav = $('bnNav'); if (nav) nav.style.display = 'none';
    document.body.style.overflow = 'hidden';
    var inp = $('frdSearchInput'); if (inp) inp.value = '';
    var res = $('frdResults'); if (res) res.innerHTML = '';
    loadFriendsPage();
  }
  function closeFriendsPage () {
    $('frdPage').classList.remove('open');
    var nav = $('bnNav'); if (nav) nav.style.display = '';
    /* FIX: Friends opens on top of the Community page — a blind
       overflow reset here unlocked background scroll behind the
       still-open panel. restoreScroll() only unlocks when nothing
       else is open (same pattern as Zeo's closeChat). */
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
    if (frdLastFocus && frdLastFocus.focus) frdLastFocus.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('frdPage') && $('frdPage').classList.contains('open')) closeFriendsPage();
  });
  window.openFriendsPage  = openFriendsPage;
  /* Minimal bridge for the profile-page [ADD FRD]/[MESSAGE] button — the
     profile script lives in another scope. Wraps the same primitives the
     Friends page uses, so behavior stays identical everywhere. */
  window.pfFriendBridge = {
    load:   loadFriendships,
    state:  frState,
    send:   frSendReq,
    accept: frAccept,
    cancel: function (pid) { return frRemove(pid, 'Request cancelled'); },
    block:  frBlock,
    chat:   frdStartChat
  };
  window.closeFriendsPage = closeFriendsPage;

  /* ── Wiring — decorate, never modify, existing functions ── */
  document.addEventListener('DOMContentLoaded', function () {
    initSearch();
    /* Friends-page search: same debounce/query as the community
       search, results open a chat via frdStartChat. */
    var fInp = $('frdSearchInput'), fBox = $('frdResults');
    if (fInp && fBox) fInp.addEventListener('input', function () {
      clearTimeout(frdSearchTimer);
      var q = fInp.value.trim();
      if (q.length < 2) { fBox.innerHTML = ''; return; }
      frdSearchTimer = setTimeout(function () { runSearch(q, fBox, frdStartChat); }, 300);
    });
    var btn = $('dmSendBtn'); if (btn) btn.addEventListener('click', send);
    var inp = $('dmInput');
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    /* Scroll to the top of a thread → reveal 25 older messages. */
    var dmScrollT = null, dmBodyEl = $('dmBody');
    if (dmBodyEl) dmBodyEl.addEventListener('scroll', function () {
      if (dmBodyEl.scrollTop <= 40 && !dmLoadingOlder && dmHasMore) {
        clearTimeout(dmScrollT);
        dmScrollT = setTimeout(dmMaybeLoadOlder, 250);
      }
    }, { passive: true });
    /* Back button: intercept while a DM thread is open, else fall
       through to the original channel-chat close. */
    var orig = window.cmCloseChat;
    window.cmCloseChat = function () {
      if (dmPartner) { closeThread(); return; }
      if (typeof orig === 'function') orig.apply(this, arguments);
    };
    /* Refresh conversations when the Community page opens. */
    var origOpen = window.openCommunityHome;
    if (typeof origOpen === 'function') {
      window.openCommunityHome = function () {
        var out = origOpen.apply(this, arguments);
        refreshConvos();
        return out;
      };
    }
    /* First load once auth resolves (site registers its own listener;
       Supabase supports multiple). */
    if (db() && db().auth && db().auth.onAuthStateChange) {
      db().auth.onAuthStateChange(function () { setTimeout(function () { loadFriendships(); refreshConvos(); }, 400); });
    }
  });
})();
