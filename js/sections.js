/* ── sections.js · resources · blog · marketplace · jobs, razorpay, dzView, hero pitch ── */
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
    /* The bot's speech bubble is a separately fixed-position element
       driven by its own timer, independent of the button — muting
       it here stops it from popping up while the button is hidden. */
    if (out !== wasOut) {
      wasOut = out;
      if (out) {
        if (typeof window.zeoPauseBubble === 'function') window.zeoPauseBubble();
      } else {
        if (typeof window.zeoResumeBubble === 'function') window.zeoResumeBubble();
      }
    }
  }

  /* ── Full-page overlay panels — hide widgets whenever any of
     these slide-in pages is open, since they otherwise float
     above the panel's lower z-index. ── */
  var OVERLAY_IDS = ['profilePage', 'fg', 'communityPage', 'subPage', 'adsPanel', 'authMod', 'pfUpMod', 'upMod', 'artModal', 'notifPage', 'admPage', 'pfMyWorkPage', 'themePage', 'bmPage', 'xpPage', 'rankPage'];
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

/* ═══════════════════════════════════════════════════════════════════
   SECTION CONTENT — Resources / Blog / Marketplace / Jobs
   Four Supabase tables behind the four gallery tabs, plus the upload
   forms that feed them.

   Where the bytes live:
     Resources    → S3 (file + preview), row in `resources`
     Blog         → Supabase only; the optional cover reuses the
                    existing image path
     Marketplace  → S3 (file + preview) + Supabase row w/ pricing
     Jobs         → Supabase only, no upload at all

   Forms are generated from ONE field spec rather than four
   hand-written HTML blocks: the sections share ~70% of their fields
   (title, description, category, tags), and four copies would drift
   the moment one of them changed.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* Rows are cached per section so switching tabs doesn't re-query. */
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
      /* file_url is deliberately absent: the column is revoked from
         anon/authenticated (selecting it errors the whole query) and
         the paid file is only reachable through the
         dz_market_download() RPC after an entitlement check. */
      select:'id,user_id,title,description,category,tags,item_type,price_cents,currency,file_ext,file_size,preview_url,license,delivery_days,created_at'
    },
    jobs: {
      table:'jobs', kind:'list', noun:'job',
      select:'id,user_id,title,company,company_url,description,category,tags,employment_type,is_remote,location_city,location_country,applicant_countries,salary_min,salary_max,salary_currency,salary_unit,apply_url,apply_email,valid_through,created_at'
    }
  };

  /* ── small formatters ───────────────────────────────────────── */
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
  function slugify(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function labelOf(sec, slug){
    var o = (window.FG_SECTIONS && FG_SECTIONS[sec] && FG_SECTIONS[sec].opts) || [];
    for(var i=0;i<o.length;i++){ if(slugify(o[i]) === slug) return o[i]; }
    return slug;
  }

  /* ── load ────────────────────────────────────────────────────── */
  function dzSecEnter(sec){
    if(!SEC[sec] || dzLoaded[sec] || dzBusy[sec]) { dzSecRender(sec); return; }
    dzSecLoad(sec);
  }
  function dzSecLoad(sec){
    var cfg = SEC[sec], host = document.getElementById('fgSecC-'+sec);
    if(!cfg || !host) return;
    /* `sb` is a top-level `let` in the main script block — it lives in
       the global lexical environment, NOT on window, so `window.sb` is
       always undefined. Bare `sb` resolves correctly (null if config
       is missing, the client otherwise). */
    if(!sb){ host.innerHTML = '<div class="dzEmpty">BACKEND NOT CONFIGURED</div>'; return; }
    dzBusy[sec] = true;
    host.innerHTML = '<div class="dzBusy">LOADING…</div>';
    sb.from(cfg.table).select(cfg.select)
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

  /* ── filter + paint ──────────────────────────────────────────── */
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
        ? '<img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(r.preview_url))+'" alt="'+esc(r.title)+'">'
        : '<span class="dzExt">'+esc((r.file_ext||'FILE').toUpperCase())+'</span>';
      /* Card click opens the full detail view; the file download
         moved inside it (with the comments and report options). */
      return '<div class="dzCard" onclick="dzOpenView(\'resources\',\''+id+'\')">'+
        '<div class="dzThumb">'+thumb+'<span class="dzBadge">'+esc((r.file_ext||'').toUpperCase())+'</span></div>'+
        '<div class="dzBody"><div class="dzName">'+esc(r.title)+'</div>'+
        '<div class="dzMeta"><span>'+esc(bytes(r.file_size))+'</span>'+
        '<span>'+esc(String(r.download_count||0))+' downloads</span>'+
        '<span>'+esc(r.license||'')+'</span></div>'+chips(r)+'</div></div>';
    }
    if(sec === 'marketplace'){
      var mt = r.preview_url
        ? '<img loading="lazy" decoding="async" src="'+esc(getThumbnailUrl(r.preview_url))+'" alt="'+esc(r.title)+'">'
        : '<span class="dzExt">'+esc((r.item_type||'ITEM').toUpperCase())+'</span>';
      /* file_url never reaches the client — the button routes through
         the Razorpay checkout (paid) or the entitlement RPC (free /
         already purchased). hasFile tells the post-payment handler
         whether a download should follow, since commissions and
         services legitimately have no file. */
      var hasFile = r.file_ext ? 1 : 0;
      var priced  = (r.price_cents||0) > 0;
      var buyBtn  = priced
        ? '<button class="dzBuy" onclick="event.stopPropagation();dzMarketBuy(\''+id+'\','+hasFile+')">Buy \u00b7 '+esc(money(r.price_cents, r.currency))+'</button>'
        : (hasFile ? '<button class="dzBuy dzBuy--free" onclick="event.stopPropagation();dzMarketGet(\''+id+'\')">Download \u00b7 Free</button>' : '');
      return '<div class="dzCard" data-id="'+id+'" onclick="dzOpenView(\'marketplace\',\''+id+'\')">'+
        '<div class="dzThumb">'+mt+'<span class="dzBadge">'+esc((r.item_type||'').toUpperCase())+'</span></div>'+
        '<div class="dzBody"><div class="dzName">'+esc(r.title)+'</div>'+
        '<div class="dzPrice">'+esc(money(r.price_cents, r.currency))+'</div>'+
        '<div class="dzMeta"><span>'+esc(r.license||'')+'</span>'+
        (r.delivery_days ? '<span>'+esc(String(r.delivery_days))+'d delivery</span>' : '')+
        '</div>'+chips(r)+buyBtn+'</div></div>';
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
    /* jobs */
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

  /* ═══════════════════════════════════════════════════════════════
     UPLOAD FORMS
     One spec per section. `type` drives both the rendered control and
     how dzSubmit() reads it back, so adding a field is a one-line
     change instead of edits in three places.
     ═══════════════════════════════════════════════════════════════ */
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
        {k:'preview',t:'image', label:'Preview image', hint:'Shown on the card. JPG/PNG/WEBP up to 25MB.'},
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
        {k:'preview',t:'image', label:'Preview image', hint:'JPG/PNG/WEBP up to 25MB.'},
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

  /* Per-section scratch state: picked files and tag chips. */
  var S = {};
  function st(sec){ return (S[sec] = S[sec] || {tags:[], files:{}}); }

  var ORDER = ['artwork','resources','blog','marketplace','jobs'];
  var TAB_LABEL = {artwork:'Artwork', resources:'Resources', blog:'Blog', marketplace:'Marketplace', jobs:'Jobs'};
  var TAB_ICO   = {artwork:'artworks', resources:'resources', blog:'blog', marketplace:'marketplace', jobs:'jobs'};
  var upSec = 'artwork';

  function buildTabs(){
    var host = document.getElementById('upSecTabs');
    if(!host || host.childNodes.length) return;
    host.innerHTML = ORDER.map(function(s){
      var ico = '<span class="fgSecIco fgSecIco--'+TAB_ICO[s]+'" aria-hidden="true">'+
        (document.querySelector('.fgSecIco--'+TAB_ICO[s]+' svg') ?
          document.querySelector('.fgSecIco--'+TAB_ICO[s]+' svg').outerHTML : '')+'</span>';
      return '<button class="upSecBtn'+(s==='artwork'?' active':'')+'" id="upSecBtn-'+s+
        '" role="tab" aria-selected="'+(s==='artwork')+'" onclick="upSwitchSection(\''+s+'\')">'+
        ico+'<span>'+TAB_LABEL[s]+'</span></button>';
    }).join('');
  }

  function upSwitchSection(sec, silent){
    buildTabs();               /* idempotent — safe to call every time */
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
      /* silent = the caller already labelled the page (edit mode says
         "Edit Artwork"); only restore which panel is showing. */
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
  }

  function buildForm(sec){
    var f = FORMS[sec], out = ['<div class="upMain">'];
    f.fields.forEach(function(fd){ out.push(field(sec, fd)); });
    out.push('<div class="upActions" style="display:flex;gap:.6rem;margin-top:1.4rem">'+
      '<button type="button" class="upBtnPri upBtnPri" id="dzSubmit-'+sec+'" onclick="dzSubmit(\''+sec+'\')">Publish ✦</button>'+
      '<button type="button" class="upBtnSec" onclick="dzResetForm(\''+sec+'\')">Reset</button></div>');
    out.push('<p class="dzHint" style="margin-top:.9rem">Posts are reviewed before they appear publicly.</p>');
    out.push('</div>');
    return out.join('');
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
      var acc = fd.t === 'image' ? 'image/*' : (fd.accept||'');
      return '<div class="upField">'+lbl+
        '<input class="upIn" id="'+id+'" type="file" accept="'+esc(acc)+'" '+
        'onchange="dzPick(\''+sec+'\',\''+fd.k+'\',this)">'+
        '<div class="dzFileName" id="'+id+'_nm"></div>'+hint+'</div>';
    }
    return '<div class="upField">'+lbl+body+hint+'</div>';
  }

  /* ── tags ────────────────────────────────────────────────────── */
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

  /* ── file picking ────────────────────────────────────────────── */
  function dzPick(sec, key, input){
    if(typeof pfGuestGate === 'function' && pfGuestGate({preventDefault:function(){},stopPropagation:function(){}})) return;
    var f = input.files && input.files[0];
    var nm = document.getElementById('dz_'+sec+'_'+key+'_nm');
    if(!f){ st(sec).files[key] = null; if(nm) nm.textContent = ''; return; }
    st(sec).files[key] = f;
    if(nm) nm.textContent = f.name + ' · ' + bytes(f.size);
  }

  function val(sec, k){
    var el = document.getElementById('dz_'+sec+'_'+k);
    if(!el) return '';
    if(el.type === 'checkbox') return el.checked;
    return String(el.value||'').trim();
  }

  function dzResetForm(sec){
    S[sec] = {tags:[], files:{}};
    var box = document.getElementById('upSecForms');
    if(box) box.innerHTML = buildForm(sec);
    renderTags(sec);
  }

  /* ── submit ──────────────────────────────────────────────────── */
  async function dzSubmit(sec){
    if(!sb){ showToast('Backend not configured'); return; }
    if(!window.currentUser){
      if(typeof pfGuestGate === 'function') pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return;
    }
    var btn = document.getElementById('dzSubmit-'+sec);
    /* No moderation queue for these sections — rows insert as
       'approved' (same as artworks) and are live the moment the
       insert lands. The eq('status','approved') read filter stays,
       so a status column edit can still unpublish a row later. */
    var s = st(sec), row = {user_id: currentUser.id, tags: s.tags, status:'approved'};

    /* Required fields come straight off the spec so the form and the
       check can't disagree. */
    var miss = FORMS[sec].fields.filter(function(fd){
      if(!fd.req) return false;
      if(fd.t === 'file' || fd.t === 'image') return !s.files[fd.k];
      return !val(sec, fd.k);
    });
    if(miss.length){ showToast('Missing: ' + miss[0].label); return; }

    if(btn){ btn.disabled = true; btn.textContent = 'Publishing…'; }
    try{
      var stamp = Date.now();
      var base  = safeSlug(val(sec,'title') || sec, 60) || sec;

      /* S3 first: a row pointing at a file that failed to upload is
         worse than no row at all. */
      async function put(key, prefix){
        var f = s.files[key]; if(!f) return null;
        var ext = safeSlug((f.name.split('.').pop()||'bin'), 10);
        var path = prefix+'/'+currentUser.id+'/'+stamp+'_'+base+'.'+ext;
        var url  = await s3Upload(BUCKET, path, f);
        return {url:url, path:path, name:f.name, ext:ext, size:f.size};
      }

      if(sec === 'resources'){
        var rf = await put('file','resources'), rp = await put('preview','resources');
        row.title = val(sec,'title'); row.description = val(sec,'description');
        row.category = [val(sec,'category')]; row.license = val(sec,'license') || 'personal';
        row.software = val(sec,'software') || null;
        row.file_url = rf.url; row.file_storage_path = rf.path;
        row.file_name = rf.name; row.file_ext = rf.ext; row.file_size = rf.size;
        if(rp){ row.preview_url = rp.url; row.preview_storage_path = rp.path; }
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
      }

      else if(sec === 'jobs'){
        var remote = val(sec,'is_remote') === true;
        var countries = val(sec,'applicant_countries')
          .split(',').map(function(x){ return x.trim().toUpperCase(); }).filter(Boolean);
        var cc = val(sec,'location_country').toUpperCase();
        var url = val(sec,'apply_url'), mail = val(sec,'apply_email');

        /* These mirror the table's CHECK constraints. Catching them
           here turns a raw Postgres error into a readable sentence. */
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

      var res = await sb.from(SEC[sec].table).insert(row).select('id').single();
      if(res.error) throw res.error;

      showToast('Published ✦');
      dzResetForm(sec);
      dzLoaded[sec] = false;   /* next visit re-queries */
    }catch(err){
      showToast((err && err.message) ? err.message : 'Could not publish');
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = 'Publish ✦'; }
    }
  }

  /* This script is the last thing in <body>, so every element it
     touches is already parsed — no need to wait for DOMContentLoaded.
     The listener stays only as a fallback if the block is ever moved. */
  buildTabs();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildTabs);

  /* Re-opening Upload (or entering edit mode) must never land on a
     hidden artwork form because the user last picked "Blog". Wrapped
     rather than edited so the original function is untouched. */
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
  /* The detail overlay (#dzView) navigates the same rows the tab is
     showing and reuses these formatters — exposed read-only. */
  window.dzGetRows = function(sec){ return dzCache[sec] || []; };
  window.dzHelpers = { money:money, bytes:bytes, ago:ago };
})();

