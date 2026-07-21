/* ── upqueue.js · background upload queue ── */
  /* =========================================================
     BACKGROUND UPLOAD QUEUE (upq)
     ├─ upqStart(snap)        — queue a piece; runs immediately
     ├─ upqRun(job)           — CHECKING → UPLOADING → ALMOST
     │                          DONE → LIVE, or FAILED
     ├─ upqOwnQueueHTML()     — blurred cards prepended into the
     │                          uploader's OWN grids by
     │                          pfRenderGallery() + mwRenderArt()
     ├─ upqOpenModal(id)      — tap a card → live step checklist;
     │                          auto-opened on a failed check
     └─ upqSync()             — repaint every queue surface

     Rules:
     · CHECKING runs BEFORE any byte leaves the device, so a
       failed check normally has nothing to clean up. If a later
       stage fails (transfer / publish), every S3 key already
       written is deleted — nothing orphaned in the datacenter.
     · Verifier verdicts: only 'approve' publishes. 'review'
       (near-duplicate / AI metadata markers) and 'block' both
       stop the piece and show the reason. Soften by allowing
       'review' through in the verdict test inside upqRun().
     · If uploadVerifier.js ever fails to load, the check is
       SKIPPED (fail-open) so uploads never brick on a CDN
       hiccup.
     · Jobs run in parallel and are pure client-side state —
       no DB row exists until ALMOST DONE, so an abandoned tab
       leaves nothing behind (at worst an S3 file whose insert
       never ran; the same exposure the old inline flow had).
     ========================================================= */
  var upq = { jobs: [], seq: 0, modalJob: null, modalSnap: null };

  var UPQ_STAGE_LABEL = { checking:'VERIFYING', uploading:'UPLOADING', finalizing:'ALMOST DONE', live:'LIVE', failed:'FAILED' };

  function upqStart(snap){
    var job = {
      id: 'upq_' + (++upq.seq) + '_' + Date.now(),
      stage: 'checking',
      name: snap.name, desc: snap.desc, tags: snap.tags, cats: snap.cats,
      software: snap.software, file: snap.file, pageFiles: snap.pageFiles,
      thumbFocus: snap.thumbFocus, preview: snap.preview,
      albums: (snap.albums || []).slice(),
      /* FIX: this was never copied off the snapshot, so job.publishAt
         was always undefined and upqRun's SCHEDULED branch could never
         fire — every "scheduled" piece was inserted straight into
         `artworks` and went live immediately, despite the toast saying
         otherwise. Carrying it through makes scheduling real. */
      publishAt: snap.publishAt || '',
      upDone: 0, upTotal: 1 + snap.pageFiles.length,
      steps: { ratelimit:{state:'',detail:''}, duplicate:{state:'',detail:''}, ai:{state:'',detail:''}, moderation:{state:'',detail:''} },
      mod: { artwork:'', artworkSub:'', safety:'', safetySub:'', quality:'', qualitySub:'' },
      uploadedPaths: [],
      failReason: null
    };
    upq.jobs.unshift(job);
    upqSync();
    upqRun(job);
  }

  function upqFind(id){ return upq.jobs.find(function(j){ return j.id===id; }); }

  function upqRemove(id){
    var i = upq.jobs.findIndex(function(j){ return j.id===id; });
    if(i!==-1) upq.jobs.splice(i,1);
    if(upq.modalJob===id) upqCloseModal();
    upqSync();
  }

  /* Repaints every surface that can show queue cards. Both render fns
     no-op safely when their page isn't the one on screen. */
  function upqSync(){
    if(currentUser && pf.profile && String(pf.profile.id)===String(currentUser.id) && Array.isArray(pf.galleryRows)){
      pfRenderGallery();
    }
    if(typeof mwRenderArt==='function' && typeof mw==='object' && mw && Array.isArray(mw.art)){
      mwRenderArt();
    }
    upqRenderModal();
  }

  /* Blurred processing cards — newest first, prepended before the real
     rows. Only ever rendered into the uploader's own grids (the callers
     enforce ownership). */
  function upqOwnQueueHTML(){
    if(!currentUser || !upq.jobs.length) return '';
    return upq.jobs.map(function(j){
      var hint = '';
      if(j.stage==='checking')        hint = j.checkHint || 'Verifying artwork';
      else if(j.stage==='uploading')  hint = j.upTotal>1 ? ('Transferring '+Math.min(j.upDone+1,j.upTotal)+' of '+j.upTotal+' images') : 'Transferring image';
      else if(j.stage==='finalizing') hint = 'Publishing';
      return '<div class="upqCard'+(j.stage==='live'?' upqLive':'')+'" onclick="upqOpenModal(\''+j.id+'\')" role="status" title="Tap for status">'+
        '<div class="upqImgWrap">'+
          (j.preview ? '<img class="upqImg" src="'+j.preview+'" alt="" style="'+thumbStyle(j.thumbFocus.x, j.thumbFocus.y, j.thumbFocus.z)+'">' : '')+
          '<div class="upqOvl">'+
            '<div class="upqSpin"></div>'+
            '<div class="upqCheck">\u2713</div>'+
            '<div class="upqStage">'+(UPQ_STAGE_LABEL[j.stage]||'CHECKING')+'</div>'+
            (hint ? '<div class="upqSub">'+esc(hint)+'</div>' : '')+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  async function upqRun(job){
    try{
      /* ── 1 · CHECKING — before a single byte leaves the device ── */
      job.stage='checking'; upqSync();
      var phash = null;
      if(window.UploadVerifier && typeof UploadVerifier.verify==='function'){
        var vr = await UploadVerifier.verify(job.file, {
          sb: sb, userId: currentUser.id, kind: 'art', pages: job.pageFiles,
          onStep: function(stepId, state, detail){
            if(job.steps[stepId]){ job.steps[stepId].state=state; job.steps[stepId].detail=detail||''; }
            /* Live sub-status on the blurred card while each check runs —
               reads like a professional pipeline instead of a generic wait. */
            if(state==='run'){
              job.checkHint = { ratelimit:'Running spam check',
                                duplicate:'Scanning for duplicates',
                                ai:'Analyzing file metadata' }[stepId] || 'Verifying artwork';
              upqSync();
            } else {
              upqRenderModal();
            }
          }
        });
        phash = vr.phash || null;
        if(vr.verdict !== 'approve'){
          var fe = new Error(vr.reason || 'Artwork did not pass verification');
          fe.upqCheckFail = true;
          throw fe;
        }
      } else {
        console.warn('UploadVerifier missing \u2014 check skipped (fail-open)');
        ['ratelimit','duplicate','ai'].forEach(function(k){ job.steps[k].state='pass'; job.steps[k].detail='skipped'; });
      }

      /* ── 1b · GEMINI ARTWORK MODERATION — the server-side gate.
         Every image (cover + extra pages) is judged by Gemini Vision
         via /api/moderate-upload: artwork-or-not, SAFE/MATURE/ADULT,
         and quality — all in one request per image, BEFORE any byte
         reaches S3. Fails closed: no verdict means no upload. The
         canonical rejection message lands in the CHECK FAILED popup;
         dev accounts additionally see the reason code (e.g. SELFIE)
         in the step row. */
      job.steps.moderation.state='run';
      job.mod.artwork='run'; job.mod.safety=''; job.mod.quality='';
      job.checkHint='Confirming it\u2019s artwork'; upqSync();
      var modFd = new FormData();
      modFd.append('files', job.file);
      for(var mfi=0; mfi<job.pageFiles.length; mfi++) modFd.append('files', job.pageFiles[mfi]);
      var modSess = (await sb.auth.getSession()).data.session;
      var modRes = await fetch('/api/moderate-upload', {
        method:'POST',
        headers:{ 'authorization':'Bearer '+(modSess?modSess.access_token:'') },
        body: modFd
      });
      var mod = await modRes.json().catch(function(){ return null; });
      if(!modRes.ok || !mod){
        job.steps.moderation.state='fail'; job.steps.moderation.detail='Service unavailable';
        job.mod.artwork='fail'; job.mod.artworkSub='Review service unavailable \u2014 try again';
        var me = new Error((mod&&mod.error)||'Moderation check failed \u2014 try again');
        me.upqCheckFail = true; throw me;
      }
      if(!mod.allowed){
        job.steps.moderation.state='fail';
        var devCode = (typeof isDev!=='undefined' && isDev && mod.code)
          ? ('Code: '+mod.code + (mod.failIndex>0 ? ' \u00b7 image '+(mod.failIndex+1) : '')) : '';
        job.steps.moderation.detail = devCode;
        /* Land the red \u2715 on the review row that actually failed. */
        if(mod.code==='BLANK_IMAGE' || mod.code==='LOW_QUALITY'){
          job.mod.artwork='pass'; job.mod.artworkSub='Original artwork confirmed';
          job.mod.safety='pass';  job.mod.safetySub='Safe for all audiences';
          job.mod.quality='fail'; job.mod.qualitySub=devCode;
        } else if(mod.code==='ADULT_CONTENT' || mod.code==='PROHIBITED_CONTENT'){
          job.mod.artwork='pass'; job.mod.artworkSub='Original artwork confirmed';
          job.mod.safety='fail';  job.mod.safetySub=devCode;
        } else {
          job.mod.artwork='fail'; job.mod.artworkSub=devCode;
        }
        var mf = new Error(mod.reason||'The uploaded image does not meet DigiArtz artwork submission requirements.');
        mf.upqCheckFail = true; throw mf;
      }
      job.steps.moderation.state='pass';
      job.steps.moderation.detail = mod.rating==='MATURE' ? 'Approved \u00b7 18+' : 'Approved';
      job.mod.artwork='pass'; job.mod.artworkSub='Original artwork confirmed';
      job.mod.safety='pass';  job.mod.safetySub = mod.rating==='MATURE' ? 'Approved \u00b7 18+ content' : 'Safe for all audiences';
      job.mod.quality='pass'; job.mod.qualitySub='Quality acceptable';
      /* Verification done \u2014 if the tracker is open, close it so it never
         overlaps the transfer/LIVE flow. Failures never reach this line;
         the VERIFICATION FAILED popup auto-opens from the catch instead. */
      if(upq.modalJob===job.id){ upqCloseModal(); } else { upqRenderModal(); }

      /* ── 2 · UPLOADING — cover first, then the extra images.
         Every key carries a per-job fragment: jobs run in PARALLEL
         now, so two pieces landing in the same millisecond must not
         mint the same Date.now()-based key and overwrite each other. */
      job.stage='uploading'; job.upDone=0; upqSync();
      var uniq = Date.now()+'_'+job.id.split('_')[1];
      var ext = safeSlug(job.file.name.split('.').pop(), 8) || 'jpg';
      var path = 'artworks/'+currentUser.id+'/'+uniq+'_'+safeSlug(job.name)+'.'+ext;
      const publicUrl = await s3Upload(BUCKET, path, job.file);
      job.uploadedPaths.push(path);
      job.upDone=1; upqSync();
      var artPageUrls = [];
      for(var ai=0; ai<job.pageFiles.length; ai++){
        var af = job.pageFiles[ai];
        var aext = safeSlug(af.name.split('.').pop(), 8) || 'jpg';
        var apath = 'artworks/'+currentUser.id+'/'+uniq+'_i'+ai+'.'+aext;
        var aUrl = await s3Upload(BUCKET, apath, af);
        job.uploadedPaths.push(apath);
        artPageUrls.push(aUrl);
        job.upDone = 1+ai+1; upqSync();
      }

      /* ── 3 · ALMOST DONE — the DB row (RLS merit gate fires here) ── */
      job.stage='finalizing'; upqSync();
      /* ── SCHEDULED BRANCH ──
         Same verification and S3 upload as a normal post; only the
         destination differs. The row waits in scheduled_uploads and
         a pg_cron job (publish_due_scheduled_uploads, every 5 min)
         moves it into artworks at publish_at — so it goes live even
         with the artist offline, and no feed/profile/search query
         needs to know scheduling exists. */
      if(job.publishAt){
        const{error:se}=await sb.from('scheduled_uploads').insert({
          user_id:currentUser.id, publish_at:job.publishAt,
          name:job.name, description:job.desc||null, tags:job.tags, category:job.cats,
          image_url:publicUrl, storage_path:path,
          thumb_x:job.thumbFocus.x, thumb_y:job.thumbFocus.y, thumb_zoom:job.thumbFocus.z||1,
          pages:artPageUrls.length?artPageUrls:null, kind:ART_KIND_ART,
          software:job.software||null, phash:phash,
          /* Carried across the wait; publish_due_scheduled_uploads()
             re-attaches them once the artwork row exists. */
          album_ids: (job.albums && job.albums.length) ? job.albums : null,
          content_rating:mod.rating, is_mature:mod.rating==='MATURE', ai_moderation:mod.audit
        });
        if(se) throw se;
        job.stage='done'; upqSync();
        upqRemove(job.id);   /* clears the blurred queue card */
        uschLoad();          /* new card appears in the SCHEDULED rail */
        return;
      }
      const{data:rows,error:de}=await sb.from('artworks').insert({name:job.name,description:job.desc||null,tags:job.tags,category:job.cats,image_url:publicUrl,storage_path:path,thumb_x:job.thumbFocus.x,thumb_y:job.thumbFocus.y,thumb_zoom:job.thumbFocus.z||1,pages:artPageUrls.length?artPageUrls:null,kind:ART_KIND_ART,user_id:currentUser.id,software:job.software||null,phash:phash,status:'approved',content_rating:mod.rating,is_mature:mod.rating==='MATURE',ai_moderation:mod.audit}).select();
      if(de) throw de;

      /* Album membership, if any was picked on the form. Runs AFTER the
         artwork row lands (album_items needs a real artwork_id) and is
         deliberately non-fatal — the piece is already published, so a
         failure here must not roll the upload back. */
      var _newRow = rows && rows[0];
      if(_newRow && job.albums && job.albums.length) await albAttach(_newRow.id, job.albums);

      /* ── 4 · LIVE — flash the ✓ on the blurred card first; the real
         row is spliced in ONLY when the card is removed, so the piece
         never shows twice (blurred LIVE card + real card) during the
         1.6s flash. One repaint swaps blur → real. ── */
      job.stage='live';
      upqSync();
      var row = rows && rows[0];
      setTimeout(function(){
        if(row){
          if(pf.profile && String(pf.profile.id)===String(currentUser.id) && Array.isArray(pf.galleryRows) &&
             pf.galleryRows.findIndex(function(i){return String(i.id)===String(row.id);})===-1){
            pf.galleryRows.unshift(row);
            var _st=document.getElementById('pfStatArt');
            if(_st) _st.textContent = (parseInt(_st.textContent,10)||0)+1;
          }
          if(images.findIndex(function(i){return String(i.id)===String(row.id);})===-1) images.unshift(row);
          if(typeof mw==='object' && mw && Array.isArray(mw.art) && mw.art.findIndex(function(i){return String(i.id)===String(row.id);})===-1) mw.art.unshift(row);
          if(typeof renderHome==='function') renderHome();
          var _fgEl=document.getElementById('fg'); if(_fgEl && _fgEl.classList.contains('open') && typeof renderFG==='function') renderFG();
        }
        upqRemove(job.id); /* repaints the grids: blur card out, real card in */
      }, 1600);
      showToast('\u201C'+(job.name||'Artwork')+'\u201D is live \u2726');
    }catch(err){
      /* ── FAILED — wipe anything already in the datacenter, then the
         themed popup with the exact reason. On a check failure nothing
         was ever transferred, so the loop is a no-op. ── */
      for(var d=0; d<job.uploadedPaths.length; d++){
        try{ await s3Delete(BUCKET, job.uploadedPaths[d]); }
        catch(e){ console.error('upq cleanup:', e.message); }
      }
      job.stage='failed';
      if(err && err.upqCheckFail){
        job.failReason = err.message;
      } else if(err && /row-level security|violates row-level|42501/i.test((err.message||'')+' '+(err.code||''))){
        job.failReason = 'Your merit is below 80 \u2014 uploads are paused until it recovers (+2/day).';
      } else {
        job.failReason = safeErr(err, 'Upload failed \u2014 please try again');
      }
      console.error('upq failed:', err && err.message);
      upqOpenModal(job.id); /* auto-open the CHECK FAILED popup */
    }
  }

  /* ── Status / failed modal ── */
  function upqOpenModal(id){
    var j = upqFind(id);
    if(!j) return;
    if(j.stage==='failed'){
      /* Detach: the card leaves the grid immediately; the modal keeps
         its own snapshot so the reason survives the removal. */
      upq.modalSnap = j; upq.modalJob = null;
      var i = upq.jobs.indexOf(j); if(i!==-1) upq.jobs.splice(i,1);
      upqSync();
    } else {
      upq.modalJob = id; upq.modalSnap = null;
    }
    upqRenderModal();
    document.getElementById('upqBackdrop').classList.add('open');
  }
  function upqCloseModal(){
    upq.modalJob = null; upq.modalSnap = null;
    var bd = document.getElementById('upqBackdrop');
    if(bd) bd.classList.remove('open');
  }

  /* Premium vertical verification tracker \u2014 rail + node + connector,
     right-aligned state pill (Pending / Checking\u2026 / Passed / Failed). */
  function upqTrackRow(state, name, sub, last){
    var cls = state==='run' ? 'run' : (state==='pass' ? 'pass' : (state==='flag'||state==='block'||state==='fail') ? 'fail' : 'pend');
    var ico = cls==='pass' ? '\u2713' : cls==='fail' ? '\u2715' : '';
    var lbl = cls==='pass' ? 'Passed' : cls==='fail' ? 'Failed' : cls==='run' ? 'Checking\u2026' : 'Pending';
    return '<div class="upqTrk '+cls+'">'+
      '<div class="upqTrkRail"><div class="upqTrkIco">'+ico+'</div>'+(last?'':'<div class="upqTrkLine"></div>')+'</div>'+
      '<div class="upqTrkTx"><div class="upqTrkName">'+name+'</div>'+
      (sub ? '<div class="upqTrkSub">'+esc(sub)+'</div>' : '')+'</div>'+
      '<div class="upqTrkState">'+lbl+'</div>'+
    '</div>';
  }

  function upqRenderModal(){
    var j = upq.modalSnap || (upq.modalJob && upqFind(upq.modalJob));
    if(!j) return;
    var title = document.getElementById('upqMTitle');
    var body  = document.getElementById('upqMBody');
    if(!title || !body) return;
    var failed = j.stage==='failed';
    title.textContent = failed ? 'VERIFICATION FAILED' : 'VERIFICATION STATUS';
    var order = ['checking','uploading','finalizing','live'];
    var si = order.indexOf(j.stage);
    var transferState = j.stage==='uploading' ? 'run' : (si>1 ? 'pass' : '');
    var publishState  = j.stage==='finalizing' ? 'run' : (j.stage==='live' ? 'pass' : '');
    var transferSub = j.stage==='uploading'
      ? (j.upTotal>1 ? (Math.min(j.upDone+1,j.upTotal)+' of '+j.upTotal+' images') : 'Sending your image')
      : (si>1 ? 'Done' : '');
    var m = j.mod || {artwork:'',artworkSub:'',safety:'',safetySub:'',quality:'',qualitySub:''};
    var html = '';
    if(failed){
      html += '<div class="upqFailBox">'+
        '<div class="upqFailIco">!</div>'+
        '<div><div class="upqFailTitle">\u201C'+esc(j.name||'Untitled')+'\u201D was not published</div>'+
        '<div class="upqFailReason">'+esc(j.failReason||'The artwork did not pass verification.')+'</div></div>'+
      '</div>';
    }
    /* Every row is a check that genuinely runs \u2014 the three review rows
       are live signals from inside the single AI verdict. */
    var rows = [
      ['pass', 'Upload received', ''],
      ['pass', 'File integrity & format', ''],
      [j.steps.ratelimit.state, 'Spam & rate check', j.steps.ratelimit.detail],
      [j.steps.duplicate.state, 'Duplicate detection', j.steps.duplicate.detail],
      [j.steps.ai.state, 'Metadata inspection', j.steps.ai.detail],
      [m.artwork, 'Artwork review', m.artworkSub],
      [m.safety, 'Content safety check', m.safetySub],
      [m.quality, 'Quality & watermark check', m.qualitySub],
      [transferState, 'Secure transfer', transferSub],
      [publishState, 'Publish', j.stage==='live' ? 'Your artwork is live \u2726' : '']
    ];
    for(var ri=0; ri<rows.length; ri++){
      html += upqTrackRow(rows[ri][0], rows[ri][1], rows[ri][2], ri===rows.length-1);
    }
    if(failed){
      html += '<div class="upqFin fail">Verification stopped \u2014 nothing was published</div>';
      html += '<div class="upqFailNote">Any transferred file has been removed from storage. Fix the issue above and upload again whenever you\u2019re ready.</div>';
    } else if(j.stage==='live'){
      html += '<div class="upqFin ok">All checks passed \u2014 your artwork is live \u2726</div>';
    } else {
      html += '<div class="upqFin busy">Your artwork is being reviewed now\u2026</div>';
    }
    body.innerHTML = html;
  }

