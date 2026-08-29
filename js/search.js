  var fgSrch = { q:'', scope:'all', seq:0, timer:null, rows:{} };

  var FG_SRCH_GROUPS = [
    { key:'artwork',     label:'Artworks',  how:'card',   wrap:'awGrid' },
    { key:'artist',      label:'Artists',   how:'artist', wrap:'awGrid' },
    { key:'marketplace', label:'Market',    how:'sec' },
    { key:'blog',        label:'Blog',      how:'sec' },
    { key:'resources',   label:'Resources', how:'sec' }
  ];

  function tgSearchChrome(wrapId, v){
    var w = document.getElementById(wrapId);
    if(w) w.classList.toggle('tgHasQ', !!String(v || '').length);
  }

  function fgSearchPattern(q){
    var clean = String(q||'').replace(/[%_*(),."\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
    return clean ? '%'+clean+'%' : '';
  }

  function fgSearchNote(msg){
    var n = document.getElementById('fgSrchNote');
    if(!n) return;
    n.textContent = msg || '';
    n.hidden = !msg;
  }

  var fgSrchLastFocus = null;

  function fgSrchFocusable(){
    var pg = document.getElementById('fgSearchPage');
    if(!pg) return [];
    var sel = 'a[href],button:not([disabled]),input:not([disabled]),' +
              'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(pg.querySelectorAll(sel), function(el){
      return !el.hidden && el.offsetParent !== null;
    });
  }
  function fgSrchTrap(e){
    if(e.key !== 'Tab') return;
    var pg = document.getElementById('fgSearchPage');
    if(!pg || !pg.classList.contains('open')) return;
    var items = fgSrchFocusable();
    if(!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if(!pg.contains(document.activeElement)){
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', fgSrchTrap, true);

  function openFgSearch(){
    var pg = document.getElementById('fgSearchPage');
    if(!pg) return;
    fgSrchLastFocus = document.activeElement;
    pg.classList.add('open');
    document.body.style.overflow = 'hidden';
    var input = document.getElementById('fgSrchIn');
    if(input) setTimeout(function(){ try{ input.focus(); }catch(e){} }, 60);
  }

  function closeFgSearch(silent){
    var pg = document.getElementById('fgSearchPage');
    if(!pg || !pg.classList.contains('open')) return;
    pg.classList.remove('open');
    if(typeof restoreScroll === 'function') restoreScroll();
    var back = fgSrchLastFocus; fgSrchLastFocus = null;
    if(silent !== true && back && back.isConnected && back.focus){
      try{ back.focus({preventScroll:true}); }catch(e){ try{ back.focus(); }catch(e2){} }
    }
  }

  function fgSearchClear(){
    var input = document.getElementById('fgSrchIn');
    if(input){ input.value = ''; try{ input.focus(); }catch(e){} }
    fgSearchInput('');
  }

  function fgSearchInput(v){
    fgSrch.q = String(v||'');
    tgSearchChrome('fgSrchWrap', fgSrch.q);
    clearTimeout(fgSrch.timer);
    fgSrch.timer = setTimeout(fgSearchRun, 220);
  }

  function fgSearchScope(scope){
    if(fgSrch.scope === scope) return;
    fgSrch.scope = scope;
    fgSearchPaintScopes();
    fgSearchRun();
  }

  function fgSearchPaintScopes(){
    var wrap = document.getElementById('fgSrchScopes');
    if(!wrap) return;
    var order = ['all'].concat(FG_SRCH_GROUPS.map(function(g){ return g.key; }));
    Array.prototype.forEach.call(wrap.children, function(btn, i){
      var on = order[i] === fgSrch.scope;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function fgSearchArtworks(q){
    var all = (typeof window.galleryImages === 'function') ? window.galleryImages() : null;
    if(!all) return [];
    var needle = q.toLowerCase();
    return all.filter(function(a){
      var hay = [a.name, a.description]
        .concat(a.tags || [])
        .concat(a.category || [])
        .join(' ').toLowerCase();
      return hay.indexOf(needle) !== -1;
    }).slice(0, 40);
  }

  async function fgSearchRun(){
    var res = document.getElementById('fgSrchRes');
    if(!res) return;
    var raw = String(fgSrch.q||'').trim();
    if(!raw){
      fgSrch.rows = {};
      res.innerHTML = '';
      fgSearchNote('Type to search the gallery.');
      return;
    }
    var mySeq = ++fgSrch.seq;
    var pattern = fgSearchPattern(raw);
    fgSearchNote('Searching…');

    function want(key){ return fgSrch.scope === 'all' || fgSrch.scope === key; }

    var rows = {};
    if(want('artwork')) rows.artwork = fgSearchArtworks(raw);

    function fgSearchJobs(){
      var jobs = [];
      if(sb && pattern){
        if(want('marketplace')){
          jobs.push(sb.from('marketplace_items')
            .select(typeof window.dzSelectFor === 'function' ? window.dzSelectFor('marketplace')
              : 'id,user_id,title,description,category,tags,item_type,currency,file_ext,file_size,preview_url,license,delivery_days,created_at')
            .eq('status','approved').eq('visibility','published').ilike('title',pattern)
            .order('created_at',{ascending:false}).limit(30)
            .then(function(r){ return {key:'marketplace', rows:(r&&r.data)||[]}; }));
        }
        if(want('blog')){
          jobs.push(sb.from('blog_posts')
            .select('id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,'+
                    'content_type,featured,published_at,created_at')
            .eq('status','approved').eq('visibility','published').ilike('title',pattern)
            .order('created_at',{ascending:false}).limit(30)
            .then(function(r){ return {key:'blog', rows:(r&&r.data)||[]}; }));
        }
        if(want('resources')){
          jobs.push(sb.from('resources')
            .select('id,user_id,title,summary,description,resource_type,category,tags,'+
                    'file_url,file_name,file_ext,file_size,file_count,preview_url,license,'+
                    'featured,download_count,created_at')
            .eq('status','approved').eq('visibility','published').ilike('title',pattern)
            .order('created_at',{ascending:false}).limit(30)
            .then(function(r){ return {key:'resources', rows:(r&&r.data)||[]}; }));
        }
        if(want('artist')){

          jobs.push(sb.from('profiles')
            .select('id,username,display_name,avatar_url,banner_url,bio')
            .or('username.ilike.'+pattern+',display_name.ilike.'+pattern)
            .order('username',{ascending:true}).limit(24)
            .then(function(r){ return {key:'artist', rows:(r&&r.data)||[]}; }));
        }
      }
      return jobs;
    }
    var fgSearchWanted = !!(sb && pattern) &&
      (want('artist') || want('marketplace') || want('blog') || want('resources'));

    if(fgSearchWanted){
      var out;
      var cSrch = window.dzCached ? window.dzCached() : null;
      var srchKey = cSrch
        ? 'search:sections:' + cSrch.norm(raw) + ':' + (fgSrch.scope || 'all') +
          ':' + (window.currentUser ? 'member' : 'public')
        : null;
      try{
        out = (cSrch && srchKey && raw.length >= 2)
          ? await cSrch.getOrSet(srchKey, function(){ return Promise.all(fgSearchJobs()); }, 'search')
          : await Promise.all(fgSearchJobs());
      }
      catch(e){
        if(mySeq !== fgSrch.seq) return;
        fgSrch.rows = rows;
        fgSearchRender('Some sections couldn\u2019t be searched — try again.');
        return;
      }
      if(mySeq !== fgSrch.seq) return;
      out.forEach(function(o){ rows[o.key] = o.rows; });
    }
    if(mySeq !== fgSrch.seq) return;
    fgSrch.rows = rows;
    fgSearchRender();
    fgSearchLog(raw);
  }

  var fgSrchLogTimer = null, fgSrchLogged = '';
  var FG_SRCH_SCOPE = { artwork:'artwork', marketplace:'marketplace', blog:'blog', resources:'resource' };
  function fgSearchLog(term){
    clearTimeout(fgSrchLogTimer);
    if(typeof window.dzAnSearch !== 'function') return;
    var q = String(term||'').trim();
    if(q.length < 2 || q === fgSrchLogged) return;
    fgSrchLogTimer = setTimeout(function(){
      if(String(fgSrch.q||'').trim() !== q) return;
      var any = false;
      Object.keys(FG_SRCH_SCOPE).forEach(function(g){
        var rows = fgSrch.rows[g] || [];
        if(!rows.length) return;
        any = true;
        window.dzAnSearch(rows.slice(0,12).map(function(r){ return String(r.id); }),
                          q, FG_SRCH_SCOPE[g]);
      });
      if(any) fgSrchLogged = q;
    }, 1200);
  }

  function fgSearchRender(warn){
    var res = document.getElementById('fgSrchRes');
    if(!res) return;
    res.innerHTML = '';
    var total = 0, mounted = false;

    FG_SRCH_GROUPS.forEach(function(g){
      var rows = fgSrch.rows[g.key] || [];
      if(!rows.length) return;
      total += rows.length;

      var sec = document.createElement('section');
      sec.className = 'pfSrchGrp';
      sec.innerHTML = '<div class="pfSrchGrpHd">'+
          '<span class="pfSrchGrpTitle">'+esc(g.label)+'</span>'+
          '<span class="pfSrchGrpCount">'+rows.length+'</span>'+
        '</div>';

      var wrap = document.createElement('div');
      wrap.className = 'pfSrchCards ' +
        (g.wrap || (typeof window.dzSecLayout === 'function' ? window.dzSecLayout(g.key) : 'dzList'));

      if(g.how === 'artist'){
        rows.forEach(function(p){ if(p && p.id) dzArtistCache[p.id] = p; });
        rows.forEach(function(p){
          if(typeof buildArtistCard === 'function') wrap.appendChild(buildArtistCard(p.id));
        });
      } else if(g.how === 'card'){
        rows.forEach(function(r){
          if(typeof buildAwCard !== 'function') return;
          var el = buildAwCard(r);
          el.onclick = function(){ fgSearchOpen('artwork', r.id); };
          el.onkeydown = function(e){
            if(e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            fgSearchOpen('artwork', r.id);
          };
          wrap.appendChild(el);
        });
      } else {
        wrap.innerHTML = rows.map(function(r){
          return (typeof window.dzSecCard === 'function') ? window.dzSecCard(g.key, r) : '';
        }).join('');
        Array.prototype.forEach.call(wrap.children, function(el, i){
          var row = rows[i];
          el.removeAttribute('onclick');
          el.onclick = function(){ fgSearchOpen(g.key, row && row.id); };
        });
        mounted = mounted || g.key === 'marketplace';
      }

      sec.appendChild(wrap);
      res.appendChild(sec);
    });

    if(mounted && typeof window.dzExtras === 'function') window.dzExtras();

    fgSearchNote(warn || (total ? '' : 'Nothing in the gallery matches \u201C'+fgSrch.q.trim()+'\u201D.'));
  }

  function fgSearchOpen(kind, id){
    var rows = fgSrch.rows[kind] || [];
    var row  = rows.find(function(x){ return String(x.id)===String(id); });
    if(!row) return;
    if(FG_SRCH_SCOPE[kind] && typeof window.dzAnTrack === 'function'){
      var sq = String(fgSrch.q||'').trim();
      if(sq) window.dzAnTrack('search_click', String(id), { term: sq, scope: FG_SRCH_SCOPE[kind] });
    }
    if(kind==='artwork'){
      var cats = catList(row.category).length ? catList(row.category)
               : (catList(row.tags).length ? catList(row.tags) : ['others']);
      openLB(row.image_url, row.name, cats[0]||'', row.description||'', String(row.id), false, rows);
      return;
    }
    if(typeof window.dzOpenRow==='function') window.dzOpenRow(kind, row);
  }

  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var pg = document.getElementById('fgSearchPage');
    if(pg && pg.classList.contains('open')) closeFgSearch();
  });

  document.addEventListener('keydown', function(e){
    if(e.key !== 'k' && e.key !== 'K') return;
    if(!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var fg = document.getElementById('fg');
    if(!fg || !fg.classList.contains('open')) return;
    e.preventDefault();
    openFgSearch();
  });

  window.openFgSearch = openFgSearch;
  window.closeFgSearch = closeFgSearch;
  window.fgSearchInput = fgSearchInput;
  window.fgSearchClear = fgSearchClear;
  window.fgSearchScope = fgSearchScope;
  window.fgSearchOpen = fgSearchOpen;

  function openSubscription() {
    var el = document.getElementById('subPage');
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function closeSubscription() {
    var el = document.getElementById('subPage');
    if (!el) return;
    el.classList.remove('open');
    restoreScroll();
  }
