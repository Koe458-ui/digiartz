// zeo widget engine
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

  // fixed spawn point

  // click bubble dismisses
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

  // click bot opens panel
  btn.addEventListener('click', function() {
    toggleChat();
  });

  // speech bubble cycle
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

    // hide after delay
    bubbleTimer = setTimeout(function() {
      hideBubble();
    }, BUBBLE_VISIBLE_MS + BUBBLE_IN_MS);
  }

  function hideBubble() {
    bubble.classList.remove('zbVisible');
    bubble.classList.add('zbHiding');

    bubbleTimer = setTimeout(function() {
      // stay hidden if paused
      bubble.classList.remove('zbHiding');
      bubble.textContent = '';
      if (!bubblePaused) {
        bubbleTimer = setTimeout(showBubble, BUBBLE_WAIT_MS);
      }
    }, BUBBLE_OUT_MS);
  }

  function pauseBubble() {
    bubblePaused = true;
    // cancel timers
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
    // snap invisible
    bubble.classList.remove('zbVisible', 'zbHiding');
    bubble.style.opacity = '0';
    bubble.textContent = '';
    // restore opacity next frame
    requestAnimationFrame(function() {
      bubble.style.opacity = '';
    });
  }

  function resumeBubble() {
    bubblePaused = false;
    bubbleTimer = setTimeout(showBubble, BUBBLE_WAIT_MS);
  }

  // start cycle
  setTimeout(showBubble, 1800);

  // section trigger
  var sectionTriggerTimer = null;
  window.zeoSectionTrigger = function() {
    if (isOpen || bubblePaused) return;
    clearTimeout(sectionTriggerTimer);
    sectionTriggerTimer = setTimeout(function() {
      if (!isOpen && !bubblePaused) showBubble();
    }, 2000);
  };

  // open and close panel
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
    // restore scroll
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

  // escape closes
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  // chat thread engine

  // active controls block
  var activeControls = null;

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

  // freeze menu, echo, reply
  function advance(label, proceed) {
    lockActiveControls();
    userSay(label);
    proceed();
  }

  // bubble builders
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

  // user bubble
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

  // controls builders
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

  // back button
  function addBack(container, parentFn) {
    var b = document.createElement('button');
    b.className = 'zeoBackBtn';
    b.innerHTML = '← Back';
    b.addEventListener('click', function() {
      if (b.disabled) return;
      advance('Back', parentFn);
    });
    container.appendChild(b);
  }

  function newControls() {
    var c = document.createElement('div');
    c.className = 'zeoStepControls';
    return c;
  }

  // commit controls
  function commit(controls) {
    body.appendChild(controls);
    activeControls = controls;
    scrollDown();
  }

  // flow steps

  // screen 1, wipes thread
  function startWelcome() {
    while (body.firstChild) body.removeChild(body.firstChild);
    activeControls = null;
    renderWelcome();
  }

  // screen 1 welcome
  function renderWelcome() {
    botSay(data.welcomeMessage);
    var c = newControls();
    addOptions(c, data.welcomeOptions, routeWelcome);
    commit(c);   // no back on welcome
  }

  function routeWelcome(item) {
    if (item.id === 'helpCenter') { goHelpCenter(); }
    else if (item.id && item.id.indexOf('cat_') === 0) { goCategory(item.id.slice(4)); }
    else { goHelpCenter(); }
  }

  // screen 2 topics
  function goHelpCenter() {
    botSay(data.helpCenterMessage);
    var c = newControls();
    addCategories(c, data.categories, function(cat) { goCategory(cat.id); });
    addBack(c, renderWelcome);
    commit(c);
  }

  // screen 3 problems
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
    addBack(c, goHelpCenter);
    commit(c);
  }

  // screen 4 answer
  function goAnswer(catId, question) {
    var resps = (data.responses || {})[catId] || [];
    var resp  = resps.find(function(r) { return r.question === question; });

    if (resp) botSay(resp.answer);

    var c = newControls();
    addBack(c, function() { goCategory(catId); });
    commit(c);
  }

  // pause bubble hook
  window.zeoPauseBubble  = pauseBubble;
  window.zeoResumeBubble = resumeBubble;

})();
