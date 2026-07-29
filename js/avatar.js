/* ── avatar.js · avatar / banner upload ── */
  /* =========================================================
     AVATAR / BANNER UPLOAD
     ├─ pfRenderAvatarBanner() — paints pf.profile.avatar_url /
     │   banner_url into #pfAvatarImg / #pfBannerImg, falling back
     │   to the letter avatar / gradient banner when unset.
     ├─ openPfAvatarPicker() / openPfBannerPicker() — owner-only,
     │   gated by a 7-day cooldown read off
     │   pf.profile.avatar_updated_at / banner_updated_at.
     ├─ handlePfAvBFile → openPfAvBCrop — shared focal-point
     │   cropper (square stage for avatar, wide stage for banner).
     ├─ confirmPfAvBCrop() — actually renders the crop to a fixed-
     │   size canvas (unlike the gallery thumb picker, which only
     │   stores a focal point) and hands the JPEG blob to
     │   doPfAvBUpload().
     └─ doPfAvBUpload() — uploads the new file, deletes the
         previous one from Storage, updates the profiles row +
         pf.profile + the on-screen image, all in one go.

     Requires these columns on `profiles` (nullable):
       avatar_url text, avatar_storage_path text, avatar_updated_at timestamptz,
       banner_url text, banner_storage_path text, banner_updated_at timestamptz
     ========================================================= */
  var PF_AVB_COOLDOWN_MS = 7*24*60*60*1000; // 1 week
  var PF_AVB_DIMS = { avatar:{w:480,h:480}, banner:{w:1600,h:500} };

  function pfRenderAvatarBanner(){
    if(!pf.profile) return;
    var aImg = document.getElementById('pfAvatarImg');
    var aLetter = document.getElementById('pfAvatarLetter');
    var eaImg = document.getElementById('pfEditAvatarImg');
    var eaLetter = document.getElementById('pfEditAvatarLetter');
    if(pf.profile.avatar_url){
      aImg.src = getThumbnailUrl(pf.profile.avatar_url); aImg.style.display='block'; aLetter.style.display='none';
      eaImg.src = getThumbnailUrl(pf.profile.avatar_url); eaImg.style.display='block'; eaLetter.style.display='none';
    } else {
      aImg.style.display='none'; aLetter.style.display='';
      eaImg.style.display='none'; eaLetter.style.display='';
    }
    var bImg = document.getElementById('pfBannerImg');
    var ebImg = document.getElementById('pfEditBannerImg');
    if(pf.profile.banner_url){
      bImg.src = getViewUrl(pf.profile.banner_url); bImg.style.display='block';
      ebImg.src = getViewUrl(pf.profile.banner_url); ebImg.style.display='block';
    } else {
      bImg.style.display='none';
      ebImg.style.display='none';
    }
  }

  /* Returns ms remaining before a re-upload is allowed (0 = allowed now). */
  function pfAvBCooldownLeft(updatedAt){
    if(!updatedAt) return 0;
    var elapsed = Date.now() - new Date(updatedAt).getTime();
    return Math.max(0, PF_AVB_COOLDOWN_MS - elapsed);
  }
  function pfAvBCooldownMsg(msLeft){
    var days = Math.ceil(msLeft/(24*60*60*1000));
    return 'You can re-upload in '+days+' day'+(days===1?'':'s')+'.';
  }

  function openPfAvatarPicker(){
    if(!pf.isOwner){ showToast('You can only edit your own profile'); return; }
    var left = pfAvBCooldownLeft(pf.profile && pf.profile.avatar_updated_at);
    if(left>0){ showToast('Profile photo was updated recently. '+pfAvBCooldownMsg(left)); return; }
    document.getElementById('pfAvatarFileInput').click();
  }
  function openPfBannerPicker(){
    if(!pf.isOwner){ showToast('You can only edit your own profile'); return; }
    var left = pfAvBCooldownLeft(pf.profile && pf.profile.banner_updated_at);
    if(left>0){ showToast('Banner was updated recently. '+pfAvBCooldownMsg(left)); return; }
    document.getElementById('pfBannerFileInput').click();
  }

  function handlePfAvBFile(e, kind){
    var f = e.target.files[0]; if(!f) return;
    if(!f.type.startsWith('image/')){ showToast('Please select an image'); e.target.value=''; return; }
    var r = new FileReader();
    r.onload = function(ev){ openPfAvBCrop(f, ev.target.result, kind); };
    r.readAsDataURL(f);
  }

  var pfAvBCropPending = null;
  var pfAvBCrop = { kind:'avatar', natW:0, natH:0, stageW:280, stageH:280, x:50, y:50, axis:null, dragging:false, sx:0, sy:0, ox:50, oy:50 };
  function openPfAvBCrop(file, dataUrl, kind){
    pfAvBCropPending = file;
    pfAvBCrop.kind = kind;
    var stageEl = document.getElementById('pfAvBCropStage');
    stageEl.classList.toggle('cropStage--banner', kind==='banner');
    document.getElementById('pfAvBCropTitle').textContent = kind==='banner' ? 'Set Banner' : 'Set Profile Photo';
    document.getElementById('pfAvBCropSub').textContent = kind==='banner'
      ? 'Drag the photo to choose what shows across your banner.'
      : 'Drag the photo to choose what shows in the square frame.';
    var img = document.getElementById('pfAvBCropImg');
    img.onload = function(){
      var rect = stageEl.getBoundingClientRect();
      pfAvBCrop.stageW = rect.width || 280; pfAvBCrop.stageH = rect.height || 280;
      pfAvBCrop.natW = img.naturalWidth; pfAvBCrop.natH = img.naturalHeight;
      var boxRatio = pfAvBCrop.stageW/pfAvBCrop.stageH;
      var srcRatio = pfAvBCrop.natW/pfAvBCrop.natH;
      pfAvBCrop.axis = srcRatio > boxRatio ? 'x' : (srcRatio < boxRatio ? 'y' : null);
      pfAvBCrop.x = 50; pfAvBCrop.y = 50;
      pfAvBCropRender();
      document.getElementById('pfAvBCropMod').classList.add('open');
    };
    img.src = dataUrl;
  }
  function pfAvBCropRender(){
    document.getElementById('pfAvBCropImg').style.objectPosition = pfAvBCrop.x+'% '+pfAvBCrop.y+'%';
  }
  (function initPfAvBCropDrag(){
    var stageEl = null;
    function down(e){
      if(!pfAvBCrop.axis) return;
      stageEl = document.getElementById('pfAvBCropStage');
      pfAvBCrop.dragging = true; stageEl.classList.add('dragging');
      var p = e.touches ? e.touches[0] : e;
      pfAvBCrop.sx = p.clientX; pfAvBCrop.sy = p.clientY;
      pfAvBCrop.ox = pfAvBCrop.x; pfAvBCrop.oy = pfAvBCrop.y;
      /* FIX: same drag-scoped listener wiring as initPfCropDrag —
         no permanent non-passive document touchmove handler. */
      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, {passive:false});
      document.addEventListener('mouseup', up);
      document.addEventListener('touchend', up);
      e.preventDefault();
    }
    function move(e){
      if(!pfAvBCrop.dragging) return;
      var p = e.touches ? e.touches[0] : e;
      var boxRatio = pfAvBCrop.stageW/pfAvBCrop.stageH;
      var srcRatio = pfAvBCrop.natW/pfAvBCrop.natH;
      var ratio = pfAvBCrop.axis==='x' ? (srcRatio/boxRatio) : (boxRatio/srcRatio);
      var overflowPx = pfAvBCrop.axis==='x' ? pfAvBCrop.stageW*(ratio-1) : pfAvBCrop.stageH*(ratio-1);
      if(overflowPx <= 0) return;
      var dPx = pfAvBCrop.axis==='x' ? (p.clientX-pfAvBCrop.sx) : (p.clientY-pfAvBCrop.sy);
      var dPct = -(dPx/overflowPx)*100;
      var val = Math.max(0, Math.min(100, (pfAvBCrop.axis==='x'?pfAvBCrop.ox:pfAvBCrop.oy) + dPct));
      if(pfAvBCrop.axis==='x') pfAvBCrop.x = val; else pfAvBCrop.y = val;
      pfAvBCropRender();
    }
    function up(){
      pfAvBCrop.dragging = false;
      if(stageEl) stageEl.classList.remove('dragging');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchend', up);
    }
    document.addEventListener('DOMContentLoaded', function(){
      var el = document.getElementById('pfAvBCropStage');
      if(!el) return;
      el.addEventListener('mousedown', down);
      el.addEventListener('touchstart', down, {passive:false});
    });
  })();
  function cancelPfAvBCrop(){
    document.getElementById('pfAvBCropMod').classList.remove('open');
    pfAvBCropPending = null;
    document.getElementById('pfAvatarFileInput').value = '';
    document.getElementById('pfBannerFileInput').value = '';
  }
  function confirmPfAvBCrop(){
    if(!pfAvBCropPending) return;
    var kind = pfAvBCrop.kind;
    var dims = PF_AVB_DIMS[kind];
    var natW = pfAvBCrop.natW, natH = pfAvBCrop.natH;
    var targetRatio = dims.w/dims.h;
    var srcRatio = natW/natH;
    var cropW, cropH;
    if(srcRatio > targetRatio){ cropH = natH; cropW = natH*targetRatio; }
    else { cropW = natW; cropH = natW/targetRatio; }
    var cropX = (natW-cropW) * (pfAvBCrop.x/100);
    var cropY = (natH-cropH) * (pfAvBCrop.y/100);
    var canvas = document.createElement('canvas');
    canvas.width = dims.w; canvas.height = dims.h;
    var ctx = canvas.getContext('2d');
    var img = document.getElementById('pfAvBCropImg');
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, dims.w, dims.h);
    var btn = document.getElementById('pfAvBCropBtn');
    btn.disabled = true; btn.textContent = 'SAVING…';
    canvas.toBlob(function(blob){
      doPfAvBUpload(kind, blob).finally(function(){
        btn.disabled = false; btn.textContent = 'Use This ✦';
        document.getElementById('pfAvBCropMod').classList.remove('open');
        pfAvBCropPending = null;
      });
    }, 'image/jpeg', 0.9);
  }
  async function doPfAvBUpload(kind, blob){
    try{
      if(!currentUser){ showToast('Sign in required'); return; }
      var left = pfAvBCooldownLeft(pf.profile && pf.profile[kind+'_updated_at']);
      if(left>0){ showToast((kind==='banner'?'Banner':'Profile photo')+' was updated recently. '+pfAvBCooldownMsg(left)); return; }
      var oldPath = pf.profile && pf.profile[kind+'_storage_path'];
      var path = kind+'s/'+currentUser.id+'/'+Date.now()+'.jpg';
      var publicUrl = await s3Upload(BUCKET,path,blob);
      var nowIso = new Date().toISOString();
      var updates = {}; 
      updates[kind+'_url'] = publicUrl;
      updates[kind+'_storage_path'] = path;
      updates[kind+'_updated_at'] = nowIso;
      var{error:de}=await sb.from('profiles').update(updates).eq('id',currentUser.id);
      if(de) throw de;
      /* Old file is removed only after the new row commits successfully,
         so a failed update never leaves the profile pointing at a file
         that's already been deleted. */
      if(oldPath) await s3Delete(BUCKET,oldPath);
      Object.assign(pf.profile, updates);
      pfRenderAvatarBanner();
      if(pf.profile.username){
        pfMediaCache[pf.profile.username] = { avatar_url: pf.profile.avatar_url||null, banner_url: pf.profile.banner_url||null };
      }
      if(kind==='avatar'){
        /* Push the new photo to every other avatar chip app-wide — nav
           bar, comment bar, subscription card — not just the profile page. */
        currentUserAvatarUrl = publicUrl;
        avAuthorProfileCache[currentUser.id] = { username: pf.profile.username, avatar_url: publicUrl };
        syncAuthBtn();
        /* Community chat resolves authors from a live map — update our own
           entry and repaint so the new photo appears at once, rather than
           waiting up to 5s for the next poll tick. */
        if(typeof cpAuthors !== 'undefined' && cpAuthors){
          cpAuthors[String(currentUser.id)] = {
            name  : (pf.profile.display_name || pf.profile.username || 'User'),
            avatar: publicUrl
          };
          try{ if(typeof cpRender === 'function') cpRender(); }catch(e){}
        }
      }
      showToast((kind==='banner'?'Banner':'Profile photo')+' updated ✦');
    }catch(err){ console.error('Error: '+err.message);
      /* Merit gate (<80) surfaces as a raw RLS error — explain it. */
      if(window.meritDenied && window.meritDenied(err, 'upload')) return;
      showToast(safeErr(err, 'Upload failed \u2014 try again')); }
    finally{
      document.getElementById('pfAvatarFileInput').value = '';
      document.getElementById('pfBannerFileInput').value = '';
    }
  }

  let tT;
  function showToast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(tT);tT=setTimeout(()=>t.classList.remove('show'),3000);}

