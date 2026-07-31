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
// plans — the same table the two checkout backends price against
const PLANS = [
  {
    id: 'lite', name: 'Lite', price: '$1', tone: 'blue',
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
    id: 'premium', name: 'Premium', price: '$5', tone: 'purple',
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
    id: 'max', name: 'Max', price: '$10', tone: 'gold',
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

const QUOTA = [
  { plan: 'Free', num: '5', tone: 'free' },
  { plan: 'Lite', num: '10', tone: 'lite' },
  { plan: 'Premium', num: '15', tone: 'premium' },
  { plan: 'Max', num: '20', tone: 'max' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plansHtml() {
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
    PLANS.map((p) =>
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

  var PROV = {
    rzp:    { name:'Razorpay', note:'Card, UPI, net banking or wallet' },
    paypal: { name:'PayPal',   note:'PayPal balance, or a card through PayPal' }
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
              '&intent=capture&components=buttons&disable-funding=venmo,paylater';
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
    var res = await fetch(prov === 'paypal' ? '/api/paypal' : '/api/rzp', {
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
  // Doubles as the chooser and as the surface PayPal renders its buttons into,
  // so the buyer never loses the page behind them.
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
  function sheetNote(msg){
    if(sheet) sheet.body.innerHTML = '<div class="dzPayNote">' + esc(msg) + '</div>';
  }

  // ---- provider runs ------------------------------------------------------
  function runRzp(order, onPaid){
    sheetNote('Opening ' + PROV.rzp.name + '\\u2026');
    return loadRzp().then(function(){
      closeSheet();
      new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'DigiArtz',
        description: order.label || '',
        theme: { color: '#7C3AED' },
        handler: function(r){
          api('rzp', {action:'verify', orderId:r.razorpay_order_id,
               paymentId:r.razorpay_payment_id, signature:r.razorpay_signature})
            .then(onPaid, function(e){ toast(e.message || 'Could not verify the payment'); });
        },
        modal: { ondismiss: function(){ toast('Payment cancelled'); } }
      }).open();
    });
  }

  // PayPal draws its own buttons, so the sheet stays up and hosts them. The
  // order already exists server-side by this point — createOrder just names it,
  // which is what keeps the amount out of the browser's hands.
  function runPP(order, onPaid){
    sheetNote('Loading ' + PROV.paypal.name + '\\u2026');
    return loadPP(order.clientId, order.currency).then(function(pp){
      if(!sheet) return;                    // buyer closed it while we loaded
      sheet.body.innerHTML =
        '<div class="dzPayAmt">' + esc(order.label || '') + ' \\u00b7 ' +
          esc(orderMoney(order)) + '</div><div class="dzPayBtns"></div>';
      var host = sheet.body.querySelector('.dzPayBtns');
      var settled = false;

      pp.Buttons({
        style: { layout:'vertical', shape:'rect', height:44 },
        createOrder: function(){ return order.orderId; },
        onApprove: function(){
          settled = true;
          sheetNote('Confirming your payment\\u2026');
          return api('paypal', {action:'capture', orderId:order.orderId})
            .then(function(r){ closeSheet(); onPaid(r); },
                  function(e){ closeSheet(); toast(e.message || 'Could not verify the payment'); });
        },
        onCancel: function(){ closeSheet(); toast('Payment cancelled'); },
        onError:  function(){ if(!settled){ closeSheet(); toast('PayPal could not complete the payment'); } }
      }).render(host).catch(function(){
        sheetNote('PayPal could not open here. Try the other option.');
      });
    });
  }

  // ---- one flow, either provider -----------------------------------------
  // The provider list was decided server-side, from which credentials are
  // actually bound. One live provider and the buyer never sees a chooser; two
  // and a sheet asks first. Nothing is ordered, and no ledger row written,
  // until a provider has been picked.
  function start(title, order, onPaid){
    if(gate()) return;
    var list = C.providers || [];
    if(!list.length){ toast('Checkout is not available right now'); return; }
    openSheet(title);

    function pick(id){
      sheetNote('Starting checkout\\u2026');
      order(id)
        .then(function(o){
          if(!o){ closeSheet(); return; }           // handled by the caller
          if(!sheet) return;                        // buyer closed it
          return id === 'paypal' ? runPP(o, onPaid) : runRzp(o, onPaid);
        })
        .catch(function(e){ closeSheet(); toast(e.message || 'Could not start checkout'); });
    }

    if(list.length === 1){ pick(list[0]); return; }

    sheet.body.innerHTML =
      '<div class="dzPayPick">' + list.map(function(id){
        return '<button class="dzPayOpt" type="button" data-prov="' + esc(id) + '">' +
                 '<span class="dzPayOptName">' + esc(PROV[id].name) + '</span>' +
                 '<span class="dzPayOptNote">' + esc(PROV[id].note) + '</span>' +
               '</button>';
      }).join('') + '</div>';
    Array.prototype.forEach.call(sheet.body.querySelectorAll('.dzPayOpt'), function(b){
      b.addEventListener('click', function(){ pick(b.getAttribute('data-prov')); });
    });
  }

  // ---- entry points -------------------------------------------------------
  window.dzSubBuy = function(plan){
    if(gate()) return;
    var amount = null;
    if(plan === 'support'){
      var v = prompt('Support amount in USD (minimum $0.50):', '5');
      if(v === null) return;
      amount = Math.round(parseFloat(v) * 100);
      if(!Number.isFinite(amount) || amount < 50){ toast('Minimum is $0.50'); return; }
    }
    start('Checkout', function(prov){
      return api(prov, {action:'sub-order', plan:plan, amount:amount});
    }, function(r){
      toast(r.tier ? 'Subscription active' : 'Thank you for the support');
    });
  };

  window.dzMarketBuy = function(id, hasFile){
    start('Checkout', function(prov){
      return api(prov, {action:'market-order', itemId:id}).then(function(o){
        if(o.owned){                      // bought before, just download
          if(hasFile && typeof window.dzMarketGet === 'function') window.dzMarketGet(id);
          else toast('Already purchased');
          return null;
        }
        return o;
      });
    }, function(){
      toast('Purchased');
      if(hasFile && typeof window.dzMarketGet === 'function') window.dzMarketGet(id);
    });
  };

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

  function fillSlots(){
    Array.prototype.forEach.call(document.querySelectorAll('.dzSlot'), function(el){
      if(el.dataset.dzFilled) return;
      el.dataset.dzFilled = '1';
      var id      = el.getAttribute('data-i') || '';
      var cents   = Number(el.getAttribute('data-p') || 0);
      var cur     = el.getAttribute('data-c') || 'USD';
      var hasFile = el.getAttribute('data-f') === '1';
      var view    = el.getAttribute('data-v') === 'view';
      var priced  = cents > 0;

      var price = '<div class="' + (view ? 'dzvPrice' : 'dzPrice') + '">' +
                  esc(money(cents, cur)) + '</div>';
      var btn = priced
        ? '<button class="dzBuy" type="button" data-act="buy">' +
            (view ? 'Buy now' : 'Buy \\u00b7 ' + esc(money(cents, cur))) + '</button>'
        : (hasFile
            ? '<button class="dzBuy dzBuy--free" type="button" data-act="get">Download \\u00b7 Free</button>'
            : '');

      el.innerHTML = view ? '<div class="dzvBuyCard">' + price + btn + '</div>' : price + btn;

      Array.prototype.forEach.call(el.querySelectorAll('button'), function(b){
        b.addEventListener('click', function(e){
          e.stopPropagation();
          if(b.getAttribute('data-act') === 'buy') window.dzMarketBuy(id, hasFile ? 1 : 0);
          else if(typeof window.dzMarketGet === 'function') window.dzMarketGet(id);
        });
      });
    });
  }

  // The public bundle calls this after every render that could have produced a
  // slot, and once when this module lands.
  window.dzFill = function(){ fillPlans(); fillSlots(); };
  window.dzFill();
})(__dzStore);
`;

// ---------------------------------------------------------------------------
async function sbUser(env, request) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer.startsWith('Bearer ')) return null;
  const res = await fetch(env.SB_URL + '/auth/v1/user', {
    headers: { apikey: env.SB_KEY, authorization: bearer },
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

  if (!env.SB_URL || !env.SB_KEY) return deny(503);
  if (!(await sbUser(env, request))) return deny(401);

  const cfg = { providers: liveProviders(env), plansHtml: plansHtml() };
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
