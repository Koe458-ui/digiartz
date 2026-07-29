/* ── composer.js · emoji picker + keyboard lift ── */
/* ── Emoji picker ─────────────────────────────────────────────
   Shared by the community composer (#cpBarInput) and the DM bar
   (#dmInput). One fixed-position panel, built lazily on first
   open, anchored above whichever composer bar invoked it.
   Inserts at the caret, respects maxlength, keeps input focus. */
(function () {
  'use strict';
  var CATS = [
    { n:'Smileys',   i:'😀', e:['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','😐','😑','😶','🙄','😏','😴','🥱','😪','😌','😔','😕','🙁','😮','😯','😲','😳','🥺','😢','😭','😤','😠','😡','🤯','😬','😰','😱','🥵','🥶','😷','🥳','😎','🤓','🧐'] },
    { n:'Gestures',  i:'👍', e:['👍','👎','👊','✊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✌️','🤞','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','✍️'] },
    { n:'Hearts',    i:'❤️', e:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','😻','💌'] },
    { n:'Animals',   i:'🐱', e:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦄','🐝','🦋','🐢','🐍','🐙','🦈','🐬','🐳','🐟','🦀'] },
    { n:'Food',      i:'🍕', e:['🍏','🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🍜','🍣','🍩','🍪','🎂','🍰','🧁','🍫','🍬','🍭','☕','🍵','🧋','🥤'] },
    { n:'Activity',  i:'🎨', e:['🎨','🖌️','🖍️','✏️','📸','⚽','🏀','🏈','⚾','🎾','🏐','🎱','🏓','🏸','🥊','🎮','🎧','🎤','🎸','🎹','🥁','🎺','🎻','🎬','🎯','🎲','♟️','🧩','🛹','🚴','🏆','🥇','🎖️'] },
    { n:'Objects',   i:'💡', e:['💡','🔥','⭐','🌟','✨','⚡','☀️','🌙','🌈','☁️','❄️','💧','🎁','🎈','🎉','🎊','📱','💻','🖥️','⌚','📷','🔑','🔒','📌','📎','✂️','🖊️','📖','📚','💎','🕹️','🧸'] },
    { n:'Symbols',   i:'✅', e:['✅','❌','❓','❗','💯','🔔','🔕','➕','➖','➗','✖️','💤','💢','💥','💫','🆗','🆒','🆕','🔝','🔜','⚠️','♻️','✳️','✴️','❇️','™️'] }
  ];
  var panel = null, grid = null, targetId = null, anchorBtn = null, catEls = [], tabEls = [];

  function build () {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'emojiPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Emoji picker');
    var tabs = document.createElement('div');
    tabs.className = 'emojiTabs';
    grid = document.createElement('div');
    grid.className = 'emojiGrid';
    CATS.forEach(function (cat, ci) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'emojiTab' + (ci === 0 ? ' active' : '');
      tab.textContent = cat.i;
      tab.title = cat.n;
      tab.setAttribute('aria-label', cat.n + ' emojis');
      tab.addEventListener('click', function () {
        tabEls.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        if (catEls[ci]) grid.scrollTop = catEls[ci].offsetTop - grid.offsetTop;
      });
      tabs.appendChild(tab);
      tabEls.push(tab);

      var lbl = document.createElement('div');
      lbl.className = 'emojiCatLbl';
      lbl.textContent = cat.n.toUpperCase();
      grid.appendChild(lbl);
      catEls.push(lbl);
      cat.e.forEach(function (ch) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'emojiCell';
        b.textContent = ch;
        b.setAttribute('aria-label', ch);
        b.addEventListener('click', function () { insert(ch); });
        grid.appendChild(b);
      });
    });
    panel.appendChild(tabs);
    panel.appendChild(grid);
    document.body.appendChild(panel);
  }

  function position () {
    if (!panel || !anchorBtn) return;
    var bar = anchorBtn.closest('.cpBar, .dmBar') || anchorBtn;
    var r = bar.getBoundingClientRect();
    panel.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
    var br = anchorBtn.getBoundingClientRect();
    var w = panel.offsetWidth || 340;
    panel.style.left = Math.min(Math.max(8, br.left), Math.max(8, window.innerWidth - w - 8)) + 'px';
  }

  function open (btn, inputId) {
    build();
    targetId = inputId;
    if (anchorBtn) anchorBtn.classList.remove('active');
    anchorBtn = btn;
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
    panel.classList.add('open');
    position();
  }
  function close () {
    if (!panel) return;
    panel.classList.remove('open');
    if (anchorBtn) {
      anchorBtn.classList.remove('active');
      anchorBtn.setAttribute('aria-expanded', 'false');
    }
  }
  window.toggleEmojiPanel = function (btn, inputId) {
    if (panel && panel.classList.contains('open') && targetId === inputId) { close(); return; }
    open(btn, inputId);
  };

  function insert (ch) {
    var inp = document.getElementById(targetId);
    if (!inp) return;
    var max = parseInt(inp.getAttribute('maxlength') || '0', 10);
    var v = inp.value;
    var s = inp.selectionStart != null ? inp.selectionStart : v.length;
    var e = inp.selectionEnd != null ? inp.selectionEnd : v.length;
    var next = v.slice(0, s) + ch + v.slice(e);
    if (max && next.length > max) return; /* respect the input's maxlength */
    inp.value = next;
    var pos = s + ch.length;
    try { inp.setSelectionRange(pos, pos); } catch (err) {}
    inp.focus({ preventScroll: true });
    /* let any listeners (e.g. draft counters) know the value changed */
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
  }

  /* Close on outside tap, Escape, or viewport changes */
  document.addEventListener('click', function (e) {
    if (!panel || !panel.classList.contains('open')) return;
    if (panel.contains(e.target)) return;
    if (anchorBtn && (e.target === anchorBtn || anchorBtn.contains(e.target))) return;
    /* clicking back into the target input keeps the panel open */
    var t = targetId ? document.getElementById(targetId) : null;
    if (t && e.target === t) return;
    close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', function () {
    if (panel && panel.classList.contains('open')) position();
  });
  /* Follow the composer bar when the keyboard-lift module moves it */
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      if (panel && panel.classList.contains('open')) setTimeout(position, 60);
    });
  }
  /* Tapping emojis/tabs must not steal focus from the input (which
     would close the mobile keyboard) — insert() refocuses anyway,
     but this stops the close/reopen flicker. */
  document.addEventListener('mousedown', function (e) {
    if (panel && panel.contains(e.target)) e.preventDefault();
  });
})();

