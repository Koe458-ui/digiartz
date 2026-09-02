  var ALB_VIRT = {
    like:     { name:'Likes',     rpc:'get_user_liked_artworks',      ico:'\u2665' },
    bookmark: { name:'Bookmarks', rpc:'get_user_bookmarked_artworks', ico:'\u2756' }
  };
  var albMine = [], albMineLoaded = false;
  var albTier = 'guest';
  function albCap(){ return (albTier === 'premium' || albTier === 'max') ? 30 : 25; }
  function albRealCount(){ return albMine.filter(function(a){ return !a.virt; }).length; }
  var albView = null;
  var albModMode = null, albModId = null;

  function albMosaicHTML(covers){
    var c = Array.isArray(covers) ? covers : [], out = '';
    for(var i=0; i<4; i++){
      out += c[i]
        ? '<span class="albCell"><img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(c[i]))+'" alt=""></span>'
        : '<span class="albCell albCellEmpty"></span>';
    }
    return '<span class="albMosaic">'+out+'</span>';
  }
  function albCanManage(src, a){
    if(!currentUser) return false;
    return src === 'me' || !!pf.isOwner;
  }
  function albCardHTML(src, a){
    var n = +a.item_count || 0;
    var id = esc(String(a.id));
    var priv = (a.is_public === false);
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

  async function albFetchStrip(userId){
    if(!sb) return [];
    function soft(p){ return p.then(function(r){ return r && !r.error ? r : {data:[]}; },
                                    function(){ return {data:[]}; }); }
    function soft1(p){ return p.then(function(r){ return r && !r.error && r.data ? r : {data:{}}; },
                                     function(){ return {data:{}}; }); }
    var res = await Promise.all([
      soft(sb.rpc('get_user_liked_artworks',      {target:userId, lim:100, off:0})),
      soft(sb.rpc('get_user_bookmarked_artworks', {target:userId, lim:100, off:0})),
      soft(sb.rpc('get_user_albums',              {target:userId})),
      soft1(sb.from('profiles')
              .select('likes_public,bookmarks_public,subscription_tier,subscription_expires_at')
              .eq('id', userId).maybeSingle())
    ]);
    var flags = res[3].data || {};
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
    }).filter(function(v){ return owner || v.is_public; });
    return virt.concat((res[2].data||[]).map(function(a){
      return { id:a.id, virt:false, name:a.name, item_count:a.item_count,
               covers:a.covers||[], is_public:a.is_public !== false };
    }));
  }

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
    grid.innerHTML = (pf.albums||[]).map(function(a){ return albCardHTML('pf', a); }).join('');
    if(empty) empty.style.display = 'none';
  }

  async function albLoadMine(force){
    if(!currentUser){ albResetMine(); return; }
    if(albMineLoaded && !force){ albRenderManager(); return; }
    var grid = document.getElementById('albGrid');
    if(grid && !albMine.length) grid.innerHTML = '<div class="albLoading">Loading\u2026</div>';
    var scope = dzScope(), forId = String(currentUser.id);
    try{
      var strip = await albFetchStrip(forId);
      if(!dzScopeStill(scope)) return;
      albMine = strip;
      albMineLoaded = true;
      albRenderManager();
    }catch(e){
      if(!dzScopeStill(scope)) return;
      if(grid) grid.innerHTML = '<div class="albLoading">Couldn\u2019t load \u2014 try again.</div>';
    }
  }

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
    dzPanelOpen('albPage');
    albLoadMine(false);
  }
  function albClosePage(){ dzPanelShut('albPage'); }

  function albFind(src, id){
    var list = (src === 'me') ? albMine : (pf.albums || []);
    return list.filter(function(a){ return String(a.id) === String(id); })[0] || null;
  }
  async function albOpen(src, id){
    var a = albFind(src, id);
    if(!a) return;
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
      if(!albView || albView.id !== String(id)) return;
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

  function albItemHTML(a){
    var card = pfGalleryCardHTML(a, 'albOpenPicture');
    if(!albView || !albView.owner) return card;
    return '<div class="albItemWrap">'+card+
      '<button type="button" class="albItemX" aria-label="Remove from album" '+
      'onclick="event.stopPropagation();albRemoveItem(\''+esc(String(a.id))+'\')">\u2715</button></div>';
  }

  function albOpenPicture(id){
    var rows = (albView && albView.rows) || [];
    var art = rows.filter(function(a){ return String(a.id)===String(id); })[0] ||
              (typeof findArtworkById === 'function' ? findArtworkById(id) : null);
    if(!art || !art.image_url) return;
    var shot = (typeof getViewUrl === 'function') ? getViewUrl(art.image_url) : art.image_url;
    if(typeof dzLightOpen === 'function') dzLightOpen(shot, art.name || '');
  }
  function albCloseView(){ dzPanelShut('albViewPage'); albView = null; }
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
  function albPatchStrip(src, id, rows){
    var a = albFind(src, id);
    if(!a) return;
    a.item_count = rows.length;
    a.covers = rows.slice(0,4).map(function(r){ return r.image_url; });
    if(src === 'me') albRenderManager(); else albRenderProfileTab();
  }

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
    if(wasOpen) return;
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
    var r = ev.currentTarget.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var top = (r.bottom + 6 + mh > window.innerHeight) ? (r.top - mh - 6) : (r.bottom + 6);
    m.style.top  = Math.max(8, top) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    setTimeout(function(){
      document.addEventListener('click', albMenuClose, true);
      window.addEventListener('resize', albMenuClose, { capture:true, passive:true });
      window.addEventListener('scroll', albMenuClose, { capture:true, passive:true });
    }, 0);
  }
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

  function albCreatePrompt(){
    if(!currentUser){ showToast('Sign in to create albums'); if(typeof openAuthMod==='function') openAuthMod(); return; }
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
        if(data && data.id && pf.upAlbums.indexOf(String(data.id)) === -1) pf.upAlbums.push(String(data.id));
        albModClose();
        showToast('Album created');
        await albRefreshAll();
      }
    }catch(e){
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

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var mod = document.getElementById('albMod');
    if(mod && mod.classList.contains('open')){ albModClose(); return; }
    var vw = document.getElementById('albViewPage');
    if(vw && vw.classList.contains('open')){ albCloseView(); return; }
    var pg = document.getElementById('albPage');
    if(pg && pg.classList.contains('open')) albClosePage();
  });

  function togglePfAlbumDd(e){
    if(e) e.stopPropagation();
    var dd = document.getElementById('pfUpAlbumDd');
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
  async function albAttach(artworkId, albumIds){
    if(!artworkId || !albumIds || !albumIds.length) return;
    try{
      const{error} = await sb.from('album_items')
        .insert(albumIds.map(function(id){ return {album_id:id, artwork_id:artworkId}; }));
      if(error) throw error;
      albMineLoaded = false;
      if(pf.profile && currentUser && String(pf.profile.id) === String(currentUser.id)) pf.albumsLoaded = false;
    }catch(e){
      console.error('albAttach:', e && e.message);
      showToast('Artwork is live, but couldn\u2019t be added to your album(s)');
    }
  }

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
  function pfGalleryHas(id){
    if(!pf.galleryIds) pf.galleryIds = Object.create(null);
    return pf.galleryIds[String(id)] === true;
  }
  function pfGalleryMark(id, keep){
    if(!pf.galleryIds) pf.galleryIds = Object.create(null);
    if((pf.galleryIds[String(id)] === true) === keep) return;
    if(keep) pf.galleryIds[String(id)] = true; else delete pf.galleryIds[String(id)];
    pf.galleryOffset = keep ? (pf.galleryOffset || 0) + 1
                            : Math.max(0, (pf.galleryOffset || 0) - 1);
  }
  function pfGalleryAdopt(id){ pfGalleryMark(id, true); }
  function pfGalleryForget(id){ pfGalleryMark(id, false); }
  async function pfLoadMoreGallery(){
    if(!pf.profile || pf.galleryDone || pf.galleryBusy) return;
    pf.galleryBusy = true;
    pfEnsureGallerySentinel();
    var seen = pf.galleryOffset || 0;
    var size = seen ? gridStepBatch() : gridInitialBatch();
    var from = seen, to = from + size - 1;
    var scope = dzScope(), forId = String(pf.profile.id);
    pfGallerySkeleton(size);
    try{
      var _own = !!currentUser && String(currentUser.id) === String(forId);
      var _load = async function(){
        var _q = sb.from('artworks').select('*')
          .eq('user_id',forId).eq('kind',ART_KIND_ART);
        if(!_own) _q = _q.eq('visibility','published');
        const{data:rows,error:qe}=await _q
          .order('created_at',{ascending:false}).order('id',{ascending:false})
          .range(from,to);
        if(qe) throw qe;
        return rows||[];
      };

      var data = (!_own && from === 0)
        ? await window.dzCached().getOrSet(
            'artist:artworks:' + forId + ':page1:' + size, _load, 'artist:artworks')
        : await _load();
      if(!dzScopeStill(scope) || !pf.profile || String(pf.profile.id) !== forId){
        pf.galleryBusy = false;
        return;
      }
      var all = data||[];
      pf.galleryOffset = seen + all.length;
      if(all.length < size) pf.galleryDone = true;
      var rows = all.filter(function(a){ return !pfGalleryHas(a.id); });
      rows.forEach(function(a){ pf.galleryIds[String(a.id)] = true; });
      pf.galleryRows = pf.galleryRows.concat(rows);
      rows.forEach(function(a){
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
    var own = (typeof upq==='object' && currentUser && pf.profile && String(pf.profile.id)===String(currentUser.id));
    var qHtml = own ? upqOwnQueueHTML() : '';
    grid.innerHTML = qHtml + pf.galleryRows.map(pfGalleryCardHTML).join('');
    document.getElementById('pfGalleryEmpty').style.display = (pf.galleryRows.length || qHtml) ? 'none' : '';
    pfGallerySentinelSync();
  }

  function pfGalleryCardHTML(a, opener){
    var open = (typeof opener === 'string' && opener) ? opener : 'pfOpenArtwork';
    return '<div class="awCard" onclick="'+open+'(\''+esc(String(a.id))+'\')">'+
      '<div class="awImgWrap awLoading"><img loading="lazy" onload="this.parentNode.classList.remove(\'awLoading\')" onerror="this.parentNode.classList.remove(\'awLoading\')" '+dzThumbAttrs(a.image_url)+' alt="'+esc(a.name||'')+'" style="'+thumbStyle(a.thumb_x, a.thumb_y, a.thumb_zoom)+'">'+
      '</div></div>';
  }
  function pfOpenArtwork(id){
    var art = pf.galleryRows.find(function(a){ return String(a.id)===String(id); }) || findArtworkById(id);
    if(!art) return;
    var cats=catList(art.category).length?catList(art.category):(catList(art.tags).length?catList(art.tags):['others']);
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), true, pf.galleryRows);
  }

  async function pfLoadStats(){
    try{
      const artC = await sb.from('artworks').select('id',{count:'exact',head:true}).eq('user_id',pf.profile.id).eq('kind',ART_KIND_ART);
      document.getElementById('pfStatArt').textContent = artC.count||0;
    }catch(e){   }
  }
  var PF_DEFAULT_BIO = 'Just a regular human who likes art and creativity.';
  var PF_HEAD_BIO_LIMIT = 100;
  var PF_USERNAME_COOLDOWN_MS = 90*24*3600*1000;

  function pfUsernameNextChange(){
    if(!pf.profile) return null;
    if(pf.profile.role === 'dev') return null;
    if(!pf.profile.username_changed_at) return null;
    var next = new Date(pf.profile.username_changed_at).getTime() + PF_USERNAME_COOLDOWN_MS;
    return (isFinite(next) && next > Date.now()) ? new Date(next) : null;
  }

  function pfFmtCount(n){
    n = +n || 0;
    if(n >= 1e6) return (n/1e6).toFixed(n%1e6 >= 1e5 ? 1 : 0).replace(/\.0$/,'') + 'M';
    if(n >= 1e3) return (n/1e3).toFixed(n%1e3 >= 100 ? 1 : 0).replace(/\.0$/,'') + 'K';
    return String(n);
  }

  function pfPaintStats(likes, views, bms, level, merit, cred){
    function set(id, val){ var e=document.getElementById(id); if(e) e.textContent = val; }
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
    var warn = document.getElementById('pfWarnMark');
    if(warn) warn.classList.toggle('on', merit <= 20);
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
      if(!pf.profile || pf.profile.id !== forId) return;
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
    }catch(e){   }

    if(!pf.profile || pf.profile.id !== forId) return;
    pfCredTotal = 100*(+pf.profile.cred_received_count || 0) + 2*likes + 5*bms;
    pfPaintStats(likes, views, bms, level, merit, pfCredTotal);
  }

  var pfCredTotal = 0;
  var pfCredited = false, pfCredBusy = false, pfFrBusy = false;

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
      if(bF) bF.hidden = true;
      if(bC) bC.hidden = true;
      if(bE) bE.hidden = false;
      return;
    }
    if(bE) bE.hidden = true;
    if(bC) bC.hidden = false;
    var forId = pf.profile.id;
    pfCredited = false; pfPaintCredBtn(); pfPaintFriendBtn('none');
    if(!currentUser) return;
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
    }catch(e){   }
  }

  async function pfCredToggle(){
    if(!pf.profile || pf.isOwner || pfCredBusy) return;
    if(!currentUser){ showToast('Sign in to cred artists'); openAuthMod(); return; }
    var forId = pf.profile.id;
    var tileEl = document.getElementById('pfStatCred');
    pfCredBusy = true;
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
        if(i.error && i.error.code !== '23505') throw i.error;
        if(typeof window.dzAnTrack === 'function') window.dzAnTrack('cred', null, { scope:'profile', owner: String(forId) });
      }
      pf.profile.cred_received_count = Math.max((+pf.profile.cred_received_count||0) + (pfCredited?1:-1), 0);
    }catch(e){
      pfCredited = was; pfPaintCredBtn();
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
    bio = bio.replace(/\s+/g, ' ');
    el.textContent = '';
    if(bio.length <= PF_HEAD_BIO_LIMIT){ el.textContent = bio; return; }
    var cut = bio.slice(0, PF_HEAD_BIO_LIMIT);
    var sp  = cut.lastIndexOf(' ');
    if(sp > 60) cut = cut.slice(0, sp);
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

  var PF_SOCIAL_PLATFORMS = [
    {key:'instagram', label:'Instagram', domains:['instagram.com','instagr.am'],
     icon:'<rect x="3" y="3" width="18" height="18" rx="5.2"/><circle cx="12" cy="12" r="4.1"/>'+
          '<circle cx="17.1" cy="6.9" r="1.15" fill="currentColor" stroke="none"/>'},
    {key:'facebook',  label:'Facebook',  domains:['facebook.com','fb.com','fb.me'],
     icon:'<rect x="3" y="3" width="18" height="18" rx="5.2"/>'+
          '<path d="M15.4 7.8h-1.7a2.4 2.4 0 0 0-2.4 2.4V21"/><path d="M9.2 13.4h5"/>'},
    {key:'youtube',   label:'YouTube',   domains:['youtube.com','youtu.be'],
     icon:'<rect x="2.2" y="5.6" width="19.6" height="12.8" rx="4.2"/>'+
          '<path d="M10.3 9.4 15.5 12l-5.2 2.6z" fill="currentColor"/>'},
    {key:'x',         label:'X',         domains:['x.com','twitter.com'],
     icon:'<path fill="currentColor" stroke="none" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17'+
          'l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833'+
          'L7.084 4.126H5.117z"/>'},
    {key:'tiktok',    label:'TikTok',    domains:['tiktok.com'],
     icon:'<path d="M14.3 3.2c.45 2.65 2 4.3 4.7 4.6"/>'+
          '<path d="M14.3 3.2v11.4a4 4 0 1 1-3.2-3.92"/>'},
    {key:'linkedin',  label:'LinkedIn',  domains:['linkedin.com'],
     icon:'<rect x="3" y="3" width="18" height="18" rx="5.2"/><path d="M7.5 10.6V17"/>'+
          '<circle cx="7.5" cy="7.4" r="1.15" fill="currentColor" stroke="none"/>'+
          '<path d="M11.4 17v-6.4"/><path d="M11.4 13.4a2.8 2.8 0 0 1 5.6 0V17"/>'},
    {key:'discord',   label:'Discord',   domains:['discord.gg','discord.com'],
     icon:'<path d="M8.8 4.2c-1.6.3-3.2.8-4.6 1.6-1.9 3.2-2.4 6.8-1.8 10.4 1.3 1.1 2.9 1.9 4.6 2.3'+
          'l1-1.7q4 2 8 0l1 1.7c1.7-.4 3.3-1.2 4.6-2.3.6-3.6.1-7.2-1.8-10.4-1.4-.8-3-1.3-4.6-1.6'+
          'l-.7 1.4q-2.45-.5-4.9 0z"/>'+
          '<ellipse cx="9.3" cy="12.5" rx="1.45" ry="1.85"/>'+
          '<ellipse cx="14.7" cy="12.5" rx="1.45" ry="1.85"/>'},
    {key:'reddit',    label:'Reddit',    domains:['reddit.com','redd.it'],
     icon:'<circle cx="12" cy="14" r="7.2"/><path d="M12 6.8V4.6c0-.8.6-1.4 1.4-1.4"/>'+
          '<circle cx="14.8" cy="3.2" r="1.3" fill="currentColor" stroke="none"/>'+
          '<circle cx="9.2" cy="13.2" r="1.15" fill="currentColor" stroke="none"/>'+
          '<circle cx="14.8" cy="13.2" r="1.15" fill="currentColor" stroke="none"/>'+
          '<path d="M8.9 16.9q3.1 2.1 6.2 0"/>'},
    {key:'pinterest', label:'Pinterest', domains:['pinterest.com','pin.it'],
     icon:'<circle cx="12" cy="12" r="9"/><path d="M10.3 19.8 12.9 8.4"/>'+
          '<path d="M9.5 13.7c-.5-2.6 1-4.9 3.6-5.4 2.4-.5 4.4.9 4.8 3.1.5 2.5-.9 4.7-3.2 5.1'+
          '-1.3.2-2.4-.3-2.9-1.2"/>'}
  ];
  function pfSocialIcoHtml(p){
    return '<span class="pfConnectIco" aria-hidden="true">'+
             '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '+
             'stroke-linecap="round" stroke-linejoin="round">'+p.icon+'</svg>'+
           '</span>';
  }
  function pfRenderConnect(){
    var wrap = document.getElementById('pfConnectList');
    if(!wrap) return;
    var links = (pf.profile && pf.profile.social_links) || {};
    wrap.innerHTML = PF_SOCIAL_PLATFORMS.map(function(p){
      var url = links[p.key];
      var safe = (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) ? url.trim() : null;
      var body = pfSocialIcoHtml(p)+'<span class="pfConnectTxt">'+p.label+'</span>';
      return safe
        ? '<a class="pfConnectItem pfConnectItem--on pfBrand--'+p.key+'" href="'+esc(safe)+'" '+
            'target="_blank" rel="noopener noreferrer">'+body+'</a>'
        : '<span class="pfConnectItem pfConnectItem--off" title="'+p.label+' not added">'+body+'</span>';
    }).join('');
  }
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

  pf.upCats = ['others'];
  pf.upTags = [];

  function pfUpdateCount(inputId,countId,max){
    var v = document.getElementById(inputId).value.length;
    document.getElementById(countId).textContent = v+'/'+max;
  }

  function togglePfCatDd(e){
    if(e) e.stopPropagation();
    var dd = document.getElementById('pfUpCatDd');
    if(typeof dzCloseMenus === 'function') dzCloseMenus(dd);
    closePfSoftwareDd();
    if(typeof closePfAlbumDd==='function') closePfAlbumDd();
    dd.classList.toggle('open');
    pfResetCatSearch();
  }
  function closePfCatDd(){
    document.getElementById('pfUpCatDd').classList.remove('open');
    pfResetCatSearch();
  }
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

  function togglePfSoftwareDd(e){
    if(e) e.stopPropagation();
    closePfCatDd();
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

  function pfRenderTagChips(){
    var host = document.getElementById('pfUpTagChips');
    host.innerHTML = pf.upTags.map(function(t,i){
      return '<span class="upTagChip">'+esc(t)+'<button type="button" onclick="pfRemoveTag('+i+',event)" aria-label="Remove tag">✕</button></span>';
    }).join('');
    document.getElementById('pfUpTags').value = pf.upTags.join(',');
  }
  var TAG_MAX = 30;
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
  function pfTagBlur(e){
    var input = e.target;
    if(input && String(input.value||'').trim()){ pfAddTag(input.value); input.value=''; }
  }
  function pfTagPaste(e){
    var cb = e.clipboardData || window.clipboardData;
    var txt = cb ? cb.getData('text') : '';
    if(!txt || !/[,\n]/.test(txt)) return;
    e.preventDefault();
    var input = e.target;
    pfAddTag(input.value + txt);
    input.value = '';
  }

  function pfGuestGate(e){
    if(currentUser) return false;
    if(e && typeof e.preventDefault==='function'){ e.preventDefault(); e.stopPropagation(); }
    sessionStorage.setItem('pendPfUp','1');
    closePfUpload();
    showToast('Sign in to upload');
    openAuthMod();
    return true;
  }

  function pfPaintPicked(o){
    var dz = document.getElementById('pfDz');
    if(!dz) return;
    if(!o){ dz.classList.remove('dzHasFile'); return; }
    var set = function(id, tx){ var el = document.getElementById(id); if(el) el.textContent = tx; };
    set('pfUpFileNm', o.name || 'Selected image');
    var sz = o.size && window.dzHelpers ? window.dzHelpers.bytes(o.size) : '';
    set('pfUpFileSz', sz || o.meta || 'Image');
    set('pfUpFileOk', o.note || 'Ready to publish');
    var acts = document.getElementById('pfUpFileActs');
    if(acts) acts.style.display = o.locked ? 'none' : '';
    var pw = document.getElementById('pfUpPrevWrap');
    if(pw) pw.style.display = '';
    dz.classList.add('dzHasFile');
  }
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

  function pfUpResetSession(){
    pf.upFile = null;
    pf.upPageFiles = [];
    pf.upThumbFocus = null;
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
    pfUpResetSession();
    document.getElementById('pfUpEditId').value = '';
    document.getElementById('pfUpTitle').textContent = 'Upload Artwork';
    document.getElementById('pfUpSubtitle').textContent = 'Share your creativity with artists around the world.';
    document.getElementById('pfUpNavTitle').textContent = 'UPLOAD ARTWORK';
    document.getElementById('pfDzTxt').textContent = 'Drag & drop your artwork here';
    document.getElementById('pfUpCatField').style.display = '';
    document.getElementById('pfComicPagesWrap').style.display = '';
    document.getElementById('pfDzPagesTitle').textContent = 'Add more images (optional)';
    document.getElementById('pfDzPagesSub').textContent   = 'The image above stays the cover. Add as many extras as you like.';
    document.getElementById('pfUpSoftwareField').style.display = '';
    var _albF = document.getElementById('pfUpAlbumField'); if(_albF) _albF.style.display = '';
    if(typeof albLoadMine==='function') albLoadMine(false).then(albUpRender, function(){});
    var _drB = document.getElementById('pfDraftBtn'); if(_drB) _drB.style.display = '';
    var _bkB = document.getElementById('pfUpBackBtn'); if(_bkB) _bkB.style.display = 'none';
    var _schF = document.getElementById('pfUpSchedField'); if(_schF) _schF.style.display = '';
    updrLoadStrip();
    uschLoad();
    document.getElementById('pfDz').style.display='';
    document.getElementById('pfUpBtn').textContent = '📤 Upload Artwork';
    document.getElementById('pfUpMod').classList.add('open');
    if(typeof upGrowAll === 'function') upGrowAll();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function closePfUpload(){
    var wasEdit = !!document.getElementById('pfUpEditId').value;
    document.getElementById('pfUpMod').classList.remove('open');
    closePfCatDd();
    pf.upFile = null; pf.upThumbFocus = null; pf.upPageFiles = [];
    restoreScroll();
    if(!wasEdit){
      if(typeof bnSetActive==='function') bnSetActive('bnHome');
    }
  }
  function handlePfFile(e){
    if(pfGuestGate(e)) return;
    var f = e.target.files[0]; if(!f) return;
    if(f.size > dzImageMax()){
      showToast('That image is over ' + dzImageMaxMb() + 'MB — pick a smaller one');
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
