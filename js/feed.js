// hero feed boards
  // The rail under the hero stands where the search bar used to. Every board
  // reads the same set of approved artworks and only reorders it, so nothing
  // here fetches: switching boards is instant and costs no request.
  //
  //   trending  hour by hour, the gallery's own order
  //   new       newest upload first
  //   weekly    points, fading a step each whole week
  //   monthly   points, halving each whole month
  //   artists   the trending order read back as the people behind it
  //   logs      next step
  //
  // These live on the hero page only. The gallery keeps its own filters.
  var FEED_CAP = 200;
  var feedTab  = 'trending';

  function feedIsArtists(){ return feedTab === 'artists'; }

  // The board an id names, or trending for anything unrecognised.
  function feedSort(list){
    if(feedTab === 'new')     return sortByNewest(list);
    if(feedTab === 'weekly')  return sortByWeekly(list);
    if(feedTab === 'monthly') return sortByMonthly(list);
    return sortByTrending(list);
  }

  // One card per artist, in the order their work appears on the trending
  // board — the first card is whoever made the first thumbnail, the second
  // the next artist after them. A run of uploads by one person takes one
  // slot, not the whole row.
  function feedArtistsOf(list){
    var out = [], seen = {};
    var src = sortByTrending((list || []).slice());
    for(var i = 0; i < src.length && out.length < FEED_CAP; i++){
      var uid = src[i] && src[i].user_id;
      if(!uid || seen[uid]) continue;
      seen[uid] = 1;
      out.push(String(uid));
    }
    return out;
  }

  // dzArtistCache is the same store the hover chips fill, so a profile
  // fetched for one is already paid for by the other.
  function feedFetchArtists(ids, done){
    var missing = ids.filter(function(u){ return dzArtistCache[u] === undefined; });
    if(!missing.length || !sb){ done(); return; }
    sb.from('profiles').select('id,username,display_name,avatar_url,banner_url,bio').in('id', missing)
      .then(function(res){
        ((res && res.data) || []).forEach(function(p){ if(p && p.id) dzArtistCache[p.id] = p; });
        // a profile that came back empty is cached as missing, not retried
        missing.forEach(function(u){ if(dzArtistCache[u] === undefined) dzArtistCache[u] = null; });
        done();
      }, function(){ done(); });
  }

  function buildArtistCard(uid){
    var card = document.createElement('div');
    card.className = 'awCard atCard';
    card.setAttribute('data-uid', String(uid));

    var body = document.createElement('div');
    body.className = 'atBody';
    body.innerHTML =
      '<span class="atBg" aria-hidden="true"></span>' +
      '<span class="atAv"><span class="atLtr" aria-hidden="true"></span></span>' +
      '<span class="atName"></span>' +
      '<span class="atUser"></span>' +
      '<span class="atGo">View profile</span>';
    card.appendChild(body);

    var p = dzArtistCache[uid];
    if(p !== undefined) paintArtistCard(card, p);
    return card;
  }

  function paintArtistCard(card, p){
    var name = (p && (p.display_name || p.username)) || 'Artist';
    var user = p && p.username ? String(p.username) : '';
    var av   = card.querySelector('.atAv');
    var ltr  = card.querySelector('.atLtr');
    var nm   = card.querySelector('.atName');
    var un   = card.querySelector('.atUser');

    if(nm) nm.textContent = name;
    if(un) un.textContent = user ? '@' + user : '';

    // The banner sits behind the card. It is drawn for a desktop-wide strip,
    // so the card takes the square out of the middle of it and holds it at
    // 60% — a tint of the artist's own page, not a picture competing with
    // their name.
    //
    // Asked for at 600, which is the generated webp size this needs: only
    // the middle third of a banner survives the square crop, so a ~200px
    // card is fed by a ~600px wide source. imgResize hands back the nearest
    // size that exists, so this is t600 once the backfill has run and
    // v1000 until then — never the full-size file.
    var bg = card.querySelector('.atBg');
    if(bg && p && p.banner_url){
      bg.style.backgroundImage = 'url("' + imgResize(p.banner_url, 600) + '")';
      card.classList.add('atHasBg');
    }
    if(av){
      if(p && p.avatar_url){
        var im = av.querySelector('img');
        if(!im){
          im = document.createElement('img');
          im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
          im.draggable = false;
          av.appendChild(im);
        }
        im.src = getThumbnailUrl(p.avatar_url);
        if(ltr) ltr.style.display = 'none';
      } else if(ltr){
        ltr.textContent = name.charAt(0).toUpperCase();
        ltr.style.display = '';
      }
    }

    card.classList.add('atReady');
    // the whole card opens the profile, so the label needs no handler of its own
    if(user){
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', 'View profile of ' + name);
      card.onclick = function(){ openProfileByUsername(user, true); };
      card.onkeydown = function(e){
        if(e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openProfileByUsername(user, true);
      };
    } else {
      // no username to route to — the card stays as a face, not a link
      card.classList.add('atDead');
    }
  }

  // The banner over the scored boards: whoever holds first place on the one
  // being read. It is the top artwork promoted out of the grid rather than
  // repeated above it — the piece that won the board is the picture on it,
  // and showing it twice, one directly above the other, reads as a bug.
  // Two cells wide and one tall, and since the narrowest grid is two across
  // it is a full row on a phone and half a row on a desktop.
  var FEATURED_BOARDS = { trending:1, weekly:1, monthly:1 };

  // The banner's own picture width, at each of the grid's column counts and
  // scaled for the screen's pixel ratio the way dzGridSizes does. The picture
  // is the whole card now rather than the right 60% of it, so these are two
  // grid cells and the gap between them: a full row on a phone, two of three
  // on a tablet, two of four on a desktop.
  function fbSizes(){
    var s = typeof dzDprScale === 'function' ? dzDprScale() : 1;
    var f = function(vw){ return +(vw * s).toFixed(2); };
    return '(min-width:1280px) ' + f(40) + 'vw, (min-width:700px) ' + f(56) + 'vw, ' + f(94) + 'vw';
  }

  // the board's own word, for the bright chip on the banner
  var FB_WORD = { trending:'Trending', weekly:'Weekly', monthly:'Monthly' };

  /* The banner is the gallery showcase's card — the same 2:1 picture with the
     same scrim, chips, type and button over it — so it is built by the same
     function, in js/fgshow.js, rather than drawn a second time here.

     It carries no likes and no views. That is the one difference, and it is
     deliberate: this card sits directly above the board it leads, and that
     board is a ranking of exactly those numbers. Printing the top row's two
     counts again at four times the size says nothing the row underneath it
     does not already say. */
  function buildFeatured(a){
    if(typeof window.dzFeatureCard !== 'function') return null;
    var box = window.dzFeatureCard({
      art:   a,
      extra: 'fbBox',
      uid:   String(a.user_id || ''),
      kind:  'Featured Artist',
      ico:   'star',
      board: feedTab,
      word:  FB_WORD[feedTab] || '',
      eager: true,
      sizes: fbSizes()
    });
    if(!box) return null;

    /* The one thing the banner keeps that the showcase card has no use for:
       the whole card opens the artwork, not only its button. The board under
       it is a grid of thumbnails that every one of them opens on a tap, and
       this is the first of them promoted out of that grid — a hand reaching
       for the biggest picture on the page and getting nothing would be the
       banner taking a tap target away by being promoted.

       The button keeps its own handler and is skipped here, or one press
       would open the viewer twice. It is also what a keyboard reaches, so
       this stays a pointer's shortcut rather than a second tab stop over
       the same action. */
    box.style.cursor = 'pointer';
    box.addEventListener('click', function(e){
      var t = e.target;
      if(t && t.closest && t.closest('.fgsGo')) return;
      if(typeof openLB !== 'function') return;
      openLB(a.image_url || '', a.name || 'Untitled',
             catList(a.category)[0] || 'others', a.description || '', a.id);
    });

    var p = dzArtistCache[a.user_id];
    if(p !== undefined) paintFeatured(box, p);
    return box;
  }

  // Who made it — the same byline the showcase card carries, and the same
  // wait for it: the row is in the card from the start, so nothing below it
  // moves when the profile lands.
  function paintFeatured(box, p){
    var name = (p && (p.display_name || p.username)) || 'Artist';
    var by = box.querySelector('.fgsBy');
    if(by) by.textContent = 'by ' + name;
    box.classList.add('fbReady');
  }

  /* A card's crop is cut to the card's shape, and the banner changes shape
     with the window — two cells of a two-column grid on a phone is a wider
     box than two cells of a four-column one. The showcase re-cuts its own on
     resize; this is the banner's. */
  (function(){
    var t = null;
    window.addEventListener('resize', function(){
      clearTimeout(t);
      t = setTimeout(function(){
        if(typeof window.dzFeatureFrame !== 'function') return;
        var img = document.querySelector('#awGrid .fbBox .fgsMedia img');
        if(img) window.dzFeatureFrame(img);
      }, 140);
    }, { passive:true });
  })();

  // Fill in whatever the batch just appended is still missing. Both the
  // artist cards and the log lines are keyed on the same uid, so one fetch
  // paints whichever of them the batch put on screen.
  function paintPeopleBatch(uids){
    feedFetchArtists(uids, function(){
      var grid = document.getElementById('awGrid');
      if(!grid) return;
      uids.forEach(function(uid){
        var sel = (window.CSS && CSS.escape) ? CSS.escape(uid) : String(uid).replace(/["\\]/g, '\\$&');
        var card = grid.querySelector('.atCard[data-uid="' + sel + '"]');
        if(card && !card.classList.contains('atReady')) paintArtistCard(card, dzArtistCache[uid]);
        var box = grid.querySelector('.fbBox[data-uid="' + sel + '"]:not(.fbReady)');
        if(box) paintFeatured(box, dzArtistCache[uid]);
        var lines = grid.querySelectorAll('.lgRow[data-uid="' + sel + '"]:not(.lgReady)');
        for(var i = 0; i < lines.length; i++) paintLogRow(lines[i], dzArtistCache[uid]);
      });
    });
  }

  // Logs — who uploaded what, newest first, across everything a member can
  // publish. Capped at 200 like the rest, and since that 200 is the newest
  // of everything, each line is inside its own section's newest 200 too:
  // whatever the log shows can always be opened where it lives.
  var LOG_KINDS = {
    artworks:    { noun:'an artwork',          tag:'Artwork'     },
    marketplace: { noun:'a marketplace item',  tag:'Marketplace', table:'marketplace_items' },
    blog:        { noun:'a blog post',         tag:'Blog',        table:'blog_posts' },
    resources:   { noun:'a resource',          tag:'Resource',    table:'resources' }
  };
  var logRows = null, logBusy = false, logFailed = false;

  function logCats(v){
    if(Array.isArray(v)) return v;
    return v ? [v] : [];
  }

  function logLoad(){
    if(logBusy) return;
    logBusy = true;
    logFailed = false;

    var out = [];
    // the artworks are already in hand from the home load
    (typeof images !== 'undefined' ? images : []).forEach(function(a){
      out.push({ kind:'artworks', id:a.id, user_id:a.user_id,
                 title:a.name, cats:catList(a.category), at:a.created_at });
    });

    var secs = ['marketplace','blog','resources'];
    var left = secs.length;
    function settle(){
      if(--left > 0) return;
      logBusy = false;
      logRows = out.sort(function(x, y){
        var tX = x.at ? new Date(x.at).getTime() : 0;
        var tY = y.at ? new Date(y.at).getTime() : 0;
        if(tY !== tX) return tY - tX;
        return String(x.id) < String(y.id) ? 1 : -1;
      }).slice(0, FEED_CAP);
      // the reader may have moved on while this was in the air
      if(feedTab === 'logs') renderAwGrid(awArtworksCache, true);
    }
    if(!sb){ logFailed = true; left = 1; settle(); return; }

    secs.forEach(function(sec){
      // only the columns a line needs — the full row is fetched by the
      // section itself if the reader opens one
      sb.from(LOG_KINDS[sec].table).select('id,user_id,title,category,created_at')
        .eq('status','approved').order('created_at',{ascending:false}).limit(FEED_CAP)
        .then(function(res){
          ((res && res.data) || []).forEach(function(r){
            out.push({ kind:sec, id:r.id, user_id:r.user_id, title:r.title,
                       cats:logCats(r.category), at:r.created_at });
          });
          settle();
        }, function(){ logFailed = true; settle(); });
    });
  }

  function logDate(ts){
    var d = ts ? new Date(ts) : null;
    if(!d || isNaN(d.getTime())) return '';
    try{ return d.toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' }); }
    catch(e){ return d.toISOString().slice(0, 10); }
  }
  function logCatLabel(e){
    var slug = e.cats && e.cats[0];
    if(!slug) return '';
    // the tag rail used to own this lookup; the log is the last caller left
    if(e.kind === 'artworks') return typeof catLabel === 'function' ? catLabel(slug) : slug;
    return typeof window.dzSecLabel === 'function' ? window.dzSecLabel(e.kind, slug) : slug;
  }

  // An artwork opens in the lightbox. The other three live in the gallery,
  // so the section is opened first and the row's own view follows once that
  // section's rows have landed.
  function logOpen(e){
    if(e.kind === 'artworks'){
      if(typeof openArtworkById === 'function') openArtworkById(e.id, true);
      return;
    }
    if(typeof qlGo === 'function') qlGo(e.kind);
    var tries = 0;
    (function wait(){
      var rows = (typeof window.dzGetRows === 'function' ? window.dzGetRows(e.kind) : []) || [];
      for(var i = 0; i < rows.length; i++){
        if(String(rows[i].id) === String(e.id)){ window.dzOpenView(e.kind, e.id); return; }
      }
      if(++tries > 40) return;   // the section is open either way
      setTimeout(wait, 120);
    })();
  }

  function buildLogRow(e){
    var kind = LOG_KINDS[e.kind] || LOG_KINDS.artworks;
    var row = document.createElement('div');
    row.className = 'lgRow lgRow--' + e.kind;
    row.setAttribute('data-uid', String(e.user_id || ''));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    var cat = logCatLabel(e);
    row.innerHTML =
      '<span class="lgAv"><span class="lgLtr" aria-hidden="true"></span></span>' +
      '<span class="lgBody">' +
        '<span class="lgLine"><span class="lgUser"></span>' +
          '<span class="lgAct"> uploaded ' + esc(kind.noun) + ' on ' + esc(logDate(e.at)) + '</span></span>' +
        '<span class="lgName">' + esc(e.title || 'Untitled') + '</span>' +
        '<span class="lgMeta"><span class="lgTag">' + esc(kind.tag) + '</span>' +
          (cat ? '<span class="lgCat">' + esc(cat) + '</span>' : '') + '</span>' +
      '</span>';

    row.setAttribute('aria-label', 'Open ' + (e.title || 'this upload'));
    // the chips are labels, not controls — a tap on one names the kind and
    // the category and does nothing else, so it does not open the upload
    row.onclick = function(ev){
      if(ev.target && ev.target.closest && ev.target.closest('.lgMeta')) return;
      logOpen(e);
    };
    row.onkeydown = function(ev){
      if(ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      logOpen(e);
    };

    var p = dzArtistCache[e.user_id];
    if(p !== undefined) paintLogRow(row, p);
    return row;
  }

  function paintLogRow(row, p){
    var name = (p && (p.display_name || p.username)) || 'An artist';
    var av   = row.querySelector('.lgAv');
    var ltr  = row.querySelector('.lgLtr');
    var user = row.querySelector('.lgUser');

    if(user) user.textContent = p && p.username ? '@' + p.username : name;
    if(av){
      if(p && p.avatar_url){
        var im = av.querySelector('img');
        if(!im){
          im = document.createElement('img');
          im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
          im.draggable = false;
          av.appendChild(im);
        }
        im.src = getThumbnailUrl(p.avatar_url);
        if(ltr) ltr.style.display = 'none';
      } else if(ltr){
        ltr.textContent = name.charAt(0).toUpperCase();
        ltr.style.display = '';
      }
    }
    row.classList.add('lgReady');
  }

  function feedEmptyText(){
    if(feedTab === 'logs'){
      if(logBusy)   return 'LOADING LOGS\u2026';
      if(logFailed) return 'COULD NOT LOAD LOGS \u2014 TRY AGAIN';
      return 'NOTHING UPLOADED YET';
    }
    if(feedTab === 'artists') return 'NO ARTISTS YET';
    return 'NO ARTWORK YET';
  }

  // reset drops the reader back to the top of a board; without it the grid
  // comes back at the depth it was left at, which is what a refresh wants
  function renderAwGrid(list, reset){
    var grid  = document.getElementById('awGrid');
    var empty = document.getElementById('awEmpty');
    if(!grid) return;

    var src = filterHidden((list || []).slice());
    if(feedTab === 'logs'){
      // one load per session, on the first visit to the board
      if(logRows === null && !logBusy) logLoad();
      // hidden artworks are hidden here too; the ids only ever match those
      awRList = filterHidden(logRows || []);
    } else if(feedIsArtists()){
      awRList = feedArtistsOf(src);
    } else {
      awRList = feedSort(src).slice(0, FEED_CAP);
    }
    grid.classList.toggle('awGrid--logs', feedTab === 'logs');

    // first place comes out of the list and goes up as the banner
    var featured = null;
    if(FEATURED_BOARDS[feedTab] && awRList.length){
      featured = awRList[0];
      awRList = awRList.slice(1);
    }

    var keep = reset ? 0 : awRShown;
    awRShown = 0;
    if(awSent){ awSent.destroy(); awSent = null; }
    grid.innerHTML = '';

    if(!awRList.length && !featured){
      if(empty){
        empty.textContent = feedEmptyText();
        empty.style.display = 'block';
      }
      return;
    }
    if(empty) empty.style.display = 'none';

    if(featured){
      // built by js/fgshow.js; nothing to promote if that has not loaded
      var fbEl = buildFeatured(featured);
      if(fbEl){
        grid.appendChild(fbEl);
        if(featured.user_id && dzArtistCache[featured.user_id] === undefined){
          paintPeopleBatch([featured.user_id]);
        }
      } else {
        awRList.unshift(featured);
      }
    }

    awAppendBatch(Math.max(gridInitialBatch(), keep));
    if(awRShown < awRList.length){
      awSent = makeGridSentinel(null, function(){ awAppendBatch(); });
      grid.appendChild(awSent.el);
    }
  }

  function awAppendBatch(count){
    var grid = document.getElementById('awGrid');
    if(!grid || awRShown >= awRList.length) return;
    var size = count || gridStepBatch();
    var end  = Math.min(awRShown + size, awRList.length);
    var artists = feedIsArtists(), logs = feedTab === 'logs';
    var frag = document.createDocumentFragment();
    var wanted = [];
    for(var i = awRShown; i < end; i++){
      var item = awRList[i], uid = null;
      if(artists){ frag.appendChild(buildArtistCard(item)); uid = item; }
      else if(logs){ frag.appendChild(buildLogRow(item)); uid = item.user_id; }
      else frag.appendChild(buildAwCard(item));
      // one fetch per batch, not per card, and never for a face already held
      if(uid && dzArtistCache[uid] === undefined && wanted.indexOf(uid) === -1) wanted.push(uid);
    }
    awRShown = end;
    if(awSent && awSent.el.parentNode === grid) grid.insertBefore(frag, awSent.el);
    else grid.appendChild(frag);
    if(wanted.length) paintPeopleBatch(wanted);
    if(awRShown >= awRList.length){
      if(awSent){ awSent.destroy(); awSent = null; }
    } else if(awSent){
      awSent.recheck();
    }
  }

  // home feed
  window.rebuildGalCarousels = function(artworks){
    awArtworksCache = artworks || [];
    renderAwGrid(awArtworksCache);
  };

  // First paint. renderHome only calls through if this file has already run,
  // so on the rare load where the artworks arrive first — every script warm
  // in the cache, a quick answer from the backend — it hands over what it
  // found rather than clearing the grid and waiting for a render that has
  // already been and gone.
  window.rebuildGalCarousels(typeof images !== 'undefined' ? images : []);

  // rail
  function ftSelect(id){
    if(!id || id === feedTab) return;
    var rail = document.getElementById('ftRail');
    if(!rail) return;
    var tabs = rail.querySelectorAll('.ftTab');
    var picked = null;
    for(var i = 0; i < tabs.length; i++){
      var on = tabs[i].getAttribute('data-feed') === id;
      tabs[i].classList.toggle('on', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
      if(on) picked = tabs[i];
    }
    if(!picked) return;
    feedTab = id;
    var grid = document.getElementById('awGrid');
    if(grid) grid.setAttribute('aria-labelledby', picked.id);
    ftReveal(picked);
    renderAwGrid(awArtworksCache, true);
    // the swap is a cut otherwise: one board's grid replaced by another's
    // between two frames. Restarted by hand because re-adding a class the
    // element already carries does not replay the animation.
    if(grid){
      grid.classList.remove('awSwap');
      void grid.offsetWidth;
      grid.classList.add('awSwap');
    }
  }

  // A board picked at the far end of the rail pulls itself into the middle,
  // so the one either side of it is reachable without a second swipe.
  function ftReveal(btn){
    var rail = document.getElementById('ftRail');
    if(!rail || !btn) return;
    var to = btn.offsetLeft - (rail.clientWidth - btn.offsetWidth) / 2;
    to = Math.max(0, Math.min(to, rail.scrollWidth - rail.clientWidth));
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(rail.scrollTo) rail.scrollTo({ left: to, behavior: still ? 'auto' : 'smooth' });
    else rail.scrollLeft = to;
  }

  (function(){
    var rail = document.getElementById('ftRail');
    if(!rail) return;
    rail.addEventListener('click', function(e){
      var btn = e.target.closest ? e.target.closest('.ftTab') : null;
      if(btn) ftSelect(btn.getAttribute('data-feed'));
    });
    // arrow keys walk the rail, the way a tablist is expected to
    rail.addEventListener('keydown', function(e){
      var step = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
      if(!step) return;
      var tabs = Array.prototype.slice.call(rail.querySelectorAll('.ftTab'));
      var at = tabs.indexOf(document.activeElement);
      if(at < 0) return;
      e.preventDefault();
      var next = tabs[(at + step + tabs.length) % tabs.length];
      next.focus();
      ftSelect(next.getAttribute('data-feed'));
    });
    var tabs = rail.querySelectorAll('.ftTab');
    for(var i = 0; i < tabs.length; i++){
      tabs[i].tabIndex = tabs[i].classList.contains('on') ? 0 : -1;
    }
  })();

  window.ftSelect = ftSelect;
