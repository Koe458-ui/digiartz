// Turnstile, shown when the sign-in page has reason to doubt you
//
// The ask was: if two or three accounts keep logging in and out from the same
// address, make them prove they are a person. dz_captcha_required() in
// 20260825_auth_attempt_tracking.sql is the half that decides; this is the
// half that asks.
//
// HOW HARD A CONTROL THIS IS — worth being precise, because it is easy to
// assume more than it delivers.
//
// The sign-in call goes from the browser straight to GoTrue. This file cannot
// stand in front of that, so on its own it stops abuse THROUGH THE SITE and
// not abuse aimed at the auth API directly. What makes it a real control is
// the CAPTCHA setting in the Supabase dashboard: with it on, GoTrue itself
// refuses any signup or sign-in whose captchaToken is missing or invalid, and
// then there is no path around this at all. The code here is written to be
// correct either way — see security/CAPTCHA-SETUP.md for the ten-minute
// dashboard side.
//
// UNTIL A SITE KEY IS CONFIGURED THIS FILE DOES NOTHING. No widget, no network
// call, no delay: token() resolves to null and the auth call proceeds exactly
// as it does today. That is deliberate — shipping it inert means the deploy
// carries no risk, and turning it on is one config value rather than a code
// change.
//
// The attempt log is separate from the challenge and runs regardless: it is
// what dz_captcha_required() reads, so it has to be recording before the
// challenge can ever have anything to go on.

(function () {
  'use strict';

  var SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  function cfg() {
    return (window.KOE_CONFIG && window.KOE_CONFIG.TURNSTILE_SITE_KEY) || '';
  }
  function sb() { return window.sb || null; }

  // ---- the attempt log ----------------------------------------------------
  // Fire and forget. A failure here must never surface to the person signing
  // in, and must never delay them: the RPC is not awaited by the caller.
  function note(event, email, ok) {
    var c = sb();
    if (!c || typeof c.rpc !== 'function') return;
    try {
      c.rpc('dz_note_auth', {
        p_event: event,
        p_email: email || null,
        p_ok: (ok === true || ok === false) ? ok : null
      }).then(function () {}, function () {});
    } catch (e) { /* never the reason a login fails */ }
  }

  // ---- does this caller need to be challenged -----------------------------
  // Defaults to false on any error. A detector that fails closed would put a
  // challenge in front of everybody the first time the RPC had a bad minute,
  // which is a worse outage than the abuse it prevents.
  function required() {
    var c = sb();
    if (!c || typeof c.rpc !== 'function') return Promise.resolve(false);
    return c.rpc('dz_captcha_required').then(
      function (r) { return !!(r && r.data === true); },
      function () { return false; }
    );
  }

  // ---- the script ---------------------------------------------------------
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

  // ---- the widget ---------------------------------------------------------
  // One widget, reused. Turnstile tokens are single-use, so it is reset after
  // every attempt rather than rendered again — rendering again leaks widget
  // ids and eventually stops returning tokens.
  var widgetId = null;

  function host() {
    var el = document.getElementById('dzCaptcha');
    if (el) return el;
    // The auth modal is the natural home; if its markup is older than this
    // file, fall back to appending near the button rather than doing nothing.
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

  // Resolves with a token, or null when Turnstile is unavailable or declines.
  // Never rejects: the caller decides what to do with null, and on this site
  // the answer is "carry on", because GoTrue is the thing that enforces.
  function token(force) {
    var key = cfg();
    if (!key) return Promise.resolve(null);          // not configured: inert

    return load().then(function (ok) {
      if (!ok || !window.turnstile) return null;
      var el = host();
      if (!el) return null;

      return new Promise(function (resolve) {
        var settled = false;
        function done(v) { if (!settled) { settled = true; resolve(v); } }

        // A challenge that never returns must not hang the sign-in button
        // forever. Twenty seconds is far longer than a managed challenge takes
        // and short enough that a person is still looking at the screen.
        var timer = setTimeout(function () { done(null); }, 20000);

        function finish(v) { clearTimeout(timer); done(v); }

        try {
          if (widgetId !== null) {
            window.turnstile.reset(widgetId);
          } else {
            widgetId = window.turnstile.render(el, {
              sitekey: key,
              // 'interactive' is Turnstile's managed mode: invisible for
              // traffic it is happy with, a checkbox for traffic it is not.
              // When our own detector has already seen this address cycling
              // accounts, we stop leaving that to Turnstile and always show it.
              appearance: force ? 'always' : 'interactive',
              size: 'flexible',
              callback: function (t) { finish(t || null); },
              'error-callback': function () { finish(null); },
              'expired-callback': function () { finish(null); },
              'timeout-callback': function () { finish(null); }
            });
          }
          if (widgetId !== null) window.turnstile.execute(widgetId);
        } catch (e) {
          finish(null);
        }
      });
    }, function () { return null; });
  }

  // What auth.js calls. Asks the server whether to force a visible challenge,
  // then produces a token. Resolves to null when captcha is not configured, so
  // the caller can pass it straight through.
  function forAuth() {
    if (!cfg()) return Promise.resolve(null);
    return required().then(function (force) { return token(force); });
  }

  // Tokens are single-use; after a failed attempt the next one needs a fresh
  // widget state or Turnstile returns the same spent token.
  function reset() {
    try {
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    } catch (e) { /* a widget that will not reset is replaced on next render */ }
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
