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

  // artist board state: ids in feed order, and the batch each render fetched
  var feedArtistIds = [];

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
    sb.from('profiles').select('id,username,display_name,avatar_url,banner_url').in('id', missing)
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

  // Fill in whatever the batch just appended is still missing.
  function paintArtistBatch(uids){
    feedFetchArtists(uids, function(){
      var grid = document.getElementById('awGrid');
      if(!grid) return;
      uids.forEach(function(uid){
        var sel = (window.CSS && CSS.escape) ? CSS.escape(uid) : String(uid).replace(/["\\]/g, '\\$&');
        var card = grid.querySelector('.atCard[data-uid="' + sel + '"]');
        if(card && !card.classList.contains('atReady')) paintArtistCard(card, dzArtistCache[uid]);
      });
    });
  }

  function feedEmptyText(){
    if(feedTab === 'logs')    return 'LOGS ARE COMING SOON';
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
      feedArtistIds = [];
      awRList = [];
    } else if(feedIsArtists()){
      feedArtistIds = feedArtistsOf(src);
      awRList = feedArtistIds;
    } else {
      feedArtistIds = [];
      awRList = feedSort(src).slice(0, FEED_CAP);
    }

    var keep = reset ? 0 : awRShown;
    awRShown = 0;
    if(awSent){ awSent.destroy(); awSent = null; }
    grid.innerHTML = '';

    if(!awRList.length){
      if(empty){
        empty.textContent = feedEmptyText();
        empty.style.display = 'block';
      }
      return;
    }
    if(empty) empty.style.display = 'none';

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
    var artists = feedIsArtists();
    var frag = document.createDocumentFragment();
    var wanted = [];
    for(var i = awRShown; i < end; i++){
      if(artists){
        frag.appendChild(buildArtistCard(awRList[i]));
        if(dzArtistCache[awRList[i]] === undefined) wanted.push(awRList[i]);
      } else {
        frag.appendChild(buildAwCard(awRList[i]));
      }
    }
    awRShown = end;
    if(awSent && awSent.el.parentNode === grid) grid.insertBefore(frag, awSent.el);
    else grid.appendChild(frag);
    if(wanted.length) paintArtistBatch(wanted);
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
