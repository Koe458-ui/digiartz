(function () {
  'use strict';

  var SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  function cfg() {
    return (window.KOE_CONFIG && window.KOE_CONFIG.TURNSTILE_SITE_KEY) || '';
  }
  function sb() { return window.sb || null; }

  function note(event, email, ok) {
    var c = sb();
    if (!c || typeof c.rpc !== 'function') return;
    try {
      c.rpc('dz_note_auth', {
        p_event: event,
        p_email: email || null,
        p_ok: (ok === true || ok === false) ? ok : null
      }).then(function () {}, function () {});
    } catch (e) {   }
  }

  function required() {
    var c = sb();
    if (!c || typeof c.rpc !== 'function') return Promise.resolve(false);
    return c.rpc('dz_captcha_required').then(
      function (r) { return !!(r && r.data === true); },
      function () { return false; }
    );
  }

  var loading = null;
  function load() {
    if (window.turnstile) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () { res(!!window.turnstile); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
    return loading;
  }

  var widgetId = null;

  function host() {
    var el = document.getElementById('dzCaptcha');
    if (el) return el;
    var anchor = document.getElementById('authBtn');
    if (!anchor || !anchor.parentNode) return null;
    el = document.createElement('div');
    el.id = 'dzCaptcha';
    el.style.margin = '10px 0';
    el.style.display = 'flex';
    el.style.justifyContent = 'center';
    anchor.parentNode.insertBefore(el, anchor);
    return el;
  }

  function token(force) {
    var key = cfg();
    if (!key) return Promise.resolve(null);

    return load().then(function (ok) {
      if (!ok || !window.turnstile) return null;
      var el = host();
      if (!el) return null;

      return new Promise(function (resolve) {
        var settled = false;
        function done(v) { if (!settled) { settled = true; resolve(v); } }

        var timer = setTimeout(function () { done(null); }, 20000);

        function finish(v) { clearTimeout(timer); done(v); }

        try {
          if (widgetId !== null) {
            window.turnstile.reset(widgetId);
          } else {
            widgetId = window.turnstile.render(el, {
              sitekey: key,
              appearance: force ? 'always' : 'interaction-only',
              size: 'normal',
              callback: function (t) { finish(t || null); },
              'error-callback': function () { finish(null); },
              'expired-callback': function () { finish(null); },
              'timeout-callback': function () { finish(null); }
            });
          }
        } catch (e) {
          finish(null);
        }
      });
    }, function () { return null; });
  }

  function forAuth() {
    if (!cfg()) return Promise.resolve(null);
    return required().then(function (force) { return token(force); });
  }

  function reset() {
    try {
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    } catch (e) {   }
  }

  window.dzCaptcha = {
    forAuth: forAuth,
    token: token,
    required: required,
    note: note,
    reset: reset,
    configured: function () { return !!cfg(); }
  };
})();
