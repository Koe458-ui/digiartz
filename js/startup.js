/* ── startup.js · startup logic ── */
  (/* ==========================================
   STARTUP LOGIC
   ==========================================

   Startup Sequence
   1. Load configuration
   2. Restore session/state
   3. Initialize UI
   4. Register events
   5. Start observers
   ========================================== */

  async function init(){
    await loadDB();
    renderHome();
    /* No hero image to preload anymore — resolve the loading bar's
       image slice immediately so it isn't stuck waiting on it. */
    if(typeof window._heroLoadCb === 'function'){
      window._heroLoadCb(null);
    }
    var m = window.location.pathname.match(/^\/artwork\/([^/]+)\/?$/);
    if(m) openArtworkById(m[1], false);
    var pm = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if(pm) openProfileByUsername(decodeURIComponent(pm[1]), false);
    if(window.location.pathname === '/login') openAuthMod();
    /* Site-wide ImageGallery structured data — lists every artwork's
       image + name + per-artwork URL so Google can associate each
       image with its dedicated, indexable page from the homepage
       itself, not only from within the modal. */
    injectGallerySEO();
  })();

  /* SEO: one ImageGallery JSON-LD block listing all artworks, each
     pointing at its own /artwork/{id} URL. Runs once images are
     loaded; safe to call again (replaces, never duplicates). */
  function injectGallerySEO(){
    if(!images.length) return;
    var ld = document.getElementById('ldGallery');
    if(!ld){
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'ldGallery';
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify({
      '@context':'https://schema.org',
      '@type':'ImageGallery',
      'name':'Digiartz Gallery',
      'url':SITE_URL+'/',
      'image':images.slice(0,100).map(function(a){
        return {
          '@type':'ImageObject',
          'contentUrl':a.image_url||'',
          'name':a.name||'Untitled artwork',
          'description':(a.description&&a.description.trim())?a.description.trim().slice(0,300):undefined,
          'url':SITE_URL+'/artwork/'+a.id
        };
      })
    });
  }

  /* ── Artworks / category tab state ──
     awTab: which dataset is currently shown in #awGrid.
     awArtworksCache: last data the fetch delivered,
     so switching tabs re-renders instantly with no extra fetch. */
  var awTab = 'artworks';
  var awArtworksCache = [];

  /* Category tabs pull straight from awArtworksCache, filtered by
     whichever category name the artwork was tagged with (comma-
     separated categories are matched against, same as the gallery
     filter elsewhere on the site). */
  /* Tab keys are now the category slugs themselves, so these maps are
     derived from SITE_CATEGORIES rather than hand-maintained. The two
     the non-category 'artworks' tab keeps its fixed id. */
  var AW_CATEGORY_TABS = SITE_CATEGORIES.reduce(function(m,c){ m[c.slug]=c.slug; return m; },{});
  var AW_TAB_BTN_IDS = SITE_CATEGORIES.reduce(function(m,c){ m[c.slug]='awTab_'+c.slug; return m; },{
    artworks: 'awTabArt',
    latest:   'awTabLatest'
  });

  function awCategoryList(catName){
    return awArtworksCache.filter(function(item){
      return catList(item.category).map(function(c){ return c.toLowerCase(); }).indexOf(catName.toLowerCase()) !== -1;
    });
  }

  function awListForTab(tab){
    if(tab === 'artworks') return awArtworksCache;
    /* 'latest' is a view, not a category — it spans every category and is
       ordered newest-first (renderAwGrid skips the most-liked sort for it). */
    if(tab === 'latest')   return awArtworksCache;
    return awCategoryList(AW_CATEGORY_TABS[tab] || tab);
  }

  /* Slide the underline to sit under whichever button is active,
     instead of it just popping into place. */
  function awUpdateIndicator(activeBtn){
    var ind = document.getElementById('awTabIndicator');
    if(!ind || !activeBtn) return;
    ind.style.left  = activeBtn.offsetLeft + 'px';
    ind.style.width = activeBtn.offsetWidth + 'px';
  }

  function awSwitchTab(tab){
    if(awTab === tab) return;
    awTab = tab;
    var activeBtn = null;
    Object.keys(AW_TAB_BTN_IDS).forEach(function(key){
      var btn = document.getElementById(AW_TAB_BTN_IDS[key]);
      if(!btn) return;
      var isActive = key === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if(isActive) activeBtn = btn;
    });
    awUpdateIndicator(activeBtn);
    if(activeBtn) activeBtn.scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
    renderAwGrid(awListForTab(tab), tab);
  }

  /* Position the indicator under the default active tab once layout
     has settled (fonts etc.), and keep it aligned on resize. */
  function awInitIndicator(){
    awUpdateIndicator(document.getElementById(AW_TAB_BTN_IDS[awTab]));
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', awInitIndicator);
  }else{
    awInitIndicator();
  }
  window.addEventListener('resize', awInitIndicator);
  /* FIX: webfonts (Sora/Inter) load after DOMContentLoaded and reflow the tab
     widths — without this the underline sat misaligned until the
     first window resize. */
  if(document.fonts && document.fonts.ready){ document.fonts.ready.then(awInitIndicator); }
  /* #artworks uses content-visibility:auto — while skipped, its tab
     rects measure 0×0, so re-run the indicator when rendering starts.
     (Event only fires in browsers that support content-visibility.) */
  var awSec = document.getElementById('artworks');
  if(awSec && 'oncontentvisibilityautostatechange' in awSec){
    awSec.addEventListener('contentvisibilityautostatechange', function(e){
      if(!e.skipped) awInitIndicator();
    });
  }

  /* Build one .awCard for an artwork — ArtStation-style masonry card. */
  function buildAwCard(item){
    var fullSrc = item.image_url || '';
    var name    = item.name || 'Untitled';
    var cat     = catList(item.category)[0] || 'others';
    var desc    = item.description || '';
    var id      = item.id;

    var card = document.createElement('div');
    card.className = 'awCard';
    card.setAttribute('role','button');
    card.setAttribute('tabindex','0');
    card.setAttribute('aria-label','View ' + name);

    /* .awLoading paints the shimmer skeleton (CSS already existed,
       nothing ever applied it) — cleared the moment pixels arrive.
       onerror clears it too so a dead URL can't shimmer forever,
       and transparent PNGs don't show the animation through
       themselves once loaded. aspect-ratio:1 on the wrap reserves
       the space, so cards never shift as images stream in. */
    var wrap = document.createElement('div');
    wrap.className = 'awImgWrap awLoading';

    var img = document.createElement('img');
    img.onload  = function(){ wrap.classList.remove('awLoading'); };
    img.onerror = function(){ wrap.classList.remove('awLoading'); };
    img.src = getThumbnailUrl(fullSrc);
    img.style.cssText = thumbStyle(item.thumb_x, item.thumb_y, item.thumb_zoom);
    img.alt = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;

    wrap.appendChild(img);

    var meta = document.createElement('div');
    meta.className = 'awMeta';

    var nm = document.createElement('div');
    nm.className = 'awName';
    nm.textContent = name;

    var ct = document.createElement('div');
    ct.className = 'awCat';
    ct.textContent = cat;

    meta.appendChild(nm);
    meta.appendChild(ct);
    card.appendChild(wrap);
    card.appendChild(meta);

    (function(s,n,c,d,i){
      card.onclick = function(){ openLB(s,n,c,d,i); };
      card.onkeydown = function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openLB(s,n,c,d,i); } };
    })(fullSrc, name, cat, desc, id);
    return card;
  }

  /* Render whichever dataset is passed into #awGrid — used for both
     tabs, only actually painting if that tab is the active one. */
  /* ── Batched render state for the main-page grid ──
     awRList: full sorted list for the active tab; awRShown: how many
     cards are in the DOM. The old flat slice(0,200) painted up to
     200 cards in one go — now the first column-sized batch paints
     immediately and the rest streams in on scroll (no cap needed:
     batching IS the perf guard). Appended cards paint straight
     away — the scroll-reveal that used to restamp and re-animate
     every appended batch is gone. */
  var awRList = [], awRShown = 0, awRType = null, awSent = null;

