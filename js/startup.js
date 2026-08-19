// startup logic
  (

  async function init(){
    /* Which move the page booted on — none, and that is the point. Everything
       below waits on the database and then opens a panel from the address,
       and a member who taps a section while that wait is running has said
       where they want to be more recently than the url did. Opening the deep
       link on top of them is the same bug as every other one this token
       exists for, with the page load as the stale opener. */
    var boot = window.dzNavToken ? window.dzNavToken() : null;
    /* THE FETCH STARTS NOW; THE WORK BELOW WAITS FOR THE PAGE TO FINISH
       PARSING. Everything after this point reaches into a file that loads
       AFTER this one — renderHome needs rebuildGalCarousels from js/feed.js,
       openProfileByUsername reaches js/search.js through pfSearchReset,
       dzOpenById is js/sections.js, and this is the fourteenth of thirty-odd
       script tags.

       That was survivable only for as long as `await loadDB()` meant a network
       round trip. It does not: js/cache.js answers a warm visit out of its
       synchronous tier, so the await resolves on a microtask and the
       continuation lands while the parser is still working through the
       remaining tags. Two things happened there, and one of them was silent —
       a profile deep link threw "tgSearchChrome is not defined", and
       renderHome found window.rebuildGalCarousels undefined and painted
       nothing at all, on exactly the repeat visits the cache exists to make
       fast.

       Starting the load before the wait rather than after keeps the request in
       flight across the parse, so a cold visit pays nothing for this: its
       round trip finishes long after DOMContentLoaded either way. */
    var loading = loadDB();
    await dzDomReady();
    await loading;
    renderHome();
    // no hero image preload
    if(typeof window._heroLoadCb === 'function'){
      window._heroLoadCb(null);
    }
    var stillBooting = (boot === null) ||
                       (typeof window.dzNavCurrent !== 'function') ||
                       window.dzNavCurrent(boot);
    // decoded, like the profile branch below and like js/engagement.js reading
    // the same segment — three readers of one path had two conventions
    var m = window.location.pathname.match(/^\/artwork\/([^/]+)\/?$/);
    if(m && stillBooting) openArtworkById(dzDecodeSeg(m[1]), false);
    var pm = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if(pm && stillBooting) openProfileByUsername(dzDecodeSeg(pm[1]), false);
    /* /login used to be opened from here, and it does not belong here: every
       other deep link on this line needs a row out of the database and waits
       on `loading` for it, and the sign-in sheet needs nothing at all. It sat
       behind the gallery load anyway — so a slow, failing or hanging fetch of
       the artwork feed was a sign-in page that never opened, on the one url
       where a visitor has already told you they cannot see their account.
       js/routes.js opens it now, at parse time, out of the same ROUTES table
       as every other public destination. */
    // A resource, a post, a listing or a posting opened straight from its own
    // link. Same shape as /artwork/<id>, and the same rule: the row is fetched
    // by id rather than hoping the section it belongs to has been browsed.
    var sm = window.location.pathname.match(/^\/(resource|blog|listing|job)\/([^/]+)\/?$/);
    if(sm && stillBooting && typeof window.dzOpenById === 'function') window.dzOpenById(sm[1], sm[2]);
    // gallery structured data
    injectGallerySEO();
  })();

  // gallery json ld
  function injectGallerySEO(){
    if(!images.length) return;
    /* The home page's gallery, described on the home page and nowhere else.
       This used to run on every route, so /artwork/<id>, /profile/<name> and
       now every section url carried an ImageGallery block whose own url said
       'https://digiartz.net/' — each of those pages claiming to be a different
       page. functions/_middleware.js strips the block from the document away
       from home for the same reason; without this guard the script simply put
       it back as soon as it ran. */
    var here = window.location.pathname;
    if(here !== '/' && here !== '/index.html') return;
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

  // home feed state
  var awArtworksCache = [];

  // build artwork card
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

    // image skeleton
    var wrap = document.createElement('div');
    wrap.className = 'awImgWrap awLoading';

    var img = document.createElement('img');
    img.onload  = function(){ wrap.classList.remove('awLoading'); };
    img.onerror = function(){ wrap.classList.remove('awLoading'); };
    // srcset before src: the browser resolves the candidate list at the moment
    // src is assigned, so setting it the other way round can fetch t300 first
    dzApplyThumb(img, fullSrc);
    img.style.cssText = thumbStyle(item.thumb_x, item.thumb_y, item.thumb_zoom);
    img.alt = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;

    wrap.appendChild(img);
    // hover reveal
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

  // batched render state
  var awRList = [], awRShown = 0, awSent = null;

