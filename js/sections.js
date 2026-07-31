// sections, detail view, hero
(function () {
  'use strict';

  var widgets = Array.prototype.slice.call(document.querySelectorAll('.fpFloat'));
  var zeoBtn = document.getElementById('zeoBtn');
  if (zeoBtn) widgets.push(zeoBtn);
  if (!widgets.length) return;

  var panelOpen = false;
  var wasOut = false;

  function apply() {
    var out = panelOpen;
    widgets.forEach(function (el) {
      el.classList.toggle('heroOut', out);
    });
    // mute the bubble too
    if (out !== wasOut) {
      wasOut = out;
      if (out) {
        if (typeof window.zeoPauseBubble === 'function') window.zeoPauseBubble();
      } else {
        if (typeof window.zeoResumeBubble === 'function') window.zeoResumeBubble();
      }
    }
  }

  // overlay panels hide the widgets
  // pfEditPage was missing here while every other full-screen panel was
  // listed, so the floating widgets stayed on top of profile settings. Barely
  // visible while that panel was short; obvious once it grew a wallet.
  var OVERLAY_IDS = ['profilePage', 'fg', 'communityPage', 'subPage', 'adsPanel', 'authMod', 'pfUpMod', 'upMod', 'artModal', 'notifPage', 'admPage', 'pfMyWorkPage', 'pfEditPage', 'setPage', 'walletPage', 'bankPage', 'themePage', 'bmPage', 'xpPage', 'rankPage'];
  var overlayEls = OVERLAY_IDS
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  function refreshPanelOpen() {
    panelOpen = overlayEls.some(function (el) { return el.classList.contains('open'); });
    apply();
  }

  if (overlayEls.length && 'MutationObserver' in window) {
    var mo = new MutationObserver(refreshPanelOpen);
    overlayEls.forEach(function (el) {
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    refreshPanelOpen();
  }
})();

// section content
(function(){
  'use strict';

  // cache rows per section
  var dzCache = {}, dzBusy = {}, dzLoaded = {};

  var SEC = {
    resources: {
      table:'resources', kind:'grid', noun:'resource',
      select:'id,user_id,title,description,category,tags,file_url,file_name,file_ext,file_size,preview_url,license,download_count,created_at'
    },
    blog: {
      table:'blog_posts', kind:'list', noun:'post',
      select:'id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,created_at'
    },
    marketplace: {
      table:'marketplace_items', kind:'grid', noun:'item',
      // file url is revoked for clients, and so is price_cents for anon — the
      // grant is column level, so asking for it while signed out fails the
      // whole query rather than returning null. selectFor adds it back once
      // there is a session.
      select:'id,user_id,title,description,category,tags,item_type,currency,file_ext,file_size,preview_url,license,delivery_days,created_at'
    },
    jobs: {
      table:'jobs', kind:'list', noun:'job',
      select:'id,user_id,title,company,company_url,description,category,tags,employment_type,is_remote,location_city,location_country,applicant_countries,salary_min,salary_max,salary_currency,salary_unit,apply_url,apply_email,valid_through,created_at'
    }
  };

  // formatters
  function bytes(n){
    n = Number(n)||0;
    if(n <= 0) return '';
    var u = ['B','KB','MB','GB'], i = 0;
    while(n >= 1024 && i < u.length-1){ n /= 1024; i++; }
    return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }
  function ago(ts){
    if(!ts) return '';
    var s = (Date.now() - new Date(ts).getTime())/1000;
    if(s < 60) return 'just now';
    var m = [[31536000,'y'],[2592000,'mo'],[604800,'w'],[86400,'d'],[3600,'h'],[60,'m']];
    for(var i=0;i<m.length;i++){ if(s >= m[i][0]) return Math.floor(s/m[i][0]) + m[i][1] + ' ago'; }
    return 'just now';
  }
  function money(cents, cur){
    if(!cents) return 'Free';
    try{
      return new Intl.NumberFormat(undefined,{style:'currency',currency:cur||'USD'}).format(cents/100);
    }catch(e){ return ((cents/100).toFixed(2)) + ' ' + (cur||'USD'); }
  }
  // An empty hole where a price and a buy control belong. This file is public,
  // so it writes neither — it writes the hole and the row's own figures, and
  // the signed-in module fills it. A guest never has price_cents to begin
  // with (the column is revoked for anon), so the hole stays empty and the
  // markup says nothing.
  function slot(r, id, hasFile, view){
    if(!window.currentUser) return '';
    return '<div class="dzSlot" data-i="'+id+'" data-p="'+(Number(r.price_cents)||0)+
           '" data-c="'+esc(r.currency||'USD')+'" data-f="'+(hasFile?1:0)+
           '" data-v="'+view+'"></div>';
  }
  window.dzSlot = slot;

  function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function labelOf(sec, slug){
    var o = (window.FG_SECTIONS && FG_SECTIONS[sec] && FG_SECTIONS[sec].opts) || [];
    for(var i=0;i<o.length;i++){ if(slugify(o[i]) === slug) return o[i]; }
    return slug;
  }

  // load
  function dzSecEnter(sec){
    if(!SEC[sec] || dzLoaded[sec] || dzBusy[sec]) { dzSecRender(sec); return; }
    dzSecLoad(sec);
  }
  // The one column a signed-out visitor may not read. Asked for anyway it
  // fails the request outright, so it is only ever in the select list when
  // there is a session to justify it.
  function selectFor(sec){
    var s = SEC[sec].select;
    if(sec === 'marketplace' && window.currentUser) s += ',price_cents';
    return s;
  }
  window.dzSelectFor = selectFor;

  function dzSecLoad(sec){
    var cfg = SEC[sec], host = document.getElementById('fgSecC-'+sec);
    if(!cfg || !host) return;
    // sb is lexical, not on window
    if(!sb){ host.innerHTML = '<div class="dzEmpty">BACKEND NOT CONFIGURED</div>'; return; }
    dzBusy[sec] = true;
    host.innerHTML = '<div class="dzBusy">LOADING…</div>';
    sb.from(cfg.table).select(selectFor(sec))
      .eq('status','approved').order('created_at',{ascending:false}).limit(200)
      .then(function(res){
        dzBusy[sec] = false; dzLoaded[sec] = true;
        dzCache[sec] = (res && res.data) || [];
        dzSecRender(sec);
      }, function(){
        dzBusy[sec] = false;
        host.innerHTML = '<div class="dzEmpty">COULD NOT LOAD — TRY AGAIN</div>';
      });
  }

  // filter and paint
  function matches(row, q){
    if(!q) return true;
    var hay = [row.title, row.description, row.excerpt, row.company]
                .concat(row.tags||[]).concat(row.category||[]).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }
  function dzSecRender(sec){
    var host = document.getElementById('fgSecC-'+sec);
    if(!host || !SEC[sec]) return;
    if(dzBusy[sec]) return;
    if(!dzLoaded[sec]){ host.innerHTML = ''; return; }

    var q   = String((window.fgSecQuery||{})[sec]||'').trim().toLowerCase();
    var cat = (window.fgSecFilter||{})[sec] || 'all';
    var rows = (dzCache[sec]||[]).filter(function(r){
      if(cat !== 'all' && (r.category||[]).indexOf(cat) === -1) return false;
      return matches(r, q);
    });

    if(!rows.length){
      host.innerHTML = '<div class="dzEmpty">' +
        (q || cat !== 'all' ? 'NOTHING MATCHES THAT' : 'NOTHING HERE YET') + '</div>';
      return;
    }
    var wrap = SEC[sec].kind === 'grid' ? 'dzGrid' : 'dzList';
    host.innerHTML = '<div class="'+wrap+'">' + rows.map(function(r){ return card(sec, r); }).join('') + '</div>';
    if(typeof window.dzExtras === 'function') window.dzExtras();   // fills the slots above
  }

  function chips(r){
    var t = (r.tags||[]).slice(0,3);
    if(!t.length) return '';
    return '<div class="dzChipRow">' + t.map(function(x){
      return '<span class="dzChip">'+esc(x)+'</span>'; }).join('') + '</div>';
  }

  function card(sec, r){
    var id = esc(r.id);
    if(sec === 'resources'){
      var thumb = r.preview_url
        ? '<img loading="lazy" decoding="async" '+dzThumbAttrs(r.preview_url)+' alt="'+esc(r.title)+'">'
        : '<span class="dzExt">'+esc((r.file_ext||'FILE').toUpperCase())+'</span>';
      // card opens the detail view
      return '<div class="dzCard" onclick="dzOpenView(\'resources\',\''+id+'\')">'+
        '<div class="dzThumb">'+thumb+'<span class="dzBadge">'+esc((r.file_ext||'').toUpperCase())+'</span></div>'+
        '<div class="dzBody"><div class="dzName">'+esc(r.title)+'</div>'+
        '<div class="dzMeta"><span>'+esc(bytes(r.file_size))+'</span>'+
        '<span>'+esc(String(r.download_count||0))+' downloads</span>'+
        '<span>'+esc(r.license||'')+'</span></div>'+chips(r)+'</div></div>';
    }
    if(sec === 'marketplace'){
      var mt = r.preview_url
        ? '<img loading="lazy" decoding="async" '+dzThumbAttrs(r.preview_url)+' alt="'+esc(r.title)+'">'
        : '<span class="dzExt">'+esc((r.item_type||'ITEM').toUpperCase())+'</span>';
      // file url never reaches the client
      var hasFile = r.file_ext ? 1 : 0;
      return '<div class="dzCard" data-id="'+id+'" onclick="dzOpenView(\'marketplace\',\''+id+'\')">'+
        '<div class="dzThumb">'+mt+'<span class="dzBadge">'+esc((r.item_type||'').toUpperCase())+'</span></div>'+
        '<div class="dzBody"><div class="dzName">'+esc(r.title)+'</div>'+
        '<div class="dzMeta"><span>'+esc(r.license||'')+'</span>'+
        (r.delivery_days ? '<span>'+esc(String(r.delivery_days))+'d delivery</span>' : '')+
        '</div>'+chips(r)+slot(r, id, hasFile, 'card')+'</div></div>';
    }
    if(sec === 'blog'){
      var ico = r.cover_url
        ? '<img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(r.cover_url))+'" alt="">'
        : esc((r.title||'?').charAt(0).toUpperCase());
      var ex = r.excerpt || String(r.body||'').slice(0,140);
      return '<div class="dzRow" data-id="'+id+'" onclick="dzOpenView(\'blog\',\''+id+'\')"><div class="dzRowIco">'+ico+'</div>'+
        '<div style="min-width:0;flex:1"><div class="dzName">'+esc(r.title)+'</div>'+
        '<div class="dzMeta" style="margin:.2rem 0 .3rem"><span>'+esc(ago(r.created_at))+'</span>'+
        '<span>'+esc(String(r.read_minutes||1))+' min read</span></div>'+
        '<div class="dzHint">'+esc(ex)+'</div>'+chips(r)+'</div></div>';
    }
    // jobs
    var where = r.is_remote ? 'Remote'
      : [r.location_city, r.location_country].filter(Boolean).join(', ');
    var pay = (r.salary_min || r.salary_max)
      ? [r.salary_min, r.salary_max].filter(function(x){return x!=null;})
          .map(function(x){ return money(Math.round(Number(x)*100), r.salary_currency); }).join(' – ')
        + (r.salary_unit ? ' / '+r.salary_unit.toLowerCase() : '')
      : '';
    return '<div class="dzRow" data-id="'+id+'" onclick="dzOpenView(\'jobs\',\''+id+'\')">'+
      '<div class="dzRowIco">'+esc((r.company||'?').charAt(0).toUpperCase())+'</div>'+
      '<div style="min-width:0;flex:1"><div class="dzName">'+esc(r.title)+'</div>'+
      '<div class="dzMeta" style="margin:.2rem 0 .3rem"><span>'+esc(r.company)+'</span>'+
      (where ? '<span>'+esc(where)+'</span>' : '')+
      '<span>'+esc(String(r.employment_type||'').replace('_',' '))+'</span>'+
      (pay ? '<span>'+esc(pay)+'</span>' : '')+
      '<span>'+esc(ago(r.created_at))+'</span></div>'+chips(r)+'</div></div>';
  }

  // upload forms
  var LICENSE_RES = [['personal','Personal use only'],['commercial','Commercial use OK'],
                     ['cc0','CC0 — public domain'],['cc-by','CC BY — credit required'],['custom','Custom terms']];
  var LICENSE_MKT = [['standard','Standard'],['extended','Extended'],['exclusive','Exclusive'],['custom','Custom']];
  var EMP = [['CONTRACTOR','Freelance / contract'],['FULL_TIME','Full-time'],['PART_TIME','Part-time'],
             ['INTERN','Internship'],['TEMPORARY','Temporary'],['VOLUNTEER','Volunteer / collab'],
             ['PER_DIEM','Per diem'],['OTHER','Other']];

  var FORMS = {
    resources: { title:'Share a Resource', sub:'Brushes, textures, fonts, templates — anything that helps another artist work faster.',
      fields:[
        {k:'file',   t:'file',  label:'Resource file', req:true,
         accept:'.zip,.rar,.7z,.psd,.abr,.brushset,.procreate,.clip,.ttf,.otf,.woff2,.pdf,.obj,.fbx,.blend',
         hint:'ZIP, PSD, ABR, brushset, fonts, 3D — up to 200MB.'},
        {k:'preview',t:'image', label:'Preview image', req:true, accept:'image/jpeg,image/png,image/webp,image/gif', hint:'Required. Shown on the card and auto-checked. JPG/PNG/WEBP up to 25MB.'},
        {k:'title',  t:'text',  label:'Title', req:true, max:120, ph:'Name your resource…'},
        {k:'description', t:'area', label:'Description', max:2000, ph:'What is it, and how is it used?'},
        {k:'category',t:'cat',  label:'Category', req:true},
        {k:'license', t:'sel',  label:'License', options:LICENSE_RES},
        {k:'software',t:'text', label:'Made with', max:60, ph:'Photoshop, Procreate…'},
        {k:'tags',    t:'tags', label:'Tags'}
      ]},
    blog: { title:'Write a Post', sub:'Stories, tips and studio notes for the community.',
      fields:[
        {k:'cover', t:'image', label:'Cover image', hint:'Optional. JPG/PNG/WEBP up to 25MB.'},
        {k:'title', t:'text',  label:'Title', req:true, max:160, ph:'Give the post a headline…'},
        {k:'excerpt',t:'area', label:'Excerpt', max:300, ph:'One or two lines shown in the list.'},
        {k:'body',  t:'area',  label:'Post', req:true, max:20000, rows:12, ph:'Write your post… (minimum 40 characters)'},
        {k:'category',t:'cat', label:'Category', req:true},
        {k:'tags',  t:'tags',  label:'Tags'}
      ]},
    marketplace: { title:'List a Product', sub:'Sell digital goods, or offer commissions and services.',
      fields:[
        {k:'item_type',t:'sel', label:'Listing type',
         options:[['digital','Digital download'],['commission','Commission slot'],['service','Service']]},
        {k:'file',   t:'file',  label:'Product file',
         accept:'.zip,.rar,.7z,.psd,.abr,.brushset,.procreate,.clip,.ttf,.otf,.pdf,.obj,.fbx,.blend',
         hint:'Required for a digital download. Up to 200MB.'},
        {k:'preview',t:'image', label:'Preview image', req:true, accept:'image/jpeg,image/png,image/webp,image/gif', hint:'Required. Shown on the card and auto-checked. JPG/PNG/WEBP up to 25MB.'},
        {k:'title',  t:'text',  label:'Title', req:true, max:140, ph:'Name your listing…'},
        {k:'description',t:'area', label:'Description', max:3000, ph:'What the buyer receives…'},
        {k:'category',t:'cat',  label:'Category', req:true},
        {k:'price',  t:'num',   label:'Price', ph:'0.00', step:'0.01', hint:'Leave 0 to list it free.'},
        {k:'currency',t:'sel',  label:'Currency', options:[['USD','USD'],['EUR','EUR'],['GBP','GBP'],['INR','INR'],['JPY','JPY']]},
        {k:'license',t:'sel',   label:'License', options:LICENSE_MKT},
        {k:'delivery_days',t:'num', label:'Delivery (days)', ph:'e.g. 7', hint:'For commissions and services.'},
        {k:'tags',   t:'tags',  label:'Tags'}
      ]},
    jobs: { title:'Post a Job', sub:'Hire an artist, or find someone to build with.',
      fields:[
        {k:'title',  t:'text', label:'Job title', req:true, max:140, ph:'e.g. Character Concept Artist'},
        {k:'company',t:'text', label:'Company / studio', req:true, max:100, ph:'Who is hiring?'},
        {k:'company_url',t:'text', label:'Company website', ph:'https://…'},
        {k:'description',t:'area', label:'Description', req:true, max:8000, rows:10,
         ph:'Responsibilities, requirements, skills, hours… (minimum 80 characters)'},
        {k:'category',t:'cat', label:'Category', req:true},
        {k:'employment_type',t:'sel', label:'Employment type', options:EMP},
        {k:'is_remote',t:'chk', label:'This role is 100% remote'},
        {k:'location_city',t:'text', label:'City', ph:'e.g. Berlin'},
        {k:'location_country',t:'text', label:'Country code', max:2, ph:'e.g. DE',
         hint:'Two letters. Required unless the role is fully remote.'},
        {k:'applicant_countries',t:'text', label:'Remote — eligible countries', ph:'e.g. IN, DE, US',
         hint:'Comma separated. Required for a remote role.'},
        {k:'salary_min',t:'num', label:'Pay from', ph:'0', step:'0.01'},
        {k:'salary_max',t:'num', label:'Pay to', ph:'0', step:'0.01'},
        {k:'salary_currency',t:'sel', label:'Currency', options:[['USD','USD'],['EUR','EUR'],['GBP','GBP'],['INR','INR'],['JPY','JPY']]},
        {k:'salary_unit',t:'sel', label:'Per', options:[['','—'],['HOUR','Hour'],['DAY','Day'],['WEEK','Week'],['MONTH','Month'],['YEAR','Year']]},
        {k:'apply_url',t:'text', label:'Apply link', ph:'https://…'},
        {k:'apply_email',t:'text', label:'Apply email', ph:'jobs@studio.com',
         hint:'A link or an email is required — a posting with no way to apply is rejected.'},
        {k:'valid_through',t:'date', label:'Closes on', hint:'Expired postings are hidden automatically.'},
        {k:'tags',  t:'tags', label:'Tags'}
      ]}
  };

  // per section scratch state
  var S = {};
  function st(sec){
    var s = (S[sec] = S[sec] || {tags:[], files:{}, urls:{}});
    if(!s.urls) s.urls = {};
    return s;
  }

  var ORDER = ['artwork','resources','blog','marketplace','jobs'];
  var TAB_LABEL = {artwork:'Artwork', resources:'Resources', blog:'Blog', marketplace:'Marketplace', jobs:'Jobs'};
  var TAB_ICO   = {artwork:'artworks', resources:'resources', blog:'blog', marketplace:'marketplace', jobs:'jobs'};
  var upSec = 'artwork';

  // one icon per section
  var SEC_SVG = {
    artworks:    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
    resources:   '<path d="M12 7c-1.8-1.3-4-2-6.5-2H3v13h2.5c2.5 0 4.7.7 6.5 2 1.8-1.3 4-2 6.5-2H21V5h-2.5C16 5 13.8 5.7 12 7z"/><path d="M12 7v13"/>',
    blog:        '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    marketplace: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    jobs:        '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'
  };
  function secIco(sec, cls){
    var k = TAB_ICO[sec] || 'artworks';
    return '<span class="fgSecIco fgSecIco--'+k+(cls ? ' '+cls : '')+'" aria-hidden="true">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" '+
      'stroke-linejoin="round">'+SEC_SVG[k]+'</svg></span>';
  }

  function buildTabs(){
    var host = document.getElementById('upSecTabs');
    if(!host || host.childNodes.length) return;
    host.innerHTML = ORDER.map(function(s){
      var ico = secIco(s);
      return '<button class="upSecBtn'+(s==='artwork'?' active':'')+'" id="upSecBtn-'+s+
        '" role="tab" aria-selected="'+(s==='artwork')+'" onclick="upSwitchSection(\''+s+'\')">'+
        ico+'<span>'+TAB_LABEL[s]+'</span></button>';
    }).join('');
  }

  function upSwitchSection(sec, silent){
    buildTabs();               // idempotent
    upSec = sec;
    var btns = document.querySelectorAll('#upSecTabs .upSecBtn');
    for(var i=0;i<btns.length;i++){
      var on = btns[i].id === 'upSecBtn-'+sec;
      btns[i].classList.toggle('active', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var art = document.querySelector('#uploadPage .upPopBody') || document.querySelector('.upPopBody');
    var box = document.getElementById('upSecForms');
    var h   = document.getElementById('pfUpTitle');
    var p   = document.getElementById('pfUpSubtitle');
    if(sec === 'artwork'){
      if(art) art.style.display = '';
      if(box){ box.style.display = 'none'; }
      // restore the visible panel
      if(!silent){
        if(h) h.textContent = 'Upload Artwork';
        if(p) p.textContent = 'Share your creativity with artists around the world.';
      }
      return;
    }
    if(art) art.style.display = 'none';
    if(box){ box.style.display = ''; box.innerHTML = buildForm(sec); }
    if(h) h.textContent = FORMS[sec].title;
    if(p) p.textContent = FORMS[sec].sub;
    renderTags(sec);
    dzPaintFiles(sec);
    dzSchReset();
    dzDraftStrip(sec);
    dzSchedStrip(sec);
  }

  // guide and tips copy
  var GUIDE = {
    resources: {
      guide: [
        ['📦','Package it cleanly','ZIP related files together and name folders clearly.'],
        ['🖼','Show a real preview','The preview must depict the actual asset — no AI art.'],
        ['🔖','Pick the right license','Be explicit about commercial vs personal use.'],
        ['🛡','Yours to share','Only upload files you made or are licensed to distribute.']
      ],
      tips: ['Use a descriptive, searchable title','Show the asset in use in the preview','Tag the software and file type','Add a short how-to in the description']
    },
    blog: {
      guide: [
        ['✍️','Write for artists','Studio notes, tutorials and stories land best.'],
        ['🖼','Add a cover','A strong cover image lifts clicks in the feed.'],
        ['📏','Give it length','Posts need at least 40 characters — aim for a real read.'],
        ['🛡','Keep it appropriate','No hateful, explicit or plagiarised content.']
      ],
      tips: ['Open with a hook in the first line','Break long posts into short paragraphs','Write an excerpt so the list reads well','Pick one clear category']
    },
    marketplace: {
      guide: [
        ['💾','Digital needs a file','A digital download must include the product file.'],
        ['🖼','Preview sells','Show exactly what the buyer receives.'],
        ['💲','Price fairly','Set 0 to list free; be clear on delivery time.'],
        ['🛡','Deliver what you list','Misleading listings are removed.']
      ],
      tips: ['Lead with your strongest preview','Spell out what is included','State delivery days for commissions','Choose an accurate listing type']
    },
    jobs: {
      guide: [
        ['🧭','Be specific','A real title, scope and skill list draws better applicants.'],
        ['📍','Location or remote','Add a country code, or list eligible countries.'],
        ['🔗','A way to apply','Include an apply link or email — it is required.'],
        ['🛡','Genuine roles only','No spam, MLM or pay-to-apply postings.']
      ],
      tips: ['Put must-have skills up top','Add a pay range to raise replies','Describe the team and workflow','Set a close date so it expires cleanly']
    }
  };

  // ghost slots
  function dzGhostCard(){
    return '<div class="upDraftCard upDraftGhost" aria-hidden="true">'+
      '<span class="upDraftGhostIn">✦</span>'+
      '<span class="upDraftExp">7d</span></div>';
  }
  function dzSchedGhostCard(){
    return '<div class="upDraftCard upDraftGhost" aria-hidden="true">'+
      '<span class="upDraftGhostIn">⏱</span>'+
      '<span class="upDraftExp upSchedMark">--</span></div>';
  }
  function dzGhost4(){ return dzGhostCard()+dzGhostCard()+dzGhostCard()+dzGhostCard(); }
  function dzSchedGhost4(){ return dzSchedGhostCard()+dzSchedGhostCard()+dzSchedGhostCard()+dzSchedGhostCard(); }

  // schedule picker markup
  function dzSchedField(){
    return ''+
    '<div class="upField" id="dzSchedField">'+
      '<label class="upLbl">Schedule <span class="upOpt">optional</span></label>'+
      '<div class="upCatDd" id="dzSchedDd">'+
        '<button type="button" class="upCatTrigger" id="dzSchedTrigger" onclick="dzSchToggle(event)">'+
          '<span id="dzSchedLbl" class="upSchedPh">__/__/____&nbsp;&nbsp;__:__</span><span class="upChev">⌄</span>'+
        '</button>'+
        '<input type="hidden" id="dzSchedVal" value=""/>'+
        '<div class="upCatPanel upSchedPanel" id="dzSchedPanel">'+
          '<div class="upSchedNav">'+
            '<button type="button" class="upSchedNavBtn" onclick="dzSchNav(-1,event)" aria-label="Previous month">‹</button>'+
            '<span id="dzSchedMon">—</span>'+
            '<button type="button" class="upSchedNavBtn" onclick="dzSchNav(1,event)" aria-label="Next month">›</button>'+
          '</div>'+
          '<div class="upSchedDows"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>'+
          '<div class="upSchedGrid" id="dzSchedGrid"></div>'+
          '<div class="upSchedTime"><span class="upSchedTimeLbl">Time</span>'+
            '<select class="upSchedSel" id="dzSchedH" onchange="dzSchApply()" aria-label="Hour"></select>'+
            '<span class="upSchedColon">:</span>'+
            '<select class="upSchedSel" id="dzSchedM" onchange="dzSchApply()" aria-label="Minute"></select>'+
          '</div>'+
          '<div class="upSchedActs">'+
            '<button type="button" class="upBtnSec" onclick="dzSchClear(event)">Clear</button>'+
            '<button type="button" class="upBtnPri" onclick="dzSchDone(event)">Done</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="upSchedHint" id="dzSchedHint">Leave empty to publish immediately.</div>'+
    '</div>';
  }

  function buildForm(sec){
    var f = FORMS[sec];
    var fields = f.fields.map(function(fd){ return field(sec, fd); }).join('');
    var g = GUIDE[sec] || {guide:[], tips:[]};
    var guideLis = g.guide.map(function(x){
      return '<li><span class="upGIco">'+x[0]+'</span><div><strong>'+esc(x[1])+'</strong>'+esc(x[2])+'</div></li>';
    }).join('');
    var tipLis = g.tips.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('');

    return ''+
    '<div class="dzUpWrap">'+
      '<div class="dzUpForm"><div class="upMain">'+
        fields +
        dzSchedField() +
        // save draft before publish
        '<div class="upActions">'+
          '<button type="button" class="upBtnSec" id="dzDraftBtn-'+sec+'" onclick="dzSaveDraft(\''+sec+'\')">💾 Save Draft</button>'+
          '<button type="button" class="upBtnPri" id="dzSubmit-'+sec+'" onclick="dzSubmit(\''+sec+'\')">Publish</button>'+
        '</div>'+
        '<p class="dzHint" style="margin-top:.9rem">Posts are reviewed before they appear publicly.</p>'+
      '</div></div>'+
      // same sidebar as artwork page
      '<aside class="dzUpSide">'+
        '<div class="upSideCard">'+
          '<div class="upDraftTitle">SCHEDULED</div>'+
          '<p class="upDraftNote">Publishes automatically at the set time</p>'+
          '<div class="upDraftRow" id="dzSchedRow-'+sec+'">'+dzSchedGhost4()+'</div>'+
        '</div>'+
        '<div class="upSideCard">'+
          '<div class="upDraftTitle">SAVED DRAFTS</div>'+
          '<p class="upDraftNote">Saved on this device · auto-deleted after 7 days</p>'+
          '<div class="upDraftRow" id="dzDraftRow-'+sec+'">'+dzGhost4()+'</div>'+
        '</div>'+
        '<div class="upSideCard"><h3>Upload Guidelines</h3><ul class="upGuideList">'+guideLis+'</ul></div>'+
        '<div class="upSideCard"><h3>Tips for better visibility</h3><ul class="upTipList">'+tipLis+'</ul></div>'+
      '</aside>'+
    '</div>';
  }

  function field(sec, fd){
    var id = 'dz_'+sec+'_'+fd.k;
    var lbl = '<label class="upLbl" for="'+id+'">'+esc(fd.label)+
      (fd.req ? ' <span class="upReq">*</span>' : '')+'</label>';
    var hint = fd.hint ? '<div class="dzHint">'+esc(fd.hint)+'</div>' : '';
    var body = '';

    if(fd.t === 'text'){
      body = '<input class="upIn" id="'+id+'" type="text" maxlength="'+(fd.max||200)+
             '" placeholder="'+esc(fd.ph||'')+'">';
    } else if(fd.t === 'num'){
      body = '<input class="upIn" id="'+id+'" type="number" min="0" step="'+(fd.step||'1')+
             '" placeholder="'+esc(fd.ph||'')+'">';
    } else if(fd.t === 'date'){
      body = '<input class="upIn" id="'+id+'" type="date">';
    } else if(fd.t === 'area'){
      body = '<textarea class="upIn" id="'+id+'" rows="'+(fd.rows||4)+'" maxlength="'+(fd.max||2000)+
             '" placeholder="'+esc(fd.ph||'')+'"></textarea>';
    } else if(fd.t === 'sel'){
      body = '<select class="dzSel" id="'+id+'">'+ (fd.options||[]).map(function(o){
        return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>'; }).join('') +'</select>';
    } else if(fd.t === 'chk'){
      return '<div class="upField"><label class="upCatOpt" style="padding:.5rem 0">'+
             '<input type="checkbox" id="'+id+'"> '+esc(fd.label)+'</label>'+hint+'</div>';
    } else if(fd.t === 'cat'){
      var opts = (window.FG_SECTIONS && FG_SECTIONS[sec] && FG_SECTIONS[sec].opts) || [];
      body = '<select class="dzSel" id="'+id+'">'+ opts.map(function(o){
        return '<option value="'+esc(slugify(o))+'">'+esc(o)+'</option>'; }).join('') +'</select>';
    } else if(fd.t === 'tags'){
      return '<div class="upField">'+lbl+
        '<div class="upTagBox" onclick="document.getElementById(\''+id+'\').focus()">'+
        '<span id="dzTags-'+sec+'"></span>'+
        '<input class="upTagInput" id="'+id+'" maxlength="20" placeholder="Add up to 10 tags…" '+
        'onkeydown="dzTagKey(event,\''+sec+'\')"></div>'+hint+'</div>';
    } else if(fd.t === 'file' || fd.t === 'image'){
      // dropzone instead of file input
      var acc   = fd.accept ? fd.accept : (fd.t === 'image' ? 'image/*' : '');
      var isImg = fd.t === 'image';
      var args  = '\''+sec+'\',\''+fd.k+'\'';
      return '<div class="upField dzFileField">'+lbl+
        '<div class="dzFileZone" id="'+id+'_z"'+
          ' ondragenter="dzDragOn(event,\''+id+'\')" ondragover="dzDragOn(event,\''+id+'\')"'+
          ' ondragleave="dzDragOff(event,\''+id+'\')" ondrop="dzDropFile(event,'+args+')">'+
          '<input class="dzFileIn" id="'+id+'" type="file" accept="'+esc(acc)+'"'+
            ' aria-label="'+esc(fd.label)+'"'+
            ' onclick="if(typeof pfGuestGate===\'function\'&&pfGuestGate(event))return;"'+
            ' onchange="dzPick('+args+',this)">'+
          '<div class="dzFileEmpty">'+
            secIco(sec, 'dzFileIco')+
            '<div class="dzFileCopy">'+
              '<div class="dzFileTitle">Drag &amp; drop your '+(isImg ? 'image' : 'file')+' here</div>'+
              '<div class="dzFileSub">or browse from your device</div>'+
            '</div>'+
            '<span class="dzFileBtn">'+(isImg ? 'Select image' : 'Select file')+'</span>'+
            '<div class="dzFileTypes">'+esc(acceptLabel(acc, isImg))+'</div>'+
          '</div>'+
          '<div class="dzFilePicked" id="'+id+'_pk"></div>'+
        '</div>'+hint+'</div>';
    }
    return '<div class="upField">'+lbl+body+hint+'</div>';
  }

  // tags
  function renderTags(sec){
    var host = document.getElementById('dzTags-'+sec);
    if(!host) return;
    host.innerHTML = st(sec).tags.map(function(t,i){
      return '<span class="upTagChip">'+esc(t)+
        '<button type="button" onclick="dzTagDel(\''+sec+'\','+i+')" aria-label="Remove tag">✕</button></span>';
    }).join('');
  }
  function dzTagKey(e, sec){
    var el = e.target;
    if(e.key === 'Enter' || e.key === ','){
      e.preventDefault();
      var v = String(el.value||'').trim().toLowerCase().replace(/^#/,'');
      var s = st(sec);
      if(v && s.tags.length < 10 && s.tags.indexOf(v) === -1){ s.tags.push(v); renderTags(sec); }
      el.value = '';
    } else if(e.key === 'Backspace' && !el.value && st(sec).tags.length){
      st(sec).tags.pop(); renderTags(sec);
    }
  }
  function dzTagDel(sec, i){ st(sec).tags.splice(i,1); renderTags(sec); }

  // file picking
  // accept list to a readable line
  function acceptLabel(acc, isImg){
    var parts = String(acc||'').split(',').map(function(p){ return p.trim(); }).filter(Boolean);
    var out = [], seen = {};
    parts.forEach(function(p){
      if(p === 'image/*'){ ['JPG','PNG','WEBP','GIF'].forEach(function(x){ if(!seen[x]){ seen[x]=1; out.push(x); } }); return; }
      var x = p.replace(/^\./,'').replace(/^image\//,'').toUpperCase();
      if(x === 'JPEG') x = 'JPG';
      if(x && !seen[x]){ seen[x] = 1; out.push(x); }
    });
    if(!out.length) return isImg ? 'JPG · PNG · WEBP · GIF' : 'Any file type';
    if(out.length > 7) return out.slice(0,7).join(' · ') + ' and more';
    return out.join(' · ');
  }

  function ext(name){
    var m = /\.([a-z0-9]{1,8})$/i.exec(String(name||''));
    return m ? m[1].toUpperCase() : 'FILE';
  }

  // paint the picked state
  function dzRenderFile(sec, key){
    var id  = 'dz_'+sec+'_'+key,
        z   = document.getElementById(id+'_z'),
        box = document.getElementById(id+'_pk'),
        s   = st(sec), f = s.files[key];
    if(!z || !box) return;
    if(!f){
      z.classList.remove('dzHasFile');
      box.innerHTML = '';
      return;
    }
    var url = s.urls[key];
    var thumb = (url && /^image\//.test(f.type||''))
      ? '<span class="dzFileThumb"><img src="'+url+'" alt=""></span>'
      : '<span class="dzFileThumb dzFileThumbExt">'+esc(ext(f.name))+'</span>';
    z.classList.add('dzHasFile');
    box.innerHTML =
      thumb+
      '<div class="dzFileMeta">'+
        '<div class="dzFileNm">'+esc(f.name)+'</div>'+
        '<div class="dzFileSz">'+esc(bytes(f.size) || '—')+' · Ready to publish</div>'+
      '</div>'+
      '<div class="dzFileActs">'+
        '<button type="button" class="dzFileAct" onclick="dzFileReplace(event,\''+sec+'\',\''+key+'\')">Replace</button>'+
        '<button type="button" class="dzFileAct dzFileActRm" onclick="dzFileClear(event,\''+sec+'\',\''+key+'\')">Remove</button>'+
      '</div>';
  }

  // swap the held file
  function dzSetFile(sec, key, f){
    var s = st(sec);
    if(s.urls[key]){ try{ URL.revokeObjectURL(s.urls[key]); }catch(e){} s.urls[key] = null; }
    s.files[key] = f || null;
    if(f && /^image\//.test(f.type||'')){
      try{ s.urls[key] = URL.createObjectURL(f); }catch(e){ s.urls[key] = null; }
    }
    dzRenderFile(sec, key);
  }

  function dzPick(sec, key, input){
    if(typeof pfGuestGate === 'function' && pfGuestGate({preventDefault:function(){},stopPropagation:function(){}})) return;
    dzSetFile(sec, key, input.files && input.files[0]);
  }

  function dzFileReplace(e, sec, key){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    var el = document.getElementById('dz_'+sec+'_'+key);
    if(el) el.click();
  }

  function dzFileClear(e, sec, key){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    var el = document.getElementById('dz_'+sec+'_'+key);
    if(el) el.value = '';
    dzSetFile(sec, key, null);
  }

  // drag and drop
  function dzDragOn(e, id){
    if(e) e.preventDefault();
    var z = document.getElementById(id+'_z');
    if(z) z.classList.add('over');
  }
  function dzDragOff(e, id){
    if(e) e.preventDefault();
    var z = document.getElementById(id+'_z');
    if(z) z.classList.remove('over');
  }
  function dzDropFile(e, sec, key){
    if(e) e.preventDefault();
    dzDragOff(e, 'dz_'+sec+'_'+key);
    if(typeof pfGuestGate === 'function' && pfGuestGate({preventDefault:function(){},stopPropagation:function(){}})) return;
    var f = e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(!f) return;
    // image fields take images only
    var el = document.getElementById('dz_'+sec+'_'+key);
    var acc = el ? String(el.getAttribute('accept')||'') : '';
    if(acc.indexOf('image/') === 0 && !/^image\//.test(f.type||'')){
      showToast('That field takes an image');
      return;
    }
    dzSetFile(sec, key, f);
  }

  function val(sec, k){
    var el = document.getElementById('dz_'+sec+'_'+k);
    if(!el) return '';
    if(el.type === 'checkbox') return el.checked;
    return String(el.value||'').trim();
  }

  // repaint file fields
  function dzPaintFiles(sec){
    (FORMS[sec] ? FORMS[sec].fields : []).forEach(function(fd){
      if(fd.t === 'file' || fd.t === 'image') dzRenderFile(sec, fd.k);
    });
  }

  function dzResetForm(sec){
    var old = S[sec];
    if(old && old.urls) Object.keys(old.urls).forEach(function(k){
      if(old.urls[k]){ try{ URL.revokeObjectURL(old.urls[k]); }catch(e){} }
    });
    S[sec] = {tags:[], files:{}, urls:{}};
    var box = document.getElementById('upSecForms');
    if(box) box.innerHTML = buildForm(sec);
    renderTags(sec);
    dzSchReset();
    dzDraftStrip(sec);
    dzSchedStrip(sec);
  }

  // schedule and drafts
  var DZ_SCH_MIN = 5 * 60 * 1000;   // five minute lead
  var dzSch = { y:null, m:null, d:null, vy:null, vm:null };

  function dzSchPad(n){ return (n<10?'0':'')+n; }
  function dzSchToggle(e){
    if(e) e.stopPropagation();
    var dd = document.getElementById('dzSchedDd'); if(!dd) return;
    var open = dd.classList.toggle('open');
    if(open){
      if(dzSch.vy===null){ var n=new Date(); dzSch.vy=n.getFullYear(); dzSch.vm=n.getMonth(); }
      dzSchBuildTime(); dzSchRender();
    }
  }
  function dzSchClose(){ var dd=document.getElementById('dzSchedDd'); if(dd) dd.classList.remove('open'); }
  document.addEventListener('click', function(ev){
    var dd = document.getElementById('dzSchedDd');
    if(dd && dd.classList.contains('open') && !dd.contains(ev.target)) dzSchClose();
  });
  function dzSchBuildTime(){
    var hs=document.getElementById('dzSchedH'), ms=document.getElementById('dzSchedM');
    if(!hs || hs.options.length) return;
    var i,o;
    for(i=0;i<24;i++){ o=document.createElement('option'); o.value=i; o.textContent=dzSchPad(i); hs.appendChild(o); }
    for(i=0;i<60;i+=5){ o=document.createElement('option'); o.value=i; o.textContent=dzSchPad(i); ms.appendChild(o); }
    var t=new Date(Date.now()+60*60*1000);
    hs.value=t.getHours(); ms.value=Math.floor(t.getMinutes()/5)*5;
  }
  function dzSchNav(delta,e){
    if(e) e.stopPropagation();
    dzSch.vm += delta;
    if(dzSch.vm<0){ dzSch.vm=11; dzSch.vy--; } else if(dzSch.vm>11){ dzSch.vm=0; dzSch.vy++; }
    dzSchRender();
  }
  function dzSchRender(){
    var grid=document.getElementById('dzSchedGrid'), mon=document.getElementById('dzSchedMon');
    if(!grid) return;
    var y=dzSch.vy, m=dzSch.vm;
    mon.textContent=new Date(y,m,1).toLocaleString([], {month:'long', year:'numeric'});
    var first=new Date(y,m,1).getDay(), days=new Date(y,m+1,0).getDate(), now=new Date();
    var todayKey=now.getFullYear()+'-'+now.getMonth()+'-'+now.getDate(), html='';
    for(var p=0;p<first;p++) html+='<span class="upSchedDay pad"></span>';
    for(var d=1; d<=days; d++){
      var end=new Date(y,m,d,23,59,59), past=end.getTime()<Date.now(), cls='upSchedDay';
      if(todayKey===y+'-'+m+'-'+d) cls+=' today';
      if(dzSch.y===y && dzSch.m===m && dzSch.d===d) cls+=' sel';
      html+='<button type="button" class="'+cls+'"'+(past?' disabled':'')+' onclick="dzSchPick('+y+','+m+','+d+',event)">'+d+'</button>';
    }
    grid.innerHTML=html;
  }
  function dzSchPick(y,m,d,e){ if(e) e.stopPropagation(); dzSch.y=y; dzSch.m=m; dzSch.d=d; dzSchRender(); dzSchApply(); }
  function dzSchApply(){
    if(dzSch.y===null) return;
    var hs=document.getElementById('dzSchedH'), ms=document.getElementById('dzSchedM');
    var h=+hs.value||0, mi=+ms.value||0;
    var el=document.getElementById('dzSchedVal');
    if(el) el.value=dzSch.y+'-'+dzSchPad(dzSch.m+1)+'-'+dzSchPad(dzSch.d)+'T'+dzSchPad(h)+':'+dzSchPad(mi);
    dzSchHint();
  }
  function dzSchClear(e){
    if(e) e.stopPropagation();
    dzSch.y=dzSch.m=dzSch.d=null;
    var el=document.getElementById('dzSchedVal'); if(el) el.value='';
    dzSchRender(); dzSchHint(); dzSchClose();
  }
  function dzSchDone(e){ if(e) e.stopPropagation(); dzSchClose(); }
  function dzSchReset(){
    dzSch.y=dzSch.m=dzSch.d=null;
    var n=new Date(); dzSch.vy=n.getFullYear(); dzSch.vm=n.getMonth();
    var el=document.getElementById('dzSchedVal'); if(el) el.value='';
    dzSchClose(); dzSchHint();
  }
  function dzFmtWhen(iso){
    var dt=new Date(iso);
    return dt.toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
  }
  function dzSchHint(){
    var el=document.getElementById('dzSchedVal'), hint=document.getElementById('dzSchedHint'), lbl=document.getElementById('dzSchedLbl');
    if(!el||!hint) return;
    if(lbl){
      if(el.value){ lbl.textContent=dzFmtWhen(el.value); lbl.classList.remove('upSchedPh'); }
      else { lbl.innerHTML='__/__/____&nbsp;&nbsp;__:__'; lbl.classList.add('upSchedPh'); }
    }
    if(!el.value){ hint.textContent='Leave empty to publish immediately.'; hint.classList.remove('bad'); return; }
    var t=new Date(el.value).getTime();
    if(!isFinite(t) || t < Date.now()+DZ_SCH_MIN){ hint.textContent='Pick a time at least 5 minutes from now.'; hint.classList.add('bad'); }
    else { hint.textContent='Publishes '+dzFmtWhen(el.value)+' · verified now, published at the set time.'; hint.classList.remove('bad'); }
  }
  // empty means publish now
  function dzSchPicked(){
    var el=document.getElementById('dzSchedVal');
    if(!el||!el.value) return '';
    var t=new Date(el.value).getTime();
    if(!isFinite(t) || t < Date.now()+DZ_SCH_MIN) return '';
    return el.value;
  }

  // local draft store
  function dzdbOpen(){
    return new Promise(function(res,rej){
      if(!window.indexedDB){ rej(new Error('no idb')); return; }
      var q=indexedDB.open('dzsecdrafts',1);
      q.onupgradeneeded=function(){ if(!q.result.objectStoreNames.contains('d')) q.result.createObjectStore('d',{keyPath:'id'}); };
      q.onsuccess=function(){ res(q.result); };
      q.onerror=function(){ rej(q.error); };
    });
  }
  function dzdbReq(mode, run){
    return dzdbOpen().then(function(db){
      return new Promise(function(res,rej){
        var tx=db.transaction('d',mode), stx=tx.objectStore('d'), rq=run(stx);
        tx.oncomplete=function(){ res(rq?rq.result:undefined); };
        tx.onerror=function(){ rej(tx.error); };
      });
    });
  }
  function dzdbAll(){ return dzdbReq('readonly', function(s){ return s.getAll(); }); }
  function dzdbGet(id){ return dzdbReq('readonly', function(s){ return s.get(id); }); }
  function dzdbPut(rec){ return dzdbReq('readwrite', function(s){ return s.put(rec); }); }
  function dzdbDel(id){ return dzdbReq('readwrite', function(s){ s.delete(id); return null; }); }

  function dzSaveDraft(sec){
    var s=st(sec), data={};
    FORMS[sec].fields.forEach(function(fd){
      if(fd.t==='tags'){ data.__tags=(s.tags||[]).slice(); return; }
      if(fd.t==='file'||fd.t==='image') return;   // blobs not persisted
      var el=document.getElementById('dz_'+sec+'_'+fd.k);
      if(!el) return;
      data[fd.k]= el.type==='checkbox' ? el.checked : el.value;
    });
    var when=dzSchPicked(); if(when) data.__sched=when;
    var title=String(data.title||'').trim();
    if(!title && !String(data.description||data.body||'').trim()){ showToast('Nothing to save yet'); return; }
    var rec={ id:'d_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
              sec:sec, title:title, data:data, savedAt:Date.now() };
    dzdbPut(rec).then(function(){ showToast('Draft saved'); dzDraftStrip(sec); })
                .catch(function(){ showToast('Could not save draft on this device'); });
  }
  function dzDeleteDraft(id){ dzdbDel(id).then(function(){ dzDraftStrip(upSec); }); }
  function dzResumeDraft(id){
    dzdbGet(id).then(function(d){
      if(!d) return;
      upSwitchSection(d.sec);
      setTimeout(function(){
        var s=st(d.sec); s.tags=(d.data.__tags||[]).slice();
        FORMS[d.sec].fields.forEach(function(fd){
          if(fd.t==='tags'||fd.t==='file'||fd.t==='image') return;
          if(!(fd.k in d.data)) return;
          var el=document.getElementById('dz_'+d.sec+'_'+fd.k);
          if(!el) return;
          if(el.type==='checkbox') el.checked=!!d.data[fd.k]; else el.value=d.data[fd.k];
        });
        renderTags(d.sec);
        showToast('Draft loaded — re-attach any files, then publish');
      }, 60);
    });
  }

  function dzExcerpt(data){
    var v=data.description||data.body||data.excerpt||data.company||'';
    return String(v).replace(/\s+/g,' ').trim().slice(0,120);
  }
  function dzWhenAgo(ts){
    var s=Math.floor((Date.now()-ts)/1000);
    if(s<60) return 'just now';
    var m=Math.floor(s/60); if(m<60) return m+'m ago';
    var h=Math.floor(m/60); if(h<24) return h+'h ago';
    return Math.floor(h/24)+'d ago';
  }
  // days before auto delete
  function dzDaysLeft(savedAt){
    return Math.max(1, Math.ceil((savedAt + 7*864e5 - Date.now())/864e5));
  }
  // countdown for corner mark
  function dzMark(iso){
    var t=new Date(iso).getTime()-Date.now();
    if(t<=0) return 'now';
    var m=Math.round(t/60000); if(m<60) return m+'m';
    var h=Math.round(m/60);    if(h<24) return h+'h';
    return Math.round(h/24)+'d';
  }
  // tile shell, text fills the square
  function dzDraftCard(d){
    var ex=dzExcerpt(d.data||{});
    var sched=d.data && d.data.__sched;
    var title=d.title||'Untitled';
    return '<div class="upDraftCard dzPCard" onclick="dzResumeDraft(\''+d.id+'\')" role="button" tabindex="0" '+
        'title="'+esc(title)+'" aria-label="Resume draft: '+esc(title)+'">'+
      '<button type="button" class="upDraftX" onclick="event.stopPropagation();dzDeleteDraft(\''+d.id+'\')" aria-label="Delete draft">✕</button>'+
      '<span class="upDraftExp">'+dzDaysLeft(d.savedAt)+'d</span>'+
      '<div class="dzPIn">'+
        '<div class="dzPTitle">'+esc(title)+'</div>'+
        (ex ? '<div class="dzPExc">'+esc(ex)+'</div>' : '')+
        '<div class="dzPMeta"><span class="dzPKind">'+esc(SEC[d.sec]?SEC[d.sec].noun:d.sec)+'</span>'+
          '<span>'+(sched ? '⏱ '+esc(dzFmtWhen(sched)) : dzWhenAgo(d.savedAt))+'</span></div>'+
      '</div>'+
    '</div>';
  }
  function dzSchedCard(sec, r){
    var t=r.payload||{}, err=r.publish_error;
    var title=t.title||'Untitled';
    var tip=title+' · '+(err ? err : dzFmtWhen(r.publish_at));
    return '<div class="upDraftCard dzPCard dzPSched'+(err?' upSchedBad':'')+'" '+
        'title="'+esc(tip)+'" aria-label="'+(err?'Failed: ':'Scheduled: ')+esc(title)+'">'+
      '<button type="button" class="upDraftX" onclick="dzCancelSched(\''+r.id+'\',\''+sec+'\')" aria-label="'+(err?'Dismiss':'Cancel schedule')+'">✕</button>'+
      '<span class="upDraftExp'+(err?'':' upSchedMark')+'">'+(err?'!':dzMark(r.publish_at))+'</span>'+
      '<div class="dzPIn">'+
        '<div class="dzPTitle">'+esc(title)+'</div>'+
        '<div class="dzPMeta"><span class="dzPKind">'+esc(SEC[sec]?SEC[sec].noun:sec)+'</span>'+
          (err ? '<span class="dzPErr">'+esc(err)+'</span>'
               : '<span>'+esc(dzFmtWhen(r.publish_at))+'</span>')+'</div>'+
      '</div>'+
    '</div>';
  }
  function dzDraftStrip(sec){
    var row=document.getElementById('dzDraftRow-'+sec); if(!row) return;
    dzdbAll().then(function(all){
      all=(all||[]).filter(function(d){ return d.sec===sec; });
      var cutoff=Date.now()-7*864e5, keep=[];
      all.forEach(function(d){ if(d.savedAt<cutoff) dzdbDel(d.id); else keep.push(d); });
      keep.sort(function(a,b){ return b.savedAt-a.savedAt; });
      var html=keep.map(dzDraftCard).join('');
      for(var i=keep.length;i<4;i++) html+=dzGhostCard();
      row.innerHTML=html;
    }).catch(function(){ /* leave ghosts */ });
  }
  async function dzSchedStrip(sec){
    var row=document.getElementById('dzSchedRow-'+sec); if(!row) return;
    if(!sb || !window.currentUser){ row.innerHTML=dzSchedGhost4(); return; }
    try{
      var res=await sb.from('scheduled_sections')
        .select('id,payload,publish_at,publish_error')
        .eq('user_id', currentUser.id).eq('section', sec)
        .order('publish_at', {ascending:true});
      var rows=(res && res.data) || [];
      var html=rows.map(function(r){ return dzSchedCard(sec, r); }).join('');
      for(var i=rows.length;i<4;i++) html+=dzSchedGhostCard();
      row.innerHTML=html;
    }catch(e){ row.innerHTML=dzSchedGhost4(); }
  }
  async function dzCancelSched(id, sec){
    if(!sb) return;
    try{
      // clean up parked files
      var got=await sb.from('scheduled_sections').select('storage_paths').eq('id', id).single();
      var paths=(got && got.data && got.data.storage_paths) || [];
      await sb.from('scheduled_sections').delete().eq('id', id);
      if(Array.isArray(paths) && paths.length && typeof s3Delete==='function'){
        paths.forEach(function(p){ try{ s3Delete(BUCKET, p); }catch(e){} });
      }
      showToast('Schedule cancelled');
      dzSchedStrip(sec);
    }catch(e){ showToast('Could not cancel'); }
  }

  // submit
  // verification tracker
  var dzV = {
    title:'', safety:'', safetySub:'', transfer:'', publish:'', failReason:null,
    recvLabel:'File & preview received',
    reset:function(t){
      this.title=t||'Upload'; this.safety='run'; this.safetySub='';
      this.transfer=''; this.publish=''; this.publishSub=''; this.failReason=null;
    },
    open:function(t, recv){
      this.reset(t);
      this.recvLabel = recv || 'File & preview received';
      var bd=document.getElementById('upqBackdrop'); if(bd) bd.classList.add('open');
      this.render();
    },
    close:function(){
      if(typeof upqCloseModal==='function'){ upqCloseModal(); return; }
      var bd=document.getElementById('upqBackdrop'); if(bd) bd.classList.remove('open');
    },
    step:function(k,state,sub){ this[k]=state; if(sub!=null) this[k+'Sub']=sub; this.render(); },
    fail:function(reason){
      this.failReason=reason;
      var bd=document.getElementById('upqBackdrop'); if(bd) bd.classList.add('open');
      this.render();
    },
    render:function(){
      var t=document.getElementById('upqMTitle'), b=document.getElementById('upqMBody');
      if(!t||!b) return;
      var trk=(typeof upqTrackRow==='function') ? upqTrackRow
              : function(st,n,sub){ return '<div>'+esc(n)+'</div>'; };
      var failed=!!this.failReason, html='';
      t.textContent = failed ? 'VERIFICATION FAILED' : 'VERIFICATION STATUS';
      if(failed){
        html+='<div class="upqFailBox"><div class="upqFailIco">!</div>'+
          '<div><div class="upqFailTitle">\u201C'+esc(this.title||'Untitled')+'\u201D was not published</div>'+
          '<div class="upqFailReason">'+esc(this.failReason)+'</div></div></div>';
      }
      html+=trk('pass','Upload received','',false);
      html+=trk('pass', this.recvLabel || 'File & preview received', '', false);
      html+=trk(this.safety,'Content safety check',this.safetySub,false);
      html+=trk(this.transfer,'Secure transfer','',false);
      var pubSub = (this.publish==='pass') ? (this.publishSub || 'It\u2019s live') : '';
      var sched  = /^Scheduled/.test(this.publishSub || '');
      html+=trk(this.publish,'Publish', pubSub, true);
      if(failed){
        html+='<div class="upqFin fail">Verification stopped \u2014 nothing was published</div>';
        html+='<div class="upqFailNote">Any transferred file has been removed. Fix the issue above and publish again whenever you\u2019re ready.</div>';
      } else if(this.publish==='pass'){
        html+='<div class="upqFin ok">'+(sched ? 'All checks passed \u2014 '+esc(this.publishSub) : 'All checks passed \u2014 it\u2019s live')+'</div>';
      } else {
        html+='<div class="upqFin busy">Reviewing your upload now\u2026</div>';
      }
      b.innerHTML=html;
    }
  };

  async function dzSubmit(sec){
    if(!sb){ showToast('Backend not configured'); return; }
    if(!window.currentUser){
      if(typeof pfGuestGate === 'function') pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return;
    }
    var btn = document.getElementById('dzSubmit-'+sec);
    // rows insert as approved
    var s = st(sec), row = {user_id: currentUser.id, tags: s.tags, status:'approved'};

    // required fields from the spec
    var miss = FORMS[sec].fields.filter(function(fd){
      if(!fd.req) return false;
      if(fd.t === 'file' || fd.t === 'image') return !s.files[fd.k];
      return !val(sec, fd.k);
    });
    if(miss.length){ showToast('Missing: ' + miss[0].label); return; }

    if(btn){ btn.disabled = true; btn.textContent = 'Publishing…'; }
    // which sections get the image gate
    var modImg = null, modMode = null, modRecv = 'File & preview received';
    if(sec === 'resources'){   modImg = st(sec).files.preview; modMode = 'resource'; }
    else if(sec === 'marketplace'){ modImg = st(sec).files.preview; modMode = 'marketplace'; }
    else if(sec === 'blog'){   modImg = st(sec).files.cover;   modMode = 'artwork'; modRecv = 'Cover image received'; }
    var moderated = !!modImg;
    try{
      // image moderation
      if(moderated){
        dzV.open(val(sec,'title') || SEC[sec].noun, modRecv);

        // ai metadata scan first
        if(window.UploadVerifier && typeof UploadVerifier.scanAIMeta === 'function'){
          var aiHits = [];
          try{ aiHits = (await UploadVerifier.scanAIMeta(modImg)) || []; }catch(e){ aiHits = []; }
          if(aiHits.length){
            dzV.step('safety','fail','AI markers: ' + aiHits.slice(0,2).join(', '));
            throw new Error('The image looks AI-generated (' + aiHits.slice(0,2).join(', ') + ').' +
              (modMode === 'artwork'
                ? ' DigiArtz accepts original artwork only.'
                : ' DigiArtz resources need a real preview of the asset — a 3D render is fine, AI-generated art is not.'));
          }
        }

        // gemini image check
        var mFd = new FormData();
        mFd.append('files', modImg);
        mFd.append('mode', modMode);
        var mSess = (await sb.auth.getSession()).data.session;
        var mRes = await fetch('/api/moderate-upload', {
          method:'POST',
          headers:{ 'authorization':'Bearer ' + (mSess ? mSess.access_token : '') },
          body: mFd
        });
        var mod = await mRes.json().catch(function(){ return null; });
        if(!mRes.ok || !mod){
          dzV.step('safety','fail','Review service unavailable');
          throw new Error((mod && mod.error) || 'Content check failed — please try again.');
        }
        if(!mod.allowed){
          var devNote = (typeof isDev !== 'undefined' && isDev && mod.code) ? ('Code: ' + mod.code) : '';
          dzV.step('safety','fail', devNote);
          throw new Error(mod.reason || 'This upload did not pass the content check.');
        }
        dzV.step('safety','pass', mod.rating === 'MATURE' ? 'Approved · 18+' : 'Safe for all audiences');
        dzV.step('transfer','run');
      }

      var stamp = Date.now();
      var base  = safeSlug(val(sec,'title') || sec, 60) || sec;

      // s3 first, then the row
      async function put(key, prefix){
        var f = s.files[key]; if(!f) return null;
        var ext = safeSlug((f.name.split('.').pop()||'bin'), 10);
        var path = prefix+'/'+currentUser.id+'/'+stamp+'_'+base+'.'+ext;
        var url  = await s3Upload(BUCKET, path, f);
        return {url:url, path:path, name:f.name, ext:ext, size:f.size};
      }

      // media bookkeeping, queued here and flushed once the row exists, since
      // every one of these tables is keyed on the parent id
      var pendingMedia = [];

      if(sec === 'resources'){
        var rf = await put('file','resources'), rp = await put('preview','resources');
        row.title = val(sec,'title'); row.description = val(sec,'description');
        row.category = [val(sec,'category')]; row.license = val(sec,'license') || 'personal';
        row.software = val(sec,'software') || null;
        row.file_url = rf.url; row.file_storage_path = rf.path;
        row.file_name = rf.name; row.file_ext = rf.ext; row.file_size = rf.size;
        if(rp){ row.preview_url = rp.url; row.preview_storage_path = rp.path; }
        pendingMedia.push({ fileKind:'resourceFile', url:rf.url, path:rf.path, file:s.files.file });
        if(rp) pendingMedia.push({ imageKind:'resourceImage', url:rp.url, path:rp.path, file:s.files.preview });
      }

      else if(sec === 'blog'){
        var bc = await put('cover','blog');
        var body = val(sec,'body');
        if(body.length < 40){ throw new Error('The post needs at least 40 characters'); }
        row.title = val(sec,'title'); row.body = body;
        row.excerpt = val(sec,'excerpt') || body.slice(0,200);
        row.category = [val(sec,'category')];
        row.slug = slugify(val(sec,'title')).slice(0,80) + '-' + String(stamp).slice(-6);
        row.read_minutes = Math.max(1, Math.round(body.split(/\s+/).length / 200));
        if(bc){ row.cover_url = bc.url; row.cover_storage_path = bc.path; }
        if(bc) pendingMedia.push({ imageKind:'blogImage', url:bc.url, path:bc.path, file:s.files.cover });
      }

      else if(sec === 'marketplace'){
        var type = val(sec,'item_type') || 'digital';
        if(type === 'digital' && !s.files.file){ throw new Error('A digital download needs a file'); }
        var mf = await put('file','market'), mp = await put('preview','market');
        row.title = val(sec,'title'); row.description = val(sec,'description');
        row.category = [val(sec,'category')]; row.item_type = type;
        row.price_cents = Math.round(parseFloat(val(sec,'price')||'0') * 100) || 0;
        row.currency = val(sec,'currency') || 'USD';
        row.license = val(sec,'license') || 'standard';
        row.delivery_days = parseInt(val(sec,'delivery_days'),10) || null;
        if(mf){ row.file_url = mf.url; row.file_storage_path = mf.path;
                row.file_name = mf.name; row.file_ext = mf.ext; row.file_size = mf.size; }
        if(mp){ row.preview_url = mp.url; row.preview_storage_path = mp.path; }
        if(mf) pendingMedia.push({ fileKind:'marketFile', url:mf.url, path:mf.path, file:s.files.file });
        if(mp) pendingMedia.push({ imageKind:'marketImage', url:mp.url, path:mp.path, file:s.files.preview });
      }

      else if(sec === 'jobs'){
        var remote = val(sec,'is_remote') === true;
        var countries = val(sec,'applicant_countries')
          .split(',').map(function(x){ return x.trim().toUpperCase(); }).filter(Boolean);
        var cc = val(sec,'location_country').toUpperCase();
        var url = val(sec,'apply_url'), mail = val(sec,'apply_email');

        // mirror the table constraints
        if(!url && !mail) throw new Error('Add an apply link or an email');
        if(remote && !countries.length) throw new Error('A remote role needs at least one eligible country');
        if(!remote && cc.length !== 2) throw new Error('Add a two-letter country code');
        if(val(sec,'description').length < 80) throw new Error('The description needs at least 80 characters');

        row.title = val(sec,'title'); row.company = val(sec,'company');
        row.company_url = val(sec,'company_url') || null;
        row.description = val(sec,'description');
        row.category = [val(sec,'category')];
        row.employment_type = val(sec,'employment_type') || 'CONTRACTOR';
        row.is_remote = remote;
        row.location_city = val(sec,'location_city') || null;
        row.location_country = remote ? (cc.length === 2 ? cc : null) : cc;
        row.applicant_countries = countries;
        row.salary_min = parseFloat(val(sec,'salary_min')) || null;
        row.salary_max = parseFloat(val(sec,'salary_max')) || null;
        row.salary_currency = val(sec,'salary_currency') || 'USD';
        row.salary_unit = val(sec,'salary_unit') || null;
        row.apply_url = url || null; row.apply_email = mail || null;
        row.valid_through = val(sec,'valid_through') || null;
      }

      // schedule branch
      var when = dzSchPicked();
      if(when){
        if(moderated){ dzV.step('transfer','pass'); dzV.step('publish','run'); }
        var payload = {}; for(var pk in row){ if(pk!=='status') payload[pk]=row[pk]; }
        var paths = [];
        ['file_storage_path','preview_storage_path','cover_storage_path'].forEach(function(k){ if(row[k]) paths.push(row[k]); });
        var sres = await sb.from('scheduled_sections').insert({
          user_id: currentUser.id, section: sec, payload: payload,
          storage_paths: paths, publish_at: new Date(when).toISOString()
        }).select('id').single();
        if(sres.error) throw sres.error;
        if(moderated){ dzV.step('publish','pass','Scheduled for '+dzFmtWhen(when)); setTimeout(function(){ dzV.close(); }, 1400); }
        showToast('Scheduled for '+dzFmtWhen(when));
        dzResetForm(sec);
        return;
      }

      if(moderated){ dzV.step('transfer','pass'); dzV.step('publish','run'); }
      var res = await sb.from(SEC[sec].table).insert(row).select('id').single();
      if(res.error) throw res.error;

      // the row exists, so its media rows can be attached to it now
      if(res.data && res.data.id){
        for(var pmi=0; pmi<pendingMedia.length; pmi++){
          pendingMedia[pmi].parentId = res.data.id;
          await dzRecordUpload(pendingMedia[pmi]);
        }
      }

      if(moderated){ dzV.step('publish','pass'); setTimeout(function(){ dzV.close(); }, 1400); }
      showToast('Published');
      dzResetForm(sec);
      dzLoaded[sec] = false;   // next visit re queries
    }catch(err){
      if(moderated){ dzV.fail((err && err.message) ? err.message : 'Could not publish'); }
      else { showToast((err && err.message) ? err.message : 'Could not publish'); }
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = 'Publish'; }
    }
  }

  // runs last in body
  buildTabs();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildTabs);

  // never land on a hidden form
  (function(){
    var orig = window.openPfUpload;
    if(typeof orig !== 'function') return;
    window.openPfUpload = function(){
      var r = orig.apply(this, arguments);
      try{ upSwitchSection('artwork', true); }catch(e){}
      return r;
    };
  })();

  window.dzSecEnter      = dzSecEnter;
  window.dzSecRender     = dzSecRender;
  window.upSwitchSection = upSwitchSection;
  window.dzSubmit        = dzSubmit;
  window.dzResetForm     = dzResetForm;
  window.dzTagKey        = dzTagKey;
  window.dzTagDel        = dzTagDel;
  window.dzPick          = dzPick;
  window.dzFileReplace   = dzFileReplace;
  window.dzFileClear     = dzFileClear;
  window.dzDragOn        = dzDragOn;
  window.dzDragOff       = dzDragOff;
  window.dzDropFile      = dzDropFile;
  window.dzSaveDraft     = dzSaveDraft;
  window.dzResumeDraft   = dzResumeDraft;
  window.dzDeleteDraft   = dzDeleteDraft;
  window.dzCancelSched   = dzCancelSched;
  window.dzSchToggle     = dzSchToggle;
  window.dzSchNav        = dzSchNav;
  window.dzSchPick       = dzSchPick;
  window.dzSchApply      = dzSchApply;
  window.dzSchClear      = dzSchClear;
  window.dzSchDone       = dzSchDone;
  // expose rows to the detail view
  window.dzGetRows = function(sec){ return dzCache[sec] || []; };
  // Signing in or out changes which columns the rows may even carry, so a
  // cached page from the other state is stale in a way a re-render cannot fix.
  // Drop it and let the section load again on next view.
  window.dzSecReset = function(sec){
    if(sec){ delete dzCache[sec]; dzLoaded[sec] = false; dzBusy[sec] = false; }
    var host = sec && document.getElementById('fgSecC-'+sec);
    if(host && host.children.length) dzSecLoad(sec);
  };
  // the hero page's log lines name the same categories these cards do
  window.dzSecLabel = labelOf;
  window.dzHelpers = { money:money, bytes:bytes, ago:ago };
})();

// signed-in extras
//
// Everything this site does with money lives behind /api/store, which only
// answers a request carrying a valid session and is served no-store. That is
// deliberate: this file is a static asset, cached by the service worker and
// readable by anyone, so nothing about prices, providers or checkout is
// written here. A signed-out visitor loads this bundle and finds no trace of
// it — no provider name, no amount, no endpoint.
//
// The module fills in what the markup leaves blank: the empty container on the
// subscription page, and the .dzSlot placeholders the renderers below emit
// wherever a price or a buy control belongs. Until it lands there is simply
// nothing there.
(function(){
  'use strict';

  var done = false, inflight = null;

  function inject(code){
    var url = URL.createObjectURL(new Blob([code], {type:'text/javascript'}));
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = url;
      s.onload = function(){ URL.revokeObjectURL(url); res(true); };
      s.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }

  function load(){
    if(done) return Promise.resolve(true);
    if(inflight) return inflight;
    inflight = (async function(){
      if(!sb) return false;
      var s = await sb.auth.getSession();
      var session = s && s.data && s.data.session;
      if(!session) return false;
      var res = await fetch('/api/store', {
        headers:{ authorization:'Bearer '+session.access_token },
        cache:'no-store'
      });
      if(!res.ok) return false;
      await inject(await res.text());
      done = true;
      return true;
    })().catch(function(){ return false; })
       .then(function(ok){ if(!ok) inflight = null; return ok; });
    return inflight;
  }

  // Called after any render that could have produced a slot. Loads the module
  // on first need, then hands it the page.
  window.dzExtras = function(){
    return load().then(function(ok){
      if(ok && typeof window.dzFill === 'function') window.dzFill();
      return ok;
    });
  };

  // A guest has nothing to fill, so nothing is fetched until there is a
  // session — and again the moment one appears.
  if(sb && sb.auth){
    window.dzExtras();
    sb.auth.onAuthStateChange(function(_ev, session){
      // The marketplace rows differ by session — a guest is not served
      // price_cents at all — so a page rendered in the other state has to be
      // thrown away rather than patched.
      if(typeof window.dzSecReset === 'function') window.dzSecReset('marketplace');
      if(session) window.dzExtras();
      else { done = false; inflight = null; }
    });
  }

  // Not a payment path — the download itself is authorised in the database by
  // dz_market_download, which decides on ownership. Kept here because the
  // detail view calls it for free listings too.
  window.dzMarketGet = function(id){
    if(!window.currentUser){
      if(typeof pfGuestGate === 'function')
        pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return;
    }
    sb.rpc('dz_market_download', {p_item:id}).then(function(res){
      if(res.error){ showToast(res.error.message || 'Could not fetch the file'); return; }
      if(res.data) window.open(res.data, '_blank', 'noopener');
    });
  };
})();

// detail view and comments
(function(){
  'use strict';
  var KIND = { resources:'resource', blog:'blog', marketplace:'marketplace', jobs:'job' };
  var cur = { sec:null, idx:-1 };
  var curExt = null;   // single row mode
  var profCache = {};

  function H(){ return window.dzHelpers || { money:function(){return '';}, bytes:function(){return '';}, ago:function(){return '';} }; }
  function esc2(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function rows(){ return (typeof window.dzGetRows==='function' ? window.dzGetRows(cur.sec) : []) || []; }

  // comments
  window.dzCmLoad = async function(kind, id, listId){
    var host = document.getElementById(listId);
    if(!host || !id || !sb) return;
    var token = host.dataset.cmToken = String(Math.random());
    try{
      var res = await sb.from('item_comments')
        .select('id,user_id,username,body,created_at')
        .eq('kind',kind).eq('subject_id',id)
        .order('created_at',{ascending:true}).limit(200);
      if(host.dataset.cmToken !== token) return;   // user navigated on
      var list = (res && res.data) || [];
      if(!list.length){ host.innerHTML = '<div class="avCmEmpty">NO COMMENTS YET \u2014 BE THE FIRST</div>'; return; }
      host.innerHTML = list.map(function(c){
        var mine = window.currentUser && c.user_id === currentUser.id;
        return '<div class="avCm">'+
          '<div class="avCmAv">'+esc2((c.username||'?').charAt(0).toUpperCase())+'</div>'+
          '<div class="avCmMain"><div class="avCmHead"><span class="avCmName">'+esc2(c.username||'artist')+'</span>'+
          '<span class="avCmTime">'+esc2(H().ago(c.created_at))+'</span>'+
          (mine ? '<button class="avCmDel" onclick="dzCmDel('+c.id+',\''+esc2(kind)+'\',\''+esc2(id)+'\',\''+listId+'\')" aria-label="Delete comment">\u2715</button>' : '')+
          '</div><div class="avCmBody">'+esc2(c.body)+'</div></div></div>';
      }).join('');
      host.scrollTop = host.scrollHeight;
    }catch(e){
      if(host.dataset.cmToken === token) host.innerHTML = '<div class="avCmEmpty">COULD NOT LOAD COMMENTS</div>';
    }
  };
  window.dzCmPost = async function(kind, id, inputId, listId){
    if(!id) return;
    if(!window.currentUser){
      if(typeof pfGuestGate==='function') pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return;
    }
    var input = document.getElementById(inputId);
    var body = input ? String(input.value||'').trim() : '';
    if(!body) return;
    if(input) input.disabled = true;
    try{
      var res = await sb.from('item_comments').insert({ kind:kind, subject_id:id, user_id:currentUser.id, body:body });
      if(res.error) throw res.error;
      if(input) input.value = '';
      window.dzCmLoad(kind, id, listId);
    }catch(e){ showToast((e && e.message) || 'Could not post the comment'); }
    finally{ if(input) input.disabled = false; }
  };
  window.dzCmDel = async function(cid, kind, id, listId){
    try{
      var res = await sb.from('item_comments').delete().eq('id', cid);
      if(res.error) throw res.error;
      window.dzCmLoad(kind, id, listId);
    }catch(e){ showToast('Could not delete'); }
  };

  // report
  window.dzReportItem = function(kind, id){
    if(!window.currentUser){
      if(typeof pfGuestGate==='function') pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return;
    }
    var reason = prompt('Why are you reporting this?');
    if(reason === null) return;
    reason = String(reason).trim();
    if(reason.length < 3){ showToast('Add a short reason'); return; }
    sb.from('item_reports').insert({ kind:kind, subject_id:id, reporter_id:currentUser.id, reason:reason.slice(0,500) })
      .then(function(res){ showToast(res.error ? 'Could not send the report' : 'Report sent'); });
  };

  // author row
  async function fillAuthor(uid, elId){
    var el = document.getElementById(elId);
    if(!el || !uid || !sb) return;
    // wire the click first
    el.style.cursor = 'pointer';
    el.onclick = function(){
      var cp = profCache[uid];
      if(cp && cp.username){ openProfileByUsername(cp.username); return; }
      sb.from('profiles').select('username').eq('id',uid).single().then(function(r){
        var u = r && r.data && r.data.username;
        if(!u){ if(typeof showToast==='function') showToast('Profile not found'); return; }
        openProfileByUsername(u);
      }).catch(function(){ if(typeof showToast==='function') showToast('Couldn\u2019t open profile'); });
    };
    var p = profCache[uid];
    if(!p){
      try{
        var res = await sb.from('profiles').select('id,username,display_name,avatar_url').eq('id',uid).single();
        p = profCache[uid] = (res && res.data) || null;
      }catch(e){ p = null; }
    }
    el = document.getElementById(elId);            // may have re rendered
    if(!el){ return; }
    // re arm after a re render
    el.style.cursor = 'pointer';
    el.onclick = function(){
      var cp = profCache[uid];
      if(cp && cp.username){ openProfileByUsername(cp.username); return; }
      sb.from('profiles').select('username').eq('id',uid).single().then(function(r){
        var u = r && r.data && r.data.username;
        if(!u){ if(typeof showToast==='function') showToast('Profile not found'); return; }
        openProfileByUsername(u);
      }).catch(function(){ if(typeof showToast==='function') showToast('Couldn\u2019t open profile'); });
    };
    if(!p) return;
    var name = p.display_name || p.username || 'artist';
    el.innerHTML = '<div class="dzvAv">'+
        (p.avatar_url ? '<img src="'+esc2(getThumbnailUrl(p.avatar_url))+'" alt="">' : esc2(name.charAt(0).toUpperCase()))+
      '</div><div><div class="dzvAuthName">'+esc2(name)+'</div>'+
      (p.username ? '<div class="dzvAuthHandle">@'+esc2(p.username)+'</div>' : '')+'</div>';
  }

  function metaRow(pairs){
    var out = pairs.filter(function(x){ return x[1]; }).map(function(x){
      return '<div class="dzvMetaRow"><span>'+esc2(x[0])+'</span><b>'+esc2(x[1])+'</b></div>';
    }).join('');
    return out ? '<div class="dzvMeta">'+out+'</div>' : '';
  }
  function cmBlock(kind, id){
    return '<div class="avCmBlock"><div class="avBlockH">Comments</div>'+
      '<div class="avCmList" id="dzvCmList"></div>'+
      '<div class="avCmBar">'+
      '<input class="avCmIn" id="dzvCmIn" type="text" maxlength="1000" placeholder="Write a comment\u2026" '+
      'onkeydown="if(event.key===\'Enter\')dzCmPost(\''+kind+'\',\''+id+'\',\'dzvCmIn\',\'dzvCmList\')">'+
      '<button class="avCmSend" onclick="dzCmPost(\''+kind+'\',\''+id+'\',\'dzvCmIn\',\'dzvCmList\')" aria-label="Send">\u27a4</button>'+
      '</div></div>';
  }

  // renderers
  function render(){
    var host = document.getElementById('dzvBody');
    var r = curExt || rows()[cur.idx];
    if(!host || !r) return;
    host.scrollTop = 0;
    var sec = cur.sec, kind = KIND[sec], id = esc2(r.id), h = H(), html = '';
    var img = function(u, alt){ return u ? '<div class="dzvMedia"><img src="'+esc2(getViewUrl(u))+'" alt="'+esc2(alt||'')+'" loading="lazy"></div>' : ''; };

    if(sec === 'resources'){
      html = img(r.preview_url, r.title) +
        '<div class="dzvCol">'+
        '<div class="dzvFileCard"><span class="dzvExt">'+esc2((r.file_ext||'FILE').toUpperCase())+'</span>'+
        '<div><div class="dzvFileName">'+esc2(r.file_name||r.title)+'</div>'+
        '<div class="dzvFileMeta">'+esc2(h.bytes(r.file_size))+' \u00b7 '+esc2(String(r.download_count||0))+' downloads</div></div></div>'+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        (r.description ? '<p class="dzvDesc">'+esc2(r.description)+'</p>' : '')+
        metaRow([['License', r.license],['Made with', r.software],['Posted', h.ago(r.created_at)]])+
        cmBlock(kind, id)+
        '<a class="avActWide" href="'+esc2(r.file_url)+'" target="_blank" rel="noopener" download>\u2b07 Download file</a>'+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else if(sec === 'blog'){
      html = img(r.cover_url, r.title) +
        '<div class="dzvCol">'+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        (r.excerpt ? '<p class="dzvExcerpt">'+esc2(r.excerpt)+'</p>' : '')+
        metaRow([['Posted', h.ago(r.created_at)],['Read time', (r.read_minutes||1)+' min']])+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        '<div class="dzvArticle">'+esc2(r.body||'').replace(/\n/g,'<br>')+'</div>'+
        cmBlock(kind, id)+
        // the resized copy: the origin bucket is not publicly readable, so a
        // link to the stored original would 403
        (r.cover_url ? '<a class="avActWide" href="'+esc2(imgResize(r.cover_url, 1600))+'" target="_blank" rel="noopener" download>\u2b07 Download cover</a>' : '')+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else if(sec === 'marketplace'){
      var hasFile = r.file_ext ? 1 : 0;
      html = img(r.preview_url, r.title) +
        '<div class="dzvCol">'+
        // the slot sits under the media, and stays empty for a guest
        (window.dzSlot ? window.dzSlot(r, id, hasFile, 'view') : '')+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        (r.description ? '<p class="dzvDesc">'+esc2(r.description)+'</p>' : '')+
        metaRow([['Type', r.item_type],['License', r.license],
                 ['Delivery', r.delivery_days ? r.delivery_days+' days' : ''],['Listed', h.ago(r.created_at)]])+
        cmBlock(kind, id)+
        (hasFile ? '<button class="avActWide" onclick="dzMarketGet(\''+id+'\')">\u2b07 Download (owners)</button>' : '')+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else { // jobs, details and report
      var where = r.is_remote ? 'Remote' : [r.location_city, r.location_country].filter(Boolean).join(', ');
      html = '<div class="dzvCol">'+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        '<p class="dzvExcerpt">'+esc2(r.company||'')+(r.company_url ? ' \u00b7 <a href="'+esc2(r.company_url)+'" target="_blank" rel="noopener">website</a>' : '')+'</p>'+
        metaRow([['Location', where],['Type', String(r.employment_type||'').replace('_',' ')],
                 ['Pay', (r.salary_min||r.salary_max) ? [r.salary_min,r.salary_max].filter(function(x){return x!=null;}).join(' \u2013 ')+' '+(r.salary_currency||'') : ''],
                 ['Closes', r.valid_through],['Posted', h.ago(r.created_at)]])+
        '<div class="dzvArticle">'+esc2(r.description||'').replace(/\n/g,'<br>')+'</div>'+
        (r.apply_url ? '<a class="avActWide" href="'+esc2(r.apply_url)+'" target="_blank" rel="noopener">Apply \u2197</a>'
         : r.apply_email ? '<a class="avActWide" href="mailto:'+esc2(r.apply_email)+'">Apply by email \u2709</a>' : '')+
        '<button class="avReportBtn" onclick="dzReportItem(\'job\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    host.innerHTML = html;
    if(typeof window.dzExtras === 'function') window.dzExtras();   // fills the slot above

    var multi = !curExt && rows().length > 1;
    var pb=document.getElementById('dzvPrev'), nb=document.getElementById('dzvNext');
    if(pb) pb.style.visibility = multi ? 'visible' : 'hidden';
    if(nb) nb.style.visibility = multi ? 'visible' : 'hidden';

    // async fills
    if(r.user_id) fillAuthor(r.user_id, 'dzvAuthor');
    if(sec !== 'jobs') window.dzCmLoad(kind, String(r.id), 'dzvCmList');
  }

  var pushed = false;
  window.dzOpenView = function(sec, id){
    curExt = null;
    var list = (typeof window.dzGetRows==='function' ? window.dzGetRows(sec) : []) || [];
    var idx = list.findIndex(function(x){ return String(x.id)===String(id); });
    if(idx === -1) return;
    cur = { sec:sec, idx:idx };
    render();
    var v = document.getElementById('dzView');
    if(v) v.classList.add('open');
    document.body.style.overflow = 'hidden';
    // back button closes
    if(!pushed){ try{ history.pushState({dzv:1},''); pushed = true; }catch(e){} }
  };
  window.dzOpenRow = function(sec, row){
    if(!row) return;
    curExt = row; cur = { sec:sec, idx:-1 };
    render();
    var v = document.getElementById('dzView'); if(v) v.classList.add('open');
    document.body.style.overflow = 'hidden';
    if(!pushed){ try{ history.pushState({dzv:1},''); pushed = true; }catch(e){} }
  };

  window.addEventListener('popstate', function(){
    var v = document.getElementById('dzView');
    if(v && v.classList.contains('open')){ pushed = false; dzCloseView(); }
  });
  window.dzViewNav = function(dir){
    if(curExt) return;
    var n = rows().length;
    if(!n) return;
    cur.idx = (cur.idx + dir + n) % n;
    render();                                       // synchronous, no stale frame
  };
  window.dzCloseView = function(){
    var v = document.getElementById('dzView');
    if(v) v.classList.remove('open');
    document.body.style.overflow = '';
    curExt = null;
    if(pushed){ pushed = false; try{ history.back(); }catch(e){} }
  };
  // hide without touching history
  window.dzCloseViewSilent = function(){
    var v = document.getElementById('dzView');
    if(v) v.classList.remove('open');
    document.body.style.overflow = '';
  };
  document.addEventListener('keydown', function(e){
    var v = document.getElementById('dzView');
    if(!v || !v.classList.contains('open')) return;
    if(e.key === 'Escape') dzCloseView();
    else if(e.key === 'ArrowLeft') dzViewNav(-1);
    else if(e.key === 'ArrowRight') dzViewNav(1);
  });
})();

// hero pitch
(function(){
  'use strict';

  // em marks the accent phrase
  var TABS = [
    { id:'explore', label:'Explore',
      lead:'Discover the world\u2019s best', em:'Digital Art',
      list:['Browse stunning galleries from top artists',
            'Discover high-quality design resources',
            'Find inspiration for your next project'],
      cta:'\u2728 Start Exploring', to:'artworks' },
    { id:'learn', label:'Learn',
      lead:'Master new skills in', em:'Design & Art',
      list:['Read in-depth tutorials on our blog',
            'Download free educational resources',
            'Stay updated with industry trends'],
      cta:'\ud83d\udcda Read the Blog', to:'blog' },
    { id:'buy', label:'Buy',
      lead:'Shop premium', em:'Creative Assets',
      list:['Purchase exclusive digital artworks directly',
            'Find premium resources for your workflow',
            'Enjoy a fast, secure checkout process'],
      cta:'\ud83d\uded2 Browse Marketplace', to:'marketplace' },
    { id:'sell', label:'Sell',
      lead:'Monetize your', em:'Creative Work',
      list:['Set up your creator profile in minutes',
            'List your digital assets and artworks easily',
            'Keep more of what you earn as an artist'],
      cta:'\ud83d\ude80 Become a Seller', to:'sell' }
  ];

  var TICK = '<span class="hpTick" aria-hidden="true"><svg viewBox="0 0 24 24">'+
             '<polyline points="20 6 9 17 4 12"/></svg></span>';
  var cur = 0;

  function esc2(s){ return (typeof esc === 'function') ? esc(s) : String(s); }

  // where each tab goes
  function go(to){
    if(to === 'sell'){
      if(typeof openPfUpload === 'function'){
        openPfUpload();
        if(typeof upSwitchSection === 'function') upSwitchSection('marketplace');
      }
      return;
    }
    if(typeof openFG === 'function'){
      openFG();
      if(typeof fgSwitchSection === 'function') fgSwitchSection(to);
    }
  }

  function paintTabs(){
    var host = document.getElementById('hpTabs');
    if(!host) return;
    host.innerHTML = TABS.map(function(t, i){
      return '<button class="hpTab" type="button" role="tab" id="hpTab-'+t.id+'"'+
             ' aria-selected="'+(i === cur)+'" tabindex="'+(i === cur ? '0' : '-1')+'"'+
             ' onclick="hpSelect('+i+')">'+esc2(t.label)+'</button>';
    }).join('');
  }

  function paintPanel(){
    var p = document.getElementById('hpPanel');
    if(!p) return;
    var t = TABS[cur];
    p.innerHTML =
      '<h1 class="hpHead">'+esc2(t.lead)+' <em>'+esc2(t.em)+'</em></h1>'+
      '<ul class="hpList">'+ t.list.map(function(x){
        return '<li>'+TICK+'<span>'+esc2(x)+'</span></li>'; }).join('') +'</ul>'+
      '<button class="hpCta" type="button" onclick="hpGo()">'+esc2(t.cta)+'</button>';
    p.setAttribute('aria-labelledby', 'hpTab-'+t.id);
    // restart the animation
    p.classList.remove('hpIn');
    void p.offsetWidth;
    p.classList.add('hpIn');
  }

  function hpSelect(i, focus){
    if(i < 0 || i >= TABS.length || i === cur) {
      if(focus) { var b0 = document.getElementById('hpTab-'+TABS[cur].id); if(b0) b0.focus(); }
      return;
    }
    cur = i;
    paintTabs();
    paintPanel();
    if(focus){
      var b = document.getElementById('hpTab-'+TABS[cur].id);
      if(b) b.focus();
    }
  }
  function hpGo(){ go(TABS[cur].to); }

  // arrow keys move tabs
  var tabsEl = document.getElementById('hpTabs');
  if(tabsEl){
    tabsEl.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if(!d) return;
      e.preventDefault();
      hpSelect((cur + d + TABS.length) % TABS.length, true);
    });
  }

  paintTabs();
  paintPanel();

  window.hpSelect = hpSelect;
  window.hpGo     = hpGo;
})();

// quick links rail
(function(){
  'use strict';

  var rail = document.getElementById('qlRail');
  var bar  = document.getElementById('qlBar');
  var fill = document.getElementById('qlBarFill');
  if(!rail || !bar || !fill) return;

  var queued = false;

  // fill width = share of the rail on screen, offset = how far along it is
  function paint(){
    queued = false;
    var total = rail.scrollWidth, seen = rail.clientWidth;
    if(!total || total - seen <= 1){ bar.classList.add('qlHide'); return; }
    bar.classList.remove('qlHide');
    fill.style.width = (seen / total * 100) + '%';
    fill.style.left  = (rail.scrollLeft / total * 100) + '%';
  }
  function sync(){
    if(queued) return;
    queued = true;
    requestAnimationFrame(paint);
  }

  rail.addEventListener('scroll', sync, { passive:true });
  window.addEventListener('resize', sync);
  if(window.ResizeObserver) new ResizeObserver(sync).observe(rail);
  sync();

  // everything that is not a gallery section
  var OWN = {
    community:    function(){ if(typeof bnGoCommunity === 'function') bnGoCommunity(); },
    upload:       function(){ if(typeof bnGoUpload === 'function') bnGoUpload(); },
    // the page Settings opens under Subscription
    subscription: function(){ if(typeof openSubscription === 'function') openSubscription(); },
    // Artist Progress, the profile's own level page. It reads whichever
    // profile was last opened, so clear that or a quick link would show
    // the level of the last artist you looked at instead of your own.
    level:        function(){
      if(window.pf) window.pf.profile = null;
      if(typeof openXpPage === 'function') openXpPage();
    },
    // the page Settings opens under Theme
    theme:        function(){ if(typeof openThemePage === 'function') openThemePage(); },
    // the full boards behind the hero page's ranking strip
    ranking:      function(){ if(typeof openRankPage === 'function') openRankPage(); }
  };

  // sections that live inside the gallery overlay
  var GALLERY = {
    artworks:1, marketplace:1, resources:1, blog:1, jobs:1, cart:1
  };

  // whatever is open has to go first. bnCloseAllSections is the bottom
  // nav's own sweep but it predates the ranking, theme and progress
  // pages, so those are closed here as well — each hides the bottom bar
  // while it is up, and left open it takes the bar with it.
  function shut(){
    if(typeof bnCloseAllSections === 'function') bnCloseAllSections();
    if(typeof closeRankPage === 'function') closeRankPage();
    if(typeof closeThemePage === 'function') closeThemePage();
    if(typeof closeXpPage === 'function') closeXpPage();
  }

  window.qlGo = function(id){
    shut();
    if(GALLERY[id]){
      // bnGoGallery is the real entry: closes the rest, resets the
      // category filter and lights up the Gallery tab. openFG alone
      // opened the overlay with the app still thinking it was Home.
      if(typeof bnGoGallery === 'function') bnGoGallery();
      else if(typeof openFG === 'function') openFG();
      if(typeof fgSwitchSection === 'function') fgSwitchSection(id);
      return;
    }
    if(OWN[id]) OWN[id]();
  };
})();
