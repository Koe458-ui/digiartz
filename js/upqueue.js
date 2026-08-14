// background upload queue
  var upq = { jobs: [], seq: 0, modalJob: null, modalSnap: null };

  var UPQ_STAGE_LABEL = { checking:'VERIFYING', uploading:'UPLOADING', finalizing:'ALMOST DONE', live:'LIVE', failed:'FAILED' };

  function upqStart(snap){
    var job = {
      id: 'upq_' + (++upq.seq) + '_' + Date.now(),
      stage: 'checking',
      name: snap.name, desc: snap.desc, tags: snap.tags, cats: snap.cats,
      software: snap.software, file: snap.file, pageFiles: snap.pageFiles,
      // the rest of the upload form, snapshotted with everything else so the
      // panel is free to reset the moment the job is queued
      extra: snap.extra || {},
      thumbFocus: snap.thumbFocus, preview: snap.preview,
      albums: (snap.albums || []).slice(),
      // copy publish time from snapshot
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

  // repaint queue surfaces
  function upqSync(){
    if(currentUser && pf.profile && String(pf.profile.id)===String(currentUser.id) && Array.isArray(pf.galleryRows)){
      pfRenderGallery();
    }
    if(typeof mwRenderArt==='function' && typeof mw==='object' && mw && Array.isArray(mw.art)){
      mwRenderArt();
    }
    upqRenderModal();
  }

  // blurred processing cards
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
      // 1 checking
      job.stage='checking'; upqSync();
      var phash = null;
      if(window.UploadVerifier && typeof UploadVerifier.verify==='function'){
        var vr = await UploadVerifier.verify(job.file, {
          sb: sb, userId: currentUser.id, kind: 'art', pages: job.pageFiles,
          onStep: function(stepId, state, detail){
            if(job.steps[stepId]){ job.steps[stepId].state=state; job.steps[stepId].detail=detail||''; }
            // live sub status
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

      // 1b gemini moderation
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
        // mark the failed row
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
      // close tracker when done
      if(upq.modalJob===job.id){ upqCloseModal(); } else { upqRenderModal(); }

      // 2 uploading
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

      // 3 almost done
      job.stage='finalizing'; upqSync();

      // ---- the half of the row nobody typed --------------------------------
      // Format, size and dimensions come off the file itself; the SEO pair and
      // the slug come off what was typed. None of them has a box on the panel,
      // because a format someone types disagrees with the file and a slug that
      // drifts from the title is a link that lies.
      var x = {}, ek;
      for(ek in (job.extra||{})) x[ek] = job.extra[ek];
      var _f = job.file || {};
      var _em = /\.([a-z0-9]{1,8})$/i.exec(String(_f.name||''));
      x.file_ext  = _em ? _em[1].toLowerCase() : ((_f.type||'').split('/')[1] || null);
      x.file_size = _f.size || null;
      if(typeof dzImageDims === 'function'){
        var _d = await dzImageDims(_f);           // "3000×4000 px", or nothing
        var _dm = _d && /^(\d+)×(\d+)/.exec(_d);
        if(_dm){ x.width = +_dm[1]; x.height = +_dm[2]; }
      }
      x.seo_title = (typeof dzSeoTitle === 'function') ? dzSeoTitle('', job.name) : null;
      x.seo_description = (typeof dzSeoDesc === 'function') ? dzSeoDesc('', job.desc, job.desc) : null;
      x.slug = (typeof dzSlugify === 'function')
        ? (dzSlugify(job.name).slice(0,110) + '-' + String(Date.now()).slice(-6))
        : null;
      // the uploader's declaration and the reviewer's judgement, OR-ed
      var _mature = (mod.rating === 'MATURE') || !!x.declared_mature;

      // scheduled branch
      if(job.publishAt){
        const{error:se}=await sb.from('scheduled_uploads').insert({
          user_id:currentUser.id, publish_at:job.publishAt,
          name:job.name, description:job.desc||null, tags:job.tags, category:job.cats,
          image_url:publicUrl, storage_path:path,
          thumb_x:job.thumbFocus.x, thumb_y:job.thumbFocus.y, thumb_zoom:job.thumbFocus.z||1,
          pages:artPageUrls.length?artPageUrls:null, kind:ART_KIND_ART,
          software:job.software||null, phash:phash,
          // reattach albums later
          album_ids: (job.albums && job.albums.length) ? job.albums : null,
          content_rating:mod.rating, is_mature:_mature, ai_moderation:mod.audit,
          mod_token:mod.token||null,
          // the rest of the form, unpacked by publish_due_scheduled_uploads
          // when its time comes
          extra: x
        });
        if(se) throw se;
        job.stage='done'; upqSync();
        upqRemove(job.id);   // clears the queue card
        uschLoad();          // new scheduled card
        return;
      }
      var artRow = {
        name:job.name, description:job.desc||null, tags:job.tags, category:job.cats,
        image_url:publicUrl, storage_path:path,
        thumb_x:job.thumbFocus.x, thumb_y:job.thumbFocus.y, thumb_zoom:job.thumbFocus.z||1,
        pages:artPageUrls.length?artPageUrls:null, kind:ART_KIND_ART,
        user_id:currentUser.id, software:job.software||null, phash:phash, status:'approved',
        content_rating:mod.rating, is_mature:_mature, ai_moderation:mod.audit,
        mod_token:mod.token||null
      };
      // everything the panel's extra fields hold, plus what was read off the
      // upload. declared_mature is not a column — it was folded into is_mature
      // above, which is the one the site reads.
      ['summary','subject_matter','medium','software_list','license','commercial_use',
       'attribution_required','modification_allowed','credits','process_notes',
       'external_links','comments_allowed','visibility','featured',
       'seo_title','seo_description','slug','file_ext','file_size','width','height'
      ].forEach(function(k){ if(x[k] !== undefined) artRow[k] = x[k]; });

      const{data:rows,error:de}=await sb.from('artworks').insert(artRow).select();
      if(de) throw de;

      // album membership
      var _newRow = rows && rows[0];
      if(_newRow && job.albums && job.albums.length) await albAttach(_newRow.id, job.albums);

      // media bookkeeping: cover at position 0, extra pages after it. Each one
      // lands in artwork_image (the public derivative) and artwork_file (the
      // untouched original). Fail-soft by design — the artwork is already live.
      if(_newRow){
        await dzRecordUpload({
          imageKind:'artworkImage', fileKind:'artworkFile', parentId:_newRow.id,
          url:publicUrl, path:path, file:job.file, position:0
        });
        for(var mi=0; mi<job.pageFiles.length; mi++){
          await dzRecordUpload({
            imageKind:'artworkImage', fileKind:'artworkFile', parentId:_newRow.id,
            url:artPageUrls[mi], path:job.uploadedPaths[mi+1],
            file:job.pageFiles[mi], position:mi+1
          });
        }
      }

      // 4 live
      job.stage='live';
      upqSync();
      var row = rows && rows[0];

      /* The piece is published. Every cached listing it belongs in is dropped
         now — and NOT one line earlier: the order is upload the object, write
         the row, confirm the write, then invalidate. Dropping the caches before
         the insert lands leaves a window in which a refresh reads the gallery
         from before the upload and stores that as the current answer, which is
         exactly the bug this ordering exists to prevent.

         No image purge here. The objects were written seconds ago under paths
         nothing has requested yet, so there is nothing cached to remove. */
      if(row && typeof window.dzArtworkChanged === 'function'){
        window.dzArtworkChanged(row.id, { userId: row.user_id || (currentUser && currentUser.id) });
      }
      setTimeout(function(){
        if(row){
          if(pf.profile && String(pf.profile.id)===String(currentUser.id) && Array.isArray(pf.galleryRows) &&
             pf.galleryRows.findIndex(function(i){return String(i.id)===String(row.id);})===-1){
            pf.galleryRows.unshift(row);
            // it is on the page without having been fetched, so the paging
            // index and the window have to count it
            if(typeof pfGalleryAdopt==='function') pfGalleryAdopt(row.id);
            var _st=document.getElementById('pfStatArt');
            if(_st) _st.textContent = (parseInt(_st.textContent,10)||0)+1;
          }
          if(images.findIndex(function(i){return String(i.id)===String(row.id);})===-1) images.unshift(row);
          if(typeof mw==='object' && mw && Array.isArray(mw.art) && mw.art.findIndex(function(i){return String(i.id)===String(row.id);})===-1) mw.art.unshift(row);
          if(typeof renderHome==='function') renderHome();
          var _fgEl=document.getElementById('fg'); if(_fgEl && _fgEl.classList.contains('open') && typeof renderFG==='function') renderFG();
          // the new piece was pushed onto `images` above, so the saved copy is
          // rewritten with it at the front rather than left one short
          if(typeof window.dzGalleryStore==='function') window.dzGalleryStore();
        }
        upqRemove(job.id); // blur card out, real card in
      }, 1600);
      showToast('\u201C'+(job.name||'Artwork')+'\u201D is live');
    }catch(err){
      // failed, wipe uploads
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
      upqOpenModal(job.id); // open check failed popup
    }
  }

  // status modal
  function upqOpenModal(id){
    var j = upqFind(id);
    if(!j) return;
    if(j.stage==='failed'){
      // detach, keep snapshot
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

  // verification tracker row
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
    // check rows
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
      [publishState, 'Publish', j.stage==='live' ? 'Your artwork is live' : '']
    ];
    for(var ri=0; ri<rows.length; ri++){
      html += upqTrackRow(rows[ri][0], rows[ri][1], rows[ri][2], ri===rows.length-1);
    }
    if(failed){
      html += '<div class="upqFin fail">Verification stopped \u2014 nothing was published</div>';
      html += '<div class="upqFailNote">Any transferred file has been removed from storage. Fix the issue above and upload again whenever you\u2019re ready.</div>';
    } else if(j.stage==='live'){
      html += '<div class="upqFin ok">All checks passed \u2014 your artwork is live</div>';
    } else {
      html += '<div class="upqFin busy">Your artwork is being reviewed now\u2026</div>';
    }
    body.innerHTML = html;
  }


  /* ---- leaving with an upload still running ------------------------------
     The queue lives in this tab and nowhere else. Nothing is written down and
     nothing resumes, so a refresh, a closed tab or a tapped link took the job
     with it and said nothing — after minutes of somebody's connection, and
     with however many objects had already reached storage left behind. The
     cleanup that removes those runs only inside upqRun's own catch, so it
     never gets the chance.

     A confirmation is what a page can actually do about that. Browsers show
     their own wording and ignore whatever string is returned, so there is no
     message to write here; what matters is that the event is cancelled, and
     only while something is genuinely in flight — a dialog on every navigation
     would be worse than the bug.

     Not attempted: sweeping the leftover objects on the next visit. It would
     need a list of paths that survives the crash, and a list that is one write
     behind reality is a list that deletes a published artwork's file. The
     orphans are a storage cost; that would be data loss. */
  function upqBusy(){
    for(var i = 0; i < upq.jobs.length; i++){
      var st = upq.jobs[i].stage;
      if(st === 'checking' || st === 'uploading' || st === 'finalizing') return true;
    }
    return false;
  }
  window.upqBusy = upqBusy;

  window.addEventListener('beforeunload', function(e){
    if(!upqBusy()) return;
    e.preventDefault();
    e.returnValue = '';   // the half every current browser actually reads
    return '';
  });
