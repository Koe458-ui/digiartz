// likes, bookmarks, views
(function () {
  'use strict';
  var VIEW_COOLDOWN = 6 * 3600 * 1000, SEEN_KEY = 'koeViewSeen', VKEY = 'koeViewerKey';
  var liked = new Set(), marked = new Set(), setsReady = false;
  var busy = {};            // in flight lock
  var profileIdCache = {};  // username to user id
  var paintTimer = null;


  function $ (id) { return document.getElementById(id); }
  function db () { return (typeof sb !== 'undefined' && sb) ? sb : null; }
  function me () { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
  function toast (m) { if (typeof showToast === 'function') showToast(m); }

  // views
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
  // Where the visit came from, what it is being read on, roughly where it is.
  // js/analytics.js works these out once per session; this is written so a
  // page loading without it still records the view, minus the dimensions.
  function dims () {
    return (typeof window.dzAnDims === 'function') ? window.dzAnDims() : {};
  }
  function withDims (args) {
    var d = dims();
    for (var k in d) args[k] = d[k];
    return args;
  }

  function registerView (id) {
    if (!id || !db()) return;
    var now = Date.now(), map = seenMap();
    if (map[id] && now - map[id] < VIEW_COOLDOWN) return;   // client cooldown
    map[id] = now;
    for (var k in map) if (now - map[k] > 2 * VIEW_COOLDOWN * 4) delete map[k]; // prune
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch (e) {}
    db().rpc('register_artwork_view', withDims({ p_artwork: id, p_anon_key: viewerKey() }))
      .then(function () {}, function () {});               // fire-and-forget
  }
  // download tracking
  window.registerArtworkDownload = function (id) {
    if (!id || !db()) return;
    db().rpc('register_artwork_download', withDims({ p_artwork: id, p_anon_key: viewerKey() }))
      .then(function () {}, function () {});               // fire-and-forget
  };
  // shared viewer key
  window.dzViewerKey = viewerKey;
  function idFromPath (path) {
    var m = /^\/artwork\/([^/]+)$/.exec(path || '');
    return m ? decodeURIComponent(m[1]) : null;
  }
  // route every open path
  var origPush = history.pushState.bind(history);
  history.pushState = function (state, title, url) {
    var out = origPush(state, title, url);
    try {
      var id = idFromPath(typeof url === 'string' ? url : (url && url.pathname));
      if (id) registerView(id);
    } catch (e) {}
    return out;
  };
  // deep link view
  document.addEventListener('DOMContentLoaded', function () {
    var id = idFromPath(location.pathname);
    if (!id) return;
    var fired = false;
    function go () { if (fired) return; fired = true; registerView(id); }
    var c = db();
    if (c && c.auth && typeof c.auth.getSession === 'function') {
      try { c.auth.getSession().then(go, go); } catch (e) { setTimeout(go, 1200); }
      setTimeout(go, 4000); // fallback
    } else {
      setTimeout(go, 1200);
    }
  });

  // Which artworks this member has liked and saved. It is one member's
  // answer, so it is emptied the moment the session changes and only filled
  // again by a reply fetched for whoever is signed in now.
  function clearSets () { liked.clear(); marked.clear(); setsReady = false; paintSoon(); }

  async function loadSets () {
    if (!db() || !me()) { liked.clear(); marked.clear(); setsReady = true; paintSoon(); return; }
    var uid = me().id;
    try {
      // filter by user id
      var l = await db().from('artwork_likes').select('artwork_id').eq('user_id', uid).limit(3000);
      var b = await db().from('artwork_bookmarks').select('artwork_id').eq('user_id', uid).limit(3000);
      // signed out, or signed in as somebody else, while this was in flight
      if (!me() || String(me().id) !== String(uid)) return;
      liked  = new Set((l.data || []).map(function (r) { return String(r.artwork_id); }));
      marked = new Set((b.data || []).map(function (r) { return String(r.artwork_id); }));
    } catch (e) {
      // an empty heart is wrong for a beat. A filled one belonging to the
      // last member who was signed in is wrong until they reload.
      liked.clear(); marked.clear();
    }
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
  // repaint on prev next
  window.dzRepaintEng = paintAll;
  // repaint new buttons
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
      if (r.error && !(on && r.error.code === '23505')) throw r.error; // dup means already set
      // After the write, never before it: the artist's dashboard should only
      // ever hear about a like that actually landed. Fire-and-forget, so an
      // analytics failure cannot un-like anything.
      if (typeof window.dzAnTrack === 'function') {
        window.dzAnTrack(kind === 'like' ? (on ? 'like' : 'unlike')
                                         : (on ? 'bookmark' : 'unbookmark'), String(id));
      }
      /* The write landed, so the saved copy of the list this belongs to is
         wrong and goes — after the write, and only the one list. The optimistic
         paint above is a promise about the screen; this is what keeps the
         promise true for the next visit. The public like TOTAL is somebody
         else's cached number and is left to its own fifteen seconds. */
      var cache = window.dzCached ? window.dzCached() : null;
      if (cache) {
        try { await cache.invalidateUserList(kind === 'like' ? 'likes' : 'bookmarks'); }
        catch (e2) {}
      }
      if (kind === 'bm') toast(on ? 'Saved to bookmarks' : 'Removed from bookmarks');
      if (kind === 'like') refreshProfileStatsIfOpen();
      if (!on) removeBmCard(id, kind);
    } catch (e) {
      on ? set.delete(id) : set.add(id);  // revert
      paintAll();
      // merit gate error
      if (window.meritDenied && window.meritDenied(e, 'like')) { busy[key] = false; return; }
      toast('Action failed — try again');
    } finally { busy[key] = false; }
  }

  // one delegated listener
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.engLike,.engBm,.bmRemove');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var id = b.getAttribute('data-id') || idFromPath(location.pathname);
    if (!id) return;
    if (b.classList.contains('bmRemove')) { toggle(b.getAttribute('data-kind') === 'like' ? 'like' : 'bm', String(id), b); return; }
    toggle(b.classList.contains('engLike') ? 'like' : 'bm', String(id), b);
  }, true);

  // bookmarks page
  var bmLastFocus = null;
  // two modes, one shell
  var bmMode = 'bm';
  // Likes and Bookmarks are two sections sharing one grid, so the same rule the
  // wallet panel follows applies here: a section that has not loaded shows
  // nothing, and a fetch that comes back after the member has switched does not
  // get to paint. This used to say LOADING… under whichever title was up, and
  // the two requests could land out of order and put likes under BOOKMARKS.
  var bmSeq = 0;
  async function loadBookmarksPage () {
    var grid = $('bmGrid'), empty = $('bmEmptyState');
    var seq = ++bmSeq;
    var mode = bmMode;
    var live = function () { return seq === bmSeq && bmMode === mode; };
    grid.innerHTML = '';
    empty.style.display = 'none';
    if (!db() || !me()) { empty.style.display = ''; return; }

    /* One member's own likes or bookmarks, and the artwork rows behind them.
       Private in every sense the cache service understands: stamped with their
       id, refused for any other session, off the device at sign-out. Short,
       because they change from the same screens that read them. Cached at all
       because this is two queries deep and the page is opened, closed and
       re-opened constantly — and painted from the saved copy first, so it opens
       with the grid already in place rather than with a gap. */
    var c = window.dzCached ? window.dzCached() : null;
    var key = c ? c.ukey('list', mode === 'like' ? 'likes' : 'bookmarks') : null;

    var load = async function () {
      // filter by user id
      var b = await db().from(mode === 'like' ? 'artwork_likes' : 'artwork_bookmarks')
        .select('artwork_id,created_at')
        .eq('user_id', me().id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (b.error) throw b.error;
      var ids = (b.data || []).map(function (r) { return r.artwork_id; });
      if (!ids.length) return { ids: [], rows: [] };
      var a = await db().from('artworks')
        .select('id,name,image_url,category')
        .in('id', ids);
      if (a.error) throw a.error;
      return { ids: ids, rows: a.data || [] };
    };

    var paint = function (snap) {
      if (!live() || !snap) return;
      var byId = {};
      (snap.rows || []).forEach(function (art) { byId[String(art.id)] = art; });
      grid.innerHTML = '';
      (snap.ids || []).forEach(function (rawId) {
        var art = byId[String(rawId)];
        if (!art) return;                       // artwork was deleted
        grid.appendChild(bmCard(art));
      });
      empty.style.display = grid.children.length ? 'none' : '';
    };

    try {
      paint((c && key) ? await c.warm(key, load, 'user:list', paint, paint) : await load());
    } catch (e) {
      if (!live()) return;
      // their own saved copy, if there is one, rather than an error over a grid
      var old = (c && key) ? await c.recall(key, 'user:list') : null;
      if (old && old.ids && old.ids.length) { paint(old); return; }
      grid.innerHTML = '<div class="bmEmpty">COULDN\u2019T LOAD ' +
        (mode === 'like' ? 'LIKES' : 'BOOKMARKS') + ' — TRY AGAIN</div>';
    }
  }
  /* CSS.escape is assumed by two selectors below and feature-detected in
     js/app-core.js, which is the same bundle. A browser without it threw
     inside the click handler, so the bookmark card neither opened nor was
     removed — a hard failure where a degraded one was available. Same
     fallback app-core uses. */
  function cssEsc (v) {
    return (window.CSS && CSS.escape)
      ? CSS.escape(String(v))
      : String(v).replace(/["\\]/g, '\\$&');
  }

  function bmCard (art) {
    var id = String(art.id);
    var card = document.createElement('div');
    card.className = 'bmCard';
    var link = document.createElement('a');
    link.href = '/artwork/' + encodeURIComponent(id);
    link.style.cssText = 'display:block;color:inherit;text-decoration:none;';
    link.addEventListener('click', function (ev) {
      // modal if loaded, else navigate
      if (typeof window.handleArtClick === 'function' &&
          document.querySelector('.gItem[data-id="' + cssEsc(id) + '"]')) {
        closeBookmarksPage();
        window.handleArtClick(ev, id);
      }
    });
    var img = document.createElement('img');
    img.className = 'bmThumb'; img.loading = 'lazy'; img.decoding = 'async';
    // use thumbnail url
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
    var btn = page.querySelector('.bmRemove[data-id="' + cssEsc(id) + '"]');
    if (btn && btn.closest('.bmCard')) btn.closest('.bmCard').remove();
    if (!$('bmGrid').children.length) $('bmEmptyState').style.display = '';
  }
  function openSavedPage (mode) {
    if (!me()) { if (typeof openAuthMod === 'function') openAuthMod(); return; }
    bmMode = mode === 'like' ? 'like' : 'bm';
    var like = bmMode === 'like';
    var t = $('bmPageTitle');
    if (t) t.innerHTML = like ? 'LIKES' : 'BOOKMARKS';
    var et = $('bmEmptyTitle');
    if (et) et.textContent = like ? 'NO LIKES YET' : 'NO BOOKMARKS YET';
    var eh = $('bmEmptyHint');
    if (eh) eh.textContent = like
      ? 'Tap the heart on any artwork and it shows up here.'
      : 'Tap the bookmark icon on any artwork to save it here.';
    $('bmPage').setAttribute('aria-label', like ? 'Liked artworks' : 'Bookmarked artworks');
    bmLastFocus = document.activeElement;
    var page = $('bmPage'); page.classList.add('open');
    document.body.style.overflow = 'hidden';
    loadBookmarksPage();
  }
  function openBookmarksPage () { openSavedPage('bm'); }
  function openLikesPage () { openSavedPage('like'); }
  function closeBookmarksPage () {
    var page = $('bmPage'); page.classList.remove('open');
    // restore scroll
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

  /* Profile totals. These two tiles have two writers — pfPaintStats, which
     sums the artwork rows it has in hand, and this, which asks the database
     for the real totals. This one is the better answer, so it lands second
     and wins. It has to agree with the other on format, and it must not
     blank the tiles on its way: it used to write an em dash before fetching,
     so every failure left a dash sitting where a number had been.

     It also has to be handed the handle. It looks the member up by username
     and was being given #pfUsername, which is the display name whenever one
     is set. Anybody with a display name was looked up under a name no row
     has, the lookup came back empty, and the dashes it had just written
     stayed there for good. */
  function statFmt (n) {
    return (typeof pfFmtCount === 'function')
      ? pfFmtCount(n) : Number(n || 0).toLocaleString();
  }
  async function refreshStatsFor (handle) {
    var vEl = $('pfStatViews'), lEl = $('pfStatLikes');
    if (!vEl || !lEl || !db()) return;
    handle = String(handle || '').replace(/^@/, '').trim();
    if (!handle || handle === '—' || /^Loading/.test(handle)) return;
    try {
      // the open profile already knows its own id, so no lookup is needed
      var uid = (window.pf && pf.profile && pf.profile.username &&
                 String(pf.profile.username).toLowerCase() === handle.toLowerCase())
                  ? pf.profile.id : profileIdCache[handle];
      if (!uid) {
        var p = await db().from('profiles').select('id').eq('username', handle).maybeSingle();
        if (p.error || !p.data) return;   // leave whatever is on screen
        uid = profileIdCache[handle] = p.data.id;
      }
      var r = await db().rpc('get_profile_engagement', { p_user: uid });
      if (r.error) throw r.error;
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!row) return;
      // the profile may have been swapped while this was in flight
      if (window.pf && pf.profile && String(pf.profile.id) !== String(uid)) return;
      vEl.textContent = statFmt(row.total_views);
      lEl.textContent = statFmt(row.total_likes);
      // These came from the database's own totals, so they beat the estimate
      // pfPaintStats makes by summing the artwork rows it happens to hold.
      // Marked per profile, so the claim does not carry to the next one.
      vEl.dataset.total = String(uid);
      lEl.dataset.total = String(uid);
    } catch (e) { /* leave the numbers that are already there */ }
  }
  function refreshProfileStatsIfOpen () {
    var page = $('profilePage'), h = $('pfHandle');
    if (page && page.classList.contains('open') && h) refreshStatsFor(h.textContent);
  }
  document.addEventListener('DOMContentLoaded', function () {
    // the handle, not the display name: it is what the row is keyed by, and
    // it changes at the same moment for every profile that opens
    var h = $('pfHandle');
    if (h) {
      new MutationObserver(function () {
        refreshStatsFor(h.textContent);
      }).observe(h, { childList: true, characterData: true, subtree: true });
    }
    if (db() && db().auth && db().auth.onAuthStateChange) {
      // Only when the MEMBER changes. This handler also runs for
      // TOKEN_REFRESHED, roughly once an hour for as long as a tab is open, and
      // clearing on that emptied both sets and left every heart and bookmark on
      // screen reading as unset until the refetch landed 400ms-plus later —
      // for a session that had not changed at all.
      var lastId = me() ? String(me().id) : 'guest';
      db().auth.onAuthStateChange(function () {
        var nowId = me() ? String(me().id) : 'guest';
        if (nowId === lastId) return;
        lastId = nowId;
        // empty now, refill when the new session's answer comes back — the
        // gap used to paint the previous member's hearts for 400ms, and for
        // good if the refetch then failed
        clearSets();
        setTimeout(loadSets, 400);
      });
      // The listener above only fires on a change, so the first load needs
      // asking for outright — it used to arrive as the initial auth event.
      loadSets();
    } else {
      loadSets();
    }
  });
})();
