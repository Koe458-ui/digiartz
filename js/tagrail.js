// tag preferences and the picker they are chosen in
  var tgAll = [];
  var tgPrefs = new Set();
  var tgLoaded = false;
  var TG_LS = 'dz_tagprefs1';

  // skip hidden categories
  function tgVisible(tag){
    if(!tag) return false;
    return (typeof catHidden === 'function') ? !catHidden(tag) : true;
  }
  function tgLabel(t){
    if(typeof CAT_LABELS === 'object' && CAT_LABELS && CAT_LABELS[t]) return CAT_LABELS[t];
    return t;
  }
  function tgLocalSave(){
    try{ localStorage.setItem(TG_LS, JSON.stringify(Array.from(tgPrefs))); }catch(e){}
  }
  function tgLocalLoad(){
    try{
      var v = JSON.parse(localStorage.getItem(TG_LS) || '[]');
      return Array.isArray(v)
        ? v.filter(function(x){ return typeof x === 'string' && tgVisible(x); })
        : [];
    }catch(e){ return []; }
  }
  async function tgSave(tag, on){
    tgLocalSave();
    if(!currentUser || !sb) return;
    try{
      if(on){
        await sb.from('user_tag_prefs')
          .upsert({user_id:currentUser.id, tag:tag}, {onConflict:'user_id,tag', ignoreDuplicates:true});
      } else {
        await sb.from('user_tag_prefs').delete().eq('user_id', currentUser.id).eq('tag', tag);
      }
    }catch(e){ console.error('tgSave:', e && e.message); }
  }
  async function tgLoad(force){
    if(tgLoaded && !force) return;
    tgLoaded = true;
    var local = tgLocalLoad();
    tgPrefs = new Set(local);
    if(sb){
      try{
        const{data,error} = await sb.rpc('get_top_tags', {lim:200});
        if(error) throw error;
        tgAll = (data || []).filter(function(x){ return x && x.tag && tgVisible(x.tag); });
      }catch(e){
        console.warn('get_top_tags failed — falling back to categories:', (e && e.message) || e);
        tgAll = [];
      }
      if(currentUser){
        try{
          const{data} = await sb.from('user_tag_prefs').select('tag').eq('user_id', currentUser.id);
          var rows = (data || []).map(function(r){ return r.tag; }).filter(tgVisible);
          if(rows.length){
            tgPrefs = new Set(rows);
            tgLocalSave();
          } else if(local.length){
            await sb.from('user_tag_prefs')
              .upsert(local.map(function(t){ return {user_id:currentUser.id, tag:t}; }),
                      {onConflict:'user_id,tag', ignoreDuplicates:true});
          }
        }catch(e){  }
      }
    }
    if(!tgAll.length) tgAll = tgFallbackVocab();
    (function(){
      var seen = {};
      for(var i=0;i<tgAll.length;i++) seen[tgAll[i].tag] = 1;
      var extra = tgFallbackVocab();
      for(var j=0;j<extra.length;j++) if(!seen[extra[j].tag]) tgAll.push(extra[j]);
    })();
    tgSyncBtn();
    tgApply();
  }
  function tgFallbackVocab(){
    if(typeof SITE_CATEGORIES === 'undefined' || !Array.isArray(SITE_CATEGORIES)) return [];
    return SITE_CATEGORIES
      .filter(function(c){ return c && c.slug && c.slug.length <= TAG_MAX; })
      .map(function(c){ return { tag:c.slug, uses:0, kind:'cat' }; });
  }

  /* The chip is the only place a picked tag shows now that the rail has
     gone, so it carries the dot the filter button uses for the same job. */
  function tgSyncBtn(){
    var btn = document.getElementById('fgTagsBtn');
    if(!btn) return;
    btn.classList.toggle('on', tgPrefs.size > 0);
    btn.setAttribute('aria-label', tgPrefs.size
      ? 'Tags — ' + tgPrefs.size + ' picked'
      : 'Tags');
  }
  // the gallery is the grid the picks reorder — repaint it only while it is
  // on screen, since opening it paints from scratch anyway
  function tgApply(){
    var fg = document.getElementById('fg');
    if(!fg || !fg.classList.contains('open')) return;
    if(typeof renderFG === 'function'){ try{ renderFG(); }catch(e){} }
  }
  // read by the gallery's own sort
  window.tgPickedTags = function(){ return tgPrefs; };

  function tgModOpen(){
    document.getElementById('tgMod').classList.add('open');
    document.body.style.overflow = 'hidden';
    var s = document.getElementById('tgModSearch');
    if(s) s.value = '';
    tgModRender('');
    setTimeout(function(){ if(s) s.focus(); }, 80);
  }
  function tgModClose(){
    document.getElementById('tgMod').classList.remove('open');
    restoreScroll();
    tgSyncBtn();
    tgApply();
  }
  function tgModRender(q){
    var host = document.getElementById('tgModGrid');
    if(!host) return;
    q = (q || '').trim().toLowerCase();
    var rows = tgAll.filter(function(x){
      return !q || x.tag.indexOf(q) !== -1 || tgLabel(x.tag).toLowerCase().indexOf(q) !== -1;
    });
    if(!rows.length){ host.innerHTML = '<div class="tgModNone">No matching tag</div>'; return; }
    host.innerHTML = rows.map(function(x){
      var on = tgPrefs.has(x.tag);
      return '<button type="button" class="tgModOpt'+(on?' on':'')+'" data-tag="'+esc(x.tag)+'" '+
        'onclick="tgModToggle(this)" aria-pressed="'+(on?'true':'false')+'">'+
        '<span class="tgModName">'+esc(tgLabel(x.tag))+'</span>'+
        '<span class="tgModTick" aria-hidden="true">'+(on?'✓':'')+'</span></button>';
    }).join('');
  }
  function tgModToggle(btn){
    var tag = btn && btn.getAttribute('data-tag');
    if(!tag) return;
    var on = !tgPrefs.has(tag);
    if(on) tgPrefs.add(tag); else tgPrefs.delete(tag);
    tgSave(tag, on);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var tick = btn.querySelector('.tgModTick');
    if(tick) tick.textContent = on ? '✓' : '';
    tgSyncBtn();
  }
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var m = document.getElementById('tgMod');
    if(m && m.classList.contains('open')) tgModClose();
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tgLoad(); });
  } else {
    tgLoad();
  }
