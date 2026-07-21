/* ── search.js · feed search ── */
  /* ═══════════════════════════════════════════════════════════════
     FEED SEARCH (aw / fg)
     The bar above the chip rows is a real input, not a button: it
     filters the grid below as you type, so there is no results screen
     to open and no way to get stranded on one.

     Two bars, two grids, one behaviour:
       #awSearchIn  → the home feed  (#awGrid, via renderAwGrid)
       #fgSearchIn  → the gallery    (renderFG reads this field
                      directly; the old #fgQ row is gone)
     ═══════════════════════════════════════════════════════════════ */
  var awQ = '', awQTimer = null, fgQTimer = null;

  /* user_id → username, fetched once on the first keystroke and kept
     for the session. Artwork rows come back as select('*') on
     `artworks`, which carries user_id but no username, and joining a
     profile onto every feed query to serve a search box nobody may
     open would be the wrong trade. Failure is not fatal: search keeps
     matching everything else and artists simply aren't part of it. */
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
      /* Landed mid-query — redo the match now artists are searchable. */
      if(awQ) awSearchRender();
    }, function(){ awArtists = {}; awArtistsBusy = false; });
  }

  /* Matches the fields a row actually has: title, description, its own
     tags, and its categories by slug AND by label, so typing "3D"
     finds pieces stored under the "3d-art" slug. */
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
      if(typeof awTab !== 'undefined' && typeof awListForTab === 'function'){
        renderAwGrid(awListForTab(awTab), awTab);
      }
    }catch(e){}
  }
  /* Shared by both bars: the clear button only exists while there's
     something to clear, and the ⌘K badge steps aside for it. */
  function awSearchChrome(wrapId, v){
    var w = document.getElementById(wrapId);
    if(w) w.classList.toggle('tgHasQ', !!String(v || '').length);
  }
  function awSearchInput(v){
    awSearchChrome('awSearchInWrap', v);
    awLoadArtists();
    clearTimeout(awQTimer);
    /* Debounced. Every keystroke rebuilds the grid, and running that
       per character makes typing feel like it's fighting back. */
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
  /* This IS the gallery's query field now — _renderFGPage() reads
     #fgSearchIn directly, so there is nothing to mirror into. */
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

  function renderAwGrid(list, type){
    var grid  = document.getElementById('awGrid');
    var empty = document.getElementById('awEmpty');
    if(!grid) return;

    /* Every tab is TRENDING (per-category mini-ranking), EXCEPT "Latest",
       which is the one view that stays newest-first (that's its whole purpose).
       Hidden artworks are dropped first (per-user "hide from my feed"). */
    /* Applied here rather than at the call site so every path that
       repaints the grid — tab switch, tag tick, upload, like —
       keeps the active query instead of silently dropping it. */
    var src = awSearchFilter(filterHidden((list||[]).slice()));
    /* "Latest" stays strictly newest-first — that's its whole purpose,
       so preferences deliberately don't reorder it. Every other tab
       gets preferred tags pushed to the front of the trending order. */
    awRList = (type === 'latest' ? sortByNewest(src) : tgPrioritize(sortByTrending(src)));
    /* Same-tab re-render (rebuildGalCarousels after a like/edit/
       upload) keeps however many cards were already showing so the
       user's scroll depth survives; switching tabs starts fresh. */
    var keep = (type === awRType) ? awRShown : 0;
    awRType = type;
    awRShown = 0;
    if(awSent){ awSent.destroy(); awSent = null; }
    grid.innerHTML = '';

    if(!awRList.length){
      if(empty){
        empty.textContent = awQ
          ? ('NO MATCHES FOR \u201C' + awQ.toUpperCase() + '\u201D')
          : ((type && type !== 'artworks' && type !== 'latest')
              ? ('NO ' + catLabel(type).toUpperCase() + ' ART YET')
              : 'NO ARTWORK YET');
        empty.style.display = 'block';
      }
      return;
    }
    if(empty) empty.style.display = 'none';

    awAppendBatch(Math.max(gridInitialBatch(), keep));
    if(awRShown < awRList.length){
      /* Main page scrolls the document, so the observer root is the
         viewport (null). The sentinel lives INSIDE .awGrid spanning
         the full row (grid-column:1/-1 in .igSentinel). */
      awSent = makeGridSentinel(null, function(){ awAppendBatch(); });
      grid.appendChild(awSent.el);
    }
  }

  /* Append the next batch of cards before the sentinel.
     `count` overrides the batch size (used for the initial paint /
     scroll-depth restore); omitted, it's one column-sized step. */
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

  /* Artworks tab — called by renderHome() whenever `images` changes */
  window.rebuildGalCarousels = function(artworks){
    awArtworksCache = artworks || [];
    renderAwGrid(awListForTab(awTab), awTab);
  };

  /* Populate with empty list on first paint — rebuilt after DB loads */
  window.rebuildGalCarousels([]);


  /* SUBSCRIPTION OVERLAY Mirrors the openAdsPanel / openCommunityHome patterns. */
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

  /* ── Coming Soon modal ── */
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
