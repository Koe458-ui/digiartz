// signed-in only: everything the site knows about money
//
// Nothing under this file is a static asset. Cloudflare Pages compiles
// functions/ into the Worker, so this is not fetchable as source, and the one
// thing it serves — the checkout module — is handed out per request, only to a
// caller holding a valid Supabase session, with no-store on the way back.
//
// What that buys: a signed-out visitor's page source names no provider, quotes
// no price, and carries no /api path for either checkout. View-source, the
// service worker cache, the precache list and Googlebot all see the same
// nothing. The plan prices themselves live here and in the two checkout
// backends, never in index.html.
//
// Where it stops, and this is worth being honest about in the file rather than
// in a commit message: once a signed-in buyer opens the sheet, this module is
// running in their browser and the PayPal client id is in the SDK url. Both
// provider ids are public by design and worthless without the secrets, which
// never leave the Worker. The gate is against everyone up to that point.

// ---------------------------------------------------------------------------
// plans — what each one IS. What each one COSTS is not here: prices live in
// public.subscription_prices, one row per plan per currency, and are read at
// request time for the currency this member transacts in. A plan therefore has
// no dollar figure written into it anywhere.
const PLANS = [
  {
    id: 'lite', name: 'Lite', tone: 'blue',
    tagline: 'For casual users', badge: null, featured: false,
    features: [
      '10 downloads per day — double the free limit',
      'Browse premium content previews',
      'High-quality 1600px downloads — originals need Premium',
      'Good for trying the platform',
    ],
    cta: 'Start Lite',
  },
  {
    id: 'premium', name: 'Premium', tone: 'purple',
    tagline: 'For active creators', badge: '★ Most Popular', featured: true,
    features: [
      '15 downloads per day — triple the free limit',
      'Full-resolution original files',
      'Full access to premium artworks',
      'Premium resources & blog extras',
      'Better support',
    ],
    cta: 'Go Premium',
  },
  {
    id: 'max', name: 'Max', tone: 'gold',
    tagline: 'For power users and serious buyers', badge: '⚡ Best Value',
    featured: false,
    features: [
      '20 downloads per day — the highest limit',
      'Everything in Premium',
      'Full-resolution original files',
      'Exclusive artworks and resources',
      'Early access to new features',
      'Priority support',
    ],
    cta: 'Get Max',
  },
];


// ---------------------------------------------------------------------------
// The twelve currencies this site transacts in. Ordered as a member would
// scan them, not alphabetically. Every one has an fx rate, three plan prices
// and a support floor and ceiling — the migration checks that.
const CURRENCIES = [
  { code: 'USD', name: 'US dollar' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'SEK', name: 'Swedish krona' },
];
const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

// JPY quotes whole units; the rest have minor units.
const ZERO_DECIMAL_SRV = new Set(['JPY', 'HUF', 'TWD']);

function fmtMoney(minor, cur) {
  const major = ZERO_DECIMAL_SRV.has(cur) ? Number(minor) : Number(minor) / 100;
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency', currency: cur,
      minimumFractionDigits: ZERO_DECIMAL_SRV.has(cur) ? 0 : (major % 1 ? 2 : 0),
      maximumFractionDigits: ZERO_DECIMAL_SRV.has(cur) ? 0 : 2,
    }).format(major);
  } catch { return major + ' ' + cur; }
}

