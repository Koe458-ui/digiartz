// feed search
  // feed search
  var awQ = '', awQTimer = null, fgQTimer = null;

  var awArtists = null, awArtistsBusy = false;
  function awLoadArtists(){
    if(awArtists || awArtistsBusy || !sb) return;
    awArtistsBusy = true;
    sb.from('profiles').select('id,username').then(function(res){
      var map = {}, rows = (res && res.data) || [];
      for(var i = 0; i < rows.length; i++){
        if(rows[i] && rows[i].id) map[rows[i].id] = String(rows[i].username || '').toLowerCase();
      }
      awArtists = map; awArtistsBusy = false;
      if(awQ) awSearchRender();
    }, function(){ awArtists = {}; awArtistsBusy = false; });
  }

  function awSearchFilter(list){
    if(!awQ || !Array.isArray(list)) return list;
    var q = awQ, out = [];
    for(var i = 0; i < list.length; i++){
      var a = list[i], hit = false, j;
      if(String(a.name || '').toLowerCase().indexOf(q) !== -1) hit = true;
      if(!hit && String(a.description || '').toLowerCase().indexOf(q) !== -1) hit = true;
      if(!hit && Array.isArray(a.tags)){
        for(j = 0; j < a.tags.length; j++){
          if(String(a.tags[j]).toLowerCase().indexOf(q) !== -1){ hit = true; break; }
        }
      }
      if(!hit){
        var cats = catList(a.category);
        for(j = 0; j < cats.length; j++){
          if(String(cats[j]).toLowerCase().indexOf(q) !== -1 ||
             String(tgLabel(cats[j])).toLowerCase().indexOf(q) !== -1){ hit = true; break; }
        }
      }
      if(!hit && awArtists && a.user_id){
        var u = awArtists[a.user_id];
        if(u && u.indexOf(q) !== -1) hit = true;
      }
      if(hit) out.push(a);
    }
    return out;
  }

  function awSearchRender(){
    try{
      if(typeof awArtworksCache !== 'undefined') renderAwGrid(awArtworksCache);
    }catch(e){}
  }
  function awSearchChrome(wrapId, v){
    var w = document.getElementById(wrapId);
    if(w) w.classList.toggle('tgHasQ', !!String(v || '').length);
  }
  function awSearchInput(v){
    awSearchChrome('awSearchInWrap', v);
    awLoadArtists();
    clearTimeout(awQTimer);
    awQTimer = setTimeout(function(){
      var next = String(v || '').trim().toLowerCase();
      if(next === awQ) return;
      awQ = next;
      awSearchRender();
    }, 140);
  }
  function awSearchClear(){
    var el = document.getElementById('awSearchIn');
    if(el){ el.value = ''; el.focus(); }
    awSearchInput('');
  }
  function fgSearchInput(v){
    awSearchChrome('fgSearchInWrap', v);
    clearTimeout(fgQTimer);
    fgQTimer = setTimeout(function(){
      if(typeof renderFG === 'function') renderFG();
    }, 140);
  }
  function fgSearchClear(){
    var el = document.getElementById('fgSearchIn');
    if(el){ el.value = ''; el.focus(); }
    fgSearchInput('');
  }

  function renderAwGrid(list){
    var grid  = document.getElementById('awGrid');
    var empty = document.getElementById('awEmpty');
    if(!grid) return;

    // trending order, hidden dropped
    // keep active query
    var src = awSearchFilter(filterHidden((list||[]).slice()));
    awRList = tgPrioritize(sortByTrending(src));
    // keep scroll depth
    var keep = awRShown;
    awRShown = 0;
    if(awSent){ awSent.destroy(); awSent = null; }
    grid.innerHTML = '';

    if(!awRList.length){
      if(empty){
        empty.textContent = awQ
          ? ('NO MATCHES FOR \u201C' + awQ.toUpperCase() + '\u201D')
          : 'NO ARTWORK YET';
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
    var frag = document.createDocumentFragment();
    for(var i = awRShown; i < end; i++) frag.appendChild(buildAwCard(awRList[i]));
    awRShown = end;
    if(awSent && awSent.el.parentNode === grid) grid.insertBefore(frag, awSent.el);
    else grid.appendChild(frag);
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

  window.rebuildGalCarousels([]);


  function openSubscription() {
    closeMenu();
    var el = document.getElementById('subPage');
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if(typeof zeoSectionTrigger==='function') zeoSectionTrigger();
  }

  function closeSubscription() {
    var el = document.getElementById('subPage');
    if (!el) return;
    el.classList.remove('open');
    restoreScroll();
  }

  function openSubModal() {
    var m = document.getElementById('subModal');
    if (!m) return;
    m.classList.add('subModal--open');
    var btn = m.querySelector('.subModalClose');
    if (btn) setTimeout(function(){ btn.focus(); }, 40);
  }

  function closeSubModal() {
    var m = document.getElementById('subModal');
    if (!m) return;
    m.classList.remove('subModal--open');
  }

  function handleSubModalBackdrop(e) {
    if (e.target === document.getElementById('subModal')) closeSubModal();
  }
