// albums

  var ALB_VIRT = {
    like:     { name:'Likes',     rpc:'get_user_liked_artworks',      ico:'\u2665' },
    bookmark: { name:'Bookmarks', rpc:'get_user_bookmarked_artworks', ico:'\u2756' }
  };
  var albMine = [], albMineLoaded = false;   // own strip
  // album cap per tier
  var albTier = 'guest';
  function albCap(){ return (albTier === 'premium' || albTier === 'max') ? 30 : 25; }
  function albRealCount(){ return albMine.filter(function(a){ return !a.virt; }).length; }
  var albView = null;                        // album on view page
  var albModMode = null, albModId = null;    // popup state

  // four up cover mosaic
  function albMosaicHTML(covers){
    var c = Array.isArray(covers) ? covers : [], out = '';
    for(var i=0; i<4; i++){
      out += c[i]
        ? '<span class="albCell"><img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(c[i]))+'" alt=""></span>'
        : '<span class="albCell albCellEmpty"></span>';
    }
    return '<span class="albMosaic">'+out+'</span>';
  }
  // can the viewer manage this
  function albCanManage(src, a){
    if(!currentUser) return false;
    return src === 'me' || !!pf.isOwner;
  }
  function albCardHTML(src, a){
    var n = +a.item_count || 0;
    var id = esc(String(a.id));
    var priv = (a.is_public === false);
    // dots sit outside the card button
    return '<div class="albCardWrap">'+
      '<button type="button" class="albCard'+(a.virt?' albCard--virt':'')+(priv?' albCard--priv':'')+'" '+
          'onclick="albOpen(\''+src+'\',\''+id+'\')">'+
        albMosaicHTML(a.covers)+
        '<span class="albMeta">'+
          '<span class="albName">'+(a.virt?'<span class="albPin">'+a.ico+'</span>':'')+esc(a.name||'Untitled')+'</span>'+
          '<span class="albCount">'+n+(n===1?' ITEM':' ITEMS')+(priv?' \u00B7 PRIVATE':'')+'</span>'+
        '</span>'+
      '</button>'+
      (albCanManage(src, a)
        ? '<button type="button" class="albDots" aria-label="Album options" aria-haspopup="menu" '+
          'onclick="albMenuOpen(event,\''+src+'\',\''+id+'\')">\u22EF</button>'
        : '')+
    '</div>';
  }
  function albNewCardHTML(){
    return '<button type="button" class="albCard albCardNew" onclick="albCreatePrompt()">'+
      '<span class="albNewIco">+</span><span class="albNewLbl">NEW ALBUM</span></button>';
  }

  // build one strip in parallel
  async function albFetchStrip(userId){
    // Both callers happen to await this inside a try, so a null client is
    // already caught today. That is their carefulness, not this function's,
    // and the third caller will not inherit it. An empty strip is the honest
    // answer: no client, no albums to name.
    if(!sb) return [];
    function soft(p){ return p.then(function(r){ return r && !r.error ? r : {data:[]}; },
                                    function(){ return {data:[]}; }); }
    function soft1(p){ return p.then(function(r){ return r && !r.error && r.data ? r : {data:{}}; },
                                     function(){ return {data:{}}; }); }
    var res = await Promise.all([
      soft(sb.rpc('get_user_liked_artworks',      {target:userId, lim:100, off:0})),
      soft(sb.rpc('get_user_bookmarked_artworks', {target:userId, lim:100, off:0})),
      soft(sb.rpc('get_user_albums',              {target:userId})),
      // visibility flags and tier
      soft1(sb.from('profiles')
              .select('likes_public,bookmarks_public,subscription_tier,subscription_expires_at')
              .eq('id', userId).maybeSingle())
    ]);
    var flags = res[3].data || {};
    // decided when the reply lands, not when the request left: signing out
    // mid-flight must not leave a private Likes album marked as yours
    var owner = !!currentUser && String(currentUser.id) === String(userId);
    if(owner){
      var exp = flags.subscription_expires_at ? new Date(flags.subscription_expires_at) : null;
      albTier = (exp && exp.getTime() < Date.now())
        ? 'guest' : (flags.subscription_tier || 'guest');
    }
    var pubOf = { like: flags.likes_public === true, bookmark: flags.bookmarks_public === true };
    var virt = ['like','bookmark'].map(function(k, i){
      var rows = res[i].data || [];
      return { id:k, key:k, virt:true, name:ALB_VIRT[k].name, ico:ALB_VIRT[k].ico,
               is_public:pubOf[k],
               item_count:rows.length,
               covers:rows.slice(0,4).map(function(r){ return r.image_url; }),
               rows:rows };
    // private virtual albums hidden
    }).filter(function(v){ return owner || v.is_public; });
    return virt.concat((res[2].data||[]).map(function(a){
      return { id:a.id, virt:false, name:a.name, item_count:a.item_count,
               covers:a.covers||[], is_public:a.is_public !== false };
    }));
  }

  // profile albums tab
  async function albLoadProfileTab(){
    if(!pf.profile) return;
    var grid = document.getElementById('pfAlbumGrid');
    var empty = document.getElementById('pfAlbumEmpty');
    if(!grid) return;
    if(pf.albumsLoaded){ albRenderProfileTab(); return; }
    empty.style.display = 'none';
    grid.innerHTML = '<div class="albLoading">Loading\u2026</div>';
    var forId = pf.profile.id, scope = dzScope();
    try{
      var strip = await albFetchStrip(forId);
      // drop if another profile opened, or another account signed in
      if(!dzScopeStill(scope) || !pf.profile || String(pf.profile.id) !== String(forId)) return;
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
    // no create tile here
    grid.innerHTML = (pf.albums||[]).map(function(a){ return albCardHTML('pf', a); }).join('');
    // strip is never empty
    if(empty) empty.style.display = 'none';
  }

  // albums manager page
  async function albLoadMine(force){
    if(!currentUser){ albResetMine(); return; }
    if(albMineLoaded && !force){ albRenderManager(); return; }
    var grid = document.getElementById('albGrid');
    if(grid && !albMine.length) grid.innerHTML = '<div class="albLoading">Loading\u2026</div>';
    var scope = dzScope(), forId = String(currentUser.id);
    try{
      var strip = await albFetchStrip(forId);
      // a different account signed in while this was in flight: these are
      // somebody else's Likes and Bookmarks and they are not rendered here
      if(!dzScopeStill(scope)) return;
      albMine = strip;
      albMineLoaded = true;
      albRenderManager();
    }catch(e){
      if(!dzScopeStill(scope)) return;
      if(grid) grid.innerHTML = '<div class="albLoading">Couldn\u2019t load \u2014 try again.</div>';
    }
  }

  // Likes, Bookmarks and albums are one member's. When the session changes
  // they are not this member's any more, so they are dropped rather than
  // left on screen for whoever signs in next.
  function albResetMine(){
    albMine = []; albMineLoaded = false; albTier = 'guest';
    var grid = document.getElementById('albGrid');
    if(grid) grid.innerHTML = '';
    if(albView && albView.src === 'me'){
      albView = null;
      var vp = document.getElementById('albViewPage');
      if(vp) vp.classList.remove('open');
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
    document.body.style.overflow = 'hidden';
    albLoadMine(false);
  }
  function albClosePage(){
    document.getElementById('albPage').classList.remove('open');
    restoreScroll();
  }

  // one album contents
  function albFind(src, id){
    var list = (src === 'me') ? albMine : (pf.albums || []);
    return list.filter(function(a){ return String(a.id) === String(id); })[0] || null;
  }
  async function albOpen(src, id){
    var a = albFind(src, id);
    if(!a) return;
    // virtual albums are read only
    var owner = !a.virt && (src === 'me' || !!pf.isOwner);
    albView = { src:src, id:String(id), virt:!!a.virt, name:a.name, owner:owner, rows:null };
    document.getElementById('albViewTitle').innerHTML = esc(String(a.name||'').toUpperCase());
    document.getElementById('albViewActs').style.display = owner ? '' : 'none';
    document.getElementById('albViewPage').classList.add('open');
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
      if(!albView || albView.id !== String(id)) return;   // superseded
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
  // reuse saved card markup
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
  // patch strip after edit
  function albPatchStrip(src, id, rows){
    var a = albFind(src, id);
    if(!a) return;
    a.item_count = rows.length;
    a.covers = rows.slice(0,4).map(function(r){ return r.image_url; });
    if(src === 'me') albRenderManager(); else albRenderProfileTab();
  }

  // album menu
  var albMenuEl = null;
  function albMenuClose(){
    if(albMenuEl && albMenuEl.parentNode) albMenuEl.parentNode.removeChild(albMenuEl);
    albMenuEl = null;
    document.removeEventListener('click', albMenuClose, true);
    window.removeEventListener('resize', albMenuClose, true);
    window.removeEventListener('scroll', albMenuClose, true);
  }
  function albMenuOpen(ev, src, id){
    ev.preventDefault(); ev.stopPropagation();
    var wasOpen = !!albMenuEl;
    albMenuClose();
    if(wasOpen) return;                       // second tap closes
    var a = albFind(src, id);
    if(!a || !albCanManage(src, a)) return;
    var pub = (a.is_public !== false);
    var sid = esc(String(src)), aid = esc(String(id));
    var html = '';
    if(!a.virt){
      html += '<button type="button" class="albMenuItem" onclick="albMenuRename(\'' + sid + '\',\'' + aid + '\')">Rename</button>';
    }
    html += '<button type="button" class="albMenuItem" onclick="albMenuVis(\'' + sid + '\',\'' + aid + '\')">' +
            (pub ? 'Make private' : 'Make public') + '</button>';
    if(!a.virt){
      html += '<button type="button" class="albMenuItem albMenuDanger" onclick="albMenuDelete(\'' + sid + '\',\'' + aid + '\')">Delete</button>';
    }
    var m = document.createElement('div');
    m.className = 'albMenu'; m.setAttribute('role','menu'); m.innerHTML = html;
    document.body.appendChild(m);
    albMenuEl = m;
    // use viewport rect
    var r = ev.currentTarget.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var top = (r.bottom + 6 + mh > window.innerHeight) ? (r.top - mh - 6) : (r.bottom + 6);
    m.style.top  = Math.max(8, top) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    // capture phase, next frame
    setTimeout(function(){
      document.addEventListener('click', albMenuClose, true);
      window.addEventListener('resize', albMenuClose, true);
      window.addEventListener('scroll', albMenuClose, true);
    }, 0);
  }
  // public or private
  async function albMenuVis(src, id){
    var a = albFind(src, id);
    albMenuClose();
    if(!a || !albCanManage(src, a) || !currentUser) return;
    var next = (a.is_public === false);
    try{
      if(a.virt){
        var patch = {};
        patch[a.key === 'like' ? 'likes_public' : 'bookmarks_public'] = next;
        const{error} = await sb.from('profiles').update(patch).eq('id', currentUser.id);
        if(error) throw error;
      } else {
        const{error} = await sb.from('albums').update({is_public:next}).eq('id', id);
        if(error) throw error;
      }
      a.is_public = next;
      if(src === 'me') albRenderManager(); else albRenderProfileTab();
      showToast(next
        ? (a.virt ? a.name + ' are public now' : 'Album is public')
        : (a.virt ? a.name + ' are private now' : 'Album is private'));
    }catch(e){ showToast(safeErr(e, 'Couldn\u2019t update \u2014 try again')); }
  }
  function albMenuRename(src, id){
    var a = albFind(src, id);
    albMenuClose();
    if(!a || a.virt || !albCanManage(src, a)) return;
    albModMode = 'rename'; albModId = String(id);
    document.getElementById('albModTitle').innerHTML = 'RENAME ALBUM';
    document.getElementById('albModSave').textContent = 'Save';
    var inp = document.getElementById('albModIn'); inp.value = a.name || '';
    document.getElementById('albMod').classList.add('open');
    setTimeout(function(){ inp.focus(); inp.select(); }, 80);
  }
  async function albMenuDelete(src, id){
    var a = albFind(src, id);
    albMenuClose();
    if(!a || !albCanManage(src, a)) return;
    // never delete a virtual album
    if(a.virt){ showToast(a.name + ' can\u2019t be deleted'); return; }
    if(!confirm('Delete the album \u201C' + a.name + '\u201D?\n\nThe artworks inside are NOT deleted \u2014 only the album.')) return;
    try{
      const{error} = await sb.from('albums').delete().eq('id', id);
      if(error) throw error;
      if(albView && String(albView.id) === String(id)) albCloseView();
      showToast('Album deleted');
      await albRefreshAll();
    }catch(e){ showToast(safeErr(e, 'Couldn\u2019t delete \u2014 try again')); }
  }

  // create and rename popup
  function albCreatePrompt(){
    if(!currentUser){ showToast('Sign in to create albums'); if(typeof openAuthMod==='function') openAuthMod(); return; }
    // cap check before round trip
    if(albMineLoaded && albRealCount() >= albCap()){
      showToast(albCap() >= 30
        ? 'You\u2019ve reached the 30 album limit'
        : 'Album limit reached (25) \u2014 Premium or Max raises it to 30');
      return;
    }
    albModMode = 'new'; albModId = null;
    document.getElementById('albModTitle').innerHTML = 'NEW ALBUM';
    document.getElementById('albModSave').textContent = 'Create';
    var inp = document.getElementById('albModIn'); inp.value = '';
    document.getElementById('albMod').classList.add('open');
    setTimeout(function(){ inp.focus(); }, 80);
  }
  function albRenamePrompt(){
    if(!albView || !albView.owner) return;
    albModMode = 'rename'; albModId = albView.id;
    document.getElementById('albModTitle').innerHTML = 'RENAME ALBUM';
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
          document.getElementById('albViewTitle').innerHTML = esc(name.toUpperCase());
        }
        albModClose();
        showToast('Album renamed');
        await albRefreshAll();
      } else {
        const{data,error} = await sb.from('albums').insert({user_id:currentUser.id, name:name}).select().single();
        if(error) throw error;
        // tick it if opened from upload
        if(data && data.id && pf.upAlbums.indexOf(String(data.id)) === -1) pf.upAlbums.push(String(data.id));
        albModClose();
        showToast('Album created');
        await albRefreshAll();
      }
    }catch(e){
      // read raw message first
      var raw = (e && e.message) ? String(e.message) : '';
      showToast(
        /albums_user_name_uniq|duplicate key/i.test(raw) ? 'You already have an album with that name' :
        /albums_name_reserved/i.test(raw)                ? 'That name is reserved \u2014 pick another' :
        /albums_name_len/i.test(raw)                     ? 'Album names are 1\u201340 characters' :
        /Album limit/i.test(raw)                         ? (albCap() >= 30
            ? 'You\u2019ve reached the 30 album limit'
            : 'Album limit reached (25) \u2014 Premium or Max raises it to 30') :
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
  // repaint every album surface
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

  // escape unwinds innermost first
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var mod = document.getElementById('albMod');
    if(mod && mod.classList.contains('open')){ albModClose(); return; }
    var vw = document.getElementById('albViewPage');
    if(vw && vw.classList.contains('open')){ albCloseView(); return; }
    var pg = document.getElementById('albPage');
    if(pg && pg.classList.contains('open')) albClosePage();
  });

  // upload page picker
  function togglePfAlbumDd(e){
    if(e) e.stopPropagation();
    var dd = document.getElementById('pfUpAlbumDd');
    // One panel at a time, and that includes the rows js/sections.js injects
    // into this form — closing only the hand-written ones let a member stack
    // this open on top of one of those.
    if(typeof dzCloseMenus === 'function') dzCloseMenus(dd);
    closePfCatDd(); closePfSoftwareDd();
    dd.classList.toggle('open');
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
    // ten albums is the ceiling, and the eleventh tick simply does not take
    panel.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c){
      if(picked.length >= 10){ c.checked = false; showToast('That is the limit — 10 albums'); return; }
      picked.push(c.value);
    });
    pf.upAlbums = picked;
    var names = picked.map(function(id){
      var a = albMine.filter(function(x){ return String(x.id) === String(id); })[0];
      return a ? a.name : '';
    }).filter(Boolean);
    var lbl = document.getElementById('pfUpAlbumTriggerLbl');
    if(lbl) lbl.textContent = names.length ? names.join(', ') : 'None';
  }
  // attach artwork to albums
  async function albAttach(artworkId, albumIds){
    if(!artworkId || !albumIds || !albumIds.length) return;
    try{
      const{error} = await sb.from('album_items')
        .insert(albumIds.map(function(id){ return {album_id:id, artwork_id:artworkId}; }));
      if(error) throw error;
      // force refetch next open
      albMineLoaded = false;
      if(pf.profile && currentUser && String(pf.profile.id) === String(currentUser.id)) pf.albumsLoaded = false;
    }catch(e){
      console.error('albAttach:', e && e.message);
      showToast('Artwork is live, but couldn\u2019t be added to your album(s)');
    }
  }

  // gallery tab, paged
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
  // skeleton tiles while fetching
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
  /* The gallery is paged by offset, and two things move rows in and out of it
     without asking the server: an upload puts a new row on top, and a delete
     takes one out. Both shift every window after them by one, so the index of
     what has been drawn and the count of what has been fetched have to move
     with them — otherwise the next page either repeats a row or steps over
     one. These three are the only things that touch either. */
  function pfGalleryHas(id){
    if(!pf.galleryIds) pf.galleryIds = Object.create(null);
    return pf.galleryIds[String(id)] === true;
  }
  // a row that arrived without being fetched: an upload landing on your own
  // profile. It occupies a place in the server's order, so the window starts
  // one later than it otherwise would.
  function pfGalleryAdopt(id){
    if(!pf.galleryIds) pf.galleryIds = Object.create(null);
    if(pf.galleryIds[String(id)] === true) return;
    pf.galleryIds[String(id)] = true;
    pf.galleryOffset = (pf.galleryOffset || 0) + 1;
  }
  // and a row that has gone. Forgetting the id matters as much as the count:
  // if it were left behind, the same artwork could never be drawn again.
  function pfGalleryForget(id){
    if(!pf.galleryIds) pf.galleryIds = Object.create(null);
    if(pf.galleryIds[String(id)] !== true) return;
    delete pf.galleryIds[String(id)];
    pf.galleryOffset = Math.max(0, (pf.galleryOffset || 0) - 1);
  }
  async function pfLoadMoreGallery(){
    if(!pf.profile || pf.galleryDone || pf.galleryBusy) return;
    pf.galleryBusy = true;
    pfEnsureGallerySentinel();
    // the window counts rows fetched, not rows kept: dropping a duplicate
    // must not walk the offset backwards and re-fetch the same page forever
    var seen = pf.galleryOffset || 0;
    var size = seen ? gridStepBatch() : gridInitialBatch();
    var from = seen, to = from + size - 1;
    // what this page is being fetched for. Both can change while it is in
    // flight — a different profile opened, a different account signed in —
    // and a page that arrives for the wrong one is not appended to the wrong
    // grid, it is dropped.
    var scope = dzScope(), forId = String(pf.profile.id);
    pfGallerySkeleton(size);
    try{
      // range() windows only line up if the sort is total. created_at is not:
      // a queued upload writes several rows in the same instant, and rows
      // that tie can come back in either order, which is how one artwork
      // ended up in two pages. id breaks every tie the same way each time.
      // A profile gallery shows what that member published. Their own drafts
      // and hidden pieces are theirs to see; a visitor gets neither.
      var _own = !!currentUser && String(currentUser.id) === String(forId);
      var _q = sb.from('artworks').select('*')
        .eq('user_id',forId).eq('kind',ART_KIND_ART);
      if(!_own) _q = _q.eq('visibility','published');
      const{data,error}=await _q
        .order('created_at',{ascending:false}).order('id',{ascending:false})
        .range(from,to);
      if(error) throw error;
      if(!dzScopeStill(scope) || !pf.profile || String(pf.profile.id) !== forId){
        pf.galleryBusy = false;   // superseded, and its skeleton went with it
        return;
      }
      var all = data||[];
      pf.galleryOffset = seen + all.length;
      if(all.length < size) pf.galleryDone = true;
      // belt and braces: a tie the database broke differently, a retry, an
      // overlapping window — whatever the cause, an id already on the page
      // does not go on it twice
      var rows = all.filter(function(a){ return !pfGalleryHas(a.id); });
      rows.forEach(function(a){ pf.galleryIds[String(a.id)] = true; });
      pf.galleryRows = pf.galleryRows.concat(rows);
      rows.forEach(function(a){
        // approved rows only
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
    // queue cards on own profile
    var own = (typeof upq==='object' && currentUser && pf.profile && String(pf.profile.id)===String(currentUser.id));
    var qHtml = own ? upqOwnQueueHTML() : '';
    grid.innerHTML = qHtml + pf.galleryRows.map(pfGalleryCardHTML).join('');
    document.getElementById('pfGalleryEmpty').style.display = (pf.galleryRows.length || qHtml) ? 'none' : '';
    pfGallerySentinelSync();
  }
  // the card is the thumbnail — the title, date and tags belong to the
  // artwork view, which is one tap away
  function pfGalleryCardHTML(a){
    return '<div class="awCard" onclick="pfOpenArtwork(\''+esc(String(a.id))+'\')">'+
      '<div class="awImgWrap awLoading"><img loading="lazy" onload="this.parentNode.classList.remove(\'awLoading\')" onerror="this.parentNode.classList.remove(\'awLoading\')" '+dzThumbAttrs(a.image_url)+' alt="'+esc(a.name||'')+'" style="'+thumbStyle(a.thumb_x, a.thumb_y, a.thumb_zoom)+'">'+
      '</div></div>';
  }
  function pfOpenArtwork(id){
    // look in gallery rows first
    var art = pf.galleryRows.find(function(a){ return String(a.id)===String(id); }) || findArtworkById(id);
    if(!art) return;
    var cats=catList(art.category).length?catList(art.category):(catList(art.tags).length?catList(art.tags):['others']);
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), true, pf.galleryRows);
  }

  // about tab
  async function pfLoadStats(){
    try{
      const artC = await sb.from('artworks').select('id',{count:'exact',head:true}).eq('user_id',pf.profile.id).eq('kind',ART_KIND_ART);
      document.getElementById('pfStatArt').textContent = artC.count||0;
    }catch(e){ /* non fatal */ }
  }
  // default bio
  var PF_DEFAULT_BIO = 'Just a regular human who likes art and creativity.';
  var PF_HEAD_BIO_LIMIT = 100;
  var PF_USERNAME_COOLDOWN_MS = 90*24*3600*1000;

  // next handle change date
  function pfUsernameNextChange(){
    if(!pf.profile) return null;
    if(pf.profile.role === 'dev') return null;
    if(!pf.profile.username_changed_at) return null;
    var next = new Date(pf.profile.username_changed_at).getTime() + PF_USERNAME_COOLDOWN_MS;
    return (isFinite(next) && next > Date.now()) ? new Date(next) : null;
  }

  // compact counts
  function pfFmtCount(n){
    n = +n || 0;
    if(n >= 1e6) return (n/1e6).toFixed(n%1e6 >= 1e5 ? 1 : 0).replace(/\.0$/,'') + 'M';
    if(n >= 1e3) return (n/1e3).toFixed(n%1e3 >= 100 ? 1 : 0).replace(/\.0$/,'') + 'K';
    return String(n);
  }

  // one number per tile. Merit is not one of them \u2014 it is a moderation
  // score, so it reads in About with the sentence that explains it
  function pfPaintStats(likes, views, bms, level, merit, cred){
    function set(id, val){ var e=document.getElementById(id); if(e) e.textContent = val; }
    // Likes and views are summed here from the artwork rows in hand, which is
    // capped and therefore an estimate. get_profile_engagement returns the
    // real totals and stamps the tile when it lands. Whichever of the two
    // arrives first, the database's answer is the one left standing.
    function setTotal(id, val){
      var e = document.getElementById(id);
      if(!e) return;
      var owned = pf.profile && e.dataset.total === String(pf.profile.id);
      if(!owned) e.textContent = val;
    }
    setTotal('pfStatLikes', pfFmtCount(likes));
    setTotal('pfStatViews', pfFmtCount(views));
    set('pfStatSaves', pfFmtCount(bms));
    set('pfStatCred',  pfFmtCount(cred));
    set('pfStatLevel', level);
    set('pfStatMerit', merit);
    var row = document.getElementById('pfStatsRow');
    if(row) row.hidden = false;
    // low merit mark
    var warn = document.getElementById('pfWarnMark');
    if(warn) warn.classList.toggle('on', merit <= 20);
    // milestone color
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
      if(!pf.profile || pf.profile.id !== forId) return;  // stale, another profile opened
      // log the error
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
    // cred formula
    pfCredTotal = 100*(+pf.profile.cred_received_count || 0) + 2*likes + 5*bms;
    pfPaintStats(likes, views, bms, level, merit, pfCredTotal);
  }

  // action row
  var pfCredTotal = 0;              // cred value in stats row
  var pfCredited = false, pfCredBusy = false, pfFrBusy = false;

  // each action button is an icon and a label, so only the label is rewritten
  function pfActLabel(btn, text){
    var span = btn.querySelector('.pfActTxt');
    if(span) span.textContent = text; else btn.textContent = text;
    btn.setAttribute('aria-label', text);
  }
  function pfPaintCredBtn(){
    var b = document.getElementById('pfBtnCred'); if(!b) return;
    pfActLabel(b, pfCredited ? 'Credited' : 'Cred');
    b.classList.toggle('on', pfCredited);
  }
  function pfPaintFriendBtn(state){
    var b = document.getElementById('pfBtnFriend'); if(!b) return;
    var map = { none:'Add friend', sent:'Requested', incoming:'Accept', friends:'Message' };
    if(state === 'blocked_by_me' || state === 'blocked'){ b.hidden = true; return; }
    b.hidden = false;
    pfActLabel(b, map[state] || 'Add friend');
    b.classList.toggle('pfActBtn--pri', state !== 'sent');
    b.dataset.frState = state || 'none';
  }

  async function pfLoadActionRow(){
    var row = document.getElementById('pfActionRow');
    if(!row || !pf.profile) return;
    var bF = document.getElementById('pfBtnFriend'),
        bC = document.getElementById('pfBtnCred'),
        bE = document.getElementById('pfBtnEdit');
    row.hidden = false;
    if(pf.isOwner){
      // your own profile: edit and share. Settings live in the top bar menu
      if(bF) bF.hidden = true;
      if(bC) bC.hidden = true;
      if(bE) bE.hidden = false;
      return;
    }
    if(bE) bE.hidden = true;
    if(bC) bC.hidden = false;
    var forId = pf.profile.id;
    pfCredited = false; pfPaintCredBtn(); pfPaintFriendBtn('none');
    if(!currentUser) return;   // logged out defaults
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
    }catch(e){ /* actions still re check */ }
  }

  async function pfCredToggle(){
    if(!pf.profile || pf.isOwner || pfCredBusy) return;
    if(!currentUser){ showToast('Sign in to cred artists'); openAuthMod(); return; }
    var forId = pf.profile.id;
    var tileEl = document.getElementById('pfStatCred');
    pfCredBusy = true;
    // optimistic flip
    var was = pfCredited;
    pfCredited = !was; pfPaintCredBtn();
    pfCredTotal += pfCredited ? 100 : -100;
    if(tileEl) tileEl.textContent = pfFmtCount(Math.max(pfCredTotal,0));
    try{
      if(was){
        var d = await sb.from('profile_creds').delete()
          .eq('giver_id', currentUser.id).eq('receiver_id', forId);
        if(d.error) throw d.error;
      } else {
        var i = await sb.from('profile_creds').insert({ giver_id: currentUser.id, receiver_id: forId });
        if(i.error && i.error.code !== '23505') throw i.error;  // duplicate means already credited
        // Their Analytics is watching for this and updates the moment it
        // lands. The row it writes carries no giver — profile_creds only ever
        // let the giver read their own rows and that does not change here.
        if(typeof window.dzAnTrack === 'function') window.dzAnTrack('cred', null, { scope:'profile', owner: String(forId) });
      }
      pf.profile.cred_received_count = Math.max((+pf.profile.cred_received_count||0) + (pfCredited?1:-1), 0);
    }catch(e){
      pfCredited = was; pfPaintCredBtn();                        // roll back
      pfCredTotal += pfCredited ? 100 : -100;
      if(tileEl) tileEl.textContent = pfFmtCount(Math.max(pfCredTotal,0));
      showToast('Couldn\u2019t update cred \u2014 try again');
    }finally{ pfCredBusy = false; }
  }

  async function pfFriendBtnTap(){
    if(!pf.profile || pf.isOwner || pfFrBusy || !window.pfFriendBridge) return;
    if(!currentUser){ showToast('Sign in to add friends'); openAuthMod(); return; }
    var b = document.getElementById('pfBtnFriend'); if(!b) return;
    var st = b.dataset.frState || 'none', forId = pf.profile.id;
    if(st === 'friends'){
      // message opens dm
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

  // header bio teaser
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
    bio = bio.replace(/\s+/g, ' ');           // collapse newlines
    el.textContent = '';
    if(bio.length <= PF_HEAD_BIO_LIMIT){ el.textContent = bio; return; }
    var cut = bio.slice(0, PF_HEAD_BIO_LIMIT);
    var sp  = cut.lastIndexOf(' ');
    if(sp > 60) cut = cut.slice(0, sp);       // avoid chopping mid word
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

  // connect, social links
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
      // only http urls render
      var safe = (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) ? url.trim() : null;
      return safe
        ? '<a class="pfConnectItem pfConnectItem--on" href="'+esc(safe)+'" target="_blank" rel="noopener noreferrer">'+p.label+'</a>'
        : '<span class="pfConnectItem pfConnectItem--off">'+p.label+'</span>';
    }).join('');
  }
  // validate a typed link
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

  // upload popup
  pf.upCats = ['others'];
  pf.upTags = [];

  function pfUpdateCount(inputId,countId,max){
    var v = document.getElementById(inputId).value.length;
    document.getElementById(countId).textContent = v+'/'+max;
  }

  // category dropdown
  function togglePfCatDd(e){
    if(e) e.stopPropagation();
    var dd = document.getElementById('pfUpCatDd');
    // one dropdown at a time, injected rows included
    if(typeof dzCloseMenus === 'function') dzCloseMenus(dd);
    closePfSoftwareDd();
    if(typeof closePfAlbumDd==='function') closePfAlbumDd();
    dd.classList.toggle('open');
    // fresh search, no autofocus
    pfResetCatSearch();
  }
  function closePfCatDd(){
    document.getElementById('pfUpCatDd').classList.remove('open');
    pfResetCatSearch();
  }
  // category search
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
    // show real labels
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

  // software dropdown
  function togglePfSoftwareDd(e){
    if(e) e.stopPropagation();
    closePfCatDd(); // one dropdown at a time
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

  // tag chip input
  function pfRenderTagChips(){
    var host = document.getElementById('pfUpTagChips');
    host.innerHTML = pf.upTags.map(function(t,i){
      return '<span class="upTagChip">'+esc(t)+'<button type="button" onclick="pfRemoveTag('+i+',event)" aria-label="Remove tag">✕</button></span>';
    }).join('');
    document.getElementById('pfUpTags').value = pf.upTags.join(',');
  }
  // tag length cap
  // 30, the same ceiling the tag input carries, the other four forms use and
  // the artworks table checks. It was 15 here, so a perfectly legal 20
  // character tag was refused outright by the one form that has always had
  // tags.
  var TAG_MAX = 30;
  // "character, birds, nature" is three tags, not one with commas in it —
  // however it arrived, and however the member finished typing it.
  function pfAddTag(raw){
    var added = 0, full = false, cut = false;
    String(raw == null ? '' : raw).split(/[,\n]/).forEach(function(part){
      var t = part.trim().replace(/^#+/, '').trim();
      if(!t) return;
      if(t.length > TAG_MAX){ t = t.slice(0, TAG_MAX); cut = true; }
      if(pf.upTags.length >= 10){ full = true; return; }
      if(pf.upTags.some(function(x){ return x.toLowerCase() === t.toLowerCase(); })) return;
      pf.upTags.push(t); added++;
    });
    if(full)     showToast('Up to 10 tags allowed');
    else if(cut) showToast('Tags are up to '+TAG_MAX+' characters');
    if(added) pfRenderTagChips();
  }
  function pfRemoveTag(i,e){
    if(e) e.stopPropagation();
    pf.upTags.splice(i,1);
    pfRenderTagChips();
  }
  function pfSetTagsFromArray(arr){
    // drop over long draft tags
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
  // Leaving the box finishes the tag. Typing one and going straight to Upload
  // used to lose it, which reads as the box not working.
  function pfTagBlur(e){
    var input = e.target;
    if(input && String(input.value||'').trim()){ pfAddTag(input.value); input.value=''; }
  }
  // a pasted list is a list; a pasted word is just typing
  function pfTagPaste(e){
    var cb = e.clipboardData || window.clipboardData;
    var txt = cb ? cb.getData('text') : '';
    if(!txt || !/[,\n]/.test(txt)) return;
    e.preventDefault();
    var input = e.target;
    pfAddTag(input.value + txt);
    input.value = '';
  }

  // guest gate
  function pfGuestGate(e){
    if(currentUser) return false;
    if(e && typeof e.preventDefault==='function'){ e.preventDefault(); e.stopPropagation(); }
    sessionStorage.setItem('pendPfUp','1');
    closePfUpload();
    showToast('Sign in to upload');
    openAuthMod();
    return true;
  }

  // ---- the artwork dropzone's picked face --------------------------------
  // The marketplace picker already had the right idea: once a file is chosen
  // the dashed invite steps aside for a row that shows the thumbnail, names the
  // file and says it is ready. The artwork zone wears the same face.
  function pfPaintPicked(o){
    var dz = document.getElementById('pfDz');
    if(!dz) return;
    if(!o){ dz.classList.remove('dzHasFile'); return; }
    var set = function(id, tx){ var el = document.getElementById(id); if(el) el.textContent = tx; };
    set('pfUpFileNm', o.name || 'Selected image');
    var sz = o.size && window.dzHelpers ? window.dzHelpers.bytes(o.size) : '';
    set('pfUpFileSz', sz || o.meta || 'Image');
    set('pfUpFileOk', o.note || 'Ready to publish');
    // an edit shows what is already published — there is nothing to swap here
    var acts = document.getElementById('pfUpFileActs');
    if(acts) acts.style.display = o.locked ? 'none' : '';
    var pw = document.getElementById('pfUpPrevWrap');
    if(pw) pw.style.display = '';
    dz.classList.add('dzHasFile');
  }
  // Replace and Remove, the two the marketplace rows carry
  function pfReplaceFile(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    if(pfGuestGate(e)) return;
    var input = document.getElementById('pfUpF');
    if(input){ input.value = ''; input.click(); }
  }
  function pfClearFile(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    pf.upFile = null;
    pf.upThumbFocus = null;
    if(typeof dzAutoScan === 'function') dzAutoScan('artwork');
    var input = document.getElementById('pfUpF'); if(input) input.value = '';
    var prev = document.getElementById('pfUpPrev');
    if(prev){ prev.removeAttribute('style'); prev.removeAttribute('src'); }
    pfPaintPicked(null);
  }

  // reset upload session
  function pfUpResetSession(){
    pf.upFile = null;
    pf.upPageFiles = [];
    pf.upThumbFocus = null;      // was surviving an upload
    pfCropPending = null;
    updrActiveId = null;
    var prev = document.getElementById('pfUpPrev');
    if(prev){ prev.removeAttribute('style'); prev.removeAttribute('src'); }
    var _upf = document.getElementById('pfUpF'); if(_upf) _upf.value = '';
    pfPaintPicked(null);
    var pp = document.getElementById('pfPagesPreview'); if(pp) pp.innerHTML = '';
    var nm = document.getElementById('pfUpNm');   if(nm) nm.value = '';
    var ds = document.getElementById('pfUpDesc'); if(ds) ds.value = '';
    pfUpdateCount('pfUpNm','pfUpNmCount',100);
    pfUpdateCount('pfUpDesc','pfUpDescCount',5000);
    // the fields js/sections.js injected into this panel clear with the rest
    if(typeof dzArtReset === 'function') dzArtReset();
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
    // universal upload
    pfUpResetSession();
    document.getElementById('pfUpEditId').value = '';
    document.getElementById('pfUpTitle').textContent = 'Upload Artwork';
    document.getElementById('pfUpSubtitle').textContent = 'Share your creativity with artists around the world.';
    document.getElementById('pfUpNavTitle').textContent = 'UPLOAD';
    document.getElementById('pfDzTxt').textContent = 'Drag & drop your artwork here';
    document.getElementById('pfUpCatField').style.display = '';
    // optional extra images
    document.getElementById('pfComicPagesWrap').style.display = '';
    // The badge is markup now, not a character, so it is left alone — writing
    // textContent here would delete the svg and leave the tile empty. Only the
    // words this panel changes are written.
    document.getElementById('pfDzPagesTitle').textContent = 'Add more images (optional)';
    document.getElementById('pfDzPagesSub').textContent   = 'The image above stays the cover. Add as many extras as you like.';
    document.getElementById('pfUpSoftwareField').style.display = '';
    // optional album picker
    var _albF = document.getElementById('pfUpAlbumField'); if(_albF) _albF.style.display = '';
    if(typeof albLoadMine==='function') albLoadMine(false).then(albUpRender, function(){});
    var _drB = document.getElementById('pfDraftBtn'); if(_drB) _drB.style.display = '';
    var _bkB = document.getElementById('pfUpBackBtn'); if(_bkB) _bkB.style.display = 'none';
    var _schF = document.getElementById('pfUpSchedField'); if(_schF) _schF.style.display = '';
    updrLoadStrip(); // purges old drafts too
    uschLoad();      // scheduled rail
    document.getElementById('pfDz').style.display='';
    document.getElementById('pfUpBtn').textContent = '📤 Upload Artwork';
    document.getElementById('pfUpMod').classList.add('open');
    if(typeof upGrowAll === 'function') upGrowAll();
    // page mode locks scroll
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function closePfUpload(){
    // edit id tells the modes apart
    var wasEdit = !!document.getElementById('pfUpEditId').value;
    document.getElementById('pfUpMod').classList.remove('open');
    closePfCatDd();
    pf.upFile = null; pf.upThumbFocus = null; pf.upPageFiles = [];
    // restore scroll is safe in both
    restoreScroll();
    if(!wasEdit){
      // nav falls back to home
      if(typeof bnSetActive==='function') bnSetActive('bnHome');
    }
  }
  function handlePfFile(e){
    if(pfGuestGate(e)) return; // drop bypasses click gate
    var f = e.target.files[0]; if(!f) return;
    // 20MB, refused here rather than after the crop dialog and the upload
    if(f.size > 20 * 1024 * 1024){
      showToast('That image is over 20MB — pick a smaller one');
      e.target.value = '';
      return;
    }
    if(!document.getElementById('pfUpNm').value.trim()){
      document.getElementById('pfUpNm').value = f.name.replace(/\.[^.]+$/,'');
      pfUpdateCount('pfUpNm','pfUpNmCount',100);
    }
    var r = new FileReader();
    r.onload = function(ev){ openPfCrop(f, ev.target.result); };
    r.readAsDataURL(f);
  }

  // thumbnail focal point picker
