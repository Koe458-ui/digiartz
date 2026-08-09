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
  // visible while that panel was short; obvious once it grew a long one.
  // dzPanelHost is created by the signed-in module and is simply absent for
  // everyone else — overlayEls skips what it cannot find.
  var OVERLAY_IDS = ['profilePage', 'fg', 'communityPage', 'subPage', 'adsPanel', 'authMod', 'pfUpMod', 'upMod', 'artModal', 'notifPage', 'admPage', 'pfMyWorkPage', 'pfEditPage', 'setPage', 'dzPanelHost', 'themePage', 'bmPage', 'xpPage', 'rankPage'];
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
      // a draft is kept and not listed; a hidden one is reachable by its link
      eq:{ visibility:'published' },
      order:[['featured',false],['created_at',false]],
      select:'id,user_id,title,summary,description,resource_type,category,subcategory,tags,'+
             'file_url,file_name,file_ext,file_size,file_count,dimensions,preview_url,'+
             'license,commercial_use,attribution_required,modification_allowed,'+
             'software,compatible_software,compatible_versions,whats_included,instructions,'+
             'version,external_links,safety_notes,featured,download_count,updated_at,created_at'
    },
    blog: {
      table:'blog_posts', kind:'list', noun:'post',
      // a draft is kept and not listed; a hidden post is reachable by its link
      eq:{ visibility:'published' },
      order:[['featured',false],['created_at',false]],
      select:'id,user_id,title,slug,excerpt,body,cover_url,category,tags,read_minutes,'+
             'content_type,related_artworks,related_items,external_refs,featured,'+
             'author_bio,seo_title,seo_description,like_count,view_count,bookmark_count,'+
             'published_at,updated_at,created_at'
    },
    marketplace: {
      table:'marketplace_items', kind:'grid', noun:'item',
      // only published listings; a draft is kept and a hidden one is reachable
      // by its own link
      eq:{ visibility:'published' },
      order:[['featured',false],['created_at',false]],
      // file url is revoked for clients, and so is price_cents for anon — the
      // grant is column level, so asking for it while signed out fails the
      // whole query rather than returning null. selectFor adds it back once
      // there is a session, along with the sale price, which is a price and
      // goes exactly where price_cents goes.
      //
      // internal_notes is granted to nobody and is deliberately absent.
      select:'id,user_id,title,summary,description,category,subcategory,tags,item_type,product_type,'+
             'currency,file_ext,file_size,file_format,file_count,file_size_mb,dimensions,software,'+
             'source_files_included,preview_url,gallery,license,commercial_use,personal_use,'+
             'modification_allowed,attribution_required,stock,delivery_type,delivery_days,'+
             'delivery_notes,custom_requests,revision_count,support_period,refund_policy,'+
             'preview_watermark,safety_notes,seller_note,apply_url,apply_email,'+
             'buyer_gets,featured,closing_date,seo_title,seo_description,slug,created_at'
    },
    jobs: {
      table:'jobs', kind:'list', noun:'job',
      // Only public postings reach the list. Unlisted ones stay reachable by
      // their own link and private ones by nothing, which is the whole point
      // of asking.
      eq:{ visibility:'public' },
      // featured first, then newest — the order the index is built for
      order:[['featured',false],['created_at',false]],
      select:'id,user_id,title,company,company_url,about_company,description,category,tags,'+
             'employment_type,experience_level,years_experience,openings,'+
             'responsibilities,requirements,required_skills,nice_to_have_skills,benefits,'+
             'work_mode,is_remote,location_city,location_country,applicant_countries,'+
             'timezone,working_hours,schedule,start_date,contract_duration,'+
             'salary_min,salary_max,salary_currency,salary_unit,apply_url,apply_email,'+
             'application_instructions,application_materials,application_questions,'+
             'portfolio_required,resume_required,cover_letter_required,'+
             'valid_through,featured,created_at'
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
  //
  // The title and preview ride along because the checkout page names what is
  // being bought before any order exists, and asking the database again for a
  // row the card is already showing would only make the buyer wait. Both are
  // already public and already on screen — nothing new is disclosed here.
  function slot(r, id, hasFile, view){
    if(!window.currentUser) return '';
    return '<div class="dzSlot" data-i="'+id+'" data-p="'+(Number(r.price_cents)||0)+
           '" data-c="'+esc(r.currency||'USD')+'" data-f="'+(hasFile?1:0)+
           '" data-t="'+esc(r.title||'')+'" data-th="'+esc(r.preview_url||'')+
           '" data-v="'+view+'"></div>';
  }
  window.dzSlot = slot;

  // The twelve currencies a listing may be priced in. Same set the signed-in
  // module offers as a transacting currency; the default follows whatever the
  // member picked there, falling back to dollars for anyone who has not.
  var DZ_CURRENCIES = [['USD','USD'],['INR','INR'],['EUR','EUR'],['GBP','GBP'],
    ['JPY','JPY'],['AUD','AUD'],['CAD','CAD'],['SGD','SGD'],['CHF','CHF'],
    ['HKD','HKD'],['NZD','NZD'],['SEK','SEK']];
  function dzPrefCurrency(){
    return (window.__dzStore && window.__dzStore.currency) || 'USD';
  }

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
    if(sec === 'marketplace' && window.currentUser) s += ',price_cents,sale_price_cents';
    return s;
  }
  window.dzSelectFor = selectFor;
  window.dzCatLabel  = labelOf;

  function dzSecLoad(sec){
    var cfg = SEC[sec], host = document.getElementById('fgSecC-'+sec);
    if(!cfg || !host) return;
    // sb is lexical, not on window
    if(!sb){ host.innerHTML = '<div class="dzEmpty">BACKEND NOT CONFIGURED</div>'; return; }
    dzBusy[sec] = true;
    host.innerHTML = '<div class="dzBusy">LOADING…</div>';
    // built up rather than chained in one line, because a section may add a
    // filter of its own (jobs hide anything not published publicly) and may
    // sort on more than one column
    var q = sb.from(cfg.table).select(selectFor(sec)).eq('status','approved');
    if(cfg.eq) Object.keys(cfg.eq).forEach(function(k){ q = q.eq(k, cfg.eq[k]); });
    (cfg.order || [['created_at',false]]).forEach(function(o){
      q = q.order(o[0], {ascending:!!o[1]});
    });
    q.limit(200)
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
        // the one-line hook, which is what it was written for
        (r.summary ? '<div class="dzHint">'+esc(r.summary)+'</div>' : '')+
        '<div class="dzMeta">'+
        (r.featured ? '<span>★ Featured</span>' : '')+
        (r.resource_type ? '<span>'+esc(r.resource_type)+'</span>' : '')+
        '<span>'+esc(bytes(r.file_size))+'</span>'+
        (r.file_count > 1 ? '<span>'+esc(String(r.file_count))+' files</span>' : '')+
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
        // the one-line hook, which is what it was written for
        (r.summary ? '<div class="dzHint">'+esc(r.summary)+'</div>' : '')+
        '<div class="dzMeta">'+
        (r.featured ? '<span>★ Featured</span>' : '')+
        (r.product_type ? '<span>'+esc(r.product_type)+'</span>' : '')+
        '<span>'+esc(r.license||'')+'</span>'+
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
        '<div class="dzMeta" style="margin:.2rem 0 .3rem">'+
        (r.featured ? '<span>★ Featured</span>' : '')+
        (r.content_type ? '<span>'+esc(r.content_type)+'</span>' : '')+
        '<span>'+esc(ago(r.published_at || r.created_at))+'</span>'+
        '<span>'+esc(String(r.read_minutes||1))+' min read</span></div>'+
        '<div class="dzHint">'+esc(ex)+'</div>'+chips(r)+'</div></div>';
    }
    // jobs
    var where = jobWhere(r), pay = jobPay(r);
    return '<div class="dzRow" data-id="'+id+'" onclick="dzOpenView(\'jobs\',\''+id+'\')">'+
      '<div class="dzRowIco">'+esc((r.company||'?').charAt(0).toUpperCase())+'</div>'+
      '<div style="min-width:0;flex:1"><div class="dzName">'+esc(r.title)+'</div>'+
      '<div class="dzMeta" style="margin:.2rem 0 .3rem">'+
      (r.featured ? '<span>★ Featured</span>' : '')+
      '<span>'+esc(r.company)+'</span>'+
      (where ? '<span>'+esc(where)+'</span>' : '')+
      '<span>'+esc(String(r.employment_type||'').replace(/_/g,' '))+'</span>'+
      (pay ? '<span>'+esc(pay)+'</span>' : '')+
      (r.openings > 1 ? '<span>'+esc(String(r.openings))+' openings</span>' : '')+
      '<span>'+esc(ago(r.created_at))+'</span></div>'+chips(r)+'</div></div>';
  }

  // ---- how a posting says where it is, and what it pays ------------------
  // Both read the same way on a card, in the detail view and in a share
  // preview, so they are written once. work_mode is the answer when the row
  // has one; is_remote is the fallback for anything posted before the form
  // could say "hybrid".
  var WORK_MODE_LBL = { remote:'Remote', onsite:'On-site', hybrid:'Hybrid' };
  function jobMode(r){ return r.work_mode || (r.is_remote ? 'remote' : 'onsite'); }
  function jobWhere(r){
    var mode = jobMode(r);
    var place = [r.location_city, r.location_country].filter(Boolean).join(', ');
    if(mode === 'remote') return 'Remote';
    if(mode === 'hybrid') return place ? 'Hybrid · '+place : 'Hybrid';
    return place;
  }
  // money() answers "Free" at zero, which is right for a listing priced at
  // nothing and wrong for a job that pays from zero — an unpaid internship is
  // not a free job. Pay formats its own figures.
  function jobAmount(x, cur){
    var n = Number(x);
    try{
      return new Intl.NumberFormat(undefined,{style:'currency',currency:cur||'USD',
        maximumFractionDigits: n % 1 ? 2 : 0}).format(n);
    }catch(e){ return (n % 1 ? n.toFixed(2) : String(n)) + ' ' + (cur||'USD'); }
  }
  function jobPay(r){
    if(r.salary_min == null && r.salary_max == null) return '';
    var cur = r.salary_currency;
    var parts = [r.salary_min, r.salary_max].filter(function(x){ return x != null; });
    // a flat rate is one figure, not the same figure twice
    if(parts.length === 2 && Number(parts[0]) === Number(parts[1])) parts = [parts[0]];
    return parts.map(function(x){ return jobAmount(x, cur); }).join(' – ')
      + (r.salary_unit ? ' / '+String(r.salary_unit).toLowerCase() : '');
  }
  window.dzJobWhere = jobWhere;
  window.dzJobPay   = jobPay;
  window.dzJobMode  = jobMode;
  window.dzJobModeLbl = WORK_MODE_LBL;

  // upload forms
  var LICENSE_RES = [['personal','Personal use only'],['commercial','Commercial use OK'],
                     ['cc0','CC0 — public domain'],['cc-by','CC BY — credit required'],['custom','Custom terms']];
  var LICENSE_MKT = [['standard','Standard'],['extended','Extended'],['exclusive','Exclusive'],['custom','Custom']];
  var EMP = [['CONTRACTOR','Freelance / contract'],['FULL_TIME','Full-time'],['PART_TIME','Part-time'],
             ['INTERN','Internship'],['TEMPORARY','Temporary'],['VOLUNTEER','Volunteer / collab'],
             ['PER_DIEM','Per diem'],['OTHER','Other']];
  // The employment types that end on a date, and so have to say when.
  // CONTRACTOR is the option labelled "Freelance / contract"; TEMPORARY is
  // the same fixed-term shape under another name.
  var EMP_FIXED_TERM = { CONTRACTOR:1, TEMPORARY:1 };

  // Stored as the label reads, because it is shown as-is and never matched on.
  // Every one of them clears the two character floor the column asks for.
  var EXP_LEVEL = [['Entry','Entry level'],['Junior','Junior'],['Mid','Mid level'],
                   ['Senior','Senior'],['Lead','Lead'],['Principal','Principal'],
                   ['Manager','Manager'],['Director','Director'],['Executive','Executive']];
  var WORK_MODE = [['remote','Remote'],['onsite','On-site'],['hybrid','Hybrid']];
  var PAY_PERIOD = [['HOUR','Per hour'],['DAY','Per day'],['WEEK','Per week'],
                    ['MONTH','Per month'],['YEAR','Per year']];
  var VISIBILITY = [['public','Public — listed in Jobs'],
                    ['unlisted','Unlisted — reachable by link'],
                    ['private','Private — only you']];

  // ---- marketplace vocabulary -------------------------------------------
  // How many files one listing may carry. The signer already caps each file
  // at 200MB and rate limits how fast they arrive; these cap how many, and
  // the table repeats both — 50 as a trigger on marketplace_file, 8 as a
  // check on the gallery column.
  var DZ_SELL_MAX = 50, DZ_GALLERY_MAX = 8;
  var ITEM_TYPE = [['digital','Digital download'],['commission','Commission slot'],['service','Service']];
  // The two listing types that are work rather than a file, and so have a
  // delivery time, a way to get in touch, and no download.
  var ITEM_SERVICE = { commission:1, service:1 };
  // Stored as the label reads. Every one clears the three character floor.
  var PRODUCT_TYPE = [['Artwork','Artwork'],['Template','Template'],['Asset','Asset'],
                      ['Preset','Preset'],['Brush','Brush pack'],['Font','Font'],
                      ['Texture','Texture'],['3D Model','3D model'],['UI Kit','UI kit'],
                      ['Icon Set','Icon set'],['Mockup','Mockup'],['Plugin','Plugin'],
                      ['Tutorial','Tutorial'],['Other','Other']];
  var DELIVERY_TYPE = [['instant','Instant download'],['custom','Custom delivery']];
  var MKT_VISIBILITY = [['published','Published — listed in the Marketplace'],
                        ['draft','Draft — kept, not listed'],
                        ['hidden','Hidden — reachable by link only']];
  // ---- blog vocabulary ---------------------------------------------------
  var CONTENT_TYPE = [['Article','Article'],['Tutorial','Tutorial'],['Guide','Guide'],
                      ['Interview','Interview'],['News','News']];
  var BLOG_VISIBILITY = [['published','Published — listed in the Blog'],
                         ['draft','Draft — kept, not listed'],
                         ['scheduled','Scheduled — goes live at the set time'],
                         ['hidden','Hidden — reachable by link only']];
  // What the system fills in, said out loud. These are not inputs and there is
  // deliberately no box for any of them: a slug someone types drifts from the
  // title, a reading time someone types is wrong, and an author someone types
  // is a byline they may not be entitled to.
  var BLOG_AUTO = [
    ['slug',         'URL slug'],
    ['read_minutes', 'Reading time']
  ];

  // ---- artwork vocabulary ------------------------------------------------
  var ART_MEDIUM = [['Digital painting','Digital painting'],['Digital illustration','Digital illustration'],
                    ['Concept art','Concept art'],['3D render','3D render'],['Pixel art','Pixel art'],
                    ['Vector','Vector'],['Photomanipulation','Photomanipulation'],
                    ['Sketch','Sketch'],['Line art','Line art'],
                    ['Pencil','Pencil — traditional'],['Ink','Ink — traditional'],
                    ['Watercolour','Watercolour — traditional'],['Acrylic','Acrylic — traditional'],
                    ['Oil','Oil — traditional'],['Mixed media','Mixed media'],['Other','Other']];
  // Which of those are made on a computer, and so have software to name. The
  // traditional ones are not asked for it — a watercolour has no software.
  var ART_DIGITAL = { 'Digital painting':1, 'Digital illustration':1, 'Concept art':1,
                      '3D render':1, 'Pixel art':1, 'Vector':1, 'Photomanipulation':1 };
  var ART_LICENSE = [['All rights reserved','All rights reserved'],
                     ['Personal use only','Personal use only'],
                     ['Commercial use allowed','Commercial use allowed'],
                     ['CC BY','CC BY — credit required'],
                     ['CC BY-SA','CC BY-SA — credit, share alike'],
                     ['CC BY-NC','CC BY-NC — credit, non-commercial'],
                     ['CC0','CC0 — public domain'],
                     ['Custom','Custom terms']];
  var ART_VISIBILITY = [['published','Published — shown in the gallery'],
                        ['draft','Draft — kept, not shown'],
                        ['scheduled','Scheduled — goes live at the set time'],
                        ['hidden','Hidden — reachable by link only']];
  // Only what can actually be worked out while the form is being filled in.
  // A created date and a view count cannot show a live value, so they are not
  // listed — a row that reads "--" forever is worse than no row.
  var ART_AUTO = [
    ['file_format',     'File format'],
    ['file_size',       'File size'],
    ['dimensions',      'Dimensions'],
    ['seo_title',       'SEO title'],
    ['seo_description', 'SEO description'],
    ['slug',            'URL slug']
  ];

  // ---- resource vocabulary -----------------------------------------------
  var RESOURCE_TYPE = [['Brush','Brush pack'],['Texture','Texture'],['Font','Font'],
                       ['Template','Template'],['3D Model','3D model'],['Asset','Asset pack'],
                       ['Preset','Preset'],['Action','Action / script'],['Plugin','Plugin'],
                       ['Palette','Colour palette'],['Mockup','Mockup'],['Pattern','Pattern'],
                       ['LUT','LUT'],['Other','Other']];
  var RES_VISIBILITY = [['published','Published — listed in Resources'],
                        ['draft','Draft — kept, not listed'],
                        ['scheduled','Scheduled — goes live at the set time'],
                        ['hidden','Hidden — reachable by link only']];
  // The three licence questions are required answers, not unticked boxes: an
  // unticked box and an unanswered question look identical, and these decide
  // whether someone may sell what they make with the file.
  var YES_NO_PLAIN = [['yes','Yes'],['no','No']];
  // Read off the upload rather than typed. A file format someone types
  // disagrees with the file, and a size someone types is a guess.
  var RES_AUTO = [
    ['file_format', 'File format'],
    ['file_size',   'File size'],
    ['file_count',  'File count'],
    ['dimensions',  'Resolution']
  ];

  // Commercial use is a required answer rather than an unticked box, because
  // an unticked box and an unanswered question look identical and this one
  // decides whether a buyer may earn from what they bought.
  var YES_NO = [['yes','Yes — buyers may use it commercially'],
                ['no','No — personal use only']];

  var FORMS = {
    // The artwork panel is hand-written markup in index.html and predates all
    // of this, so it is not built by buildForm. What it gets instead is these
    // fields, injected into five slots cut into that markup so the whole form
    // still reads in the order it is specified in — a summary between the
    // title and the description, the medium between the category and the
    // tags, and so on. They are ordinary field descriptors, so they carry the
    // same counters, conditions and chip lists as the other four forms.
    artwork: { title:'Upload Artwork', sub:'Share your creativity with artists around the world.',
      fields:[
        {k:'summary', t:'text', slot:1, label:'Short summary', min:20, max:250,
         ph:'One line shown on the card.'},
        {k:'subject_matter', t:'text', slot:2, label:'Subject matter', min:2, max:100,
         ph:'e.g. Character portrait, sci-fi landscape'},
        {k:'medium', t:'sel', slot:2, label:'Artwork type / medium', req:true,
         options:ART_MEDIUM, def:'Digital painting'},
        // Required for digital work, optional for traditional — a watercolour
        // has no software. reqIf makes it required without hiding it, which is
        // what "conditional" means for this one.
        {k:'software_list', t:'list', slot:3, cap:10, imin:2, imax:50,
         label:'Software used', reqIf:'digitalart', ph:'Photoshop, then press Enter',
         hint:'Up to 10. Required for digital work, optional for traditional.'},
        {k:'license', t:'sel', slot:4, label:'License / usage rights', req:true,
         options:ART_LICENSE, def:'All rights reserved'},
        {k:'commercial_use', t:'sel', slot:4, label:'Commercial use allowed', req:true,
         options:YES_NO_PLAIN, def:'no'},
        {k:'attribution_required', t:'sel', slot:4, label:'Attribution required', req:true,
         options:YES_NO_PLAIN, def:'yes'},
        {k:'modification_allowed', t:'sel', slot:4, label:'Modification allowed',
         options:YES_NO_PLAIN, def:'no'},
        {k:'is_mature', t:'sel', slot:4, label:'Mature content', req:true,
         options:YES_NO_PLAIN, def:'no',
         hint:'Say so if it is. The review also marks work it judges mature.'},
        {k:'credits', t:'list', slot:4, cap:20, imin:2, imax:300,
         label:'Credits / collaborators', ph:'Name and role, then press Enter',
         hint:'Models, assistants, client, team.'},
        {k:'process_notes', t:'area', slot:4, label:'Process notes', min:20, max:3000, rows:3,
         ph:'WIP notes, a breakdown, what you were trying.'},
        {k:'external_links', t:'list', slot:4, url:1, cap:5, imin:5, imax:200,
         label:'External links', hint:'Portfolio, source, video, reference. Up to 5.'},
        {k:'comments_allowed', t:'sel', slot:4, label:'Comments allowed',
         options:YES_NO_PLAIN, def:'yes'},
        {k:'visibility', t:'sel', slot:5, label:'Visibility', req:true,
         options:ART_VISIBILITY, def:'published'},
        {k:'featured', t:'chk', slot:5, label:'Feature this artwork',
         hint:'Featured work sits at the top of the gallery.'},
        {k:'__auto', t:'auto', slot:5, label:'Read from your upload', items:ART_AUTO}
      ]},
    // The package, then what is in it, then what may be done with it. The
    // same two ideas as the other three forms: floors and ceilings repeated
    // as table constraints, and a line between what a person types and what
    // is read off the upload — format, size, how many files are inside and
    // the preview's dimensions are all worked out and none has a box.
    resources: { title:'Share a Resource', sub:'Brushes, textures, fonts, templates — anything that helps another artist work faster.',
      fields:[
        {k:'file',   t:'file',  label:'Resource file', req:true,
         accept:'.zip,.rar,.7z,.psd,.abr,.brushset,.procreate,.clip,.ttf,.otf,.woff2,.pdf,.obj,.fbx,.blend',
         hint:'ZIP, PSD, ABR, brushset, fonts, 3D — up to 200MB.'},
        {k:'preview',t:'image', label:'Preview image', req:true,
         accept:'image/jpeg,image/png,image/webp,image/gif',
         hint:'Required. Shown on the card and auto-checked. JPG/PNG/WEBP/GIF up to 25MB.'},
        {k:'title',  t:'text',  label:'Title', req:true, min:3, max:100, ph:'Name your resource…'},
        {k:'summary',t:'text',  label:'Short summary', req:true, min:20, max:250,
         ph:'One line — what it is and who it is for.',
         hint:'Shown on the card and in search results.'},
        {k:'description', t:'area', label:'Description', req:true, min:50, max:5000, rows:6,
         ph:'What it is, how it was made, how it is meant to be used…'},
        {k:'resource_type',t:'sel', label:'Resource type', req:true, options:RESOURCE_TYPE, def:'Brush'},
        {k:'category',t:'cat',  label:'Category', req:true},
        {k:'subcategory',t:'text', label:'Subcategory', min:2, max:50, ph:'e.g. Inking brushes'},
        {k:'tags',    t:'tags', label:'Tags', max:30},
        {k:'license', t:'sel',  label:'License', req:true, options:LICENSE_RES},
        {k:'commercial_use',t:'sel', label:'Commercial use allowed', req:true,
         options:YES_NO_PLAIN, def:'no',
         hint:'Whether someone may sell the work they make with this.'},
        {k:'attribution_required',t:'sel', label:'Attribution required', req:true,
         options:YES_NO_PLAIN, def:'no'},
        {k:'modification_allowed',t:'sel', label:'Modification allowed', req:true,
         options:YES_NO_PLAIN, def:'yes'},
        {k:'software',t:'text', label:'Made with', min:2, max:100, ph:'Photoshop, Procreate…'},
        {k:'compatible_software',t:'list', cap:10, imin:2, imax:50,
         label:'Compatible software', ph:'Photoshop, then press Enter',
         hint:'Up to 10. Press Enter after each.'},
        {k:'compatible_versions',t:'text', label:'Compatible versions', min:2, max:200,
         ph:'e.g. Photoshop CC 2022+'},
        {k:'whats_included',t:'area', label:'What’s included', req:true, min:20, max:2000, rows:4,
         ph:'Every file and asset in the package — one per line.'},
        {k:'instructions',t:'area', label:'Installation / usage instructions', min:20, max:3000, rows:4,
         ph:'How to open, install or load it.'},
        {k:'version',t:'text', label:'Version', min:1, max:30, ph:'e.g. 1.2.4'},
        {k:'external_links',t:'list', url:1, cap:5, imin:5, imax:200,
         label:'External links', hint:'Docs, demo, source, support. Up to 5.'},
        {k:'safety_notes',t:'area', label:'Safety / content notes', min:20, max:500, rows:2,
         ph:'AI assistance, mature content, anything a downloader should know up front.'},
        {k:'visibility',t:'sel', label:'Visibility', req:true, options:RES_VISIBILITY, def:'published'},
        {k:'featured',t:'chk', label:'Feature this resource',
         hint:'Featured resources sit at the top of the list.'},
        {k:'__auto', t:'auto', label:'Read from your upload', items:RES_AUTO}
      ]},
    // A post, and then the things a post is about. The dividing line here is
    // which fields a person fills in and which the system does: slug, author,
    // reading time, publication date and the counters are never asked for,
    // they are derived at publish and shown back by the last card on the form.
    blog: { title:'Write a Post', sub:'Stories, tips and studio notes for the community.',
      fields:[
        {k:'title', t:'text',  label:'Title', req:true, min:5, max:120,
         ph:'Give the post a headline…'},
        {k:'excerpt',t:'area', label:'Excerpt', req:true, min:20, max:300, rows:2,
         ph:'One or two lines shown in the list.'},
        {k:'body',  t:'area',  label:'Post', req:true, min:100, max:20000, rows:12,
         ph:'Write your post…'},
        {k:'cover', t:'image', label:'Cover image',
         accept:'image/jpeg,image/png,image/webp,image/gif',
         hint:'Optional. JPG/PNG/WEBP/GIF up to 25MB.'},
        {k:'category',t:'cat', label:'Category', req:true},
        {k:'tags',  t:'tags',  label:'Tags', max:30},
        {k:'content_type',t:'sel', label:'Content type', req:true, options:CONTENT_TYPE, def:'Article'},
        {k:'related_artworks',t:'pick', label:'Related artwork', src:'artworks', cap:10,
         hint:'Link up to 10 of your own artworks.'},
        {k:'related_items',t:'pick', label:'Related marketplace items', src:'marketplace', cap:10,
         hint:'Link up to 10 of your own listings.'},
        {k:'external_refs',t:'list', url:1, cap:20, imin:5, imax:200, label:'External references / sources',
         hint:'Press Enter after each link. Up to 20.'},
        // 11 is the Schedule picker, which every form on this page already
        // carries — buildForm appends it after the fields.
        {k:'visibility',t:'sel', label:'Visibility', req:true, options:BLOG_VISIBILITY, def:'published'},
        {k:'featured',t:'chk', label:'Feature this post',
         hint:'Featured posts sit at the top of the Blog.'},
        {k:'seo_title',t:'text', label:'SEO title', min:10, max:70,
         ph:'Leave empty and one is made from the title.'},
        {k:'seo_description',t:'area', label:'SEO description', min:50, max:160, rows:2,
         ph:'Leave empty and one is made from the excerpt.'},
        {k:'__auto', t:'auto', label:'Filled in for you', items:BLOG_AUTO}
      ]},
    // The listing, in the order a buyer decides: what it is, what it looks
    // like, what is in it, what they may do with it, what it costs, how it
    // arrives, and then the seller's own bookkeeping. Same floors-and-
    // ceilings rule as the job form — see the note on FORMS.jobs — and the
    // same numbers again as constraints, in
    // 20260809_marketplace_full_listing.sql.
    marketplace: { title:'List a Product', sub:'Sell digital goods, or offer commissions and services.',
      fields:[
        {k:'item_type',t:'sel', label:'Listing type', req:true, options:ITEM_TYPE},
        {k:'product_type',t:'sel', label:'Product type', req:true, options:PRODUCT_TYPE, def:'Artwork'},
        {k:'title',  t:'text',  label:'Title', req:true, min:3, max:100, ph:'Name your listing…'},
        {k:'summary',t:'text',  label:'Short summary', req:true, min:20, max:200,
         ph:'One line — what it is and who it is for.',
         hint:'Shown on the card and in search results.'},
        {k:'description',t:'area', label:'Description', req:true, min:100, max:5000, rows:8,
         ph:'What it is, how it was made, how it is meant to be used…'},
        {k:'category',t:'cat',  label:'Category', req:true},
        {k:'subcategory',t:'text', label:'Subcategory', min:2, max:50, ph:'e.g. Portrait brushes'},
        {k:'tags',   t:'tags',  label:'Tags', max:30},
        {k:'preview',t:'image', label:'Preview image', req:true,
         accept:'image/jpeg,image/png,image/webp,image/gif',
         hint:'Required. Shown on the card and auto-checked. JPG/PNG/WEBP up to 25MB.'},
        {k:'gallery',t:'images', label:'Additional preview images',
         accept:'image/jpeg,image/png,image/webp,image/gif',
         hint:'Optional. Up to 8 more shots, shown on the listing page. 25MB each.'},
        {k:'files',  t:'files', label:'Files to sell', cond:'digital',
         accept:'.zip,.rar,.7z,.psd,.abr,.brushset,.procreate,.clip,.ttf,.otf,.pdf,.obj,.fbx,.blend',
         hint:'Required for a digital download — add every file the buyer receives, up to 200MB each '+
              'and 50 files in all. These are stored privately and stay locked until someone pays.'},
        {k:'buyer_gets',t:'area', label:'What buyer gets', req:true, min:20, max:3000, rows:4,
         ph:'Exactly what is included — one line per thing.'},
        {k:'file_format',t:'text', label:'File format', req:true, min:2, max:100,
         ph:'e.g. ZIP containing PSD + PNG'},
        {k:'file_count',t:'int', label:'File count', nmin:1, nmax:9999, ph:'e.g. 12'},
        {k:'file_size_mb',t:'money', label:'File size (MB)', nmin:0, nmax:100000, ph:'e.g. 240'},
        {k:'dimensions',t:'text', label:'Resolution / dimensions', min:2, max:50,
         ph:'e.g. 4K, or 3000×4000 px'},
        {k:'software',t:'text', label:'Software used', min:2, max:100, ph:'Photoshop, Blender, Figma…'},
        {k:'source_files_included',t:'chk', label:'Source files included',
         hint:'The editable original — PSD, AI, FIG, BLEND.'},
        {k:'license',t:'sel',   label:'License', req:true, options:LICENSE_MKT},
        {k:'commercial_use',t:'sel', label:'Commercial use allowed', req:true, options:YES_NO, def:'yes'},
        {k:'personal_use',t:'chk', label:'Personal use allowed'},
        {k:'modification_allowed',t:'chk', label:'Modification allowed'},
        {k:'attribution_required',t:'chk', label:'Attribution required'},
        {k:'price',  t:'money', label:'Price', req:true, nmin:0, nmax:99999999, ph:'0.00',
         hint:'Enter 0 to list it free.'},
        {k:'currency',t:'sel',  label:'Currency', req:true, options:DZ_CURRENCIES, pref:1},
        // Stored, and deliberately not shown as the price anywhere yet.
        // Checkout charges price_cents, and that lives in the payments module
        // rather than in this file, so a sale price rendered here would be a
        // number the buyer is shown and then not charged. It is captured now
        // and starts applying the moment checkout learns to read it.
        {k:'sale_price',t:'money', label:'Discount / sale price', nmin:0, nmax:99999999, ph:'0.00',
         hint:'Optional, and has to be below the price. Recorded on the listing — checkout does '+
              'not charge it yet, so the price above is still what a buyer pays.'},
        {k:'stock',  t:'int',   label:'Stock / quantity', nmin:0, nmax:999999,
         hint:'Leave empty for an unlimited digital download.'},
        {k:'delivery_type',t:'sel', label:'Delivery type', req:true, options:DELIVERY_TYPE},
        {k:'delivery_days',t:'int', label:'Delivery days', req:true, cond:'svc', nmin:0, nmax:365,
         ph:'e.g. 7'},
        {k:'delivery_notes',t:'area', label:'Delivery notes', min:20, max:1000, rows:2,
         ph:'Anything the buyer should know about timing.'},
        {k:'custom_requests',t:'chk', label:'Custom requests accepted'},
        {k:'revision_count',t:'int', label:'Revision count', nmin:0, nmax:99, ph:'e.g. 2'},
        {k:'support_period',t:'text', label:'Support period', min:2, max:50, ph:'e.g. 7 days'},
        {k:'refund_policy',t:'area', label:'Refund policy', min:20, max:500, rows:2,
         ph:'When you refund, and when you do not.'},
        {k:'preview_watermark',t:'chk', label:'Previews are watermarked'},
        {k:'safety_notes',t:'area', label:'Safety / content notes', min:20, max:500, rows:2,
         ph:'AI assistance, mature content, anything a buyer should know up front.'},
        {k:'seller_note',t:'area', label:'Creator / seller note', min:20, max:500, rows:2,
         ph:'Anything else you want buyers to read.'},
        {k:'apply_url',t:'text', label:'Application link', cond:'svc', min:10, max:200, ph:'https://…'},
        {k:'apply_email',t:'text', label:'Application email', cond:'svc', min:5, max:254,
         ph:'you@studio.com',
         hint:'A commission or service needs a link or an email — one of the two is required.'},
        {k:'visibility',t:'sel', label:'Visibility', req:true, options:MKT_VISIBILITY, def:'published'},
        {k:'featured',t:'chk', label:'Feature / promote this listing',
         hint:'Featured listings sit at the top of the Marketplace.'},
        {k:'closing_date',t:'date', label:'Closing date',
         hint:'Optional. Use it for a limited run or a commission window.'},
        {k:'internal_notes',t:'area', label:'Internal notes', min:20, max:1000, rows:2,
         ph:'Anything the moderators should know.',
         hint:'Only moderators read this. It is never shown to buyers, and it is not readable '+
              'by the site — not even back to you.'},
        {k:'seo_title',t:'text', label:'SEO title', min:3, max:80, ph:'Defaults to the listing title.'},
        {k:'seo_description',t:'area', label:'SEO description', min:50, max:160, rows:2,
         ph:'The snippet a search engine shows.'},
        {k:'slug',   t:'text',  label:'Slug / URL name', min:3, max:120,
         ph:'Leave empty and one is made from the title.'}
      ]},
    // The posting, in the order someone reads a job ad: who is hiring, what
    // the role is, where and when it happens, what it pays, and how to apply.
    // Every text field carries a floor and a ceiling. The ceiling is the hard
    // stop the box refuses to type past; the floor is what the counter turns
    // red under and what the publish button checks. Both are repeated in the
    // table's own constraints — see 20260809_jobs_full_posting.sql — because
    // a form is a courtesy and a constraint is a guarantee.
    jobs: { title:'Post a Job', sub:'Hire an artist, or find someone to build with.',
      fields:[
        {k:'title',  t:'text', label:'Job title', req:true, min:3, max:80,
         ph:'e.g. Character Concept Artist'},
        {k:'company',t:'text', label:'Company / studio', req:true, min:2, max:80,
         ph:'Who is hiring?'},
        {k:'about_company',t:'area', label:'About the company', req:true, min:50, max:2000, rows:4,
         ph:'Who you are, what you make, how the team works…'},
        {k:'company_url',t:'text', label:'Company website', min:5, max:200, ph:'https://…'},
        {k:'category',t:'cat', label:'Category', req:true},
        {k:'employment_type',t:'sel', label:'Employment type', req:true, options:EMP},
        {k:'experience_level',t:'sel', label:'Experience level', req:true, options:EXP_LEVEL, def:'Mid'},
        {k:'years_experience',t:'int', label:'Years of experience', req:true, nmin:0, nmax:60,
         ph:'e.g. 3', hint:'Whole years. 0 means none required.'},
        {k:'openings',t:'int', label:'Number of openings', req:true, nmin:1, nmax:999, ph:'e.g. 1'},
        {k:'description',t:'area', label:'Job overview / description', req:true, min:100, max:5000, rows:8,
         ph:'What the role is, what the team is building, what a week looks like…'},
        {k:'responsibilities',t:'area', label:'Responsibilities', req:true, min:50, max:3000, rows:5,
         ph:'What this person will own — one per line.'},
        {k:'requirements',t:'area', label:'Requirements', req:true, min:50, max:3000, rows:5,
         ph:'What they must bring — one per line.'},
        {k:'required_skills',t:'area', label:'Required skills', req:true, min:10, max:1000, rows:3,
         ph:'e.g. Photoshop, ZBrush, character anatomy'},
        {k:'nice_to_have_skills',t:'area', label:'Nice-to-have skills', min:10, max:1000, rows:3,
         ph:'e.g. Unreal, rigging, motion'},
        {k:'benefits',t:'area', label:'Benefits / perks', min:20, max:2000, rows:3,
         ph:'Health cover, kit budget, paid leave, learning stipend…'},
        {k:'work_mode',t:'sel', label:'Remote / on-site / hybrid', req:true, options:WORK_MODE, def:'remote'},
        {k:'location_city',t:'text', label:'City', req:true, cond:'place', min:2, max:100,
         ph:'e.g. Berlin'},
        {k:'location_country',t:'text', label:'Country code', req:true, cond:'place', min:2, max:2, up:1,
         ph:'e.g. DE', hint:'Two letters, ISO 3166.'},
        {k:'applicant_countries',t:'text', label:'Remote eligible countries', req:true, cond:'remote',
         min:2, max:500, up:1, ph:'e.g. IN, DE, US', hint:'Comma separated country codes.'},
        {k:'timezone',t:'text', label:'Timezone', req:true, min:3, max:50, ph:'e.g. CET (UTC+1)'},
        {k:'working_hours',t:'text', label:'Working hours', req:true, min:3, max:100,
         ph:'e.g. 10:00–18:00, 4h overlap with CET'},
        {k:'schedule',t:'text', label:'Schedule', min:3, max:100, ph:'e.g. Mon–Fri, flexible Fridays'},
        {k:'start_date',t:'date', label:'Start date', req:true, hint:'When the role begins.'},
        {k:'contract_duration',t:'text', label:'Contract duration', req:true, cond:'term', min:2, max:100,
         ph:'e.g. 6 months'},
        {k:'salary_min',t:'money', label:'Pay from', req:true, nmin:0, nmax:99999999, ph:'0'},
        {k:'salary_max',t:'money', label:'Pay to', req:true, nmin:0, nmax:99999999, ph:'0'},
        {k:'salary_currency',t:'sel', label:'Currency', req:true, options:DZ_CURRENCIES, pref:1},
        {k:'salary_unit',t:'sel', label:'Pay period', req:true, options:PAY_PERIOD, def:'MONTH'},
        {k:'apply_url',t:'text', label:'Apply link', min:10, max:200, ph:'https://…'},
        {k:'apply_email',t:'text', label:'Apply email', min:5, max:254, ph:'jobs@studio.com',
         hint:'A link or an email is required — a posting with no way to apply is rejected.'},
        {k:'application_instructions',t:'area', label:'Application instructions', req:true,
         min:20, max:1500, rows:3, ph:'How to apply, what to put in the subject line, what happens next…'},
        {k:'application_materials',t:'area', label:'Required application materials', req:true,
         min:10, max:1000, rows:2, ph:'e.g. Portfolio link, CV, two reference shots'},
        {k:'application_questions',t:'area', label:'Application questions', min:5, max:1000, rows:2,
         ph:'Anything you want every applicant to answer — one per line.'},
        {k:'portfolio_required',t:'chk', label:'Portfolio required'},
        {k:'resume_required',t:'chk', label:'Resume / CV required'},
        {k:'cover_letter_required',t:'chk', label:'Cover letter required'},
        {k:'valid_through',t:'date', label:'Closing date', req:true,
         hint:'Expired postings are hidden automatically.'},
        {k:'tags',  t:'tags', label:'Tags', max:30},
        {k:'visibility',t:'sel', label:'Visibility', req:true, options:VISIBILITY, def:'public'},
        {k:'featured',t:'chk', label:'Feature / promote this posting',
         hint:'Featured postings sit at the top of the jobs list.'}
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
  // the round tinted badge an empty dropzone leads with. It was a white-stroked
  // glyph on no background, which is invisible on the light theme's white
  // surface; it takes the accent from the page now, like the artwork zone's.
  function secIco(sec){
    var k = TAB_ICO[sec] || 'artworks';
    return '<span class="upDzBadge" aria-hidden="true">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '+
      'stroke-linejoin="round">'+SEC_SVG[k]+'</svg></span>';
  }

  // one colour per section, so a chip, its guide sheet and its form icons all
  // speak with the same voice
  var SEC_COLOR = {
    artwork:'var(--upcViolet)', resources:'var(--upcGreen)', blog:'var(--upcBlue)',
    marketplace:'var(--upcAmber)', jobs:'var(--upcPink)'
  };
  // the chip's glyph: the section's own outline, drawn in the section's colour
  function tabIco(sec){
    var k = TAB_ICO[sec] || 'artworks';
    return '<span class="upSecIco" aria-hidden="true">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '+
      'stroke-linecap="round" stroke-linejoin="round">'+SEC_SVG[k]+'</svg></span>';
  }

  function buildTabs(){
    var host = document.getElementById('upSecTabs');
    if(!host || host.childNodes.length) return;
    host.innerHTML = ORDER.map(function(s){
      return '<button class="upSecBtn'+(s==='artwork'?' active':'')+'" id="upSecBtn-'+s+
        '" style="--upA:'+SEC_COLOR[s]+'"'+
        ' role="tab" aria-selected="'+(s==='artwork')+'" onclick="upSwitchSection(\''+s+'\')">'+
        tabIco(s)+'<span>'+TAB_LABEL[s]+'</span></button>';
    }).join('');
  }

  function upSwitchSection(sec, silent){
    buildTabs();               // idempotent
    upSec = sec;
    upGuideRender();           // the (i) follows the open tab
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
      dzArtExtras();          // idempotent, so this is also the open hook
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
    dzCountAll(sec);       // counters start at 0/max, conditional rows decide
    upGrowAll();
    dzSchReset();
    dzDraftStrip(sec);
    dzSchedStrip(sec);
  }

  // guide and tips copy — read by the (i) in the upload bar, one entry per tab
  var GUIDE = {
    artwork: {
      guide: [
        ['🖼','Original work only','Make sure you own the rights to what you post.'],
        ['✦','High quality recommended','Best results come from high resolution files.'],
        ['🛡','Appropriate content','No offensive, hateful or explicit content.'],
        ['❤','Give proper credit','Credit references if you were inspired by others.']
      ],
      tips: ['Use a clear and attractive thumbnail','Add a relevant title and description','Choose the right category','Use relevant tags']
    },
    resources: {
      guide: [
        ['📦','Package it cleanly','ZIP related files together and name folders clearly.'],
        ['🖼','Show a real preview','The preview must depict the actual asset — no AI art.'],
        ['📋','List what is inside','What’s included is required — say every file the download holds.'],
        ['🔖','Answer the licence questions','Commercial use, attribution and modification are all required.'],
        ['🛡','Yours to share','Only upload files you made or are licensed to distribute.']
      ],
      tips: ['Use a descriptive, searchable title','Write the summary for someone skimming a grid',
             'Show the asset in use in the preview','Name the software and versions it opens in',
             'Add installation steps if it is not a double-click',
             'The format, size, file count and resolution are read from your upload']
    },
    blog: {
      guide: [
        ['✍️','Write for artists','Studio notes, tutorials and stories land best.'],
        ['🖼','Add a cover','A strong cover image lifts clicks in the feed.'],
        ['📏','Give it length','Posts need at least 100 characters — aim for a real read.'],
        ['🔗','Show your sources','Link the references a claim rests on, and the work it is about.'],
        ['🛡','Keep it appropriate','No hateful, explicit or plagiarised content.']
      ],
      tips: ['Open with a hook in the first line','Break long posts into short paragraphs',
             'Write the excerpt for someone skimming a list','Pick one clear category',
             'Link your own artwork so readers can see what you mean',
             'The slug, reading time and byline are filled in for you']
    },
    marketplace: {
      guide: [
        ['💾','Digital needs a file','A digital download must include the product file — up to 50 of them.'],
        ['🖼','Preview sells','Show exactly what the buyer receives, and add up to 8 more shots.'],
        ['📦','Say what is in the box','What the buyer gets, the file format and the license are all required.'],
        ['💲','Price fairly','Enter 0 to list free; be clear on delivery time.'],
        ['🛡','Deliver what you list','Misleading listings are removed.']
      ],
      tips: ['Lead with your strongest preview','Write the one-line summary for someone skimming a grid',
             'Spell out every file included and its format','State delivery days for commissions',
             'Answer the license questions — buyers filter on them']
    },
    jobs: {
      guide: [
        ['🧭','Be specific','A real title, scope and skill list draws better applicants.'],
        ['📍','Location or remote','On-site and hybrid roles need a city and country code; a remote one needs the countries you can hire from.'],
        ['💰','Say what it pays','A pay range, a currency and a period are all required — postings without them get ignored.'],
        ['🔗','A way to apply','Include an apply link or email — it is required.'],
        ['🛡','Genuine roles only','No spam, MLM or pay-to-apply postings.']
      ],
      tips: ['Put must-have skills up top','Split responsibilities and requirements — one per line reads best',
             'Name the timezone and the hours you expect overlap in','Describe the team and workflow',
             'Set a closing date so it expires cleanly']
    }
  };

  // ---- the (i) sheet ----------------------------------------------------
  // Every tab has rules of its own, so the sheet is filled from whichever one
  // is open rather than the page carrying four copies of itself.
  function upGuideRender(){
    var body = document.getElementById('upGuideBody');
    if(!body) return;
    var g = GUIDE[upSec] || {guide:[], tips:[]};
    var kick = document.getElementById('upGuideKicker');
    if(kick) kick.textContent = (TAB_LABEL[upSec] || 'Upload').toUpperCase();
    var mod = document.getElementById('upGuideMod');
    if(mod) mod.style.setProperty('--upGdC', SEC_COLOR[upSec] || C_VIO);
    var out = '';
    if(g.guide.length){
      out += '<div class="upGdSec"><h3>What we ask</h3><ul class="upGuideList">'+
        g.guide.map(function(x){
          return '<li><span class="upGIco">'+x[0]+'</span><div><strong>'+esc(x[1])+'</strong>'+esc(x[2])+'</div></li>';
        }).join('')+'</ul></div>';
    }
    if(g.tips.length){
      out += '<div class="upGdSec"><h3>Tips for better visibility</h3><ul class="upTipList">'+
        g.tips.map(function(t){ return '<li>'+esc(t)+'</li>'; }).join('')+'</ul></div>';
    }
    body.innerHTML = out || '<p class="dzHint">Nothing to add for this section yet.</p>';
  }
  function upGuideOpen(){
    var m = document.getElementById('upGuideMod');
    if(!m) return;
    upGuideRender();
    m.classList.add('open');
  }
  function upGuideClose(){
    var m = document.getElementById('upGuideMod');
    if(m) m.classList.remove('open');
  }
  // only the backdrop dismisses; a tap inside the sheet is a tap on the sheet
  function upGuideBackdrop(e){ if(e && e.target && e.target.id === 'upGuideMod') upGuideClose(); }

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
    '<div class="upField upFCard" id="dzSchedField" style="--fc:var(--upcTeal)">'+
      '<span class="upFIco" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '+
        'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+
        '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M16 2.5v4"/>'+
        '<path d="M8 2.5v4"/><path d="M3 10h18"/><path d="M12 13.5v3l2 1"/></svg></span>'+
      '<div class="upFBody">'+
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
      '</div>'+
    '</div>';
  }

  function buildForm(sec){
    var f = FORMS[sec];
    var fields = f.fields.map(function(fd){ return field(sec, fd); }).join('');

    // Same shape as the artwork form: one card holds the pickers and the
    // detail rows, the publish button sits outside it, and the rails follow
    // underneath. Guidelines and tips live in the (i) now, not in a column.
    return ''+
    '<div class="dzUpWrap">'+
      '<div class="dzUpForm"><div class="upMain">'+
        '<div class="upCard"><div class="upFieldsCol">'+
          fields +
          dzSchedField() +
        '</div></div>'+
        // save draft before publish
        '<div class="upActions">'+
          '<button type="button" class="upBtnSec" id="dzDraftBtn-'+sec+'" onclick="dzSaveDraft(\''+sec+'\')">💾 Save Draft</button>'+
          '<button type="button" class="upBtnPri" id="dzSubmit-'+sec+'" onclick="dzSubmit(\''+sec+'\')">Publish</button>'+
        '</div>'+
        '<p class="dzHint" style="margin-top:.9rem">Posts are reviewed before they appear publicly.</p>'+
      '</div></div>'+
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
      '</aside>'+
    '</div>';
  }

  // ---- field glyphs ------------------------------------------------------
  // Each detail row leads with a tinted mark so a long form reads as a list of
  // recognisable things rather than a stack of identical boxes. Keyed by field
  // name where the field deserves its own, by type otherwise.
  var ICO_PENCIL = '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      ICO_LINES  = '<path d="M4 6h16"/><path d="M4 12h11"/><path d="M4 18h7"/>',
      ICO_TAG    = '<path d="M12.9 2.9H4.6A1.7 1.7 0 0 0 2.9 4.6v8.3a2 2 0 0 0 .6 1.4l7.2 7.2a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8l-7.2-7.2a2 2 0 0 0-1.4-.6z"/><circle cx="7.4" cy="7.4" r="1.3"/>',
      ICO_HASH   = '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
      ICO_SLIDER = '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1.5 14h5"/><path d="M9.5 8h5"/><path d="M17.5 16h5"/>',
      ICO_MONEY  = '<path d="M12 1.8v20.4"/><path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      ICO_CAL    = '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M16 2.5v4"/><path d="M8 2.5v4"/><path d="M3 10h18"/>',
      ICO_CHECK  = '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
      ICO_SHIELD = '<path d="M12 21.6s7.6-3.8 7.6-9.6V5.4L12 2.4 4.4 5.4v6.6c0 5.8 7.6 9.6 7.6 9.6Z"/>',
      ICO_SCREEN = '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 16.5V21"/>',
      ICO_BUILD  = '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M9 7h2"/><path d="M13 7h2"/><path d="M9 11h2"/><path d="M13 11h2"/><path d="M10 21.5v-4h4v4"/>',
      ICO_LINK   = '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
      ICO_MAIL   = '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 6 9 6.5L21 6"/>',
      ICO_PIN    = '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
      ICO_COIN   = '<circle cx="12" cy="12" r="9"/><path d="M15 9.4a3.6 3.6 0 1 0 0 5.2"/>',
      ICO_GRID   = '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
      ICO_CLOCK  = '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.2 2"/>',
      ICO_STAIR  = '<path d="M3 20h4v-4h5v-4h5V8h4"/><path d="M3 20v-4"/>',
      ICO_USERS  = '<path d="M16 20v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.4"/><path d="M22 20v-1.8a4 4 0 0 0-3-3.87"/><path d="M16.5 3.6a4 4 0 0 1 0 7.75"/>',
      ICO_LIST   = '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>',
      ICO_CLIP   = '<path d="M15.5 3.5H8.5A2 2 0 0 0 6.5 5.5v13a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2Z"/><path d="M9.5 3.5V2h5v1.5"/><path d="M9.5 9h5"/><path d="M9.5 13h5"/>',
      ICO_STAR   = '<path d="m12 2.8 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.65 6.2 20.7l1.1-6.45-4.7-4.6 6.5-.95Z"/>',
      ICO_EYE    = '<path d="M1.8 12S5.5 5 12 5s10.2 7 10.2 7-3.7 7-10.2 7S1.8 12 1.8 12Z"/><circle cx="12" cy="12" r="3"/>',
      ICO_GLOBE  = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>',
      ICO_SPARK  = '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M4.9 7.5 8 9.3"/><path d="M16 14.7l3.1 1.8"/><path d="M4.9 16.5 8 14.7"/><path d="M16 9.3l3.1-1.8"/><circle cx="12" cy="12" r="3"/>',
      ICO_GIFT   = '<rect x="2.8" y="8.5" width="18.4" height="4" rx="1"/><path d="M4.5 12.5V20a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-7.5"/><path d="M12 8.5V21"/><path d="M12 8.5S10.8 3.5 8 3.5a2.5 2.5 0 0 0 0 5Z"/><path d="M12 8.5s1.2-5 4-5a2.5 2.5 0 0 1 0 5Z"/>',
      ICO_PLANE  = '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.8 18-3.7-7.5L3 9.8Z"/>';

  var C_VIO='var(--upcViolet)', C_GRN='var(--upcGreen)',  C_BLU='var(--upcBlue)',
      C_AMB='var(--upcAmber)',  C_PNK='var(--upcPink)',   C_CYN='var(--upcCyan)',
      C_TEA='var(--upcTeal)',   C_ORG='var(--upcOrange)', C_PUR='var(--upcPurple)',
      C_ROS='var(--upcRose)',   C_YEL='var(--upcYellow)', C_LIL='var(--upcLilac)';

  var FIELD_ICO = {
    title:[C_VIO,ICO_PENCIL],
    description:[C_GRN,ICO_LINES], excerpt:[C_GRN,ICO_LINES], body:[C_GRN,ICO_LINES],
    category:[C_AMB,ICO_TAG],
    tags:[C_CYN,ICO_HASH],
    software:[C_PNK,ICO_SCREEN],
    license:[C_ROS,ICO_SHIELD],
    price:[C_GRN,ICO_MONEY], salary_min:[C_GRN,ICO_MONEY], salary_max:[C_GRN,ICO_MONEY],
    currency:[C_YEL,ICO_COIN], salary_currency:[C_YEL,ICO_COIN],
    item_type:[C_PUR,ICO_GRID], employment_type:[C_PUR,ICO_GRID],
    delivery_days:[C_TEA,ICO_CLOCK], salary_unit:[C_TEA,ICO_CLOCK],
    company:[C_BLU,ICO_BUILD], about_company:[C_BLU,ICO_BUILD],
    company_url:[C_BLU,ICO_LINK], apply_url:[C_BLU,ICO_LINK],
    apply_email:[C_CYN,ICO_MAIL],
    location_city:[C_ORG,ICO_PIN], location_country:[C_ORG,ICO_PIN],
    applicant_countries:[C_ORG,ICO_GLOBE], is_remote:[C_ORG,ICO_PIN],
    work_mode:[C_ORG,ICO_GLOBE],
    valid_through:[C_TEA,ICO_CAL], start_date:[C_TEA,ICO_CAL],
    // the rest of a posting
    experience_level:[C_PUR,ICO_STAIR], years_experience:[C_PUR,ICO_STAIR],
    openings:[C_PNK,ICO_USERS],
    responsibilities:[C_GRN,ICO_LIST], requirements:[C_GRN,ICO_LIST],
    required_skills:[C_CYN,ICO_SPARK], nice_to_have_skills:[C_LIL,ICO_SPARK],
    benefits:[C_ROS,ICO_GIFT],
    timezone:[C_TEA,ICO_GLOBE], working_hours:[C_TEA,ICO_CLOCK], schedule:[C_TEA,ICO_CAL],
    contract_duration:[C_AMB,ICO_CLOCK],
    application_instructions:[C_BLU,ICO_PLANE], application_materials:[C_BLU,ICO_CLIP],
    application_questions:[C_CYN,ICO_LINES],
    portfolio_required:[C_VIO,ICO_CHECK], resume_required:[C_VIO,ICO_CLIP],
    cover_letter_required:[C_VIO,ICO_PENCIL],
    visibility:[C_YEL,ICO_EYE], featured:[C_AMB,ICO_STAR],
    // a post, and the things a post is about
    body:[C_GRN,ICO_LINES], cover:[C_VIO,ICO_SCREEN],
    content_type:[C_PUR,ICO_GRID],
    related_artworks:[C_PNK,ICO_SCREEN], related_items:[C_AMB,ICO_GRID],
    external_refs:[C_BLU,ICO_LINK],
    seo_title:[C_CYN,ICO_SPARK], seo_description:[C_CYN,ICO_SPARK],
    __auto:[C_TEA,ICO_CHECK],
    // a listing
    summary:[C_GRN,ICO_LINES], product_type:[C_PUR,ICO_GRID],
    buyer_gets:[C_GRN,ICO_GIFT], file_format:[C_BLU,ICO_CLIP],
    file_count:[C_BLU,ICO_HASH], file_size_mb:[C_BLU,ICO_HASH],
    dimensions:[C_ORG,ICO_GRID], subcategory:[C_AMB,ICO_TAG],
    source_files_included:[C_ROS,ICO_CLIP], commercial_use:[C_ROS,ICO_SHIELD],
    personal_use:[C_ROS,ICO_SHIELD], modification_allowed:[C_ROS,ICO_SHIELD],
    attribution_required:[C_ROS,ICO_SHIELD],
    sale_price:[C_GRN,ICO_MONEY], stock:[C_TEA,ICO_HASH],
    delivery_type:[C_TEA,ICO_PLANE], delivery_notes:[C_TEA,ICO_LINES],
    custom_requests:[C_LIL,ICO_SPARK], revision_count:[C_LIL,ICO_HASH],
    support_period:[C_TEA,ICO_CLOCK], refund_policy:[C_ROS,ICO_SHIELD],
    preview_watermark:[C_VIO,ICO_SHIELD], safety_notes:[C_ROS,ICO_SHIELD],
    seller_note:[C_PNK,ICO_PENCIL], internal_notes:[C_YEL,ICO_CLIP],
    closing_date:[C_TEA,ICO_CAL], slug:[C_CYN,ICO_LINK],
    // a resource
    file:[C_GRN,ICO_CLIP], preview:[C_VIO,ICO_SCREEN],
    resource_type:[C_PUR,ICO_GRID],
    compatible_software:[C_PNK,ICO_SCREEN], compatible_versions:[C_PNK,ICO_HASH],
    whats_included:[C_GRN,ICO_GIFT], instructions:[C_BLU,ICO_LIST],
    version:[C_TEA,ICO_HASH], external_links:[C_BLU,ICO_LINK],
    modification_allowed:[C_ROS,ICO_SHIELD]
  };
  var TYPE_ICO = {
    text:[C_VIO,ICO_PENCIL], area:[C_GRN,ICO_LINES], num:[C_GRN,ICO_MONEY],
    int:[C_GRN,ICO_HASH], money:[C_GRN,ICO_MONEY],
    date:[C_TEA,ICO_CAL], sel:[C_LIL,ICO_SLIDER], cat:[C_AMB,ICO_TAG],
    tags:[C_CYN,ICO_HASH], chk:[C_TEA,ICO_CHECK]
  };
  function fieldIco(k, t){ return FIELD_ICO[k] || TYPE_ICO[t] || [C_VIO,ICO_PENCIL]; }

  // ---- pick-from-a-list fields ------------------------------------------
  // A native <select> opens the platform's own menu: it arrives in the
  // platform's colours and knows nothing about the row it belongs to. These
  // open the sheet's own dropdown instead, which inherits the row's tint the
  // same way the artwork form's category and software pickers do. The chosen
  // value lives on a hidden input keeping the field's id, so every read, draft
  // save and draft restore path still finds it exactly where it was.
  var DZ_CHEV = '<span class="upChev" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" '+
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
    '<path d="m6 9 6 6 6-6"/></svg></span>';

  function dzSelField(id, opts, want){
    opts = opts || [];
    var cur = null, i;
    for(i=0;i<opts.length;i++){ if(String(opts[i][0]) === String(want)){ cur = opts[i]; break; } }
    if(!cur) cur = opts[0] || ['',''];
    return '<div class="upCatDd" id="'+id+'_dd">'+
      '<button type="button" class="upCatTrigger" id="'+id+'_tr" '+
        'onclick="dzSelToggle(event,\''+id+'\')" aria-haspopup="listbox">'+
        '<span id="'+id+'_lb">'+esc(cur[1])+'</span>'+DZ_CHEV+
      '</button>'+
      '<div class="upCatPanel" id="'+id+'_pn" role="listbox">'+
        opts.map(function(o){
          return '<label class="upCatOpt"><input type="radio" name="'+id+'_r" value="'+esc(o[0])+'"'+
            (String(o[0])===String(cur[0]) ? ' checked' : '')+
            ' onchange="dzSelPick(\''+id+'\',this.value,this.parentNode.textContent)"> '+esc(o[1])+'</label>';
        }).join('')+
      '</div>'+
      '<input type="hidden" id="'+id+'" value="'+esc(cur[0])+'">'+
    '</div>';
  }
  // ---- one menu at a time, everywhere ------------------------------------
  // Every dropdown on either form carries .upCatDd — the section forms' own,
  // and the artwork panel's category, album and schedule pickers, which were
  // written by hand long before any of this. Closing them used to be scoped
  // to #upSecForms, so on the artwork panel nothing closed anything and a
  // member could stack four open menus on top of each other.
  //
  // Exported, because the panel's own toggles live in js/albums.js and
  // js/drafts.js and have to close these too — otherwise the rule only holds
  // in one direction.
  function dzCloseMenus(except){
    var open = document.querySelectorAll('#upSecForms .upCatDd.open, #pfUpMod .upCatDd.open');
    for(var i=0;i<open.length;i++){ if(open[i] !== except) open[i].classList.remove('open'); }
  }
  function dzSelCloseAll(except){ dzCloseMenus(except); }
  function dzSelToggle(e, id){
    if(e) e.stopPropagation();
    var dd = document.getElementById(id+'_dd'); if(!dd) return;
    dzCloseMenus(dd);
    dzSchClose();                      // the section form's schedule picker
    dd.classList.toggle('open');
  }
  function dzSelPick(id, v, label){
    var hid = document.getElementById(id);
    if(hid) hid.value = v;
    var lb = document.getElementById(id+'_lb');
    if(lb) lb.textContent = String(label||'').trim() || v;
    var dd = document.getElementById(id+'_dd');
    if(dd) dd.classList.remove('open');
    // A hidden input written by hand fires no input event, so the rows that
    // only exist for some answers are re-decided here rather than by the
    // listener that watches everything a member types.
    dzCondApply(upSec);
  }
  // a draft restore writes the hidden input directly, so the trigger has to be
  // told what it now says
  function dzSelSync(id){
    var hid = document.getElementById(id), pn = document.getElementById(id+'_pn');
    if(!hid || !pn) return;
    var opts = pn.querySelectorAll('input[type=radio]');
    for(var i=0;i<opts.length;i++){
      var on = String(opts[i].value) === String(hid.value);
      opts[i].checked = on;
      if(on){
        var lb = document.getElementById(id+'_lb');
        if(lb) lb.textContent = String(opts[i].parentNode.textContent||'').trim();
      }
    }
  }
  function dzSelSyncAll(sec){
    (FORMS[sec] ? FORMS[sec].fields : []).forEach(function(fd){
      if(fd.t === 'sel' || fd.t === 'cat') dzSelSync('dz_'+sec+'_'+fd.k);
    });
  }
  // a click anywhere outside an open menu closes it, on either form
  document.addEventListener('click', function(ev){
    var open = document.querySelectorAll('#upSecForms .upCatDd.open, #pfUpMod .upCatDd.open');
    for(var i=0;i<open.length;i++){
      if(!open[i].contains(ev.target)) open[i].classList.remove('open');
    }
  });
  // wrap a control as one detail row
  function fcard(k, t, inner, extra){
    var ic = fieldIco(k, t);
    return '<div class="upField upFCard'+(extra||'')+'" style="--fc:'+ic[0]+'" data-fk="'+esc(k)+'">'+
      '<span class="upFIco" aria-hidden="true">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '+
        'stroke-linecap="round" stroke-linejoin="round">'+ic[1]+'</svg>'+
      '</span>'+
      '<div class="upFBody">'+inner+'</div>'+
    '</div>';
  }

  // ---- the limits a box keeps to itself ---------------------------------
  // Every text field carries a floor and a ceiling. The ceiling is enforced
  // by the box: maxlength on the element means the keystroke past it simply
  // never lands, so there is nothing to warn about and nothing to reject —
  // the text does not enter. The floor cannot work that way, because a field
  // is under it the whole time it is being filled in, so it is shown instead:
  // the counter goes red under the floor and back to the page's own ink over
  // it, and publish refuses while any of them is still red.
  //
  // The counter is written next to the label rather than floated inside the
  // box, so it reads the same on a one-line input and on an eight-row
  // textarea and never sits on top of what is being typed.
  function limitAttrs(fd){
    var out = '';
    if(fd.min) out += ' data-min="'+fd.min+'"';
    if(fd.max) out += ' data-cmax="'+fd.max+'"';
    if(fd.up)  out += ' data-up="1"';
    return out;
  }
  function labelFor(id, fd){
    var lbl = '<label class="upLbl" for="'+id+'">'+esc(fd.label)+
      (fd.req ? ' <span class="upReq">*</span>' : '')+'</label>';
    // The counter is there to show the floor, so it appears on the fields
    // that have one and nowhere else — which is every text field on the job
    // form and none of the ones on the other three, whose ceilings are
    // enforced by maxlength exactly as they always were.
    //
    // A tag box's input holds one tag being typed rather than the value of
    // the field, so a running count of it would be counting the wrong thing.
    if(!fd.min || fd.t === 'tags') return lbl;
    return '<div class="upLblRow">'+lbl+
      '<span class="upCount upCountInline" id="'+id+'_c" aria-live="off"></span></div>';
  }

  function field(sec, fd){
    var id = 'dz_'+sec+'_'+fd.k;
    var lbl = labelFor(id, fd);
    var hint = fd.hint ? '<div class="dzHint">'+esc(fd.hint)+'</div>' : '';
    var cond = fd.cond ? ' upFCond' : '';
    var body = '';

    if(fd.t === 'text'){
      body = '<input class="upIn" id="'+id+'" type="text" maxlength="'+(fd.max||200)+'"'+
             limitAttrs(fd)+' placeholder="'+esc(fd.ph||'')+'">';
    } else if(fd.t === 'num'){
      body = '<input class="upIn" id="'+id+'" type="number" min="0" step="'+(fd.step||'1')+
             '" placeholder="'+esc(fd.ph||'')+'">';
    } else if(fd.t === 'int' || fd.t === 'money'){
      // Not type=number. A number input hands back an empty string for
      // anything it considers malformed, which makes "what did they actually
      // type" unanswerable, and it accepts e, + and - along the way. This is
      // a text box the keystroke filter below keeps numeric, so a digit that
      // would take the figure past its ceiling never lands at all.
      body = '<input class="upIn" id="'+id+'" type="text" autocomplete="off" '+
             'inputmode="'+(fd.t === 'int' ? 'numeric' : 'decimal')+'" '+
             'data-num="'+fd.t+'" data-nmin="'+(fd.nmin != null ? fd.nmin : 0)+'" '+
             'data-nmax="'+(fd.nmax != null ? fd.nmax : 999999999)+'" '+
             'placeholder="'+esc(fd.ph||'')+'">';
    } else if(fd.t === 'date'){
      body = '<input class="upIn" id="'+id+'" type="date">';
    } else if(fd.t === 'area'){
      body = '<textarea class="upIn" id="'+id+'" rows="'+(fd.rows||4)+'" maxlength="'+(fd.max||2000)+'"'+
             limitAttrs(fd)+' placeholder="'+esc(fd.ph||'')+'"></textarea>';
    } else if(fd.t === 'sel'){
      // A pref field opens on the member's own transacting currency rather
      // than on whatever happens to be first in the list; a field with a
      // stated default opens on that; everything else on its first option.
      var want = fd.pref ? dzPrefCurrency() : (fd.def != null ? fd.def : null);
      body = dzSelField(id, fd.options || [], want);
    } else if(fd.t === 'chk'){
      return fcard(fd.k, fd.t, '<label class="upCatOpt upFChk">'+
             '<input type="checkbox" id="'+id+'"> '+esc(fd.label)+'</label>'+hint, cond);
    } else if(fd.t === 'cat'){
      var opts = (window.FG_SECTIONS && FG_SECTIONS[sec] && FG_SECTIONS[sec].opts) || [];
      body = dzSelField(id, opts.map(function(o){ return [slugify(o), o]; }), null);
    } else if(fd.t === 'pick'){
      // Your own work, chosen from a list rather than typed as an id. The
      // chosen ids live on a hidden input keeping the field's name, so every
      // read, draft save and draft restore path finds it where it expects to.
      body = '<div class="upCatDd" id="'+id+'_dd">'+
        '<button type="button" class="upCatTrigger" id="'+id+'_tr" aria-haspopup="listbox" '+
          'onclick="dzPickToggle(event,\''+id+'\',\''+esc(fd.src||'artworks')+'\','+(fd.cap||10)+')">'+
          '<span id="'+id+'_lb">Nothing linked</span>'+DZ_CHEV+
        '</button>'+
        '<div class="upCatPanel" id="'+id+'_pn" role="listbox">'+
          '<div class="dzHint" style="padding:.4rem .5rem">Open to load your work…</div>'+
        '</div>'+
        '<input type="hidden" id="'+id+'" value="">'+
      '</div>';
    } else if(fd.t === 'list'){
      // A chip list, the same shape the tag box has, for anything that is a
      // handful of short things rather than one long one — source links,
      // the software a resource opens in. Whether an entry has to be a url is
      // the field's own business; everything else about it is shared.
      var isUrl = !!fd.url;
      body = '<div class="upTagBox" onclick="document.getElementById(\''+id+'_in\').focus()">'+
        '<span id="'+id+'_chips"></span>'+
        '<input class="upTagInput" id="'+id+'_in" type="'+(isUrl ? 'url' : 'text')+'" '+
          'maxlength="'+(fd.imax||200)+'" '+
          'placeholder="'+esc(fd.ph || (isUrl ? 'https://… then press Enter' : 'Type one, then press Enter'))+'" '+
          'onkeydown="dzRefKey(event,\''+id+'\','+(fd.cap||10)+','+(fd.imin||1)+','+
            (fd.imax||200)+','+(isUrl?1:0)+')"></div>'+
        '<input type="hidden" id="'+id+'" value="">';
    } else if(fd.t === 'auto'){
      // Not an input, and deliberately so. It is here to answer "where did
      // the slug and the reading time go" without offering a box to get them
      // wrong in.
      return fcard(fd.k, fd.t,
        '<label class="upLbl">'+esc(fd.label)+' <span class="upOpt">automatic</span></label>'+
        '<div class="dzvMeta upAutoList" style="margin-top:.35rem">'+
          (fd.items||[]).map(function(x){
            // the value starts as a placeholder and is filled in the moment
            // there is something to fill it from
            return '<div class="dzvMetaRow"><span>'+esc(x[1])+'</span>'+
              '<b id="dzAuto_'+sec+'_'+esc(x[0])+'">'+DZ_AUTO_EMPTY+'</b></div>';
          }).join('')+
        '</div>', cond);
    } else if(fd.t === 'tags'){
      return fcard(fd.k, fd.t, lbl+
        '<div class="upTagBox" onclick="document.getElementById(\''+id+'\').focus()">'+
        '<span id="dzTags-'+sec+'"></span>'+
        '<input class="upTagInput" id="'+id+'" maxlength="'+((fd.max||20)*10+20)+'" '+
        'placeholder="anime, chr, genshin impact…" '+
        'onkeydown="dzTagKey(event,\''+sec+'\')" '+
        'onblur="dzTagBlur(event,\''+sec+'\')" '+
        'onpaste="dzTagPaste(event,\''+sec+'\')"></div>'+hint, cond);
    } else if(fd.t === 'file' || fd.t === 'image'){
      // dropzone instead of file input
      var acc   = fd.accept ? fd.accept : (fd.t === 'image' ? 'image/*' : '');
      var isImg = fd.t === 'image';
      var args  = '\''+sec+'\',\''+fd.k+'\'';
      return '<div class="upField dzFileField'+cond+'" data-fk="'+esc(fd.k)+'">'+lbl+
        '<div class="dzFileZone" id="'+id+'_z"'+
          ' ondragenter="dzDragOn(event,\''+id+'\')" ondragover="dzDragOn(event,\''+id+'\')"'+
          ' ondragleave="dzDragOff(event,\''+id+'\')" ondrop="dzDropFile(event,'+args+')">'+
          '<input class="dzFileIn" id="'+id+'" type="file" accept="'+esc(acc)+'"'+
            ' aria-label="'+esc(fd.label)+'"'+
            ' onclick="if(typeof pfGuestGate===\'function\'&&pfGuestGate(event))return;"'+
            ' onchange="dzPick('+args+',this)">'+
          '<div class="dzFileEmpty">'+
            secIco(sec)+
            '<div class="dzFileCopy">'+
              '<div class="dzFileTitle">Drag &amp; drop your '+(isImg ? 'image' : 'file')+' here</div>'+
              '<div class="dzFileSub">or browse from your device</div>'+
            '</div>'+
            '<span class="dzFileBtn">'+(isImg ? 'Select image' : 'Select file')+'</span>'+
            '<div class="dzFileTypes">'+esc(acceptLabel(acc, isImg))+'</div>'+
          '</div>'+
          '<div class="dzFilePicked" id="'+id+'_pk"></div>'+
        '</div>'+hint+'</div>';
    } else if(fd.t === 'files' || fd.t === 'images'){
      // The same dropzone, holding a list instead of one file. A listing is
      // whatever the buyer receives, and that is rarely a single object; the
      // gallery is the same shape with pictures in it.
      var isPics = fd.t === 'images';
      var macc  = fd.accept || (isPics ? 'image/*' : '');
      var margs = '\''+sec+'\',\''+fd.k+'\'';
      return '<div class="upField dzFileField'+cond+'" data-fk="'+esc(fd.k)+'">'+lbl+
        '<div class="dzFileZone dzFileZone--multi" id="'+id+'_z"'+
          ' ondragenter="dzDragOn(event,\''+id+'\')" ondragover="dzDragOn(event,\''+id+'\')"'+
          ' ondragleave="dzDragOff(event,\''+id+'\')" ondrop="dzDropFile(event,'+margs+')">'+
          '<input class="dzFileIn" id="'+id+'" type="file" multiple accept="'+esc(macc)+'"'+
            ' aria-label="'+esc(fd.label)+'"'+
            ' onclick="if(typeof pfGuestGate===\'function\'&&pfGuestGate(event))return;"'+
            ' onchange="dzPick('+margs+',this)">'+
          '<div class="dzFileEmpty">'+
            secIco(sec)+
            '<div class="dzFileCopy">'+
              '<div class="dzFileTitle">'+(isPics
                 ? 'Drag &amp; drop more preview images'
                 : 'Drag &amp; drop the files you are selling')+'</div>'+
              '<div class="dzFileSub">or browse from your device — you can add several</div>'+
            '</div>'+
            '<span class="dzFileBtn">'+(isPics ? 'Select images' : 'Select files')+'</span>'+
            '<div class="dzFileTypes">'+esc(acceptLabel(macc, isPics))+'</div>'+
          '</div>'+
          '<div class="dzFilePicked dzFileMulti" id="'+id+'_pk"></div>'+
        '</div>'+hint+'</div>';
    }
    return fcard(fd.k, fd.t, lbl+body+hint, cond);
  }

  // ---- linking your own work --------------------------------------------
  // The list is the caller's own rows and nothing else. That is not a display
  // choice: a picker that offered everyone's work would let a post attach
  // itself to a stranger's artwork, and the row it wrote would be indexed as
  // theirs. Loaded once, on first open, because most posts link nothing.
  var PICK_SRC = {
    artworks:    { table:'artworks', label:'name', extra:'title', where:{kind:'art'}, empty:'You have not uploaded any artwork yet.' },
    marketplace: { table:'marketplace_items', label:'title', where:null, empty:'You have no marketplace listings yet.' }
  };
  function dzPickIds(id){
    var hid = document.getElementById(id);
    return String((hid && hid.value) || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
  }
  function dzPickLabel(id, cap){
    var n = dzPickIds(id).length;
    var lb = document.getElementById(id+'_lb');
    if(lb) lb.textContent = n ? (n + ' of ' + cap + ' linked') : 'Nothing linked';
  }
  function dzPickToggle(e, id, src, cap){
    if(e) e.stopPropagation();
    var dd = document.getElementById(id+'_dd'); if(!dd) return;
    dzCloseMenus(dd);
    dzSchClose();
    var opening = !dd.classList.contains('open');
    dd.classList.toggle('open', opening);
    if(opening && !dd.dataset.loaded) dzPickLoad(id, src, cap);
  }
  function dzPickLoad(id, src, cap){
    var pn = document.getElementById(id+'_pn'), dd = document.getElementById(id+'_dd');
    var cfg = PICK_SRC[src];
    if(!pn || !cfg) return;
    if(!sb || !window.currentUser){
      pn.innerHTML = '<div class="dzHint" style="padding:.4rem .5rem">Sign in to link your work.</div>';
      return;
    }
    pn.innerHTML = '<div class="dzHint" style="padding:.4rem .5rem">Loading…</div>';
    var cols = ['id', cfg.label].concat(cfg.extra ? [cfg.extra] : []).join(',');
    var q = sb.from(cfg.table).select(cols).eq('user_id', currentUser.id);
    if(cfg.where) Object.keys(cfg.where).forEach(function(k){ q = q.eq(k, cfg.where[k]); });
    q.order('created_at', {ascending:false}).limit(200).then(function(res){
      var rows = (res && res.data) || [];
      if(!rows.length){
        pn.innerHTML = '<div class="dzHint" style="padding:.4rem .5rem">'+esc(cfg.empty)+'</div>';
        return;
      }
      var chosen = dzPickIds(id), mark = {};
      chosen.forEach(function(x){ mark[x] = 1; });
      pn.innerHTML = rows.map(function(r){
        var name = r[cfg.label] || (cfg.extra && r[cfg.extra]) || 'Untitled';
        return '<label class="upCatOpt"><input type="checkbox" value="'+esc(r.id)+'"'+
          (mark[r.id] ? ' checked' : '')+
          ' onchange="dzPickSet(\''+id+'\','+cap+')"> '+esc(name)+'</label>';
      }).join('');
      if(dd) dd.dataset.loaded = '1';
      dzPickLabel(id, cap);
    }, function(){
      pn.innerHTML = '<div class="dzHint" style="padding:.4rem .5rem">Could not load your work.</div>';
    });
  }
  function dzPickSet(id, cap){
    var pn = document.getElementById(id+'_pn'), hid = document.getElementById(id);
    if(!pn || !hid) return;
    var boxes = pn.querySelectorAll('input[type=checkbox]'), out = [];
    for(var i=0;i<boxes.length;i++){
      if(!boxes[i].checked) continue;
      if(out.length >= cap){
        // the ceiling again: the one past the limit does not go in
        boxes[i].checked = false;
        showToast('That is the limit — ' + cap);
        continue;
      }
      out.push(boxes[i].value);
    }
    hid.value = out.join(',');
    dzPickLabel(id, cap);
  }
  // a restored draft writes the hidden input directly, so the trigger has to
  // be told what it now says — and the checkboxes are re-marked on next open
  function dzPickSyncAll(sec){
    (FORMS[sec] ? FORMS[sec].fields : []).forEach(function(fd){
      if(fd.t !== 'pick') return;
      var id = 'dz_'+sec+'_'+fd.k, dd = document.getElementById(id+'_dd');
      if(dd) delete dd.dataset.loaded;      // reload so the ticks match
      dzPickLabel(id, fd.cap || 10);
    });
  }

  // ---- a list of links ---------------------------------------------------
  // Kept on a hidden input, newline separated, for the same reason the picker
  // is: it makes the field indistinguishable from a text box to every draft
  // and publish path that already exists.
  function dzRefList(id){
    var hid = document.getElementById(id);
    return String((hid && hid.value) || '').split('\n').map(function(x){ return x.trim(); }).filter(Boolean);
  }
  function dzRefsRender(id){
    var host = document.getElementById(id+'_chips');
    if(!host) return;
    host.innerHTML = dzRefList(id).map(function(u, i){
      // shown short, stored whole
      var show = u.replace(/^https?:\/\//i, '').slice(0, 40);
      return '<span class="upTagChip" title="'+esc(u)+'">'+esc(show)+
        '<button type="button" onclick="dzRefDel(\''+id+'\','+i+')" aria-label="Remove link">✕</button></span>';
    }).join('');
  }
  function dzRefKey(e, id, cap, imin, imax, isUrl){
    if(e.key !== 'Enter') return;          // a comma is legal inside a url
    e.preventDefault();
    var inp = e.target, hid = document.getElementById(id);
    if(!hid) return;
    imin = imin || 1; imax = imax || 200;
    var v = String(inp.value||'').trim();
    // a link typed the way people say it is still a link
    if(isUrl) v = dzWebUrl(v);
    if(!v) return;
    if(v.length < imin || v.length > imax){
      showToast((isUrl ? 'A link' : 'Each entry') + ' has to be '+imin+'–'+imax+' characters');
      return;
    }
    var list = dzRefList(id);
    if(list.length >= cap){
      showToast('That is the limit — ' + cap + (isUrl ? ' links' : ' entries'));
      return;
    }
    if(list.indexOf(v) === -1) list.push(v);
    hid.value = list.join('\n');
    inp.value = '';
    dzRefsRender(id);
  }
  function dzRefDel(id, i){
    var hid = document.getElementById(id);
    if(!hid) return;
    var list = dzRefList(id);
    list.splice(i, 1);
    hid.value = list.join('\n');
    dzRefsRender(id);
  }
  function dzRefsAll(sec){
    (FORMS[sec] ? FORMS[sec].fields : []).forEach(function(fd){
      if(fd.t === 'list') dzRefsRender('dz_'+sec+'_'+fd.k);
    });
  }

  // ---- rows that only exist for some answers ----------------------------
  // A city on a fully remote posting and a list of eligible countries on an
  // on-site one are both noise, and asking for a contract length on a
  // permanent role is worse than noise. Each conditional row states which
  // question it hangs off; the row is in the form or it is not, and a row
  // that is not there is neither required nor read when publishing.
  var COND = {
    place:   function(v){ return v.work_mode !== 'remote'; },
    remote:  function(v){ return v.work_mode === 'remote'; },
    term:    function(v){ return !!EMP_FIXED_TERM[v.employment_type]; },
    // a commission or a service is work, not a file
    svc:     function(v){ return !!ITEM_SERVICE[v.item_type]; },
    digital: function(v){ return v.item_type === 'digital'; },
    // a watercolour has no software to name; a digital painting does
    digitalart: function(v){ return !!ART_DIGITAL[v.medium]; }
  };
  function dzCondShow(sec, fd){
    if(!fd || !fd.cond) return true;
    var f = COND[fd.cond];
    if(!f) return true;
    return !!f(dzCondState(sec));
  }
  function dzCondState(sec){
    return {
      work_mode: val(sec,'work_mode'),
      employment_type: val(sec,'employment_type'),
      item_type: val(sec,'item_type'),
      medium: val(sec,'medium')
    };
  }
  // Required-when, as opposed to shown-when. A field with reqIf is always on
  // the form; what changes is whether publish will let it stay empty.
  function dzCondReq(sec, fd){
    if(!fd) return false;
    if(fd.req) return true;
    if(!fd.reqIf) return false;
    var f = COND[fd.reqIf];
    return !!(f && f(dzCondState(sec)));
  }
  function dzCondApply(sec){
    if(!FORMS[sec]) return;
    FORMS[sec].fields.forEach(function(fd){
      if(!fd.cond) return;
      var el = document.getElementById('dz_'+sec+'_'+fd.k);
      var card = el && el.closest ? el.closest('.upField') : null;
      if(card) card.classList.toggle('upFHide', !dzCondShow(sec, fd));
    });
  }

  // ---- the artwork panel's extra fields ----------------------------------
  // Five empty divs cut into the hand-written markup, each filled with the
  // fields whose slot number it carries. Doing it this way rather than
  // writing eighteen more cards into index.html by hand is what lets the
  // artwork form share the counters, the conditions and the chip lists with
  // the other four instead of growing its own copies of all three.
  var ART_SLOTS = ['pfUpX1','pfUpX2','pfUpX3','pfUpX4','pfUpX5'];
  function dzArtExtras(){
    if(!FORMS.artwork) return;
    var any = false;
    ART_SLOTS.forEach(function(hostId, i){
      var host = document.getElementById(hostId);
      if(!host) return;
      any = true;
      if(host.getAttribute('data-built')) return;      // idempotent
      var slot = i + 1;
      host.innerHTML = FORMS.artwork.fields.filter(function(fd){
        return fd.slot === slot;
      }).map(function(fd){ return field('artwork', fd); }).join('');
      host.setAttribute('data-built', '1');
    });
    if(!any) return;
    // The panel shipped with a one-of-ten software picker. Software is a list
    // now, so the old control is stood down rather than left to disagree with
    // the new one.
    var old = document.getElementById('pfUpSoftwareField');
    if(old) old.style.display = 'none';
    dzCountAll('artwork');
  }
  // after a publish, so the next upload starts clean
  function dzArtReset(){
    dzAutoReset('artwork');
    ART_SLOTS.forEach(function(id){
      var h = document.getElementById(id);
      if(h) h.removeAttribute('data-built');
    });
    dzArtExtras();
  }
  // what publish checks before it uploads anything
  function dzArtValidate(){
    if(!FORMS.artwork) return null;
    var fds = FORMS.artwork.fields;
    for(var i=0;i<fds.length;i++){
      var fd = fds[i];
      if(fd.t === 'auto' || fd.t === 'chk') continue;
      if(!dzCondReq('artwork', fd)) continue;
      if(!dzCondShow('artwork', fd)) continue;
      if(!val('artwork', fd.k)) return {k:fd.k, msg:'Missing: ' + fd.label};
    }
    return dzLimits('artwork');
  }
  // ---- the artwork panel's own drafts ------------------------------------
  // Saved as raw control values rather than as the row they turn into, so
  // restoring is a straight write-back and a draft saved before a field
  // existed simply has nothing to say about it.
  function dzArtSnapshot(){
    var out = {};
    (FORMS.artwork ? FORMS.artwork.fields : []).forEach(function(fd){
      if(fd.t === 'auto') return;
      var el = document.getElementById('dz_artwork_'+fd.k);
      if(!el) return;
      out[fd.k] = (el.type === 'checkbox') ? el.checked : el.value;
    });
    return out;
  }
  function dzArtRestore(data){
    if(!data) return;
    dzArtExtras();                       // make sure the slots exist
    (FORMS.artwork ? FORMS.artwork.fields : []).forEach(function(fd){
      if(fd.t === 'auto' || !(fd.k in data)) return;
      var el = document.getElementById('dz_artwork_'+fd.k);
      if(!el) return;
      if(el.type === 'checkbox') el.checked = !!data[fd.k];
      else el.value = data[fd.k];
    });
    dzSelSyncAll('artwork');             // the triggers read their hidden inputs back
    dzCountAll('artwork');               // counters, chips and conditions follow
  }

  // A stored artwork, turned back into the control values the panel holds.
  // Editing a piece has to start from what the piece says, or saving it would
  // write the form's defaults over the answers the uploader actually gave.
  function dzArtFromRow(a){
    a = a || {};
    function yn(v){ return v ? 'yes' : 'no'; }
    var sw = (a.software_list && a.software_list.length)
      ? a.software_list
      : (a.software ? [a.software] : []);          // rows from before the list existed
    return {
      summary: a.summary || '',
      subject_matter: a.subject_matter || '',
      medium: a.medium || 'Digital painting',
      software_list: sw.join('\n'),
      license: a.license || 'All rights reserved',
      commercial_use: yn(a.commercial_use),
      attribution_required: yn(a.attribution_required),
      modification_allowed: yn(a.modification_allowed),
      is_mature: yn(a.is_mature),
      credits: (a.credits || []).join('\n'),
      process_notes: a.process_notes || '',
      external_links: (a.external_links || []).join('\n'),
      comments_allowed: a.comments_allowed === false ? 'no' : 'yes',
      visibility: a.visibility || 'published',
      featured: !!a.featured
    };
  }

  // the half of the row these fields account for
  function dzArtValues(){
    function v(k){ return val('artwork', k); }
    return {
      summary: v('summary') || null,
      subject_matter: v('subject_matter') || null,
      medium: v('medium') || null,
      software_list: dzRefList('dz_artwork_software_list').slice(0, 10),
      license: v('license') || null,
      commercial_use: v('commercial_use') === 'yes',
      attribution_required: v('attribution_required') === 'yes',
      modification_allowed: v('modification_allowed') === 'yes',
      // the uploader's own declaration; moderation may still add its own
      declared_mature: v('is_mature') === 'yes',
      credits: dzRefList('dz_artwork_credits').slice(0, 20),
      process_notes: v('process_notes') || null,
      external_links: dzRefList('dz_artwork_external_links').slice(0, 5),
      comments_allowed: v('comments_allowed') !== 'no',
      visibility: v('visibility') || 'published',
      featured: v('featured') === true
    };
  }

  // ---- Automatic Details, live ------------------------------------------
  // The card shows what the system will store, worked out from what is on
  // the form right now. Everything here is computed in the browser and
  // written nowhere — the values that end up in the row are still produced by
  // the publish path exactly as they were, so nothing is saved a keystroke at
  // a time and the stored result does not depend on this card having run.
  //
  // What is read off a file is read once per file rather than once per
  // keystroke: scanning a zip's directory or decoding an image to measure it
  // is far too expensive to repeat while somebody types a title. The token
  // below is what makes that safe — a repaint with the same files does no
  // work at all.
  var DZ_AUTO_EMPTY = '--';
  var dzAutoRead = {};

  function dzFileExt(f){
    var m = /\.([a-z0-9]{1,8})$/i.exec(String((f && f.name) || ''));
    if(m) return m[1].toUpperCase();
    var t = String((f && f.type) || '').split('/')[1];
    return t ? t.toUpperCase() : null;
  }
  function dzAutoSet(sec, key, v){
    var el = document.getElementById('dzAuto_'+sec+'_'+key);
    if(!el) return;
    el.textContent = (v === null || v === undefined || v === '') ? DZ_AUTO_EMPTY : String(v);
  }
  // the cheap half: everything derived from text, repainted freely
  function dzAutoPaint(sec){
    if(!dzField(sec, '__auto')) return;
    var read = dzAutoRead[sec] || {};
    var title, body;
    if(sec === 'artwork'){
      var nm = document.getElementById('pfUpNm'), ds = document.getElementById('pfUpDesc');
      title = String((nm && nm.value) || '').trim();
      body  = String((ds && ds.value) || '').trim();
      dzAutoSet(sec, 'file_format', read.file_format);
      dzAutoSet(sec, 'file_size',   read.file_size);
      dzAutoSet(sec, 'dimensions',  read.dimensions);
      dzAutoSet(sec, 'seo_title',       title ? dzSeoTitle('', title) : null);
      dzAutoSet(sec, 'seo_description', dzSeoDesc('', body, body));
      // the base the publish path slugifies; it appends the uniquifier there,
      // and that logic is untouched
      dzAutoSet(sec, 'slug', title ? slugify(title).slice(0, 110) : null);
    } else if(sec === 'blog'){
      title = val(sec, 'title');
      body  = val(sec, 'body');
      dzAutoSet(sec, 'slug', title ? slugify(title).slice(0, 110) : null);
      dzAutoSet(sec, 'read_minutes', body ? (dzReadMinutes(body) + ' min') : null);
    } else if(sec === 'resources'){
      dzAutoSet(sec, 'file_format', read.file_format);
      dzAutoSet(sec, 'file_size',   read.file_size);
      dzAutoSet(sec, 'file_count',  read.file_count);
      dzAutoSet(sec, 'dimensions',  read.dimensions);
    }
  }
  // the expensive half: what the files themselves say, read once per file
  async function dzAutoScan(sec){
    if(!dzField(sec, '__auto')) return;
    var main = null, pic = null;
    if(sec === 'artwork'){
      main = pic = (window.pf && pf.upFile) || null;   // the artwork is the image
    } else if(sec === 'resources'){
      main = st(sec).files.file || null;
      pic  = st(sec).files.preview || null;
    }
    function tok(f){ return f ? (f.name+'|'+f.size+'|'+(f.lastModified||0)) : ''; }
    var tm = tok(main), tp = tok(pic);
    var read = dzAutoRead[sec];
    if(read && read.__m === tm && read.__p === tp) return;   // same files, nothing to redo

    read = dzAutoRead[sec] = { __m:tm, __p:tp,
      file_format: main ? dzFileExt(main) : null,
      file_size:   main ? (bytes(main.size) || null) : null,
      file_count:  null,
      dimensions:  null
    };
    dzAutoPaint(sec);            // format and size are known immediately

    // and the two that have to be read out of the bytes
    if(sec === 'resources' && main){
      var n = await dzZipCount(main);
      if(dzAutoRead[sec] === read){ read.file_count = n; dzAutoPaint(sec); }
    }
    if(pic){
      var d = await dzImageDims(pic);
      if(dzAutoRead[sec] === read){ read.dimensions = d; dzAutoPaint(sec); }
    }
  }
  // a form that was rebuilt has no readings to its name
  function dzAutoReset(sec){ delete dzAutoRead[sec]; }

  // ---- the counters, and the keystroke that never lands ------------------
  function dzCountPaint(el){
    if(!el || !el.id) return;
    var c = document.getElementById(el.id+'_c');
    if(!c) return;
    var min = parseInt(el.getAttribute('data-min'), 10) || 0;
    var max = parseInt(el.getAttribute('data-cmax'), 10) || 0;
    var n   = String(el.value == null ? '' : el.value).trim().length;
    c.textContent = max ? (n + '/' + max) : String(n);
    // Red while the field is short of its floor. An untouched empty field is
    // not scolded — the asterisk already says it is wanted, and publish will
    // say so again if it is still empty then.
    c.classList.toggle('bad', n > 0 && n < min);
  }
  // digits only, and never a figure past the ceiling: the character that
  // would take it there is dropped as it is typed, the same way maxlength
  // drops the character past a text field's last one
  function dzNumClean(el){
    var kind = el.getAttribute('data-num');
    var max  = parseFloat(el.getAttribute('data-nmax'));
    var v    = String(el.value == null ? '' : el.value);
    v = (kind === 'int') ? v.replace(/[^0-9]/g, '') : v.replace(/[^0-9.]/g, '');
    if(kind !== 'int'){
      var p = v.split('.');
      v = p.shift() + (p.length ? '.' + p.join('').slice(0, 2) : '');
    }
    v = v.replace(/^0+(?=[0-9])/, '');            // 007 is 7
    if(isFinite(max)){
      // trimming from the right rather than clamping, so what is on screen is
      // always something the member could have typed
      while(v !== '' && v !== '.' && parseFloat(v) > max) v = v.slice(0, -1);
    }
    if(el.value !== v) el.value = v;
  }
  // Where a section's fields live. Three of the four are drawn into one box
  // by buildForm; the artwork panel is hand-written markup that predates all
  // of this, and its extra fields are injected into slots inside it — so the
  // scope is the panel rather than the box.
  function dzFormScope(sec){
    return document.getElementById(sec === 'artwork' ? 'pfUpMod' : 'upSecForms');
  }
  // one pass over a freshly built or freshly restored form
  function dzCountAll(sec){
    var box = dzFormScope(sec);
    if(!box) return;
    var els = box.querySelectorAll('[data-min],[data-cmax]');
    for(var i=0;i<els.length;i++) dzCountPaint(els[i]);
    dzCondApply(sec);
    dzPickSyncAll(sec);
    dzRefsAll(sec);
    dzAutoScan(sec);            // re-reads only if the files actually changed
    dzAutoPaint(sec);
  }
  // Capture, so it also serves the boxes built after this ran. Scoped to the
  // section forms so the artwork panel, which counts its own two fields its
  // own way, is left alone.
  document.addEventListener('input', function(e){
    var t = e.target;
    // The artwork panel counts its own title and description its own way, and
    // those carry none of these attributes — dzCountPaint looks for a counter
    // named after the field and finds nothing, so they are left alone.
    if(!t || !t.id || !t.closest || !t.closest('#upSecForms, #pfUpMod')) return;
    if(t.getAttribute('data-up')){
      var at = t.selectionStart, up = String(t.value||'').toUpperCase();
      if(t.value !== up){ t.value = up; try{ t.setSelectionRange(at, at); }catch(err){} }
    }
    if(t.getAttribute('data-num')) dzNumClean(t);
    dzCountPaint(t);
    // the Automatic Details card follows what is being typed
    dzAutoPaint(upSec);
  }, true);

  // tags
  function renderTags(sec){
    var host = document.getElementById('dzTags-'+sec);
    if(!host) return;
    host.innerHTML = st(sec).tags.map(function(t,i){
      return '<span class="upTagChip">'+esc(t)+
        '<button type="button" onclick="dzTagDel(\''+sec+'\','+i+')" aria-label="Remove tag">✕</button></span>';
    }).join('');
  }
  // ---- a tag box takes a list ---------------------------------------------
  // "anime, chr, genshin impact" is three tags. It is three whether the
  // commas were typed or pasted, and whether the member finishes with Enter
  // or by tapping something else on the form — all three of those used to
  // make one tag with the commas inside it.
  function dzTagCommit(sec, raw){
    var s = st(sec), fd = dzField(sec, 'tags') || {};
    var cap = fd.max || 20, added = 0, full = false, cut = false;
    String(raw == null ? '' : raw).split(/[,\n]/).forEach(function(part){
      var v = part.trim().toLowerCase().replace(/^#+/, '').trim();
      if(!v) return;                                  // ", ," is not a tag
      if(v.length > cap){ v = v.slice(0, cap); cut = true; }
      if(s.tags.length >= 10){ full = true; return; }
      if(s.tags.indexOf(v) !== -1) return;            // the same tag twice is one
      s.tags.push(v); added++;
    });
    if(full)     showToast('That is the limit — 10 tags');
    else if(cut) showToast('A tag is at most ' + cap + ' characters');
    if(added) renderTags(sec);
    return added;
  }
  function dzTagKey(e, sec){
    var el = e.target;
    if(e.key === 'Enter' || e.key === ','){
      e.preventDefault();
      dzTagCommit(sec, el.value);
      el.value = '';
    } else if(e.key === 'Backspace' && !el.value && st(sec).tags.length){
      st(sec).tags.pop(); renderTags(sec);
    }
  }
  // Leaving the box finishes the tag. Without this, typing a tag and going
  // straight to Publish loses it, which reads as the box not working.
  function dzTagBlur(e, sec){
    var el = e.target;
    if(el && String(el.value||'').trim()){ dzTagCommit(sec, el.value); el.value = ''; }
  }
  // A pasted list is a list. A pasted word is just typing, so it is left in
  // the box for the member to keep editing.
  function dzTagPaste(e, sec){
    var cb = e.clipboardData || window.clipboardData;
    var txt = cb ? cb.getData('text') : '';
    if(!txt || !/[,\n]/.test(txt)) return;
    e.preventDefault();
    var el = e.target;
    dzTagCommit(sec, el.value + txt);
    el.value = '';
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
    // format, size, file count and resolution all come off the files
    dzAutoScan(sec);
    var id  = 'dz_'+sec+'_'+key,
        z   = document.getElementById(id+'_z'),
        box = document.getElementById(id+'_pk'),
        s   = st(sec), f = s.files[key];
    if(!z || !box) return;
    if(Array.isArray(f)){ dzRenderFileList(sec, key, z, box, f); return; }
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

  // the multi-file variant: a row per file, and the order shown is the order
  // the buyer will see, which is why removing one does not renumber the rest
  // until the list repaints
  function dzRenderFileList(sec, key, z, box, list){
    if(!list.length){
      z.classList.remove('dzHasFile');
      box.innerHTML = '';
      return;
    }
    z.classList.add('dzHasFile');
    var fd = dzField(sec, key), pics = !!fd && fd.t === 'images';
    var urls = st(sec).urls[key];
    if(!Array.isArray(urls)) urls = [];
    var total = 0;
    list.forEach(function(f){ total += (f && f.size) || 0; });
    box.innerHTML =
      '<div class="dzFileRows">' +
        list.map(function(f, i){
          // a preview image is worth showing as one; a product file has
          // nothing to show but its type
          var thumb = (pics && urls[i])
            ? '<span class="dzFileThumb"><img src="'+esc(urls[i])+'" alt=""></span>'
            : '<span class="dzFileThumb dzFileThumbExt">'+esc(ext(f.name))+'</span>';
          return '<div class="dzFileRow">'+
            thumb+
            '<div class="dzFileMeta">'+
              '<div class="dzFileNm">'+esc(f.name)+'</div>'+
              '<div class="dzFileSz">'+esc(bytes(f.size) || '—')+'</div>'+
            '</div>'+
            '<button type="button" class="dzFileAct dzFileActRm" '+
              'onclick="dzFileDrop(event,\''+sec+'\',\''+key+'\','+i+')" '+
              'aria-label="Remove '+esc(f.name)+'">Remove</button>'+
          '</div>';
        }).join('') +
      '</div>'+
      '<div class="dzFileSum">'+
        '<span>'+list.length+' '+(pics ? 'image' : 'file')+(list.length === 1 ? '' : 's')+
          ' · '+esc(bytes(total) || '—')+(pics ? '' : ' · locked until purchased')+'</span>'+
        '<button type="button" class="dzFileAct" onclick="dzFileReplace(event,\''+sec+'\',\''+key+'\')">Add more</button>'+
        '<button type="button" class="dzFileAct dzFileActRm" onclick="dzFileClear(event,\''+sec+'\',\''+key+'\')">Clear all</button>'+
      '</div>';
  }

  // swap the held file
  function dzSetFile(sec, key, f){
    var s = st(sec);
    if(s.urls[key]){ dzRevoke(s.urls[key]); s.urls[key] = null; }
    s.files[key] = f || null;
    if(f && /^image\//.test(f.type||'')){
      try{ s.urls[key] = URL.createObjectURL(f); }catch(e){ s.urls[key] = null; }
    }
    dzRenderFile(sec, key);
  }

  // add to the held list, keeping what was already there — picking again is how
  // you add a second file, not how you replace the first
  function dzAddFiles(sec, key, files){
    var s = st(sec);
    var fd = dzField(sec, key), pics = !!fd && fd.t === 'images';
    // The ceiling on a list, the same idea as maxlength on a box: past it the
    // file is simply not added. The table enforces both numbers again.
    var cap = pics ? DZ_GALLERY_MAX : DZ_SELL_MAX;
    var have = Array.isArray(s.files[key]) ? s.files[key] : [];
    if(!Array.isArray(s.urls[key])) s.urls[key] = [];
    var urls = s.urls[key];
    var seen = {}, full = false;
    have.forEach(function(f){ seen[f.name + '|' + f.size] = 1; });
    Array.prototype.forEach.call(files || [], function(f){
      if(!f) return;
      var k = f.name + '|' + f.size;
      if(seen[k]) return;            // the same file picked twice is one file
      if(have.length >= cap){ full = true; return; }
      seen[k] = 1;
      have.push(f);
      // an image row shows the picture, which needs a handle on the blob
      urls.push(pics && /^image\//.test(f.type||'')
        ? (function(){ try{ return URL.createObjectURL(f); }catch(e){ return null; } })()
        : null);
    });
    s.files[key] = have;
    if(full) showToast('That is the limit — ' + cap + (pics ? ' preview images' : ' files'));
    dzRenderFile(sec, key);
  }

  function dzFileDrop(e, sec, key, i){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    var s = st(sec);
    if(!Array.isArray(s.files[key])) return;
    s.files[key].splice(i, 1);
    if(Array.isArray(s.urls[key])){
      var gone = s.urls[key].splice(i, 1)[0];
      if(gone){ try{ URL.revokeObjectURL(gone); }catch(err){} }
    }
    var el = document.getElementById('dz_'+sec+'_'+key);
    if(el) el.value = '';
    dzRenderFile(sec, key);
  }

  // 'files' sells a list of files; 'images' shows a list of them. Both hold a
  // list rather than one file, and picking again adds to it.
  function isMulti(sec, key){
    var fd = dzField(sec, key);
    return !!fd && (fd.t === 'files' || fd.t === 'images');
  }

  function dzPick(sec, key, input){
    if(typeof pfGuestGate === 'function' && pfGuestGate({preventDefault:function(){},stopPropagation:function(){}})) return;
    if(isMulti(sec, key)) dzAddFiles(sec, key, input.files);
    else dzSetFile(sec, key, input.files && input.files[0]);
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
    if(isMulti(sec, key)){
      var s = st(sec);
      dzRevoke(s.urls[key]);
      s.files[key] = [];
      s.urls[key]  = [];
      dzRenderFile(sec, key);
      return;
    }
    dzSetFile(sec, key, null);
  }

  // A held blob url, or a list of them. Both shapes exist because a single
  // file field keeps one and a multi field keeps one per row, and every path
  // that drops files has to let go of whichever it was holding.
  function dzRevoke(u){
    if(!u) return;
    if(Array.isArray(u)){
      u.forEach(function(x){ if(x){ try{ URL.revokeObjectURL(x); }catch(e){} } });
      return;
    }
    try{ URL.revokeObjectURL(u); }catch(e){}
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
    var dropped = (e && e.dataTransfer && e.dataTransfer.files) || null;
    if(isMulti(sec, key)){
      if(dropped && dropped.length) dzAddFiles(sec, key, dropped);
      return;
    }
    var f = dropped && dropped[0];
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
  // the spec for one field, by name
  function dzField(sec, k){
    var fds = FORMS[sec] ? FORMS[sec].fields : [];
    for(var i=0;i<fds.length;i++){ if(fds[i].k === k) return fds[i]; }
    return null;
  }
  // a whole number or nothing — 0 survives, which parseInt(x) || null does not
  function dzInt(v){
    var n = parseInt(v, 10);
    return isFinite(n) ? n : null;
  }
  // the same, for a figure that may carry decimals
  function dzNum(v){
    if(String(v == null ? '' : v).trim() === '') return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  // ---- the half of a post the system writes ------------------------------
  // Reading time, the slug, the byline and the SEO fallbacks are derived, not
  // typed. A reading time someone enters is wrong the moment they edit a
  // paragraph, and a slug that drifts from the title is a link that lies.
  var DZ_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function dzUuids(v){
    return String(v || '').split(',')
      .map(function(x){ return x.trim(); })
      .filter(function(x){ return DZ_UUID.test(x); })
      .slice(0, 10);
  }
  function dzReadMinutes(body){
    var words = String(body || '').trim().split(/\s+/).filter(Boolean).length;
    // the column will not take less than 1 or more than 2000
    return Math.min(2000, Math.max(1, Math.round(words / 200) || 1));
  }
  // The floors apply to what is stored, so a generated value that cannot
  // reach its floor is not stored at all — a null SEO title is a search
  // engine falling back to the real one, which is the right answer anyway.
  function dzSeoTitle(typed, title){
    if(typed) return typed;
    var t = String(title || '').trim();
    if(t.length < 10) t = (t + ' — DigiArtz').trim();
    t = t.slice(0, 70);
    return t.length >= 10 ? t : null;
  }
  function dzSeoDesc(typed, excerpt, body){
    if(typed) return typed;
    var d = String(excerpt || '').trim();
    if(d.length < 50) d = String(body || '').replace(/\s+/g, ' ').trim();
    d = d.slice(0, 160);
    return d.length >= 50 ? d : null;
  }
  // The byline, copied from the profile as it reads now. A snapshot rather
  // than a join, so the post keeps the bio it was published with — and null
  // when the profile has none, or one too short for the column's floor.
  async function dzAuthorBio(){
    if(!sb || !window.currentUser) return null;
    try{
      var res = await sb.from('profiles').select('bio').eq('id', currentUser.id).single();
      var bio = String((res && res.data && res.data.bio) || '').trim().slice(0, 500);
      return bio.length >= 20 ? bio : null;
    }catch(e){ return null; }
  }

  // ---- what the upload says about itself ---------------------------------
  // A file format someone types disagrees with the file, a size someone types
  // is a guess, and a file count someone types is a guess about a zip they
  // made three weeks ago. All three are read off the upload instead.
  //
  // The count walks the zip's own central directory rather than unpacking
  // anything: the End of Central Directory record at the tail says where the
  // directory is and how many entries it holds, and the entries themselves
  // say which are folders. Only the tail and the directory are read, so a
  // 200MB package costs a few kilobytes to count. Anything that is not a zip,
  // or is a zip64, gets null — no answer is better than a wrong one.
  async function dzZipCount(file){
    try{
      if(!file || !/\.zip$/i.test(file.name||'') || !file.slice) return null;
      var tailLen = Math.min(file.size, 66000);
      var tail = await file.slice(file.size - tailLen).arrayBuffer();
      var dv = new DataView(tail), eocd = -1;
      for(var i = dv.byteLength - 22; i >= 0; i--){
        if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
      }
      if(eocd < 0) return null;
      var total  = dv.getUint16(eocd + 10, true);
      var cdSize = dv.getUint32(eocd + 12, true);
      var cdOff  = dv.getUint32(eocd + 16, true);
      if(total === 0xffff || cdOff === 0xffffffff) return null;   // zip64
      if(!total || !cdSize) return null;
      var cd = await file.slice(cdOff, cdOff + cdSize).arrayBuffer();
      var cv = new DataView(cd), p = 0, files = 0, dec = new TextDecoder();
      for(var e = 0; e < total && p + 46 <= cv.byteLength; e++){
        if(cv.getUint32(p, true) !== 0x02014b50) break;
        var nameLen = cv.getUint16(p + 28, true);
        var extraLen = cv.getUint16(p + 30, true);
        var cmtLen = cv.getUint16(p + 32, true);
        var name = dec.decode(new Uint8Array(cd, p + 46, nameLen));
        // a folder entry is not a file the downloader receives
        if(!/\/$/.test(name)) files++;
        p += 46 + nameLen + extraLen + cmtLen;
      }
      return files || null;
    }catch(e){ return null; }
  }
  // the preview's own pixels, which is what "resolution" means for a texture
  function dzImageDims(file){
    return new Promise(function(res){
      if(!file || !/^image\//.test(file.type||'') || typeof Image !== 'function'){ res(null); return; }
      var url = null, img = new Image(), done = false;
      function finish(v){
        if(done) return;
        done = true;
        if(url){ try{ URL.revokeObjectURL(url); }catch(e){} }
        res(v);
      }
      img.onload = function(){
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        finish(w && h ? (w + '×' + h + ' px') : null);
      };
      img.onerror = function(){ finish(null); };
      setTimeout(function(){ finish(null); }, 4000);   // never hold up a publish
      try{ url = URL.createObjectURL(file); img.src = url; }catch(e){ finish(null); }
    });
  }

  // A website typed the way people say it — koe.studio — is a website. The
  // scheme is put back rather than the posting being refused over it.
  function dzWebUrl(v){
    v = String(v || '').trim();
    if(!v) return '';
    if(/^https?:\/\//i.test(v)) return v;
    if(/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;   // mailto:, tel:, anything explicit
    return 'https://' + v;
  }

  // repaint file fields
  function dzIsFileType(t){
    return t === 'file' || t === 'image' || t === 'files' || t === 'images';
  }
  function dzPaintFiles(sec){
    (FORMS[sec] ? FORMS[sec].fields : []).forEach(function(fd){
      if(dzIsFileType(fd.t)) dzRenderFile(sec, fd.k);
    });
  }

  function dzResetForm(sec){
    var old = S[sec];
    if(old && old.urls) Object.keys(old.urls).forEach(function(k){ dzRevoke(old.urls[k]); });
    S[sec] = {tags:[], files:{}, urls:{}};
    dzAutoReset(sec);
    var box = document.getElementById('upSecForms');
    if(box) box.innerHTML = buildForm(sec);
    renderTags(sec);
    dzCountAll(sec);
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
      if(dzIsFileType(fd.t)) return;   // blobs not persisted
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
          if(fd.t==='tags'||dzIsFileType(fd.t)) return;
          if(!(fd.k in d.data)) return;
          var el=document.getElementById('dz_'+d.sec+'_'+fd.k);
          if(!el) return;
          if(el.type==='checkbox') el.checked=!!d.data[fd.k]; else el.value=d.data[fd.k];
        });
        dzSelSyncAll(d.sec);   // the triggers read their hidden inputs back
        renderTags(d.sec);
        dzCountAll(d.sec);     // and the counters read the restored lengths
        upGrowAll();
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

  // ---- publish-time limit check -----------------------------------------
  // The ceilings cannot be breached by typing, so what is really being
  // checked here is the floors, plus a paste or a restored draft that came in
  // over a ceiling. Returns the first field that is wrong and why, so the
  // member is taken to it rather than told a number and left to find it.
  function dzLimits(sec){
    var fds = FORMS[sec] ? FORMS[sec].fields : [];
    for(var i=0;i<fds.length;i++){
      var fd = fds[i];
      // compound values: a list of ids, a list of links, a card that is not
      // an input at all
      if(fd.t === 'chk' || fd.t === 'tags' || fd.t === 'pick' ||
         fd.t === 'list' || fd.t === 'auto' || dzIsFileType(fd.t)) continue;
      if(!dzCondShow(sec, fd)) continue;
      var el = document.getElementById('dz_'+sec+'_'+fd.k);
      if(!el) continue;
      var raw = String(el.value == null ? '' : el.value).trim();

      if(fd.t === 'int' || fd.t === 'money'){
        if(!raw) continue;                       // emptiness is the miss check's job
        var n = parseFloat(raw);
        if(!isFinite(n)) return {k:fd.k, msg:fd.label+' takes a number'};
        if(fd.nmin != null && n < fd.nmin) return {k:fd.k, msg:fd.label+' cannot be below '+fd.nmin};
        if(fd.nmax != null && n > fd.nmax) return {k:fd.k, msg:fd.label+' cannot be above '+fd.nmax};
        continue;
      }
      if(!raw) continue;
      if(fd.min && raw.length < fd.min){
        return {k:fd.k, msg:fd.label+' needs at least '+fd.min+' characters — it has '+raw.length};
      }
      if(fd.max && raw.length > fd.max){
        return {k:fd.k, msg:fd.label+' is limited to '+fd.max+' characters'};
      }
    }
    return null;
  }
  // say what is wrong, then go there
  function dzFieldFail(sec, k, msg){
    showToast(msg);
    var el = document.getElementById('dz_'+sec+'_'+k);
    if(!el) return;
    var card = el.closest ? el.closest('.upField') : null;
    if(card && card.scrollIntoView){
      try{ card.scrollIntoView({behavior:'smooth', block:'center'}); }
      catch(e){ card.scrollIntoView(); }
    }
    // a select keeps its value on a hidden input, which cannot take focus
    if(el.type !== 'hidden'){ try{ el.focus({preventScroll:true}); }catch(e){ try{ el.focus(); }catch(e2){} } }
    dzCountPaint(el);
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

    // required fields from the spec. A conditional row that is not on the
    // form is not being asked for, so it cannot be missing.
    var miss = FORMS[sec].fields.filter(function(fd){
      if(!fd.req || !dzCondShow(sec, fd)) return false;
      if(fd.t === 'files' || fd.t === 'images') return !(s.files[fd.k] || []).length;
      if(fd.t === 'file' || fd.t === 'image') return !s.files[fd.k];
      var v = val(sec, fd.k);
      // 0 is an answer — years of experience, and a pay range that starts at
      // nothing, are both real and both falsy
      if((fd.t === 'int' || fd.t === 'money') && v === '0') return false;
      return !v;
    });
    if(miss.length){ dzFieldFail(sec, miss[0].k, 'Missing: ' + miss[0].label); return; }

    // and then the floors and the ceilings
    var bad = dzLimits(sec);
    if(bad){ dzFieldFail(sec, bad.k, bad.msg); return; }

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

      // One named file, straight to the private bucket. Used for the files a
      // marketplace listing sells: they come back with no url because there is
      // none to come back with, and the index keeps two files of the same name
      // from landing on the same object.
      async function putPrivate(f, prefix, i){
        var ext = safeSlug((f.name.split('.').pop()||'bin'), 10);
        var path = prefix+'/'+currentUser.id+'/'+stamp+'_'+i+'_'+safeSlug(f.name.replace(/\.[^.]+$/,''), 40)+'.'+ext;
        var opts = {private:true};
        await s3Upload(BUCKET, path, f, opts);
        // the bucket the signer used, not the one we asked for — the two agree
        // once the signer knows the flag, and the row has to describe reality
        // either way or the download endpoint signs against the wrong bucket
        var landed = opts.landed || {};
        return {
          bucket: landed.bucket || 'koe-originals',
          path: landed.path || path,
          name: f.name, ext: ext, size: f.size, mime: f.type || null
        };
      }

      // media bookkeeping, queued here and flushed once the row exists, since
      // every one of these tables is keyed on the parent id
      var pendingMedia = [];
      // The files a marketplace listing sells. These are queued separately and
      // written strictly, because they are not bookkeeping — they are the
      // product. dzRecordUpload is fail-soft by design, and a listing that
      // publishes with its files silently missing is worse than one that
      // refuses to publish.
      var pendingSell = [];

      if(sec === 'resources'){
        var rVis = val(sec,'visibility') || 'published';
        var rWhen = dzSchPicked();
        // visibility and the schedule picker are two halves of one answer
        if(rVis === 'scheduled' && !rWhen){
          throw new Error('Pick a time under Schedule, or set visibility to Published');
        }
        if((rVis === 'draft' || rVis === 'hidden') && rWhen){
          throw new Error('A ' + rVis + ' resource is not listed, so it does not need a schedule');
        }
        if(rVis === 'scheduled') rVis = 'published';

        // read off the upload before it goes anywhere, so what the row says
        // about the package is what the package says about itself
        var rCount = await dzZipCount(s.files.file);
        var rDims  = await dzImageDims(s.files.preview);

        var rf = await put('file','resources'), rp = await put('preview','resources');
        row.title = val(sec,'title');
        row.summary = val(sec,'summary');
        row.description = val(sec,'description');
        row.resource_type = val(sec,'resource_type') || null;
        row.category = [val(sec,'category')];
        row.subcategory = val(sec,'subcategory') || null;
        row.license = val(sec,'license') || 'personal';
        row.commercial_use = val(sec,'commercial_use') === 'yes';
        row.attribution_required = val(sec,'attribution_required') === 'yes';
        row.modification_allowed = val(sec,'modification_allowed') !== 'no';
        row.software = val(sec,'software') || null;
        row.compatible_software = dzRefList('dz_resources_compatible_software').slice(0, 10);
        row.compatible_versions = val(sec,'compatible_versions') || null;
        row.whats_included = val(sec,'whats_included');
        row.instructions = val(sec,'instructions') || null;
        row.version = val(sec,'version') || null;
        row.external_links = dzRefList('dz_resources_external_links').slice(0, 5);
        row.safety_notes = val(sec,'safety_notes') || null;
        row.visibility = rVis;
        row.featured = val(sec,'featured') === true;
        // the derived half — none of these has a box on the form
        row.file_url = rf.url; row.file_storage_path = rf.path;
        row.file_name = rf.name; row.file_ext = rf.ext; row.file_size = rf.size;
        row.file_count = rCount;
        row.dimensions = rDims;
        if(rp){ row.preview_url = rp.url; row.preview_storage_path = rp.path; }
        pendingMedia.push({ fileKind:'resourceFile', url:rf.url, path:rf.path, file:s.files.file });
        if(rp) pendingMedia.push({ imageKind:'resourceImage', url:rp.url, path:rp.path, file:s.files.preview });
      }

      else if(sec === 'blog'){
        var bTitle = val(sec,'title');
        var body = val(sec,'body');
        var bExcerpt = val(sec,'excerpt');
        var bVis = val(sec,'visibility') || 'published';
        var bWhen = dzSchPicked();

        // Visibility and the schedule picker are two halves of one answer, so
        // they have to agree before anything is uploaded.
        if(bVis === 'scheduled' && !bWhen){
          throw new Error('Pick a time under Schedule, or set visibility to Published');
        }
        if((bVis === 'draft' || bVis === 'hidden') && bWhen){
          throw new Error('A ' + bVis + ' post is not listed, so it does not need a schedule');
        }
        // a scheduled post is published — at the set time, by the scheduler
        if(bVis === 'scheduled') bVis = 'published';

        var bc = await put('cover','blog');

        row.title = bTitle; row.body = body;
        row.excerpt = bExcerpt;
        row.category = [val(sec,'category')];
        row.tags = s.tags;
        row.content_type = val(sec,'content_type') || 'Article';
        row.related_artworks = dzUuids(val(sec,'related_artworks'));
        row.related_items = dzUuids(val(sec,'related_items'));
        row.external_refs = dzRefList('dz_blog_external_refs').slice(0, 20);
        row.visibility = bVis;
        row.featured = val(sec,'featured') === true;
        row.seo_title = dzSeoTitle(val(sec,'seo_title'), bTitle);
        row.seo_description = dzSeoDesc(val(sec,'seo_description'), bExcerpt, body);
        // The automatic half. None of these has a box on the form, and none
        // of them is read back off one.
        row.slug = slugify(bTitle).slice(0,110) + '-' + String(stamp).slice(-6);
        row.read_minutes = dzReadMinutes(body);
        row.author_bio = await dzAuthorBio();
        row.published_at = bWhen ? new Date(bWhen).toISOString() : new Date().toISOString();

        if(bc){ row.cover_url = bc.url; row.cover_storage_path = bc.path; }
        if(bc) pendingMedia.push({ imageKind:'blogImage', url:bc.url, path:bc.path, file:s.files.cover });
      }

      else if(sec === 'marketplace'){
        var type = val(sec,'item_type') || 'digital';
        var isSvc = !!ITEM_SERVICE[type];
        // A commission is work, not a download. Files picked while the listing
        // was still a digital one are not sold as part of it, and are not
        // uploaded — the field they were picked in is not even on the form any
        // more.
        var sell = (type === 'digital') ? (s.files.files || []) : [];
        if(type === 'digital' && !sell.length){ throw new Error('A digital download needs at least one file'); }
        if(sell.length > DZ_SELL_MAX){ throw new Error('A listing can carry at most '+DZ_SELL_MAX+' files'); }

        var gal = s.files.gallery || [];
        if(gal.length > DZ_GALLERY_MAX){
          throw new Error('A listing can carry at most '+DZ_GALLERY_MAX+' extra preview images');
        }

        var mkPrice = parseFloat(val(sec,'price'));
        if(!isFinite(mkPrice)) throw new Error('Add a price — enter 0 to list it free');
        var mkCents = Math.round(mkPrice * 100);

        var saleRaw = val(sec,'sale_price');
        var saleCents = null;
        if(saleRaw !== ''){
          var saleNum = parseFloat(saleRaw);
          if(!isFinite(saleNum)) throw new Error('That sale price is not a number');
          saleCents = Math.round(saleNum * 100);
          if(saleCents >= mkCents) throw new Error('The sale price has to be below the price');
        }

        var mkUrl  = dzWebUrl(val(sec,'apply_url'));
        var mkMail = val(sec,'apply_email');
        if(isSvc){
          if(!mkUrl && !mkMail) throw new Error('A commission or service needs an application link or email');
          if(mkMail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mkMail)) throw new Error('That application email does not look right');
          if(mkUrl && (mkUrl.length < 10 || mkUrl.length > 200)) throw new Error('The application link has to be 10–200 characters');
        }

        var mp = await put('preview','market');

        // The goods. Every one of these goes to the private bucket, so the
        // listing carries no url a stranger could follow — the row below keeps
        // names and sizes for display and nothing that resolves to bytes.
        for(var si = 0; si < sell.length; si++){
          pendingSell.push(await putPrivate(sell[si], 'market', si));
        }

        // The extra preview shots. These are the opposite of the files above:
        // they are meant to be looked at by anyone, so they go to the public
        // bucket exactly like the main preview does.
        var galRows = [];
        for(var gi = 0; gi < gal.length; gi++){
          var gext = safeSlug((gal[gi].name.split('.').pop()||'jpg'), 10);
          var gpath = 'market/'+currentUser.id+'/'+stamp+'_g'+gi+'_'+base+'.'+gext;
          var gurl = await s3Upload(BUCKET, gpath, gal[gi]);
          galRows.push({ url:gurl, path:gpath, name:gal[gi].name, size:gal[gi].size });
          pendingMedia.push({ imageKind:'marketImage', url:gurl, path:gpath, file:gal[gi] });
        }

        row.title = val(sec,'title'); row.description = val(sec,'description');
        row.summary = val(sec,'summary');
        row.category = [val(sec,'category')];
        row.subcategory = val(sec,'subcategory') || null;
        row.item_type = type;
        row.product_type = val(sec,'product_type') || null;
        row.buyer_gets = val(sec,'buyer_gets');
        row.file_format = val(sec,'file_format');
        row.file_count = dzInt(val(sec,'file_count'));
        row.file_size_mb = dzNum(val(sec,'file_size_mb'));
        row.dimensions = val(sec,'dimensions') || null;
        row.software = val(sec,'software') || null;
        row.source_files_included = val(sec,'source_files_included') === true;
        row.price_cents = mkCents;
        row.sale_price_cents = saleCents;
        row.currency = val(sec,'currency') || dzPrefCurrency();
        row.license = val(sec,'license') || 'standard';
        row.commercial_use = val(sec,'commercial_use') !== 'no';
        row.personal_use = val(sec,'personal_use') === true;
        row.modification_allowed = val(sec,'modification_allowed') === true;
        row.attribution_required = val(sec,'attribution_required') === true;
        row.stock = dzInt(val(sec,'stock'));
        row.delivery_type = val(sec,'delivery_type') || 'instant';
        // asked for on a commission or a service, meaningless on a download
        row.delivery_days = isSvc ? dzInt(val(sec,'delivery_days')) : null;
        row.delivery_notes = val(sec,'delivery_notes') || null;
        row.custom_requests = val(sec,'custom_requests') === true;
        row.revision_count = dzInt(val(sec,'revision_count'));
        row.support_period = val(sec,'support_period') || null;
        row.refund_policy = val(sec,'refund_policy') || null;
        row.preview_watermark = val(sec,'preview_watermark') === true;
        row.safety_notes = val(sec,'safety_notes') || null;
        row.seller_note = val(sec,'seller_note') || null;
        row.apply_url = isSvc ? (mkUrl || null) : null;
        row.apply_email = isSvc ? (mkMail || null) : null;
        row.visibility = val(sec,'visibility') || 'published';
        row.featured = val(sec,'featured') === true;
        row.closing_date = val(sec,'closing_date') || null;
        row.internal_notes = val(sec,'internal_notes') || null;
        row.seo_title = val(sec,'seo_title') || null;
        row.seo_description = val(sec,'seo_description') || null;
        // A slug the seller typed is used as typed. One made here carries the
        // stamp, the same way a blog post's does, so two listings with the
        // same name do not end up with the same address.
        row.slug = val(sec,'slug') ||
          (slugify(val(sec,'title')).slice(0,110) + '-' + String(stamp).slice(-6));
        if(galRows.length) row.gallery = galRows;
        if(pendingSell.length){
          var totalBytes = 0;
          pendingSell.forEach(function(x){ totalBytes += x.size || 0; });
          // file_url stays null: there is no public url for these any more, and
          // a row that carries one is a row that leaks. The path is kept so the
          // storage delete gate can still recognise the object as this seller's.
          row.file_storage_path = pendingSell[0].path;
          row.file_name = pendingSell[0].name;
          row.file_ext  = pendingSell[0].ext;
          row.file_size = totalBytes;
        }
        if(mp){ row.preview_url = mp.url; row.preview_storage_path = mp.path; }
        if(mp) pendingMedia.push({ imageKind:'marketImage', url:mp.url, path:mp.path, file:s.files.preview });
      }

      else if(sec === 'jobs'){
        var mode   = val(sec,'work_mode') || 'remote';
        var remote = mode === 'remote';
        // A conditional row that is not on the form may still hold what was
        // typed into it before the answer above it changed. Only what is
        // being asked for is read.
        var countries = remote
          ? val(sec,'applicant_countries').split(',')
              .map(function(x){ return x.trim().toUpperCase(); }).filter(Boolean)
          : [];
        var cc   = remote ? '' : val(sec,'location_country').toUpperCase();
        var city = remote ? '' : val(sec,'location_city');
        var url  = dzWebUrl(val(sec,'apply_url'));
        var mail = val(sec,'apply_email');
        var site = dzWebUrl(val(sec,'company_url'));

        // mirror the table constraints
        if(!url && !mail) throw new Error('Add an apply link or an email');
        if(mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw new Error('That apply email does not look right');
        // the ceiling is on what is stored, and what is stored is the link
        // with its scheme put back on
        if(url && (url.length < 10 || url.length > 200)) throw new Error('The apply link has to be 10–200 characters');
        if(site && (site.length < 5 || site.length > 200)) throw new Error('The company website has to be 5–200 characters');
        if(remote && !countries.length) throw new Error('A remote role needs at least one eligible country');
        if(!remote && cc.length !== 2) throw new Error('Add a two-letter country code');
        if(countries.length > 60) throw new Error('That is too many eligible countries — list up to 60');

        var payFrom = parseFloat(val(sec,'salary_min'));
        var payTo   = parseFloat(val(sec,'salary_max'));
        if(!isFinite(payFrom) || !isFinite(payTo)) throw new Error('Add a pay range');
        if(payTo < payFrom) throw new Error('Pay to cannot be lower than pay from');

        var closes = val(sec,'valid_through');
        if(!closes) throw new Error('Add a closing date');
        // end of the chosen day, so a posting closing today is open today
        if(new Date(closes+'T23:59:59').getTime() < Date.now()){
          throw new Error('The closing date has already passed');
        }

        row.title = val(sec,'title'); row.company = val(sec,'company');
        row.about_company = val(sec,'about_company');
        row.company_url = site || null;
        row.description = val(sec,'description');
        row.category = [val(sec,'category')];
        row.employment_type = val(sec,'employment_type') || 'CONTRACTOR';
        row.experience_level = val(sec,'experience_level') || null;
        row.years_experience = dzInt(val(sec,'years_experience'));
        row.openings = dzInt(val(sec,'openings'));
        row.responsibilities = val(sec,'responsibilities');
        row.requirements = val(sec,'requirements');
        row.required_skills = val(sec,'required_skills');
        row.nice_to_have_skills = val(sec,'nice_to_have_skills') || null;
        row.benefits = val(sec,'benefits') || null;
        row.work_mode = mode;
        // is_remote stays the authority the two location constraints, the
        // cards and the search index are all written against
        row.is_remote = remote;
        row.location_city = city || null;
        row.location_country = cc || null;
        row.applicant_countries = countries;
        row.timezone = val(sec,'timezone');
        row.working_hours = val(sec,'working_hours');
        row.schedule = val(sec,'schedule') || null;
        row.start_date = val(sec,'start_date') || null;
        row.contract_duration = dzCondShow(sec, dzField(sec,'contract_duration'))
          ? (val(sec,'contract_duration') || null) : null;
        row.salary_min = payFrom;
        row.salary_max = payTo;
        row.salary_currency = val(sec,'salary_currency') || 'USD';
        row.salary_unit = val(sec,'salary_unit') || 'MONTH';
        row.apply_url = url || null; row.apply_email = mail || null;
        row.application_instructions = val(sec,'application_instructions');
        row.application_materials = val(sec,'application_materials');
        row.application_questions = val(sec,'application_questions') || null;
        row.portfolio_required = val(sec,'portfolio_required') === true;
        row.resume_required = val(sec,'resume_required') === true;
        row.cover_letter_required = val(sec,'cover_letter_required') === true;
        row.valid_through = closes;
        row.visibility = val(sec,'visibility') || 'public';
        row.featured = val(sec,'featured') === true;
      }

      // schedule branch
      var when = dzSchPicked();
      if(when){
        if(moderated){ dzV.step('transfer','pass'); dzV.step('publish','run'); }
        var payload = {}; for(var pk in row){ if(pk!=='status') payload[pk]=row[pk]; }
        var paths = [];
        ['file_storage_path','preview_storage_path','cover_storage_path'].forEach(function(k){ if(row[k]) paths.push(row[k]); });
        pendingSell.forEach(function(x){ paths.push(x.path); });
        // the extra preview shots are already in the public bucket, so
        // cancelling the schedule has to know to clean them up too
        if(Array.isArray(row.gallery)) row.gallery.forEach(function(g){ if(g && g.path) paths.push(g.path); });
        var sres = await sb.from('scheduled_sections').insert({
          user_id: currentUser.id, section: sec, payload: payload,
          storage_paths: paths, publish_at: new Date(when).toISOString(),
          // the files the listing sells, attached by publish_due_scheduled_
          // sections when the row it hangs them off finally exists
          sell_files: pendingSell.length ? pendingSell.map(function(x){
            return { bucket:x.bucket || 'koe-originals', path:x.path, name:x.name, mime:x.mime, bytes:x.size };
          }) : null
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

      // The files being sold, written before anything else and checked, unlike
      // the bookkeeping below. If they cannot be attached the listing is taken
      // straight back down: a live listing that charges for files it cannot
      // deliver is the one outcome worth failing loudly for.
      if(pendingSell.length && res.data && res.data.id){
        var sellRows = pendingSell.map(function(x, i){
          return {
            user_id: currentUser.id, item_id: res.data.id,
            storage_bucket: x.bucket || 'koe-originals', storage_path: x.path,
            original_filename: String(x.name || 'file').slice(0, 260),
            mime: x.mime || null, bytes: x.size || null, position: i
          };
        });
        var fres = await sb.from('marketplace_file').insert(sellRows);
        if(fres.error){
          await sb.from('marketplace_items').delete().eq('id', res.data.id);
          throw new Error('Could not attach your files — nothing was published. ' +
                          (fres.error.message || ''));
        }
      }

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

  // ---- growing text boxes -----------------------------------------------
  // A description box that clips what is being written is a box the writer has
  // to fight. Every text area on the upload page grows to fit its content, up
  // to a ceiling past which it scrolls rather than pushing the publish button
  // off the screen.
  var UP_GROW_MAX = 460;
  function upGrow(el){
    if(!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    var h = el.scrollHeight;
    el.style.height = Math.min(h, UP_GROW_MAX) + 'px';
    el.style.overflowY = h > UP_GROW_MAX ? 'auto' : 'hidden';
  }
  function upGrowAll(){
    var els = document.querySelectorAll('#pfUpMod textarea');
    for(var i=0;i<els.length;i++) upGrow(els[i]);
  }
  // capture, so it fires for boxes built after this listener was attached
  document.addEventListener('input', function(e){
    var t = e.target;
    if(t && t.tagName === 'TEXTAREA' && t.closest && t.closest('#pfUpMod')) upGrow(t);
  }, true);

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
  window.upGuideOpen     = upGuideOpen;
  window.upGuideClose    = upGuideClose;
  window.upGuideBackdrop = upGuideBackdrop;
  window.upGrow          = upGrow;
  window.upGrowAll       = upGrowAll;
  window.dzSelToggle     = dzSelToggle;
  window.dzSelPick       = dzSelPick;
  window.dzCondApply     = dzCondApply;
  window.dzCloseMenus    = dzCloseMenus;
  window.dzPickToggle    = dzPickToggle;
  window.dzPickSet       = dzPickSet;
  window.dzRefKey        = dzRefKey;
  window.dzRefDel        = dzRefDel;
  // pure readers, exported so what the row claims about an upload can be
  // checked against a real file rather than taken on trust
  window.dzZipCount      = dzZipCount;
  window.dzImageDims     = dzImageDims;
  // the artwork panel lives in another file, so its half of this is exported
  window.dzArtExtras     = dzArtExtras;
  window.dzArtReset      = dzArtReset;
  window.dzArtValidate   = dzArtValidate;
  window.dzArtValues     = dzArtValues;
  window.dzArtSnapshot   = dzArtSnapshot;
  window.dzArtRestore    = dzArtRestore;
  window.dzArtFromRow    = dzArtFromRow;
  window.dzAutoScan      = dzAutoScan;
  window.dzAutoPaint     = dzAutoPaint;
  window.dzAutoReset     = dzAutoReset;
  window.dzFieldFail     = dzFieldFail;
  window.dzSeoTitle      = dzSeoTitle;
  window.dzSeoDesc       = dzSeoDesc;
  window.dzSlugify       = slugify;
  window.dzSubmit        = dzSubmit;
  window.dzResetForm     = dzResetForm;
  window.dzTagKey        = dzTagKey;
  window.dzTagBlur       = dzTagBlur;
  window.dzTagPaste      = dzTagPaste;
  window.dzTagDel        = dzTagDel;
  window.dzPick          = dzPick;
  window.dzFileReplace   = dzFileReplace;
  window.dzFileClear     = dzFileClear;
  // the per-file Remove button on a multi-file field is an inline onclick, so
  // it resolves against the global scope like every other handler here
  window.dzFileDrop      = dzFileDrop;
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

  // this block is its own scope, so it carries its own copies rather than
  // reaching for the ones the renderer above keeps to itself
  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function bytes(n){
    return (window.dzHelpers && window.dzHelpers.bytes) ? window.dzHelpers.bytes(n) : '';
  }

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

  // Delivery. Not a payment path and not an authorisation path either: both
  // questions are settled in the database, by dz_market_files and then by
  // /api/market-download, which will not sign a byte for a caller Postgres has
  // not confirmed as the buyer. Nothing decided here changes who may download —
  // the worst this code can do is ask and be told no.
  //
  // No tier is consulted anywhere along the way. A marketplace file is owned,
  // not licensed by a plan, so Free and Max reach the same bytes and neither
  // spends a daily download doing it.
  function dzMarketSave(blob, name){
    var obj = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = obj; a.download = name || 'file'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(obj); }, 60000);
  }

  window.dzMarketFetch = async function(item, file, name, btn){
    if(!sb || !window.currentUser){
      if(typeof pfGuestGate === 'function')
        pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return false;
    }
    if(btn){ btn.disabled = true; btn.setAttribute('aria-busy','true'); }
    try{
      var s = await sb.auth.getSession();
      var session = s && s.data && s.data.session;
      if(!session){ showToast('Sign in to download'); return false; }

      var res = await fetch('/api/market-download', {
        method:'POST',
        headers:{ 'Authorization':'Bearer '+session.access_token, 'Content-Type':'application/json' },
        body: JSON.stringify({ item:String(item), file:String(file || item) })
      });
      if(!res.ok){
        var info = {};
        try{ info = await res.json(); }catch(e){}
        if(res.status === 402) showToast('Buy this item to download it');
        else if(res.status === 401){
          showToast('Sign in to download');
          if(typeof openAuthMod === 'function') openAuthMod();
        }
        else showToast(info.error || 'Download failed — try again');
        return false;
      }
      dzMarketSave(await res.blob(), name);
      return true;
    }catch(e){
      showToast('Download failed — check your connection');
      return false;
    }finally{
      if(btn){ btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
  };

  // Asks what the caller owns. A listing they have not paid for answers with an
  // exception rather than an empty list, and that is the message they see.
  window.dzMarketGet = function(id){
    if(!sb || !window.currentUser){
      if(typeof pfGuestGate === 'function')
        pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
      return;
    }
    sb.rpc('dz_market_files', {p_item:id}).then(function(res){
      if(res.error){
        showToast(/purchase required/i.test(res.error.message || '')
          ? 'Buy this item to unlock its files'
          : (res.error.message || 'Could not open your files'));
        return;
      }
      var files = res.data || [];
      if(!files.length){ showToast('This listing has no files attached'); return; }
      if(files.length === 1){
        window.dzMarketFetch(id, files[0].file_id, files[0].name);
        return;
      }
      dzMarketPick(id, files);
    });
  };

  // More than one file means a choice, and a choice means a list rather than
  // four downloads the browser starts at once.
  function dzMarketPick(item, files){
    var old = document.getElementById('dzGetPop');
    if(old) old.remove();
    var pop = document.createElement('div');
    pop.className = 'upPop open';
    pop.id = 'dzGetPop';
    pop.setAttribute('role','dialog');
    pop.setAttribute('aria-modal','true');
    pop.setAttribute('aria-label','Your files');
    var total = 0;
    files.forEach(function(f){ total += Number(f.bytes) || 0; });
    pop.innerHTML =
      '<div class="upPopBox dzGetBox">'+
        '<button class="upPopX" data-x="1" aria-label="Close">✕</button>'+
        '<h3 class="dzGetTitle">YOUR FILES</h3>'+
        '<p class="dzGetSub">'+files.length+' files · '+esc(bytes(total) || '—')+
          ' · yours to re-download any time</p>'+
        '<div class="dzGetList">'+
          files.map(function(f, i){
            return '<div class="dzGetRow">'+
              '<span class="dzGetExt">'+esc(String(f.ext || 'file').toUpperCase())+'</span>'+
              '<div class="dzGetMeta">'+
                '<div class="dzGetNm">'+esc(f.name)+'</div>'+
                '<div class="dzGetSz">'+esc(bytes(f.bytes) || '—')+'</div>'+
              '</div>'+
              '<button type="button" class="dzGetBtn" data-i="'+i+'">Download</button>'+
            '</div>';
          }).join('')+
        '</div>'+
      '</div>';
    document.body.appendChild(pop);

    pop.addEventListener('click', function(e){
      if(e.target === pop || e.target.getAttribute('data-x')){ pop.remove(); return; }
      var b = e.target.closest ? e.target.closest('[data-i]') : null;
      if(!b) return;
      var f = files[Number(b.getAttribute('data-i'))];
      if(f) window.dzMarketFetch(item, f.file_id, f.name, b);
    });
  }
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

  // ---- the work a post is about ------------------------------------------
  // Fetched after the post is on screen rather than before it, because the
  // post is the thing being read and these are a footnote to it. Each opens
  // its own detail view, which is why the ids are worth carrying at all.
  // An artwork opens in the gallery's own lightbox, which only knows the
  // artworks it has loaded — a post can link one from years back, so the
  // route is the fallback and it always works.
  window.dzOpenArtwork = function(id){
    try{
      if(typeof openArtworkById === 'function' && openArtworkById(id, true)) return;
    }catch(e){}
    try{ location.href = '/artwork/' + encodeURIComponent(id); }catch(e){}
  };
  // A listing opens in the view above, which needs the whole row and not the
  // three columns the related strip was drawn from.
  window.dzOpenListing = async function(id){
    if(!sb) return;
    try{
      var sel = (typeof window.dzSelectFor === 'function')
                ? window.dzSelectFor('marketplace') : 'id,title,preview_url,description';
      var res = await sb.from('marketplace_items').select(sel).eq('id', id).single();
      if(res && res.data) window.dzOpenRow('marketplace', res.data);
      else showToast('That listing is no longer available');
    }catch(e){ showToast('Could not open that listing'); }
  };

  async function fillRelated(r){
    var host = document.getElementById('dzvRelated');
    if(!host || !sb) return;
    var token = host.dataset.relToken = String(Math.random());
    var art = (r.related_artworks || []).slice(0, 10);
    var itm = (r.related_items || []).slice(0, 10);
    var out = '';
    try{
      if(art.length){
        var a = await sb.from('artworks').select('id,name,title,image_url')
                  .in('id', art).eq('status','approved').limit(10);
        var arows = (a && a.data) || [];
        if(arows.length){
          out += '<div><div class="avBlockH">Related artwork</div><div class="dzvRelRow">'+
            arows.map(function(x){
              var nm = x.name || x.title || 'Untitled';
              return '<div class="dzvRelCard" onclick="dzOpenArtwork(\''+esc2(x.id)+'\')">'+
                (x.image_url ? '<img src="'+esc2(getThumbnailUrl(x.image_url))+'" alt="" loading="lazy">'
                             : '<span class="dzvRelNo"></span>')+
                '<span class="dzvRelNm">'+esc2(nm)+'</span></div>';
            }).join('')+'</div></div>';
        }
      }
      if(itm.length){
        var m = await sb.from('marketplace_items').select('id,title,preview_url')
                  .in('id', itm).eq('status','approved').eq('visibility','published').limit(10);
        var mrows = (m && m.data) || [];
        if(mrows.length){
          out += '<div><div class="avBlockH">Related listings</div><div class="dzvRelRow">'+
            mrows.map(function(x){
              return '<div class="dzvRelCard" onclick="dzOpenListing(\''+esc2(x.id)+'\')">'+
                (x.preview_url ? '<img src="'+esc2(getThumbnailUrl(x.preview_url))+'" alt="" loading="lazy">'
                               : '<span class="dzvRelNo"></span>')+
                '<span class="dzvRelNm">'+esc2(x.title||'Untitled')+'</span></div>';
            }).join('')+'</div></div>';
        }
      }
    }catch(e){ out = ''; }
    host = document.getElementById('dzvRelated');
    if(!host || host.dataset.relToken !== token) return;   // reader moved on
    host.innerHTML = out;
  }

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
  // One titled block of a job posting, or nothing at all when the posting did
  // not fill that part in — which is every one of these for a posting written
  // before the form asked.
  function jobBlock(head, body){
    body = String(body == null ? '' : body).trim();
    if(!body) return '';
    return '<div><div class="avBlockH">'+esc2(head)+'</div>'+
      '<div class="dzvArticle">'+esc2(body).replace(/\n/g,'<br>')+'</div></div>';
  }
  // A category is stored as the slug the picker wrote; this reads it back as
  // the words the picker showed. Anything it does not recognise is printed as
  // it stands rather than dropped.
  function catLabels(sec, arr){
    if(!Array.isArray(arr) || !arr.length) return '';
    var f = window.dzCatLabel;
    return arr.map(function(c){ return f ? f(sec, c) : c; })
              .filter(Boolean).join(', ');
  }
  // Tags are the member's own words and the thing the section is searched by,
  // so every detail view ends with them — the artwork viewer has shown its
  // tags this way all along and these four never showed theirs at all.
  function tagBlock(tags){
    if(!Array.isArray(tags) || !tags.length) return '';
    return '<div><div class="avBlockH">Tags</div><div class="avTagList">'+
      tags.map(function(t){ return '<span class="avTagChip">'+esc2(t)+'</span>'; }).join('')+
      '</div></div>';
  }
  // "Updated" only says something once it disagrees with the day the thing
  // went out; before that it is the same date twice.
  function updatedAgo(r, h){
    if(!r || !r.updated_at) return '';
    var base = r.published_at || r.created_at;
    if(!base) return '';
    return (new Date(r.updated_at) - new Date(base) > 60000) ? h.ago(r.updated_at) : '';
  }
  // a stored date read back the way the reader writes dates
  function jobDate(v){
    if(!v) return '';
    var t = new Date(v);
    if(!isFinite(t.getTime())) return String(v);
    return t.toLocaleDateString([], {year:'numeric', month:'short', day:'numeric'});
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
      // What a downloader may actually do with it, scanned rather than read.
      //
      // Only for a resource whose uploader was actually asked. Every resource
      // shared before these three existed has them at their column defaults —
      // false, false, true — and reading that back would print "Personal use
      // only, modification allowed" under work nobody licensed that way.
      // resource_type is required on the form and null on every older row, so
      // it is what says these answers are the uploader's.
      var resRights = r.resource_type ? [
        r.commercial_use ? 'Commercial use allowed' : 'Personal use only',
        r.modification_allowed ? 'Modification allowed' : 'No modification',
        r.attribution_required ? 'Attribution required' : ''
      ].filter(Boolean).join(' \u00b7 ') : '';
      var resLinks = '';
      if(Array.isArray(r.external_links) && r.external_links.length){
        resLinks = '<div><div class="avBlockH">Links</div><ul class="dzvRefs">'+
          r.external_links.map(function(u){
            var safe = /^https?:\/\//i.test(String(u||'')) ? String(u) : '';
            var show = String(u||'').replace(/^https?:\/\//i,'');
            return safe
              ? '<li><a href="'+esc2(safe)+'" target="_blank" rel="noopener nofollow">'+esc2(show)+'</a></li>'
              : '<li>'+esc2(show)+'</li>';
          }).join('')+'</ul></div>';
      }
      html = img(r.preview_url, r.title) +
        '<div class="dzvCol">'+
        '<div class="dzvFileCard"><span class="dzvExt">'+esc2((r.file_ext||'FILE').toUpperCase())+'</span>'+
        '<div><div class="dzvFileName">'+esc2(r.file_name||r.title)+'</div>'+
        '<div class="dzvFileMeta">'+esc2(h.bytes(r.file_size))+
          (r.file_count ? ' \u00b7 '+esc2(String(r.file_count))+' file'+(r.file_count===1?'':'s') : '')+
          ' \u00b7 '+esc2(String(r.download_count||0))+' downloads</div></div></div>'+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        (r.featured ? '<p class="dzvExcerpt">\u2605 Featured resource</p>' : '')+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        (r.summary ? '<p class="dzvExcerpt">'+esc2(r.summary)+'</p>' : '')+
        (r.description ? '<p class="dzvDesc">'+esc2(r.description)+'</p>' : '')+
        metaRow([['Type', r.resource_type],
                 ['Category', catLabels('resources', r.category)],
                 ['Subcategory', r.subcategory],
                 ['License', r.license],
                 ['Rights', resRights],
                 ['Made with', r.software],
                 ['Works with', (r.compatible_software||[]).join(', ')],
                 ['Versions', r.compatible_versions],
                 ['Version', r.version],
                 ['Resolution', r.dimensions],
                 ['Format', (r.file_ext||'').toUpperCase()],
                 ['Posted', h.ago(r.created_at)],
                 ['Updated', updatedAgo(r, h)]])+
        jobBlock('What\u2019s included', r.whats_included)+
        jobBlock('Installation and use', r.instructions)+
        jobBlock('Content notes', r.safety_notes)+
        resLinks+
        tagBlock(r.tags)+
        cmBlock(kind, id)+
        '<a class="avActWide" href="'+esc2(r.file_url)+'" target="_blank" rel="noopener" download>\u2b07 Download file</a>'+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else if(sec === 'blog'){
      // The sources a post cites, listed rather than buried in the prose. The
      // links are the author's own text, so they are escaped and carry
      // noopener — a post is not a licence to script the reader's tab.
      var refsHtml = '';
      if(Array.isArray(r.external_refs) && r.external_refs.length){
        refsHtml = '<div><div class="avBlockH">Sources</div><ul class="dzvRefs">'+
          r.external_refs.map(function(u){
            var safe = /^https?:\/\//i.test(String(u||'')) ? String(u) : '';
            var show = String(u||'').replace(/^https?:\/\//i,'');
            return safe
              ? '<li><a href="'+esc2(safe)+'" target="_blank" rel="noopener nofollow">'+esc2(show)+'</a></li>'
              : '<li>'+esc2(show)+'</li>';
          }).join('')+'</ul></div>';
      }
      var hasRelated = (r.related_artworks||[]).length || (r.related_items||[]).length;

      html = img(r.cover_url, r.title) +
        '<div class="dzvCol">'+
        (r.featured ? '<p class="dzvExcerpt">★ Featured post</p>' : '')+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        (r.excerpt ? '<p class="dzvExcerpt">'+esc2(r.excerpt)+'</p>' : '')+
        metaRow([['Type', r.content_type],
                 ['Category', catLabels('blog', r.category)],
                 ['Published', h.ago(r.published_at || r.created_at)],
                 ['Read time', (r.read_minutes||1)+' min'],
                 ['Updated', updatedAgo(r, h)]])+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        // the byline as it read when the post went out
        (r.author_bio ? '<p class="dzvAuthBio">'+esc2(r.author_bio)+'</p>' : '')+
        '<div class="dzvArticle">'+esc2(r.body||'').replace(/\n/g,'<br>')+'</div>'+
        refsHtml+
        (hasRelated ? '<div id="dzvRelated"></div>' : '')+
        tagBlock(r.tags)+
        cmBlock(kind, id)+
        // the resized copy: the origin bucket is not publicly readable, so a
        // link to the stored original would 403
        (r.cover_url ? '<a class="avActWide" href="'+esc2(imgResize(r.cover_url, 1600))+'" target="_blank" rel="noopener" download>\u2b07 Download cover</a>' : '')+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else if(sec === 'marketplace'){
      var hasFile = r.file_ext ? 1 : 0;
      // The extra shots, under the main one. Same treatment as the preview:
      // they are public images and nothing else, so there is nothing to gate.
      var galleryHtml = '';
      if(Array.isArray(r.gallery) && r.gallery.length){
        galleryHtml = '<div class="dzvGallery">'+ r.gallery.map(function(g){
          if(!g || !g.url) return '';
          return '<a href="'+esc2(getViewUrl(g.url))+'" target="_blank" rel="noopener">'+
            '<img src="'+esc2(getThumbnailUrl(g.url))+'" alt="" loading="lazy"></a>';
        }).join('') +'</div>';
      }
      // What a buyer may actually do with it. Written as a list of answers
      // rather than a paragraph, because it is the part they scan for.
      //
      // Only for a listing whose seller was actually asked. commercial_use
      // defaults to true, so a listing from before these questions existed
      // would announce "Commercial use allowed" — granting a licence its
      // seller never granted, to a buyer paying on the strength of it.
      // product_type is required on the form and null on every older row.
      var rights = r.product_type ? [
        r.commercial_use ? 'Commercial use allowed' : 'Personal use only',
        r.personal_use ? 'Personal use allowed' : '',
        r.modification_allowed ? 'Modification allowed' : '',
        r.attribution_required ? 'Attribution required' : '',
        r.source_files_included ? 'Source files included' : ''
      ].filter(Boolean).join(' · ') : '';

      html = img(r.preview_url, r.title) +
        '<div class="dzvCol">'+
        // the slot sits under the media, and stays empty for a guest
        (window.dzSlot ? window.dzSlot(r, id, hasFile, 'view') : '')+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        (r.featured ? '<p class="dzvExcerpt">★ Featured listing</p>' : '')+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        (r.summary ? '<p class="dzvExcerpt">'+esc2(r.summary)+'</p>' : '')+
        galleryHtml+
        (r.description ? '<p class="dzvDesc">'+esc2(r.description)+'</p>' : '')+
        metaRow([['Type', r.item_type],['Product', r.product_type],
                 ['Category', catLabels('marketplace', r.category)],
                 ['Subcategory', r.subcategory],
                 ['License', r.license],
                 ['Rights', rights],
                 ['File format', r.file_format],
                 ['Files', r.file_count ? String(r.file_count) : ''],
                 ['Size', r.file_size_mb != null ? r.file_size_mb+' MB' : ''],
                 ['Dimensions', r.dimensions],
                 ['Made with', r.software],
                 ['Stock', r.stock != null ? String(r.stock) : ''],
                 ['Delivery', r.delivery_type === 'custom' ? 'Custom delivery' : 'Instant download'],
                 ['Delivery time', r.delivery_days ? r.delivery_days+' days' : ''],
                 ['Revisions', r.revision_count != null ? String(r.revision_count) : ''],
                 ['Support', r.support_period],
                 ['Custom requests', r.custom_requests ? 'Accepted' : ''],
                 ['Closes', jobDate(r.closing_date)],
                 ['Listed', h.ago(r.created_at)],
                 ['Updated', updatedAgo(r, h)]])+
        jobBlock('What you get', r.buyer_gets)+
        jobBlock('Delivery notes', r.delivery_notes)+
        jobBlock('Refund policy', r.refund_policy)+
        jobBlock('Content notes', r.safety_notes)+
        jobBlock('From the seller', r.seller_note)+
        (r.preview_watermark ? jobBlock('Previews', 'Preview images are watermarked. The files you receive are not.') : '')+
        tagBlock(r.tags)+
        ((r.apply_url || r.apply_email)
          ? '<a class="avActWide" href="'+
              (r.apply_url ? esc2(r.apply_url)+'" target="_blank" rel="noopener'
                           : 'mailto:'+esc2(r.apply_email))+
            '">Request this ↗</a>'
          : '')+
        // There is no download control here any more, for anyone. The old one
        // was drawn for every visitor and refused at the database \u2014 which is
        // safe but reads as a broken button, and it advertised a file to people
        // who had not bought it. The buy-or-download control is the slot above,
        // written by the signed-in module once it knows what this caller owns.
        (hasFile ? '<div class="dzvLock" id="dzvLock-'+id+'">'+
            '<span class="dzvLockIco" aria-hidden="true">\ud83d\udd12</span>'+
            '<div><b>Files are locked</b><div class="dzvLockSub">They unlock for you as soon as '+
            'the payment is confirmed, and stay in Settings \u2192 My Purchases to re-download '+
            'any time. Subscription tiers do not unlock marketplace files.</div></div>'+
          '</div>' : '')+
        cmBlock(kind, id)+
        '<button class="avReportBtn" onclick="dzReportItem(\''+kind+'\',\''+id+'\')">\u2691 Report</button>'+
        '</div>';
    }
    else { // jobs, details and report
      // A posting now carries the whole job, so the view lays it out as a job
      // ad reads rather than as one description box: who, then the role, then
      // where and when, then what it pays, then how to apply. Every block is
      // dropped when the posting did not fill it in, which is also what keeps
      // the postings written before these fields existed rendering cleanly.
      var jw = window.dzJobWhere ? window.dzJobWhere(r)
             : (r.is_remote ? 'Remote' : [r.location_city, r.location_country].filter(Boolean).join(', '));
      var jp = window.dzJobPay ? window.dzJobPay(r) : '';
      var jmode = window.dzJobMode ? window.dzJobMode(r) : (r.is_remote ? 'remote' : 'onsite');
      var jmodeLbl = (window.dzJobModeLbl || {})[jmode] || '';
      var exp = [r.experience_level,
                 (r.years_experience != null ? r.years_experience + '+ yrs' : '')]
                .filter(Boolean).join(' \u00b7 ');
      var sends = [r.portfolio_required ? 'Portfolio' : '', r.resume_required ? 'Resume / CV' : '',
                   r.cover_letter_required ? 'Cover letter' : ''].filter(Boolean).join(' \u00b7 ');

      html = '<div class="dzvCol">'+
        (r.featured ? '<p class="dzvExcerpt">\u2605 Featured posting</p>' : '')+
        '<h1 class="dzvTitle">'+esc2(r.title)+'</h1>'+
        '<p class="dzvExcerpt">'+esc2(r.company||'')+
          (r.company_url ? ' \u00b7 <a href="'+esc2(r.company_url)+'" target="_blank" rel="noopener">website</a>' : '')+'</p>'+
        '<div class="dzvAuthor" id="dzvAuthor"></div>'+
        metaRow([
          ['Location', jw],
          ['Category', catLabels('jobs', r.category)],
          ['Work mode', jmodeLbl],
          ['Type', String(r.employment_type||'').replace(/_/g,' ')],
          ['Experience', exp],
          ['Openings', r.openings ? String(r.openings) : ''],
          ['Remote from', (jmode === 'remote' && (r.applicant_countries||[]).length)
                          ? (r.applicant_countries||[]).join(', ') : ''],
          ['Timezone', r.timezone],
          ['Working hours', r.working_hours],
          ['Schedule', r.schedule],
          ['Starts', jobDate(r.start_date)],
          ['Duration', r.contract_duration],
          ['Pay', jp],
          ['Closes', jobDate(r.valid_through)],
          ['Posted', h.ago(r.created_at)],
          ['Updated', updatedAgo(r, h)]
        ])+
        jobBlock('About the company', r.about_company)+
        jobBlock('Overview', r.description)+
        jobBlock('Responsibilities', r.responsibilities)+
        jobBlock('Requirements', r.requirements)+
        jobBlock('Required skills', r.required_skills)+
        jobBlock('Nice to have', r.nice_to_have_skills)+
        jobBlock('Benefits', r.benefits)+
        jobBlock('How to apply', r.application_instructions)+
        jobBlock('What to send', r.application_materials)+
        (sends ? jobBlock('Required with every application', sends) : '')+
        jobBlock('Questions to answer', r.application_questions)+
        tagBlock(r.tags)+
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
    if(sec === 'blog') fillRelated(r);
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
