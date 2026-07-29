// edit my work, community create
  var mw = { art: [], tab: 'art' };

  function openMyWorkPage(){
    if(!currentUser){ showToast('Sign in first'); return; }
    document.getElementById('pfMyWorkPage').classList.add('open');
    document.body.style.overflow = 'hidden';
    mwSwitchTab('art');
    mwLoadData();
  }
  function closeMyWorkPage(){
    document.getElementById('pfMyWorkPage').classList.remove('open');
    restoreScroll();
  }
  function mwSwitchTab(tab){
    mw.tab = tab;
    document.getElementById('mwTabArt').classList.toggle('active', tab==='art');
    document.getElementById('mwPanelArt').classList.toggle('active', tab==='art');
  }
  async function mwLoadData(){
    if(!sb || !currentUser) return;
    try{
      const{data:art,error:ae} = await sb.from('artworks').select('*').eq('user_id',currentUser.id).eq('kind',ART_KIND_ART).order('created_at',{ascending:false});
      if(ae) throw ae;
      mw.art = art||[];
    }catch(e){ console.error('Error loading your work: '+e.message); mw.art=[]; }
    mwRenderArt();
  }
  function mwCardHTML(row){
    var idStr = esc(String(row.id));
    var img = esc(getThumbnailUrl(row.image_url));
    var title = esc(row.name||'Untitled');
    return '<div class="admCard" data-id="'+idStr+'">'+
      '<div class="admCardThumb">'+
        '<img class="admCardImg" src="'+img+'" alt="'+title+'" loading="lazy" style="'+thumbStyle(row.thumb_x, row.thumb_y, row.thumb_zoom)+'">'+
      '</div>'+
      '<div class="admCardBody">'+
        '<div class="admCardTitle">'+title+'</div>'+
        '<div class="admCardMeta">'+(row.created_at?new Date(row.created_at).toLocaleDateString():'')+'</div>'+
        '<div class="admCardActions">'+
          '<button class="mwEditBtn" onclick="mwEditArt(\''+idStr+'\',event)">✎ Edit</button>'+
          '<button class="mwDeleteBtn" onclick="mwDeleteArt(\''+idStr+'\',event)">✕ Delete</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  function mwRenderArt(){
    var grid = document.getElementById('mwArtGrid'), empty = document.getElementById('mwArtEmpty');
    if(!grid) return;
    // queue cards lead the grid
    var qHtml = (typeof upq==='object' && currentUser) ? upqOwnQueueHTML() : '';
    grid.innerHTML = qHtml + mw.art.map(mwCardHTML).join('');
    empty.style.display = (mw.art.length || qHtml) ? 'none' : 'block';
  }

  // edit, reuses upload modal
  function mwEditArt(id, e){
    if(e) e.stopPropagation();
    var art = mw.art.find(function(r){ return String(r.id)===String(id); });
    if(!art){ showToast('Artwork not found'); return; }
    if(!currentUser || String(art.user_id)!==String(currentUser.id)){ showToast('You can only edit your own artwork'); return; }
    pf.upFile = null;
    pf.upThumbFocus = null;
    document.getElementById('pfUpEditId').value = String(art.id);
    document.getElementById('pfUpTitle').textContent = 'Edit Artwork';
    document.getElementById('pfUpSubtitle').textContent = 'Update the details for this piece.';
    document.getElementById('pfUpNavTitle').textContent = 'EDIT ARTWORK';
    document.getElementById('pfDzTxt').textContent = 'Drag & drop your artwork here';
    document.getElementById('pfUpCatField').style.display = '';
    document.getElementById('pfComicPagesWrap').style.display = 'none';
    document.getElementById('pfUpSoftwareField').style.display = '';
    // albums not edited here
    var _albF2 = document.getElementById('pfUpAlbumField'); if(_albF2) _albF2.style.display = 'none';
    document.getElementById('pfUpNm').value = art.name||'';
    document.getElementById('pfUpDesc').value = art.description||'';
    pfUpdateCount('pfUpNm','pfUpNmCount',100);
    pfUpdateCount('pfUpDesc','pfUpDescCount',1000);
    pfSetTagsFromArray(art.tags||[]);
    pfSetCats(catList(art.category).length?catList(art.category):['others']);
    if(typeof pfSetSoftware==='function') pfSetSoftware(art.software||'');
    closePfCatDd();
    document.getElementById('pfDz').style.display='none';
    var prev = document.getElementById('pfUpPrev');
    prev.src = art.image_url||'';
    prev.style.cssText = thumbStyle(art.thumb_x, art.thumb_y, art.thumb_zoom);
    var prevWrap = document.getElementById('pfUpPrevWrap');
    if(prevWrap) prevWrap.style.display = art.image_url ? 'block' : 'none';
    // edit mode hides thumbnail and drafts
    document.getElementById('pfUpThumbBtn').style.display = 'none';
    document.getElementById('upDraftSec').style.display = 'none';
    document.getElementById('upSchedSec').style.display = 'none';
    var _schF2 = document.getElementById('pfUpSchedField'); if(_schF2) _schF2.style.display = 'none';
    var _drB2 = document.getElementById('pfDraftBtn'); if(_drB2) _drB2.style.display = 'none';
    var _bkB2 = document.getElementById('pfUpBackBtn'); if(_bkB2) _bkB2.style.display = '';
    document.getElementById('pfUpBtn').textContent = '📤 Save Changes';
    document.getElementById('pfUpMod').classList.add('open');
  }
  // delete row and files
  async function mwDeleteArt(id, e){
    if(e) e.stopPropagation();
    var art = mw.art.find(function(r){ return String(r.id)===String(id); });
    if(!art){ return; }
    if(!currentUser || String(art.user_id)!==String(currentUser.id)){ showToast('You can only delete your own artwork'); return; }
    if(!confirm('Delete this artwork? This cannot be undone.')) return;
    try{
      if(art.storage_path) await s3Delete(BUCKET,art.storage_path);
      const{error}=await sb.from('artworks').delete().eq('id',id);
      if(error) throw error;
      mw.art = mw.art.filter(function(r){ return String(r.id)!==String(id); });
      mwRenderArt();
      images = images.filter(function(i){ return String(i.id)!==String(id); });
      renderHome();
      if(document.getElementById('fg').classList.contains('open')) renderFG();
      if(pf.profile && currentUser && pf.profile.id===currentUser.id){
        pf.galleryRows = pf.galleryRows.filter(function(r){ return String(r.id)!==String(id); });
        pfRenderGallery();
      }
      injectGallerySEO();
      showToast('Artwork removed');
    }catch(err){ console.error('Error: '+err.message); }
  }

  // comments page
  var cpComments = [];   // in memory comment list
  var cpMsgCache = {};   // last messages per channel

  // live chat channels
  // icon mirrors the card chip
  var CM_CHANNELS = {
    official: { name:'DigiArtz Official', desc:'Official community of DigiArtz. Get updates, announcements and more.', readOnly:true,
                icon:'🎨', grad:'linear-gradient(135deg,#4c1d95 0%,#7c3aed 55%,#a855f7 100%)' },
    arttalk : { name:'Art Talk',         desc:'Discuss about art, share your thoughts, ask questions and grow together.',
                icon:'💬', grad:'linear-gradient(135deg,#0f766e 0%,#0891b2 55%,#22d3ee 100%)' },
    feedback: { name:'Art Feedback',     desc:'Share your work and get constructive feedback from the community.',
                icon:'📝', grad:'linear-gradient(135deg,#9d174d 0%,#db2777 55%,#f97316 100%)' },
    collab  : { name:'Collab Hub',       desc:'Find artists to collaborate with on projects and bring ideas to life.',
                icon:'🤝', grad:'linear-gradient(135deg,#065f46 0%,#059669 55%,#22d3ee 100%)' },
    tips    : { name:'Tips & Resources', desc:'Share helpful tips, tutorials, tools and resources for artists.',
                icon:'💡', grad:'linear-gradient(135deg,#78350f 0%,#b45309 55%,#facc15 100%)' },
    showcase: { name:'Showcase',         desc:'Share your latest work, celebrate progress and inspire others.', type:'showcase', cooldownMs:3600000,
                icon:'✦', grad:'linear-gradient(135deg,#701a75 0%,#a21caf 55%,#6366f1 100%)' }
  };
  var cpCurrentChannel = 'arttalk'; // channel showing in cpbody

  function cpGetAvatarLetter(){
    // username initial only
    if(currentUser){
      var name = (currentUser.user_metadata && currentUser.user_metadata.username) || '';
      return name ? name.charAt(0).toUpperCase() : '?';
    }
    return '?';
  }

  function cpGetDisplayName(){
    // username is the display name
    if(currentUser){
      return (currentUser.user_metadata && currentUser.user_metadata.username) || 'User';
    }
    return 'Guest';
  }

  function cpSyncAvatar(){
    paintAvatarChip('cpBarAvatarImg', 'cpBarAvatarTxt', currentUser ? currentUserAvatarUrl : null, cpGetAvatarLetter());
  }


