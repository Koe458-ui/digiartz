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
  var LOGO_RZP =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391l6.395-24z' +
    'M14.26 10.098L3.389 17.166 1.564 24h9.008l3.688-13.902Z"/></svg>';
  var LOGO_PP =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222' +
    'c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743' +
    'a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142' +
    'c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083' +
    '-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612' +
    'c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126' +
    'a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z"/></svg>';

  var PROV = {
    rzp: {
      name: 'Razorpay',
      logo: LOGO_RZP,
      note: 'Pay by card or anything else you use',
      ways: ['Credit card', 'Debit card', 'UPI', 'Net banking', 'Wallets', 'EMI']
    },
    paypal: {
      name: 'PayPal',
      logo: LOGO_PP,
      note: 'Pay from your PayPal account \\u2014 cards are not accepted here',
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
  // Razorpay is the one that takes cards, and it takes everything else too.
  // The method list is spelled out rather than left to the default so the
  // intent is readable here: a card — credit or debit — must always be an
  // option on this side, because PayPal deliberately offers none. Razorpay
  // shows the intersection of this list and what the account has activated,
  // so naming a method that is not switched on yet costs nothing.
  var RZP_METHODS = {
    card: true, upi: true, netbanking: true, wallet: true,
    emi: true, paylater: true
  };

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
        method: RZP_METHODS,
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
  function pickHtml(list){
    var opts = list.map(function(id){
      var p = PROV[id];
      return '<button class="dzPayOpt dzPayOpt--' + esc(id) + '" type="button" ' +
               'data-prov="' + esc(id) + '" aria-pressed="false">' +
               '<span class="dzPayOptTop">' +
                 // our own constant markup, not anything a row supplied
                 '<span class="dzPayLogo">' + p.logo + '</span>' +
                 '<span class="dzPayOptName">' + esc(p.name) + '</span>' +
                 '<span class="dzPayOptTick" aria-hidden="true">\\u2713</span>' +
               '</span>' +
               '<span class="dzPayOptNote">' + esc(p.note) + '</span>' +
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
            pickHtml(list) +
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
    var list = C.providers || [];
    if(!list.length){ toast('Checkout is not available right now'); return; }

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
    var p = null;
    (C.plans || []).forEach(function(x){ if(x.id === id) p = x; });
    if(p) return {
      title: 'Checkout',
      name: p.name + ' membership',
      sub: 'One month \\u00b7 ' + p.tagline,
      price: p.price,
      priceLabel: 'Plan price',
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
      price: money(amount, 'USD'),
      priceLabel: 'Amount',
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
      var v = prompt('Support amount in USD (minimum $0.50):', '5');
      if(v === null) return;
      amount = Math.round(parseFloat(v) * 100);
      if(!Number.isFinite(amount) || amount < 50){ toast('Minimum is $0.50'); return; }
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
    if(typeof window.openPurchasesPage === 'function'){
      window.openPurchasesPage();
      loadPurchases(true);
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
          (!flagged && (s.withdrawable || 0) > 0 ? '' : 'disabled') + '>' +
          (flagged ? 'Withdrawals paused' : 'Request payout') + '</button>' +
        '<div class="dzWlMsg" hidden></div>' +

        '<div class="dzWlSect">Activity</div>' +
        ((d.history || []).length
          ? '<ul class="dzWlList">' + d.history.map(row).join('') + '</ul>'
          : '<div class="dzWlEmpty">Nothing yet.</div>') +

        // House rules for the money side, kept at the foot of the wallet so
        // they sit next to the balance and the payout button they describe.
        '<div class="dzWlSect">Wallet guidelines</div>' +
        '<ol class="dzWlGuide">' +
          '<li>Minimum withdrawal amount is $5.</li>' +
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
                  // a freshly-raised flag should show on the wallet at once
                  if(/paused|verified/i.test(e.message || '')) loadWallet(true);
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
        '<div class="dzPuHead">My purchases</div>' +
        '<div class="dzWlEmpty">Nothing bought yet. Anything you buy on the marketplace ' +
        'lands here permanently, with every file unlocked.</div>';
      return;
    }
    host.innerHTML =
      '<div class="dzPuHead">My purchases</div>' +
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
  function loadPurchases(force){
    var host = document.getElementById('pfPurchaseGate');
    if(!host || !window.sb || !sb.rpc) return;
    if(force) purchasesP = null;
    // Promise.resolve, not the builder itself: a PostgrestBuilder fires a fresh
    // request every time something calls .then on it, so caching the builder
    // would cache nothing and double the traffic instead.
    if(!purchasesP) purchasesP = Promise.resolve(sb.rpc('dz_my_purchases'));
    purchasesP.then(function(res){
      if(!res || res.error){
        host.innerHTML = '<div class="dzWlEmpty">' +
          esc((res && res.error && res.error.message) || 'Could not load your purchases') + '</div>';
        purchasesP = null;
        return;
      }
      renderPurchases(host, res.data || []);
      // the same answer tells the marketplace which cards to unlock
      var changed = false;
      (res.data || []).forEach(function(p){
        if(p.item_id && !ownedIds[p.item_id]){ ownedIds[p.item_id] = true; changed = true; }
      });
      if(changed) repaintOwned();
    }, function(){
      host.innerHTML = '<div class="dzWlEmpty">Could not load your purchases</div>';
      purchasesP = null;
    });
  }
  window.dzPurchasesLoad = loadPurchases;

  // The public bundle calls this after every render that could have produced a
  // slot, and once when this module lands.
  window.dzFill = function(){ fillPlans(); fillSlots(); loadWallet(false); loadPurchases(false); };
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
  if (!(await sbUser(env, request))) return deny(401);

  // plansHtml is the grid on the subscription page; plans is the same table in
  // a shape the checkout page can read, so what a buyer is told they get at
  // checkout is the plan's own wording rather than a second, drifting copy.
  const cfg = {
    providers: liveProviders(env),
    plansHtml: plansHtml(),
    plans: PLANS.map((p) => ({
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
