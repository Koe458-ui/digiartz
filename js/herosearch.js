  var hsState = { q:'', mode:'artwork', seq:0, timer:null, rows:[], open:false };
  var HS_CAP = 12;
  var HS_MODES = {
    artwork: { ph:'Search artworks',
               label:'Search artworks',
               swap:'Switch to searching artists',
               head:'Artworks',
               empty:'No artwork matches ' },
    artist:  { ph:'Search artists',
               label:'Search artists',
               swap:'Switch to searching artworks',
               head:'Artists',
               empty:'No artist matches ' }
  };

  var hsArtistMemo = {}, hsArtistKeys = [];

  function hsEl(id){ return document.getElementById(id); }
  function hsClient(){ return (typeof sb !== 'undefined' && sb) ? sb : null; }
  function hsMode(){ return HS_MODES[hsState.mode] || HS_MODES.artwork; }

  function hsPaintMode(){
    var bar = hsEl('hsBar'), input = hsEl('hsIn'), btn = hsEl('hsModeBtn');
    var m = hsMode();
    if(bar) bar.setAttribute('data-mode', hsState.mode);
    if(input){
      input.placeholder = m.ph;
      input.setAttribute('aria-label', m.label);
    }
    if(btn){
      btn.setAttribute('aria-label', m.swap);
      btn.title = m.swap;
    }
  }

  function hsShow(on){
    var res = hsEl('hsRes'), input = hsEl('hsIn');
    hsState.open = !!on;
    if(res) res.hidden = !on;
    if(input) input.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function hsNote(msg){
    var res = hsEl('hsRes');
    if(!res) return;
    res.innerHTML = '<div class="hsNote"></div>';
    res.firstChild.textContent = msg;
    hsShow(true);
  }

  function hsClose(){
    hsShow(false);
    var res = hsEl('hsRes');
    if(res) res.innerHTML = '';
  }

  function hsArtworks(raw){
    if(typeof window.fgSearchArtworks !== 'function') return [];
    return window.fgSearchArtworks(raw).slice(0, HS_CAP);
  }

  function hsMemoPut(key, rows){
    if(!hsArtistMemo[key]) hsArtistKeys.push(key);
    hsArtistMemo[key] = rows;
    while(hsArtistKeys.length > 30) delete hsArtistMemo[hsArtistKeys.shift()];
  }

  function hsArtists(raw, done){
    var db = hsClient();
    var pattern = (typeof window.fgSearchPattern === 'function') ? window.fgSearchPattern(raw) : '';
    if(!db || !pattern){ done(null); return; }
    var key = pattern.toLowerCase();
    if(hsArtistMemo[key]){ done(hsArtistMemo[key]); return; }
    db.from('profiles')
      .select('id,username,display_name,avatar_url,banner_url,bio')
      .or('username.ilike.' + pattern + ',display_name.ilike.' + pattern)
      .order('username', { ascending:true }).limit(HS_CAP)
      .then(function(r){
        var rows = (r && r.data) || [];
        hsMemoPut(key, rows);
        done(rows);
      }, function(){ done(null); });
  }

  function hsRender(rows){
    var res = hsEl('hsRes');
    if(!res) return;
    hsState.rows = rows || [];
    var raw = String(hsState.q || '').trim();
    var m = hsMode();

    if(!hsState.rows.length){
      hsNote(m.empty + '“' + raw + '”.');
      return;
    }

    res.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'hsHead';
    head.innerHTML = '<span class="hsHeadTitle"></span><span class="hsHeadCount"></span>';
    head.firstChild.textContent = m.head;
    head.lastChild.textContent = String(hsState.rows.length);
    res.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'hsGrid';

    if(hsState.mode === 'artist'){
      hsState.rows.forEach(function(p){
        if(p && p.id && typeof dzArtistCache !== 'undefined') dzArtistCache[p.id] = p;
      });
      hsState.rows.forEach(function(p){
        if(typeof buildArtistCard === 'function') grid.appendChild(buildArtistCard(p.id));
      });
    } else {
      hsState.rows.forEach(function(r){
        if(typeof buildAwCard !== 'function') return;
        var card = buildAwCard(r);
        card.onclick = function(){ hsOpen(r.id); };
        card.onkeydown = function(e){
          if(e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          hsOpen(r.id);
        };
        grid.appendChild(card);
      });
    }
    res.appendChild(grid);

    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'hsMore';
    more.textContent = 'See all matches';
    more.onclick = function(){ hsSeeAll(); };
    res.appendChild(more);

    hsShow(true);
    hsLog(raw);
  }

  function hsOpen(id){
    var row = hsState.rows.find(function(x){ return String(x.id) === String(id); });
    if(!row) return;
    var term = String(hsState.q || '').trim();
    if(term && typeof window.dzAnTrack === 'function'){
      window.dzAnTrack('search_click', String(id), { term: term, scope:'artwork' });
    }
    if(typeof openLB !== 'function') return;
    var cats = catList(row.category).length ? catList(row.category)
             : (catList(row.tags).length ? catList(row.tags) : ['others']);
    openLB(row.image_url, row.name, cats[0] || '', row.description || '',
           String(row.id), false, hsState.rows);
  }

  function hsSeeAll(){
    var term = String(hsState.q || '').trim();
    if(!term || typeof window.fgSearchStart !== 'function') return;
    hsClose();
    window.fgSearchStart(term, hsState.mode);
  }

  var hsLogTimer = null, hsLogged = '';
  function hsLog(term){
    clearTimeout(hsLogTimer);
    if(hsState.mode !== 'artwork') return;
    if(typeof window.dzAnSearch !== 'function') return;
    var q = String(term || '').trim();
    if(q.length < 2 || q === hsLogged) return;
    hsLogTimer = setTimeout(function(){
      if(String(hsState.q || '').trim() !== q) return;
      if(!hsState.rows.length) return;
      window.dzAnSearch(hsState.rows.map(function(r){ return String(r.id); }), q, 'artwork');
      hsLogged = q;
    }, 1200);
  }

  function hsRun(){
    var raw = String(hsState.q || '').trim();
    if(!raw){ hsState.rows = []; hsClose(); return; }

    var mySeq = ++hsState.seq;

    if(hsState.mode === 'artwork'){
      hsRender(hsArtworks(raw));
      return;
    }

    if(!hsClient()){
      hsState.rows = [];
      hsNote('Artist search needs a connection — try again in a moment.');
      return;
    }
    hsNote('Searching…');
    hsArtists(raw, function(rows){
      if(mySeq !== hsState.seq) return;
      if(rows === null){
        hsState.rows = [];
        hsNote('Artists couldn’t be searched — try again.');
        return;
      }
      hsRender(rows);
    });
  }

  function hsInput(v){
    hsState.q = String(v || '');
    clearTimeout(hsState.timer);
    hsState.timer = setTimeout(hsRun, 220);
  }

  function hsToggleMode(){
    hsState.mode = hsState.mode === 'artwork' ? 'artist' : 'artwork';
    hsPaintMode();
    hsState.rows = [];
    clearTimeout(hsState.timer);
    var input = hsEl('hsIn');
    if(input){ try{ input.focus(); }catch(e){} }
    if(String(hsState.q || '').trim()) hsRun();
    else hsClose();
  }

  (function(){
    var bar = hsEl('hsBar');
    if(!bar) return;

    hsPaintMode();

    var input = hsEl('hsIn');
    if(input){
      input.addEventListener('focus', function(){
        if(String(hsState.q || '').trim() && !hsState.open) hsRun();
      });
      input.addEventListener('keydown', function(e){
        if(e.key === 'Escape'){ hsClose(); return; }
        if(e.key !== 'Enter') return;
        e.preventDefault();
        clearTimeout(hsState.timer);
        hsSeeAll();
      });
    }

    document.addEventListener('click', function(e){
      if(!hsState.open) return;
      var wrap = hsEl('hsWrap');
      if(wrap && wrap.contains(e.target)) return;
      hsClose();
    });

    var prevRebuild = window.rebuildGalCarousels;
    if(typeof prevRebuild === 'function'){
      window.rebuildGalCarousels = function(){
        var out = prevRebuild.apply(this, arguments);
        if(hsState.open && hsState.mode === 'artwork' && String(hsState.q || '').trim()) hsRun();
        return out;
      };
    }
  })();

  window.hsInput      = hsInput;
  window.hsToggleMode = hsToggleMode;
