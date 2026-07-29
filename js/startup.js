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

  /* ── Home feed state ──
     awArtworksCache: last data the fetch delivered. #awGrid shows one
     view — every approved artwork, trending order — so this is the
     whole dataset the grid ever renders. */
  var awArtworksCache = [];

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
    /* Hover reveal — same scrim + artist chip the .gItem grids use.
       It goes inside .awImgWrap so the wipe is clipped to the square
       artwork rather than the whole card. */
    if(typeof dzBuildHoverReveal === 'function') wrap.appendChild(dzBuildHoverReveal(item.user_id));

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

  /* ── Batched render state for the main-page grid ──
     awRList: full sorted list; awRShown: how many cards are in the
     DOM. The old flat slice(0,200) painted up to 200 cards in one go
     — now the first column-sized batch paints immediately and the
     rest streams in on scroll (no cap needed: batching IS the perf
     guard). Appended cards paint straight away — the scroll-reveal
     that used to restamp and re-animate every appended batch is
     gone. */
  var awRList = [], awRShown = 0, awSent = null;

