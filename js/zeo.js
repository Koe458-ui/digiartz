// Zeo, the assistant in the friends list.
//
// It answers by menu: a welcome, a set of topics, the questions under a topic
// and the answer to one, with a way back at every step. Every answer is one
// somebody wrote and checked (aiAssistantData.js), so it cannot invent a
// policy, a price or a step that does not exist — which is the point of
// building it this way rather than as free text.
//
// It used to be a circle fixed in the corner of every page, with a speech
// bubble that nudged from beside it, and it was removed for that: a launcher
// on top of the document at all times, in the way of the page, tapping the
// reader on the shoulder. What was worth keeping was never the circle — it was
// the eighty-odd answers behind it.
//
// So Zeo is a friend now. It has a standing row at the top of the friends list
// and opens in the same chat panel a conversation with a person opens in: the
// same slide-in, the same header, the same way back. Nothing about it is
// fixed over the page, and a member reaches it by going to it.
//
// The thread is not stored. Every open starts at the welcome, because a menu
// walk is not a conversation to come back to — and because a transcript of a
// help tree is a transcript of the tree.
(function () {
  'use strict';

  function $ (id) { return document.getElementById(id); }
  function data () { return window.ZEO_DATA || null; }

  var body = null;          // the message column, built on first open
  var open = false;
  var activeControls = null;

  /* The chat panel holds three views: a conversation with a person
     (#dmChatView), a community's room (#cmChatView) and this. Each open shows
     one and hides the others, the way js/dm.js already does — so the panel,
     its header and its back button are one implementation rather than three. */
  function view () {
    var v = $('zeoChatView');
    if (v) return v;
    var host = $('cmChatPanel');
    if (!host) return null;
    v = document.createElement('div');
    v.className = 'cmChat zeoChat';
    v.id = 'zeoChatView';
    v.style.display = 'none';
    v.innerHTML = '<div class="zeoBody" id="zeoBody" aria-live="polite"></div>';
    host.appendChild(v);
    return v;
  }

  function scrollDown () {
    requestAnimationFrame(function () { if (body) body.scrollTop = body.scrollHeight; });
  }

  /* A menu that has been answered stops answering.
     Without this, walking back up the tree leaves every menu ever shown still
     live further up the thread, and pressing one of them appends a second
     branch under the first. Locked buttons stay legible — the thread is a
     record of the walk — they simply do nothing. */
  function lockActiveControls () {
    if (!activeControls) return;
    activeControls.classList.add('zeoLocked');
    var btns = activeControls.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    activeControls = null;
  }

  // freeze the menu, echo the choice as the member's own line, then answer
  function advance (label, proceed) {
    lockActiveControls();
    say(label, true);
    proceed();
  }

  function say (text, mine) {
    var msg = document.createElement('div');
    msg.className = 'zeoMsg' + (mine ? ' zeoMsgUser' : '');
    var bub = document.createElement('div');
    bub.className = 'zeoMsgBubble';
    // textContent: every answer is authored, but an answer is still text and
    // text does not become markup on the way to the screen
    bub.textContent = text;
    msg.appendChild(bub);
    body.appendChild(msg);
    scrollDown();
    return msg;
  }

  // ---- controls -----------------------------------------------------------
  function newControls () {
    var c = document.createElement('div');
    c.className = 'zeoStepControls';
    return c;
  }
  function commit (controls) {
    body.appendChild(controls);
    activeControls = controls;
    scrollDown();
  }

  function addOptions (container, items, onPick) {
    var wrap = document.createElement('div');
    wrap.className = 'zeoOptions';
    items.forEach(function (item) {
      var b = document.createElement('button');
      b.className = 'zeoOption';
      b.type = 'button';
      b.textContent = item.label;
      b.addEventListener('click', function () {
        if (b.disabled) return;
        advance(item.label, function () { onPick(item); });
      });
      wrap.appendChild(b);
    });
    container.appendChild(wrap);
  }

  function addCategories (container, categories, onPick) {
    if (!categories || !categories.length) {
      var ph = document.createElement('div');
      ph.className = 'zeoComingSoon';
      ph.textContent = 'Topics are coming soon.';
      container.appendChild(ph);
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'zeoCategories';
    categories.forEach(function (cat) {
      var card = document.createElement('button');
      card.className = 'zeoCatCard';
      card.type = 'button';
      // built rather than written as a string: a category's label and blurb
      // are content, and content is set as text
      var ico = document.createElement('span');
      ico.className = 'zeoCatIco';
      ico.textContent = cat.icon || '📂';
      var txt = document.createElement('span');
      txt.className = 'zeoCatTxt';
      var lbl = document.createElement('span');
      lbl.className = 'zeoCatLabel';
      lbl.textContent = cat.label;
      txt.appendChild(lbl);
      if (cat.description) {
        var d = document.createElement('span');
        d.className = 'zeoCatDesc';
        d.textContent = cat.description;
        txt.appendChild(d);
      }
      card.appendChild(ico); card.appendChild(txt);
      card.addEventListener('click', function () {
        if (card.disabled) return;
        advance(cat.label, function () { onPick(cat); });
      });
      wrap.appendChild(card);
    });
    container.appendChild(wrap);
  }

  function addBack (container, parentFn) {
    var b = document.createElement('button');
    b.className = 'zeoBackBtn';
    b.type = 'button';
    b.textContent = '← Back';
    b.addEventListener('click', function () {
      if (b.disabled) return;
      advance('Back', parentFn);
    });
    container.appendChild(b);
  }

  // ---- the walk -----------------------------------------------------------
  function renderWelcome () {
    var d = data(); if (!d) return;
    say(d.welcomeMessage);
    var c = newControls();
    addOptions(c, d.welcomeOptions || [], routeWelcome);
    commit(c);          // no way back from the first screen
  }

  function routeWelcome (item) {
    if (item.id && item.id.indexOf('cat_') === 0) goCategory(item.id.slice(4));
    else goHelpCenter();
  }

  function goHelpCenter () {
    var d = data(); if (!d) return;
    say(d.helpCenterMessage);
    var c = newControls();
    addCategories(c, d.categories, function (cat) { goCategory(cat.id); });
    addBack(c, renderWelcome);
    commit(c);
  }

  function goCategory (catId) {
    var d = data(); if (!d) return;
    var cat = (d.categories || []).filter(function (c) { return c.id === catId; })[0];
    var resps = (d.responses || {})[catId] || [];

    if (cat && cat.prompt) say(cat.prompt);
    else if (cat)          say('Here are the options for ' + cat.label + ':');

    var c = newControls();
    if (!resps.length) {
      var ph = document.createElement('div');
      ph.className = 'zeoComingSoon';
      ph.textContent = 'Answers for this topic are coming soon.';
      c.appendChild(ph);
    } else {
      addOptions(c, resps.map(function (r) {
        return { id: r.question, label: r.question, question: r.question };
      }), function (item) { goAnswer(catId, item.question); });
    }
    addBack(c, goHelpCenter);
    commit(c);
  }

  function goAnswer (catId, question) {
    var d = data(); if (!d) return;
    var resps = (d.responses || {})[catId] || [];
    var resp = resps.filter(function (r) { return r.question === question; })[0];
    if (resp) say(resp.answer);
    var c = newControls();
    addBack(c, function () { goCategory(catId); });
    commit(c);
  }

  // ---- opening and closing ------------------------------------------------
  function zeoOpen () {
    var d = data();
    if (!d) { if (typeof showToast === 'function') showToast('Zeo is unavailable right now'); return; }
    var v = view(); if (!v) return;
    body = $('zeoBody'); if (!body) return;

    // Show this view and hide the other two. A conversation left open behind
    // this would still be polling and would still be on screen under it.
    if (typeof window.dmCloseThread === 'function') window.dmCloseThread(true);
    var dm = $('dmChatView'); if (dm) dm.style.display = 'none';
    var cm = $('cmChatView'); if (cm) cm.style.display = 'none';
    v.style.display = 'flex';
    // the community room's composer and lock note belong to that room
    var bar = $('cpBar');      if (bar)  bar.style.display = 'none';
    var lock = $('cpLockNote'); if (lock) lock.style.display = 'none';

    if (typeof cmChatPanelOpen === 'function') cmChatPanelOpen();
    if (typeof cmHdrChatMode === 'function') {
      cmHdrChatMode({
        name  : 'Zeo',
        sub   : 'Bot · Always online',
        avatar: '/zeo-avatar.png?v=4',
        letter: '🤖',
        tap   : null          // a bot has no profile to open
      });
    }
    open = true;

    // Every open starts at the welcome. A menu walk is not a conversation to
    // come back to, and half a walk restored is a thread whose live menu is
    // three screens up.
    while (body.firstChild) body.removeChild(body.firstChild);
    activeControls = null;
    renderWelcome();
  }

  /* Two ways out, and they are not the same one.

     `hide` gives up the view and nothing else — it is what a conversation
     calls on its way in, because the panel it wants is the panel this is
     already in and closing that would shut the thread being opened.

     `close` is the member leaving: the view goes, and the panel goes with it. */
  function zeoHide () {
    if (!open) return;
    open = false;
    var v = $('zeoChatView'); if (v) v.style.display = 'none';
  }
  function zeoClose () {
    if (!open) return;
    zeoHide();
    if (typeof cmChatPanelClose === 'function') cmChatPanelClose();
    if (typeof cmHdrHomeMode === 'function') cmHdrHomeMode();
  }
  function zeoIsOpen () { return open; }

  /* The panel's own back button, and the sweep in js/app-core.js, both call
     cmCloseChat. Three things close this panel — a community room
     (js/mywork.js), a conversation (js/dm.js) and now this — so it is wrapped
     rather than replaced: this view answers for itself and hands anything else
     straight on.

     On DOMContentLoaded and not at parse time, which is the whole of why an
     earlier version of this did nothing. js/mywork.js DECLARES cmCloseChat —
     a function declaration, so it lands on window when that file is parsed —
     and it is parsed after this one. Wrapping at parse time put this wrapper
     under a name mywork.js then overwrote. js/dm.js wraps in its own
     DOMContentLoaded for the same reason and registered its listener first,
     so by the time this runs the chain is mywork → dm, and this goes on top.

     Wrapped on load and not at open time, because a sweep can arrive before
     this has ever been opened. */
  document.addEventListener('DOMContentLoaded', function () {
    var orig = window.cmCloseChat;
    window.cmCloseChat = function () {
      if (open) { zeoClose(); return; }
      if (typeof orig === 'function') return orig.apply(this, arguments);
    };
  });

  // Escape leaves the assistant and stops there, the way the friends page's
  // own handler does — the page under it is not this key's to close.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !open) return;
    e.stopImmediatePropagation();
    zeoClose();
  }, true);

  // The row in the friends list is an inline onclick, so it resolves against
  // the global scope like every other handler in this document.
  window.zeoOpen   = zeoOpen;
  window.zeoHide   = zeoHide;
  window.zeoClose  = zeoClose;
  window.zeoIsOpen = zeoIsOpen;
})();