const QUOTA = [
  { plan: 'Free', num: '5', tone: 'free' },
  { plan: 'Lite', num: '10', tone: 'lite' },
  { plan: 'Premium', num: '15', tone: 'premium' },
  { plan: 'Max', num: '20', tone: 'max' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plansHtml(priced) {
  const quota =
    '<div class="subQuota" role="group" aria-labelledby="subQuotaTitle">' +
      '<div class="subQuotaTitle" id="subQuotaTitle">Daily download limit</div>' +
      '<ul class="subQuotaRow">' +
      QUOTA.map((q) =>
        '<li class="subQuotaCell subQuotaCell--' + q.tone + '">' +
          '<span class="subQuotaPlan">' + esc(q.plan) + '</span>' +
          '<span class="subQuotaNum">' + esc(q.num) + '</span>' +
          '<span class="subQuotaUnit">per day</span>' +
        '</li>').join('') +
      '</ul>' +
      '<p class="subQuotaNote">Your allowance resets every day at midnight UTC. ' +
      'Downloading your own artwork never counts against it. Premium and Max ' +
      'download the original file; Free and Lite get a high-quality 1600px copy.</p>' +
    '</div>';

  const cards =
    '<div class="subGrid">' +
    priced.map((p) =>
      '<div class="subCard subCard--' + p.tone + (p.featured ? ' subCard--featured' : '') + '">' +
        '<div class="subCardInner">' +
          (p.badge ? '<div class="subBadge subBadge--' + p.tone + '">' + esc(p.badge) + '</div>' : '') +
          '<div class="subPlanName">' + esc(p.name) + '</div>' +
          '<div class="subTagline">' + esc(p.tagline) + '</div>' +
          '<div class="subPrice">' + esc(p.price) + '</div>' +
          '<div class="subPricePer">per month</div>' +
          '<div class="subCardDiv"></div>' +
          '<ul class="subFeatures">' +
          p.features.map((f) => '<li>' + esc(f) + '</li>').join('') +
          '</ul>' +
          '<button class="subBtn subBtn--' + p.tone + '" data-plan="' + esc(p.id) + '" ' +
            'aria-label="' + esc(p.cta) + '">' + esc(p.cta) + '</button>' +
        '</div>' +
      '</div>').join('') +
    '</div>';

  return '<div class="subPgHeadline"><h2>Choose Your Plan</h2>' +
         '<p>Support the project and unlock exclusive benefits</p></div>' +
         quota + cards;
}

// ---------------------------------------------------------------------------
// the module itself
//
// Written against a single injected config object so nothing needs
// interpolating into the body — no backticks and no ${ } below, which is what
// keeps this readable as ordinary JavaScript rather than an escaping puzzle.
const MODULE = `
(function(C){
  'use strict';

  // The two providers take DIFFERENT things, and the chooser has to say so
  // before the buyer commits — someone who only has a card must not pick
  // PayPal and find there is nothing there for them, and someone who wants to
  // pay from a PayPal balance must not be sent to a card form.
  //
  //   Razorpay  every method the account has switched on: credit card, debit
  //             card, UPI, net banking, wallets, EMI.
  //   PayPal    the PayPal account itself, and nothing else. Card funding is
  //             turned off in the SDK url below, so PayPal's guest
  //             "Debit or Credit Card" button is not offered here at all.
  //
  // Each provider's card carries that provider's OWN logo and colours —
  // Razorpay's blue chevron, PayPal's double-P on their navy and gold. The
  // marks are inline SVG rather than a letter or a hosted image: a payment
  // choice must not be waiting on someone else's CDN, and a broken image where
  // the gateway's logo belongs is exactly the moment a buyer stops trusting
  // the page. The colours are fixed hex, not theme variables, for the same
  // reason — a Razorpay card that turns purple in one theme stops looking like
  // Razorpay.
  //
  // Held as bare paths rather than finished SVG, because the same artwork is
  // drawn twice: white on the provider's colour at the head of a card, and in
  // the brand's own colour on a white chip in the accepted-methods strip.
  var PATH_RZP =
    'M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24z' +
    'M14.26 10.098L3.389 17.166 1.564 24h9.008l3.688-13.902Z';
  var PATH_PP =
    'M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222' +
    'c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743' +
    'a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142' +
    'c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083' +
    '-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612' +
    'c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126' +
    'a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z';

  function svgOf(path, fill){
    return '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"' +
      (fill ? ' style="fill:' + fill + '"' : '') + '><path d="' + path + '"/></svg>';
  }

  // What each provider actually takes, in the brands' own marks rather than in
  // our words for them. A buyer recognises the Visa and Mastercard logos in a
  // way no chip reading "Credit card" can manage.
  //
  // UPI and RuPay have no artwork we are able to carry offline, and an
  // approximated logo would be worse than none — so UPI is shown by the apps
  // that ride it, which is what a buyer opens anyway, and the exact wording
  // stays in the chips underneath where nothing is left to a logo to imply.
  var MARKS = {
    visa: { name: 'Visa', hex: '#1A1F71',
      path: 'M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z' },
    mc: { name: 'MasterCard', hex: '#EB001B',
      path: 'M11.343 18.031c.058.049.12.098.181.146-1.177.783-2.59 1.238-4.107 1.238C3.32 19.416 0 16.096 0 12c0-4.095 3.32-7.416 7.416-7.416 1.518 0 2.931.456 4.105 1.238-.06.051-.12.098-.165.15C9.6 7.489 8.595 9.688 8.595 12c0 2.311 1.001 4.51 2.748 6.031zm5.241-13.447c-1.52 0-2.931.456-4.105 1.238.06.051.12.098.165.15C14.4 7.489 15.405 9.688 15.405 12c0 2.31-1.001 4.507-2.748 6.031-.058.049-.12.098-.181.146 1.177.783 2.588 1.238 4.107 1.238C20.68 19.416 24 16.096 24 12c0-4.094-3.32-7.416-7.416-7.416zM12 6.174c-.096.075-.189.15-.28.231C10.156 7.764 9.169 9.765 9.169 12c0 2.236.987 4.236 2.551 5.595.09.08.185.158.28.232.096-.074.189-.152.28-.232 1.563-1.359 2.551-3.359 2.551-5.595 0-2.235-.987-4.236-2.551-5.595-.09-.08-.184-.156-.28-.231z' },
    gpay: { name: 'Google Pay', hex: '#4285F4',
      path: 'M3.963 7.235A3.963 3.963 0 00.422 9.419a3.963 3.963 0 000 3.559 3.963 3.963 0 003.541 2.184c1.07 0 1.97-.352 2.627-.957.748-.69 1.18-1.71 1.18-2.916a4.722 4.722 0 00-.07-.806H3.964v1.526h2.14a1.835 1.835 0 01-.79 1.205c-.356.241-.814.379-1.35.379-1.034 0-1.911-.697-2.225-1.636a2.375 2.375 0 010-1.517c.314-.94 1.191-1.636 2.225-1.636a2.152 2.152 0 011.52.594l1.132-1.13a3.808 3.808 0 00-2.652-1.033zm6.501.55v6.9h.886V11.89h1.465c.603 0 1.11-.196 1.522-.588a1.911 1.911 0 00.635-1.464 1.92 1.92 0 00-.635-1.456 2.125 2.125 0 00-1.522-.598zm2.427.85a1.156 1.156 0 01.823.365 1.176 1.176 0 010 1.686 1.171 1.171 0 01-.877.357H11.35V8.635h1.487a1.156 1.156 0 01.054 0zm4.124 1.175c-.842 0-1.477.308-1.907.925l.781.491c.288-.417.68-.626 1.175-.626a1.255 1.255 0 01.856.323 1.009 1.009 0 01.366.785v.202c-.34-.193-.774-.289-1.3-.289-.617 0-1.11.145-1.479.434-.37.288-.554.677-.554 1.165a1.476 1.476 0 00.525 1.156c.35.308.785.463 1.305.463.61 0 1.098-.27 1.465-.81h.038v.655h.848v-2.909c0-.61-.19-1.09-.568-1.44-.38-.35-.896-.525-1.551-.525zm2.263.154l1.946 4.422-1.098 2.38h.915L24 9.963h-.965l-1.368 3.391h-.02l-1.406-3.39zm-2.146 2.368c.494 0 .88.11 1.156.33 0 .372-.147.696-.44.973a1.413 1.413 0 01-.997.414 1.081 1.081 0 01-.69-.232.708.708 0 01-.293-.578c0-.257.12-.47.363-.647.24-.173.54-.26.9-.26Z' },
    phonepe: { name: 'PhonePe', hex: '#5F259F',
      path: 'M10.206 9.941h2.949v4.692c-.402.201-.938.268-1.34.268-1.072 0-1.609-.536-1.609-1.743V9.941zm13.47 4.816c-1.523 6.449-7.985 10.442-14.433 8.919C2.794 22.154-1.199 15.691.324 9.243 1.847 2.794 8.309-1.199 14.757.324c6.449 1.523 10.442 7.985 8.919 14.433zm-6.231-5.888a.887.887 0 0 0-.871-.871h-1.609l-3.686-4.222c-.335-.402-.871-.536-1.407-.402l-1.274.401c-.201.067-.268.335-.134.469l4.021 3.82H6.386c-.201 0-.335.134-.335.335v.67c0 .469.402.871.871.871h.938v3.217c0 2.413 1.273 3.82 3.418 3.82.67 0 1.206-.067 1.877-.335v2.145c0 .603.469 1.072 1.072 1.072h.938a.432.432 0 0 0 .402-.402V9.874h1.542c.201 0 .335-.134.335-.335v-.67z' },
    paypal: { name: 'PayPal', hex: '#003087', path: PATH_PP }
  };

  function marksHtml(ids){
    if(!ids || !ids.length) return '';
    return '<span class="dzPayMarks">' + ids.map(function(k){
      var m = MARKS[k];
      return '<span class="dzPayMark" title="' + esc(m.name) + '" role="img" ' +
        'aria-label="' + esc(m.name) + '">' + svgOf(m.path, m.hex) + '</span>';
    }).join('') + '</span>';
  }

  // What Razorpay can actually offer depends on the ORDER'S CURRENCY, and the
  // chooser must not promise otherwise.
  //
  // UPI, net banking, wallets and EMI are domestic rails: Razorpay offers them
  // on an INR order and on nothing else. A USD order gets international cards
  // and only international cards. Listing UPI beside a dollar price is a
  // promise the checkout window then breaks, and the buyer is already
  // committed by the time they find out.
  var RZP_WAYS = {
    INR:   ['Credit card', 'Debit card', 'UPI', 'Net banking', 'Wallets', 'EMI'],
    other: ['Credit card', 'Debit card']
  };
  var RZP_MARKS = { INR: ['visa', 'mc', 'gpay', 'phonepe'], other: ['visa', 'mc'] };
  var RZP_NOTE = {
    INR:   'Pay by card, UPI, net banking or a wallet',
    other: 'Pay by card \\u2014 UPI and net banking need an item priced in rupees'
  };
  function rzpKey(cur){ return cur === 'INR' ? 'INR' : 'other'; }

  // What PayPal will settle. Mirrors the SUPPORTED set in functions/api/paypal.js,
  // which refuses anything outside it — INR most notably, which is exactly the
  // currency a seller pricing for an Indian audience will pick.
  //
  // A provider that cannot take this order is not drawn. It used to be offered
  // and then refuse, which spends the buyer's decision before telling them.
  var PP_CURRENCIES = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','SEK','NOK',
    'DKK','PLN','CZK','HUF','NZD','SGD','HKD','MXN','BRL','ILS','PHP','THB','TWD'];

  function canTake(id, cur){
    if(id !== 'paypal') return true;
    return PP_CURRENCIES.indexOf(cur) !== -1;
  }

  var PROV = {
    rzp: {
      name: 'Razorpay',
      logo: svgOf(PATH_RZP),
      note: RZP_NOTE.other,
      marks: RZP_MARKS.other,
      ways: RZP_WAYS.other
    },
    paypal: {
      name: 'PayPal',
      logo: svgOf(PATH_PP),
      note: 'Pay from your PayPal account \\u2014 cards are not accepted here',
      marks: ['paypal'],
      ways: ['PayPal balance', 'Bank linked to PayPal']
    }
  };

  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function money(cents, cur){
    try{
      return new Intl.NumberFormat(undefined,{style:'currency',currency:cur||'USD'})
        .format((Number(cents)||0)/100);
    }catch(e){ return ((Number(cents)||0)/100).toFixed(2)+' '+(cur||'USD'); }
  }

  // An order quotes its amount in the provider's smallest unit, which for a
  // zero-decimal currency is the whole unit — money() divides by a hundred, so
  // those have to be scaled back first. Same list the backends use.
  var ZERO_DEC = {JPY:1, HUF:1, TWD:1};
  function orderMoney(o){
    return money(ZERO_DEC[o.currency] ? o.amount * 100 : o.amount, o.currency);
  }

  // ---- provider sdks ------------------------------------------------------
  var rzpP = null;
  function loadRzp(){
    if(window.Razorpay) return Promise.resolve();
    if(rzpP) return rzpP;
    rzpP = new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = res;
      s.onerror = function(){ rzpP = null; rej(new Error('Could not load the payment window')); };
      document.head.appendChild(s);
    });
    return rzpP;
  }

  // PayPal is the PayPal account and nothing else here.
  //
  // Left alone, the SDK renders a second button — "Debit or Credit Card" —
  // which takes a card through PayPal's guest checkout. That is not what this
  // provider is for on this site: cards belong to Razorpay, which handles them
  // properly alongside UPI and the rest. Every card-shaped and local funding
  // source is switched off, so the sheet offers exactly one thing: sign in to
  // PayPal and pay from the account.
  var PP_OFF = ['card','credit','paylater','venmo','bancontact','blik','eps',
    'giropay','ideal','mercadopago','mybank','p24','sepa','sofort','trustly',
    'multibanco','satispay','wechatpay'].join(',');

  // The PayPal SDK fixes its currency in the script url, so a EUR listing and a
  // USD plan need two different loads. Each gets its own global through
  // data-namespace — without that the second script would quietly win and the
  // buttons would quote the wrong currency.
  var ppLoads = {};
  function loadPP(clientId, currency){
    var ns = 'dzpp_' + currency;
    if(window[ns]) return Promise.resolve(window[ns]);
    if(ppLoads[ns]) return ppLoads[ns];
    ppLoads[ns] = new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId) +
              '&currency=' + encodeURIComponent(currency) +
              '&intent=capture&components=buttons&disable-funding=' + PP_OFF;
      s.setAttribute('data-namespace', ns);
      s.async = true;
      s.onload = function(){
        if(window[ns]) res(window[ns]);
        else { delete ppLoads[ns]; rej(new Error('Could not load the payment window')); }
      };
      s.onerror = function(){ delete ppLoads[ns]; rej(new Error('Could not load the payment window')); };
      document.head.appendChild(s);
    });
    return ppLoads[ns];
  }

  // ---- backends -----------------------------------------------------------
  async function api(prov, body){
    var s = await sb.auth.getSession();
    var session = s && s.data && s.data.session;
    if(!session) throw new Error('Sign in required');
    var url = prov === 'paypal' ? '/api/paypal'
            : prov === 'payouts' ? '/api/payouts'
            : '/api/rzp';
    var res = await fetch(url, {
      method:'POST',
      headers:{'content-type':'application/json', 'authorization':'Bearer '+session.access_token},
      body: JSON.stringify(body)
    });
    var j = await res.json().catch(function(){return{};});
    if(!res.ok) throw new Error(j.error || 'Payment service error');
    return j;
  }

  function gate(){
    if(window.currentUser) return false;
    if(typeof pfGuestGate === 'function')
      pfGuestGate({preventDefault:function(){},stopPropagation:function(){}});
    return true;
  }
  function toast(m){ if(typeof showToast === 'function') showToast(m); }

  // ---- the sheet ----------------------------------------------------------
  // The small forms — request a payout, add a payout method. Buying is NOT one
  // of these any more: a purchase gets the full checkout page further down,
  // because a popup is the wrong shape for "here is exactly what you are
  // paying for, and exactly what you get".
  var sheet = null;
  function closeSheet(){
    if(!sheet) return;
    document.removeEventListener('keydown', sheet.onKey, true);
    if(sheet.root.parentNode) sheet.root.parentNode.removeChild(sheet.root);
    sheet = null;
  }
  function openSheet(title){
    closeSheet();
    var root = document.createElement('div');
    root.className = 'dzPay';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label', title || 'Checkout');
    root.innerHTML =
      '<div class="dzPayCard">' +
        '<button class="dzPayX" type="button" aria-label="Close">\\u2715</button>' +
        '<div class="dzPayTitle">' + esc(title || 'Checkout') + '</div>' +
        '<div class="dzPayBody"></div>' +
      '</div>';

    var onKey = function(e){ if(e.key === 'Escape'){ e.stopPropagation(); closeSheet(); } };
    root.querySelector('.dzPayX').addEventListener('click', closeSheet);
    root.addEventListener('click', function(e){ if(e.target === root) closeSheet(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);

    sheet = { root:root, body:root.querySelector('.dzPayBody'), onKey:onKey };
    return sheet;
  }

  // ---- provider runs ------------------------------------------------------
  // No 'method' block is passed to Razorpay, and that is deliberate.
  //
  // It used to name every method explicitly, as documentation. It could only
  // ever SUBTRACT: Razorpay shows what the account has enabled for the order's
  // currency, and a hand-written list silently hides anything not on it — a
  // method added to the account later, or one this list never knew about
  // (cardless EMI, bank transfer, the pay-by-app options). Left off, the
  // account settings decide, which is where that decision belongs.
  function runRzp(order, onPaid){
    gateNote('Opening ' + PROV.rzp.name + '\\u2026');
    return loadRzp().then(function(){
      if(!co) return;                       // buyer left while the sdk loaded
      // The checkout page stays up UNDERNEATH Razorpay's own window. A buyer
      // who dismisses it lands back on their order rather than on whatever
      // page they started from, and can pick again without starting over.
      gatePaying('rzp', order, 'Razorpay is open. Finish paying in its window \\u2014 ' +
        'card, UPI, net banking or a wallet, whichever you prefer.');
      new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'DigiArtz',
        description: order.label || '',
        theme: { color: '#7C3AED' },
        handler: function(r){
          gateNote('Confirming your payment\\u2026');
          api('rzp', {action:'verify', orderId:r.razorpay_order_id,
               paymentId:r.razorpay_payment_id, signature:r.razorpay_signature})
            .then(function(x){ closeCo(); onPaid(x); },
                  function(e){
                    gateNote(e.message || 'Could not verify the payment');
                    toast(e.message || 'Could not verify the payment');
                  });
        },
        modal: { ondismiss: function(){
          toast('Payment cancelled');
          if(co) coRetry('Razorpay was closed before the payment went through.');
        } }
      }).open();
    });
  }

  // PayPal draws its own buttons, so they are rendered into the gateway step of
  // the checkout page — the buyer keeps the order in front of them the whole
  // time. The order already exists server-side by this point; createOrder just
  // names it, which is what keeps the amount out of the browser's hands.
  function runPP(order, onPaid){
    gateNote('Loading ' + PROV.paypal.name + '\\u2026');
    return loadPP(order.clientId, order.currency).then(function(pp){
      if(!co) return;                       // buyer left while the sdk loaded
      co.gate.innerHTML =
        payingHtml('paypal', order) +
        '<div class="dzCoGateNote">Sign in to PayPal to finish. Cards are not ' +
          'accepted through PayPal here \\u2014 choose Razorpay above to pay by card.</div>' +
        '<div class="dzPayBtns"></div>';
      var host = co.gate.querySelector('.dzPayBtns');
      var settled = false;

      pp.Buttons({
        style: { layout:'vertical', shape:'rect', height:48 },
        createOrder: function(){ return order.orderId; },
        onApprove: function(){
          settled = true;
          gateNote('Confirming your payment\\u2026');
          return api('paypal', {action:'capture', orderId:order.orderId})
            .then(function(r){ closeCo(); onPaid(r); },
                  function(e){
                    gateNote(e.message || 'Could not verify the payment');
                    toast(e.message || 'Could not verify the payment');
                  });
        },
        onCancel: function(){
          toast('Payment cancelled');
          coRetry('You closed the PayPal window before paying.');
        },
        onError: function(){
          if(settled) return;
          coRetry('PayPal could not complete the payment. You can try Razorpay instead.');
        }
      }).render(host).catch(function(){
        coRetry('PayPal could not open here. Try Razorpay instead.');
      });
    });
  }

  // ---- the checkout page --------------------------------------------------
  // A purchase gets a whole page, not a popup. Top to bottom it answers the
  // three questions in the order a buyer actually asks them:
  //
  //   1  What am I buying, and what do I get for it?
  //   2  How am I paying — which of the two, and what does each one take?
  //   3  The gateway itself, which only appears once a method is chosen.
  //
  // Nothing is ordered and no ledger row is written until step 2 is answered,
  // so leaving from step 1 costs nothing and leaves no trace.
  var co = null;

  function closeCo(){
    if(!co) return;
    document.removeEventListener('keydown', co.onKey, true);
    if(co.root.parentNode) co.root.parentNode.removeChild(co.root);
    document.documentElement.classList.remove('dzCoOpen');
    co = null;
  }

  function gateNote(msg){
    if(co) co.gate.innerHTML = '<div class="dzCoGateNote">' + esc(msg) + '</div>';
  }

  // Whose window is about to open, in their own logo and colours, so the
  // gateway step names the provider the same way the chooser did.
  function provHtml(id){
    var p = PROV[id];
    return '<div class="dzCoProv dzCoProv--' + esc(id) + '">' +
      '<span class="dzPayLogo">' + p.logo + '</span>' +
      '<span class="dzCoProvName">' + esc(p.name) + '</span></div>';
  }

  // The amount again, at the gateway, straight off the order the SERVER made —
  // not off the figure step 1 quoted. If those two ever disagreed, this is
  // where the buyer would see it before paying rather than after.
  function payingHtml(id, order){
    return provHtml(id) +
      '<div class="dzCoPaying">' +
        '<span class="dzCoPayingWhat">' + esc(order.label || 'Your order') + '</span>' +
        '<span class="dzCoPayingAmt">' + esc(orderMoney(order)) + '</span>' +
      '</div>';
  }
  function gatePaying(id, order, msg){
    if(co) co.gate.innerHTML = payingHtml(id, order) +
      '<div class="dzCoGateNote">' + esc(msg) + '</div>';
  }

  // Something went wrong, or the buyer backed out of a provider's window. The
  // order still stands — it is the method that needs choosing again — so the
  // page goes back to step 2 with the reason on it rather than collapsing.
  function coRetry(why){
    if(!co) return;
    co.step3.hidden = true;
    co.pickMsg.textContent = why || '';
    co.pickMsg.hidden = !why;
    coSelect(null);
    co.how.scrollIntoView({behavior:'smooth', block:'center'});
  }

  function coSelect(id){
    if(!co) return;
    Array.prototype.forEach.call(co.root.querySelectorAll('.dzPayOpt'), function(b){
      var on = b.getAttribute('data-prov') === id;
      b.classList.toggle('dzPayOpt--on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // What the buyer is paying for, drawn from what the page already knows —
  // no extra round trip before the order even exists.
  function itemHtml(s){
    var thumb = s.thumb
      ? '<img class="dzCoThumb" src="' + esc(s.thumb) + '" alt="" loading="lazy" decoding="async">'
      : '<span class="dzCoThumb dzCoThumbNo" aria-hidden="true">' + esc(s.icon || '\\u25a6') + '</span>';
    return '<div class="dzCoItem">' + thumb +
        '<div class="dzCoItemMain">' +
          '<div class="dzCoItemName">' + esc(s.name) + '</div>' +
          (s.sub ? '<div class="dzCoItemSub">' + esc(s.sub) + '</div>' : '') +
        '</div>' +
        '<div class="dzCoItemPrice">' + esc(s.price) + '</div>' +
      '</div>' +
      (s.gets && s.gets.length
        ? '<div class="dzCoGetsHead">What you get</div><ul class="dzCoGets">' +
          s.gets.map(function(g){ return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>'
        : '') +
      '<dl class="dzCoTot">' +
        '<div class="dzCoTotRow"><dt>' + esc(s.priceLabel || 'Item price') + '</dt>' +
          '<dd>' + esc(s.price) + '</dd></div>' +
        '<div class="dzCoTotRow"><dt>Fees</dt><dd>None</dd></div>' +
        '<div class="dzCoTotRow dzCoTotRow--sum"><dt>Total</dt>' +
          '<dd>' + esc(s.price) + '</dd></div>' +
      '</dl>' +
      (s.note ? '<p class="dzCoItemNote">' + esc(s.note) + '</p>' : '');
  }

  // The two providers, side by side and clearly ALTERNATIVES — one or the
  // other, never both. The "or" between them is not decoration: they take
  // different things, and a buyer choosing blind is how someone with only a
  // card ends up in PayPal with nothing to pay with.
  function pickHtml(list, currency){
    var k = rzpKey(currency);
    var opts = list.map(function(id){
      var p = PROV[id];
      // Razorpay's offer is currency-dependent; PayPal's is not.
      if(id === 'rzp')
        p = { name: p.name, logo: p.logo,
              note: RZP_NOTE[k], marks: RZP_MARKS[k], ways: RZP_WAYS[k] };
      return '<button class="dzPayOpt dzPayOpt--' + esc(id) + '" type="button" ' +
               'data-prov="' + esc(id) + '" aria-pressed="false">' +
               '<span class="dzPayOptTop">' +
                 // our own constant markup, not anything a row supplied
                 '<span class="dzPayLogo">' + p.logo + '</span>' +
                 '<span class="dzPayOptName">' + esc(p.name) + '</span>' +
                 '<span class="dzPayOptTick" aria-hidden="true">\\u2713</span>' +
               '</span>' +
               '<span class="dzPayOptNote">' + esc(p.note) + '</span>' +
               marksHtml(p.marks) +
               '<span class="dzPayOptWays">' +
                 p.ways.map(function(w){
                   return '<span class="dzPayWay">' + esc(w) + '</span>';
                 }).join('') +
               '</span>' +
             '</button>';
    });
    return '<div class="dzPayPick">' +
      opts.join('<div class="dzPayOr"><span>or</span></div>') + '</div>';
  }

  function openCo(spec, list){
    closeCo();
    var root = document.createElement('div');
    root.className = 'dzCo';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Checkout');
    root.innerHTML =
      '<header class="dzCoBar">' +
        '<button class="dzCoBack" type="button" aria-label="Leave checkout">\\u2190</button>' +
        // the wordmark exactly as the site wears it everywhere else: Digi in
        // the page's own text colour, Artz in the brand red
        '<div class="dzCoBrand">Digi<span class="dzCoBrandA">Artz</span></div>' +
        '<div class="dzCoLock"><span aria-hidden="true">\\ud83d\\udd12</span>Secure</div>' +
      '</header>' +
      '<div class="dzCoScroll"><div class="dzCoWrap">' +
        '<h1 class="dzCoH1">' + esc(spec.title || 'Checkout') + '</h1>' +

        '<section class="dzCoStep">' +
          '<div class="dzCoStepHead"><span class="dzCoNum">1</span>' +
            '<h2>What you\\u2019re buying</h2></div>' +
          '<div class="dzCoBox' +
            (spec.tone ? ' dzCoTone dzCoTone--' + esc(spec.tone) : '') + '">' +
            itemHtml(spec) +
          '</div>' +
        '</section>' +

        '<section class="dzCoStep" id="dzCoHow">' +
          '<div class="dzCoStepHead"><span class="dzCoNum">2</span>' +
            '<h2>Payment method</h2></div>' +
          '<div class="dzCoBox">' +
            '<div class="dzCoPickMsg" hidden></div>' +
            pickHtml(list, spec.currency) +
          '</div>' +
        '</section>' +

        '<section class="dzCoStep" id="dzCoGo" hidden>' +
          '<div class="dzCoStepHead"><span class="dzCoNum">3</span>' +
            '<h2>Payment gateway</h2></div>' +
          '<div class="dzCoBox dzCoGate"></div>' +
        '</section>' +

        '<p class="dzCoFine">Your card, UPI or PayPal details are entered in the ' +
          'provider\\u2019s own window and never reach DigiArtz. Questions about a ' +
          'payment: DigiArtzsupport@gmail.com</p>' +
      '</div></div>';

    var onKey = function(e){ if(e.key === 'Escape'){ e.stopPropagation(); closeCo(); } };
    root.querySelector('.dzCoBack').addEventListener('click', closeCo);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    document.documentElement.classList.add('dzCoOpen');

    co = {
      root: root,
      onKey: onKey,
      how: root.querySelector('#dzCoHow'),
      step3: root.querySelector('#dzCoGo'),
      gate: root.querySelector('.dzCoGate'),
      pickMsg: root.querySelector('.dzCoPickMsg')
    };
    return co;
  }

  // ---- one flow, either provider -----------------------------------------
  // The provider list was decided server-side, from which credentials are
  // actually bound — a provider with nothing bound is never drawn. Nothing is
  // ordered, and no ledger row written, until one has been picked.
  function start(spec, order, onPaid){
    if(gate()) return;
    var all  = C.providers || [];
    var list = all.filter(function(id){ return canTake(id, spec.currency); });
    if(!all.length){ toast('Checkout is not available right now'); return; }
    if(!list.length){
      toast('No checkout here takes ' + (spec.currency || 'that currency'));
      return;
    }

    openCo(spec, list);

    function pick(id){
      if(!co) return;
      coSelect(id);
      co.pickMsg.hidden = true;
      co.step3.hidden = false;
      gateNote('Getting your order ready\\u2026');
      co.step3.scrollIntoView({behavior:'smooth', block:'center'});

      order(id)
        .then(function(o){
          if(!o){ closeCo(); return; }              // handled by the caller
          if(!co) return;                           // buyer left
          return id === 'paypal' ? runPP(o, onPaid) : runRzp(o, onPaid);
        })
        .catch(function(e){
          toast(e.message || 'Could not start checkout');
          coRetry(e.message || 'Could not start checkout');
        });
    }

    Array.prototype.forEach.call(co.root.querySelectorAll('.dzPayOpt'), function(b){
      b.addEventListener('click', function(){ pick(b.getAttribute('data-prov')); });
    });

    // One provider bound and there is no choice to make — the step still shows
    // what it takes, and the gateway opens straight away.
    if(list.length === 1) pick(list[0]);
  }

  // ---- entry points -------------------------------------------------------
  // A plan's own card is the honest description of what the money buys, so the
  // checkout page reuses it rather than inventing a shorter one.
  function planSpec(id, amount){
    // The member's own currency, which is what the plan was priced in. This
    // used to say 'USD' with a note that plans are priced in dollars
    // server-side; that stopped being true when prices moved into
    // subscription_prices, one row per plan per currency. The string stayed,
    // and it is what decides the accepted-methods strip and which providers
    // are drawn — so an INR member was quoted a rupee price, told only cards
    // were taken, and offered PayPal, which refuses INR. sub-order reads the
    // same profile column, so this is the currency the order is created in.
    var cur = C.currency || 'USD';
    var p = null;
    (C.plans || []).forEach(function(x){ if(x.id === id) p = x; });
    if(p) return {
      title: 'Checkout',
      name: p.name + ' membership',
      sub: 'One month \\u00b7 ' + p.tagline,
      price: p.price,             // already formatted in cur, server-side
      priceLabel: 'Plan price',
      currency: cur,
      icon: '\\u2605',
      // Lite is blue, Premium purple, Max gold on the plan page. Checkout
      // wears the same colour, so the buyer can see they are paying for the
      // card they tapped and not one next to it.
      tone: p.tone,
      gets: p.features,
      note: 'A single charge for 31 days. Nothing recurring \\u2014 it does not ' +
            'renew itself, and you keep anything you bought on the marketplace ' +
            'whatever happens to your plan.'
    };
    return {
      title: 'Support DigiArtz',
      name: 'Support DigiArtz',
      sub: 'A one-off contribution',
      price: money(amount, cur),
      priceLabel: 'Amount',
      currency: cur,
      icon: '\\u2665',
      gets: ['Keeps the servers and storage paid for',
             'No plan or tier attached \\u2014 this is a thank-you, not a purchase'],
      note: 'Nothing is unlocked by this and nothing recurs.'
    };
  }

  window.dzSubBuy = function(plan){
    if(gate()) return;
    var amount = null;
    if(plan === 'support'){
      var cur = C.currency || 'USD';
      var min = (C.support && C.support.min) || 50;
      var v = prompt('Support amount in ' + cur +
                     ' (minimum ' + money(min, cur) + '):', '');
      if(v === null) return;
      amount = minorOf(parseFloat(v), cur);
      if(!Number.isFinite(amount) || amount < min){
        toast('Minimum is ' + money(min, cur)); return;
      }
    }
    start(planSpec(plan, amount), function(prov){
      return api(prov, {action:'sub-order', plan:plan, amount:amount});
    }, function(r){
      toast(r.tier ? 'Subscription active' : 'Thank you for the support');
    });
  };

  // The listing's own slot carries the title, preview and price the page is
  // already showing, so the checkout page can name what is being bought
  // without a round trip and without waiting.
  function slotSpec(id, hasFile){
    var el = document.querySelector('.dzSlot[data-i="' + id + '"]');
    var title = (el && el.getAttribute('data-t')) || 'Marketplace item';
    var prev  = (el && el.getAttribute('data-th')) || '';
    var cents = Number((el && el.getAttribute('data-p')) || 0);
    var cur   = (el && el.getAttribute('data-c')) || 'USD';
    return {
      title: 'Checkout',
      name: title,
      sub: hasFile ? 'Digital files \\u00b7 instant access once paid'
                   : 'Marketplace listing',
      price: money(cents, cur),
      priceLabel: 'Item price',
      currency: cur,
      thumb: prev && typeof getThumbnailUrl === 'function' ? getThumbnailUrl(prev) : prev,
      gets: hasFile
        ? ['Every file on this listing, at the seller\\u2019s original quality',
           'Re-download as often as you like, no limit and no expiry',
           'Yours permanently \\u2014 no subscription tier is involved']
        : ['Access to this listing as the seller delivers it'],
      note: 'Bought once, yours to keep. Your files appear under My Purchases ' +
            'the moment the payment is confirmed.'
    };
  }

  window.dzMarketBuy = function(id, hasFile){
    start(slotSpec(id, hasFile), function(prov){
      return api(prov, {action:'market-order', itemId:id}).then(function(o){
        if(o.owned){                      // bought before, straight to the files
          afterPurchase(id, hasFile, true);
          return null;
        }
        return o;
      });
    }, function(){
      afterPurchase(id, hasFile, false);
    });
  };

  // Where a sale ends. The payment has been verified by the provider and
  // recorded by its backend before this runs, so the item is already unlocked
  // by the time the buyer is shown it — nothing here grants anything.
  //
  // The buyer lands on My Purchases rather than back on the listing they were
  // reading, because that page is the answer to the question they now have:
  // where are my files, and where will they be tomorrow.
  function afterPurchase(id, hasFile, wasAlreadyOwned){
    toast(wasAlreadyOwned ? 'You already own this' : 'Purchased \\u2014 your files are unlocked');
    ownedIds[id] = true;
    repaintOwned();
    purchasesP = null;
    if(document.getElementById('setListGate')){
      openPanel('buy');
    } else if(hasFile && typeof window.dzMarketGet === 'function'){
      window.dzMarketGet(id);
    }
  }

  // ---- filling the gaps the public bundle leaves --------------------------
  // js/sections.js and js/profile.js render an empty slot wherever a price or
  // a buy control belongs, and index.html holds an empty container where the
  // plan grid belongs. Neither file contains the markup, so a signed-out
  // visitor's page has nothing to read. This puts it back.
  function fillPlans(){
    var host = document.getElementById('subPgGate');
    if(!host || host.dataset.dzFilled) return;
    host.innerHTML = C.plansHtml;
    host.dataset.dzFilled = '1';
    Array.prototype.forEach.call(host.querySelectorAll('.subBtn'), function(b){
      b.addEventListener('click', function(){ window.dzSubBuy(b.getAttribute('data-plan')); });
    });
  }

  // What this caller has already bought, as far as the last answer goes. It is
  // a display hint and nothing more: the download itself is authorised in
  // Postgres on every single request, so a stale or forged entry here buys
  // exactly nothing.
  var ownedIds = {};

  function paintSlot(el){
    var id      = el.getAttribute('data-i') || '';
    var cents   = Number(el.getAttribute('data-p') || 0);
    var cur     = el.getAttribute('data-c') || 'USD';
    var hasFile = el.getAttribute('data-f') === '1';
    var view    = el.getAttribute('data-v') === 'view';
    var priced  = cents > 0;
    var owned   = !!ownedIds[id];

    var price = '<div class="' + (view ? 'dzvPrice' : 'dzPrice') + '">' +
                (owned && priced ? 'Purchased' : esc(money(cents, cur))) + '</div>';
    var btn;
    if(owned && hasFile){
      // The only state in which a download control exists at all. Everyone
      // else — signed out, signed in, subscribed to anything — gets the price.
      btn = '<button class="dzBuy dzBuy--own" type="button" data-act="get">' +
              (view ? '\\u2b07 Download your files' : '\\u2b07 Download') + '</button>';
    } else if(owned){
      btn = '<div class="dzOwnNote">Purchased</div>';
    } else if(priced){
      btn = '<button class="dzBuy" type="button" data-act="buy">' +
              (view ? 'Buy now' : 'Buy \\u00b7 ' + esc(money(cents, cur))) + '</button>';
    } else {
      btn = hasFile
        ? '<button class="dzBuy dzBuy--free" type="button" data-act="get">Download \\u00b7 Free</button>'
        : '';
    }

    el.innerHTML = view ? '<div class="dzvBuyCard">' + price + btn + '</div>' : price + btn;

    Array.prototype.forEach.call(el.querySelectorAll('button'), function(b){
      b.addEventListener('click', function(e){
        e.stopPropagation();
        if(b.getAttribute('data-act') === 'buy') window.dzMarketBuy(id, hasFile ? 1 : 0);
        else if(typeof window.dzMarketGet === 'function') window.dzMarketGet(id);
      });
    });

    // the lock note the public bundle leaves on the detail view has nothing
    // left to say once these files are this caller's
    var lock = document.getElementById('dzvLock-' + id);
    if(lock) lock.hidden = owned;
  }

  function repaintOwned(){
    Array.prototype.forEach.call(document.querySelectorAll('.dzSlot[data-i]'), function(el){
      if(el.dataset.dzFilled) paintSlot(el);
    });
  }

  // One question for the whole page rather than one per card.
  function askOwned(ids){
    if(!ids.length || !window.sb || !sb.rpc) return;
    sb.rpc('dz_market_owned', {p_items: ids}).then(function(res){
      if(!res || res.error || !res.data) return;
      var got = false;
      (res.data || []).forEach(function(r){
        var v = (r && typeof r === 'object') ? (r.dz_market_owned || r.id || '') : r;
        if(v){ ownedIds[String(v)] = true; got = true; }
      });
      if(got) repaintOwned();
    }, function(){ /* a slot that stays priced is the safe way to be wrong */ });
  }

  function fillSlots(){
    var fresh = [];
    Array.prototype.forEach.call(document.querySelectorAll('.dzSlot'), function(el){
      if(el.dataset.dzFilled) return;
      el.dataset.dzFilled = '1';
      paintSlot(el);
      var id = el.getAttribute('data-i');
      if(id && !ownedIds[id] && fresh.indexOf(id) === -1) fresh.push(id);
    });
    askOwned(fresh);
  }

  // ---- wallet and payout methods -----------------------------------------
  // Both live in profile settings, both behind this module, so a signed-out
  // visitor's page carries neither the markup nor the endpoint. Every figure
  // shown here was computed server-side from the ledger — nothing below adds
  // money up, it only formats what it was handed.
  function pay(action, extra){
    return api('payouts', Object.assign({action:action}, extra || {}));
  }

  function when(iso){
    try{
      return new Date(iso).toLocaleDateString(undefined,
        {year:'numeric', month:'short', day:'numeric'});
    }catch(e){ return ''; }
  }

  var STATUS_WORD = {
    paid:'Success', created:'Pending', requested:'Requested', approved:'Approved',
    processing:'Sending', failed:'Failed', refunded:'Refunded', rejected:'Rejected',
    available:'Cleared', pending:'On hold', reversed:'Reversed', paid_out:'Paid out'
  };

  function row(h){
    var sign = h.direction === 'purchase' ? '−' : h.direction === 'payout' ? '−' : '+';
    var cls  = h.direction === 'sale' ? 'dzWlIn' : 'dzWlOut';
    var who  = h.direction === 'purchase' ? 'You bought'
             : h.direction === 'sale'     ? 'Someone bought'
             : 'You withdrew';
    return '<li class="dzWlRow">' +
      '<div class="dzWlMain">' +
        '<div class="dzWlTitle">' + esc(h.title || '') + '</div>' +
        '<div class="dzWlSub">' + esc(who) + ' · ' + esc(when(h.happened_at)) +
          (h.provider ? ' · ' + esc(h.provider) : '') + '</div>' +
      '</div>' +
      '<div class="dzWlRight">' +
        '<div class="dzWlAmt ' + cls + '">' + sign + esc(money(h.amount, h.currency)) + '</div>' +
        '<div class="dzWlSt dzWlSt--' + esc(h.status) + '">' +
          esc(STATUS_WORD[h.status] || h.status) + '</div>' +
      '</div></li>';
  }

  function methodLine(m){
    var what = m.kind === 'paypal_email' ? 'PayPal · ' + esc(m.paypal_email)
             : m.kind === 'upi'          ? 'UPI · ' + esc(m.upi_vpa)
             : 'Bank · ' + esc(m.bank_name || 'Account') + ' ••••' + esc(m.bank_last4 || '');
    return '<li class="dzBkRow' + (m.is_default ? ' dzBkRow--def' : '') + '">' +
      '<div class="dzBkMain"><div class="dzBkWhat">' + what + '</div>' +
      '<div class="dzBkSub">' + esc(m.label || '') +
        (m.is_default ? '<span class="dzBkTag">Default</span>' : '') + '</div></div>' +
      '<div class="dzBkActs">' +
        (m.is_default ? '' : '<button type="button" class="dzBkBtn" data-def="' + esc(m.id) + '">Make default</button>') +
        '<button type="button" class="dzBkBtn dzBkBtn--rm" data-rm="' + esc(m.id) + '">Remove</button>' +
      '</div></li>';
  }

  var METHOD_FORMS = {
    paypal_email:
      '<label class="dzBkLbl">PayPal email</label>' +
      '<input class="dzBkIn" data-f="paypalEmail" type="email" autocomplete="off" placeholder="you@example.com">',
    upi:
      '<label class="dzBkLbl">UPI ID</label>' +
      '<input class="dzBkIn" data-f="upi" type="text" autocomplete="off" placeholder="name@bank">',
    bank_account:
      '<label class="dzBkLbl">Account holder name</label>' +
      '<input class="dzBkIn" data-f="holderName" type="text" autocomplete="off" placeholder="As it appears on the account">' +
      '<label class="dzBkLbl">Bank name</label>' +
      '<input class="dzBkIn" data-f="bankName" type="text" autocomplete="off" placeholder="Bank">' +
      '<label class="dzBkLbl">Account number</label>' +
      '<input class="dzBkIn" data-f="accountNumber" type="text" inputmode="numeric" autocomplete="off" placeholder="Account number">' +
      '<label class="dzBkLbl">IFSC</label>' +
      '<input class="dzBkIn" data-f="ifsc" type="text" autocomplete="off" placeholder="ABCD0123456">' +
      '<p class="dzBkNote">Only the last four digits are kept, so you can tell your ' +
      'accounts apart. The full number is never stored.</p>'
  };

  // The wallet has two halves and they are kept apart on purpose.
  //
  // PENDING holds the gross of sales that have not settled yet. It is the
  // whole sale, before the gateway's fee, our commission and any tax, and NONE
  // of it is withdrawable — the money is still with the gateway. Showing it
  // inside the wallet balance is how a seller comes to believe a hundred-pound
  // sale is a hundred pounds of theirs.
  //
  // WALLET holds only what has settled and survived every deduction. That is
  // the number they can actually have, and it is the only number the payout
  // button will accept.
  //
  // Per currency, both of them, with no total across currencies — producing
  // one would need an exchange rate, and a seller's money is never converted.
  function pendingCard(s){
    var cur = s.currency;
    var g   = s.pending_gross || 0;
    if(!g) return '';
    var rows = [
      ['Gateway fee',        s.pending_gateway || 0],
      ['DigiArtz commission', s.pending_fee || 0],
      ['Tax withheld (194-O)', s.pending_tds || 0],
      ['GST TCS collected',  s.pending_tcs || 0]
    ].filter(function(r){ return r[1] > 0; });

    return '<div class="dzWlPend">' +
      '<div class="dzWlPendTop">' +
        '<span class="dzWlPendLbl">Pending \\u00b7 ' + esc(cur) + '</span>' +
        '<span class="dzWlPendAmt">' + esc(money(g, cur)) + '</span>' +
      '</div>' +
      '<p class="dzWlPendWhy">Sold, but still with the payment provider. None of ' +
        'this can be withdrawn yet' +
        (s.next_clears_at ? ' \\u2014 the first of it clears on ' + esc(when(s.next_clears_at)) : '') +
        '.' + (s.settlement_note ? ' ' + esc(s.settlement_note) + '.' : '') + '</p>' +
      '<ul class="dzWlPendList">' +
        rows.map(function(r){
          return '<li><span>' + esc(r[0]) + '</span><b>\\u2212 ' + esc(money(r[1], cur)) + '</b></li>';
        }).join('') +
        '<li class="dzWlPendNet"><span>Reaches your wallet</span><b>' +
          esc(money(s.pending_net || 0, cur)) + '</b></li>' +
      '</ul>' +
    '</div>';
  }

  function balanceCard(s, d, flagged){
    var cur  = s.currency;
    var can  = !flagged && (s.withdrawable || 0) > 0;
    return '<div class="dzWlCur">' +
      '<div class="dzWlHead">' +
        '<div class="dzWlBalLbl">Wallet \\u00b7 ' + esc(cur) + '</div>' +
        '<div class="dzWlBal">' + esc(money(s.withdrawable || 0, cur)) + '</div>' +
        '<div class="dzWlBalSub">Settled, after every deduction. Yours to withdraw ' +
          'in ' + esc(cur) + ' \\u2014 nothing is converted at any point</div>' +
      '</div>' +
      '<button type="button" class="dzWlReq" data-cur="' + esc(cur) + '"' +
        (can ? '' : ' disabled') + '>' +
        (flagged ? 'Withdrawals paused' : 'Request ' + esc(cur) + ' payout') + '</button>' +
      '<div class="dzWlGrid">' +
        '<div class="dzWlCell"><span>Total sales</span><b>' + esc(money(s.total_sales || 0, cur)) + '</b></div>' +
        '<div class="dzWlCell"><span>Artworks sold</span><b>' + esc(String(s.items_sold || 0)) + '</b></div>' +
        '<div class="dzWlCell"><span>Gateway fees</span><b>' + esc(money(s.gateway_fees || 0, cur)) + '</b></div>' +
        '<div class="dzWlCell"><span>Commission paid</span><b>' + esc(money(s.commission || 0, cur)) + '</b></div>' +
        '<div class="dzWlCell"><span>Tax withheld</span><b>' + esc(money(s.tds_withheld || 0, cur)) + '</b></div>' +
        '<div class="dzWlCell"><span>Withdrawn</span><b>' + esc(money(s.paid_out || 0, cur)) + '</b></div>' +
      '</div>' +
    '</div>';
  }

  function renderWallet(host, d){
    var rows = Array.isArray(d.summary) ? d.summary : [];
    // The member's own currency leads. The rest keep their order — they are
    // separate balances, not a ranking, and none of them is converted into
    // any other to decide which is bigger.
    var pref = C.currency || 'USD';
    rows = rows.slice().sort(function(a, b){
      return (b.currency === pref) - (a.currency === pref);
    });
    var paid = (d.payouts || []).filter(function(p){ return p.status === 'paid'; });

    // A blocked balance is the first thing the member sees, and the request
    // button goes with it — there is no point offering an action the server
    // will refuse.
    var flagged = (d.flags || []).length > 0;

    host.innerHTML =
      '<div class="dzWl">' +
        (flagged
          ? '<div class="dzWlFlag">' +
              '<div class="dzWlFlagTop">‼️ Balance check failed</div>' +
              '<p>Your wallet total and our independent transaction record do not ' +
              'agree, so withdrawals are paused on this account as a precaution. ' +
              'Nothing has been lost — your earnings are intact and this is a ' +
              'safeguard, not a deduction.</p>' +
              '<a class="dzWlFlagBtn" href="mailto:DigiArtzsupport@gmail.com' +
                '?subject=Balance%20check%20failed">Contact support</a>' +
            '</div>'
          : '') +

        (rows.length
          ? rows.map(function(s){ return balanceCard(s, d, flagged); }).join('')
          : '<div class="dzWlHead">' +
              '<div class="dzWlBalLbl">Wallet</div>' +
              '<div class="dzWlBal">' + esc(money(0, 'USD')) + '</div>' +
              '<div class="dzWlBalSub">Nothing sold yet. You are paid in whichever ' +
                'currency you priced your listing in.</div>' +
            '</div>') +
        '<div class="dzWlMsg" hidden></div>' +

        // Its own section, below the wallet and never added into it.
        (rows.some(function(s){ return (s.pending_gross || 0) > 0; })
          ? '<div class="dzWlSect">Pending \\u2014 not yet yours</div>' +
            rows.map(pendingCard).join('')
          : '') +

        (paid.length
          ? '<div class="dzWlSect">Payout history</div><ul class="dzWlList">' +
            paid.map(function(p){
              return '<li class="dzWlRow"><div class="dzWlMain">' +
                '<div class="dzWlTitle">' + esc(money(p.amount, p.currency)) + ' paid</div>' +
                '<div class="dzWlSub">' + esc(when(p.paid_at)) + ' · ' + esc(p.destination || '') + '</div>' +
                '</div></li>';
            }).join('') + '</ul>'
          : '') +

        '<div class="dzWlSect">Activity</div>' +
        ((d.history || []).length
          ? '<ul class="dzWlList">' + d.history.map(row).join('') + '</ul>'
          : '<div class="dzWlEmpty">Nothing yet.</div>') +

        // House rules for the money side, kept at the foot of the wallet so
        // they sit next to the balance and the payout button they describe.
        '<div class="dzWlSect">Wallet guidelines</div>' +
        '<ol class="dzWlGuide">' +
          '<li>You are paid in the currency you priced your listing in. Your ' +
            'earnings are never converted \\u2014 a sale in euros stays euros all ' +
            'the way to your payout \\u2014 so no exchange spread is taken out of ' +
            'them at any point.</li>' +
          '<li>Each currency has its own withdrawal minimum, roughly five ' +
            'dollars\\u2019 worth. The exact figure is shown on the payout form.</li>' +
          '<li>A sale is Pending until the payment provider settles it \\u2014 ' +
            'Razorpay takes two working days on a domestic sale and seven on an ' +
            'international one, PayPal up to five business days. Pending shows ' +
            'the whole sale and what will come out of it; the wallet shows only ' +
            'what has cleared and is genuinely yours.</li>' +
          '<li>DigiArtz will take a 10% platform charge and 5% GST (government tax). ' +
            'The remaining 85% goes to the user. Max Subscription users will get 90% ' +
            'of the commission, while DigiArtz will take 5% as the platform charge and ' +
            '5% for GST and other taxes.</li>' +
          '<li>Losing money due to scams will not be tolerated. If you send money ' +
            'without our involvement, we cannot help with recovery.</li>' +
          '<li>Losing all your wallet money due to a hacked account will also not be ' +
            'tolerated. Please don’t share your email or password with anyone, and ' +
            'activate MFA or 2FA.</li>' +
          '<li>If any system bug or glitch from our side increases your wallet balance, ' +
            'it does not mean that money belongs to you. Anyone who takes advantage of ' +
            'bugs or glitches will get an IP ban from the server and may no longer be ' +
            'able to log in.</li>' +
          '<li>If you have any questions, email us at:' +
            '<a class="dzWlGuideMail" href="mailto:DigiArtzsupport@gmail.com' +
            '?subject=Wallet%20question" ' +
            'aria-label="Email DigiArtz support at DigiArtzsupport@gmail.com">' +
            '<span aria-hidden="true">✉</span>DigiArtzsupport@gmail.com</a></li>' +
        '</ol>' +
      '</div>';

    // Each balance has its own button, and the payout it opens is denominated
    // in that balance's currency from the label down to the request body. The
    // form no longer knows what a dollar is.
    Array.prototype.forEach.call(host.querySelectorAll('.dzWlReq[data-cur]'), function(btn){
      btn.addEventListener('click', function(){
        var cur = btn.getAttribute('data-cur');
        var s   = null;
        rows.forEach(function(r){ if(r.currency === cur) s = r; });
        if(!s) return;
        openPayoutForm(s, d);
      });
    });
  }

  // Zero-decimal currencies quote whole units, so the amount a seller types is
  // the amount, not hundredths of it. Same list the checkout backends use.
  function minorOf(v, cur){
    return ZERO_DEC[cur] ? Math.round(v) : Math.round(v * 100);
  }
  function majorOf(minor, cur){
    return ZERO_DEC[cur] ? String(minor) : (minor / 100).toFixed(2);
  }

  function openPayoutForm(s, d){
    var cur = s.currency;
    var max = s.withdrawable || 0;
    var min = (d.minPayouts && d.minPayouts[cur] != null)
      ? d.minPayouts[cur] : (d.minDefault || 500);

    openSheet('Request ' + cur + ' payout');
    sheet.body.innerHTML =
      '<div class="dzBkForm">' +
        '<label class="dzBkLbl">Amount in ' + esc(cur) + '</label>' +
        '<input class="dzBkIn" id="dzWlAmt" type="text" inputmode="decimal" placeholder="' +
          esc(majorOf(max, cur)) + '">' +
        '<p class="dzBkNote">Minimum ' + esc(money(min, cur)) + '. You can withdraw up to ' +
          esc(money(max, cur)) + ', and it is sent in ' + esc(cur) +
          ' \\u2014 not converted \\u2014 to your default method.' +
          ((d.tax && d.tax.country === 'IN') || !d.tax
            ? ' Tax may be withheld at source under section 194-O; it is withheld in ' +
              esc(cur) + ' and the exact amount is shown once you request.'
            : '') + '</p>' +
        '<div class="dzWlMsg" hidden></div>' +
        '<button type="button" class="dzWlReq" id="dzWlGo">Request</button>' +
      '</div>';

    var m2 = sheet.body.querySelector('.dzWlMsg');
    sheet.body.querySelector('#dzWlGo').addEventListener('click', function(){
      var v = minorOf(parseFloat(sheet.body.querySelector('#dzWlAmt').value), cur);
      if(!Number.isFinite(v) || v <= 0){
        m2.textContent = 'Enter an amount.'; m2.hidden = false;
        m2.classList.add('dzWlMsg--bad'); return;
      }
      m2.textContent = 'Sending…'; m2.hidden = false; m2.classList.remove('dzWlMsg--bad');
      pay('request', {amount:v, currency:cur})
        .then(function(r){
                closeSheet();
                toast(r && r.tds
                  ? 'Payout requested \\u00b7 ' + money(r.tds, cur) + ' withheld as tax'
                  : 'Payout requested');
                refreshPanel();
              },
              function(e){
                m2.textContent = e.message || 'Could not request that';
                m2.classList.add('dzWlMsg--bad');
                // a freshly-raised flag should show on the wallet at once
                if(/paused|verified/i.test(e.message || '')) refreshPanel();
              });
    });
  }

  function renderBank(host, d){
    host.innerHTML =
      '<div class="dzBk">' +
        ((d.methods || []).length
          ? '<ul class="dzBkList">' + d.methods.map(methodLine).join('') + '</ul>'
          : '<div class="dzWlEmpty">No payout method yet.</div>') +
        '<div class="dzBkPick">' +
          '<button type="button" class="dzBkAdd" data-add="paypal_email">Add PayPal</button>' +
          '<button type="button" class="dzBkAdd" data-add="upi">Add UPI</button>' +
          '<button type="button" class="dzBkAdd" data-add="bank_account">Add bank account</button>' +
        '</div>' +
        '<p class="dzBkNote">Card numbers are never asked for or stored here. ' +
        'Cards are handled inside the provider’s own checkout, which is the only ' +
        'place they belong.</p>' +

        '<div class="dzBkHead">Tax details</div>' +
        '<div class="dzBkForm">' +
          '<label class="dzBkLbl">Country of tax residence</label>' +
          '<input class="dzBkIn" id="dzTxC" type="text" maxlength="2" placeholder="IN" value="' +
            esc((d.tax && d.tax.country) || 'IN') + '">' +
          '<label class="dzBkLbl">PAN (India only)</label>' +
          '<input class="dzBkIn" id="dzTxP" type="text" maxlength="10" placeholder="ABCDE1234F" value="' +
            esc((d.tax && d.tax.pan) || '') + '">' +
          '<p class="dzBkNote">Indian sellers: we are required to deduct tax at source ' +
          'on marketplace sales under section 194-O. With a PAN on file the rate is 0.1%, ' +
          'and individuals stay exempt below ₹5,00,000 of sales in the financial year. ' +
          'Without a PAN the rate is 5%. Sellers outside India have nothing withheld.</p>' +
          '<div class="dzWlMsg" hidden></div>' +
          '<button type="button" class="dzWlReq" id="dzTxSave">Save tax details</button>' +
        '</div>' +
      '</div>';

    Array.prototype.forEach.call(host.querySelectorAll('[data-add]'), function(b){
      b.addEventListener('click', function(){ addMethod(b.getAttribute('data-add')); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-def]'), function(b){
      b.addEventListener('click', function(){
        pay('method-default', {id:b.getAttribute('data-def')})
          .then(function(){ refreshPanel(); }, function(e){ toast(e.message); });
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-rm]'), function(b){
      b.addEventListener('click', function(){
        pay('method-remove', {id:b.getAttribute('data-rm')})
          .then(function(){ toast('Removed'); refreshPanel(); }, function(e){ toast(e.message); });
      });
    });

    var tm = host.querySelector('.dzBkForm .dzWlMsg');
    host.querySelector('#dzTxSave').addEventListener('click', function(){
      tm.textContent = 'Saving…'; tm.hidden = false; tm.classList.remove('dzWlMsg--bad');
      pay('tax', {
        country: host.querySelector('#dzTxC').value,
        pan:     host.querySelector('#dzTxP').value
      }).then(function(){ tm.textContent = 'Saved.'; refreshPanel(); },
              function(e){
                tm.textContent = e.message || 'Could not save that';
                tm.classList.add('dzWlMsg--bad');
              });
    });
  }

  function addMethod(kind){
    openSheet('Add payout method');
    sheet.body.innerHTML =
      '<div class="dzBkForm">' + METHOD_FORMS[kind] +
        '<label class="dzBkLbl">Label (optional)</label>' +
        '<input class="dzBkIn" data-f="label" type="text" placeholder="e.g. Main account">' +
        '<div class="dzWlMsg" hidden></div>' +
        '<button type="button" class="dzWlReq" id="dzBkSave">Save</button>' +
      '</div>';
    var m = sheet.body.querySelector('.dzWlMsg');
    sheet.body.querySelector('#dzBkSave').addEventListener('click', function(){
      var payload = {kind:kind};
      Array.prototype.forEach.call(sheet.body.querySelectorAll('[data-f]'), function(i){
        payload[i.getAttribute('data-f')] = i.value;
      });
      m.textContent = 'Saving…'; m.hidden = false; m.classList.remove('dzWlMsg--bad');
      pay('method-add', payload)
        .then(function(){ closeSheet(); toast('Payout method added'); refreshPanel(); },
              function(e){
                m.textContent = e.message || 'Could not save that';
                m.classList.add('dzWlMsg--bad');
              });
    });
  }

  // ---- the account panel --------------------------------------------------
  // The three money pages, and the three Settings items that open them, are
  // built here rather than written into index.html. That file is a static
  // asset served to everyone, and even with every figure stripped out its
  // headings still announced that members hold a balance and get paid out.
  //
  // One panel, three views, one neutral id. Simpler than three shells that had
  // to be kept in step, and there is nothing in the public page to read.
  var VIEWS = { bal: 'Balance', pay: 'Payout methods', buy: 'My purchases',
                cur: 'Currency' };

  function panelEl(){
    var el = document.getElementById('dzPanelHost');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'dzPanelHost';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="subPgHdr">' +
        '<button class="subPgX" type="button" aria-label="Back">\\u2190</button>' +
        '<div class="subPgTitle"></div>' +
      '</div>' +
      '<div class="bmBdy"><div class="dzPanelWrap"></div></div>';
    el.querySelector('.subPgX').addEventListener('click', closePanel);
    document.body.appendChild(el);
    return el;
  }

  function closePanel(){
    var el = document.getElementById('dzPanelHost');
    if(el) el.classList.remove('open');
    // hand the lock back the way every other overlay does, so closing this
    // one on top of another does not unlock the page under both
    if(typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
  }
  /* The page cannot reach this panel by name — it is built here, and the id
     is deliberately neutral. Escape has to close it like any other overlay,
     so the one handle it needs is published. */
  window.dzClosePanel = closePanel;

  function openPanel(view){
    var title = VIEWS[view];
    if(!title) return;
    var el = panelEl();
    el.setAttribute('aria-label', title);
    el.querySelector('.subPgTitle').textContent = title.toUpperCase();
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    el.dataset.view = view;
    paintPanel(true);
  }

  // One host holds all four views, and switching between them used to leave
  // the last one's markup up until the next one's fetch came back — so the
  // wallet's balance sat there under the MY PURCHASES heading for as long as
  // the round trip took, which on a slow connection is long enough to read.
  // Two separate things caused that, and both are handled here.
  //
  // The host is emptied the moment the view changes, so a section that has not
  // loaded yet shows nothing rather than the section before it. Nothing is put
  // in its place on purpose: a spinner or a LOADING line is still something to
  // read in a section it does not belong to.
  //
  // And every paint carries the number it started with. Both loaders below
  // close over the host they were handed, so a wallet fetch that settles after
  // the member has already moved to My Purchases would otherwise paint itself
  // into it — the same wrong text, arriving by the other route. A paint whose
  // number is no longer the current one drops what it fetched.
  var paintSeq = 0;
  function stale(seq){ return seq !== paintSeq; }

  function paintPanel(force){
    var el = document.getElementById('dzPanelHost');
    if(!el || !el.classList.contains('open')) return;
    var host = el.querySelector('.dzPanelWrap');
    var view = el.dataset.view;

    // On a real view change only. refreshPanel repaints the view already up,
    // after a payout or a method change, and blanking there would flash it.
    if(host.dataset.shown !== view){
      host.innerHTML = '';
      host.dataset.shown = view;
    }
    var seq = ++paintSeq;

    if(view === 'buy') return loadPurchases(force, host, seq);
    if(view === 'cur') return renderCurrency(host);
    loadWallet(force, host, view === 'pay' ? renderBank : renderWallet, seq);
  }

  // The Settings items. Injected into the one empty slot index.html leaves,
  // and wired through setGo so they behave exactly like the items written
  // above them — the menu closes, the panel opens, and closing it puts the
  // member back on the menu rather than on their profile.
  function fillMenu(){
    var host = document.getElementById('setListGate');
    if(!host || host.dataset.dzFilled) return;
    host.dataset.dzFilled = '1';
    host.innerHTML = [['buy','My Purchases'], ['bal','Wallet'], ['pay','Payout Methods'],
                      ['cur','Currency']]
      .map(function(p){
        return '<button class="pfMenuItem" type="button" data-v="' + esc(p[0]) + '">' +
               esc(p[1]) + '</button>';
      }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-v]'), function(b){
      b.addEventListener('click', function(){
        var v = b.getAttribute('data-v');
        if(typeof setGo === 'function') setGo(function(){ openPanel(v); }, 'dzPanelHost');
        else openPanel(v);
      });
    });
  }


  // ---- currency ------------------------------------------------------------
  // What this member transacts in: the currency their subscription is charged
  // in, the one their own listings are priced in by default, and the one their
  // balance is shown in first.
  //
  // It does NOT convert anyone else's price. A listing belongs to its seller
  // and is paid in the seller's currency — putting a rate in that path is what
  // takes a spread out of the seller's money and distorts the tax on it, and
  // it is deliberately not done anywhere in this system.
  function renderCurrency(host){
    var cur  = C.currency || 'USD';
    var list = C.currencies || [];
    host.innerHTML =
      '<div class="dzCur">' +
        '<p class="dzCurNote">Your subscription is charged in this currency, and ' +
          'anything you list is priced in it by default. Changing it does not ' +
          'change what you already own, what you have already been charged, or ' +
          'any balance you have already earned \u2014 money is never converted ' +
          'between currencies here.</p>' +
        '<ul class="dzCurList">' +
          list.map(function(c){
            var on = c.code === cur;
            return '<li><button type="button" class="dzCurOpt' + (on ? ' dzCurOpt--on' : '') +
              '" data-c="' + esc(c.code) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
              '<span class="dzCurCode">' + esc(c.code) + '</span>' +
              '<span class="dzCurName">' + esc(c.name) + '</span>' +
              '<span class="dzCurTick" aria-hidden="true">\u2713</span>' +
            '</button></li>';
          }).join('') +
        '</ul>' +
        '<div class="dzWlMsg" hidden></div>' +
      '</div>';

    var msg = host.querySelector('.dzWlMsg');
    Array.prototype.forEach.call(host.querySelectorAll('.dzCurOpt'), function(b){
      b.addEventListener('click', function(){
        var code = b.getAttribute('data-c');
        if(code === (C.currency || 'USD')) return;
        msg.textContent = 'Saving\u2026'; msg.hidden = false;
        msg.classList.remove('dzWlMsg--bad');
        // Up for the whole change, not just the save: the prices on the page
        // behind this are the old currency's until the new module has
        // repainted them, and a half-converted page is the one thing this
        // must not show.
        veil(true);
        pay('currency', {currency: code})
          .then(function(){
                  C.currency = code;
                  // Prices, the plan grid and the wallet were all built for the
                  // old currency. Rather than patch them one by one and risk
                  // one being missed, the module is fetched again.
                  reloadModule(function(ok){
                    veil(false);
                    toast(ok ? 'Currency set to ' + code
                             : 'Currency saved \u2014 reload to see the new prices');
                  });
                },
                function(e){
                  veil(false);
                  msg.textContent = e.message || 'Could not save that';
                  msg.classList.add('dzWlMsg--bad');
                });
      });
    });
  }

  // The page's own loading veil, borrowed rather than reinvented: #intro is
  // already in the document with the spinner the site opens on, so a currency
  // change wears the same animation the first paint does instead of a second
  // one that would have to be kept looking like it.
  //
  // It covers at z-index 9999, over the account panel at 547, and swallows
  // clicks while it is up — which is the point. Between the save and the
  // repaint the page is showing rupee prices with a dollar module still bound
  // to it, and nothing there should be clickable.
  function veilEl(){
    var el = document.getElementById('intro');
    if(el) return el;
    // No intro on this page — build the same thing so the veil still shows.
    el = document.createElement('div');
    el.id = 'intro';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Loading');
    el.className = 'iHide iGone';
    el.innerHTML = '<div class="iSpin" aria-hidden="true"></div>' +
                   '<div class="iTxt">LOADING</div>';
    document.body.appendChild(el);
    return el;
  }

  function veil(on){
    var el = veilEl();
    if(on){
      el.classList.remove('iGone');   // visibility back before the fade
      void el.offsetWidth;            // so removing iHide animates, not jumps
      el.classList.remove('iHide');
      return;
    }
    el.classList.add('iHide');
    var done = false;
    var gone = function(){
      if(done) return;
      done = true;
      el.classList.add('iGone');
    };
    el.addEventListener('transitionend', function h(e){
      if(e.propertyName !== 'opacity') return;
      el.removeEventListener('transitionend', h);
      gone();
    });
    setTimeout(gone, 450);            // transitionend can be missed
  }

  // Re-fetch /api/store so every price on the page is rebuilt server-side in
  // the new currency. Nothing is converted in the browser.
  //
  // done() runs once the new module has executed AND repainted — dzFill is
  // synchronous, so by the time it returns every price on the page is the new
  // currency's. That is the moment the veil can come down, and it is why the
  // caller waits for this rather than for the script's load event alone. It is
  // also called on a failed load, so the veil can never be left up.
  function reloadModule(done){
    closePanel();
    var fired = false;
    var finish = function(ok){
      if(fired) return;
      fired = true;
      if(typeof done === 'function') done(ok);
    };
    var s = document.createElement('script');
    s.src = '/api/store?t=' + Date.now();
    s.onload = function(){
      var host = document.getElementById('subPgGate');
      if(host) host.dataset.dzFilled = '';   // let the new module repaint the grid
      if(typeof window.dzFill === 'function') window.dzFill();
      finish(true);
    };
    s.onerror = function(){ finish(false); };
    document.head.appendChild(s);
    setTimeout(function(){ finish(false); }, 15000);
  }

  // One fetch feeds every view, so two of them can never disagree.
  var walletP = null;
  function loadWallet(force, host, render, seq){
    if(!host) return;
    if(force) walletP = null;
    if(!walletP) walletP = pay('overview');
    walletP.then(function(d){ if(stale(seq)) return; render(host, d); },
                 function(e){
                   // dropped either way, so the next visit refetches
                   walletP = null;
                   if(stale(seq)) return;
                   host.innerHTML = '<div class="dzWlEmpty">' +
                     esc(e.message || 'Could not load') + '</div>';
                 });
  }
  // repaint whatever view is open, after a payout or a method change.
  // Local: nothing outside this module opens or refreshes the panel any more.
  function refreshPanel(){ walletP = null; paintPanel(true); }

  // ---- my purchases -------------------------------------------------------
  // The buyer's side of the wallet: everything this account has paid for on the
  // marketplace, with every file it came with, unlocked and at full quality,
  // for as long as the account exists. A purchase is not a rental and not a
  // plan benefit — there is no expiry to show and no tier that could take it
  // away, which is why the note at the top says so rather than leaving anyone
  // to wonder whether cancelling Max costs them their files.
  //
  // dz_my_purchases reads the payments this caller has standing at 'paid'. A
  // refunded or reversed sale is not one of those, so it leaves this list at
  // the same moment it stops unlocking the download — the two cannot drift.
  function purchaseRow(p){
    var title = esc(p.title || 'Marketplace item');
    var thumb = p.preview_url
      ? '<img class="dzPuThumb" loading="lazy" decoding="async" src="' +
          esc(typeof getThumbnailUrl === 'function' ? getThumbnailUrl(p.preview_url) : p.preview_url) +
          '" alt="">'
      : '<span class="dzPuThumb dzPuThumbNo" aria-hidden="true">\\u25a6</span>';
    var n = Number(p.file_count) || 0;
    return '<li class="dzPuRow" data-item="' + esc(p.item_id || '') + '">' +
      '<div class="dzPuTop">' +
        thumb +
        '<div class="dzPuMain">' +
          '<div class="dzPuTitle">' + title + '</div>' +
          '<div class="dzPuSub">' +
            (p.seller_name ? 'by ' + esc(p.seller_name) + ' \\u00b7 ' : '') +
            esc(money(p.amount, p.currency)) + ' \\u00b7 ' + esc(when(p.paid_at)) +
          '</div>' +
          '<div class="dzPuFiles">' +
            (p.delisted
              ? 'The seller has removed this listing \\u2014 its files are no longer available'
              : n ? n + ' file' + (n === 1 ? '' : 's') + ' \\u00b7 full quality, no download limit'
                  : 'No files attached to this listing') +
          '</div>' +
        '</div>' +
      '</div>' +
      (!p.delisted && n
        ? '<button type="button" class="dzPuBtn" data-get="' + esc(p.item_id) + '">' +
            (n === 1 ? '\\u2b07 Download' : '\\u2b07 Show ' + n + ' files') + '</button>'
        : '') +
      '<div class="dzPuList" hidden></div>' +
    '</li>';
  }

  function renderPurchases(host, rows){
    if(!rows.length){
      host.innerHTML =
        '<div class="dzWlEmpty">Nothing bought yet. Anything you buy on the marketplace ' +
        'lands here permanently, with every file unlocked.</div>';
      return;
    }
    host.innerHTML =
      '<p class="dzPuNote">Bought once, yours to keep. Every file is the seller\\u2019s ' +
      'original at full quality, re-downloadable as often as you like, and no ' +
      'subscription tier is involved either way.</p>' +
      '<ul class="dzPuList--top">' + rows.map(purchaseRow).join('') + '</ul>';

    Array.prototype.forEach.call(host.querySelectorAll('[data-get]'), function(b){
      b.addEventListener('click', function(){ openFiles(b); });
    });
  }

  // Expands one purchase into its files. Asked for on the tap rather than up
  // front: a list of twenty purchases should not be twenty roundtrips.
  function openFiles(btn){
    var item = btn.getAttribute('data-get');
    var box  = btn.parentNode.querySelector('.dzPuList');
    if(!box) return;
    if(!box.hidden){ box.hidden = true; return; }
    if(box.dataset.loaded){ box.hidden = false; return; }

    btn.disabled = true;
    sb.rpc('dz_market_files', {p_item: item}).then(function(res){
      btn.disabled = false;
      if(!res || res.error){
        toast((res && res.error && res.error.message) || 'Could not open your files');
        return;
      }
      var files = res.data || [];
      if(!files.length){ toast('This listing has no files attached'); return; }
      // one file is not a list — hand it straight over
      if(files.length === 1 && typeof window.dzMarketFetch === 'function'){
        window.dzMarketFetch(item, files[0].file_id, files[0].name, btn);
        return;
      }
      box.innerHTML = files.map(function(f){
        return '<div class="dzPuFile">' +
          '<span class="dzPuExt">' + esc(String(f.ext || 'file').toUpperCase()) + '</span>' +
          '<div class="dzPuFileMeta">' +
            '<div class="dzPuFileNm">' + esc(f.name) + '</div>' +
            '<div class="dzPuFileSz">' + esc(bytesOf(f.bytes)) + '</div>' +
          '</div>' +
          '<button type="button" class="dzPuFileBtn" data-f="' + esc(f.file_id) + '" ' +
            'data-n="' + esc(f.name) + '">Download</button>' +
        '</div>';
      }).join('');
      box.dataset.loaded = '1';
      box.hidden = false;
      Array.prototype.forEach.call(box.querySelectorAll('[data-f]'), function(fb){
        fb.addEventListener('click', function(){
          if(typeof window.dzMarketFetch === 'function')
            window.dzMarketFetch(item, fb.getAttribute('data-f'), fb.getAttribute('data-n'), fb);
        });
      });
    }, function(){ btn.disabled = false; toast('Could not open your files'); });
  }

  function bytesOf(n){
    n = Number(n) || 0;
    if(n <= 0) return '\\u2014';
    var u = ['B','KB','MB','GB'], i = 0;
    while(n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
    return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }

  var purchasesP = null;
  function loadPurchases(force, host, seq){
    if(!host || !window.sb || !sb.rpc) return;
    if(force) purchasesP = null;
    // Promise.resolve, not the builder itself: a PostgrestBuilder fires a fresh
    // request every time something calls .then on it, so caching the builder
    // would cache nothing and double the traffic instead.
    if(!purchasesP) purchasesP = Promise.resolve(sb.rpc('dz_my_purchases'));
    purchasesP.then(function(res){
      if(!res || res.error){
        purchasesP = null;
        if(stale(seq)) return;
        host.innerHTML = '<div class="dzWlEmpty">' +
          esc((res && res.error && res.error.message) || 'Could not load your purchases') + '</div>';
        return;
      }
      if(!stale(seq)) renderPurchases(host, res.data || []);
      // the same answer tells the marketplace which cards to unlock, and that
      // is true whichever view is up by now — so it runs even when the paint
      // above was dropped.
      var changed = false;
      (res.data || []).forEach(function(p){
        if(p.item_id && !ownedIds[p.item_id]){ ownedIds[p.item_id] = true; changed = true; }
      });
      if(changed) repaintOwned();
    }, function(){
      purchasesP = null;
      if(stale(seq)) return;
      host.innerHTML = '<div class="dzWlEmpty">Could not load your purchases</div>';
    });
  }

  // The public bundle calls this after every render that could have produced a
  // slot, and once when this module lands.
  window.dzFill = function(){ fillPlans(); fillSlots(); fillMenu(); paintPanel(false); };
  window.dzFill();
})(__dzStore);
`;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Supabase environment names.
//
// This project uses two spellings. The older Functions read SUPABASE_URL /
// SUPABASE_ANON_KEY; the newer ones read SB_URL / SB_KEY, and config.example.js
// documents the service key as SUPABASE_SERVICE_ROLE_KEY while the code asks
// for SB_SERVICE_KEY. Either is fine to bind — what is not fine is a deploy
// that half-works because of which spelling someone picked, so both are
// accepted here and the endpoint says exactly what is missing when neither is.
const sbUrl = (env) => env.SB_URL || env.SUPABASE_URL || '';
const sbAnon = (env) => env.SB_KEY || env.SUPABASE_ANON_KEY || '';
const sbSvc = (env) => env.SB_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';

// Service-role read. THIS WAS MISSING and every call to it threw a
// ReferenceError that the try/catch around the pricing block then swallowed,
// so the plan grid rendered empty and the currency stayed on its default —
// the endpoint answering 200 the whole time.
async function sbService(env, path, init = {}) {
  const res = await fetch(sbUrl(env) + '/rest/v1' + path, {
    ...init,
    headers: {
      apikey: sbSvc(env),
      authorization: 'Bearer ' + sbSvc(env),
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error('Database error (' + res.status + ')');
  return res.json().catch(() => null);
}

async function sbUser(env, request) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const res = await fetch(sbUrl(env) + '/auth/v1/user', {
    headers: { apikey: sbAnon(env), authorization: bearer },
  });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

// Which providers can actually take money. Decided here, from the credentials
// bound to the Pages project, so the browser is never in a position to ask.
function liveProviders(env) {
  const out = [];
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) out.push('rzp');
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) out.push('paypal');
  return out;
}

export async function onRequestGet({ env, request }) {
  const deny = (s = 401) =>
    new Response(s === 401 ? '/* sign in required */' : '/* unavailable */', {
      status: s,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store, private',
        'x-robots-tag': 'noindex, nofollow',
      },
    });

  if (!sbUrl(env) || !sbAnon(env)) return deny(503);
  const user = await sbUser(env, request);
  if (!user) return deny(401);

  // Everything below is priced in THIS member's currency, read from their
  // profile and then from the price table — never converted from a dollar.
  let currency = 'USD';
  let prices = {};
  let support = null;
  try {
    const me = await sbService(env, '/profiles?id=eq.' + user.id + '&select=currency&limit=1');
    const c = me && me[0] && me[0].currency;
    if (c && CURRENCY_CODES.has(c)) currency = c;

    const rows = await sbService(env,
      '/subscription_prices?currency=eq.' + currency + '&select=plan,amount');
    (rows || []).forEach((r) => { prices[r.plan] = Number(r.amount); });

    const lim = await sbService(env,
      '/support_limits?currency=eq.' + currency + '&select=min_amount,max_amount&limit=1');
    if (lim && lim[0]) support = { min: Number(lim[0].min_amount), max: Number(lim[0].max_amount) };
  } catch { /* fall back to USD below rather than serve no checkout at all */ }

  // A currency with no price row would render a blank plan grid, so it falls
  // back to dollars rather than showing a plan nobody can buy.
  if (!Object.keys(prices).length) {
    currency = 'USD';
    try {
      const rows = await sbService(env, '/subscription_prices?currency=eq.USD&select=plan,amount');
      (rows || []).forEach((r) => { prices[r.plan] = Number(r.amount); });
      const lim = await sbService(env,
        '/support_limits?currency=eq.USD&select=min_amount,max_amount&limit=1');
      if (lim && lim[0]) support = { min: Number(lim[0].min_amount), max: Number(lim[0].max_amount) };
    } catch { /* the grid simply will not render, which is the honest outcome */ }
  }

  const priced = PLANS
    .filter((p) => prices[p.id] > 0)
    .map((p) => Object.assign({}, p, {
      price: fmtMoney(prices[p.id], currency),
      amount: prices[p.id],
    }));

  // plansHtml is the grid on the subscription page; plans is the same table in
  // a shape the checkout page can read, so what a buyer is told they get at
  // checkout is the plan's own wording rather than a second, drifting copy.
  const cfg = {
    providers: liveProviders(env),
    currency,
    currencies: CURRENCIES,
    support,
    plansHtml: plansHtml(priced),
    plans: priced.map((p) => ({
      id: p.id, name: p.name, price: p.price, tone: p.tone,
      tagline: p.tagline, features: p.features,
    })),
  };
  const body = 'var __dzStore = ' + JSON.stringify(cfg) + ';\n' + MODULE;

  return new Response(body, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // never written to a disk cache, never revalidated from one, and never
      // reachable by a shared cache that has no idea who asked
      'cache-control': 'no-store, private, max-age=0',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      vary: 'authorization',
    },
  });
}
