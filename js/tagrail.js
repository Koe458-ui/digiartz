// tag rail and preferences
  // tag rail and preferences
  var tgAll = [];
  var tgPrefs = new Set();
  var tgShown = [];
  var tgLoaded = false;
  var TG_ROWS  = 2;
  var TG_DESKTOP_SPAN = 1360;
  var TG_SLOTS = 60;
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
    tgFill();
    tgRenderRail();
    if(tgPrefs.size) tgAfterChange();
  }
  function tgFallbackVocab(){
    if(typeof SITE_CATEGORIES === 'undefined' || !Array.isArray(SITE_CATEGORIES)) return [];
    return SITE_CATEGORIES
      .filter(function(c){ return c && c.slug && c.slug.length <= TAG_MAX; })
      .map(function(c){ return { tag:c.slug, uses:0, kind:'cat' }; });
  }
  function tgFill(){
    var picked = [], rest = [];
    for(var i = 0; i < tgAll.length; i++){
      (tgPrefs.has(tgAll[i].tag) ? picked : rest).push(tgAll[i].tag);
    }
    tgShown = picked.concat(rest).slice(0, TG_SLOTS);
  }
  function tgChipHTML(tag){
    var on = tgPrefs.has(tag);
    return '<button type="button" class="tgChip'+(on?' on':'')+'" data-tag="'+esc(tag)+'" '+
      'onclick="tgToggle(this)" aria-pressed="'+(on?'true':'false')+'">'+
      '<span class="tgLbl">'+esc(tgLabel(tag))+'</span></button>';
  }
  var TG_ALL_CHIP =
    '<button type="button" class="tgChip tgChipAll" onclick="tgModOpen()" '+
    'aria-haspopup="dialog" aria-label="Browse all tags">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'+
    '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/>'+
    '<rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>'+
    '<span>All</span></button>';
  function tgBlockOf(rail){
    var p = rail && rail.parentNode;
    return (p && p.classList && p.classList.contains('tgBlock')) ? p : rail;
  }

  // paint every rail
  function tgRenderRail(animate){
    var rails = document.querySelectorAll('.tgRail');
    for(var i = 0; i < rails.length; i++) tgLayoutRail(rails[i], animate);
  }
  function tgLayoutRail(rail, animate){
    if(!rail) return;
    var block = tgBlockOf(rail);
    if(!tgAll.length){ block.style.display = 'none'; return; }
    block.style.display = '';
    var scroll = rail.firstElementChild;
    var hosts = scroll ? scroll.querySelectorAll('.tgRowIn') : null;
    if(!scroll || !hosts || hosts.length < TG_ROWS) return;

    var prev = null;
    if(animate){
      prev = {};
      var cur = rail.querySelectorAll('.tgChip[data-tag]');
      for(var c = 0; c < cur.length; c++){
        prev[cur[c].getAttribute('data-tag')] = cur[c].getBoundingClientRect();
      }
    }

    var items = [TG_ALL_CHIP].concat(tgShown.map(tgChipHTML));

    for(var e = 1; e < TG_ROWS; e++) hosts[e].innerHTML = '';
    hosts[0].innerHTML = items.join('');
    var widths = [], kids = hosts[0].children;
    for(var i = 0; i < kids.length; i++) widths.push(kids[i].getBoundingClientRect().width);

    var cs   = getComputedStyle(scroll);
    var gap  = parseFloat(cs.columnGap || cs.gap) || 10;
    var pad  = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var avail = Math.max(0, rail.clientWidth - pad - 1);
    var span = Math.max(avail, TG_DESKTOP_SPAN);
    var budget = [];
    for(var s = 0; s < TG_ROWS; s++) budget.push(span);

    var poolW = 0;
    for(var q = 0; q < items.length; q++) poolW += widths[q] + (q ? gap : 0);
    var need = 0;
    for(var n = 0; n < TG_ROWS; n++) need += budget[n];
    if(need > 0 && poolW < need){
      var shrink = poolW / need;
      for(var k2 = 0; k2 < TG_ROWS; k2++) budget[k2] *= shrink;
    }

    var rows = [];
    for(var z = 0; z < TG_ROWS; z++) rows.push([]);
    function rowW(r){
      var arr = rows[r], t = 0;
      for(var x = 0; x < arr.length; x++) t += widths[arr[x]];
      return t + (arr.length > 1 ? (arr.length - 1) * gap : 0);
    }
    function err(){
      var w = [], t = 0, mism = 0;
      for(var a = 0; a < TG_ROWS; a++){
        w[a] = rowW(a);
        t += Math.abs(w[a] - budget[a]);
        if(w[a] > budget[a]) t += 10000 + (w[a] - budget[a]) * 100;
      }
      for(var b = 0; b < TG_ROWS; b++){
        for(var d = b + 1; d < TG_ROWS; d++) mism += Math.abs(w[b] - w[d]);
      }
      return t + mism * 1.5;
    }
    rows[0].push(0);
    var pickedN = 0;
    while(pickedN < tgShown.length && tgPrefs.has(tgShown[pickedN])) pickedN++;
    var mustKeep = 1 + pickedN;
    var pool = [];
    for(var p = 1; p < items.length; p++) pool.push(p);

    for(var g = 0; g < pool.length; g++){
      var best = -1, bestRoom = -Infinity;
      for(var r = 0; r < TG_ROWS; r++){
        var room = budget[r] - rowW(r) - (rows[r].length ? gap : 0);
        if(room < widths[pool[g]]) continue;
        if(room > bestRoom){ bestRoom = room; best = r; }
      }
      if(best < 0){
        if(pool[g] >= mustKeep) continue;
        best = rowW(0) <= rowW(1) ? 0 : 1;
      }
      rows[best].push(pool[g]);
      pool[g] = -1;
    }
    pool = pool.filter(function(x){ return x >= 0; });

    for(var pass = 0; pass < 40; pass++){
      var base = err(), bestGain = 0, mv = null;
      for(var r = 0; r < TG_ROWS; r++){
        for(var i = 0; i < rows[r].length; i++){
          if(rows[r][i] === 0) continue;
          if(rows[r][i] >= mustKeep){
            for(var q = 0; q < pool.length; q++){
              var keep = rows[r][i]; rows[r][i] = pool[q];
              var e1 = err(); rows[r][i] = keep;
              if(base - e1 > bestGain){ bestGain = base - e1; mv = {t:'swap', r:r, i:i, q:q}; }
            }
            var cut = rows[r].splice(i, 1)[0];
            var e2 = err();
            rows[r].splice(i, 0, cut);
            if(base - e2 > bestGain){ bestGain = base - e2; mv = {t:'drop', r:r, i:i}; }
          }
          for(var d = 0; d < TG_ROWS; d++){
            if(d === r) continue;
            var cut2 = rows[r].splice(i, 1)[0];
            rows[d].push(cut2);
            var e3 = err();
            rows[d].pop(); rows[r].splice(i, 0, cut2);
            if(base - e3 > bestGain){ bestGain = base - e3; mv = {t:'move', r:r, i:i, d:d}; }
          }
        }
        for(var q2 = 0; q2 < pool.length; q2++){
          rows[r].push(pool[q2]);
          var e4 = err();
          rows[r].pop();
          if(base - e4 > bestGain){ bestGain = base - e4; mv = {t:'add', r:r, q:q2}; }
        }
      }
      if(!mv || bestGain <= 0.5) break;
      if(mv.t === 'swap'){ var old = rows[mv.r][mv.i]; rows[mv.r][mv.i] = pool[mv.q]; pool[mv.q] = old; }
      else if(mv.t === 'drop'){ pool.push(rows[mv.r].splice(mv.i, 1)[0]); }
      else if(mv.t === 'move'){ rows[mv.d].push(rows[mv.r].splice(mv.i, 1)[0]); }
      else if(mv.t === 'add'){ rows[mv.r].push(pool.splice(mv.q, 1)[0]); }
    }

    var plan = [];
    for(var pr = 0; pr < TG_ROWS; pr++){
      plan.push([]);
      for(var pi = 0; pi < rows[pr].length; pi++) plan[pr].push(items[rows[pr][pi]]);
    }

    for(var r2 = 0; r2 < TG_ROWS; r2++){
      hosts[r2].innerHTML = plan[r2].join('');
      hosts[r2].style.display = plan[r2].length ? '' : 'none';
    }
    for(var r3 = TG_ROWS; r3 < hosts.length; r3++){
      hosts[r3].innerHTML = '';
      hosts[r3].style.display = 'none';
    }

    if(prev) tgFlip(rail, prev);
    tgSyncOverflow();
  }
  function tgFlip(rail, prev){
    var els = rail.querySelectorAll('.tgChip[data-tag]');
    var moved = [];
    for(var i = 0; i < els.length; i++){
      var el = els[i], was = prev[el.getAttribute('data-tag')];
      if(!was){ el.classList.add('tgEnter'); continue; }
      var now = el.getBoundingClientRect();
      var dx = was.left - now.left, dy = was.top - now.top;
      if(Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moved.push(el);
    }
    if(!moved.length) return;
    void moved[0].offsetHeight;
    (function(){
      {
        for(var j = 0; j < moved.length; j++){
          (function(el){
            el.style.transition = 'transform .34s cubic-bezier(.22,1,.36,1)';
            el.style.transform = '';
            el.addEventListener('transitionend', function done(){
              el.style.transition = ''; el.style.transform = '';
              el.removeEventListener('transitionend', done);
            });
          })(moved[j]);
        }
      }
    })();
  }
  function tgSyncOverflow(){
    var rails = document.querySelectorAll('.tgRail');
    for(var i = 0; i < rails.length; i++){
      var el = rails[i];
      el.classList.toggle('ov', el.scrollWidth > el.clientWidth + 2);
    }
  }
  var tgRzTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(tgRzTimer);
    tgRzTimer = setTimeout(function(){ tgRenderRail(true); }, 150);
  });
  // every chip with this tag
  function tgTwins(tag){
    var out = [], els = document.querySelectorAll('.tgRail .tgChip[data-tag]');
    for(var i = 0; i < els.length; i++){
      if(els[i].getAttribute('data-tag') === tag) out.push(els[i]);
    }
    return out;
  }
  function tgMark(el, on){
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function tgToggle(btn){
    var tag = btn && btn.getAttribute('data-tag');
    if(!tag) return;
    var on = !tgPrefs.has(tag);
    if(on) tgPrefs.add(tag); else tgPrefs.delete(tag);
    tgSave(tag, on);

    var twins = tgTwins(tag);
    if(!twins.length) twins = [btn];
    for(var i = 0; i < twins.length; i++) tgMark(twins[i], on);

    requestAnimationFrame(function(){
      tgFill();
      tgRenderRail(true);
      tgAfterChange();
    });
  }
  function tgPrioritize(list){
    if(!tgPrefs.size || !Array.isArray(list) || list.length < 2) return list;
    var hit = [], rest = [];
    for(var i=0; i<list.length; i++){
      var a = list[i], toks = [], m = false;
      if(Array.isArray(a.tags)) toks = toks.concat(a.tags);
      toks = toks.concat(catList(a.category));
      for(var j=0; j<toks.length; j++){
        if(tgPrefs.has(String(toks[j]).trim().toLowerCase())){ m = true; break; }
      }
      (m ? hit : rest).push(a);
    }
    return hit.concat(rest);
  }
  function tgAfterChange(){
    try{
      if(typeof awArtworksCache !== 'undefined') renderAwGrid(awArtworksCache);
    }catch(e){}
  }

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
    tgFill(); tgRenderRail(true);
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
        '<span class="tgModTick" aria-hidden="true">'+(on?'\u2713':'')+'</span></button>';
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
    if(tick) tick.textContent = on ? '\u2713' : '';
    var tw = tgTwins(tag);
    for(var t2 = 0; t2 < tw.length; t2++) tgMark(tw[t2], on);
    requestAnimationFrame(function(){ tgAfterChange(); });
  }
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var m = document.getElementById('tgMod');
    if(m && m.classList.contains('open')) tgModClose();
  });
  document.addEventListener('keydown', function(e){
    if(e.key !== 'k' && e.key !== 'K') return;
    if(!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var fg = document.getElementById('fg');
    var el = document.getElementById(
      (fg && fg.classList.contains('open')) ? 'fgSearchIn' : 'awSearchIn');
    if(!el) return;
    e.preventDefault();
    el.focus();
    el.select();
  });
  function tgKbdHint(){
    if(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')) return;
    var els = document.querySelectorAll('.tgSearchKbd .tgKbdMod');
    for(var i = 0; i < els.length; i++) els[i].textContent = 'Ctrl';
  }
  tgKbdHint();

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tgLoad(); });
  } else {
    tgLoad();
  }