/* ═══════════════════════════════════════════════════════════════════
   RAZORPAY CHECKOUT — subscriptions + marketplace
   Server half lives in functions/api/rzp.js (Cloudflare Pages
   Function at /api/rzp). Prices are decided there, never here — this
   module only opens the Razorpay modal and reports the result back
   for signature verification. checkout.js is loaded lazily on the
   first pay press so visitors who never buy never fetch it.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  var loadP = null;
  function loadRzp(){
    if(window.Razorpay) return Promise.resolve();
    if(loadP) return loadP;
    loadP = new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = res;
      s.onerror = function(){ loadP = null; rej(new Error('Could not load the payment window')); };
      document.head.appendChild(s);
    });
    return loadP;
  }

  async function api(body){
    var{data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Sign in required');
    var res = await fetch('/api/rzp', {
      method:'POST',
      headers:{'content-type':'application/json', 'authorization':'Bearer '+session.access_token},
      body: JSON.stringify(body)
    });
    var j = await res.json().catch(function(){return{};});
    if(!res.ok) throw new Error(j.error || 'Payment service error');
    return j;
  }

  function gate(){
    if(currentUser) return false;
    if(typeof pfGuestGate === 'function')
      pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
    return true;
  }

  function openCheckout(order, onPaid){
    return loadRzp().then(function(){
      new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'DigiArtz',
        description: order.label || '',
        theme: { color: '#7C3AED' },
        handler: function(r){
          api({action:'verify', orderId:r.razorpay_order_id,
               paymentId:r.razorpay_payment_id, signature:r.razorpay_signature})
            .then(onPaid, function(e){ showToast(e.message || 'Could not verify the payment'); });
        },
        modal: { ondismiss: function(){ showToast('Payment cancelled'); } }
      }).open();
    });
  }

  /* ── subscriptions ─────────────────────────────────────────────
     One-time payment granting 31 days; the server stamps
     profiles.subscription_tier + subscription_expires_at after the
     signature verifies. */
  window.dzSubBuy = function(plan){
    if(gate()) return;
    var amount = null;
    if(plan === 'support'){
      var v = prompt('Support amount in USD (minimum $0.50):', '5');
      if(v === null) return;
      amount = Math.round(parseFloat(v) * 100);
      if(!Number.isFinite(amount) || amount < 50){ showToast('Minimum is $0.50'); return; }
    }
    api({action:'sub-order', plan:plan, amount:amount})
      .then(function(o){
        return openCheckout(o, function(r){
          showToast(r.tier ? 'Subscription active \u2726' : 'Thank you for the support \u2726');
        });
      })
      .catch(function(e){ showToast(e.message || 'Could not start checkout'); });
  };

  /* ── marketplace ───────────────────────────────────────────────
     Free (or already-owned) files come straight from the
     entitlement RPC; paid ones go through checkout first. hasFile=0
     for commissions/services, where paying is the whole product. */
  window.dzMarketGet = function(id){
    if(gate()) return;
    sb.rpc('dz_market_download', {p_item:id}).then(function(res){
      if(res.error){ showToast(res.error.message || 'Could not fetch the file'); return; }
      if(res.data) window.open(res.data, '_blank', 'noopener');
    });
  };

  window.dzMarketBuy = function(id, hasFile){
    if(gate()) return;
    api({action:'market-order', itemId:id})
      .then(function(o){
        if(o.owned){                      /* bought before — just download */
          if(hasFile) window.dzMarketGet(id);
          else showToast('Already purchased \u2726');
          return;
        }
        return openCheckout(o, function(){
          showToast('Purchased \u2726');
          if(hasFile) window.dzMarketGet(id);
        });
      })
      .catch(function(e){ showToast(e.message || 'Could not start checkout'); });
  };
})();

