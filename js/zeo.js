/* ── zeo.js · zeo widget engine ── */
/* Zeo widget engine — reads content from window.ZEO_DATA */
(function () {
  'use strict';

  var btn       = document.getElementById('zeoBtn');
  var page      = document.getElementById('zeoPage');
  var closeBtn  = document.getElementById('zeoChatClose');
  var body      = document.getElementById('zeoChatBody');
  var bubble    = document.getElementById('zeoBubble');
  var data      = window.ZEO_DATA;

  var isOpen      = false;
  var bubbleTimer = null;
  var bubblePaused = false;
  var lastBubbleIdx = -1;

  /* Zeo has one fixed spawn point — left of the notification button,
     set entirely in CSS (#zeoBtn). No drag, no saved position, no
     return-home glide: it lives here the same way the notification
     icon does. */

  /* Clicking bubble dismisses it and resets the cycle */
  bubble.addEventListener('click', function() {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
    bubble.classList.remove('zbVisible', 'zbHiding');
    bubble.style.opacity = '0';
    bubble.textContent = '';
    requestAnimationFrame(function() { bubble.style.opacity = ''; });
    if (!bubblePaused) {
      bubbleTimer = setTimeout(showBubble, BUBBLE_WAIT_MS);
    }
  });

  /* Tapping the bot opens the full-page assistant */
  btn.addEventListener('click', function() {
    toggleChat();
  });

  /* SPEECH BUBBLE CYCLE */
  var BUBBLE_VISIBLE_MS = 3000;
  var BUBBLE_WAIT_MS    = 6000;
  var BUBBLE_IN_MS      = 300;
  var BUBBLE_OUT_MS     = 280;

  function pickBubbleMsg() {
    var msgs = data.speechBubbles;
    if (!msgs || msgs.length === 0) return '';
    if (msgs.length === 1) return msgs[0];
    var idx;
    do { idx = Math.floor(Math.random() * msgs.length); } while (idx === lastBubbleIdx);
    lastBubbleIdx = idx;
    return msgs[idx];
  }

  function showBubble() {
    if (bubblePaused) return;
    var msg = pickBubbleMsg();
    if (!msg) return;
    bubble.textContent = msg;
    bubble.classList.remove('zbHiding');
    bubble.classList.add('zbVisible');

    /* After visible duration, hide */
    bubbleTimer = setTimeout(function() {
      hideBubble();
    }, BUBBLE_VISIBLE_MS + BUBBLE_IN_MS);
  }

  function hideBubble() {
    bubble.classList.remove('zbVisible');
    bubble.classList.add('zbHiding');

    bubbleTimer = setTimeout(function() {
      /* Guard: stay hidden if paused during animation */
      bubble.classList.remove('zbHiding');
      bubble.textContent = '';
      if (!bubblePaused) {
        bubbleTimer = setTimeout(showBubble, BUBBLE_WAIT_MS);
      }
    }, BUBBLE_OUT_MS);
  }

  function pauseBubble() {
    bubblePaused = true;
    /* Cancel every pending timer immediately */
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
    /* Snap invisible — no animation, no residual async callbacks */
    bubble.classList.remove('zbVisible', 'zbHiding');
    bubble.style.opacity = '0';
    bubble.textContent = '';
    /* Re-enable CSS-controlled opacity on next frame */
    requestAnimationFrame(function() {
      bubble.style.opacity = '';
    });
  }

  function resumeBubble() {
    bubblePaused = false;
    bubbleTimer = setTimeout(showBubble, BUBBLE_WAIT_MS);
  }

  /* Start the cycle after a short delay */
  setTimeout(showBubble, 1800);

  /* ── Section trigger — call this whenever a major section opens ── */
  var sectionTriggerTimer = null;
  window.zeoSectionTrigger = function() {
    if (isOpen || bubblePaused) return;
    clearTimeout(sectionTriggerTimer);
    sectionTriggerTimer = setTimeout(function() {
      if (!isOpen && !bubblePaused) showBubble();
    }, 2000);
  };

  /* FULL PAGE OPEN / CLOSE */
  function openChat() {
    isOpen = true;
    pauseBubble();
    page.classList.add('open');
    document.body.style.overflow = 'hidden';
    btn.setAttribute('aria-expanded', 'true');
    startWelcome();
  }

  function closeChat() {
    isOpen = false;
    page.classList.remove('open');
    /* FIX: Zeo can be opened on top of another locked panel (the
       Community Friends list opens it via cmOpenZeo) — a blind
       overflow reset here unlocked background scroll behind that
       still-open panel. restoreScroll() only unlocks when nothing
       else is open. */
    if (typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
    btn.setAttribute('aria-expanded', 'false');
    resumeBubble();
  }

  function toggleChat() {
    if (isOpen) closeChat(); else openChat();
  }

  closeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    closeChat();
  });

  /* ESC key closes panel */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  /* ─────────────────────────────────────────────────────────────
     CHAT-THREAD ENGINE

     Unlike the old one-screen renderer (which wiped the panel on
     every step), this keeps a running transcript, exactly like a
     normal support chat:

       • the option you tap echoes back on the RIGHT as your own
         message,
       • Zeo replies underneath on the LEFT,
       • the menu you just used locks so old buttons can't be
         re-clicked and the thread reads straight down,
       • every step carries a Back button that rewinds ONE level —
         it undoes your last choice, drops that reply, and hands the
         previous menu back to you, live again.
  ───────────────────────────────────────────────────────────── */

  /* The latest still-clickable controls block. When the user makes a
     choice we freeze it before echoing + replying, so the transcript
     never leaves a live duplicate menu behind. */
  var activeControls = null;

  /* One frame per forward step, so Back can peel the last one off.
     Each frame remembers where this step's DOM began (so we can strip
     exactly what it added) and which menu was live before it (so we
     can wake that menu back up). */
  var navStack = [];

  function scrollDown() {
    requestAnimationFrame(function() { body.scrollTop = body.scrollHeight; });
  }

  function lockActiveControls() {
    if (!activeControls) return;
    activeControls.classList.add('zeoLocked');
    var btns = activeControls.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
    activeControls = null;
  }

  /* Move one step forward: freeze the current menu, remember it and
     where the thread stands, echo the tap, then let Zeo reply. */
  function advance(label, proceed) {
    var prev = activeControls;
    lockActiveControls();
    navStack.push({ start: body.children.length, prev: prev });
    userSay(label);
    proceed();
  }

  /* Step back one level: strip everything the current step added and
     hand the previous menu back, clickable again. At the welcome
     screen there's nothing to undo, so it's a no-op. */
  function goBackOneStep() {
    if (!navStack.length) return;
    var frame = navStack.pop();
    while (body.children.length > frame.start) body.removeChild(body.lastChild);
    if (frame.prev) {
      frame.prev.classList.remove('zeoLocked');
      var btns = frame.prev.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) btns[i].disabled = false;
      activeControls = frame.prev;
    } else {
      activeControls = null;
    }
    scrollDown();
  }

  /* ── Bubble builders ── */
  function botSay(text) {
    var msg = document.createElement('div');
    msg.className = 'zeoMsg';
    var bub = document.createElement('div');
    bub.className = 'zeoMsgBubble';
    bub.textContent = text;
    msg.appendChild(bub);
    body.appendChild(msg);
    scrollDown();
    return msg;
  }

  /* Right-aligned "you" bubble — the tap the visitor just made,
     mirrored back so the exchange reads like a real conversation. */
  function userSay(text) {
    var msg = document.createElement('div');
    msg.className = 'zeoMsg zeoMsgUser';
    var bub = document.createElement('div');
    bub.className = 'zeoMsgBubble';
    bub.textContent = text;
    msg.appendChild(bub);
    body.appendChild(msg);
    scrollDown();
    return msg;
  }

  /* ── Controls builders (appended INTO a step container) ── */
  function addOptions(container, items, onPick) {
    var wrap = document.createElement('div');
    wrap.className = 'zeoOptions';
    items.forEach(function(item) {
      var b = document.createElement('button');
      b.className = 'zeoOption';
      b.textContent = item.label;
      b.addEventListener('click', function() {
        if (b.disabled) return;
        advance(item.label, function() { onPick(item); });
      });
      wrap.appendChild(b);
    });
    container.appendChild(wrap);
  }

  function addCategories(container, categories, onPick) {
    if (!categories || categories.length === 0) {
      var placeholder = document.createElement('div');
      placeholder.className = 'zeoComingSoon';
      placeholder.innerHTML = '<span>🛠️</span>Categories coming soon.<br>Check back later for help topics.';
      container.appendChild(placeholder);
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'zeoCategories';
    categories.forEach(function(cat) {
      var card = document.createElement('button');
      card.className = 'zeoCatCard';
      card.innerHTML =
        '<span class="zeoCatIcon">' + (cat.icon || '📂') + '</span>' +
        '<span>' +
          '<span class="zeoCatLabel">' + cat.label + '</span>' +
          (cat.description ? '<span class="zeoCatDesc">' + cat.description + '</span>' : '') +
        '</span>';
      card.addEventListener('click', function() {
        if (card.disabled) return;
        advance(cat.label, function() { onPick(cat); });
      });
      wrap.appendChild(card);
    });
    container.appendChild(wrap);
  }

  /* Back steps up one level — to the menu you were just on. */
  function addBack(container) {
    var b = document.createElement('button');
    b.className = 'zeoBackBtn';
    b.innerHTML = '← Back';
    b.addEventListener('click', function() {
      if (b.disabled) return;
      goBackOneStep();
    });
    container.appendChild(b);
  }

  function newControls() {
    var c = document.createElement('div');
    c.className = 'zeoStepControls';
    return c;
  }

  /* Commit a freshly built controls block and make it the live one. */
  function commit(controls) {
    body.appendChild(controls);
    activeControls = controls;
    scrollDown();
  }

  /* ── Flow steps ── */

  /* SCREEN 1 — the beginning. Wipes the transcript and greets. */
  function startWelcome() {
    while (body.firstChild) body.removeChild(body.firstChild);
    activeControls = null;
    navStack = [];

    botSay(data.welcomeMessage);
    var c = newControls();
    addOptions(c, data.welcomeOptions, routeWelcome);
    commit(c);
  }

  function routeWelcome(item) {
    if (item.id === 'helpCenter') { goHelpCenter(); }
    else if (item.id && item.id.indexOf('cat_') === 0) { goCategory(item.id.slice(4)); }
    else { goHelpCenter(); }
  }

  /* SCREEN 2 — topic menu. */
  function goHelpCenter() {
    botSay(data.helpCenterMessage);
    var c = newControls();
    addCategories(c, data.categories, function(cat) { goCategory(cat.id); });
    addBack(c);
    commit(c);
  }

  /* SCREEN 3 — a topic's list of problems. The topic name was already
     echoed as the user's own bubble, so Zeo replies with just the
     prompt (no redundant heading) and lists the problems. */
  function goCategory(catId) {
    var cat   = (data.categories || []).find(function(c) { return c.id === catId; });
    var resps = (data.responses || {})[catId] || [];

    if (cat && cat.prompt)      botSay(cat.prompt);
    else if (cat)               botSay('Here are the options for ' + cat.label + ':');

    var c = newControls();
    if (resps.length === 0) {
      var placeholder = document.createElement('div');
      placeholder.className = 'zeoComingSoon';
      placeholder.innerHTML = '<span>💬</span>Answers for this category<br>are coming soon.';
      c.appendChild(placeholder);
    } else {
      addOptions(c, resps.map(function(r) {
        return { id: r.question, label: r.question, answer: r.answer, question: r.question };
      }), function(item) {
        goAnswer(catId, item.question);
      });
    }
    addBack(c);
    commit(c);
  }

  /* SCREEN 4 — the answer. The question was echoed as the user's
     bubble on tap, so Zeo just replies with the walkthrough. */
  function goAnswer(catId, question) {
    var resps = (data.responses || {})[catId] || [];
    var resp  = resps.find(function(r) { return r.question === question; });

    if (resp) botSay(resp.answer);

    var c = newControls();
    addBack(c);
    commit(c);
  }

  /* Exposed so the hero-only-widgets script can silence the
     speech-bubble cycle whenever the bot button itself is
     hidden (off the hero section, or an overlay page is open) —
     otherwise the bubble, being independently fixed-position,
     would keep popping up on its own timer regardless. */
  window.zeoPauseBubble  = pauseBubble;
  window.zeoResumeBubble = resumeBubble;

})();
