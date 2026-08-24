// gallery sections, viewer, report
  // gallery sections
  var FG_SECTIONS = {
    resources:   { label:'Resources',   opts:['Tutorials','Brushes','Textures','Fonts','PSD Files','3D Assets','References','Color Palettes','Mockups','Templates','Icons','Plugins'] },
    blog:        { label:'Blog',        opts:['News','Community','Artist Spotlights','Tips & Guides','Interviews','Reviews','Events','Challenges','Releases','Announcements'] },
    marketplace: { label:'Marketplace', opts:['Artwork','Prints','Digital Downloads','Website Templates','UI Kits','Icons','Brushes','3D Models','Commissions','Services'] },
    jobs:        { label:'Jobs',        opts:['Freelance','Full-Time','Part-Time','Remote','Internship','Contest','Hiring Artists','Collaboration'] },
    cart:        { label:'Cart',        opts:['Shopping Cart','Saved for Later','Checkout','Orders','Downloads','Licenses'] }
  };
  var fgSection = 'artworks';           // section on screen
  var fgFltMode = 'artworks';           // panel owner
  var fgSecFilter = {};                 // chosen option per section
  var fgSecQuery  = {};                 // typed query per section
  /* The five the gallery holds. Cart was the sixth and is a page of its own
     now, behind the bar's cart icon: it is one member's basket, which is not a
     section of a public gallery and never read as one next to Blog and Jobs.
     The chip row these used to sit on is gone too — the bar's Explore menu
     names all five and lands on the one that was asked for. */
  var FG_TABS = ['artworks','marketplace','blog','resources','jobs'];
  // What the bar says the member is looking at, now that no chip row says it.
  var FG_TITLE = {
    artworks:'ARTWORKS', marketplace:'MARKETPLACE', blog:'BLOG',
    resources:'RESOURCES', jobs:'JOBS'
  };

  // one place to ask, so every motion in here agrees about it
  function fgReduceMotion(){
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* Show one of the five.
     This was the chip row's handler and is now the whole of how a section is
     reached: the member picked it in the bar's Explore menu, or arrived on its
     url, and this puts that panel on screen. There is no row to light up any
     more — the bar's own title is what says where they are, and each section's
     head says it again in its own words. */
  function fgSwitchSection(id){
    if(!id || !FG_TITLE[id]) return;
    /* Back to the top before the swap, not after. The panel about to be shown
       is the one that decides how tall the page is, so a scroll reset landing
       after it has been drawn is a visible jump; landing before means the new
       panel is only ever drawn at the top, and its rise-in covers the move. */
    var fg=document.getElementById('fg'); if(fg) fg.scrollTop=0;
    var secs=document.querySelectorAll('#fg .fgSec'), i;
    for(i=0;i<secs.length;i++) secs[i].classList.toggle('active', secs[i].id==='fgSec-'+id);
    fgSection=id;
    var t=document.getElementById('fgTopTitle');
    if(t) t.textContent = FG_TITLE[id];
    // The head is built once per section and lives inside the panel, so a
    // switch only has to make sure the one being shown has been built.
    if(typeof window.fgHeadBuild==='function') fgHeadBuild(id);
    fgSyncFilterBtn();
    // load section on first visit
    if(id!=='artworks' && typeof dzSecEnter==='function') dzSecEnter(id);
  }

  /* One filter button in the bar, where there used to be one inside each
     section's own search box. It opens whichever panel belongs to the section
     on show, and wears the dot when that section is filtered — so the control
     is in one place and still says something true about six of them. */
  function fgOpenFilter(){
    if(fgSection==='artworks'){ openFilterPanel(); return; }
    openSecFilter(fgSection);
  }
  function fgSyncFilterBtn(){
    var btn=document.getElementById('fgFltBtn');
    if(!btn) return;
    var on = fgSection==='artworks'
      ? (typeof window.fgArtFiltered==='function' && window.fgArtFiltered())
      : ((fgSecFilter[fgSection]||'all') !== 'all');
    btn.classList.toggle('active', !!on);
  }
  window.fgOpenFilter=fgOpenFilter;
  window.fgSyncFilterBtn=fgSyncFilterBtn;

  // stub sections hold the query
  var fgSecQTimer={};
  /* One section's query. The box it comes from is the one in that section's
     head (js/fghead.js), which wears its own "there is something typed here"
     class — this used to reach for a wrapper by id that stopped existing when
     each section's search moved into its head. */
  function fgSecSearchInput(id,v){
    fgSecQuery[id]=String(v||'');
    // debounced input
    clearTimeout(fgSecQTimer[id]);
    fgSecQTimer[id]=setTimeout(function(){
      if(typeof dzSecRender==='function') dzSecRender(id);
    },140);
  }
  /* Kept as the name the section pages call, and handed to the head, which
     owns the box and its clear button now — the field this reached for by id
     went with the search bar each section used to carry of its own. */
  function fgSecSearchClear(id){
    if(typeof window.fgHeadSearchClear==='function'){ fgHeadSearchClear(id); return; }
    fgSecSearchInput(id,'');
  }

  // build panel body
  function openSecFilter(id){
    var sec=FG_SECTIONS[id]; if(!sec) return;
    fgFltMode=id;
    var cur=fgSecFilter[id]||'all', html='<div class="fltSec"><div class="fltSecLbl">'+
      sec.label.toUpperCase()+'</div><div class="fltOpts" id="fltSecOpts">'+
      '<label class="fltOpt"><input type="radio" name="fltSec" value="all"'+
      (cur==='all'?' checked':'')+'><div class="fltDot"></div>'+fltIco('all')+
      '<span class="fltLbl">ALL</span></label>';
    for(var i=0;i<sec.opts.length;i++){
      var o=sec.opts[i], v=o.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      html+='<label class="fltOpt"><input type="radio" name="fltSec" value="'+v+'"'+
        (cur===v?' checked':'')+'><div class="fltDot"></div>'+fltIco(v)+
        '<span class="fltLbl">'+o.toUpperCase()+'</span></label>';
    }
    html+='</div></div><div class="fltSep"></div>';
    var body=document.getElementById('fltSecBody');
    if(body){ body.innerHTML=html; body.style.display=''; }
    var art=document.getElementById('fltArtBody'); if(art) art.style.display='none';
    var t=document.getElementById('fltPTitle'); if(t) t.textContent=sec.label.toUpperCase();
    document.getElementById('fgFltOvr').classList.add('open');
    document.getElementById('fgFltPanel').classList.add('open');
  }
  function applySecFilter(){
    var id=fgFltMode, r=document.querySelector('input[name="fltSec"]:checked');
    fgSecFilter[id]=r?r.value:'all';
    fgSyncFilterBtn();
    closeFilterPanel();
    // the chip rail in this section's head names the same option this does
    if(typeof window.fgHeadSyncCat==='function') fgHeadSyncCat(id);
    if(typeof dzSecRender==='function') dzSecRender(id);
  }

  /* FG_SECTIONS, fgSecFilter and fgSecQuery are not re-exported here: this
     file is a plain script, so its top-level `var`s are already on window, and
     js/sections.js has read them off it that way since before this note. The
     head's chip rails read the same three — they ask rather than keeping a
     copy of the answer, which is what stops a chip claiming a category the
     grid under it is not showing. */

  // expose for inline handlers
  window.fgSwitchSection=fgSwitchSection;
  window.fgSecSearchInput=fgSecSearchInput;
  window.fgSecSearchClear=fgSecSearchClear;
  window.openSecFilter=openSecFilter;
  window.applySecFilter=applySecFilter;
  function closeFG(){
    // the search page sits over the gallery — it goes with it, and the scroll
    // lock belongs to whatever is left on screen
    if(typeof closeFgSearch==='function') closeFgSearch(true);
    document.getElementById('fg').classList.remove('open');
    restoreScroll();
    /* The visit ends where the next one starts: back on every category, with
       nothing typed. Three controls name that state now — the filter sheet's
       radio, the chip rail in each section's head, and the head's own search
       box — so all three are put back, not just the one this line reset when
       the sheet was the only way to filter anything. */
    filterCat = 'all';
    var catR = document.querySelector('input[name="fltCat"][value="all"]');
    if(catR) catR.checked = true;
    for(var k in fgSecFilter) fgSecFilter[k] = 'all';
    for(var q in fgSecQuery)  fgSecQuery[q]  = '';
    var boxes = document.querySelectorAll('#fg .fgHeadIn');
    for(var i=0;i<boxes.length;i++){
      boxes[i].value = '';
      boxes[i].parentNode.classList.remove('hasQ');
    }
    if(typeof window.fgHeadSyncAll === 'function') fgHeadSyncAll();
    fgSyncFilterBtn();
  }
  // viewer open and close
  var amCloseTimer = null;
  var avNavList = [];
  var avNavIndex = -1;
  // opened from gallery overlay
  var avLbFromGallery = false;
  var avCurrentArt = null;
  // Where the address bar was when this viewer took it over, so closing can
  // hand it back rather than assuming the home page. Null means the viewer was
  // opened by its own url and there is nothing to hand back to.
  var avReturnUrl = null;
  // multi image artworks
  var avImages = [];

  // cover first, then extras
  function avImageList(art, src){
    var list = [];
    if(art && art.image_url) list.push(art.image_url);
    else if(src) list.push(src);
    var pages = art && art.pages;
    if(typeof pages === 'string'){ try{ pages = JSON.parse(pages); }catch(e){ pages = null; } }
    if(Array.isArray(pages)){
      pages.forEach(function(u){ if(u && list.indexOf(u) === -1) list.push(u); });
    }
    return list;
  }
  /* One picture at a time, and a rail of thumbnails to change which.

     The pages used to be printed underneath the cover at full width, which
     made the artwork column a tall document: fine for the one upload here
     that has extra pages, and nothing at all for the twenty-four that do
     not — a single image fits its box, so that column had a scroll range of
     zero and the wheel over the biggest thing on the screen did nothing.

     A picture that fills its box, with the set offered as thumbnails under
     it, has no such dependency on how many images an upload happens to
     carry. The box is always full, changing pictures is a click rather than
     a hunt down a column, and the rail is the only thing that scrolls — 
     sideways, and only when there are more thumbnails than fit. */

  /* Every picture in the set, one under another, down the work column.

     A rail of thumbnails under one picture was the shape before this, and it
     asked the reader to hunt: the box showed image one and the rest were
     64px squares to be clicked one at a time. A set is a set — the column
     prints all of it, at the width of the column, in order, and the column
     scrolls to its own end and stops. Which is what the notes beside it do,
     and what the marketplace listing has always done.

     #lbImg is the first of them and stays the element every other part of
     this file already knows: openLB gives it its src, the full view opens
     from it, and the resolution row reads its natural size. The rest are
     appended after it, in the same container the rail used to live in, so
     the markup in index.html does not change. */
  function avBuildStrip(art, src){
    avImages = avImageList(art, src);
    var rest = document.getElementById('avImgStack');
    if(!rest) return;
    if(avImages.length < 2){
      rest.hidden = true; rest.innerHTML = '';
      return;
    }
    rest.hidden = false;
    // At viewing size, not thumbnail size: these are the work, not an index
    // of it. Lazily, because a set of eight should not cost eight requests
    // before the first one is on screen.
    rest.innerHTML = avImages.slice(1).map(function(u,i){
      return '<img class="avStackImg" src="'+esc(getViewUrl(u))+'" alt="Image '+(i+2)+
             ' of '+avImages.length+'" loading="lazy" decoding="async" draggable="false">';
    }).join('');
  }

  /* There is no measuring here any more.

     There used to be: avFitStage read the pane's height, subtracted its
     padding and the rail, and wrote the remainder onto the pane as --boxH,
     which css/overrides.css used as the picture's max-height. A
     ResizeObserver on the pane and the rail kept the figure current.

     All of it existed to size the picture's box to the picture, and that is
     the thing that was wrong: the frame changed shape with every artwork
     opened, because the frame was the artwork. The box is stated in the
     stylesheet now and the picture is fitted into it with object-fit, so
     there is nothing to measure, nothing to keep current, and no moment
     after a rail renders that has to be picked correctly. */
  /* The swap is gone with the rail that needed it.

     avShowImage put one of the set into #lbImg and ticked a thumbnail; the
     thumbnails answered clicks and arrow keys to move between them. The
     column prints the whole set now, so there is nothing to swap to: every
     picture is already on screen, in order, and reaching the fourth is a
     scroll rather than a hunt. */

  function avCap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

  function avFormatDate(iso){
    if(!iso) return null;
    try{
      var d = new Date(iso);
      if(isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    }catch(e){ return null; }
  }

  // How the panel reads: what the piece is, what it was made with and at what
  // size, what may be done with it, and when it arrived. Resolution used to
  // sit after the licence, which split the two technical rows around the
  // three legal ones.
  function avRenderMeta(m){
    // only rows with data
    var rows = [], a = m.art || null;
    if(m.hasArt){
      if(m.category) rows.push(['Category', avCap(m.category)]);
      // the medium the artist picked, when they picked one
      rows.push(['Medium', (a && a.medium) || 'Digital Art']);
      if(a && a.subject_matter) rows.push(['Subject', a.subject_matter]);
      // software is a list now; the old single value is the fallback for
      // artworks uploaded before it was one
      var sw = (a && a.software_list && a.software_list.length)
        ? a.software_list.join(', ') : m.software;
      if(sw) rows.push(['Software', sw]);
    }
    rows.push(['Resolution', '—', 'avMetaResVal']);
    if(m.hasArt){
      // A licence is only claimed when the artist actually answered the
      // licence questions. Every artwork uploaded before those existed has
      // them defaulted to false, and reading that back as "personal use
      // only" would put words in the artist's mouth — so the presence of a
      // licence is what says these answers are theirs.
      if(a && a.license){
        rows.push(['License', a.license]);
        var rights = [
          a.commercial_use ? 'Commercial use allowed' : 'Personal use only',
          a.modification_allowed ? 'Modification allowed' : '',
          a.attribution_required ? 'Attribution required' : ''
        ].filter(Boolean).join(' · ');
        if(rights) rows.push(['Rights', rights]);
      }
      if(a && a.is_mature) rows.push(['Content', 'Mature · 18+']);
    }
    if(m.hasArt && m.createdAt) rows.push(['Uploaded', avFormatDate(m.createdAt) || '—']);
    // shown only once it says something the upload date does not
    if(a && a.updated_at && a.created_at &&
       new Date(a.updated_at) - new Date(a.created_at) > 60000){
      rows.push(['Updated', avFormatDate(a.updated_at) || '—']);
    }
    var list = document.getElementById('avMetaList');
    if(!list) return;
    list.innerHTML = rows.map(function(r){
      var valId = r[2] ? ' id="'+r[2]+'"' : '';
      return '<div class="avMetaRow"><span class="avMetaLbl">'+esc(r[0])+'</span><span class="avMetaVal"'+valId+'>'+esc(r[1])+'</span></div>';
    }).join('');
  }
  // ---- the rest of what the artist wrote ---------------------------------
  // The summary leads under the title, the process notes and credits follow
  // the description, and the links sit under the details panel they belong
  // with. Each block carries its own divider and is dropped when empty, which
  // is every one of them for an artwork uploaded before these fields existed.
  function avProseBlock(head, body){
    body = String(body == null ? '' : body).trim();
    if(!body) return '';
    return '<div class="avDiv"></div><div><div class="avBlockH">'+esc(head)+'</div>'+
      '<p class="avDescTxt">'+esc(body).replace(/\n/g,'<br>')+'</p></div>';
  }
  function avRenderExtras(art){
    var sEl = document.getElementById('avSummary');
    if(sEl){
      var sm = (art && art.summary) ? String(art.summary).trim() : '';
      sEl.textContent = sm;
      sEl.hidden = !sm;
    }
    var fEl = document.getElementById('avFeatured');
    if(fEl) fEl.hidden = !(art && art.featured);
    var host = document.getElementById('avExtraBlocks');
    if(host){
      var out = '';
      if(art){
        out += avProseBlock('Process notes', art.process_notes);
        if(Array.isArray(art.credits) && art.credits.length){
          out += '<div class="avDiv"></div><div><div class="avBlockH">Credits</div>'+
            '<div class="avTagList">'+art.credits.map(function(c){
              return '<span class="avTagChip">'+esc(c)+'</span>';
            }).join('')+'</div></div>';
        }
      }
      host.innerHTML = out;
    }
    var links = document.getElementById('avLinkBlocks');
    if(links){
      var lo = '';
      if(art && Array.isArray(art.external_links) && art.external_links.length){
        // the artist's own text, so anything that is not http is printed
        // rather than turned into something the browser will follow
        lo = '<div class="avDiv"></div><div><div class="avBlockH">Links</div><ul class="dzvRefs">'+
          art.external_links.map(function(u){
            var safe = /^https?:\/\//i.test(String(u||'')) ? String(u) : '';
            var show = String(u||'').replace(/^https?:\/\//i,'');
            return safe
              ? '<li><a href="'+esc(safe)+'" target="_blank" rel="noopener nofollow">'+esc(show)+'</a></li>'
              : '<li>'+esc(show)+'</li>';
          }).join('')+'</ul></div>';
      }
      links.innerHTML = lo;
    }
    // An artist who turned comments off gets no comment box. What was already
    // said stays readable — turning them off ends the conversation, it does
    // not erase it.
    var off = !!(art && art.comments_allowed === false);
    var bar = document.querySelector('#artModal .avCmBar');
    if(bar) bar.style.display = off ? 'none' : '';
    var note = document.getElementById('avCmOff');
    if(note) note.hidden = !off;
  }

  function avUpdateResolution(w,h){
    var el = document.getElementById('avMetaResVal');
    if(el && w && h) el.textContent = w+' × '+h+' px';
  }

  // ---- the card and the rail ---------------------------------------------
  // Both are written by the section views' own module, so this viewer and the
  // four of them open with the same card, the same buttons and the same rail
  // at the same measurements — there is one implementation of each, not two.
  // The card and the rail are written into two hosts index.html provides. A
  // client running this file against an OLDER index.html has neither — a
  // cached shell, an edge that has not caught up, a service worker mid
  // update — and the viewer came up with no card, no way out and no actions
  // at all, which is worse than either version on its own. The hosts are made
  // when they are missing, so the chrome belongs to this file rather than to
  // whichever markup happens to be on the page.
  function avHost(id, afterId){
    var el = document.getElementById(id);
    if(el) return el;
    var scroll = document.querySelector('#artModal .avSideScroll');
    if(!scroll) return null;
    el = document.createElement('div');
    el.id = id;
    var after = afterId && document.getElementById(afterId);
    if(after && after.parentNode === scroll) scroll.insertBefore(el, after.nextSibling);
    else scroll.insertBefore(el, scroll.firstChild);
    // Whatever this replaced goes with it: the old author strip has no
    // painter any more, and the old title-row hearts would be a second copy
    // of the two in the rail.
    var strip = document.getElementById('avAuthorRow');
    if(strip && strip.parentNode) strip.parentNode.removeChild(strip);
    var acts = document.querySelector('#artModal .avTitleActs');
    if(acts && acts.parentNode) acts.parentNode.removeChild(acts);
    return el;
  }
  /* Where the artist card lives, which is not the same place in both layouts.

     Stacked, it is the first thing in .avBody: you are told whose the work is
     before you are shown it. Side by side, it has to be INSIDE the notes'
     scroller — a grid item cannot scroll along with a sibling, so as a column
     of its own it stayed pinned while everything written about the piece slid
     under it. The card is one node either way; only its parent changes.

     Moved rather than copied, so there is never a second card to keep filled,
     and driven by the same 1024px the stylesheet uses so the two can never
     disagree about which layout is on. */
  /* 900, which is where css/viewer.css puts the second column. It said 1024
     for as long as the layout did, and when the layout moved this did not —
     so between the two widths the card was left in .avBody, in a grid row of
     its own, for a viewer that had already given it a column to sit in. */
  var avWide = window.matchMedia ? window.matchMedia('(min-width:900px)') : null;
  function avPlaceCard(){
    var card = document.getElementById('avAuthorCard');
    if(!card) return;                       // older shell: avHost will make one
    var body = document.querySelector('#artModal .avBody');
    var scroll = document.querySelector('#artModal .avSideScroll');
    if(!body || !scroll) return;
    if(avWide && avWide.matches){
      if(card.parentNode !== scroll) scroll.insertBefore(card, scroll.firstChild);
    } else if(card.parentNode !== body){
      body.insertBefore(card, body.firstChild);
    }
  }
  if(avWide){
    var onAvWide = function(){ avPlaceCard(); };
    // addListener is the old name, and iOS Safari carried it alone for years
    if(avWide.addEventListener) avWide.addEventListener('change', onAvWide);
    else if(avWide.addListener) avWide.addListener(onAvWide);
  }

  function avRenderCard(art){
    avPlaceCard();
    var host = avHost('avAuthorCard');
    if(!host || typeof window.dzVwCard !== 'function') return;
    host.innerHTML = window.dzVwCard('avCard', 'closeLB()');
    if(typeof window.dzVwFill === 'function') window.dzVwFill('avCard', art && art.user_id);
  }
  // Like and bookmark keep their own two tables and their own module — the
  // classes are what engagement.js paints and listens for, so they stay on
  // the buttons and only the shape around them changes.
  function avRenderRail(art){
    var host = avHost('avActRail', 'avAuthorCard');
    if(!host || typeof window.dzVwActRow !== 'function') return;
    var id = art && art.id ? String(art.id) : '';
    host.innerHTML = window.dzVwActRow([
      { k:'like', c:'red',   cls:'engLike', press:1, label:'Like',
        attrs:' data-id="'+esc(id)+'"', on:'' },
      { k:'bm',   c:'amber', cls:'engBm',   press:1, label:'Bookmark',
        attrs:' data-id="'+esc(id)+'"', on:'' },
      { k:'dl',    c:'green', label:'Download', on:'avDownload()' },
      { k:'share', c:'blue',  label:'Share',    on:'avShare()' },
      { k:'report',c:'red',   label:'Report artwork', on:'avReport()' }
    ]);
    if(typeof window.dzRepaintEng === 'function') window.dzRepaintEng();
  }

  // The author strip and the two functions that painted it are gone with the
  // markup they wrote into: dzVwCard draws the card and dzVwFill fills it,
  // for this viewer and for the four section views alike, and the card's own
  // name and avatar are the click that opens the profile.

  function avSetupNav(id, navSource){
    var prevBtn = document.getElementById('avPrevBtn');
    var nextBtn = document.getElementById('avNextBtn');
    var source = (navSource && navSource.length) ? navSource : images;
    if(!id || !source || !source.length){
      avNavList=[]; avNavIndex=-1;
      if(prevBtn) prevBtn.style.display='none';
      if(nextBtn) nextBtn.style.display='none';
      return;
    }
    avNavList = source;
    avNavIndex = avNavList.findIndex(function(a){ return String(a.id)===String(id); });
    var show = avNavIndex!==-1 && avNavList.length>1;
    if(prevBtn) prevBtn.style.display = show ? '' : 'none';
    if(nextBtn) nextBtn.style.display = show ? '' : 'none';
  }
  function avNav(dir){
    if(avNavIndex===-1 || !avNavList.length) return;
    var next=(avNavIndex+dir+avNavList.length)%avNavList.length;
    var art=avNavList[next];
    if(!art) return;
    var cats=catList(art.category).length?catList(art.category):['others'];
    // keep prev next within list
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), 'replace', avNavList);
  }

  // the download button is the only way out of the site with a file, so every
  // click has to clear the server side daily quota first
  var avDlBusy=false;

  // keep the extension the server settled on, but title the file with the
  // artwork name as it reads in the viewer
  function avDlFileName(serverName, name){
    var m=/\.([a-z0-9]{2,4})$/i.exec(serverName||'');
    var ext=m ? m[1].toLowerCase() : 'jpg';
    var base=String(name||'').replace(/[^\w\-. ]+/g,'').trim().replace(/\s+/g,'-').slice(0,60);
    if(!base) return serverName || ('artwork.'+ext);
    return base+'.'+ext;
  }

  // hand the browser a blob from our own origin, so the raw file url is never
  // navigated to and never lands in the tab history
  function avDlSaveBlob(blob, fileName){
    var obj=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=obj; a.download=fileName; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(obj); }, 60000);
  }

  async function avDownload(){
    if(avDlBusy) return;
    var artId=avCurrentArt && avCurrentArt.id;
    if(!artId){ showToast('Nothing to download'); return; }
    if(!sb){ showToast('Downloads are unavailable right now'); return; }
    if(!currentUser){
      showToast('Sign in to download');
      if(typeof openAuthMod==='function') openAuthMod();
      return;
    }

    var btns=document.querySelectorAll('#artModal .avDlBtn');
    avDlBusy=true;
    btns.forEach(function(b){ b.disabled=true; b.setAttribute('aria-busy','true'); });
    try{
      var token='';
      try{
        var sess=await sb.auth.getSession();
        token=(sess && sess.data && sess.data.session && sess.data.session.access_token) || '';
      }catch(e){}
      if(!token){
        showToast('Sign in to download');
        if(typeof openAuthMod==='function') openAuthMod();
        return;
      }

      // /api/download charges the daily quota before it streams anything back
      var res;
      try{
        res=await fetch('/api/download', {
          method:'POST',
          headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
          body:JSON.stringify({ artwork:String(artId) })
        });
      }catch(e){
        showToast('Download failed \u2014 check your connection');
        return;
      }

      if(!res.ok){
        var info={};
        try{ info=await res.json(); }catch(e){}
        if(res.status===429 && info.reason==='limit'){
          avPaintQuota({signed_in:true, remaining:0, limit:info.limit});
          dzQuotaOpen(info);
        }else if(res.status===429){
          // burst limit, not the daily cap — no upsell, just slow down
          showToast('Too many download requests — wait a moment');
        }else if(res.status===403 && info.reason!=='limit'){
          showToast(info.error || 'Download blocked');
        }else if(res.status===401){
          showToast('Sign in to download');
          if(typeof openAuthMod==='function') openAuthMod();
        }else if(res.status===404){
          showToast('This artwork is no longer available');
        }else{
          showToast(info.error || 'Download failed \u2014 try again');
        }
        return;
      }

      var blob=await res.blob();
      var name=(document.getElementById('lbNm')||{}).textContent || (avCurrentArt && avCurrentArt.name);
      avDlSaveBlob(blob, avDlFileName(dispName(res), name));

      var left=parseInt(res.headers.get('X-Dz-Remaining'),10);
      var cap =parseInt(res.headers.get('X-Dz-Limit'),10);
      if(!isNaN(left)){
        if(!isNaN(cap)) avPaintQuota({signed_in:true, remaining:left, limit:cap});
        showToast(left>0
          ? left+' download'+(left===1?'':'s')+' left today'
          : 'That was your last download for today');
      }
      // count download for trending
      try{ window.registerArtworkDownload(artId); }catch(e){}
      if(avCurrentArt) avCurrentArt.download_count = (parseInt(avCurrentArt.download_count,10)||0) + 1;
    }finally{
      avDlBusy=false;
      btns.forEach(function(b){ b.disabled=false; b.removeAttribute('aria-busy'); });
    }
  }

  // the server already picked the extension, reuse it
  function dispName(res){
    var cd=res.headers.get('Content-Disposition') || '';
    var m=/filename="([^"]+)"/.exec(cd);
    return m ? m[1] : '';
  }

  // "3 of 5 downloads left today" under the button, so the cap is visible
  // before someone runs into it
  function avPaintQuota(q){
    var note=document.getElementById('avDlNote');
    if(!note) return;
    if(!q || !q.signed_in || typeof q.remaining!=='number'){ note.hidden=true; note.textContent=''; return; }
    note.textContent=q.remaining+' of '+q.limit+' download'+(q.limit===1?'':'s')+' left today';
    note.classList.toggle('avDlNote--out', q.remaining<=0);
    note.hidden=false;
  }
  function avLoadQuota(){
    if(!sb || !currentUser){ avPaintQuota(null); return; }
    sb.rpc('dz_download_quota').then(function(res){
      if(!res.error) avPaintQuota(res.data);
    }, function(){});
  }

  // daily quota modal
  function dzQuotaOpen(gate){
    var m=document.getElementById('dlQuotaMod');
    if(!m){
      showToast('Daily download limit reached \u2014 upgrade for more');
      if(typeof openSubscription==='function') openSubscription();
      return;
    }
    var lim=gate && typeof gate.limit==='number' ? gate.limit : null;
    var sub=document.getElementById('dlQuotaSub');
    if(sub){
      sub.textContent='You have used '+(lim!==null?'all '+lim+' of your':'all of your')+
                      ' downloads for today. To continue downloading more, you need to buy a subscription.';
    }
    var meta=document.getElementById('dlQuotaMeta');
    if(meta){
      var bits=[];
      if(gate && gate.tier) bits.push((gate.tier==='guest'?'Free':avCap(gate.tier))+' plan');
      if(lim!==null) bits.push(lim+' downloads / day');
      if(gate && gate.resets_at){
        var d=new Date(gate.resets_at);
        if(!isNaN(d)) bits.push('Resets '+d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}));
      }
      meta.textContent=bits.join('  \u00b7  ');
    }
    m.classList.add('open');
    setTimeout(function(){
      var b=m.querySelector('.dlqBtn--go');
      if(b) b.focus();
    },40);
  }
  function dzQuotaClose(){
    var m=document.getElementById('dlQuotaMod');
    if(m) m.classList.remove('open');
  }
  function dzQuotaBuy(){
    dzQuotaClose();
    closeLB();
    if(typeof openSubscription==='function') openSubscription();
  }
  window.dzQuotaOpen=dzQuotaOpen;
  window.dzQuotaClose=dzQuotaClose;
  window.dzQuotaBuy=dzQuotaBuy;
  // A resource or a cover taken from a section view spends the same daily
  // budget this counter reads, so the section views repaint it from here
  // rather than keeping a second copy of the arithmetic.
  window.avLoadQuota=avLoadQuota;
  // escape closes the quota modal only, the viewer behind it stays open
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var m=document.getElementById('dlQuotaMod');
    if(m && m.classList.contains('open')){ dzQuotaClose(); e.stopPropagation(); }
  },true);
  function avShare(){
    var url=window.location.href;
    var title=(document.getElementById('lbNm')||{}).textContent||'Artwork';
    // A share is the one thing on this page no table has ever recorded. Logged
    // on the tap rather than on the result, because neither the share sheet
    // nor the clipboard tells us whether anything was actually sent.
    if(avCurrentArt && avCurrentArt.id && typeof window.dzAnTrack==='function'){
      window.dzAnTrack('share', String(avCurrentArt.id));
    }
    if(navigator.share){ navigator.share({title:title,url:url}).catch(function(){}); }
    else if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){ showToast('Link copied'); }); }
    else { showToast('Share not supported'); }
  }
  // report flow
  var rptArt = null, rptBusy = false;

  function avReport(){
    if(!currentUser){ showToast('Sign in to report artwork'); openAuthMod(); return; }
    if(!avCurrentArt){ showToast('Nothing to report'); return; }
    rptArt = avCurrentArt;
    var m = document.getElementById('rptMod'); if(!m) return;
    // reset fields
    var chosen = m.querySelector('input[name="rptReason"]:checked'); if(chosen) chosen.checked = false;
    document.getElementById('rptDetails').value = '';
    document.getElementById('rptBlock').checked = false;
    document.getElementById('rptHide').checked  = false;
    var isOwn = rptArt.user_id && currentUser && rptArt.user_id === currentUser.id;
    document.getElementById('rptBlock').closest('.rptCheck').style.display = isOwn ? 'none' : '';
    m.classList.add('open');
  }

  function rptClose(){
    var m = document.getElementById('rptMod');
    if(m) m.classList.remove('open');
    rptArt = null;
  }

  async function rptSubmit(){
    if(rptBusy || !rptArt) return;
    var m = document.getElementById('rptMod');
    var picked = m.querySelector('input[name="rptReason"]:checked');
    if(!picked){ showToast('Pick a reason first'); return; }
    var btn = document.getElementById('rptSubmit');
    rptBusy = true; btn.disabled = true; btn.textContent = 'SENDING…';
    var art = rptArt;
    try{
      var ins = await sb.from('artwork_reports').insert({
        artwork_id : art.id,
        reporter_id: currentUser.id,
        reason     : picked.value,
        details    : (document.getElementById('rptDetails').value.trim() || null)
      });
      // dup report counts as success
      if(ins.error && ins.error.code !== '23505') throw ins.error;

      if(document.getElementById('rptHide').checked){
        await sb.from('hidden_artworks')
          .insert({ user_id: currentUser.id, artwork_id: art.id });
        // hide from feed now
        if(window.markArtworkHidden) window.markArtworkHidden(art.id);
      }
      if(document.getElementById('rptBlock').checked && art.user_id && art.user_id !== currentUser.id){
        if(window.pfFriendBridge && window.pfFriendBridge.block){
          await window.pfFriendBridge.block(art.user_id);
        }
      }
      rptClose();
      showToast('Report submitted — thank you');
    }catch(e){
      showToast('Couldn\u2019t submit report — try again');
    }finally{
      rptBusy = false; btn.disabled = false; btn.textContent = '🚩 Submit Report';
    }
  }

  /* The picture on its own.

     What was here was a zoom: a double tap doubled the picture with a
     transform and a drag panned it around inside a box with the overflow
     hidden. It had not worked in a long time — css/overrides.css pins #lbImg
     at transform:none — and it was the wrong idea even when it did. Doubling
     a picture inside a box the size of a column shows you a quarter of the
     work and takes the rest away, with no scrollbar, no way back that says so,
     and nothing at all on a screen without a mouse to drag with.

     A click opens the work on the screen instead. #dzLight is a dialog of its
     own next to the viewer in index.html, css/viewer.css fits the picture
     inside 80% of the window without ever blowing it up past its own pixels,
     and everything behind it goes dark and blurred. There is nothing to
     scroll and nothing to aim at: a click anywhere around the picture puts it
     back, and the artwork viewer is exactly as it was left — which is why
     this is a sibling of #artModal and not a layer inside it. A click inside
     the viewer that lands on the viewer closes the artwork, so a full-screen
     layer in there would close the artwork along with itself.

     dzLightOpen takes a url rather than reading one, so the section views can
     hand it theirs later without this having to know what they are. */
  var dzLightFocus = null;
  function dzLightNat(img){
    if(!img || !img.naturalWidth) return;
    img.style.setProperty('--natW', img.naturalWidth + 'px');
    img.style.setProperty('--natH', img.naturalHeight + 'px');
  }
  function dzLightOpen(src, alt){
    var box = document.getElementById('dzLight');
    var img = document.getElementById('dzLightImg');
    if(!box || !img || !src) return;
    /* Whatever the caller hands over is what is shown, at the resolution that
       url is, and it is never scaled past it. The artwork viewer and the
       section views hand over the picture already on their screen, so those
       open out of the browser's cache in the same frame they are asked for; a
       community showcase post is a thumbnail on the page and hands over the
       viewing size instead, which is one request and the right pixels.

       Blanked first when it is a different picture: the element is reused,
       and setting a src does not clear the pixels already decoded into it, so
       the last picture would be what the screen shows for a frame. */
    if(img.getAttribute('src') !== src){
      img.removeAttribute('src');
      img.style.removeProperty('--natW');
      img.style.removeProperty('--natH');
      img.src = src;
    }
    img.alt = alt || '';
    dzLightNat(img);
    dzLightFocus = document.activeElement;
    box.classList.add('open');
    // Somewhere for Escape and the tab key to be, and off the button that
    // was focused behind it.
    try{ box.focus({ preventScroll:true }); }catch(e){}
  }
  function dzLightClose(){
    var box = document.getElementById('dzLight');
    if(!box || !box.classList.contains('open')) return;
    box.classList.remove('open');
    /* The lock is the viewer's, not this one's, and the viewer is still open
       underneath. restoreScroll hands it back only when nothing in the panel
       table is holding it, so this is safe from either side: called with the
       viewer open it does nothing, and called after a sweep has closed the
       viewer it is what unlocks the page. */
    if(typeof restoreScroll === 'function') restoreScroll();
    if(dzLightFocus && dzLightFocus.focus){
      try{ dzLightFocus.focus({ preventScroll:true }); }catch(e){}
    }
    dzLightFocus = null;
  }
  function dzLightIsOpen(){
    var box = document.getElementById('dzLight');
    return !!(box && box.classList.contains('open'));
  }
  window.dzLightOpen   = dzLightOpen;
  window.dzLightClose  = dzLightClose;
  // Read by the key handlers that would otherwise act under it: the section
  // viewer steps to the next item on an arrow key, and the item under a
  // full-screen picture is not the one being looked at.
  window.dzLightIsOpen = dzLightIsOpen;

  (function(){
    document.addEventListener('DOMContentLoaded', function(){
      var pic = document.getElementById('lbImg');
      if(pic) pic.addEventListener('click', function(){
        // currentSrc, so a browser that picked a candidate of its own is not
        // second-guessed; src for one that reports nothing.
        dzLightOpen(pic.currentSrc || pic.src, pic.alt);
      });
      // and the rest of the set, which are appended after it
      var rest = document.getElementById('avImgStack');
      if(rest) rest.addEventListener('click', function(e){
        var img = e.target.closest ? e.target.closest('img') : null;
        if(img) dzLightOpen(img.currentSrc || img.src, img.alt);
      });
      var box = document.getElementById('dzLight');
      if(box) box.addEventListener('click', function(e){
        // Identity, not a contains() test: the picture is the only thing in
        // here, so anything else the click landed on is the ground around it.
        if(e.target !== document.getElementById('dzLightImg')) dzLightClose();
      });

      /* The section viewer opens the same way. A marketplace listing, a
         resource, a blog post and a job all share #dzView, and all of them
         put their picture in .dzvMedia — so this is one listener on the panel
         rather than a handler written into four renderers in js/sections.js,
         which rebuilds its body from a string every time it opens.

         The extra shots under a listing are anchors, and they stay anchors:
         the href is the picture at viewing size, so a middle click or a
         cmd-click still opens it in a tab the way any link on the page does,
         and only a plain click is taken over. A link that swallows every
         click is a link that has stopped being one. */
      var view = document.getElementById('dzView');
      if(view) view.addEventListener('click', function(e){
        var shot = e.target.closest ? e.target.closest('.dzvGallery a') : null;
        if(shot){
          if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
          var pic = shot.querySelector('img');
          e.preventDefault();
          dzLightOpen(shot.getAttribute('href'), pic ? pic.alt : '');
          return;
        }
        var media = e.target.closest ? e.target.closest('.dzvMedia img') : null;
        if(media) dzLightOpen(media.currentSrc || media.src, media.alt);
      });
    });
    /* Back closes it, whatever it was opened over. The panel table takes it
       down when a move sweeps the section away, and closeLB takes it down
       with the artwork viewer, but a page closed by the browser's own back
       button goes through neither — and a picture left standing over a page
       that is no longer there is the one state this must not have. */
    window.addEventListener('popstate', function(){ dzLightClose(); });
    /* Escape closes this and stops there. The viewer behind it has its own
       ways out and none of them should fire from the same key press — the
       quota sheet above the viewer is handled the same way, a few hundred
       lines up. */
    document.addEventListener('keydown', function(e){
      if(e.key !== 'Escape' || !dzLightIsOpen()) return;
      dzLightClose();
      e.stopPropagation();
    }, true);
  })();

  /* The wheel works everywhere inside the viewer, not only over the columns.

     Two scrollers side by side leave a lot of surface that is neither of
     them: the bar at the top, the air around the pictures, the space between
     the columns, and anything the page happens to put over them — an ad's
     iframe swallows the wheel whole, and so does any sheet that opens above
     this one. Wheel over any of that and nothing moved, because every box
     from .avBody up to <body> is overflow:hidden, so there was nothing to
     scroll and nothing to chain to either.

     So the dialog itself takes the wheel and routes it. If anything under
     the cursor can already scroll, this stands aside and lets the browser do
     it natively — that keeps the momentum and smoothing the platform gives
     you, and it is the case that fires whenever the cursor is honestly over
     a column. Only when nothing under the cursor can scroll does this pick a
     column by which side of the divide the cursor is on, and move that one;
     if it has reached its own end, the other takes the rest.

     Which also subsumes the forwarding this replaces: a picture that fits
     has nothing to scroll, so the notes get the wheel, exactly as before. */
  (function(){
    function canTake(el, dy){
      if(!el || el.nodeType !== 1) return false;
      var cs = getComputedStyle(el), ov = cs.overflowY;
      if(ov !== 'auto' && ov !== 'scroll') return false;
      var room = el.scrollHeight - el.clientHeight;
      if(room <= 1) return false;
      return dy > 0 ? el.scrollTop < room - 1 : el.scrollTop > 1;
    }
    /* deltaY is only in pixels when the browser says it is. Firefox reports a
       notch in lines and a page key in pages, so the raw number moves a pane
       about three pixels and reads as frozen. */
    function wheelPx(e, el){
      if(e.deltaMode === 1){
        var lh = parseFloat(getComputedStyle(el).lineHeight);
        return e.deltaY * (lh > 0 ? lh : 16);
      }
      if(e.deltaMode === 2) return e.deltaY * el.clientHeight;
      return e.deltaY;
    }
    function scrollerUnder(from, dy, stop){
      var el = from;
      while(el && el.nodeType === 1 && el !== stop){
        if(canTake(el, dy)) return el;
        el = el.parentElement;
      }
      return null;
    }
    /* On the document rather than on the dialog, because a listener bound to
       the dialog cannot hear a wheel that never reaches it. Anything painted
       over the viewer — an ad's iframe, a sheet from another page left open
       above it, any element with a bigger z-index — is the event's target,
       and the event travels from there to the document without passing
       through #artModal at all. Bound here it is heard wherever it lands.

       It still yields to anything under the cursor that can scroll, which is
       what keeps another open dialog's own scrolling working, and it does
       nothing at all unless the artwork viewer is open. */
    document.addEventListener('DOMContentLoaded', function(){
      document.addEventListener('wheel', function(e){
        var modal = document.getElementById('artModal');
        if(!modal || !modal.classList.contains('open')) return;
        // The full view is one picture on a blurred ground with nothing to
        // scroll. Routing the wheel to the columns behind it would scroll a
        // page nobody can see moving.
        if(dzLightIsOpen()){ e.preventDefault(); return; }
        var pane = modal.querySelector('.avImgPane');
        var side = modal.querySelector('.avSideScroll');
        if(!pane || !side) return;
        var dy = wheelPx(e, side);
        if(!dy) return;
        if(scrollerUnder(e.target, dy, null)) return;   // the browser has this
        var edge = side.getBoundingClientRect().left;
        var first = e.clientX >= edge ? side : pane;
        var second = first === side ? pane : side;
        var t = canTake(first, dy) ? first : (canTake(second, dy) ? second : null);
        if(!t) return;
        t.scrollTop += dy;
        e.preventDefault();
      }, { passive:false });

      /* The section viewer has the same two panes and the same dead surface. */
      var dzv = document.getElementById('dzView');
      if(dzv) dzv.addEventListener('wheel', function(e){
        // One picture on a blurred ground, with nothing behind it that should
        // move while it is up.
        if(dzLightIsOpen()){ e.preventDefault(); return; }
        var media = dzv.querySelector('.dzvMedia'), col = dzv.querySelector('.dzvCol');
        if(!media || !col) return;
        var dy = wheelPx(e, col);
        if(!dy) return;
        if(scrollerUnder(e.target, dy, dzv)) return;
        var t = canTake(media, dy) ? media : (canTake(col, dy) ? col : null);
        if(!t) return;
        t.scrollTop += dy;
        e.preventDefault();
      }, { passive:false });
    });
  })();

  /* The page around the panel closes it.

     .avBox stops click from bubbling, and has since this markup was written,
     but nothing was ever listening above it — so the stopPropagation guarded
     a handler that did not exist and clicking beside the artwork did nothing
     at all. It does now, and the test is identity rather than a bubble: only
     a click that landed on #artModal ITSELF is a click on the page behind the
     panel. A click on anything inside it has that thing as its target, so a
     button whose handler removes it from the document — the close in the
     card, a comment's delete — can never be mistaken for a click on the
     backdrop the way a contains() test would mistake it. */
  /* The ground around the work closes the view.

     There is no panel with a page behind it any more — the viewer IS the
     page — so "outside" is not another element, it is the part of this one
     that nothing has been put on: the gutters either side of the two
     columns, the air above and below a picture that does not fill its
     column, and the space under the notes. A click that lands on one of
     those containers rather than on something inside it is a click on
     nothing, and that is the gesture people already try.

     Identity, not contains(): a click on the picture, the notes, a button or
     a comment has that thing as its target and is left alone, including a
     button that removes itself from the document as it is clicked — which is
     what a contains() test gets wrong. */
  /* Every container in the viewer, and nothing that is content.

     A list of ids compared one at a time was the first version of this and it
     missed the notes' own scroller — which is the space under the writing,
     the most obvious place to click when you want out. Written as a selector,
     the rule is the thing it is trying to say: if what you clicked is one of
     the boxes the viewer is built from rather than something put inside one,
     you clicked the ground.

     matches(), not contains(): a click on the work, the writing, a button or
     a comment has that element as its target and is left alone — including a
     button that takes itself out of the document as it is clicked, which is
     exactly what a contains() test gets wrong. */
  var AV_GROUND = '#artModal, #artModal .avBox, #artModal .avBody,' +
                  '#artModal .avImgPane, #artModal .avImgViewport,' +
                  '#artModal .avImgStack, #artModal .avSide, #artModal .avSideScroll';
  /* Desktop only. On a phone the ground is most of what a thumb lands on —
     the gutters are the edges of the screen and the space under the writing
     is where a scroll ends — so closing on it turns an ordinary mis-tap into
     losing the page. There is a close button and the back gesture there, and
     they are enough. */
  function avGroundClick(e){
    if(!(window.matchMedia && matchMedia('(min-width:900px)').matches)) return;
    var t = e.target;
    if(t && t.matches && t.matches(AV_GROUND)) closeLB();
  }
  (function(){
    document.addEventListener('DOMContentLoaded', function(){
      var modal = document.getElementById('artModal');
      if(!modal) return;
      modal.addEventListener('click', avGroundClick);
    });
  })();

  function openLB(src,name,cat,desc,id,pushUrl,navSource){
    var art = id ? findArtworkById(id) : null;
    if(!art && id && navSource && navSource.length){
      art = navSource.find(function(a){ return String(a.id)===String(id); }) || null;
    }
    avCurrentArt = art;
    var modal=document.getElementById('artModal');
    var _fgAtOpen = document.getElementById('fg');
    avLbFromGallery = !!(_fgAtOpen && _fgAtOpen.classList.contains('open'));
    if(amCloseTimer){clearTimeout(amCloseTimer);amCloseTimer=null;}
    if(modal) modal.classList.remove('closing');

    // instant reset
    (function(){
      var cl=document.getElementById('avCmList');
      if(cl) cl.innerHTML='<div class="avCmEmpty">LOADING\u2026</div>';
      var ci=document.getElementById('avCmIn'); if(ci) ci.value='';
      var st=document.getElementById('avImgStack'); if(st){ st.hidden=true; st.innerHTML=''; }
      // Back to the top of both panes. This markup is written once in
      // index.html and reused for every artwork — unlike the section viewer,
      // which rebuilds its body each time and so starts at the top for free —
      // so without this the next artwork opens wherever the last one was left,
      // which on a long comment thread is the bottom of the page.
      var pane=document.querySelector('#artModal .avImgPane');
      if(pane) pane.scrollTop=0;
      var side=document.querySelector('#artModal .avSideScroll');
      if(side) side.scrollTop=0;
      var bdy=document.querySelector('#artModal .avBody');
      if(bdy) bdy.scrollTop=0;
    })();

    var viewport=document.getElementById('avImgViewport');
    if(viewport) viewport.classList.add('loading');
    var imgEl=document.getElementById('lbImg');
    // guard missing img
    if(imgEl){
      // show medium size
      imgEl.removeAttribute('src');   // blank old pixels
      imgEl.src=getViewUrl(src);
      // alt text for seo
      imgEl.alt=name||'Untitled artwork';
      imgEl.onload=function(){
        if(viewport) viewport.classList.remove('loading');
        avUpdateResolution(imgEl.naturalWidth, imgEl.naturalHeight);
      };
      imgEl.onerror=function(){ if(viewport) viewport.classList.remove('loading'); };
      // cached image may skip onload
      if(imgEl.complete && imgEl.naturalWidth){
        if(viewport) viewport.classList.remove('loading');
        avUpdateResolution(imgEl.naturalWidth, imgEl.naturalHeight);
      }
    }

    // multi image support
    avBuildStrip(art, src);

    document.getElementById('lbNm').textContent=name||'';

    // filter hidden categories
    var tags = art ? ((art.tags && art.tags.length) ? art.tags : catList(art.category)) : (cat ? [cat] : []);
    if(typeof catHidden === 'function') tags = (tags||[]).filter(function(t){ return !catHidden(t); });
    // renamed to avoid shadowing
    var catLabelStr = (cat && !(typeof catHidden === 'function' && catHidden(cat))) ? cat : (tags[0]||'');
    var subType = document.getElementById('avSubType');
    if(subType) subType.textContent = catLabelStr ? avCap(catLabelStr)+' Artwork' : 'Digital Artwork';

    // description optional
    var descEl=document.getElementById('lbDesc');
    var descBlock=document.getElementById('avDescBlock');
    var descDiv=document.getElementById('avDescDiv');
    if(descEl){
      if(desc){ descEl.textContent=desc; descBlock.hidden=false; descDiv.hidden=false; }
      else{ descEl.textContent=''; descBlock.hidden=true; descDiv.hidden=true; }
    }

    // tags
    var tagListEl=document.getElementById('avTagList');
    var tagsBlock=document.getElementById('avTagsBlock');
    var tagsDiv=document.getElementById('avTagsDiv');
    if(tagListEl){
      if(tags && tags.length){
        tagListEl.innerHTML=tags.map(function(t){return '<span class="avTagChip">'+esc(avCap(t))+'</span>';}).join('');
        tagsBlock.hidden=false; tagsDiv.hidden=false;
      } else { tagListEl.innerHTML=''; tagsBlock.hidden=true; tagsDiv.hidden=true; }
    }

    // The slot between the tags and the comments, rebuilt for this artwork.
    // Rebuilt rather than filled once: this viewer is one node reused for
    // every artwork, and AdSense will not push a second ad into an element it
    // has already filled. js/effects.js drops the block entirely on a plan
    // without ads.
    if(typeof window.dzAdSlot === 'function') window.dzAdSlot('avAdSlot');

    avRenderMeta({ category:catLabelStr, software: art?art.software:null,
                   createdAt: art?art.created_at:null, hasArt: !!art, art: art });
    avRenderExtras(art);
    avRenderCard(art);
    avRenderRail(art);
    avPaintQuota(null); avLoadQuota();
    avSetupNav(id, navSource);
    if(id && typeof window.dzCmLoad==='function') window.dzCmLoad('artwork', String(id), 'avCmList');

    modal.setAttribute('data-state','open');
    modal.classList.add('open');
    document.body.style.overflow='hidden';
    // The way out takes focus, so the dialog is somewhere to tab from and Esc
    // has an owner. .avCloseBtn is a name nothing wears any more — dzVwCard
    // draws the card and its button is .vwClose — so this had been focusing
    // nothing since the card was rewritten, and focus stayed behind on the
    // gallery underneath. preventScroll because the three scrollers were
    // just sent back to the top a few lines up, and bringing a button into
    // view is exactly the kind of thing that would undo that.
    setTimeout(function(){
      var closeBtn=document.querySelector('#artModal .vwClose');
      if(closeBtn) closeBtn.focus({preventScroll:true});
    },50);
    // update url and meta
    if(id){
      if(pushUrl!==false && window.location.pathname!=='/artwork/'+id){
        // 'replace' is what Next and Previous pass: the viewer is one
        // place, not one place per artwork stepped through, so walking a
        // gallery leaves one entry behind rather than one per step.
        try{
          if(pushUrl === 'replace') history.replaceState({artId:id},'', '/artwork/'+id);
          else {
            // Where to put the address bar back when this closes. Captured on
            // the push and not on a 'replace', so stepping through a gallery
            // still returns to wherever the run started.
            avReturnUrl = window.location.pathname + window.location.search;
            history.pushState({artId:id},'', '/artwork/'+id);
          }
        }catch(e){}
      }
      updateArtworkSEO({id:id,name:name,description:desc,category:cat,image_url:src});
    }
  }
  function closeLB(keepUrl){
    var modal=document.getElementById('artModal');
    if(!modal || !modal.classList.contains('open'))return;
    /* The full view goes with the artwork it was opened from. It is a sibling
       of this panel rather than a child, which is what keeps a click beside
       the picture from closing both — and the other side of that is that
       nothing takes it down with the viewer unless the viewer says so. Every
       way out ends here: the way back, the sweep when the member changes
       section, and the click on the page around the panel. */
    dzLightClose();
    modal.classList.add('closing');
    if(amCloseTimer)clearTimeout(amCloseTimer);
    amCloseTimer=setTimeout(function(){
      modal.classList.remove('open');
      modal.classList.remove('closing');
      modal.setAttribute('data-state','closed');
      restoreScroll();
      var imgEl=document.getElementById('lbImg');
      if(imgEl){imgEl.src='';imgEl.alt='';}
      avCurrentArt=null;
    },230);
    /* REPLACE the entry, do not push another one.
       Opening pushed /artwork/<id>; closing used to push '/' on top of it, so
       every open-and-close left two entries behind and Back walked straight
       into the viewer it had just closed. Two artworks viewed took four
       presses to get out of, four took eight, and on a phone Back is the
       navigation. replaceState swaps the viewer's own entry for where it came
       from, which keeps the stack the length it was and makes one Back mean
       one Back.
       avReturnUrl is where the viewer was opened FROM, not a hard-coded '/':
       an artwork opened from a profile used to drop the reader on the home
       page. Null when this page was deep-linked, and then '/' is the only
       honest answer — there is nothing behind it. */
    if(!keepUrl && /^\/artwork\//.test(window.location.pathname)){
      try{ history.replaceState({},'', avReturnUrl || '/'); }catch(e){}
      avReturnUrl = null;
      resetArtworkSEO();
    }
  }
  /* The second copy of this listener is gone. There were two, bound to the
     same element for the same event, from the days when the viewer was a
     panel — one of them is enough and avGroundClick above is the one that
     knows where the ground is now. */

  // artwork urls and seo
  function handleArtClick(e,id){
    if(e){
      // allow new tab on modifier click
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1) return true;
      e.preventDefault();
    }
    var el = document.querySelector('.gItem[data-id="'+id+'"]');
    if(!el) return false;
    openLB(el.getAttribute('data-fullsrc'), el.getAttribute('data-name'), el.getAttribute('data-cat'), el.getAttribute('data-desc'), id);
    return false;
  }

  // find artwork by id
  function findArtworkById(id){
    if(!id) return null;
    var idS = String(id);
    for(var i=0;i<images.length;i++){
      if(String(images[i].id)===idS) return images[i];
    }
    return null;
  }

  // open artwork by id
  function openArtworkById(id,pushUrl){
    var art = findArtworkById(id);
    if(!art) return false;
    var cats=catList(art.category).length?catList(art.category):['others'];
    openLB(art.image_url, art.name, cats[0]||'', art.description||'', String(art.id), pushUrl);
    return true;
  }

  // head meta per artwork
  var SITE_NAME = 'Digiartz';
  var SITE_URL  = 'https://digiartz.net';
  function setMeta(selector, attr, value){
    var el = document.querySelector(selector);
    if(el) el.setAttribute(attr, value);
  }
  function updateArtworkSEO(art){
    if(!art) return;
    var title = (art.name||'Untitled artwork') + ' — ' + SITE_NAME;
    var desc = (art.description && art.description.trim())
      ? art.description.trim().slice(0,300)
      : ('View "'+(art.name||'this artwork')+'"'+(catList(art.category).length?(' in the '+catList(art.category).join(', ')+' collection'):'')+' on '+SITE_NAME+', the digital art community.');
    var url = SITE_URL + '/artwork/' + art.id;
    document.title = title;
    setMeta('meta[name="description"]','content',desc);
    setMeta('link[rel="canonical"]','href',url);
    setMeta('meta[property="og:title"]','content',title);
    setMeta('meta[property="og:description"]','content',desc);
    // the resized derivative, never the stored original: the origin bucket is
    // not meant to stay publicly readable, and a preview that 403s is worse
    // than no preview. the edge middleware sets the same thing for scrapers,
    // which never run this code
    var ogImg = art.image_url ? imgResize(art.image_url, 1200) : '';
    setMeta('meta[property="og:image"]','content',ogImg);
    setMeta('meta[property="og:url"]','content',url);
    setMeta('meta[property="og:type"]','content','article');
    setMeta('meta[name="twitter:title"]','content',title);
    setMeta('meta[name="twitter:description"]','content',desc);
    setMeta('meta[name="twitter:image"]','content',ogImg);
    setMeta('meta[name="twitter:card"]','content','summary_large_image');
    // replace json ld block
    var ld = document.getElementById('ldArtwork');
    if(!ld){
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'ldArtwork';
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify({
      '@context':'https://schema.org',
      '@type':'ImageObject',
      'contentUrl':ogImg,
      'name':art.name||'Untitled artwork',
      'description':desc,
      'url':url,
      'creator':{'@type':'Organization','name':'DigiArtz'},
      'representativeOfPage':true
    });
  }
  function resetArtworkSEO(){
    document.title = SITE_DEFAULT_TITLE;
    setMeta('meta[name="description"]','content',SITE_DEFAULT_DESC);
    setMeta('link[rel="canonical"]','href',SITE_URL+'/');
    setMeta('meta[property="og:title"]','content',SITE_DEFAULT_TITLE);
    setMeta('meta[property="og:description"]','content',SITE_DEFAULT_DESC);
    setMeta('meta[property="og:image"]','content',SITE_DEFAULT_IMAGE);
    setMeta('meta[property="og:url"]','content',SITE_URL+'/');
    setMeta('meta[property="og:type"]','content','website');
    setMeta('meta[name="twitter:title"]','content',SITE_DEFAULT_TITLE);
    setMeta('meta[name="twitter:description"]','content',SITE_DEFAULT_DESC);
    setMeta('meta[name="twitter:image"]','content',SITE_DEFAULT_IMAGE);
    var ld = document.getElementById('ldArtwork');
    if(ld) ld.remove();
  }

  // sync with history
  window.addEventListener('popstate', function(){
    // The browser has moved the address bar itself, so whatever the viewer
    // recorded as its way back belongs to a position we are no longer in.
    avReturnUrl = null;
    var m = window.location.pathname.match(/^\/artwork\/([^/]+)\/?$/);
    var pm = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if(m){
      /* Already on screen. A Back or Forward that lands on the address of the
         panel already open — stepping out of a profile opened from an
         artwork, say — has nothing to do: re-opening would tear the panel
         down and rebuild it from a fresh fetch, which reads as a flicker and
         loses the reader's place in it. */
      var artId = dzDecodeSeg(m[1]);
      var _am = document.getElementById('artModal');
      if(_am && _am.classList.contains('open') &&
         avCurrentArt && String(avCurrentArt.id) === String(artId)) return;
      // close profile, reopen viewer
      var _fromGal = avLbFromGallery;
      if(document.getElementById('profilePage').classList.contains('open')) closeProfilePage(false);
      if(_fromGal){
        var _fgBack = document.getElementById('fg');
        if(_fgBack && !_fgBack.classList.contains('open')){
          _fgBack.classList.add('open');
          if(typeof bnSetActive==='function') bnSetActive('bnGallery');
        }
      }
      openArtworkById(artId, false);
    } else if(pm){
      var uname = dzDecodeSeg(pm[1]);
      var _pp = document.getElementById('profilePage');
      var shown = (typeof pf === 'object' && pf && pf.profile) ? pf.profile.username : null;
      if(_pp && _pp.classList.contains('open') && shown &&
         String(shown).toLowerCase() === String(uname).toLowerCase()) return;
      openProfileByUsername(uname, false);
    } else if(window.location.pathname === '/login'){
      openAuthMod();
    } else {
      closeLB();
      resetArtworkSEO();
      if(document.getElementById('profilePage').classList.contains('open')) closeProfilePage(false, true);
      closeAuthMod(false);
    }
  });

  // THE ADMIN PANEL IS NOT IN THIS BUNDLE.
  //
  // It used to be: seven hundred lines in js/pfedit.js naming every privileged
  // endpoint, the telemetry fields, the partner programme, the invite flow and
  // the ban engine. None of it was exploitable — every action behind it is
  // refused by a guard in Postgres — but js/pfedit.js is a static asset that
  // Cloudflare serves to anyone, the service worker caches, and Googlebot
  // reads. A visitor's page source names no payment provider and quotes no
  // price; it has no business describing the moderation tooling either.
  //
  // So this is all that is left here: the address, and the decision to ask for
  // it. /api/ops answers only a caller holding a valid session AND a role of
  // admin, dev or partner — checked against Postgres, never against anything
  // the browser sends — and it builds the module for whoever asked. A
  // partner's copy contains the reports and moderation code and nothing else;
  // the telemetry, the partner list, the invite flow, the audit reader and the
  // broadcast composer are not hidden from it, they are absent from it.
  //
  // Anyone else gets a JavaScript comment, which is the same thing they would
  // get for an endpoint that does not exist.
  //
  // The two role checks below decide only whether to ASK. They are not a
  // gate — /api/ops re-decides on its own, so editing them in a console gets
  // you the same comment.
  var opsFor = null, opsInflight = null;

  function opsLoad(uid){
    if(opsFor === uid) {
      if(typeof dzOpsMenu === 'function') dzOpsMenu();
      return Promise.resolve(true);
    }
    if(opsInflight) return opsInflight;

    opsInflight = Promise.resolve().then(function(){
      if(typeof sb === 'undefined' || !sb) return false;
      return sb.auth.getSession().then(function(s){
        var session = s && s.data && s.data.session;
        if(!session) return false;
        return fetch('/api/ops', {
          headers: { authorization: 'Bearer ' + session.access_token },
          cache: 'no-store'
        }).then(function(res){
          return res.ok ? res.text() : null;
        }).then(function(code){
          if(!code) return false;
          // A module already loaded for a different account has to give up its
          // shell and its menu entry before the incoming one draws over them.
          if(opsFor && typeof dzOpsReset === 'function') dzOpsReset();
          var url = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
          return new Promise(function(ok, no){
            var el = document.createElement('script');
            el.src = url;
            el.onload  = function(){ URL.revokeObjectURL(url); ok(true); };
            el.onerror = function(){ URL.revokeObjectURL(url); no(new Error('load failed')); };
            document.head.appendChild(el);
          });
        });
      });
    }).then(function(ok){
      opsInflight = null;
      if(ok) opsFor = uid;
      return !!ok;
    }, function(){ opsInflight = null; return false; });

    return opsInflight;
  }

  function syncAdmBtn(){
    var staff   = typeof dzIsStaff   === 'function' && dzIsStaff();
    var partner = typeof dzIsPartner === 'function' && dzIsPartner();
    var uid = (window.currentUser && currentUser.id) ? String(currentUser.id) : null;

    if(!uid || (!staff && !partner)){
      // Signed out, or an account with no business here. Whatever a previous
      // account left on this page goes with it.
      if(opsFor && typeof dzOpsReset === 'function') dzOpsReset();
      else {
        var b = document.getElementById('smAdmBtn');
        if(b && b.parentNode) b.parentNode.removeChild(b);
      }
      opsFor = null;
      return;
    }
    opsLoad(uid);
  }