/* ═══════════════════════════════════════════════════════════════════
   DETAIL VIEW (#dzView) + shared per-item comments (dzCm*)
   One overlay serves Resources / Blog / Marketplace / Jobs. It walks
   window.dzGetRows(sec) — the exact rows the section tab is showing —
   so Previous/Next steps through what the user was just browsing.
   Every navigation rebuilds the body SYNCHRONOUSLY from the cached
   row (no stale frame), then async work (author profile, comments)
   fills in. Comments live in item_comments (username stamped by a
   DB trigger); reports in item_reports. Jobs: details + report only.
   The artwork viewer shares dzCmLoad/dzCmPost for its own thread.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  var KIND = { resources:'resource', blog:'blog', marketplace:'marketplace', jobs:'job' };
  var cur = { sec:null, idx:-1 };
  var profCache = {};

  function H(){ return window.dzHelpers || { money:function(){return '';}, bytes:function(){return '';}, ago:function(){return '';} }; }
  function esc2(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function rows(){ return (typeof window.dzGetRows==='function' ? window.dzGetRows(cur.sec) : []) || []; }

  /* ── comments (shared with the artwork viewer) ─────────────── */
  window.dzCmLoad = async function(kind, id, listId){
    var host = document.getElementById(listId);
    if(!host || !id || !sb) return;
    var token = host.dataset.cmToken = String(Math.random());
    try{
      var res = await sb.from('item_comments')
        .select('id,user_id,username,body,created_at')
        .eq('kind',kind).eq('subject_id',id)
        .order('created_at',{ascending:true}).limit(200);
      if(host.dataset.cmToken !== token) return;   /* user already navigated on */
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

  /* ── report (all four kinds + jobs) ────────────────────────── */
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
      .then(function(res){ showToast(res.error ? 'Could not send the report' : 'Report sent \u2726'); });
  };

  /* ── author row (async fill) ───────────────────────────────── */
  async function fillAuthor(uid, elId){
    var el = document.getElementById(elId);
    if(!el || !uid || !sb) return;
    var p = profCache[uid];
    if(!p){
      try{
        var res = await sb.from('profiles').select('id,username,display_name,avatar_url').eq('id',uid).single();
        p = profCache[uid] = (res && res.data) || null;
      }catch(e){ p = null; }
    }
    el = document.getElementById(elId);            /* may have re-rendered */
    if(!el || !p) return;
    var name = p.display_name || p.username || 'artist';
    el.innerHTML = '<div class="dzvAv">'+
        (p.avatar_url ? '<img src="'+esc2(getThumbnailUrl(p.avatar_url))+'" alt="">' : esc2(name.charAt(0).toUpperCase()))+
      '</div><div><div class="dzvAuthName">'+esc2(name)+'</div>'+
      (p.username ? '<div class="dzvAuthHandle">@'+esc2(p.username)+'</div>' : '')+'</div>';
    el.onclick = function(){
      if(p.username && typeof openProfileByUsername==='function'){ dzCloseView(); openProfileByUsername(p.username); }
    };
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

  /* ── per-kind renderers ────────────────────────────────────── */
  function render(){
    var host = document.getElementById('dzvBody');
    var r = rows()[cur.idx];
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
        (r.cover_url ? '<a class="avActWide" href="'+esc2(getFullUrl(r.cover_url))+'" target="_blank" rel="noopener" download>\u2b07 Download cover</a>' : '')+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else if(sec === 'marketplace'){
      var priced = (r.price_cents||0) > 0, hasFile = r.file_ext ? 1 : 0;
      html = img(r.preview_url, r.title) +
        '<div class="dzvCol">'+
        /* Buy sits directly under the media, before everything else —
           it is the primary action of this page. */
        '<div class="dzvBuyCard"><div class="dzvPrice">'+esc2(h.money(r.price_cents, r.currency))+'</div>'+
        (priced
          ? '<button class="dzBuy" onclick="dzMarketBuy(\''+id+'\','+hasFile+')">Buy now</button>'
          : (hasFile ? '<button class="dzBuy dzBuy--free" onclick="dzMarketGet(\''+id+'\')">Download \u00b7 Free</button>' : ''))+
        '</div>'+
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
    else { /* jobs — details only, report only */
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

    var multi = rows().length > 1;
    var pb=document.getElementById('dzvPrev'), nb=document.getElementById('dzvNext');
    if(pb) pb.style.visibility = multi ? 'visible' : 'hidden';
    if(nb) nb.style.visibility = multi ? 'visible' : 'hidden';

    /* async fills — token-guarded comments, cached profiles */
    if(r.user_id) fillAuthor(r.user_id, 'dzvAuthor');
    if(sec !== 'jobs') window.dzCmLoad(kind, String(r.id), 'dzvCmList');
  }

  var pushed = false;
  window.dzOpenView = function(sec, id){
    var list = (typeof window.dzGetRows==='function' ? window.dzGetRows(sec) : []) || [];
    var idx = list.findIndex(function(x){ return String(x.id)===String(id); });
    if(idx === -1) return;
    cur = { sec:sec, idx:idx };
    render();
    var v = document.getElementById('dzView');
    if(v) v.classList.add('open');
    document.body.style.overflow = 'hidden';
    /* No ✕ in the top bar — the browser back button/gesture is the
       close control, so opening plants a history entry to consume. */
    if(!pushed){ try{ history.pushState({dzv:1},''); pushed = true; }catch(e){} }
  };
  window.addEventListener('popstate', function(){
    var v = document.getElementById('dzView');
    if(v && v.classList.contains('open')){ pushed = false; dzCloseView(); }
  });
  window.dzViewNav = function(dir){
    var n = rows().length;
    if(!n) return;
    cur.idx = (cur.idx + dir + n) % n;
    render();                                       /* synchronous — no stale frame */
  };
  window.dzCloseView = function(){
    var v = document.getElementById('dzView');
    if(v) v.classList.remove('open');
    document.body.style.overflow = '';
    if(pushed){ pushed = false; try{ history.back(); }catch(e){} }
  };
  document.addEventListener('keydown', function(e){
    var v = document.getElementById('dzView');
    if(!v || !v.classList.contains('open')) return;
    if(e.key === 'Escape') dzCloseView();
    else if(e.key === 'ArrowLeft') dzViewNav(-1);
    else if(e.key === 'ArrowRight') dzViewNav(1);
  });
})();

/* ═══════════════════════════════════════════════════════════════════
   HERO PITCH — Explore / Learn / Buy / Sell
   One screen that answers four different reasons for arriving. The
   toggle swaps headline, checklist and CTA in place; nothing
   navigates until the CTA is pressed, and each CTA opens the surface
   that actually delivers on the sentence above it.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  /* `em` marks the one phrase per headline that takes the brand
     colour — kept in the data so copy and emphasis travel together. */
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

  /* Explore / Learn / Buy open the gallery on the matching section;
     Sell goes to the upload page with the Marketplace form already
     chosen, because "become a seller" means "list something". */
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
    /* Restart the animation: drop the class, force a reflow so the
       browser can't batch the two writes into no change at all, then
       re-add it. */
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

  /* Arrow keys move between tabs, which is what a tablist is expected
     to do once it claims the role. */
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