let currentLightboxImageSrc='';

function hideCommentThumbnail(){
  var box=document.getElementById('cpSelectedImage');
  if(box) box.style.display='none';
}

  // community page open and close
  function openCommunityHome(){
    closeMenu();
    var page = document.getElementById('communityPage');
    page.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    cmCloseChat(); // always land on the grid
    cmLoadMine();  // refresh own communities
  }

  function closeCommunityPage(){
    clearInterval(cpPoll); cpPoll = null; // stop the poll
    document.getElementById('communityPage').classList.remove('open');
    document.getElementById('cpBar').style.display = 'none';
    var lockNote = document.getElementById('cpLockNote');
    if(lockNote) lockNote.style.display = 'none';
    // clear active channel
    cpCurrentChannel = null;
    // restore scroll
    restoreScroll();
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = '';
  }

  // community card tap
  async function cmOpenCommunity(id){
    if(!currentUser){
      showToast('Please login to join this community.');
      openAuthMod();
      return;
    }
    var chan = CM_CHANNELS[id];
    // user made channels are c:uuid
    if(!chan && /^c:/.test(id)){
      var uc = cmMineCache[id];
      if(uc){
        chan = { name: uc.name, desc: uc.description || 'Community', type: 'chat', readOnly: false,
                 avatar: uc.avatar_url || null,
                 grad: 'linear-gradient(135deg,#1e3a8a 0%,#3b82f6 55%,#60a5fa 100%)' };
        CM_CHANNELS[id] = chan;
      }
    }
    if(!chan){
      showToast('This community is coming soon');
      return;
    }
    cpCurrentChannel = id;

    // update composer
    var inpEl      = document.getElementById('cpBarInput');
    var attachBtn  = document.getElementById('cpAttachBtn');
    var isShowcase = chan.type === 'showcase';
    if(inpEl)   inpEl.placeholder = isShowcase ? 'Write a caption for your artwork...' : ('Message #' + chan.name);
    if(attachBtn) attachBtn.style.display = isShowcase ? 'flex' : 'none';

    // header flips to chat banner
    if(typeof cmHdrChatMode === 'function'){
      cmHdrChatMode({
        name  : chan.name,
        sub   : chan.desc || 'Community',
        avatar: chan.avatar || null,
        emoji : chan.icon || null,
        letter: (chan.name || '?').charAt(0).toUpperCase(),
        grad  : chan.grad || null
      });
    }

    var grid = document.getElementById('cmGridScroll');
    var chat = document.getElementById('cmChatView');
    if(grid) grid.style.display = 'none';
    if(chat) chat.style.display = 'flex';
    // reset offset
    cpOffset = 0;
    cpLastSig = ''; // force a paint
    // swap to this channel now
    cpComments = cpMsgCache[id] || [];
    try{ cpRender(); }catch(e){}
    await cpLoadComments();

    // bail if the user moved on
    if(cpCurrentChannel !== id) return;

    // read only channels
    var canPost = !chan.readOnly || isDev;
    var bar = document.getElementById('cpBar');
    var lockNote = document.getElementById('cpLockNote');
    if(bar) bar.style.display = canPost ? 'flex' : 'none';
    if(lockNote) lockNote.style.display = canPost ? 'none' : 'flex';
    cpSyncAvatar();
    var thumb=document.getElementById('cpSelectedImage');
    var thumbImg=document.getElementById('cpSelectedImageImg');
    // open with an empty composer
    if(thumb) thumb.style.display = 'none';
    if(thumbImg) thumbImg.src = '';
    // hide bottom nav in a channel
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = 'none';

    // live update poll
    clearInterval(cpPoll);
    cpPoll = setInterval(function(){
      if(document.visibilityState === 'visible' && cpCurrentChannel === id){
        cpLoadComments(true);
      }
    }, CP_POLL_MS);
  }

  // back to the grid
  function cmCloseChat(){
    clearInterval(cpPoll); cpPoll = null; // stop the poll
    var grid = document.getElementById('cmGridScroll');
    var chat = document.getElementById('cmChatView');
    if(chat) chat.style.display = 'none';
    if(grid) grid.style.display = 'block';
    var bar = document.getElementById('cpBar');
    if(bar) bar.style.display = 'none';
    var lockNote = document.getElementById('cpLockNote');
    if(lockNote) lockNote.style.display = 'none';
    var attachBtn = document.getElementById('cpAttachBtn');
    if(attachBtn) attachBtn.style.display = 'none';
    // restore grid header
    if(typeof cmHdrHomeMode === 'function') cmHdrHomeMode();
    // clear active channel
    cpCurrentChannel = null;
    // restore bottom nav
    var nav = document.getElementById('bnNav');
    if(nav) nav.style.display = '';
  }

  // user made communities

  var CM_ROLE_LABEL = { owner:'Owner', admin:'Admin', sr_mod:'Senior Mod', jr_mod:'Junior Mod', member:'Member' };
  var CM_RANK = { owner:5, admin:4, sr_mod:3, jr_mod:2, member:1 };
  var CM_TIMEOUTS = [
    { m:5,     lbl:'5 minutes' },
    { m:60,    lbl:'1 hour'    },
    { m:1440,  lbl:'1 day'     },
    { m:10080, lbl:'7 days'    },
    { m:43200, lbl:'1 month'   },
    { m:0,     lbl:'Clear timeout' }
  ];
  var cmMg = null;   // community in manage modal
  var cmMineCache = {};  // channel lookup map
  var cmMineRows  = [];  // last membership rows

  function cmErr(e){
    var m = (e && e.message) || '';
    if(/CM_LEVEL/.test(m))         return 'You need artist Level 100 to create a community.';
    if(/CM_ALREADY_OWNER/.test(m)) return 'You already own a community — one per artist.';
    if(/CM_NAME_TAKEN/.test(m) || /communities_name_lower_idx/.test(m))
                                   return 'That community name is already taken.';
    if(/CM_NOT_FOUND/.test(m))     return 'No community matches that name and join ID.';
    if(/CM_BANNED/.test(m))        return 'You are banned from that community.';
    if(/CM_FORBIDDEN/.test(m))     return 'You don\u2019t have permission for that.';
    if(/CM_RANK/.test(m))          return 'You can\u2019t act on someone at or above your rank.';
    if(/CM_SELF/.test(m))          return 'You can\u2019t do that to yourself.';
    if(/CM_NOT_MEMBER/.test(m))    return 'That person isn\u2019t a member.';
    return 'Something went wrong — try again.';
  }

  function cmCloseMod(id){
    var m = document.getElementById(id);
    if(m) m.classList.remove('open');
  }
  function cmOpenMod(id){
    var m = document.getElementById(id);
    if(m) m.classList.add('open');
  }

  // keep focused field above keyboard
  document.addEventListener('focusin', function(e){
    var t = e.target;
    if(!t || !t.matches || !t.matches('input, textarea')) return;
    if(!t.closest('.cmMod, #rptMod, #cpuMod')) return;
    setTimeout(function(){
      try{ t.scrollIntoView({ block:'center', behavior:'smooth' }); }catch(err){}
    }, 320);
  });

  // create
  async function cmCreateCommunity(){
    if(!currentUser){ openAuthMod(); return; }
    document.getElementById('cmNewName').value = '';
    document.getElementById('cmNewDesc').value = '';
    var sub = document.getElementById('cmCreateSub');
    sub.textContent = 'Requires artist Level 100. One community per artist.';
    cmOpenMod('cmCreateMod');
    // show their level
    try{
      var pr = await sb.rpc('get_artist_progress', { target: currentUser.id });
      var lvl = (pr.data && pr.data[0] && pr.data[0].level) || 1;
      sub.textContent = lvl >= 100
        ? 'You\u2019re Level ' + lvl + ' — you can create a community.'
        : 'You\u2019re Level ' + lvl + '. Level 100 is required to create a community.';
    }catch(e){}
  }

  async function cmDoCreate(){
    var name = document.getElementById('cmNewName').value.trim();
    var desc = document.getElementById('cmNewDesc').value.trim();
    if(name.length < 3){ showToast('Name must be at least 3 characters'); return; }
    var btn = document.getElementById('cmCreateGo');
    btn.disabled = true; btn.textContent = 'CREATING…';
    try{
      var r = await sb.rpc('cm_create', { p_name: name, p_desc: desc || null });
      if(r.error) throw r.error;
      cmCloseMod('cmCreateMod');
      showToast('Community created');
      cmLoadMine();
    }catch(e){ showToast(cmErr(e)); }
    finally{ btn.disabled = false; btn.textContent = 'Create'; }
  }

  // join
  function cmOpenJoin(){
    if(!currentUser){ openAuthMod(); return; }
    document.getElementById('cmJoinName').value = '';
    document.getElementById('cmJoinCode').value = '';
    cmOpenMod('cmJoinMod');
  }

  async function cmDoJoin(){
    var name = document.getElementById('cmJoinName').value.trim();
    var code = document.getElementById('cmJoinCode').value.trim();
    if(!name || !code){ showToast('Enter both the name and the join ID'); return; }
    var btn = document.getElementById('cmJoinGo');
    btn.disabled = true; btn.textContent = 'JOINING…';
    try{
      var r = await sb.rpc('cm_join', { p_name: name, p_code: code });
      if(r.error) throw r.error;
      cmCloseMod('cmJoinMod');
      showToast('Joined ' + name);
      cmLoadMine();
    }catch(e){ showToast(cmErr(e)); }
    finally{ btn.disabled = false; btn.textContent = 'Join'; }
  }

  // render own communities
  async function cmLoadMine(){
    var wrap = document.getElementById('cmMineWrap');
    var grid = document.getElementById('cmMineGrid');
    if(!wrap || !grid || !sb || !currentUser){ if(wrap) wrap.style.display='none'; return; }
    // paint last known list first
    if(cmMineRows.length) cmRenderMine(cmMineRows);
    try{
      var mem = await sb.from('community_members')
        .select('role,banned,community_id,communities(id,name,description,avatar_url,owner_id,join_code)')
        .eq('user_id', currentUser.id).eq('banned', false);
      if(mem.error) throw mem.error;
      var rows = (mem.data || []).filter(function(r){ return r.communities; });
      cmMineRows = rows;
      cmRenderMine(rows);
    }catch(e){ if(!cmMineRows.length && wrap) wrap.style.display='none'; }
  }

  function cmRenderMine(rows){
    var wrap = document.getElementById('cmMineWrap');
    var grid = document.getElementById('cmMineGrid');
    if(!wrap || !grid) return;
    if(!rows.length){ wrap.style.display='none'; return; }
    wrap.style.display = '';
    grid.innerHTML = '';
    rows.forEach(function(r){
        var c = r.communities;
        var card = document.createElement('div');
        card.className = 'cmCard';
        var ico = document.createElement('div');
        ico.className = 'cmCardIcon';
        ico.style.background = 'linear-gradient(135deg,#1e3a8a 0%,#3b82f6 55%,#60a5fa 100%)';
        if(c.avatar_url){
          var im = document.createElement('img');
          im.src = getThumbnailUrl(c.avatar_url);
          im.alt = ''; im.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:inherit;';
          ico.textContent=''; ico.appendChild(im);
        } else {
          ico.textContent = (c.name || '?').charAt(0).toUpperCase();
        }
        var meta = document.createElement('div');
        meta.className = 'cmCardMeta';
        var nm = document.createElement('div');
        nm.className = 'cmCardName';
        nm.textContent = c.name;
        var badge = document.createElement('span');
        badge.className = 'cmBadge';
        badge.textContent = CM_ROLE_LABEL[r.role] || 'Member';
        nm.appendChild(badge);
        var p = document.createElement('p');
        p.textContent = c.description || 'No description yet.';
        meta.appendChild(nm); meta.appendChild(p);
        card.appendChild(ico); card.appendChild(meta);
        // card opens chat, staff get manage
        var chKey = 'c:' + c.id;
        cmMineCache[chKey] = c;
        card.onclick = function(){ cmOpenCommunity(chKey); };
        if((CM_RANK[r.role] || 1) >= 2){
          var mg = document.createElement('button');
          mg.className = 'cmModBtn';
          mg.style.cssText = 'flex-shrink:0;margin-left:auto;font-size:.6rem;padding:.4rem .7rem;';
          mg.textContent = 'MANAGE';
          mg.onclick = function(ev){ ev.stopPropagation(); cmOpenManage(c.id); };
          card.appendChild(mg);
        }
        grid.appendChild(card);
      });
  }

  // manage a community
  async function cmOpenManage(cid){
    if(!currentUser) return;
    try{
      var c = await sb.from('communities').select('*').eq('id', cid).maybeSingle();
      if(c.error || !c.data) throw (c.error || new Error('missing'));
      var me = await sb.from('community_members')
        .select('role').eq('community_id', cid).eq('user_id', currentUser.id).maybeSingle();
      cmMg = {
        c: c.data,
        myRole: (me.data && me.data.role) || 'member',
        isOwner: c.data.owner_id === currentUser.id
      };
      cmMg.myRank = CM_RANK[cmMg.myRole] || 1;

      document.getElementById('cmManageTitle').textContent = c.data.name;
      document.getElementById('cmManageCode').textContent = c.data.join_code;
      // settings are owner only
      document.getElementById('cmOwnerFields').style.display = cmMg.isOwner ? '' : 'none';
      if(cmMg.isOwner){
        document.getElementById('cmMgName').value   = c.data.name || '';
        document.getElementById('cmMgDesc').value   = c.data.description || '';
        document.getElementById('cmMgAvatar').value = c.data.avatar_url || '';
        document.getElementById('cmMgBanner').value = c.data.banner_url || '';
        document.getElementById('cmMgRules').value  = c.data.rules || '';
        document.getElementById('cmMgLinks').checked = !!c.data.links_allowed;
      }
      cmOpenMod('cmManageMod');
      cmLoadMembers();
    }catch(e){ showToast('Couldn\u2019t open that community'); }
  }

  async function cmSaveSettings(){
    if(!cmMg || !cmMg.isOwner) return;
    var btn = document.getElementById('cmMgSave');
    btn.disabled = true; btn.textContent = 'SAVING…';
    try{
      var upd = {
        name         : document.getElementById('cmMgName').value.trim(),
        description  : document.getElementById('cmMgDesc').value.trim() || null,
        avatar_url   : document.getElementById('cmMgAvatar').value.trim() || null,
        banner_url   : document.getElementById('cmMgBanner').value.trim() || null,
        rules        : document.getElementById('cmMgRules').value.trim() || null,
        links_allowed: document.getElementById('cmMgLinks').checked
      };
      if(upd.name.length < 3){ showToast('Name must be at least 3 characters'); return; }
      var r = await sb.from('communities').update(upd).eq('id', cmMg.c.id);
      if(r.error) throw r.error;
      cmMg.c.name = upd.name;
      document.getElementById('cmManageTitle').textContent = upd.name;
      showToast('Community updated');
      cmLoadMine();
    }catch(e){ showToast(cmErr(e)); }
    finally{ btn.disabled = false; btn.textContent = 'Save Settings'; }
  }

  async function cmLoadMembers(){
    var list = document.getElementById('cmMemList');
    if(!list || !cmMg) return;
    list.innerHTML = '<div class="dmSearchNote">LOADING…</div>';
    try{
      var r = await sb.from('community_members')
        .select('user_id,role,banned,timeout_until,profiles(username,display_name,avatar_url)')
        .eq('community_id', cmMg.c.id);
      if(r.error) throw r.error;
      var rows = (r.data || []).slice().sort(function(a,b){
        return (CM_RANK[b.role]||1) - (CM_RANK[a.role]||1);
      });
      document.getElementById('cmMemCount').textContent = rows.filter(function(x){return !x.banned;}).length;
      list.innerHTML = '';
      rows.forEach(function(m){
        var p = m.profiles || {};
        var row = document.createElement('div');
        row.className = 'cmMemRow';
        var ava = document.createElement('div');
        ava.className = 'cmMemAva';
        if(p.avatar_url){
          var im = document.createElement('img');
          im.src = getThumbnailUrl(p.avatar_url); im.alt='';
          ava.appendChild(im);
        } else {
          ava.textContent = ((p.display_name || p.username || '?')).charAt(0).toUpperCase();
        }
        var nm = document.createElement('div');
        nm.className = 'cmMemName';
        nm.textContent = p.display_name || p.username || 'User';
        var badge = document.createElement('span');
        var isTimedOut = m.timeout_until && new Date(m.timeout_until) > new Date();
        badge.className = 'cmMemRole cmMemRole--' + (m.banned ? 'banned' : m.role);
        badge.textContent = m.banned ? 'BANNED'
                          : isTimedOut ? 'TIMED OUT'
                          : (CM_ROLE_LABEL[m.role] || 'Member');
        row.appendChild(ava); row.appendChild(nm); row.appendChild(badge);
        row.onclick = function(){ cmOpenMemberActions(m, p); };
        list.appendChild(row);
      });
    }catch(e){ list.innerHTML = '<div class="dmSearchNote">COULDN\u2019T LOAD MEMBERS</div>'; }
  }

  // staff actions on a member
  function cmOpenMemberActions(m, p){
    if(!cmMg) return;
    var uname = p.username || null;
    var name  = p.display_name || p.username || 'User';
    document.getElementById('cmMemModName').textContent = name;
    document.getElementById('cmMemModRole').textContent =
      m.banned ? 'Banned' : (CM_ROLE_LABEL[m.role] || 'Member');
    var acts = document.getElementById('cmMemActs');
    acts.innerHTML = '';

    function add(label, fn, danger){
      var b = document.createElement('button');
      b.className = 'cmActItem' + (danger ? ' cmActItem--danger' : '');
      b.textContent = label;
      b.onclick = fn;
      acts.appendChild(b);
    }

    // profile open to everyone
    if(uname) add('View profile', function(){
      cmCloseMod('cmMemMod'); cmCloseMod('cmManageMod');
      // back returns here
      openProfileByUsername(uname, true);
    });

    var targetRank = CM_RANK[m.role] || 1;
    var isSelf = String(m.user_id) === String(currentUser && currentUser.id);
    // mirror the server rank rules
    var canAct = !isSelf && cmMg.myRank >= 2 && targetRank < cmMg.myRank;

    if(canAct){
      if(cmMg.myRank >= 4){                       // admin: promote or demote
        ['member','jr_mod','sr_mod','admin'].forEach(function(role){
          if(CM_RANK[role] >= cmMg.myRank) return;   // cannot grant own rank
          if(role === m.role) return;
          var verb = CM_RANK[role] > targetRank ? 'Promote to ' : 'Demote to ';
          add(verb + CM_ROLE_LABEL[role], function(){ cmMod('cm_set_role', { cid: cmMg.c.id, target: m.user_id, new_role: role }); });
        });
      }
      add('Kick from community', function(){ cmMod('cm_kick', { cid: cmMg.c.id, target: m.user_id }); }, true);

      CM_TIMEOUTS.forEach(function(t){
        add('Timeout — ' + t.lbl, function(){ cmMod('cm_timeout', { cid: cmMg.c.id, target: m.user_id, minutes: t.m }); });
      });

      if(cmMg.myRank >= 3){                       // sr mod: ban or unban
        add(m.banned ? 'Unban' : 'Ban from community',
            function(){ cmMod('cm_set_ban', { cid: cmMg.c.id, target: m.user_id, do_ban: !m.banned }); }, true);
      }
    } else if(!isSelf){
      var note = document.createElement('div');
      note.className = 'cmModSub';
      note.style.margin = '.4rem 0 0';
      note.textContent = 'No moderation options for this member.';
      acts.appendChild(note);
    }
    cmOpenMod('cmMemMod');
  }

  async function cmMod(rpc, args){
    try{
      var r = await sb.rpc(rpc, args);
      if(r.error) throw r.error;
      cmCloseMod('cmMemMod');
      showToast('Done');
      cmLoadMembers();
    }catch(e){ showToast(cmErr(e)); }
  }

  // zeo opens the assistant page
  function cmOpenZeo(){
    var zeoBtn = document.getElementById('zeoBtn');
    if(zeoBtn) zeoBtn.click();
  }

  // comments pagination state
  var cpOffset = 0; // set in cprender
  var CP_INITIAL_LOAD = function(){ return 25; };
  var CP_LOAD_STEP = 25;
  // pin position while loading older
  var cpLoadingOlder = false;
  // live update poll
  var cpPoll = null;
  var CP_POLL_MS = 5000;
  var cpLastSig = '';

  // chat feed helpers
  function cpHHMM(iso){
    if(!iso) return '';
    try{ return new Date(iso).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); }
    catch(e){ return ''; }
  }
  function cpDayChip(d){
    var now = new Date(), y = new Date(); y.setDate(now.getDate()-1);
    if(d.toDateString() === now.toDateString()) return 'TODAY';
    if(d.toDateString() === y.toDateString())   return 'YESTERDAY';
    try{ return d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}).toUpperCase(); }
    catch(e){ return d.toDateString().toUpperCase(); }
  }

  // chat author identity
  var cpAuthors = {};

  async function cpLoadAuthors(list){
    if(!sb || !list || !list.length) return;
    var ids = [];
    list.forEach(function(c){
      if(c.user_id && ids.indexOf(String(c.user_id)) === -1) ids.push(String(c.user_id));
    });
    if(!ids.length) return;
    try{
      var r = await sb.from('profiles')
        .select('id,username,display_name,avatar_url')
        .in('id', ids);
      if(r.error) throw r.error;
      (r.data || []).forEach(function(p){
        cpAuthors[String(p.id)] = {
          name  : p.display_name || p.username || 'User',
          avatar: p.avatar_url || null
        };
      });
    }catch(e){ /* keep what we have */ }
  }

  // avatar markup for a chat row
  function cpAvatarHTML(c, extraCls){
    var a = c.user_id ? cpAuthors[String(c.user_id)] : null;
    var cls = 'cpAvatar' + (extraCls ? ' ' + extraCls : '');
    // data uid for the delegated listener
    var uid = c.user_id ? ' data-uid="' + esc(String(c.user_id)) + '"' : '';
    if(a && a.avatar){
      return '<div class="' + cls + '"' + uid + '>' +
               '<img class="cpAvatarImg" src="' + esc(getThumbnailUrl(a.avatar)) +
               '" alt="" loading="lazy" decoding="async">' +
             '</div>';
    }
    return '<div class="' + cls + '"' + uid + '>' + esc(c.initial) + '</div>';
  }

  // current display name
  function cpAuthorName(c){
    var a = c.user_id ? cpAuthors[String(c.user_id)] : null;
    return (a && a.name) ? a.name : c.user;
  }

  // mini profile card
  var cpuUser = null;

  function cpuClose(){
    var m = document.getElementById('cpuMod');
    if(m) m.classList.remove('open');
    cpuUser = null;
  }

  function cpuViewProfile(){
    if(!cpuUser || !cpuUser.username) return;
    var uname = cpuUser.username;
    cpuClose();
    // back returns to community
    openProfileByUsername(uname, true);
  }

  async function cpuOpen(uid){
    if(!uid) return;
    // never open on yourself
    if(typeof currentUser !== 'undefined' && currentUser && String(currentUser.id) === String(uid)) return;
    var m = document.getElementById('cpuMod');
    if(!m) return;

    var a = cpAuthors[String(uid)] || null;
    cpuUser = { id: uid, name: (a && a.name) || 'User', username: null, avatar: (a && a.avatar) || null };
    cpuPaint();
    m.classList.add('open');

    // fetch the handle
    try{
      var r = await sb.from('profiles')
        .select('username,display_name,avatar_url')
        .eq('id', uid).maybeSingle();
      if(r.error || !r.data) throw (r.error || new Error('no profile'));
      if(!cpuUser || String(cpuUser.id) !== String(uid)) return;  // card closed or switched
      cpuUser.username = r.data.username || null;
      cpuUser.name     = r.data.display_name || r.data.username || cpuUser.name;
      cpuUser.avatar   = r.data.avatar_url || cpuUser.avatar;
      cpuPaint();
    }catch(e){
      var btn = document.getElementById('cpuView');
      if(btn){ btn.disabled = true; btn.textContent = 'PROFILE UNAVAILABLE'; }
    }
  }

  function cpuPaint(){
    if(!cpuUser) return;
    var ico = document.getElementById('cpuIco');
    var nm  = document.getElementById('cpuName');
    var hd  = document.getElementById('cpuHandle');
    var btn = document.getElementById('cpuView');
    if(nm) nm.textContent = cpuUser.name || 'User';
    if(hd) hd.textContent = cpuUser.username ? ('@' + cpuUser.username) : '…';
    if(btn){ btn.disabled = !cpuUser.username; btn.textContent = 'VIEW PROFILE'; }
    if(ico){
      ico.textContent = '';
      if(cpuUser.avatar){
        var img = document.createElement('img');
        img.src = getThumbnailUrl(cpuUser.avatar);
        img.alt = ''; img.loading = 'lazy';
        ico.appendChild(img);
      } else {
        ico.textContent = (cpuUser.name || '?').charAt(0).toUpperCase();
      }
    }
  }

  // one delegated listener
  document.addEventListener('click', function(e){
    var t = e.target.closest && e.target.closest('[data-uid]');
    if(!t) return;
    if(!t.closest('#communityPage')) return;   // chat rows only
    e.preventDefault(); e.stopPropagation();
    cpuOpen(t.getAttribute('data-uid'));
  });

  function cpRender(){
    var body  = document.getElementById('cpBody');
    var empty = document.getElementById('cpEmpty');
    if(!body) return;

    // seed the visible window
    if(cpOffset === 0) cpOffset = CP_INITIAL_LOAD();

    // skip rebuild if unchanged
    var sig = cpComments.length + '|' + cpOffset + '|' +
              (cpComments.length ? (cpComments[cpComments.length - 1].raw_time || '') : '');
    var firstPaint = (cpLastSig === '');
    if(sig === cpLastSig) return;
    cpLastSig = sig;

    // capture scroll state first
    var prevHeight = body.scrollHeight;
    var prevTop    = body.scrollTop;
    var atBottom   = (prevHeight - prevTop - body.clientHeight) < 80;

    // remove rendered items
    body.querySelectorAll('.cpComment, .cpShowcase, .cpMsgRow, .chatDay').forEach(function(el){ el.remove(); });

    if(cpComments.length === 0){
      if(empty) empty.style.display = 'flex';
      return;
    }
    if(empty) empty.style.display = 'none';

    // clamp to what we have
    var showCount = Math.min(cpOffset, cpComments.length);
    // slice from the end
    var toShow = cpComments.slice(cpComments.length - showCount);

    // loader sits at the top
    var isShowcase = cpCurrentChannel === 'showcase';

    // grouping and date chip state
    var cpLastDayKey = '', cpLastSenderKey = null, cpLastTs = 0;

    toShow.forEach(function(c){
      var div = document.createElement('div');
      if(isShowcase){
        // showcase post card
        div.className = 'cpShowcase';
        var safeUrl = esc(c.image_url || '');
        var scName = cpAuthorName(c);
        div.innerHTML =
          '<div class="cpShowcaseHead">' +
            cpAvatarHTML(c) +
            '<div class="cpShowcaseMeta">' +
              '<div class="cpCommentUser"' + (c.user_id ? ' data-uid="' + esc(String(c.user_id)) + '"' : '') + '>' + esc(scName) + '</div>' +
              '<div class="cpCommentTime">' + esc(c.time) + '</div>' +
            '</div>' +
          '</div>' +
          (c.image_url ? ('<img class="cpShowcaseImg" src="' + esc(getThumbnailUrl(c.image_url||'')) + '" alt="' + esc(scName) + '\'s artwork" onclick="openLB(\'' + safeUrl.replace(/'/g,'&#39;') + '\',\'' + esc(scName).replace(/'/g,'&#39;') + '\'s artwork\')">') : '') +
          '<div class="cpShowcaseText">' + esc(c.text) + '</div>';
      } else {
        // chat row
        if(!c.text){ return; }
        var mine = !!(typeof currentUser !== 'undefined' && currentUser && c.user_id && String(c.user_id) === String(currentUser.id));
        var d = c.raw_time ? new Date(c.raw_time) : null;
        var dayKey = d ? d.toDateString() : '';
        if(dayKey && dayKey !== cpLastDayKey){
          var chip = document.createElement('div');
          chip.className = 'chatDay';
          chip.innerHTML = '<span>' + cpDayChip(d) + '</span>';
          body.appendChild(chip);
          cpLastDayKey = dayKey;
          cpLastSenderKey = null; // new day restarts the group
        }
        var senderKey = c.user_id != null ? 's:'+c.user_id : 'n:'+c.user;
        var ts = d ? d.getTime() : 0;
        var cont = cpLastSenderKey === senderKey && ts && (ts - cpLastTs) < 300000;
        cpLastSenderKey = senderKey; cpLastTs = ts;

        var shortTime = cpHHMM(c.raw_time) || esc(c.time);

        div.className = 'cpMsgRow ' + (mine ? 'cpMsgRow--me' : 'cpMsgRow--them') + (cont ? ' cpMsgRow--cont' : '');
        div.innerHTML =
          (!mine ? cpAvatarHTML(c, 'cpMsgAvatar' + (cont ? ' cpMsgAvatar--ghost' : '')) : '') +
          '<div class="cpBubble">' +
            (!mine && !cont ? '<div class="cpBubbleName"' + (c.user_id ? ' data-uid="' + esc(String(c.user_id)) + '"' : '') + '>' + esc(cpAuthorName(c)) + '</div>' : '') +
            '<span class="cpBubbleText">' + esc(c.text) + '</span>' +
            '<span class="cpBubbleTime">' + shortTime + '</span>' +
          '</div>';
      }
      body.appendChild(div);
    });

    if(cpLoadingOlder){
      // keep reading position
      body.scrollTop = prevTop + (body.scrollHeight - prevHeight);
      cpLoadingOlder = false;
    } else if(firstPaint || atBottom){
      // pin to the bottom
      body.scrollTop = body.scrollHeight;
    } else {
      // do not yank while reading
      body.scrollTop = prevTop;
    }
  }

  // load older on scroll up
  (function(){
    var _cpRefreshing = false;
    var _cpRefreshTimer = null;

    function cpTriggerRefresh(){
      if(_cpRefreshing) return;
      // nothing older left
      if(cpOffset >= cpComments.length) return;
      _cpRefreshing = true;
      var wrap = document.getElementById('cpRefreshWrap');
      if(wrap) wrap.classList.add('visible');

      // reveal 25 more
      cpLoadingOlder = true;
      cpOffset += CP_LOAD_STEP;

      cpLoadComments().then(function(){
        // keep spinner visible briefly
        setTimeout(function(){
          if(wrap) wrap.classList.remove('visible');
          _cpRefreshing = false;
        }, 800);
      }).catch(function(){
        if(wrap) wrap.classList.remove('visible');
        _cpRefreshing = false;
        cpLoadingOlder = false;
      });
    }

    // attach scroll listener
    document.addEventListener('DOMContentLoaded', function(){
      var body = document.getElementById('cpBody');
      if(!body) return;

      body.addEventListener('scroll', function(){
        // trigger near the top
        var nearTop = body.scrollTop <= 40;
        if(nearTop && !_cpRefreshing){
          clearTimeout(_cpRefreshTimer);
          _cpRefreshTimer = setTimeout(function(){
            var page = document.getElementById('communityPage');
            if(page && page.classList.contains('open')){
              cpTriggerRefresh();
            }
          }, 300);
        }
      }, {passive:true});
    });
  })();

  async function cpSend(){
    var inp=document.getElementById('cpBarInput');
    var text=inp?inp.value.trim():'';
    if(!text) return;

    if(!currentUser){
      showToast('Please login to comment.');
      return;
    }

    var chan = CM_CHANNELS[cpCurrentChannel];
    if(chan && chan.readOnly && !isDev){
      showToast('Only DigiArtz can post in this channel.');
      return;
    }

    if(chan && chan.type === 'showcase'){
      var thumbEl = document.getElementById('cpSelectedImage');
      var hasImage = thumbEl && thumbEl.style.display !== 'none';
      if(!hasImage){
        showToast('Tap + and pick one of your artworks or comics first.');
        return;
      }
      var remaining = cpShowcaseCooldownRemaining();
      if(remaining > 0){
        showToast('You can showcase again in ' + cpFormatCooldown(remaining) + '.');
        return;
      }
    }

    const ok=await cpSaveComment(text);
    if(!ok) return;

    if(inp) inp.value='';
    await cpLoadComments();
  }

  // showcase cooldown
  function cpShowcaseCooldownRemaining(){
    if(!currentUser) return 0;
    var last = 0;
    cpComments.forEach(function(c){
      if(c.user_id === currentUser.id && c.raw_time){
        var t = new Date(c.raw_time).getTime();
        if(t > last) last = t;
      }
    });
    if(!last) return 0;
    var cooldownMs = (CM_CHANNELS.showcase && CM_CHANNELS.showcase.cooldownMs) || 3600000;
    var remaining = cooldownMs - (Date.now() - last);
    return remaining > 0 ? remaining : 0;
  }

  function cpFormatCooldown(ms){
    var mins = Math.ceil(ms / 60000);
    if(mins >= 60) return Math.ceil(mins / 60) + 'h';
    return mins + 'm';
  }

  // showcase picker
  function cpOpenShowcasePicker(){
    if(!currentUser){ showToast('Please login first.'); openAuthMod(); return; }
    var body  = document.getElementById('spBody');
    var empty = document.getElementById('spEmpty');
    if(!body) return;
    body.innerHTML = '';

    var myArt    = (images || []).filter(function(a){ return a.user_id === currentUser.id; });
    var myComics = (comics || []).filter(function(c){ return c.user_id === currentUser.id; });
    var items = myArt.map(function(a){
      return { url:a.image_url, name:a.name || 'Untitled' };
    }).concat(myComics.map(function(c){
      return { url:c.cover_image_url, name:(c.title || 'Untitled') + ' (Comic)' };
    }));

    if(items.length === 0){
      if(empty) empty.style.display = 'flex';
    } else {
      if(empty) empty.style.display = 'none';
      items.forEach(function(it){
        if(!it.url) return;
        var div = document.createElement('div');
        div.className = 'spItem';
        div.innerHTML = '<img src="' + esc(it.url) + '" alt="' + esc(it.name) + '"><span>' + esc(it.name) + '</span>';
        div.addEventListener('click', function(){ cpPickShowcaseImage(it.url); });
        body.appendChild(div);
      });
    }

    var el = document.getElementById('showcasePicker');
    if(el) el.classList.add('open');
  }

  function cpPickShowcaseImage(url){
    var thumb    = document.getElementById('cpSelectedImage');
    var thumbImg = document.getElementById('cpSelectedImageImg');
    if(thumb && thumbImg){
      thumbImg.src = url;
      thumb.style.display = 'flex';
    }
    closeShowcasePicker();
  }

  function closeShowcasePicker(){
    var el = document.getElementById('showcasePicker');
    if(el) el.classList.remove('open');
  }

  // enter sends
  document.addEventListener('DOMContentLoaded', function(){
    var inp = document.getElementById('cpBarInput');
    if(inp){
      inp.addEventListener('keydown', function(e){
        if(e.key === 'Enter'){ e.preventDefault(); cpSend(); }
      });
    }
  });

  // load comments
  async function cpLoadComments(silent){
    if(!sb){
      if(silent) return; // background poll, keep screen
      cpComments = [];
      cpRender();
      return;
    }
    try{
      // pin the channel for this load
      var forChannel = cpCurrentChannel;
      // loading state on first open
      var emptyEl = document.getElementById('cpEmpty');
      if(emptyEl && cpComments.length === 0){
        emptyEl.innerHTML = '<div class="cpEIco">◎</div><div>LOADING…</div>';
        emptyEl.style.display = 'flex';
      }
      var result = await sb.from('comments')
        .select('*')
        .eq('channel', forChannel)
        .order('created_at', { ascending: true });
      if(result.error) throw result.error;
      if(cpCurrentChannel !== forChannel) return;   // user switched rooms
      var rows = result.data || [];
      cpComments = rows.map(function(row){
        var displayName = row.username || 'User';
        return {
          initial   : displayName.charAt(0).toUpperCase(),
          user      : displayName,
          user_id   : row.user_id || null,
          text      : row.comment_text || '',
          time      : row.created_at
            ? new Date(row.created_at).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' })
            : '',
          raw_time  : row.created_at || null,
          image_url : row.image_url || null
        };
      });
      // resolve authors live
      await cpLoadAuthors(cpComments);
      if(cpCurrentChannel !== forChannel) return;   // switched during author fetch
      // warm the channel cache
      cpMsgCache[forChannel] = cpComments;
      // restore empty placeholder
      if(emptyEl){
        emptyEl.innerHTML = cpCurrentChannel === 'showcase'
          ? '<div class="cpEIco">◎</div><div>NOTHING SHOWCASED YET</div><div style="font-size:.68rem;opacity:.6;margin-top:.2rem;">BE THE FIRST TO SHARE YOUR WORK</div>'
          : '<div class="cpEIco">◎</div><div>NO COMMENTS YET</div><div style="font-size:.68rem;opacity:.6;margin-top:.2rem;">BE THE FIRST TO LEAVE ONE</div>';
      }
      cpRender();
      // offline snapshot
      dzcSet('cp:'+cpCurrentChannel, cpComments.slice(-50));
    }catch(e){
      console.error('cpLoadComments:', e);
      if(silent) return; // transient poll error
      // offline, serve saved copy
      var cachedCp = dzcGet('cp:'+cpCurrentChannel);
      if(cachedCp && cachedCp.length){
        cpComments = cachedCp;
        cpHasMore = false;
        cpRender();
        showToast('Offline \u2014 showing saved messages');
        return;
      }
      showToast('Failed to load comments');
      cpComments = [];
      cpRender();
    }
  }

  // save comment
  async function cpSaveComment(text){
    if(!sb){ showToast('Can\u2019t connect \u2014 try again'); return false; }
    if(!currentUser){ showToast('Please login to comment.'); openAuthMod(); return false; }

    // optional linked image
    var imageUrl = null;
    var thumbEl  = document.getElementById('cpSelectedImage');
    var thumbImg = document.getElementById('cpSelectedImageImg');
    if(thumbEl && thumbEl.style.display !== 'none' && thumbImg && thumbImg.src && thumbImg.src !== window.location.href){
      imageUrl = thumbImg.src;
    }

    // disable send while saving
    var sendBtn = document.getElementById('cpBarSend');
    if(sendBtn){ sendBtn.disabled = true; sendBtn.style.opacity = '.55'; }

    try{
      // username only, never email
      var commentUsername = (currentUser.user_metadata && currentUser.user_metadata.username) || 'User';
      var result = await sb.from('comments').insert({
        user_id      : currentUser.id,
        // email not stored
        username     : commentUsername,
        comment_text : text,
        image_url    : imageUrl,
        channel      : cpCurrentChannel
      });
      if(result.error) throw result.error;
      // clear thumbnail
      if(thumbEl)  thumbEl.style.display = 'none';
      if(thumbImg) thumbImg.src = '';
      return true;
    }catch(e){
      console.error('cpSaveComment:', e);
      // explain channel rejections
      var msg = (e && e.message) || '';
      if(/CM_NO_LINKS/.test(msg)){
        showToast('Links aren\u2019t allowed in this community');
        return false;
      }
      if(/^c:/.test(cpCurrentChannel || '') && /row-level security|violates row-level|42501/i.test(msg)){
        showToast('You can\u2019t post here right now — you may be timed out or banned.');
        return false;
      }
      // merit gate error
      if(window.meritDenied && window.meritDenied(e, 'chat')) return false;
      // surface the real reason
      showToast(safeErr(e, 'Could not send \u2014 try again'));
      return false;
    }finally{
      if(sendBtn){ sendBtn.disabled = false; sendBtn.style.opacity = ''; }
    }
  }



  // post intro callback queue
  var __introRevealed = false;
  var __afterIntroQueue = [];
  function afterIntro(cb){
    if(__introRevealed){ cb(); return; }
    __afterIntroQueue.push(cb);
  }
  function __flushAfterIntro(){
    if(__introRevealed) return;
    __introRevealed = true;
    var q = __afterIntroQueue; __afterIntroQueue = [];
    q.forEach(function(fn){ try{ fn(); }catch(e){} });
  }

  (function(){
    var introEl = document.getElementById('intro');
    var revealed = false;
    // reveal when everything is in
    var progress = {dom:0, img:0, fonts:0};

    function total(){
      return (progress.dom + progress.img + progress.fonts) / 3;
    }

    function reveal(){
      if(revealed) return;
      revealed = true;
      if(introEl){
        introEl.classList.add('iHide');
        introEl.addEventListener('transitionend', function handler(e){
          if(e.propertyName === 'opacity'){
            introEl.classList.add('iGone');
            introEl.removeEventListener('transitionend', handler);
            __flushAfterIntro(); // release queued toasts
          }
        });
        // fallback if transitionend misses
        setTimeout(__flushAfterIntro, 450);
      } else {
        __flushAfterIntro();
      }
    }

    function paint(){
      // loaded means done
      if(total() >= 100) reveal();
    }

    // dom slice
    if(document.readyState === 'complete' || document.readyState === 'interactive'){
      progress.dom = 100; paint();
    } else {
      document.addEventListener('DOMContentLoaded', function(){ progress.dom = 100; paint(); });
    }

    // fonts slice
    if(document.fonts && document.fonts.ready){
      document.fonts.ready.then(function(){ progress.fonts = 100; paint(); });
    } else {
      progress.fonts = 100;
    }

    // hero image slice
    window._heroLoadCb = function(url){
      if(!url){ progress.img = 100; paint(); return; }
      var pre = new Image();
      pre.onload  = function(){ progress.img = 100; paint(); };
      pre.onerror = function(){ progress.img = 100; paint(); };
      pre.src = url;
      if(pre.complete){ progress.img = 100; paint(); }
    };

    paint();
    // safety net
    setTimeout(reveal, 9000);
  })();

