// The two boards behind Profile: Analytics and Payouts.
//
// Both used to be rows in the Settings menu — four analytics dashboards under
// a gear beside Theme and Notifications, and the member's own money injected
// below Subscription. That put a creator's numbers and a creator's balance
// five taps from the bar, filed next to the notification preferences, and gave
// neither of them a page that says what it holds.
//
// They are destinations on the bar now (Profile → Analytics, Profile →
// Payouts), and each opens on a board of cards rather than a list of words:
// one card per thing, with its own colour, saying what it is and what it will
// show before a tap is spent finding out. Picking one opens the panel that
// already existed — nothing about a dashboard or a wallet changed, only the
// way in.
//
// One recipe builds both boards. The analytics list is written here, because
// four dashboards over four sections is not a secret. The payouts list is NOT:
// it is handed in by /api/store, which answers no request without a session,
// so a signed-out visitor's page source names neither a wallet nor a payout
// method. See the note on the gate in index.html.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  /* ── the card ────────────────────────────────────────────────────────────
     A button, not a link: none of these has a public address — a dashboard and
     a balance are one member's own page — so there is no href to promise a
     browser with no script.

     Everything on it is set as text and the icon is the only markup, which is
     why `ico` takes path data rather than a whole element: a card's label and
     blurb come from a list, and a list is data even when it is written a file
     away. */
  function card(o) {
    var b = document.createElement('button');
    b.className = 'hubCard';
    b.type = 'button';
    if (o.key) b.id = 'hubCard-' + o.key;
    b.style.setProperty('--hubA', o.a);
    b.style.setProperty('--hubB', o.b);

    var ico = document.createElement('span');
    ico.className = 'hubIco';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + o.svg + '</svg>';

    var nm = document.createElement('span');
    nm.className = 'hubName';
    nm.textContent = o.name;

    var ds = document.createElement('span');
    ds.className = 'hubBlurb';
    ds.textContent = o.desc;

    var go = document.createElement('span');
    go.className = 'hubGo';
    go.textContent = o.cta;

    b.appendChild(ico); b.appendChild(nm); b.appendChild(ds); b.appendChild(go);
    b.addEventListener('click', o.go);
    return b;
  }

  function paint(host, list) {
    if (!host) return;
    host.innerHTML = '';
    list.forEach(function (o) { host.appendChild(card(o)); });
  }

  /* Open and close, the same for both.
     `bnCloseAllSections` first, because these are destinations off the bar
     rather than sheets over whatever was up — arriving at your payouts with
     the gallery still open underneath is how a panel ends up with two ways
     out that disagree.

     Neither has a url. A dashboard and a balance are one member's own page,
     the same reasoning the upload sheet and the cart are held to, so the
     address is asked to stay true rather than to name this. */
  function openPage(id, before, bn) {
    if (!window.currentUser) {
      if (typeof showToast === 'function') showToast('Sign in to see this');
      if (typeof openAuthMod === 'function') openAuthMod();
      return;
    }
    if (typeof bnCloseAllSections === 'function') bnCloseAllSections();
    var pg = el(id); if (!pg) return;
    /* Light Profile on the bar. These are reached through its menu and have no
       word of their own, so js/pfedit.js lights the word they live under —
       without it the bar names nowhere while a member is looking at their own
       numbers. Set after the sweep, which clears it. */
    if (bn && typeof bnSetActive === 'function') bnSetActive(bn);
    if (before) before();
    pg.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (typeof window.dzRouteAudit === 'function') window.dzRouteAudit();
  }
  function closePage(id) {
    var pg = el(id);
    if (pg) pg.classList.remove('open');
    if (typeof restoreScroll === 'function') restoreScroll();
  }

  /* ── Analytics ───────────────────────────────────────────────────────────
     One card per scope, in the order the four sections are listed everywhere
     else, each in that section's own colour — so a board here and a chip in
     the bar's Explore menu agree about what Marketplace looks like.

     Picking one opens the dashboard that already existed. The board stays
     open behind it, so closing a dashboard lands back on the four rather than
     on whatever the member was doing before they came looking.

     A card is named for its section and not "<section> Analytics": the page is
     already called Analytics, and repeating it four times made every title
     wrap to two lines to say a word the heading had just said. */
  var AN = [
    { key:'artwork', name:'Artwork', a:'#A78BFA', b:'#6D28D9',
      desc:'Views, likes, saves and where your audience arrives from, piece by piece.',
      cta:'Explore data',
      svg:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/>' +
          '<path d="M21 15l-5-5L5 21"/>' },
    { key:'marketplace', name:'Marketplace', a:'#FB923C', b:'#C2410C',
      desc:'Sales, revenue and conversion — the one board that counts money.',
      cta:'Explore data',
      svg:'<path d="M3 9.4 4.8 4.3A2 2 0 0 1 6.7 3h10.6a2 2 0 0 1 1.9 1.3L21 9.4"/>' +
          '<path d="M4.6 9.4V19a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V9.4"/><path d="M3 9.4h18"/>' +
          '<path d="M9.6 21v-5.4h4.8V21"/>' },
    { key:'blog', name:'Blog', a:'#818CF8', b:'#4338CA',
      desc:'Reads, reading time and which posts kept people to the end.',
      cta:'Explore data',
      svg:'<rect x="3.4" y="3" width="17.2" height="18" rx="2.4"/><path d="M7.3 8.2h9.4"/>' +
          '<path d="M7.3 12h9.4"/><path d="M7.3 15.8h5.2"/>' },
    { key:'resource', name:'Resources', a:'#4ADE80', b:'#15803D',
      desc:'Downloads, saves and which of your packs people keep coming back for.',
      cta:'Explore data',
      svg:'<path d="M12 2.7 2.8 7.1 12 11.5l9.2-4.4z"/><path d="M3.2 12.1 12 16.3l8.8-4.2"/>' +
          '<path d="M3.2 16.5 12 20.7l8.8-4.2"/>' }
  ];

  function anHubOpen() {
    openPage('anHubPage', function () {
      paint(el('anHubGrid'), AN.map(function (o) {
        var c = {}; for (var k in o) c[k] = o[k];
        c.go = function () {
          if (typeof window.openAnalyticsPage === 'function') window.openAnalyticsPage(o.key);
        };
        return c;
      }));
    }, 'bnAnalytics');
  }
  function anHubClose() { closePage('anHubPage'); }

  /* ── Payouts ─────────────────────────────────────────────────────────────
     The list is not here. /api/store hands it in through dzPayHubFill once it
     has a session, for the reason in index.html: naming a wallet in a static
     asset tells a signed-out reader the wallet exists.

     Until it arrives the board shows the note under it and nothing else, which
     is also what a member with an unreachable backend sees — an empty board
     with a line saying why, rather than a board of cards that lead nowhere. */
  function payHubOpen() {
    openPage('payHubPage', function () {
      // Ask the store bundle to load and fill; it is a no-op once filled.
      if (typeof window.dzExtras === 'function') { try { window.dzExtras(); } catch (e) {} }
    }, 'bnPayouts');
  }
  function payHubClose() { closePage('payHubPage'); }

  /* What /api/store calls. It passes its own list — each entry the same shape
     the analytics cards use plus a `go` — and this file draws them, so the two
     boards cannot drift into two different components. */
  window.dzPayHubFill = function (list) {
    var host = el('payHubGrid');
    if (!host || !list || !list.length) return;
    paint(host, list);
    var note = el('payHubNote');
    if (note) note.style.display = 'none';
  };

  window.anHubOpen   = anHubOpen;
  window.anHubClose  = anHubClose;
  window.payHubOpen  = payHubOpen;
  window.payHubClose = payHubClose;
})();
