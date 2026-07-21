/* ── engagement.js · likes / bookmarks / views ── */
/* ── Engagement module ──────────────────────────────────── */
(function () {
  'use strict';
  var VIEW_COOLDOWN = 6 * 3600 * 1000, SEEN_KEY = 'koeViewSeen', VKEY = 'koeViewerKey';
  var liked = new Set(), marked = new Set(), setsReady = false;
  var busy = {};            /* per-artwork in-flight lock for toggles   */
  var profileIdCache = {};  /* username → user id                       */
  var paintTimer = null;


  function $ (id) { return document.getElementById(id); }
  function db () { return (typeof sb !== 'undefined' && sb) ? sb : null; }
  function me () { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function toast (m) { if (typeof showToast === 'function') showToast(m); }

  /* ══ VIEWS ══════════════════════════════════════════════ */
  function viewerKey () {
    var k = null;
    try { k = localStorage.getItem(VKEY); } catch (e) {}
    if (!k) {
      k = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : ('k' + Date.now() + Math.random().toString(36).slice(2, 12));
      try { localStorage.setItem(VKEY, k); } catch (e) {}
    }
    return k;
  }
  function seenMap () {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function registerView (id) {
    if (!id || !db()) return;
    var now = Date.now(), map = seenMap();
    if (map[id] && now - map[id] < VIEW_COOLDOWN) return;   /* client cooldown */
    map[id] = now;
    for (var k in map) if (now - map[k] > 2 * VIEW_COOLDOWN * 4) delete map[k]; /* prune */
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (e) {}
    db().rpc('register_artwork_view', { p_artwork: id, p_anon_key: viewerKey() })
      .then(function () {}, function () {});               /* fire-and-forget */
  }
  /* ── Download tracking (feeds the trending score, ×6 weight) ──
     Lives here because this closure already owns db() + viewerKey().
     Server-side dedup: one count per viewer per artwork per day
     (artwork_download_dedup), same anti-abuse shape as views — so
     spam-clicking Download can't inflate an artwork's trending rank. */
  window.registerArtworkDownload = function (id) {
    if (!id || !db()) return;
    db().rpc('register_artwork_download', { p_artwork: id, p_anon_key: viewerKey() })
      .then(function () {}, function () {});               /* fire-and-forget */
  };
  /* The download quota gate (avDownload → dz_request_download) needs
     the same anonymous identity the trending dedup uses, so one
     visitor is one viewer in both systems. */
  window.dzViewerKey = viewerKey;
  function idFromPath (path) {
    var m = /^\/artwork\/([^/]+)$/.exec(path || '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  /* One funnel for every open path: gallery clicks, prev/next
     navigation and SPA routing all push /artwork/{id}. */
  var origPush = history.pushState.bind(history);
  history.pushState = function (state, title, url) {
    var out = origPush(state, title, url);
    try {
      var id = idFromPath(typeof url === 'string' ? url : (url && url.pathname));
      if (id) registerView(id);
    } catch (e) {}
    return out;
  };
  /* Deep links load with the URL already set — no pushState fires.
     FIX(B5): the old fixed 1200ms delay raced auth restore — on a slow
     connection the session wasn't back yet, so the view registered under
     the anon dedup key instead of the user (occasional double count).
     Now we wait for getSession() to settle (it resolves once the client
     has restored the stored session), with a hard 4s fallback so a hung
     auth call can never swallow the view entirely. */
  document.addEventListener('DOMContentLoaded', function () {
    var id = idFromPath(location.pathname);
    if (!id) return;
    var fired = false;
    function go () { if (fired) return; fired = true; registerView(id); }
    var c = db();
    if (c && c.auth && typeof c.auth.getSession === 'function') {
      try { c.auth.getSession().then(go, go); } catch (e) { setTimeout(go, 1200); }
      setTimeout(go, 4000); /* fallback: never lose the view */
    } else {
      setTimeout(go, 1200);
    }
  });

  /* ══ LIKE / BOOKMARK state ══════════════════════════════ */
  async function loadSets () {
    if (!db() || !me()) { liked.clear(); marked.clear(); setsReady = true; paintSoon(); return; }
    try {
      /* FIX(A4): filter by user_id explicitly. Correctness previously relied
         entirely on the likes_select_own RLS policy — if that policy is ever
         loosened (e.g. public like feeds), this would silently paint OTHER
         people's likes as yours. The explicit filter also keeps the 3000-row
         cap scoped to this user's rows only. */
      var uid = me().id;
      var l = await db().from('artwork_likes').select('artwork_id').eq('user_id', uid).limit(3000);
      var b = await db().from('artwork_bookmarks').select('artwork_id').eq('user_id', uid).limit(3000);
      liked  = new Set((l.data || []).map(function (r) { return String(r.artwork_id); }));
      marked = new Set((b.data || []).map(function (r) { return String(r.artwork_id); }));
    } catch (e) { /* stay with last known */ }
    setsReady = true;
    paintSoon();
  }

  function paintAll () {
    document.querySelectorAll('.engLike,.engBm').forEach(function (b) {
      var id = b.getAttribute('data-id') || idFromPath(location.pathname) || '';
      if (b.classList.contains('engLike')) b.setAttribute('aria-pressed', liked.has(String(id)) ? 'true' : 'false');
      else b.setAttribute('aria-pressed', marked.has(String(id)) ? 'true' : 'false');
    });
  }
  function paintSoon () { clearTimeout(paintTimer); paintTimer = setTimeout(paintAll, 200); }
  /* The artwork viewer repaints synchronously on prev/next so the old
     pressed state can never linger — see openLB's INSTANT RESET. */
  window.dzRepaintEng = paintAll;
  /* Cards render asynchronously after data loads — repaint states
     whenever new engagement buttons enter the DOM.
     FIX(B3): previously ANY DOM insertion anywhere (every 5s chat poll
     repaint, every toast) scheduled a whole-document querySelectorAll.
     Now we only schedule a repaint when an added subtree actually
     contains an engagement button — checking the small added node is
     far cheaper than rescanning the full document each time. */
  function hasEngBtn(node){
    if (node.nodeType !== 1) return false;
    if (node.matches && node.matches('.engLike,.engBm')) return true;
    return !!(node.querySelector && node.querySelector('.engLike,.engBm'));
  }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (hasEngBtn(added[j])) { paintSoon(); return; }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  async function toggle (kind, id, btn) {
    if (!db()) { toast('Backend not configured'); return; }
    if (!me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    var key = kind + ':' + id;
    if (busy[key]) return;
    busy[key] = true;
    var set   = kind === 'like' ? liked : marked;
    var table = kind === 'like' ? 'artwork_likes' : 'artwork_bookmarks';
    var on    = !set.has(id);
    /* optimistic */
    on ? set.add(id) : set.delete(id);
    paintAll();
    try {
      var r = on
        ? await db().from(table).insert({ artwork_id: id, user_id: me().id })
        : await db().from(table).delete().match({ artwork_id: id, user_id: me().id });
      if (r.error && !(on && r.error.code === '23505')) throw r.error; /* 23505 dup = already in desired state */
      if (kind === 'bm') toast(on ? 'Saved to bookmarks ✦' : 'Removed from bookmarks');
      if (kind === 'like') refreshProfileStatsIfOpen();
      if (!on) removeBmCard(id, kind);
    } catch (e) {
      on ? set.delete(id) : set.add(id);  /* revert */
      paintAll();
      /* Merit gate (<=40) arrives as a raw RLS error — explain it. */
      if (window.meritDenied && window.meritDenied(e, 'like')) { busy[key] = false; return; }
      toast('Action failed — try again');
    } finally { busy[key] = false; }
  }

  /* One delegated listener covers cards, lightbox and bookmarks page. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.engLike,.engBm,.bmRemove');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var id = b.getAttribute('data-id') || idFromPath(location.pathname);
    if (!id) return;
    if (b.classList.contains('bmRemove')) { toggle(b.getAttribute('data-kind') === 'like' ? 'like' : 'bm', String(id), b); return; }
    toggle(b.classList.contains('engLike') ? 'like' : 'bm', String(id), b);
  }, true);

  /* ══ BOOKMARKS PAGE ═════════════════════════════════════ */
  var bmLastFocus = null;
  /* The page serves two modes off one shell: 'bm' (bookmarks)
     and 'like' (liked artworks). */
  var bmMode = 'bm';
  async function loadBookmarksPage () {
    var grid = $('bmGrid'), empty = $('bmEmptyState');
    grid.innerHTML = '<div class="bmEmpty">LOADING…</div>';
    empty.style.display = 'none';
    if (!db() || !me()) { grid.innerHTML = ''; empty.style.display = ''; return; }
    try {
      var b = await db().from(bmMode === 'like' ? 'artwork_likes' : 'artwork_bookmarks')
        .select('artwork_id,created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (b.error) throw b.error;
      var ids = (b.data || []).map(function (r) { return r.artwork_id; });
      if (!ids.length) { grid.innerHTML = ''; empty.style.display = ''; return; }
      var a = await db().from('artworks')
        .select('id,name,image_url,category')
        .in('id', ids);
      if (a.error) throw a.error;
      var byId = {};
      (a.data || []).forEach(function (art) { byId[String(art.id)] = art; });
      grid.innerHTML = '';
      ids.forEach(function (rawId) {
        var art = byId[String(rawId)];
        if (!art) return;                       /* artwork was deleted */
        grid.appendChild(bmCard(art));
      });
      if (!grid.children.length) empty.style.display = '';
    } catch (e) {
      grid.innerHTML = '<div class="bmEmpty">COULDN\u2019T LOAD BOOKMARKS — TRY AGAIN</div>';
    }
  }
  function bmCard (art) {
    var id = String(art.id);
    var card = document.createElement('div');
    card.className = 'bmCard';
    var link = document.createElement('a');
    link.href = '/artwork/' + encodeURIComponent(id);
    link.style.cssText = 'display:block;color:inherit;text-decoration:none;';
    link.addEventListener('click', function (ev) {
      /* Prefer the in-page modal when the artwork is in the loaded
         gallery; otherwise fall through to real navigation. */
      if (typeof window.handleArtClick === 'function' &&
          document.querySelector('.gItem[data-id="' + CSS.escape(id) + '"]')) {
        closeBookmarksPage();
        window.handleArtClick(ev, id);
      }
    });
    var img = document.createElement('img');
    img.className = 'bmThumb'; img.loading = 'lazy'; img.decoding = 'async';
    /* FIX: this grid used the raw full-size original (art.image_url), so
       Likes/Bookmarks thumbnails loaded uncapped while every other grid
       serves a small resized WebP. Route through the shared thumbnail
       helper (300px @ q55) — guarded with typeof since this Engagement
       module is a separate IIFE scope (mirrors the avatar-thumb call). */
    img.src = (typeof getThumbnailUrl === 'function')
      ? getThumbnailUrl(art.image_url || '')
      : (art.image_url || '');
    img.alt = art.name || 'Artwork';
    var meta = document.createElement('div'); meta.className = 'bmMeta';
    var nm = document.createElement('div'); nm.className = 'bmName';
    nm.textContent = art.name || 'Untitled';
    var ct = document.createElement('div'); ct.className = 'bmCat';
    ct.textContent = Array.isArray(art.category) ? (art.category[0] || 'art') : (art.category || 'art');
    meta.appendChild(nm); meta.appendChild(ct);
    link.appendChild(img); link.appendChild(meta);
    var rm = document.createElement('button');
    rm.className = 'bmRemove'; rm.setAttribute('data-id', id);
    rm.setAttribute('data-kind', bmMode);
    rm.setAttribute('aria-label', 'Remove bookmark'); rm.textContent = '✕';
    card.appendChild(link); card.appendChild(rm);
    return card;
  }
  function removeBmCard (id, kind) {
    var page = $('bmPage');
    if (!page || !page.classList.contains('open') || bmMode !== (kind || 'bm')) return;
    var btn = page.querySelector('.bmRemove[data-id="' + CSS.escape(String(id)) + '"]');
    if (btn && btn.closest('.bmCard')) btn.closest('.bmCard').remove();
    if (!$('bmGrid').children.length) $('bmEmptyState').style.display = '';
  }
  function openSavedPage (mode) {
    if (!me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    bmMode = mode === 'like' ? 'like' : 'bm';
    var like = bmMode === 'like';
    var t = $('bmPageTitle');
    if (t) t.innerHTML = (like ? 'LIKES' : 'BOOKMARKS') + ' <span class="s">✦</span>';
    var et = $('bmEmptyTitle');
    if (et) et.textContent = like ? 'NO LIKES YET' : 'NO BOOKMARKS YET';
    var eh = $('bmEmptyHint');
    if (eh) eh.textContent = like
      ? 'Tap the heart on any artwork and it shows up here.'
      : 'Tap the bookmark icon on any artwork to save it here.';
    $('bmPage').setAttribute('aria-label', like ? 'Liked artworks' : 'Bookmarked artworks');
    bmLastFocus = document.activeElement;
    var page = $('bmPage'); page.classList.add('open');
    var nav = $('bnNav'); if (nav) nav.style.display = 'none';
    document.body.style.overflow = 'hidden';
    loadBookmarksPage();
  }
  function openBookmarksPage () { openSavedPage('bm'); }
  function openLikesPage () { openSavedPage('like'); }
  function closeBookmarksPage () {
    var page = $('bmPage'); page.classList.remove('open');
    var nav = $('bnNav'); if (nav) nav.style.display = '';
    /* FIX: Bookmarks/Likes opens on top of the Profile page — a blind
       overflow reset unlocked background scroll behind it.
       restoreScroll() only unlocks when nothing else is open. */
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
    if (bmLastFocus && bmLastFocus.focus) bmLastFocus.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('bmPage') && $('bmPage').classList.contains('open')) closeBookmarksPage();
  });
  window.openBookmarksPage  = openBookmarksPage;
  window.openLikesPage      = openLikesPage;
  window.closeBookmarksPage = closeBookmarksPage;

  /* ══ PROFILE TOTALS (Total Views / Total Likes) ═════════ */
  async function refreshStatsFor (username) {
    var vEl = $('pfStatViews'), lEl = $('pfStatLikes');
    if (!vEl || !lEl || !db() || !username || username === '—' || /^Loading/.test(username)) return;
    vEl.textContent = '—'; lEl.textContent = '—';
    try {
      var uid = profileIdCache[username];
      if (!uid) {
        var p = await db().from('profiles').select('id').eq('username', username).single();
        if (p.error || !p.data) return;
        uid = profileIdCache[username] = p.data.id;
      }
      var r = await db().rpc('get_profile_engagement', { p_user: uid });
      if (r.error) throw r.error;
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!row) return;
      vEl.textContent = Number(row.total_views  || 0).toLocaleString();
      lEl.textContent = Number(row.total_likes || 0).toLocaleString();
    } catch (e) { /* leave dashes */ }
  }
  function refreshProfileStatsIfOpen () {
    var page = $('profilePage'), un = $('pfUsername');
    if (page && page.classList.contains('open') && un) refreshStatsFor(un.textContent.trim());
  }
  document.addEventListener('DOMContentLoaded', function () {
    var un = $('pfUsername');
    if (un) {
      /* fires for own AND public profiles — the site writes the
         displayed username here on every profile load */
      new MutationObserver(function () {
        refreshStatsFor(un.textContent.trim());
      }).observe(un, { childList: true, characterData: true, subtree: true });
    }
    if (db() && db().auth && db().auth.onAuthStateChange) {
      db().auth.onAuthStateChange(function () { setTimeout(loadSets, 400); });
    } else {
      loadSets();
    }
  });
})();
