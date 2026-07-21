/* ── albums.js · albums ── */

  /* ═══════════════════════════════════════════════════════════════
     ALBUMS (alb) — artist-curated collections of artworks
     ├─ albLoadProfileTab()  → profile ALBUMS tab   (#pfAlbumGrid)
     ├─ albOpenPage()        → hamburger ▸ Albums   (#albPage, manager —
     │                        the ONLY surface that can create one)
     ├─ albOpen(src,id)      → one album's contents (#albViewPage)
     └─ albUpRender()        → the optional upload-page picker

     LIKES and BOOKMARKS are pinned to the front of every strip as
     VIRTUAL albums: no `albums` row exists for them (those names are
     reserved by a DB check constraint so a real album can never
     shadow them) and they read the same two RPCs the LIKE / BOOKMARK
     tabs already use. Everything else is a real row in `albums`,
     with membership in `album_items`.

     One card renderer + one contents renderer serve all three
     surfaces; `src` ('pf' = viewed profile, 'me' = signed-in user)
     says which in-memory strip an id should be looked up in, so the
     manager page opening over someone else's profile can never
     resolve an id against the wrong list.
     ═══════════════════════════════════════════════════════════════ */
  var ALB_VIRT = {
    like:     { name:'Likes',     rpc:'get_user_liked_artworks',      ico:'\u2665' },
    bookmark: { name:'Bookmarks', rpc:'get_user_bookmarked_artworks', ico:'\u2756' }
  };
  var albMine = [], albMineLoaded = false;   /* signed-in user's strip */
  var albView = null;                        /* album currently on #albViewPage */
  var albModMode = null, albModId = null;    /* create / rename popup state */

  /* Four-up cover mosaic. Missing slots stay as empty cells so a
     one-image album still reads as an album, not a broken card. */
  function albMosaicHTML(covers){
    var c = Array.isArray(covers) ? covers : [], out = '';
    for(var i=0; i<4; i++){
      out += c[i]
        ? '<span class="albCell"><img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(c[i]))+'" alt=""></span>'
        : '<span class="albCell albCellEmpty"></span>';
    }
    return '<span class="albMosaic">'+out+'</span>';
  }
  function albCardHTML(src, a){
    var n = +a.item_count || 0;
    return '<button type="button" class="albCard'+(a.virt?' albCard--virt':'')+'" '+
        'onclick="albOpen(\''+src+'\',\''+esc(String(a.id))+'\')">'+
      albMosaicHTML(a.covers)+
      '<span class="albMeta">'+
        '<span class="albName">'+(a.virt?'<span class="albPin">'+a.ico+'</span>':'')+esc(a.name||'Untitled')+'</span>'+
        '<span class="albCount">'+n+(n===1?' ITEM':' ITEMS')+'</span>'+
      '</span>'+
    '</button>';
  }
  function albNewCardHTML(){
    return '<button type="button" class="albCard albCardNew" onclick="albCreatePrompt()">'+
      '<span class="albNewIco">+</span><span class="albNewLbl">NEW ALBUM</span></button>';
  }

  /* Builds a whole strip for one user in a single round of parallel
     RPCs: the two virtual albums (covers + counts straight off the
     saved-artwork lists, capped at 100 like every other saved grid)
     followed by their real albums with server-side covers/counts.
     Each promise degrades to an empty list on its own, so one failing
     call can't blank the entire strip. */
  async function albFetchStrip(userId){
    function soft(p){ return p.then(function(r){ return r && !r.error ? r : {data:[]}; },
                                    function(){ return {data:[]}; }); }
    var res = await Promise.all([
      soft(sb.rpc('get_user_liked_artworks',      {target:userId, lim:100, off:0})),
      soft(sb.rpc('get_user_bookmarked_artworks', {target:userId, lim:100, off:0})),
      soft(sb.rpc('get_user_albums',              {target:userId}))
    ]);
    var virt = ['like','bookmark'].map(function(k, i){
      var rows = res[i].data || [];
      return { id:k, key:k, virt:true, name:ALB_VIRT[k].name, ico:ALB_VIRT[k].ico,
               item_count:rows.length,
               covers:rows.slice(0,4).map(function(r){ return r.image_url; }),
               rows:rows };
    });
    return virt.concat((res[2].data||[]).map(function(a){
      return { id:a.id, virt:false, name:a.name, item_count:a.item_count, covers:a.covers||[] };
    }));
  }

  /* ── Profile ALBUMS tab ── */
  async function albLoadProfileTab(){
    if(!pf.profile) return;
    var grid = document.getElementById('pfAlbumGrid');
    var empty = document.getElementById('pfAlbumEmpty');
    if(!grid) return;
    if(pf.albumsLoaded){ albRenderProfileTab(); return; }
    empty.style.display = 'none';
    grid.innerHTML = '<div class="albLoading">Loading\u2026</div>';
    var forId = pf.profile.id;
    try{
      var strip = await albFetchStrip(forId);
      /* Another profile opened while this was in flight — drop it. */
      if(!pf.profile || String(pf.profile.id) !== String(forId)) return;
      pf.albums = strip; pf.albumsLoaded = true;
      albRenderProfileTab();
    }catch(e){
      grid.innerHTML = '';
      empty.textContent = 'Couldn\u2019t load albums \u2014 try again.';
      empty.style.display = '';
    }
  }
  function albRenderProfileTab(){
    var grid = document.getElementById('pfAlbumGrid');
    var empty = document.getElementById('pfAlbumEmpty');
    if(!grid) return;
    /* No create tile here. Album creation lives on ONE surface — the
       manager at hamburger ▸ Albums — so this tab is purely a view of
       what exists, and it reads identically on your own profile and on
       anyone else's. */
    grid.innerHTML = (pf.albums||[]).map(function(a){ return albCardHTML('pf', a); }).join('');
    /* Likes + Bookmarks are always present, so the strip is never
       actually empty — the hint only shows if a fetch wiped it. */
    if(empty) empty.style.display = 'none';
  }

  /* ── Settings ▸ Albums — the manager page ── */
  async function albLoadMine(force){
    if(!currentUser) return;
    if(albMineLoaded && !force){ albRenderManager(); return; }
    var grid = document.getElementById('albGrid');
    if(grid && !albMine.length) grid.innerHTML = '<div class="albLoading">Loading\u2026</div>';
    try{
      albMine = await albFetchStrip(currentUser.id);
      albMineLoaded = true;
      albRenderManager();
    }catch(e){
      if(grid) grid.innerHTML = '<div class="albLoading">Couldn\u2019t load \u2014 try again.</div>';
    }
  }
  function albRenderManager(){
    var grid = document.getElementById('albGrid');
    if(!grid) return;
    grid.innerHTML = albNewCardHTML() + albMine.map(function(a){ return albCardHTML('me', a); }).join('');
  }
  function albOpenPage(){
    if(!currentUser){ showToast('Sign in to manage albums'); if(typeof openAuthMod==='function') openAuthMod(); return; }
    document.getElementById('albPage').classList.add('open');
    var nav = document.getElementById('bnNav'); if(nav) nav.style.display = 'none';
    document.body.style.overflow = 'hidden';
    albLoadMine(false);
  }
  function albClosePage(){
    document.getElementById('albPage').classList.remove('open');
    var nav = document.getElementById('bnNav'); if(nav) nav.style.display = '';
    restoreScroll();
  }

  /* ── One album's contents (#albViewPage) ── */
  function albFind(src, id){
    var list = (src === 'me') ? albMine : (pf.albums || []);
    return list.filter(function(a){ return String(a.id) === String(id); })[0] || null;
  }
  async function albOpen(src, id){
    var a = albFind(src, id);
    if(!a) return;
    /* Virtual albums are never editable — they mirror like/bookmark
       state, which is changed from the artwork itself. */
    var owner = !a.virt && (src === 'me' || !!pf.isOwner);
    albView = { src:src, id:String(id), virt:!!a.virt, name:a.name, owner:owner, rows:null };
    document.getElementById('albViewTitle').innerHTML = esc(String(a.name||'').toUpperCase())+' <span class="s">\u2726</span>';
    document.getElementById('albViewActs').style.display = owner ? '' : 'none';
    document.getElementById('albViewPage').classList.add('open');
    var nav = document.getElementById('bnNav'); if(nav) nav.style.display = 'none';
    document.body.style.overflow = 'hidden';
    var grid = document.getElementById('albViewGrid'), empty = document.getElementById('albViewEmpty');
    empty.style.display = 'none';
    grid.innerHTML = '<div class="albLoading">Loading\u2026</div>';
    try{
      var rows;
      if(a.virt){
        rows = a.rows || [];
      } else {
        const{data,error} = await sb.rpc('get_album_artworks', {album:String(id), lim:100, off:0});
        if(error) throw error;
        rows = data || [];
      }
      if(!albView || albView.id !== String(id)) return;   /* superseded */
      albView.rows = rows;
      albRenderView();
    }catch(e){
      grid.innerHTML = '';
      empty.innerHTML = '<div class="ico">\u25c8</div><div>COULDN\u2019T LOAD THIS ALBUM</div>';
      empty.style.display = '';
    }
  }
  function albRenderView(){
    if(!albView) return;
    var grid = document.getElementById('albViewGrid'), empty = document.getElementById('albViewEmpty');
    var rows = albView.rows || [];
    grid.innerHTML = rows.map(albItemHTML).join('');
    document.getElementById('albViewCount').textContent = rows.length + (rows.length===1 ? ' ITEM' : ' ITEMS');
    if(rows.length){ empty.style.display = 'none'; return; }
    empty.innerHTML = '<div class="ico">\u25c8</div><div>'+(albView.virt ? 'NOTHING SAVED HERE YET' : 'THIS ALBUM IS EMPTY')+'</div>'+
      '<div style="margin-top:.5rem;letter-spacing:.06em;opacity:.75;">'+
      (albView.virt
        ? 'Tap the heart or bookmark on any artwork to save it here.'
        : 'Pick this album on the upload page to add artwork to it.')+'</div>';
    empty.style.display = '';
  }
  /* Reuses pfSavedCardHTML verbatim so album thumbnails are pixel-
     identical to the Like / Bookmark grids; the owner's remove button
     is layered over it rather than forking the card renderer. */
  function albItemHTML(a){
    var card = pfSavedCardHTML(a);
    if(!albView || !albView.owner) return card;
    return '<div class="albItemWrap">'+card+
      '<button type="button" class="albItemX" aria-label="Remove from album" '+
      'onclick="event.stopPropagation();albRemoveItem(\''+esc(String(a.id))+'\')">\u2715</button></div>';
  }
  function albCloseView(){
    document.getElementById('albViewPage').classList.remove('open');
    albView = null;
    var mgrOpen = document.getElementById('albPage').classList.contains('open');
    var nav = document.getElementById('bnNav'); if(nav && !mgrOpen) nav.style.display = '';
    restoreScroll();
  }
  async function albRemoveItem(artId){
    if(!albView || !albView.owner) return;
    try{
      const{error} = await sb.from('album_items').delete()
        .eq('album_id', albView.id).eq('artwork_id', artId);
      if(error) throw error;
      albView.rows = (albView.rows||[]).filter(function(r){ return String(r.id) !== String(artId); });
      albRenderView();
      albPatchStrip(albView.src, albView.id, albView.rows);
      showToast('Removed from album');
    }catch(e){ showToast(safeErr(e, 'Couldn\u2019t remove \u2014 try again')); }
  }
  /* Keeps the strip card's count + covers truthful after an in-album
     edit, without paying for a whole refetch. */
  function albPatchStrip(src, id, rows){
    var a = albFind(src, id);
    if(!a) return;
    a.item_count = rows.length;
    a.covers = rows.slice(0,4).map(function(r){ return r.image_url; });
    if(src === 'me') albRenderManager(); else albRenderProfileTab();
  }

  /* ── Create / rename popup ── */
  function albCreatePrompt(){
    if(!currentUser){ showToast('Sign in to create albums'); if(typeof openAuthMod==='function') openAuthMod(); return; }
    albModMode = 'new'; albModId = null;
    document.getElementById('albModTitle').innerHTML = 'NEW ALBUM <span class="s">\u2726</span>';
    document.getElementById('albModSave').textContent = 'Create';
    var inp = document.getElementById('albModIn'); inp.value = '';
    document.getElementById('albMod').classList.add('open');
    setTimeout(function(){ inp.focus(); }, 80);
  }
  function albRenamePrompt(){
    if(!albView || !albView.owner) return;
    albModMode = 'rename'; albModId = albView.id;
    document.getElementById('albModTitle').innerHTML = 'RENAME ALBUM <span class="s">\u2726</span>';
    document.getElementById('albModSave').textContent = 'Save';
    var inp = document.getElementById('albModIn'); inp.value = albView.name || '';
    document.getElementById('albMod').classList.add('open');
    setTimeout(function(){ inp.focus(); inp.select(); }, 80);
  }
  function albModClose(){
    document.getElementById('albMod').classList.remove('open');
    albModMode = null; albModId = null;
  }
  async function albModSave(){
    var inp = document.getElementById('albModIn');
    var name = (inp.value || '').trim();
    if(!name){ showToast('Enter an album name'); return; }
    if(/^(likes?|bookmarks?)$/i.test(name)){ showToast('\u201C'+name+'\u201D is reserved \u2014 pick another name'); return; }
    var btn = document.getElementById('albModSave');
    btn.disabled = true;
    try{
      if(albModMode === 'rename'){
        const{error} = await sb.from('albums').update({name:name}).eq('id', albModId);
        if(error) throw error;
        if(albView && albView.id === String(albModId)){
          albView.name = name;
          document.getElementById('albViewTitle').innerHTML = esc(name.toUpperCase())+' <span class="s">\u2726</span>';
        }
        albModClose();
        showToast('Album renamed');
        await albRefreshAll();
      } else {
        const{data,error} = await sb.from('albums').insert({user_id:currentUser.id, name:name}).select().single();
        if(error) throw error;
        /* Tick it straight away if the upload picker is what opened
           this popup — the artist shouldn't have to hunt for it. */
        if(data && data.id && pf.upAlbums.indexOf(String(data.id)) === -1) pf.upAlbums.push(String(data.id));
        albModClose();
        showToast('Album created \u2726');
        await albRefreshAll();
      }
    }catch(e){
      /* Read the RAW message first — safeErr() deliberately swallows
         anything that smells like a constraint, and these three are
         exactly the cases worth explaining. */
      var raw = (e && e.message) ? String(e.message) : '';
      showToast(
        /albums_user_name_uniq|duplicate key/i.test(raw) ? 'You already have an album with that name' :
        /albums_name_reserved/i.test(raw)                ? 'That name is reserved \u2014 pick another' :
        /albums_name_len/i.test(raw)                     ? 'Album names are 1\u201340 characters' :
        /Album limit/i.test(raw)                         ? 'You\u2019ve reached the 100 album limit' :
        safeErr(e, 'Couldn\u2019t save \u2014 try again')
      );
    }finally{ btn.disabled = false; }
  }
  async function albDeleteCurrent(){
    if(!albView || !albView.owner) return;
    if(!confirm('Delete the album \u201C'+albView.name+'\u201D?\n\nThe artworks inside are NOT deleted \u2014 only the album.')) return;
    var id = albView.id;
    try{
      const{error} = await sb.from('albums').delete().eq('id', id);
      if(error) throw error;
      albCloseView();
      showToast('Album deleted');
      await albRefreshAll();
    }catch(e){ showToast(safeErr(e, 'Couldn\u2019t delete \u2014 try again')); }
  }
  /* Repaints every album surface that's currently live after a
     create / rename / delete, so no screen is left showing stale data. */
  async function albRefreshAll(){
    var jobs = [];
    if(currentUser) jobs.push(albLoadMine(true));
    if(pf.profile && currentUser && String(pf.profile.id) === String(currentUser.id)){
      pf.albumsLoaded = false;
      jobs.push(albLoadProfileTab());
    }
    try{ await Promise.all(jobs); }catch(e){}
    albUpRender();
  }

  /* Escape unwinds the album stack innermost-first: popup, then the
     contents page, then the manager — never two at once. */
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var mod = document.getElementById('albMod');
    if(mod && mod.classList.contains('open')){ albModClose(); return; }
    var vw = document.getElementById('albViewPage');
    if(vw && vw.classList.contains('open')){ albCloseView(); return; }
    var pg = document.getElementById('albPage');
    if(pg && pg.classList.contains('open')) albClosePage();
  });

  /* ── Upload page picker — optional, multi-select ──
     Same styled-dropdown parts as Category / Software, with a create
     row pinned to the bottom of the panel so a new album can be made
     without leaving the form. */
  function togglePfAlbumDd(e){
    if(e) e.stopPropagation();
    closePfCatDd(); closePfSoftwareDd();   /* only one panel open at a time */
    document.getElementById('pfUpAlbumDd').classList.toggle('open');
  }
  function closePfAlbumDd(){
    var d = document.getElementById('pfUpAlbumDd');
    if(d) d.classList.remove('open');
  }
  function albUpRender(){
    var panel = document.getElementById('pfUpAlbumPanel');
    if(!panel) return;
    var real = albMine.filter(function(a){ return !a.virt; });
    panel.innerHTML =
      (real.length
        ? real.map(function(a){
            return '<label class="upCatOpt"><input type="checkbox" value="'+esc(String(a.id))+'" '+
              'onchange="albUpChanged()"'+(pf.upAlbums.indexOf(String(a.id))!==-1?' checked':'')+'/> '+
              esc(a.name)+'</label>';
          }).join('')
        : '<div class="albUpNone">No albums yet</div>')+
      '<button type="button" class="albUpNew" onclick="albCreatePrompt()">+ Create new album</button>';
    albUpChanged();
  }
  function albUpChanged(){
    var panel = document.getElementById('pfUpAlbumPanel');
    if(!panel) return;
    var picked = [];
    panel.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c){ picked.push(c.value); });
    pf.upAlbums = picked;
    var names = picked.map(function(id){
      var a = albMine.filter(function(x){ return String(x.id) === String(id); })[0];
      return a ? a.name : '';
    }).filter(Boolean);
    var lbl = document.getElementById('pfUpAlbumTriggerLbl');
    if(lbl) lbl.textContent = names.length ? names.join(', ') : 'None';
  }
  /* Attaches a freshly published artwork to the albums picked on the
     upload form. Deliberately NON-fatal: the piece is already live, so
     a failure here is logged and surfaced as a toast rather than
     failing the upload it belongs to. */
  async function albAttach(artworkId, albumIds){
    if(!artworkId || !albumIds || !albumIds.length) return;
    try{
      const{error} = await sb.from('album_items')
        .insert(albumIds.map(function(id){ return {album_id:id, artwork_id:artworkId}; }));
      if(error) throw error;
      /* The strip's counts/covers just changed — force a refetch next
         time either surface is opened. */
      albMineLoaded = false;
      if(pf.profile && currentUser && String(pf.profile.id) === String(currentUser.id)) pf.albumsLoaded = false;
    }catch(e){
      console.error('albAttach:', e && e.message);
      showToast('Artwork is live, but couldn\u2019t be added to your album(s)');
    }
  }

  /* ── GALLERY tab — server-paginated infinite scroll ──
     Batches follow the column layout (16/12/10 first, then 8/6/4);
     offset is simply how many rows we already hold, so a resize
     changing the batch size mid-profile can never skip or duplicate
     rows. New rows APPEND into the grid — pfRenderGallery's full
     redraw is reserved for the edit paths that patch galleryRows. */
  var pfGallerySent = null;
  function pfEnsureGallerySentinel(){
    if(pfGallerySent) return;
    var el = document.getElementById('pfGallerySentinel');
    if(!el) return;
    pfGallerySent = makeGridSentinel(document.getElementById('profilePage'), function(){
      if(!pf.profile || pf.galleryDone || pf.galleryBusy) return;
      pfLoadMoreGallery();
    }, el);
  }
  function pfGallerySentinelSync(){
    var el = document.getElementById('pfGallerySentinel');
    if(!el) return;
    el.style.display = (pf.profile && !pf.galleryDone) ? '' : 'none';
    if(pfGallerySent && el.style.display !== 'none') pfGallerySent.recheck();
  }
  /* Skeleton tiles fill the incoming batch's slots while the network
     round-trip is in flight — the grid grows smoothly instead of the
     page ending abruptly and then jumping. */
  function pfGallerySkeleton(n){
    var grid = document.getElementById('pfGalleryGrid');
    if(!grid) return;
    if(n > 0){
      var tiles = '';
      for(var i = 0; i < n; i++) tiles += '<div class="igSkelCard" data-igskel="1" aria-hidden="true"></div>';
      grid.insertAdjacentHTML('beforeend', tiles);
    } else {
      grid.querySelectorAll('[data-igskel]').forEach(function(t){ t.remove(); });
    }
  }
  async function pfLoadMoreGallery(){
    if(!pf.profile || pf.galleryDone || pf.galleryBusy) return;
    pf.galleryBusy = true;
    pfEnsureGallerySentinel();
    var size = pf.galleryRows.length ? gridStepBatch() : gridInitialBatch();
    var from = pf.galleryRows.length, to = from + size - 1;
    pfGallerySkeleton(size);
    try{
      const{data,error}=await sb.from('artworks').select('*').eq('user_id',pf.profile.id).eq('kind',ART_KIND_ART).order('created_at',{ascending:false}).range(from,to);
      if(error) throw error;
      var rows = data||[];
      pf.galleryRows = pf.galleryRows.concat(rows);
      if(rows.length < size) pf.galleryDone = true;
      rows.forEach(function(a){
        /* Defensive guard: only APPROVED rows may enter the public
           `images` array (every upload now inserts as approved, but
           the guard is kept in case of legacy rows). */
        if(a.status!=='approved') return;
        if(images.findIndex(function(i){return String(i.id)===String(a.id);})===-1) images.push(a);
      });
      pfGallerySkeleton(0);
      var grid = document.getElementById('pfGalleryGrid');
      if(grid && rows.length) grid.insertAdjacentHTML('beforeend', rows.map(pfGalleryCardHTML).join(''));
      document.getElementById('pfGalleryEmpty').style.display = pf.galleryRows.length ? 'none' : '';
    }catch(e){
      pfGallerySkeleton(0);
      console.error('Error: '+e.message);
    }
    pf.galleryBusy = false;
    pfGallerySentinelSync();
  }
  function pfRenderGallery(){
    var grid = document.getElementById('pfGalleryGrid');
    /* Blurred background-upload cards lead the grid — but only on the
       uploader's OWN profile; visitors never see processing pieces. */
    var own = (typeof upq==='object' && currentUser && pf.profile && String(pf.profile.id)===String(currentUser.id));
    var qHtml = own ? upqOwnQueueHTML() : '';
    grid.innerHTML = qHtml + pf.galleryRows.map(pfGalleryCardHTML).join('');
    document.getElementById('pfGalleryEmpty').style.display = (pf.galleryRows.length || qHtml) ? 'none' : '';
    pfGallerySentinelSync();
  }
  function pfGalleryCardHTML(a){
    var tags = (a.tags && a.tags.length) ? a.tags : catList(a.category);
    /* Profile artwork cards never show Edit/Delete — not even for
       the profile owner — to keep this grid a pure read-only showcase. */
    return '<div class="awCard" onclick="pfOpenArtwork(\''+esc(String(a.id))+'\')">'+
      '<div class="awImgWrap awLoading"><img loading="lazy" onload="this.parentNode.classList.remove(\'awLoading\')" onerror="this.parentNode.classList.remove(\'awLoading\')" src="'+esc(getThumbnailUrl(a.image_url))+'" alt="'+esc(a.name||'')+'" style="'+thumbStyle(a.thumb_x, a.thumb_y, a.thumb_zoom)+'">'+
      '</div>'+
      '<div class="pfCardMeta">'+
        '<div class="pfCardTitle">'+esc(a.name||'Untitled')+'</div>'+
        '<div class="pfCardDate">'+pfFormatDate(a.created_at)+'</div>'+
        (tags.length ? '<div class="pfCardTags">'+tags.map(function(t){return '<span class="pfTagChip">'+esc(t)+'</span>';}).join('')+'</div>' : '')+
      '</div></div>';
  }
  function pfOpenArtwork(id){
    /* Artwork may belong to the viewed profile's gallery even if it
       hasn't been paginated into the global `images` feed yet, so look
       it up in pf.galleryRows first and fall back to the global list. */
    var art = pf.galleryRows.find(function(a){ return String(a.id)===String(id); }) || findArtworkById(id);
    if(!art) return;
    var cats=catList(art.category).length?catList(art.category):(catList(art.tags).length?catList(art.tags):['others']);
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), true, pf.galleryRows);
  }

  /* ── ABOUT tab — stats + bio ── */
  async function pfLoadStats(){
    try{
      const artC = await sb.from('artworks').select('id',{count:'exact',head:true}).eq('user_id',pf.profile.id).eq('kind',ART_KIND_ART);
      document.getElementById('pfStatArt').textContent = artC.count||0;
    }catch(e){ /* non-fatal */ }
  }
  /* Default shown wherever a profile has no bio — friendlier than
     an empty "No bio yet." and shared by the header line + About tab. */
  var PF_DEFAULT_BIO = 'Just a regular human who likes art and creativity.';
  var PF_HEAD_BIO_LIMIT = 100;
  var PF_USERNAME_COOLDOWN_MS = 90*24*3600*1000;

  /* Returns the Date when the @handle can next be changed, or null if it can
     be changed right now. Dev accounts bypass the cooldown (mirrors the
     guard_profile_update trigger — the DB is still the enforcer). */
  function pfUsernameNextChange(){
    if(!pf.profile) return null;
    if(pf.profile.role === 'dev') return null;
    if(!pf.profile.username_changed_at) return null;
    var next = new Date(pf.profile.username_changed_at).getTime() + PF_USERNAME_COOLDOWN_MS;
    return (isFinite(next) && next > Date.now()) ? new Date(next) : null;
  }

  /* Compact counts for the header stats row: 950 → 950, 1.2K, 3.4M */
  function pfFmtCount(n){
    n = +n || 0;
    if(n >= 1e6) return (n/1e6).toFixed(n%1e6 >= 1e5 ? 1 : 0).replace(/\.0$/,'') + 'M';
    if(n >= 1e3) return (n/1e3).toFixed(n%1e3 >= 100 ? 1 : 0).replace(/\.0$/,'') + 'K';
    return String(n);
  }

  /* ── Header stats row: ❤️ total likes · 👁️ total views · LV ──
     Likes/views are summed from the viewer-readable artworks rows
     (like_count/view_count are the trigger-guarded counters); level
     comes from the same get_artist_progress RPC the LEVEL tab uses.
     Guarded against profile switches mid-flight: if another profile
     opened while we awaited, the stale result is dropped. */
  /* Paints BOTH the header row and the About-tab cards from one fetch.
     Every path paints — a failed fetch shows 0, never leaves the cards
     stuck on their static "—" placeholder (which is what happened when an
     error was swallowed silently). */
  function pfPaintStats(likes, views, bms, level, merit, cred){
    function set(id, val){ var e=document.getElementById(id); if(e) e.textContent = val; }
    /* Header row */
    set('pfHeadStatLikes', '\u2764\uFE0F ' + pfFmtCount(likes));
    set('pfHeadStatBms',   '\uD83D\uDD16 ' + pfFmtCount(bms));
    set('pfHeadStatViews', '\uD83D\uDC41\uFE0F ' + pfFmtCount(views));
    set('pfHeadStatLevel', 'LV ' + level);
    set('pfHeadStatCred',  '\u2B50 ' + pfFmtCount(cred));
    var row = document.getElementById('pfStatsRow');
    if(row) row.style.display = '';
    /* About-tab cards */
    set('pfStatViews',     pfFmtCount(views));
    set('pfStatLikes',     pfFmtCount(likes));
    set('pfStatLevelCard', level);
    set('pfStatCredCard',  pfFmtCount(cred));
    set('pfStatMerit',     merit);
    /* Red "!" beside the name at merit <= 20 */
    var warn = document.getElementById('pfWarnMark');
    if(warn) warn.classList.toggle('on', merit <= 20);
    /* Milestone colour — the display name and the ribbon take the same
       tier token, so they always agree. Below LVL 5 both go neutral. */
    if(window.DZ_MS){
      DZ_MS.paintName(document.getElementById('pfUsername'), level);
      DZ_MS.paintRibbon(document.getElementById('pfMsRibbon'), level);
    }
  }

  async function pfLoadHeadStats(){
    if(!pf.profile) return;
    var forId = pf.profile.id;
    var likes = 0, views = 0, bms = 0, level = 1;
    var merit = (pf.profile.merit == null) ? 100 : (+pf.profile.merit);

    try{
      var r = await sb.from('artworks')
        .select('like_count,view_count,bookmark_count')
        .eq('user_id', forId).limit(1000);
      if(!pf.profile || pf.profile.id !== forId) return;  /* stale — another profile opened */
      /* Was swallowed before: a PostgREST error (e.g. stale schema cache
         after a migration adds a column) left every card on "—". */
      if(r.error) console.error('pfLoadHeadStats artworks:', r.error.message);
      (r.data || []).forEach(function(a){
        likes += (+a.like_count || 0);
        views += (+a.view_count || 0);
        bms   += (+a.bookmark_count || 0);
      });
    }catch(e){ console.error('pfLoadHeadStats artworks:', e); }

    try{
      var pr = await sb.rpc('get_artist_progress', { target: forId });
      if(pr && pr.data && pr.data[0] && pr.data[0].level) level = pr.data[0].level;
    }catch(e){ /* level stays 1 */ }

    if(!pf.profile || pf.profile.id !== forId) return;
    /* CRED = 100 per profile cred + 2 per like + 5 per bookmark. */
    pfCredTotal = 100*(+pf.profile.cred_received_count || 0) + 2*likes + 5*bms;
    pfPaintStats(likes, views, bms, level, merit, pfCredTotal);
  }

  /* ── [ADD FRD] [CRED] action row ─────────────────────────────
     Shown on every profile except your own. Friend button walks the
     friendship state machine (ADD FRD → REQ SENT → MESSAGE, or ACCEPT
     when they asked first) via the pfFriendBridge from the community
     module. Cred is a once-per-profile toggle worth +100, stored in
     profile_creds; tapping CREDITED removes it again. */
  var pfCredTotal = 0;              /* current ⭐ value shown in the stats row */
  var pfCredited = false, pfCredBusy = false, pfFrBusy = false;

  function pfPaintCredBtn(){
    var b = document.getElementById('pfBtnCred'); if(!b) return;
    b.textContent = pfCredited ? 'CREDITED' : 'CRED';
    b.classList.toggle('on', pfCredited);
  }
  function pfPaintFriendBtn(state){
    var b = document.getElementById('pfBtnFriend'); if(!b) return;
    var map = { none:'ADD FRD', sent:'REQ SENT', incoming:'ACCEPT', friends:'MESSAGE' };
    if(state === 'blocked_by_me' || state === 'blocked'){ b.style.display='none'; return; }
    b.style.display = '';
    b.textContent = map[state] || 'ADD FRD';
    b.classList.toggle('on', state === 'friends');
    b.dataset.frState = state || 'none';
  }

  async function pfLoadActionRow(){
    var row = document.getElementById('pfActionRow');
    if(!row || !pf.profile) return;
    var bF = document.getElementById('pfBtnFriend'),
        bC = document.getElementById('pfBtnCred'),
        bE = document.getElementById('pfBtnEdit'),
        bS = document.getElementById('pfBtnSettings');
    row.style.display = '';
    if(pf.isOwner){
      /* Own profile: dedicated Edit (replaces the old banner pencil) +
         Settings placeholder. Social buttons hidden. */
      if(bF) bF.style.display = 'none';
      if(bC) bC.style.display = 'none';
      if(bE) bE.style.display = '';
      if(bS) bS.style.display = '';
      return;
    }
    if(bE) bE.style.display = 'none';
    if(bS) bS.style.display = 'none';
    if(bC) bC.style.display = '';
    var forId = pf.profile.id;
    pfCredited = false; pfPaintCredBtn(); pfPaintFriendBtn('none');
    if(!currentUser) return;   /* logged out: defaults shown, taps prompt sign-in */
    try{
      if(window.pfFriendBridge){
        await window.pfFriendBridge.load();
        if(!pf.profile || pf.profile.id !== forId) return;
        pfPaintFriendBtn(window.pfFriendBridge.state(forId));
      }
      var c = await sb.from('profile_creds').select('id')
        .eq('giver_id', currentUser.id).eq('receiver_id', forId).maybeSingle();
      if(!pf.profile || pf.profile.id !== forId) return;
      pfCredited = !!(c && c.data);
      pfPaintCredBtn();
    }catch(e){ /* buttons stay at defaults — actions still re-check */ }
  }

  async function pfCredToggle(){
    if(!pf.profile || pf.isOwner || pfCredBusy) return;
    if(!currentUser){ showToast('Sign in to cred artists'); openAuthMod(); return; }
    var forId = pf.profile.id;
    var statEl = document.getElementById('pfHeadStatCred');
    var cardEl = document.getElementById('pfStatCredCard');
    pfCredBusy = true;
    /* optimistic flip (+/−100), rolled back on failure */
    var was = pfCredited;
    pfCredited = !was; pfPaintCredBtn();
    pfCredTotal += pfCredited ? 100 : -100;
    if(statEl) statEl.textContent = '\u2B50 ' + pfFmtCount(Math.max(pfCredTotal,0));
    if(cardEl) cardEl.textContent = pfFmtCount(Math.max(pfCredTotal,0));
    try{
      if(was){
        var d = await sb.from('profile_creds').delete()
          .eq('giver_id', currentUser.id).eq('receiver_id', forId);
        if(d.error) throw d.error;
      } else {
        var i = await sb.from('profile_creds').insert({ giver_id: currentUser.id, receiver_id: forId });
        if(i.error && i.error.code !== '23505') throw i.error;  /* duplicate → already credited, fine */
      }
      pf.profile.cred_received_count = Math.max((+pf.profile.cred_received_count||0) + (pfCredited?1:-1), 0);
    }catch(e){
      pfCredited = was; pfPaintCredBtn();                        /* roll back */
      pfCredTotal += pfCredited ? 100 : -100;
      if(statEl) statEl.textContent = '\u2B50 ' + pfFmtCount(Math.max(pfCredTotal,0));
      if(cardEl) cardEl.textContent = pfFmtCount(Math.max(pfCredTotal,0));
      showToast('Couldn\u2019t update cred \u2014 try again');
    }finally{ pfCredBusy = false; }
  }

  async function pfFriendBtnTap(){
    if(!pf.profile || pf.isOwner || pfFrBusy || !window.pfFriendBridge) return;
    if(!currentUser){ showToast('Sign in to add friends'); openAuthMod(); return; }
    var b = document.getElementById('pfBtnFriend'); if(!b) return;
    var st = b.dataset.frState || 'none', forId = pf.profile.id;
    if(st === 'friends'){
      /* MESSAGE — jump into the DM thread (community module handles the rest) */
      window.pfFriendBridge.chat({ id: forId, username: pf.profile.username, avatar_url: pf.profile.avatar_url });
      return;
    }
    pfFrBusy = true; b.disabled = true;
    try{
      if(st === 'none')          await window.pfFriendBridge.send(forId);
      else if(st === 'sent')     await window.pfFriendBridge.cancel(forId);
      else if(st === 'incoming') await window.pfFriendBridge.accept(forId);
      await window.pfFriendBridge.load();
      if(pf.profile && pf.profile.id === forId) pfPaintFriendBtn(window.pfFriendBridge.state(forId));
    }catch(e){ showToast('Action failed \u2014 try again'); }
    finally{ pfFrBusy = false; b.disabled = false; }
  }

  function pfRenderBio(){
    var text = document.getElementById('pfBioText');
    text.textContent = pf.profile.bio && pf.profile.bio.trim() ? pf.profile.bio : PF_DEFAULT_BIO;
  }

  /* ── Header bio teaser (under the username) ──
     Full bio if it fits in PF_HEAD_BIO_LIMIT chars; otherwise a word-safe
     cut + "…more" that jumps to the ABOUT tab. Built with textContent /
     createTextNode only — the bio is user input, never innerHTML. */
  function pfGoAboutTab(){
    pfSwitchTab('about');
    var tabs = document.querySelector('#profilePage .pfTabs');
    if(tabs && tabs.scrollIntoView) tabs.scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function pfRenderHeadBio(){
    var el = document.getElementById('pfHeadBio');
    if(!el) return;
    var bio = (pf.profile && pf.profile.bio && pf.profile.bio.trim())
                ? pf.profile.bio.trim() : PF_DEFAULT_BIO;
    bio = bio.replace(/\s+/g, ' ');           /* single teaser line — collapse newlines */
    el.textContent = '';
    if(bio.length <= PF_HEAD_BIO_LIMIT){ el.textContent = bio; return; }
    var cut = bio.slice(0, PF_HEAD_BIO_LIMIT);
    var sp  = cut.lastIndexOf(' ');
    if(sp > 60) cut = cut.slice(0, sp);       /* don't chop mid-word unless the word is huge */
    el.appendChild(document.createTextNode(cut + '… '));
    var more = document.createElement('span');
    more.className = 'pfHeadBioMore';
    more.textContent = 'Show more';
    more.setAttribute('role','button');
    more.tabIndex = 0;
    more.setAttribute('aria-label','Read full bio in About');
    more.addEventListener('click', pfGoAboutTab);
    more.addEventListener('keydown', function(e){
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); pfGoAboutTab(); }
    });
    el.appendChild(more);
  }

  /* ── Connect (social links) ──
     Single source of truth for the 9 supported platforms — used to
     render the read-only About-tab list (blue = linked, grey =
     not), populate/save the Edit Profile inputs, and validate that
     each URL actually belongs to the platform it was entered under.
     Stored as profiles.social_links jsonb, e.g. {"instagram":"https://instagram.com/…"}. */
  var PF_SOCIAL_PLATFORMS = [
    {key:'instagram', label:'Instagram', domains:['instagram.com','instagr.am']},
    {key:'facebook',  label:'Facebook',  domains:['facebook.com','fb.com','fb.me']},
    {key:'youtube',   label:'YouTube',   domains:['youtube.com','youtu.be']},
    {key:'x',         label:'X',         domains:['x.com','twitter.com']},
    {key:'tiktok',    label:'TikTok',    domains:['tiktok.com']},
    {key:'linkedin',  label:'LinkedIn',  domains:['linkedin.com']},
    {key:'discord',   label:'Discord',   domains:['discord.gg','discord.com']},
    {key:'reddit',    label:'Reddit',    domains:['reddit.com','redd.it']},
    {key:'pinterest', label:'Pinterest', domains:['pinterest.com','pin.it']}
  ];
  function pfRenderConnect(){
    var wrap = document.getElementById('pfConnectList');
    var links = (pf.profile && pf.profile.social_links) || {};
    wrap.innerHTML = PF_SOCIAL_PLATFORMS.map(function(p){
      var url = links[p.key];
      /* FIX (defense in depth): pfValidateSocialLink guards the save
         path, but this render path trusted the DB — a javascript: URL
         written to profiles.social_links by any other means would have
         rendered as a clickable link. Only http(s) URLs become links;
         anything else falls back to the unlinked state. */
      var safe = (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) ? url.trim() : null;
      return safe
        ? '<a class="pfConnectItem pfConnectItem--on" href="'+esc(safe)+'" target="_blank" rel="noopener noreferrer">'+p.label+'</a>'
        : '<span class="pfConnectItem pfConnectItem--off">'+p.label+'</span>';
    }).join('');
  }
  /* Accepts a raw string typed into a platform's field; empty clears
     the link. Auto-prepends https:// if no scheme was typed, then
     checks the resulting hostname actually belongs to that platform. */
  function pfValidateSocialLink(platform, raw){
    raw = (raw||'').trim();
    if(!raw) return {ok:true, value:null};
    var candidate = /^https?:\/\//i.test(raw) ? raw : 'https://'+raw;
    var url;
    try{ url = new URL(candidate); }
    catch(e){ return {ok:false, msg:'That doesn\'t look like a valid '+platform.label+' link.'}; }
    var host = url.hostname.toLowerCase().replace(/^www\./,'');
    var matched = platform.domains.some(function(d){ return host===d || host.endsWith('.'+d); });
    if(!matched) return {ok:false, msg:'This link doesn\'t look like a '+platform.label+' link.'};
    return {ok:true, value:url.href};
  }

  /* ── UPLOAD POPUP (art + comic, own-profile only) ── */
  pf.upCats = ['others'];
  pf.upTags = [];

  function pfUpdateCount(inputId,countId,max){
    var v = document.getElementById(inputId).value.length;
    document.getElementById(countId).textContent = v+'/'+max;
  }

  /* ── Category multi-select dropdown (same options as the gallery) ── */
  function togglePfCatDd(e){
    if(e) e.stopPropagation();
    closePfSoftwareDd(); /* only one dropdown open at a time */
    if(typeof closePfAlbumDd==='function') closePfAlbumDd();
    document.getElementById('pfUpCatDd').classList.toggle('open');
    /* Fresh search state each time it opens — deliberately NOT
       focusing the field, so the keyboard only opens if the user
       taps the search box itself. */
    pfResetCatSearch();
  }
  function closePfCatDd(){
    document.getElementById('pfUpCatDd').classList.remove('open');
    pfResetCatSearch();
  }
  /* ── Category search — filters the 51 checkboxes by label ── */
  function pfResetCatSearch(){
    var s = document.getElementById('pfUpCatSearch');
    if(s && s.value){ s.value = ''; }
    pfFilterCats('');
  }
  function pfFilterCats(q){
    q = (q || '').trim().toLowerCase();
    var panel = document.getElementById('pfUpCatPanel');
    if(!panel) return;
    var any = false;
    panel.querySelectorAll('.upCatOpt').forEach(function(lbl){
      var hit = !q || lbl.textContent.toLowerCase().indexOf(q) !== -1;
      lbl.style.display = hit ? '' : 'none';
      if(hit) any = true;
    });
    var nm = document.getElementById('pfUpCatNoMatch');
    if(nm) nm.style.display = any ? 'none' : '';
  }
  var PF_CATS = CAT_SLUGS;
  function updatePfCatDisplay(){
    var checked = PF_CATS.filter(function(c){
      var el = document.getElementById('pfUpCat_'+c);
      return el && el.checked;
    });
    if(!checked.length){
      checked=['others'];
      var oth = document.getElementById('pfUpCat_others');
      if(oth) oth.checked = true;
    }
    pf.upCats = checked;
    /* Show the real labels ("Fan Art", "3D Art"), not a naive
       capitalisation of the slug ("Fan-art", "3d-art"). */
    var lbl = checked.map(catLabel).join(', ');
    document.getElementById('pfUpCatTriggerLbl').textContent = lbl;
  }
  function pfSetCats(cats){
    var list = (cats && cats.length) ? cats : ['others'];
    PF_CATS.forEach(function(c){
      var el = document.getElementById('pfUpCat_'+c);
      if(el) el.checked = list.indexOf(c)!==-1;
    });
    updatePfCatDisplay();
  }

  /* ── Software single-select dropdown — same styled-dropdown pattern as
     Category above, swapped to radio buttons since only one software can
     be picked. #pfUpSoftware stays a plain hidden input so every existing
     .value read/write (validation, save, reset) keeps working untouched. ── */
  function togglePfSoftwareDd(e){
    if(e) e.stopPropagation();
    closePfCatDd(); /* only one dropdown open at a time */
    if(typeof closePfAlbumDd==='function') closePfAlbumDd();
    document.getElementById('pfUpSoftwareDd').classList.toggle('open');
  }
  function closePfSoftwareDd(){
    document.getElementById('pfUpSoftwareDd').classList.remove('open');
  }
  function updatePfSoftwareDisplay(){
    var checked = document.querySelector('#pfUpSoftwarePanel input[name="pfUpSoftwareRadio"]:checked');
    var val = checked ? checked.value : '';
    document.getElementById('pfUpSoftware').value = val;
    document.getElementById('pfUpSoftwareTriggerLbl').textContent = val || 'Select software…';
    closePfSoftwareDd();
  }
  function pfSetSoftware(value){
    document.querySelectorAll('#pfUpSoftwarePanel input[name="pfUpSoftwareRadio"]').forEach(function(r){
      r.checked = (r.value === value);
    });
    document.getElementById('pfUpSoftware').value = value || '';
    document.getElementById('pfUpSoftwareTriggerLbl').textContent = value || 'Select software…';
  }
  document.addEventListener('click',function(e){
    var dd = document.getElementById('pfUpCatDd');
    if(dd && dd.classList.contains('open') && !dd.contains(e.target)) closePfCatDd();
    var sd = document.getElementById('pfUpSoftwareDd');
    if(sd && sd.classList.contains('open') && !sd.contains(e.target)) closePfSoftwareDd();
    var ad = document.getElementById('pfUpAlbumDd');
    if(ad && ad.classList.contains('open') && !ad.contains(e.target)) closePfAlbumDd();
  });

  /* ── Tags — YouTube-style chip input (type, press Enter/comma to add) ── */
  function pfRenderTagChips(){
    var host = document.getElementById('pfUpTagChips');
    host.innerHTML = pf.upTags.map(function(t,i){
      return '<span class="upTagChip">'+esc(t)+'<button type="button" onclick="pfRemoveTag('+i+',event)" aria-label="Remove tag">✕</button></span>';
    }).join('');
    document.getElementById('pfUpTags').value = pf.upTags.join(',');
  }
  /* One tag is capped at 15 characters — the same ceiling the DB
     enforces on user_tag_prefs, and exactly the length of the longest
     category slug ("traditional-art"), so categories stay valid tags.
     maxlength on the input covers typing; this covers paste and the
     comma-split path, which bypass it. */
  var TAG_MAX = 15;
  function pfAddTag(raw){
    var t = (raw||'').trim();
    if(!t) return;
    if(t.length > TAG_MAX){ showToast('Tags are up to '+TAG_MAX+' characters'); return; }
    if(pf.upTags.length>=10){ showToast('Up to 10 tags allowed'); return; }
    if(pf.upTags.some(function(x){return x.toLowerCase()===t.toLowerCase();})) return;
    pf.upTags.push(t);
    pfRenderTagChips();
  }
  function pfRemoveTag(i,e){
    if(e) e.stopPropagation();
    pf.upTags.splice(i,1);
    pfRenderTagChips();
  }
  function pfSetTagsFromArray(arr){
    /* Resumed drafts (device-local, up to 7 days old) can carry tags
       saved before the 15-char cap existed — drop those rather than
       letting them fail the insert later. */
    pf.upTags = (arr||[])
      .map(function(t){ return String(t||'').trim(); })
      .filter(function(t){ return t && t.length <= TAG_MAX; })
      .slice(0,10);
    pfRenderTagChips();
  }
  function pfTagKeydown(e){
    var input = e.target;
    if(e.key==='Enter' || e.key===','){
      e.preventDefault();
      pfAddTag(input.value);
      input.value='';
    } else if(e.key==='Backspace' && !input.value && pf.upTags.length){
      pf.upTags.pop();
      pfRenderTagChips();
    }
  }

  /* ── Guest gate — the upload PAGE itself is viewable logged-out
     (better guest experience: guests see the form, guidelines and
     tips), but any real ACTION — picking files, dropping files, or
     submitting — routes through login first. Queues pendPfUp so a
     successful sign-in lands them right back on the upload page.
     #authMod is z:500 (below this page's z:600), so the page is
     closed BEFORE auth opens — "navigate to login", not layered.
     Defensive on e: the pfDz drop handler passes a synthetic
     {target:{files:[f]}} object with no preventDefault. */
  function pfGuestGate(e){
    if(currentUser) return false;
    if(e && typeof e.preventDefault==='function'){ e.preventDefault(); e.stopPropagation(); }
    sessionStorage.setItem('pendPfUp','1');
    closePfUpload();
    showToast('Sign in to upload');
    openAuthMod();
    return true;
  }

  /* ── pfUpResetSession ──
     Wipes every scrap of upload state so the next piece starts from
     a clean sheet: picked files, the crop/focal point (thumb x/y +
     zoom), the pending crop, the preview img's own src (which would
     otherwise pin the old data URL in memory), the text fields,
     tags, categories, software, the schedule, and any link back to
     a draft. Called by openPfUpload() AND immediately after a
     successful queue in doPfUp(), so a finished upload can never
     bleed into the next one. */
  function pfUpResetSession(){
    pf.upFile = null;
    pf.upPageFiles = [];
    pf.upThumbFocus = null;      /* was surviving an upload */
    pfCropPending = null;
    updrActiveId = null;
    var prev = document.getElementById('pfUpPrev');
    if(prev){ prev.removeAttribute('style'); prev.removeAttribute('src'); }
    var pw = document.getElementById('pfUpPrevWrap'); if(pw) pw.style.display = 'none';
    var tb = document.getElementById('pfUpThumbBtn'); if(tb) tb.style.display = 'none';
    var pp = document.getElementById('pfPagesPreview'); if(pp) pp.innerHTML = '';
    var nm = document.getElementById('pfUpNm');   if(nm) nm.value = '';
    var ds = document.getElementById('pfUpDesc'); if(ds) ds.value = '';
    pfUpdateCount('pfUpNm','pfUpNmCount',100);
    pfUpdateCount('pfUpDesc','pfUpDescCount',1000);
    pfSetTagsFromArray([]);
    pfSetCats(['others']);
    pfSetSoftware('');
    pfSchedReset();
    pf.upAlbums = [];
    if(typeof albUpRender==='function') albUpRender();
    closePfCatDd();
    if(typeof closePfAlbumDd==='function') closePfAlbumDd();
  }

  function openPfUpload(){
    /* Universal upload — any signed-in user, from anywhere (nav ➕).
       The row is always inserted with the uploader's own user_id, so
       no owner check is needed. Guests may OPEN this page too —
       pfGuestGate() intercepts them at the first real action. */
    pfUpResetSession();
    document.getElementById('pfUpEditId').value = '';
    document.getElementById('pfUpTitle').textContent = 'Upload Artwork';
    document.getElementById('pfUpSubtitle').textContent = 'Share your creativity with artists around the world.';
    document.getElementById('pfUpNavTitle').textContent = 'UPLOAD';
    document.getElementById('pfDzTxt').textContent = 'Drag & drop your artwork here';
    document.getElementById('pfUpCatField').style.display = '';
    /* Optional extra images — the first image above stays the cover
       and thumbnail; extras are stored in `pages` and shown as a
       thumbnail strip in the lightbox. */
    document.getElementById('pfComicPagesWrap').style.display = '';
    document.getElementById('pfDzPagesIco').textContent   = '🖼';
    document.getElementById('pfDzPagesTitle').textContent = 'Add more images (optional)';
    document.getElementById('pfDzPagesSub').textContent   = 'The image above stays the cover. Add as many extras as you like.';
    document.getElementById('pfUpSoftwareField').style.display = '';
    /* Optional album picker — fire-and-forget; the panel paints as
       soon as the strip lands and the trigger reads "None" until then. */
    var _albF = document.getElementById('pfUpAlbumField'); if(_albF) _albF.style.display = '';
    if(typeof albLoadMine==='function') albLoadMine(false).then(albUpRender, function(){});
    var _drB = document.getElementById('pfDraftBtn'); if(_drB) _drB.style.display = '';
    var _bkB = document.getElementById('pfUpBackBtn'); if(_bkB) _bkB.style.display = 'none';
    var _schF = document.getElementById('pfUpSchedField'); if(_schF) _schF.style.display = '';
    updrLoadStrip(); /* async fire-and-forget — purges >7d drafts too */
    uschLoad();      /* SCHEDULED rail (server-backed) */
    document.getElementById('pfDz').style.display='';
    document.getElementById('pfUpBtn').textContent = '📤 Upload Artwork';
    document.getElementById('pfUpMod').classList.add('open');
    /* Page mode — lock background scroll like every other full page.
       (Edit mode via mwEditArt skips this: My Work already holds the
       lock underneath.) */
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function closePfUpload(){
    /* editId is only ever set by mwEditArt and cleared by
       openPfUpload, so it reliably tells the two modes apart here. */
    var wasEdit = !!document.getElementById('pfUpEditId').value;
    document.getElementById('pfUpMod').classList.remove('open');
    closePfCatDd();
    pf.upFile = null; pf.upThumbFocus = null; pf.upPageFiles = [];
    /* restoreScroll() is safe in BOTH modes — 'pfUpMod' is in its
       lock list and it only re-enables scrolling once no listed
       page is left open, so edit mode (My Work still open under-
       neath) keeps its lock while upload-page mode releases it. */
    restoreScroll();
    if(!wasEdit){
      /* Nav highlight falls back to Home; doPfUp's success path
         sets it to Profile right after this. */
      if(typeof bnSetActive==='function') bnSetActive('bnHome');
    }
  }
  function handlePfFile(e){
    if(pfGuestGate(e)) return; /* drop path bypasses the input's click gate */
    var f = e.target.files[0]; if(!f) return;
    if(!document.getElementById('pfUpNm').value.trim()){
      document.getElementById('pfUpNm').value = f.name.replace(/\.[^.]+$/,'');
      pfUpdateCount('pfUpNm','pfUpNmCount',100);
    }
    var r = new FileReader();
    r.onload = function(ev){ openPfCrop(f, ev.target.result); };
    r.readAsDataURL(f);
  }

  /* ── Square thumbnail focal-point picker ──
     Opens right after a file is picked. Rather than generating and
     uploading a second cropped image (double the storage/bandwidth
     per upload), this just lets the user drag to choose a focal
     point (x%,y%) using the exact same object-fit:cover math the
     grid already renders with. Only two small numbers are stored
     (pf.upThumbFocus); the browser re-crops the original image live
     via CSS object-position everywhere it's shown as a thumbnail —
     the original file itself is never duplicated. */
