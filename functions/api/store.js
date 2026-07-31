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

  // ---- wallet and payout methods -----------------------------------------
  // Both live in profile settings, both behind this module, so a signed-out
  // visitor's page carries neither the markup nor the endpoint. Every figure
  // shown here was computed server-side from the ledger — nothing below adds
  // money up, it only formats what it was handed.
  function pay(action, extra){
    return api('payouts', Object.assign({action:action}, extra || {}));
  }

  function usd(minor){ return money(minor, 'USD'); }

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

  function renderWallet(host, d){
    var s = d.summary || {};
    var paid = (d.payouts || []).filter(function(p){ return p.status === 'paid'; });

    host.innerHTML =
      '<div class="dzWl">' +
        '<div class="dzWlHead">' +
          '<div class="dzWlBalLbl">Wallet balance</div>' +
          '<div class="dzWlBal">' + esc(usd(s.withdrawable || 0)) + '</div>' +
          '<div class="dzWlBalSub">Shown in USD · earnings are converted at the stored rate</div>' +
        '</div>' +

        '<div class="dzWlGrid">' +
          '<div class="dzWlCell"><span>Total sales</span><b>' + esc(usd(s.total_sales || 0)) + '</b></div>' +
          '<div class="dzWlCell"><span>Available</span><b>' + esc(usd(s.available || 0)) + '</b></div>' +
          '<div class="dzWlCell"><span>Pending</span><b>' + esc(usd(s.pending || 0)) + '</b></div>' +
          '<div class="dzWlCell"><span>Artworks sold</span><b>' + esc(String(s.items_sold || 0)) + '</b></div>' +
          '<div class="dzWlCell"><span>Commission paid</span><b>' + esc(usd(s.commission || 0)) + '</b></div>' +
          '<div class="dzWlCell"><span>Withdrawn</span><b>' + esc(usd(s.paid_out || 0)) + '</b></div>' +
        '</div>' +

        (paid.length
          ? '<div class="dzWlSect">Payout history</div><ul class="dzWlList">' +
            paid.map(function(p){
              return '<li class="dzWlRow"><div class="dzWlMain">' +
                '<div class="dzWlTitle">' + esc(money(p.amount, p.currency)) + ' paid</div>' +
                '<div class="dzWlSub">' + esc(when(p.paid_at)) + ' · ' + esc(p.destination || '') + '</div>' +
                '</div></li>';
            }).join('') + '</ul>'
          : '') +

        '<button type="button" class="dzWlReq" ' +
          ((s.withdrawable || 0) > 0 ? '' : 'disabled') + '>Request payout</button>' +
        '<div class="dzWlMsg" hidden></div>' +

        '<div class="dzWlSect">Activity</div>' +
        ((d.history || []).length
          ? '<ul class="dzWlList">' + d.history.map(row).join('') + '</ul>'
          : '<div class="dzWlEmpty">Nothing yet.</div>') +
      '</div>';

    var msg = host.querySelector('.dzWlMsg');
    function say(t, bad){
      msg.textContent = t; msg.hidden = !t;
      msg.classList.toggle('dzWlMsg--bad', !!bad);
    }

    // Themed, in the sheet — never a browser prompt.
    host.querySelector('.dzWlReq').addEventListener('click', function(){
      var max = s.withdrawable || 0;
      var min = d.minPayout || 500;
      openSheet('Request payout');
      sheet.body.innerHTML =
        '<div class="dzBkForm">' +
          '<label class="dzBkLbl">Amount in USD</label>' +
          '<input class="dzBkIn" id="dzWlAmt" type="text" inputmode="decimal" placeholder="' +
            esc((max / 100).toFixed(2)) + '">' +
          '<p class="dzBkNote">Minimum ' + esc(usd(min)) + '. You can withdraw up to ' +
            esc(usd(max)) + '. Paid to your default method.' +
            ((d.tax && d.tax.country === 'IN') || !d.tax
              ? ' Tax may be withheld at source under section 194-O; the exact amount is shown once you request.'
              : '') + '</p>' +
          '<div class="dzWlMsg" hidden></div>' +
          '<button type="button" class="dzWlReq" id="dzWlGo">Request</button>' +
        '</div>';
      var m2 = sheet.body.querySelector('.dzWlMsg');
      sheet.body.querySelector('#dzWlGo').addEventListener('click', function(){
        var v = Math.round(parseFloat(sheet.body.querySelector('#dzWlAmt').value) * 100);
        if(!Number.isFinite(v) || v <= 0){
          m2.textContent = 'Enter an amount.'; m2.hidden = false;
          m2.classList.add('dzWlMsg--bad'); return;
        }
        m2.textContent = 'Sending…'; m2.hidden = false; m2.classList.remove('dzWlMsg--bad');
        pay('request', {amount:v, currency:'USD'})
          .then(function(r){
                  closeSheet();
                  toast(r && r.tds
                    ? 'Payout requested · ' + money(r.tds, 'USD') + ' withheld as tax'
                    : 'Payout requested');
                  loadWallet(true);
                },
                function(e){
                  m2.textContent = e.message || 'Could not request that';
                  m2.classList.add('dzWlMsg--bad');
                });
      });
    });
  }

  function renderBank(host, d){
    host.innerHTML =
      '<div class="dzBk">' +
        '<div class="dzBkHead">Payout methods</div>' +
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
          .then(function(){ loadWallet(true); }, function(e){ toast(e.message); });
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-rm]'), function(b){
      b.addEventListener('click', function(){
        pay('method-remove', {id:b.getAttribute('data-rm')})
          .then(function(){ toast('Removed'); loadWallet(true); }, function(e){ toast(e.message); });
      });
    });

    var tm = host.querySelector('.dzBkForm .dzWlMsg');
    host.querySelector('#dzTxSave').addEventListener('click', function(){
      tm.textContent = 'Saving…'; tm.hidden = false; tm.classList.remove('dzWlMsg--bad');
      pay('tax', {
        country: host.querySelector('#dzTxC').value,
        pan:     host.querySelector('#dzTxP').value
      }).then(function(){ tm.textContent = 'Saved.'; loadWallet(true); },
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
        .then(function(){ closeSheet(); toast('Payout method added'); loadWallet(true); },
              function(e){
                m.textContent = e.message || 'Could not save that';
                m.classList.add('dzWlMsg--bad');
              });
    });
  }

  // One fetch feeds both sections, so they can never disagree.
  var walletP = null;
  function loadWallet(force){
    var wl = document.getElementById('pfWalletGate');
    var bk = document.getElementById('pfBankGate');
    if(!wl && !bk) return;
    if(force) walletP = null;
    if(!walletP) walletP = pay('overview');
    walletP.then(function(d){
      if(wl) renderWallet(wl, d);
      if(bk) renderBank(bk, d);
    }, function(e){
      var msg = '<div class="dzWlEmpty">' + esc(e.message || 'Could not load') + '</div>';
      if(wl) wl.innerHTML = msg;
      if(bk) bk.innerHTML = msg;
    });
  }
  window.dzWalletLoad = loadWallet;

  // The public bundle calls this after every render that could have produced a
  // slot, and once when this module lands.
  window.dzFill = function(){ fillPlans(); fillSlots(); loadWallet(false); };
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
