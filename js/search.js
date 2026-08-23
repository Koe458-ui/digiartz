// gallery search — a page of its own, over the whole site
  var fgSrch = { q:'', scope:'all', seq:0, timer:null, rows:{} };

  /* The groups, in the order they are rendered — and the order the chips are
     written in the document, which is read positionally against this list.

     Each one says how it is drawn, and every answer is a renderer this site
     already has rather than a fourth rendering of the same row:

       card    the artwork card the home page's boards are made of
       artist  the artist card the home page's Artists board shows
       sec     the section's own card, from js/sections.js — a marketplace
               listing is the card the Marketplace draws, a blog post the row
               the Blog draws, a resource the card Resources draws

     A search result therefore looks like the thing it is wherever it is met,
     rather than like a search result. Jobs is gone from here: it was the one
     section whose postings are found through its own filters, and a job with
     a title and a company reads as neither a card nor an artwork.

     wrap is what the cards are laid out in: the same grid or column the
     section itself uses. */
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

  // ilike takes a pattern, so the wildcards a visitor types are literal text
  // to them and syntax to us. Strip those, and the characters PostgREST reads
  // as filter punctuation, rather than searching for something nobody asked
  // for. Same guard the profile's search uses.
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

  /* The search page covers the gallery but does not remove it, so without
     this Tab walks off the bottom of the results and into the chips and
     thumbnails still sitting underneath — somewhere a keyboard or a screen
     reader cannot see it has gone. The profile's search page earns its trap
     the same way. */
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
    // the keyboard should come up with the page, not after a second tap
    if(input) setTimeout(function(){ try{ input.focus(); }catch(e){} }, 60);
  }

  /* silent is for the gallery closing underneath it: the page goes with it,
     and the focus does not go back to a button inside a section that has just
     been swept.

     The lock is asked for rather than assumed. This used to re-lock the page
     outright on a member-driven close, on the grounds that the gallery was
     still up underneath — true while the only way in was the gallery's own
     search button. The bar at the top of the document opens this page from
     the home page, where there is nothing underneath, and re-locking there
     left a page nobody could scroll and no panel open to explain why.
     restoreScroll releases the lock only when nothing in the panel table is
     holding it, so the gallery case is unchanged: #fg holds it, and the lock
     stays. */
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

  /* Artwork is answered from the list the gallery is already holding rather
     than from a query. That list is every approved artwork on the site — the
     same rows the grid draws — so searching it means the results and the
     grid can never disagree about what exists, it costs no round trip, and
     anything the viewer has hidden stays hidden here too. */
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

    /* Built inside a function, not up front. A Supabase builder issues its
       request the moment .then() is called on it, so constructing these four
       eagerly and then finding the answer in the cache would send every query
       the cache exists to avoid. Nothing is asked until the loader runs. */
    function fgSearchJobs(){
      var jobs = [];
      if(sb && pattern){
        if(want('marketplace')){
          jobs.push(sb.from('marketplace_items')
            .select(typeof window.dzSelectFor === 'function' ? window.dzSelectFor('marketplace')
              : 'id,user_id,title,description,category,tags,item_type,currency,file_ext,file_size,preview_url,license,delivery_days,created_at')
            // visibility, same as the Marketplace grid applies it — a draft or a
            // hidden listing is not a search result
            .eq('status','approved').eq('visibility','published').ilike('title',pattern)
            .order('created_at',{ascending:false}).limit(30)
            .then(function(r){ return {key:'marketplace', rows:(r&&r.data)||[]}; }));
        }
        if(want('blog')){
          jobs.push(sb.from('blog_posts')
            .select('id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,'+
                    'content_type,featured,published_at,created_at')
            // a draft is not a search result, and neither is a post its author
            // marked hidden
            .eq('status','approved').eq('visibility','published').ilike('title',pattern)
            .order('created_at',{ascending:false}).limit(30)
            .then(function(r){ return {key:'blog', rows:(r&&r.data)||[]}; }));
        }
        if(want('resources')){
          jobs.push(sb.from('resources')
            .select('id,user_id,title,summary,description,resource_type,category,tags,'+
                    'file_url,file_name,file_ext,file_size,file_count,preview_url,license,'+
                    'featured,download_count,created_at')
            // a draft or a hidden resource is not a search result
            .eq('status','approved').eq('visibility','published').ilike('title',pattern)
            .order('created_at',{ascending:false}).limit(30)
            .then(function(r){ return {key:'resources', rows:(r&&r.data)||[]}; }));
        }
        if(want('artist')){
          /* People, by the two names they are known under: the handle they
             chose and the name they display. Both, because a visitor looking
             for somebody has no way of knowing which of the two they are
             remembering.

             The columns are the ones an artist card draws — and the ones
             dzArtistCache already holds for every face on the site, so a
             profile found here is a profile the hover chips and the artist
             board no longer have to fetch. */
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

    /* Searching is the most expensive thing a visitor can do casually: four
       ilike queries across four tables, re-run on the same word every time
       somebody clears the box and types it again, or walks back through the
       scope chips. So the whole set of section results is one cached record,
       keyed by the NORMALISED query and the scope — "  Dragon " and "dragon"
       are the same search and get the same record — held for a minute, in
       memory only, and capped so a bot walking the alphabet cannot grow it
       without bound. Every row in it is public and already filtered to
       approved and published, which is what makes it shareable.

       Artwork is not part of this: it is answered from the list the gallery is
       already holding, which costs nothing to redo. */
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
        // artwork came from memory and is already good, so a failed query
        // loses its own section rather than the whole answer
        if(mySeq !== fgSrch.seq) return;
        fgSrch.rows = rows;
        fgSearchRender('Some sections couldn\u2019t be searched — try again.');
        return;
      }
      // a slower earlier query must not land on top of a newer one
      if(mySeq !== fgSrch.seq) return;
      out.forEach(function(o){ rows[o.key] = o.rows; });
    }
    if(mySeq !== fgSrch.seq) return;
    fgSrch.rows = rows;
    fgSearchRender();
    fgSearchLog(raw);
  }

  /* An artist's Search Analytics should say what people looked for, not what
     they typed on the way there. Typing "robin" fires this five times — r, ro,
     rob, robi, robin — and four of those are keystrokes, not searches. So the
     term is only recorded once it has sat still for a beat, and only when it
     actually matched somebody's artwork; a search that found nothing belongs
     to nobody's dashboard. dz_analytics_track_search takes the whole visible
     page of results in one call. */
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

  /* Results are drawn by the section they belong to. Nothing here knows what
     a listing or a post looks like — it asks whoever does, and lays the cards
     out in that section's own grid or column. */
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
        /* The profiles came back whole, so they go into the cache the artist
           cards read before a single one is built — no card here ever waits
           on a fetch, and the next hover chip that wants one of these faces
           has it already. */
        rows.forEach(function(p){ if(p && p.id) dzArtistCache[p.id] = p; });
        rows.forEach(function(p){
          if(typeof buildArtistCard === 'function') wrap.appendChild(buildArtistCard(p.id));
        });
      } else if(g.how === 'card'){
        rows.forEach(function(r){
          if(typeof buildAwCard !== 'function') return;
          var el = buildAwCard(r);
          /* The card opens the artwork on its own, but through this instead:
             it records the click against the term that found it, and it hands
             the viewer the results as the list to step through, so the arrows
             walk what was searched for rather than the whole gallery. */
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
        /* The section's card opens itself through the section's own list, and
           a row found by searching is not in that list — the section may not
           have loaded at all. So each card is rebound to the row it was built
           from, which is also what records the click against the term. */
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

    // the buy and cart controls a marketplace card carries are mounted by the
    // signed-in module, the same call the Marketplace panel makes after it
    // paints its own grid
    if(mounted && typeof window.dzExtras === 'function') window.dzExtras();

    fgSearchNote(warn || (total ? '' : 'Nothing in the gallery matches \u201C'+fgSrch.q.trim()+'\u201D.'));
  }

  // the results stay up behind whatever opens, so closing the artwork or the
  // listing puts you back on the same search rather than back at the gallery
  function fgSearchOpen(kind, id){
    var rows = fgSrch.rows[kind] || [];
    var row  = rows.find(function(x){ return String(x.id)===String(id); });
    if(!row) return;
    // the other half of the CTR: this term was shown, and this one was opened
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

  // ⌘K belongs to the gallery, and only while it is open. It opens the search
  // page now rather than reaching for a box that is no longer in the bar.
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

