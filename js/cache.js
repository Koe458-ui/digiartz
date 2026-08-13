// central cache service
/* One cache service for the whole site, because the alternative is what was
   here before: a handful of localStorage snapshots written by whichever file
   happened to need one, with no expiry, no shared vocabulary for keys, and no
   answer to the question "is this still true?". Those snapshots were only ever
   read when a fetch had already failed, so every panel on the site paid a full
   round trip to Supabase on every visit — and the second, third and tenth
   component to ask for the same list each paid their own.

   What this file provides:

     memory      a bounded map, per tab, for the current session
     disk        IndexedDB, survives the tab and the browser being closed
     mirror      a small localStorage tier for the few values that have to be
                 readable SYNCHRONOUSLY, before the first paint
     policy      one TTL/scope table, so a decision about freshness is made
                 once by name rather than argued about at each call site
     single      identical concurrent requests collapse into one origin call
     targeted    invalidation by key or prefix, never "clear everything"
     metrics     hit/miss/stale/error counters, readable from the console

   What it is NOT: authorization. Supabase and object storage remain the source
   of truth for everything. Nothing here decides whether a member may read a
   row, download a file, or spend a quota; a cached copy is only ever a faster
   answer to a question the server has already said yes to. If the cache and
   the database disagree, the database is right and the cache is dropped.

   Private data is partitioned by member id and refused for anybody else, so a
   shared device cannot hand one member's conversations, bookmarks or analytics
   to the next person to sign in. The scope is declared in the policy table
   below, and the default is the safe one: a policy with no scope named is
   treated as private and stays out of any shared tier.

   Read the whole design in CACHE.md.
*/
(function () {
  'use strict';

  // Bumped when the SHAPE of what is stored changes, which makes every
  // existing record unreadable rather than merely stale. It is part of every
  // stored key, so a bump orphans the old set and the sweep clears it.
  var BUILD = 'c1';

  var DB_NAME = 'digiartz-cache';
  var DB_STORE = 'entries';
  var MIRROR_PREFIX = 'dzc2:';
  var LEGACY_PREFIX = 'dzc1:';       // the snapshots this file replaces

  // Bounds. Memory is per tab and cheap to refill; disk is the one a member
  // actually notices, and 1200 rows of JSON at a few KB each is a handful of
  // megabytes — well inside a normal origin quota, and swept on every start.
  var MAX_MEM = 400;
  var MAX_DISK = 1200;
  var MIRROR_MAX_BYTES = 96 * 1024;  // per record; localStorage is small
  var WRITE_DELAY = 250;             // batch disk writes rather than one txn each

  var SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

  /* ── policy table ──────────────────────────────────────────────────────
     ttl    how long the value is fresh
     swr    how long past ttl it may still be SERVED while a refresh runs
     scope  'public'  may sit in any tier, may be read by anyone on the device
            'private' stamped with the member id and refused for anybody else
     store  'both'    memory + disk
            'memory'  this tab only, never written down
            'none'    not cached at all, the loader always runs
     sync   also mirrored into localStorage, for values needed before the
            first paint. Use sparingly; localStorage is small and synchronous.
     cap    keep at most this many records on disk under this key's family
     capAt  how many leading key segments name that family. Getting this wrong
            is how a cap on chat threads evicts somebody's profile, so it is
            written out rather than guessed: 'user:<id>:thread:<pid>' needs 3.
     offline whether a stored value past its stale window may be served when
            the origin is unreachable. OFF by default, and deliberately: a
            silent fallback is right for a section listing, whose call site has
            nothing useful to say about it, and wrong for the gallery, whose
            call site wants to tell the reader it is showing a saved copy. A
            policy without it hands the error to the caller, which can then use
            recall() and say something.

     The numbers come from the spec's TTL matrix. Anything security or money
     shaped is deliberately absent or 'none': subscription state, entitlement
     and download quota are asked of the server every time.
  */
  var POLICY = {
    /* Public artwork listings. Latest moves constantly, oldest never does.
       No `offline` on latest, and that is on purpose: loadDB wants the error so
       it can fall back to the saved list AND tell the reader that is what it is
       showing. */
    'gallery:latest':    { ttl: 45 * SEC,  swr: 5 * MIN,  scope: 'public', store: 'both', sync: true },
    'gallery:trending':  { ttl: 3 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', offline: true },
    'gallery:oldest':    { ttl: 10 * MIN,  swr: 15 * MIN, scope: 'public', store: 'both', offline: true },
    'gallery:category':  { ttl: 3 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 24, capAt: 1, offline: true },
    'gallery:tag':       { ttl: 3 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 24, capAt: 1, offline: true },

    // one artwork, and its public counters. The counters move on their own,
    // so they are a separate key with a separate life.
    'artwork':           { ttl: 3 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 120, capAt: 1, offline: true },
    'artwork:stats':     { ttl: 15 * SEC,  swr: 45 * SEC, scope: 'public', store: 'memory' },

    // public profiles and the artwork under them
    'profile:public':    { ttl: 5 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 60, capAt: 2, offline: true },
    'artist:artworks':   { ttl: 2 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 40, capAt: 2, offline: true },

    // comments are conversation: short, and refreshed on open
    'comments':          { ttl: 20 * SEC,  swr: 60 * SEC, scope: 'public', store: 'memory' },

    // the six section tabs. Jobs turn over fastest, blog slowest.
    'section:blog':      { ttl: 5 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', offline: true },
    'section:resources': { ttl: 5 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', offline: true },
    'section:marketplace': { ttl: 3 * MIN, swr: 10 * MIN, scope: 'public', store: 'both', offline: true },
    'section:jobs':      { ttl: 60 * SEC,  swr: 5 * MIN,  scope: 'public', store: 'both', offline: true },
    'section:item':      { ttl: 5 * MIN,   swr: 15 * MIN, scope: 'public', store: 'both', cap: 80, capAt: 2, offline: true },

    // Price and stock are NOT cached from here — the item row carries them and
    // is re-read at checkout. The cart is one member's and never shared.
    'cart':              { ttl: 15 * SEC,  swr: 0,        scope: 'private', store: 'memory' },

    /* Public search. Every distinct query is its own record, which is how a
       search cache turns into a memory leak with a crawler pointed at it — so
       it is memory only, never written to disk, and bounded by the memory
       tier's own LRU (MAX_MEM, least recently read evicted first). A minute is
       long enough to cover somebody clearing the box and typing the same word
       again, or walking back through the scope chips, and short enough that a
       newly published post shows up in a search for it. */
    'search':            { ttl: 60 * SEC,  swr: 0,        scope: 'public', store: 'memory' },

    // fixed lists that change when someone edits the code
    'categories':        { ttl: DAY,       swr: 7 * DAY,  scope: 'public', store: 'both', sync: true, offline: true },

    /* Device-level interface preferences: which window the analytics page opens
       on, and things of that kind. Deliberately NOT member-scoped, because they
       are read while the page is still starting up and before the session has
       been restored — a member-scoped read at that moment finds nothing, every
       time. The rule for this policy, and it is the only one that keeps it
       honest: nothing about a member goes in here. Not their name, not a count,
       not an id. A chart window is a property of the browser, like the theme;
       anything that describes a person belongs under user:settings. */
    'device:prefs':      { ttl: 30 * DAY,  swr: 90 * DAY, scope: 'public', store: 'both', sync: true, offline: true },

    // ranking is public but expensive to compute
    'ranking':           { ttl: 3 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 20, capAt: 1, offline: true },

    // The community directory is public — the same list for everybody.
    'communities':       { ttl: 3 * MIN,   swr: 10 * MIN, scope: 'public', store: 'both', cap: 20, capAt: 1, offline: true },

    /* What is said INSIDE a room is not. Whether a member may read a channel
       is the database's decision, and some of them are for members only, so
       these records are stamped with the id of the member they were fetched
       for and refused for anybody else. The alternative — a public record,
       because most rooms are open — is a cache that hands member-only
       discussion to the next person to sign in on a shared laptop. The last
       dozen rooms visited, the last fifty messages of each. */
    'community:posts':   { ttl: 45 * SEC,  swr: 3 * MIN,  scope: 'private', store: 'both', sync: true, cap: 12, capAt: 3, offline: true },

    // one member's own things. Private, on disk, short. Their own data is
    // theirs to see offline, so these opt into the last-resort read.
    'user:profile':      { ttl: 60 * SEC,  swr: 10 * MIN, scope: 'private', store: 'both', sync: true, offline: true },
    'user:list':         { ttl: 30 * SEC,  swr: 5 * MIN,  scope: 'private', store: 'both', cap: 40, capAt: 3, offline: true },
    'user:friends':      { ttl: 30 * SEC,  swr: 5 * MIN,  scope: 'private', store: 'both', sync: true, offline: true },
    'user:convos':       { ttl: 20 * SEC,  swr: 5 * MIN,  scope: 'private', store: 'both', sync: true, offline: true },
    'user:thread':       { ttl: 10 * SEC,  swr: 2 * MIN,  scope: 'private', store: 'both', cap: 30, capAt: 3, offline: true },
    'user:settings':     { ttl: DAY,       swr: 7 * DAY,  scope: 'private', store: 'both', sync: true, offline: true },
    'user:analytics':    { ttl: 2 * MIN,   swr: 5 * MIN,  scope: 'private', store: 'both', cap: 24, capAt: 3 },

    // Notifications must never be a minute old, and are not worth writing
    // down: they are read on open and then marked read.
    'user:notifications': { ttl: 10 * SEC, swr: 0,        scope: 'private', store: 'memory' },

    // Entitlement. Held for one screenful of interaction so a panel does not
    // ask four times while it paints, never written to disk, and never the
    // basis of a decision the server has not also made.
    'subscription':      { ttl: 15 * SEC,  swr: 0,        scope: 'private', store: 'memory' },

    // Named so a call site can be explicit about not caching. Quota and
    // download authorization live here.
    'none':              { ttl: 0,         swr: 0,        scope: 'private', store: 'none' }
  };

  var DEFAULT = { ttl: 30 * SEC, swr: 0, scope: 'private', store: 'memory' };

  /* ── metrics ─────────────────────────────────────────────────────────── */

  var m = {
    hit: 0, miss: 0, stale: 0, refresh: 0, error: 0, evict: 0,
    dedup: 0, origin: 0, write: 0, reject: 0, disk_error: 0
  };
  function count(what) {
    m[what] = (m[what] || 0) + 1;
    if (typeof window.dzCacheOnEvent === 'function') {
      try { window.dzCacheOnEvent(what); } catch (e) {}
    }
  }
  var DEBUG = false;
  try { DEBUG = localStorage.getItem('dz.cache.debug') === '1'; } catch (e) {}
  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[cache]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  /* ── identity ────────────────────────────────────────────────────────── */

  // Read live rather than captured: sign-in happens after this file loads, and
  // a captured 'guest' would mis-stamp every record written afterwards.
  function uid() {
    var u = window.currentUser;
    return (u && u.id) ? String(u.id) : 'guest';
  }

  function policy(name) {
    if (name && typeof name === 'object') {
      // an inline override, on top of a named base when one is given
      var base = POLICY[name.policy] || DEFAULT;
      var out = {};
      for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
      for (var j in name) if (Object.prototype.hasOwnProperty.call(name, j)) out[j] = name[j];
      return out;
    }
    return POLICY[name] || DEFAULT;
  }

  // The stored key. BUILD keeps shapes apart across releases; a private
  // record additionally carries whose it is, so two members on one device
  // cannot collide even before the owner check runs.
  function full(key, p) {
    return p.scope === 'public'
      ? BUILD + '|p|' + key
      : BUILD + '|u|' + uid() + '|' + key;
  }

  /* ── memory tier ─────────────────────────────────────────────────────── */

  var mem = new Map();

  function memGet(k) {
    var e = mem.get(k);
    if (!e) return null;
    // refresh recency: delete and re-insert, Map keeps insertion order
    mem.delete(k); mem.set(k, e);
    return e;
  }
  function memSet(k, e) {
    if (mem.has(k)) mem.delete(k);
    mem.set(k, e);
    while (mem.size > MAX_MEM) {
      var oldest = mem.keys().next();
      if (oldest.done) break;
      mem.delete(oldest.value);
      count('evict');
    }
  }

  /* ── mirror tier (localStorage, synchronous) ──────────────────────────── */

  function mirrorGet(k) {
    try {
      var raw = localStorage.getItem(MIRROR_PREFIX + k);
      if (!raw) return null;
      var e = JSON.parse(raw);
      return (e && typeof e === 'object' && 'v' in e) ? e : null;
    } catch (e) { return null; }
  }
  function mirrorSet(k, e) {
    var raw;
    try { raw = JSON.stringify(e); } catch (err) { return; }
    if (raw.length > MIRROR_MAX_BYTES) return;   // too big for this tier
    try {
      localStorage.setItem(MIRROR_PREFIX + k, raw);
    } catch (err) {
      // Out of room. Drop the whole mirror rather than guessing which record
      // matters least — disk still has everything, this tier is only a
      // head start on the first paint.
      mirrorClear();
      try { localStorage.setItem(MIRROR_PREFIX + k, raw); } catch (e2) {}
    }
  }
  function mirrorDel(k) {
    try { localStorage.removeItem(MIRROR_PREFIX + k); } catch (e) {}
  }
  function mirrorKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(MIRROR_PREFIX) === 0) out.push(k.slice(MIRROR_PREFIX.length));
      }
    } catch (e) {}
    return out;
  }
  function mirrorClear() {
    mirrorKeys().forEach(mirrorDel);
  }

  /* ── disk tier (IndexedDB) ────────────────────────────────────────────── */

  var dbPromise = null, dbDead = false;

  function db() {
    if (dbDead) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); }
      catch (e) { dbDead = true; resolve(null); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, { keyPath: 'k' });
      };
      req.onsuccess = function () {
        var d = req.result;
        // A version change from another tab closes this handle; drop it so the
        // next call reopens rather than throwing on a dead connection.
        d.onversionchange = function () { try { d.close(); } catch (e) {} dbPromise = null; };
        resolve(d);
      };
      req.onerror = function () { dbDead = true; count('disk_error'); resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return db().then(function (d) {
      if (!d) return null;
      try { return d.transaction(DB_STORE, mode).objectStore(DB_STORE); }
      catch (e) { count('disk_error'); return null; }
    });
  }

  function diskGet(k) {
    return tx('readonly').then(function (store) {
      if (!store) return null;
      return new Promise(function (resolve) {
        var r = store.get(k);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { count('disk_error'); resolve(null); };
      });
    }).catch(function () { return null; });
  }

  // Writes are batched: a gallery load can settle a dozen keys at once, and a
  // transaction each is both slower and more likely to be interrupted.
  var writeQueue = new Map(), writeTimer = null;

  function diskSet(k, e) {
    writeQueue.set(k, e);
    if (writeTimer) return;
    writeTimer = setTimeout(flushWrites, WRITE_DELAY);
  }

  function flushWrites() {
    writeTimer = null;
    if (!writeQueue.size) return Promise.resolve();
    var batch = writeQueue; writeQueue = new Map();
    return tx('readwrite').then(function (store) {
      if (!store) return;
      batch.forEach(function (e, k) {
        try { store.put(e); count('write'); }
        catch (err) { count('disk_error'); }
      });
      return new Promise(function (resolve) {
        store.transaction.oncomplete = resolve;
        store.transaction.onabort = function () {
          // Almost always quota. Free the oldest quarter and let the next
          // write land; nothing here is worth failing a page over.
          count('disk_error');
          sweep(true).then(resolve, resolve);
        };
        store.transaction.onerror = function () { count('disk_error'); resolve(); };
      });
    }).catch(function () {});
  }

  function diskDel(keys) {
    writeQueue && keys.forEach(function (k) { writeQueue.delete(k); });
    return tx('readwrite').then(function (store) {
      if (!store) return;
      keys.forEach(function (k) { try { store.delete(k); } catch (e) {} });
      return new Promise(function (resolve) {
        store.transaction.oncomplete = resolve;
        store.transaction.onabort = resolve;
        store.transaction.onerror = resolve;
      });
    }).catch(function () {});
  }

  // Walk every record. Used by the sweep, by prefix invalidation and by the
  // per-prefix cap. The store is bounded by MAX_DISK, so a full walk is a
  // bounded amount of work and does not need a second index to stay cheap.
  function diskAll() {
    return tx('readonly').then(function (store) {
      if (!store) return [];
      return new Promise(function (resolve) {
        var out = [];
        var r = store.openCursor();
        r.onsuccess = function () {
          var c = r.result;
          if (!c) { resolve(out); return; }
          out.push(c.value);
          c.continue();
        };
        r.onerror = function () { count('disk_error'); resolve(out); };
      });
    }).catch(function () { return []; });
  }

  /* ── the entry ────────────────────────────────────────────────────────── */

  // k    stored key
  // v    value
  // t    written at
  // f    fresh until
  // s    servable until (f + swr)
  // u    owner, for private records
  // a    last read, for LRU
  // p    policy name, for the console report
  function entryOf(k, key, value, p, name) {
    var now = Date.now();
    return {
      k: k, key: key, v: value, t: now,
      f: now + (p.ttl || 0),
      s: now + (p.ttl || 0) + (p.swr || 0),
      u: p.scope === 'public' ? null : uid(),
      a: now, p: name || null
    };
  }

  // A record is refused, not merely ignored, when it was written for someone
  // else. Records written before owners existed have no owner and are refused
  // too, which is the right answer for them.
  //
  // `any` drops only the expiry check, never the owner check. It is for the two
  // cases where an old value beats no value: painting a saved list before the
  // network answers, and answering at all when the network does not.
  function usable(e, p, any) {
    if (!e || typeof e !== 'object') return null;
    if (p.scope !== 'public' && e.u !== uid()) { count('reject'); return null; }
    if (!any && (!e.s || Date.now() > e.s)) return null;
    return e;
  }

  /* ── lookup ───────────────────────────────────────────────────────────── */

  // Synchronous read, for the paint that happens before any await. Memory
  // first, then the mirror. Returns the value or null; a stale value is
  // returned too, because a stale list on screen in 0ms beats an empty one
  // for 400ms, and the refresh is already on its way.
  // opts.any accepts a value past its stale window — for the paint that would
  // otherwise be an empty grid. Yesterday's top twenty on screen in no time,
  // corrected a moment later by the refresh already in flight, is the whole
  // point of writing them down.
  function peek(key, name, opts) {
    var p = policy(name);
    if (p.store === 'none') return null;
    var any = !!(opts && opts.any);
    var k = full(key, p);
    var e = usable(memGet(k), p, any);
    if (e) return e.v;
    if (p.sync) {
      e = usable(mirrorGet(k), p, any);
      if (e) { memSet(k, e); return e.v; }
    }
    return null;
  }

  function lookup(k, p, any) {
    var e = usable(memGet(k), p, any);
    if (e) return Promise.resolve(e);
    if (p.sync) {
      var mv = usable(mirrorGet(k), p, any);
      if (mv) { memSet(k, mv); return Promise.resolve(mv); }
    }
    if (p.store !== 'both') return Promise.resolve(null);
    return diskGet(k).then(function (de) {
      var ok = usable(de, p, any);
      if (ok) memSet(k, ok);
      return ok;
    });
  }

  // The last-resort read: whatever is stored, however old, owner check intact.
  // Call sites use it in their own catch blocks when they want to say something
  // about it — "Offline — showing saved artworks" — rather than silently
  // serving an old list.
  function recall(key, name) {
    var p = policy(name);
    if (p.store === 'none') return Promise.resolve(null);
    return lookup(full(key, p), p, true).then(function (e) { return e ? e.v : null; });
  }

  function get(key, name) {
    var p = policy(name);
    if (p.store === 'none') return Promise.resolve(null);
    return lookup(full(key, p), p).then(function (e) {
      if (!e) return null;
      return Date.now() < e.f ? e.v : null;   // only the fresh value
    });
  }

  function set(key, value, name) {
    var p = policy(name);
    if (p.store === 'none') return Promise.resolve(value);
    var k = full(key, p);
    var e = entryOf(k, key, value, p, typeof name === 'string' ? name : null);
    memSet(k, e);
    if (p.sync) mirrorSet(k, e);
    if (p.store === 'both') {
      diskSet(k, e);
      if (p.cap) scheduleCap(family(key, p), p.cap);
    }
    return Promise.resolve(value);
  }

  function del(key, name) {
    var p = policy(name);
    var k = full(key, p);
    mem.delete(k);
    mirrorDel(k);
    return diskDel([k]);
  }

  /* ── prefix operations ────────────────────────────────────────────────── */

  // Matches on the part of the stored key AFTER the build/scope/owner
  // preamble, so a caller writes 'gallery:' and does not have to know how a
  // key is assembled.
  function tailOf(k) {
    var parts = String(k).split('|');
    return parts.length > 2 ? parts.slice(parts[1] === 'u' ? 3 : 2).join('|') : k;
  }

  function matchAny(tail, prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      if (tail.indexOf(prefixes[i]) === 0) return true;
    }
    return false;
  }

  // One walk of the store however many prefixes are being dropped. An artwork
  // edit invalidates six families at once, and six separate walks of the same
  // store to delete from it once is work for nothing.
  function deleteByPrefix(prefix, opts) {
    var list = Array.isArray(prefix) ? prefix.slice() : [prefix];
    list = list.filter(function (x) { return typeof x === 'string' && x; });
    if (!list.length) return Promise.resolve();
    var quiet = opts && opts.quiet;

    var hits = [];
    mem.forEach(function (e, k) { if (matchAny(tailOf(k), list)) hits.push(k); });
    hits.forEach(function (k) { mem.delete(k); });
    mirrorKeys().forEach(function (k) { if (matchAny(tailOf(k), list)) mirrorDel(k); });
    // A request already out — or one asked for and still looking in the cache —
    // would land on the key just dropped and put the old answer back. It still
    // finishes for its caller; it just does not get to store what it found.
    noteInvalidation(list, false);
    // And a write already queued for disk is that same answer taking a slower
    // route to the same place. Dropped before it can be flushed.
    writeQueue.forEach(function (e, k) { if (matchAny(tailOf(k), list)) writeQueue.delete(k); });
    if (!quiet) list.forEach(broadcast);
    log('drop', list.join(' '));

    return diskAll().then(function (rows) {
      var kill = rows.filter(function (r) { return matchAny(tailOf(r.k), list); })
                     .map(function (r) { return r.k; });
      return kill.length ? diskDel(kill) : null;
    });
  }

  // The key family a cap applies to: the first `capAt` segments. Declared in
  // the policy rather than inferred, because inferring it wrongly means a cap
  // on one thing quietly evicting another.
  function family(key, p) {
    var n = p.capAt || 1;
    return String(key).split(':').slice(0, n).join(':') + ':';
  }

  // Keep the newest `cap` records in a family: search grows a record per
  // distinct query, artwork detail one per piece opened, chat one per thread.
  // Debounced, because it reads the whole store and a gallery load settles a
  // dozen keys in a frame — one check after the burst, not one per key.
  var capTimers = {};
  function scheduleCap(prefix, cap) {
    if (capTimers[prefix]) return;
    capTimers[prefix] = setTimeout(function () {
      delete capTimers[prefix];
      capFamily(prefix, cap);
    }, 4000);
  }
  function capFamily(prefix, cap) {
    return diskAll().then(function (rows) {
      var mine = rows.filter(function (r) { return tailOf(r.k).indexOf(prefix) === 0; });
      if (mine.length <= cap) return null;
      mine.sort(function (a, b) { return (b.a || b.t || 0) - (a.a || a.t || 0); });
      var kill = mine.slice(cap).map(function (r) { count('evict'); return r.k; });
      kill.forEach(function (k) { mem.delete(k); mirrorDel(k); });
      return diskDel(kill);
    }).catch(function () {});
  }

  /* ── single flight ────────────────────────────────────────────────────── */

  var inflight = {};

  /* A short history of what has been invalidated, and when.
   *
   * The problem it solves: an answer that describes the world from before a
   * mutation must not be stored after it. Two attempts at this were wrong.
   *
   * A flag on the key, cleared by whoever checked it, fails when several
   * callers are deduped onto one request — the first clears it and the second
   * stores exactly the answer the first was told to discard.
   *
   * A counter bumped for keys that are IN FLIGHT fails earlier than that. A
   * request is not in flight the instant it is asked for: the cache is checked
   * first, and that check is asynchronous when it reaches disk. A mutation
   * landing in that window sees an empty in-flight list, marks nothing, and the
   * request it did not know about stores a pre-mutation answer.
   *
   * So the invalidation is recorded rather than the key marked. A caller notes
   * the time before it looks anything up, and before it stores asks whether
   * anything matching its key has been invalidated since. Reading is not
   * consuming, so every deduped caller reaches the same conclusion, and a
   * request that had not yet announced itself is covered too. Ties count as
   * invalidated: skipping a cache write costs a query later, storing a stale
   * answer costs correctness.
   */
  var invalidations = [];
  var INVAL_KEEP = 5 * MIN, INVAL_MAX = 200;

  function noteInvalidation(list, priv) {
    var now = Date.now();
    invalidations.push({ t: now, list: list, priv: !!priv });
    // bounded two ways: by age, and by count for a burst inside the window
    while (invalidations.length && (invalidations.length > INVAL_MAX ||
           now - invalidations[0].t > INVAL_KEEP)) {
      invalidations.shift();
    }
  }

  function invalidatedSince(k, since) {
    var tail = tailOf(k), isPrivate = String(k).indexOf(BUILD + '|u|') === 0;
    for (var i = invalidations.length - 1; i >= 0; i--) {
      var rec = invalidations[i];
      if (rec.t < since) break;              // ordered by time, nothing older matches
      if (rec.priv && isPrivate) return true;
      if (rec.list && matchAny(tail, rec.list)) return true;
    }
    return false;
  }

  // Ten components asking for gallery:latest:page:1 in the same frame make one
  // request to Supabase and all get its answer. Without this, opening the home
  // page fanned out into a request per panel.
  function fetchOnce(k, loader) {
    if (inflight[k]) { count('dedup'); return inflight[k]; }
    count('origin');
    var pr = Promise.resolve().then(loader).then(
      function (v) { delete inflight[k]; return v; },
      function (e) { delete inflight[k]; throw e; }
    );
    inflight[k] = pr;
    return pr;
  }


  /* ── getOrSet ─────────────────────────────────────────────────────────── */

  /* The one function most call sites should use.

       fresh                     -> the cached value, no request
       stale but inside swr      -> the cached value NOW, refresh in background
       past swr, or nothing      -> await the loader, then store

     A failed loader never overwrites a good record. For public data a stale
     value is served while the origin is unreachable, which is what keeps the
     gallery on screen on a train. For private data that fallback is opt-in
     (offline: true) and off by default: a wrong number on somebody's own
     dashboard is worse than an honest error.
  */
  function getOrSet(key, loader, name, onFresh) {
    var p = policy(name);
    if (p.store === 'none') return Promise.resolve().then(loader);
    var k = full(key, p);
    var nm = typeof name === 'string' ? name : null;
    // Noted BEFORE the lookup, which is where the previous version of this went
    // wrong: the window that has to be covered opens the moment this call is
    // made, not the moment the request goes out.
    var asked = Date.now();

    return lookup(k, p).then(function (e) {
      var now = Date.now();

      if (e && now < e.f) {
        count('hit');
        e.a = now;
        return e.v;
      }

      if (e) {
        // inside the stale window: answer immediately, refresh behind it.
        // onFresh is how the caller repaints when the refresh lands — without
        // it, stale-while-revalidate updates the cache and leaves the screen
        // showing the old answer until something else asks.
        count('stale');
        revalidate(k, key, loader, p, nm, onFresh, asked);
        return e.v;
      }

      count('miss');
      return fetchOnce(k, loader).then(function (v) {
        if (v !== undefined && !invalidatedSince(k, asked)) set(key, v, negative(v, p, name));
        return v;
      }, function (err) {
        count('error');
        /* The origin is unreachable. Where the policy asked for it, whatever was
           stored is a better answer than a broken panel — and nothing has been
           overwritten, so the next attempt is clean. Where it did not, the error
           goes to the caller: some screens have something to say about being
           offline, and swallowing it here would stop them saying it. */
        if (p.offline) {
          return lookup(k, p, true).then(function (old) {
            if (old) return old.v;
            throw err;
          });
        }
        throw err;
      });
    });
  }

  /* "There is no such row" is an answer worth remembering, briefly. A shared
     link to a deleted piece, a mistyped id, a bot walking old URLs: without
     this, each of those is a database query every time it is asked for. With a
     long TTL it is worse than the query — an item published a moment after
     someone looked for it stays missing for as long as the policy says. So a
     null is stored for twenty seconds and no longer, whatever the policy would
     have allowed for a real answer. */
  function negative(v, p, name) {
    if (v !== null) return name;
    var neg = {};
    for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) neg[k] = p[k];
    neg.ttl = 20 * SEC;
    neg.swr = 0;
    return neg;
  }

  function revalidate(k, key, loader, p, nm, onFresh, asked) {
    count('refresh');
    var since = asked || Date.now();
    fetchOnce(k, loader).then(function (v) {
      if (v === undefined || invalidatedSince(k, since)) return;
      set(key, v, negative(v, p, nm || p));
      if (typeof onFresh === 'function') {
        try { onFresh(v); } catch (e) {}
      }
    }, function () {
      count('error');   // keep the stale record, it is better than nothing
    });
  }

  /* Same contract, but the caller also wants the instant paint: onStale is
     called synchronously-ish with whatever is already stored (fresh or not),
     and the returned promise settles with the authoritative value. This is the
     shape almost every panel on the site wants — paint the saved copy, then
     correct it. */
  function warm(key, loader, name, onStale, onFresh) {
    var have = peek(key, name, { any: true });
    if (have != null && typeof onStale === 'function') {
      try { onStale(have); } catch (e) {}
    }
    return getOrSet(key, loader, name, onFresh);
  }

  /* ── cross tab ────────────────────────────────────────────────────────── */

  // Two tabs open, a comment posted in one: the other must not keep serving
  // the list from before it. Only the prefix travels — each tab drops its own
  // copies, and the tab that made the change is the only one touching disk.
  var chan = null;
  try { chan = ('BroadcastChannel' in window) ? new BroadcastChannel('dz-cache') : null; } catch (e) { chan = null; }
  if (chan) {
    chan.onmessage = function (ev) {
      var d = ev && ev.data;
      if (!d || d.type !== 'drop' || !d.prefix) return;
      var hits = [];
      mem.forEach(function (e, k) { if (tailOf(k).indexOf(d.prefix) === 0) hits.push(k); });
      hits.forEach(function (k) { mem.delete(k); });
      mirrorKeys().forEach(function (k) { if (tailOf(k).indexOf(d.prefix) === 0) mirrorDel(k); });
    };
  }
  function broadcast(prefix) {
    if (!chan) return;
    try { chan.postMessage({ type: 'drop', prefix: prefix }); } catch (e) {}
  }

  /* ── sweep ────────────────────────────────────────────────────────────── */

  // On start: drop what is past even its stale window, drop records from an
  // older BUILD, and hold the store under MAX_DISK by dropping least recently
  // read first. `hard` is the quota path — take a quarter off the top so the
  // write that failed has room.
  function sweep(hard) {
    return diskAll().then(function (rows) {
      var now = Date.now(), kill = [], keep = [];
      rows.forEach(function (r) {
        if (!r || !r.k) return;
        if (String(r.k).indexOf(BUILD + '|') !== 0) { kill.push(r.k); return; }
        if (!r.s || now > r.s + DAY) { kill.push(r.k); return; }   // a day of grace for offline
        keep.push(r);
      });
      var limit = hard ? Math.floor(MAX_DISK * 0.75) : MAX_DISK;
      if (keep.length > limit) {
        keep.sort(function (a, b) { return (b.a || b.t || 0) - (a.a || a.t || 0); });
        keep.slice(limit).forEach(function (r) { count('evict'); kill.push(r.k); });
      }
      log('sweep', kill.length, 'of', rows.length);
      return kill.length ? diskDel(kill) : null;
    }).catch(function () {});
  }

  // The snapshots this file replaces. Left alone they are dead weight in a
  // storage area measured in single-digit megabytes.
  function dropLegacy() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LEGACY_PREFIX) === 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  /* ── sign out ─────────────────────────────────────────────────────────── */

  // Everything stamped with a member id goes, in every tier, immediately.
  // Called from the sign-out path, and it must not be best-effort about the
  // memory tier: that is the copy the next paint would read.
  function dropPrivate() {
    var hits = [];
    mem.forEach(function (e, k) { if (String(k).indexOf(BUILD + '|u|') === 0) hits.push(k); });
    hits.forEach(function (k) { mem.delete(k); });
    mirrorKeys().forEach(function (k) { if (String(k).indexOf(BUILD + '|u|') === 0) mirrorDel(k); });
    // Anything already out for the member signing out must not be written back
    // under the session replacing them — whatever key it was asked for under.
    noteInvalidation(null, true);
    writeQueue.forEach(function (e, k) {
      if (String(k).indexOf(BUILD + '|u|') === 0) writeQueue.delete(k);
    });
    return diskAll().then(function (rows) {
      var kill = rows.filter(function (r) { return String(r.k).indexOf(BUILD + '|u|') === 0; })
                     .map(function (r) { return r.k; });
      return kill.length ? diskDel(kill) : null;
    }).catch(function () {});
  }

  /* ── targeted invalidation ────────────────────────────────────────────── */

  /* Every one of these drops a named set and nothing else. There is
     deliberately no "clear the cache" in the mutation paths: a new comment on
     one artwork has no business emptying the gallery, the rankings and six
     section tabs, and a codebase that reaches for the big hammer once reaches
     for it everywhere.

     Each takes the ids it needs to be precise. `meta` on the artwork calls
     carries the category and tags — both the old and the new ones on an edit —
     because those decide which listings the piece appears in. */

  function invalidateArtwork(id, meta) {
    // Every artwork listing is derived from the same rows, and a piece added,
    // edited or removed can move any page of any of them. What is NOT here
    // matters as much: no section tab, no community, no other member's
    // profile, nothing private.
    var drop = ['gallery:', 'search:artwork', 'feed:'];
    if (id) drop.push('artwork:' + id, 'comments:art:' + id);
    if (meta && meta.userId) {
      drop.push('artist:artworks:' + meta.userId, 'profile:public:' + meta.userId);
    }
    if (!meta || meta.ranking !== false) drop.push('ranking:');
    return deleteByPrefix(drop);
  }

  // A private key is spelled 'user:<id>:...' by ukey(), so an invalidation of
  // one has to be spelled the same way or it drops nothing at all.
  function up(rest) { return 'user:' + uid() + ':' + rest; }

  /* A public profile is looked up by username — that is what the URL carries —
     but an edit knows the member id and not always the name it is stored
     under. Given the name, one record goes; given only an id, the whole public
     profile family goes, which is sixty records at the most and is the honest
     answer to "I do not know which one". */
  function invalidateProfile(id, username) {
    var drop = [];
    if (username) drop.push('profile:public:name:' + norm(username));
    else drop.push('profile:public:');
    if (id) drop.push('artist:artworks:' + id);
    if (id && String(id) === uid()) drop.push(up('profile'));
    return deleteByPrefix(drop);
  }

  function invalidateCommunity(channel) {
    return channel
      ? deleteByPrefix(up('community:' + channel))
      : deleteByPrefix([up('community:'), 'communities:']);
  }

  function invalidateSection(sec, id) {
    var drop = ['section:' + sec, 'search:' + sec];
    if (id) drop.push('section:item:' + sec + ':' + id);
    return deleteByPrefix(drop);
  }

  function invalidateComments(kind, id) {
    return deleteByPrefix('comments:' + kind + ':' + id);
  }
  function invalidateStats(id) {
    return deleteByPrefix('artwork:stats:' + id);
  }
  function invalidateRanking() {
    return deleteByPrefix('ranking:');
  }
  function invalidateSearch() {
    return deleteByPrefix('search:');
  }
  function invalidateFriends() {
    return deleteByPrefix([up('friends'), up('convos')]);
  }
  function invalidateThread(partnerId) {
    return deleteByPrefix(up('thread:' + (partnerId || '')));
  }
  function invalidateAnalytics() {
    return deleteByPrefix(up('analytics'));
  }
  function invalidateUserList(what) {
    return deleteByPrefix(up('list:' + (what || '')));
  }

  /* ── images, held by the service worker ───────────────────────────────── */

  /* Image objects are never overwritten — every upload path carries a
     timestamp, and a re-crop writes a new object and deletes the old one — so
     a cached image URL is immutable by construction and needs no expiry. What
     it does need is removal when the artwork behind it is deleted, which the
     page knows about and the worker does not. */
  function purgeImages(urls) {
    var list = (urls || []).filter(function (u) { return typeof u === 'string' && u; });
    if (!list.length || !navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'DZ_DROP_IMAGES', urls: list });
    } catch (e) {}
  }

  // Warm the sizes a grid is about to show. Public, predictable, and bounded —
  // the next page of thumbnails, not a whole collection.
  function warmImages(urls, limit) {
    var list = (urls || []).filter(function (u) { return typeof u === 'string' && u.indexOf('http') === 0; })
                           .slice(0, limit || 50);
    if (!list.length) return;
    var i = 0;
    function next() {
      if (i >= list.length) return;
      var u = list[i++];
      try { fetch(u, { mode: 'no-cors', credentials: 'omit' }).then(next, next); }
      catch (e) { next(); }
    }
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(next, { timeout: 4000 });
    else setTimeout(next, 2500);
  }

  /* ── key helpers ──────────────────────────────────────────────────────── */

  // Join parts into a key, dropping empties so an absent filter does not leave
  // a bare separator that reads as a different key from one call site to the
  // next.
  function key() {
    return [].slice.call(arguments)
      .filter(function (x) { return x !== null && x !== undefined && x !== ''; })
      .map(function (x) { return String(x).replace(/[|:\s]+/g, '_'); })
      .join(':');
  }

  // A query string as a key part. Case, surrounding space, repeated separators
  // and word order within the string are all normalised, so "  Dragon Art " and
  // "dragon art" are one record rather than two.
  function norm(q) {
    return String(q == null ? '' : q).toLowerCase().trim()
      .replace(/[\s_+]+/g, ' ')
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 80);
  }

  // Parameters as a key part, sorted by name so ?a=1&b=2 and ?b=2&a=1 are the
  // same record. Empty and null values are dropped rather than encoded, so
  // "no filter" is one key however the caller spells it.
  function params(obj) {
    if (!obj) return '';
    return Object.keys(obj).sort().map(function (n) {
      var v = obj[n];
      if (v === null || v === undefined || v === '' || v === 'all' || v === false) return null;
      return n + '=' + norm(Array.isArray(v) ? v.slice().sort().join(',') : v);
    }).filter(Boolean).join('&');
  }

  // 'user:...' keys are already partitioned by the owner stamp, but spelling
  // the id into the key as well means a record cannot even be looked up from
  // the wrong session, and a key read in a debugger says whose it is.
  function ukey() {
    return 'user:' + uid() + ':' + key.apply(null, arguments);
  }

  /* ── report ───────────────────────────────────────────────────────────── */

  function stats() {
    var reads = m.hit + m.stale + m.miss;
    var out = { memory: mem.size, reads: reads };
    for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out[k] = m[k];
    out.hit_ratio = reads ? Math.round(((m.hit + m.stale) / reads) * 100) + '%' : 'n/a';
    return out;
  }

  // What the service worker is holding. Asked over a MessagePort so the reply
  // comes back to this caller rather than to every tab.
  function workerStats() {
    return new Promise(function (resolve) {
      var ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!ctl || typeof MessageChannel !== 'function') { resolve(null); return; }
      var ch = new MessageChannel();
      var done = false;
      ch.port1.onmessage = function (ev) { done = true; resolve(ev.data || null); };
      setTimeout(function () { if (!done) resolve(null); }, 1500);
      try { ctl.postMessage({ type: 'DZ_CACHE_STATS' }, [ch.port2]); }
      catch (e) { resolve(null); }
    });
  }

  function report() {
    return Promise.all([diskAll(), workerStats()]).then(function (both) {
      var rows = both[0], sw = both[1];
      var s = stats();
      s.disk = rows.length;
      try {
        console.log('%cdigiartz cache', 'font-weight:bold');
        console.table([s]);
        var byPolicy = {};
        rows.forEach(function (r) {
          var n = r.p || 'unknown';
          byPolicy[n] = (byPolicy[n] || 0) + 1;
        });
        console.log('data, by policy');
        console.table(byPolicy);
        if (sw) { console.log('files, held by the service worker'); console.table([sw]); }
        else console.log('no service worker holding files in this tab');
      } catch (e) {}
      s.worker = sw;
      return s;
    });
  }

  /* ── start up ─────────────────────────────────────────────────────────── */

  function boot() {
    dropLegacy();
    sweep(false);
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(boot, { timeout: 5000 });
  else setTimeout(boot, 2000);

  // A pending batch must not be lost to a tab being closed or backgrounded —
  // on a phone, backgrounded often means never resumed.
  window.addEventListener('pagehide', function () { flushWrites(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushWrites();
  });

  window.dzCache = {
    // core
    get: get,
    set: set,
    peek: peek,
    recall: recall,
    delete: del,
    deleteByPrefix: deleteByPrefix,
    getOrSet: getOrSet,
    warm: warm,
    flush: flushWrites,

    // keys
    key: key,
    ukey: ukey,
    norm: norm,
    params: params,
    uid: uid,

    // invalidation
    invalidateArtwork: invalidateArtwork,
    invalidateProfile: invalidateProfile,
    invalidateCommunity: invalidateCommunity,
    invalidateSection: invalidateSection,
    invalidateComments: invalidateComments,
    invalidateStats: invalidateStats,
    invalidateRanking: invalidateRanking,
    invalidateSearch: invalidateSearch,
    invalidateFriends: invalidateFriends,
    invalidateThread: invalidateThread,
    invalidateAnalytics: invalidateAnalytics,
    invalidateUserList: invalidateUserList,
    dropPrivate: dropPrivate,
    sweep: sweep,

    // images, via the worker
    purgeImages: purgeImages,
    warmImages: warmImages,

    // observability
    stats: stats,
    report: report,
    policies: POLICY,
    build: BUILD
  };
})();