/* ── Keyboard lift ────────────────────────────────────────────
   The composer bars (#cpBar fixed at the bottom, .dmBar at the
   bottom of the DM view) sit under the on-screen keyboard on
   iOS and on Android since Chrome 108 (keyboard resizes only
   the *visual* viewport, never the layout). This module lifts
   ONLY the focused composer: when an input inside .cpBar/.dmBar
   gains focus, the bar is translated up by exactly the occluded
   height reported by the VisualViewport API, and the matching
   chat scrolls to its latest message. Everything is restored on
   blur / keyboard dismissal. Browsers where the layout already
   resizes (older Android, desktop) report zero occlusion, so
   this is a natural no-op there — safe on all devices. */
(function () {
  'use strict';
  var vv = window.visualViewport;
  if (!vv) return; /* pre-2019 browsers: keep default behavior */

  var activeBar = null;

  function occlusion () {
    return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  }
  function chatBodyFor (bar) {
    if (!bar) return null;
    return bar.id === 'cpBar' ? document.getElementById('cpBody')
                              : document.getElementById('dmBody');
  }
  function update () {
    if (!activeBar) return;
    var kb = occlusion();
    if (kb > 0) {
      activeBar.style.transform = 'translateY(-' + kb + 'px)';
      activeBar.classList.add('kbLift');
      var b = chatBodyFor(activeBar);
      if (b) b.scrollTop = b.scrollHeight; /* keep latest message visible */
    } else {
      activeBar.style.transform = '';
      activeBar.classList.remove('kbLift');
    }
  }
  function release (bar) {
    if (!bar) return;
    bar.style.transform = '';
    bar.style.willChange = '';   /* FIX(B4): drop the compositor hint with the lift */
    bar.classList.remove('kbLift');
    if (activeBar === bar) activeBar = null;
  }

  /* Lift ONLY when the text box itself is tapped/focused */
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('input, textarea')) return;
    var bar = t.closest ? t.closest('.cpBar, .dmBar') : null;
    if (!bar) return;
    if (activeBar && activeBar !== bar) release(activeBar);
    activeBar = bar;
    bar.style.willChange = 'transform'; /* FIX(B4): hint only while the keyboard interaction is live */
    update();
    /* iOS reports the new viewport a beat after focus */
    setTimeout(update, 120);
    setTimeout(update, 350);
  });

  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('.cpBar, .dmBar')) return;
    /* Grace period: focus may bounce back instantly (emoji insert,
       send-button mousedown guards) — only drop if it truly left. */
    setTimeout(function () {
      var a = document.activeElement;
      if (a && a.closest && a.closest('.cpBar, .dmBar')) return;
      release(activeBar);
    }, 80);
  });

  /* Track keyboard show/hide/resize + viewport pans while lifted */
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  /* Keyboard dismissed via system back/done without a blur event */
  window.addEventListener('orientationchange', function () { setTimeout(update, 250); });
})();
