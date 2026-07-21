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
  var currentScreen = 'welcome'; // 'welcome' | 'helpCenter' | categoryId
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
    renderScreen('welcome');
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

  /* RENDER ENGINE Reads from ZEO_DATA and builds HTML dynamically. */

  function makeMsg(text) {
    var msg  = document.createElement('div');
    msg.className = 'zeoMsg';
    var bub = document.createElement('div');
    bub.className = 'zeoMsgBubble';
    bub.textContent = text;
    msg.appendChild(bub);
    return msg;
  }

  function makeOptions(items, onClick) {
    var wrap = document.createElement('div');
    wrap.className = 'zeoOptions';
    items.forEach(function(item) {
      var btn = document.createElement('button');
      btn.className = 'zeoOption';
      btn.textContent = item.label;
      btn.addEventListener('click', function() { onClick(item); });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function makeCategories(categories, onClick) {
    var wrap = document.createElement('div');
    wrap.className = 'zeoCategories';

    if (!categories || categories.length === 0) {
      var placeholder = document.createElement('div');
      placeholder.className = 'zeoComingSoon';
      placeholder.innerHTML = '<span>🛠️</span>Categories coming soon.<br>Check back later for help topics.';
      wrap.appendChild(placeholder);
      return wrap;
    }

    categories.forEach(function(cat) {
      var card = document.createElement('button');
      card.className = 'zeoCatCard';
      card.innerHTML =
        '<span class="zeoCatIcon">' + (cat.icon || '📂') + '</span>' +
        '<span>' +
          '<span class="zeoCatLabel">' + cat.label + '</span>' +
          (cat.description ? '<span class="zeoCatDesc">' + cat.description + '</span>' : '') +
        '</span>';
      card.addEventListener('click', function() { onClick(cat); });
      wrap.appendChild(card);
    });

    return wrap;
  }

  function makeBack(onClick) {
    var b = document.createElement('button');
    b.className = 'zeoBackBtn';
    b.innerHTML = '← Back';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderScreen(screenId) {
    currentScreen = screenId;

    /* Clear */
    while (body.firstChild) body.removeChild(body.firstChild);

    if (screenId === 'welcome') {
      body.appendChild(makeMsg(data.welcomeMessage));
      body.appendChild(makeOptions(data.welcomeOptions, function(item) {
        renderScreen(item.id);
      }));
    }
    else if (screenId === 'helpCenter') {
      body.appendChild(makeMsg(data.helpCenterMessage));
      body.appendChild(makeCategories(data.categories, function(cat) {
        renderScreen('cat_' + cat.id);
      }));
      body.appendChild(makeBack(function() { renderScreen('welcome'); }));
    }
    else if (screenId.indexOf('cat_') === 0) {
      var catId = screenId.slice(4);
      var cat   = (data.categories || []).find(function(c) { return c.id === catId; });
      var resps = (data.responses || {})[catId] || [];

      if (cat) {
        body.appendChild(makeMsg(cat.icon + ' ' + cat.label));
        /* "What are you facing?" style prompt, defined per topic in the data. */
        if (cat.prompt) body.appendChild(makeMsg(cat.prompt));
      }

      if (resps.length === 0) {
        var placeholder = document.createElement('div');
        placeholder.className = 'zeoComingSoon';
        placeholder.innerHTML = '<span>💬</span>Answers for this category<br>are coming soon.';
        body.appendChild(placeholder);
      } else {
        body.appendChild(makeOptions(resps.map(function(r) {
          return { id: r.question, label: r.question, answer: r.answer };
        }), function(item) {
          renderScreen('answer_' + catId + '_' + item.id);
        }));
      }

      body.appendChild(makeBack(function() { renderScreen('helpCenter'); }));
    }
    else if (screenId.indexOf('answer_') === 0) {
      /* screenId: answer_catId_question */
      var rest  = screenId.slice(7); // catId_question
      var under = rest.indexOf('_');
      var catId2 = rest.slice(0, under);
      var qText  = rest.slice(under + 1);
      var resps2 = (data.responses || {})[catId2] || [];
      var resp   = resps2.find(function(r) { return r.question === qText; });

      body.appendChild(makeMsg('💬 ' + qText));
      if (resp) {
        body.appendChild(makeMsg(resp.answer));
      }
      body.appendChild(makeBack(function() { renderScreen('cat_' + catId2); }));
    }

    /* Scroll to bottom */
    body.scrollTop = body.scrollHeight;
  }

  /* Exposed so the hero-only-widgets script can silence the
     speech-bubble cycle whenever the bot button itself is
     hidden (off the hero section, or an overlay page is open) —
     otherwise the bubble, being independently fixed-position,
     would keep popping up on its own timer regardless. */
  window.zeoPauseBubble  = pauseBubble;
  window.zeoResumeBubble = resumeBubble;

})();
