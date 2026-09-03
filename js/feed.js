  var FEED_CAP = 200;
  var feedTab  = 'trending';

  function feedIsArtists(){ return feedTab === 'artists'; }
  function feedIsFollowing(){ return feedTab === 'following'; }

  function feedFollowApi(){ return window.dzFollow || null; }

  // The whole approved gallery is already in memory, so "artwork from artists I
  // follow" is a filter over it rather than another query. Newest first: the
  // point of the tab is what has landed since the reader was last here.
  function feedFollowingOf(list){
    var f = feedFollowApi();
    if(!f || !f.ready()) return [];
    var mine = {};
    f.ids().forEach(function(id){ mine[String(id)] = 1; });
    return sortByNewest((list || []).filter(function(a){
      return a && a.user_id && mine[String(a.user_id)];
    }));
  }

  function feedSort(list){
    if(feedTab === 'new')     return sortByNewest(list);
    if(feedTab === 'weekly')  return sortByWeekly(list);
    if(feedTab === 'monthly') return sortByMonthly(list);
    return sortByTrending(list);
  }

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

  function feedFetchArtists(ids, done){
    var missing = ids.filter(function(u){ return dzArtistCache[u] === undefined; });
    if(!missing.length || !sb){ done(); return; }
    sb.from('profiles').select('id,username,display_name,avatar_url,banner_url,bio').in('id', missing)
      .then(function(res){
        ((res && res.data) || []).forEach(function(p){ if(p && p.id) dzArtistCache[p.id] = p; });
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

  function feedPaintAvatar(av, ltr, p, name){
    if(!av) return;
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

  function paintArtistCard(card, p){
    var name = (p && (p.display_name || p.username)) || 'Artist';
    var user = p && p.username ? String(p.username) : '';
    var av   = card.querySelector('.atAv');
    var ltr  = card.querySelector('.atLtr');
    var nm   = card.querySelector('.atName');
    var un   = card.querySelector('.atUser');

    if(nm) nm.textContent = name;
    if(un) un.textContent = user ? '@' + user : '';

    var bg = card.querySelector('.atBg');
    if(bg && p && p.banner_url){
      bg.style.backgroundImage = 'url("' + imgResize(p.banner_url, 600) + '")';
      card.classList.add('atHasBg');
    }
    feedPaintAvatar(av, ltr, p, name);

    card.classList.add('atReady');
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
      card.classList.add('atDead');
    }
  }

  function paintPeopleBatch(uids){
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
    if(feedTab === 'artists') return 'NO ARTISTS YET';
    if(feedIsFollowing()){
      var signedIn = (typeof currentUser !== 'undefined' && currentUser);
      if(!signedIn) return 'SIGN IN TO FOLLOW ARTISTS';
      var f = feedFollowApi();
      if(f && f.ready() && !f.count()) return 'FOLLOW ARTISTS TO FILL THIS FEED';
      return 'NOTHING NEW FROM THE ARTISTS YOU FOLLOW';
    }
    return 'NO ARTWORK YET';
  }

  function renderAwGrid(list, reset){
    var grid  = document.getElementById('awGrid');
    var empty = document.getElementById('awEmpty');
    if(!grid) return;

    var src = filterHidden((list || []).slice());
    if(feedIsArtists()){
      awRList = feedArtistsOf(src);
    } else if(feedIsFollowing()){
      awRList = feedFollowingOf(src).slice(0, FEED_CAP);
    } else {
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
      var item = awRList[i], uid = null;
      if(artists){ frag.appendChild(buildArtistCard(item)); uid = item; }
      else frag.appendChild(buildAwCard(item, i < 4));
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

  window.rebuildGalCarousels = function(artworks){
    awArtworksCache = artworks || [];
    renderAwGrid(awArtworksCache);
  };

  window.rebuildGalCarousels(typeof images !== 'undefined' ? images : []);

  function ftSelect(id){
    if(!id || id === feedTab) return;
    var rail = document.getElementById('ftRail');
    if(!rail) return;
    if(typeof window.hsReset === 'function') window.hsReset();
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
    if(id === 'following' && feedFollowApi() && !feedFollowApi().ready()){
      feedFollowApi().load().then(feedFollowRepaint, function(){});
    }
    var grid = document.getElementById('awGrid');
    if(grid) grid.setAttribute('aria-labelledby', picked.id);
    ftReveal(picked);
    renderAwGrid(awArtworksCache, true);
    if(grid){
      grid.classList.remove('awSwap');
      void grid.offsetWidth;
      grid.classList.add('awSwap');
    }
  }

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

  // Following is the one tab whose contents can change without the gallery
  // changing: a follow taken anywhere on the site belongs in it straight away.
  function feedFollowRepaint(){
    if(!feedIsFollowing()) return;
    renderAwGrid(awArtworksCache, true);
  }
  document.addEventListener('dz:follow', feedFollowRepaint);

  window.ftSelect = ftSelect;
