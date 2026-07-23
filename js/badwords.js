/* ── badwords.js · profanity mask ──
   Hand-written word list. No AI, no network call, no third-party list.

   What it does: any word from the list below is replaced, in place, with
   the same number of asterisks. Nothing is deleted, no message is
   rejected, no post is blocked — "fuck" becomes "****" and the rest of
   the sentence is untouched.

   Where it runs: this file patches supabase.createClient(), so every
   .insert() / .update() / .upsert() / .rpc() the app makes goes through
   the masker on the way out. That's one choke point instead of ~15
   scattered edits, which is why no other JS file had to change.

   Because the mask is the SAME LENGTH as the word it replaces, every
   min/max length CHECK constraint in the database still passes
   (blog_posts.body >= 40, jobs.description >= 80, item_reports.reason
   3..500, albums.name 1..40, and so on). That's deliberate, not luck.

   Load order matters: this must sit AFTER the supabase CDN script and
   BEFORE js/app-core.js, which is where `sb` is actually created.

   Not touched:
     • numbers, in any form — see BLOCK.digitRuns / BLOCK.govIds
     • dev accounts (profiles.role = 'dev') — see APPLY_TO_DEV
     • the Gemini upload moderation call in functions/api/moderate-upload.js.
       That's a fetch(), not a Supabase write, and it runs BEFORE this
       does — so Gemini still sees the real text and judges it honestly.
       Only the row that finally lands in the table is masked.
     • enum / slug / url / storage-path columns (see FIELDS)

   Honest limitation: this is client-side. It cleans everything written
   through the site, but someone hitting the REST API directly with their
   own anon key would skip it. The list below is written so it can be
   lifted into a Postgres BEFORE INSERT trigger later if you ever want
   that to be airtight.
   ────────────────────────────────────────────────────────────────── */

var DZ_BW = (function () {

  /* ══════════════════════════════════════════════════════════════
     1. THE LISTS  —  this is the part you paste into.
     ══════════════════════════════════════════════════════════════ */

  /* WORDS — the normal bucket. Almost everything goes here.
     Matched as a whole word, and common endings are caught too, so
     one entry "fuck" already covers fucks / fucked / fucker / fuckers /
     fucking. Won't fire inside an innocent longer word. */
  /* The bulk list lives in js/badwords-list.js so this engine file stays
     readable and each file stays small enough to paste through the
     GitHub web editor. Anything added here is merged on top of it. */
  var EXTERNAL = (window.DZ_WORDLIST && window.DZ_WORDLIST.words) || [];

  var WORDS = EXTERNAL.concat([
    /* your own additions, one per line:
       'example',
    */
  ]);

  /* STRICT — same as WORDS but WITHOUT the ending expansion.
     Use this for short words that live inside normal English:
     ass, hell, tit, cum, hoe, fag. "ass" here masks "ass" but leaves
     "assassin", "class", "bass", "grass", "passed" alone. */
  var STRICT = [
    /* 'ass',
       'hell',
    */
  ];

  /* ANYWHERE — matched even in the middle of another word.
     Only for strings that never occur innocently. Put "fuck" here and
     "motherfucker" becomes "mother****er" without needing its own entry.
     Use sparingly; this is the bucket that causes false positives. */
  var ANYWHERE = [
    /* 'fuck',
       'cunt',
    */
  ];

  /* ALLOW — safety net. Anything listed here is never masked, even if a
     word above matches inside it. You probably won't need many, since
     whole-word matching already protects most of these, but they're
     free insurance for the ANYWHERE bucket. */
  var ALLOW = [
    'class', 'classic', 'classes', 'assassin', 'assassins', 'assess',
    'assessment', 'assign', 'assist', 'assistant', 'associate', 'assume',
    'bass', 'brass', 'glass', 'grass', 'mass', 'pass', 'passed', 'passion',
    'analysis', 'analyse', 'analyze', 'analog', 'canal',
    'cocktail', 'cockpit', 'peacock', 'shuttlecock',
    'hello', 'shell', 'shelter', 'michelle', 'helsinki', 'helicopter',
    'titan', 'titanic', 'title', 'titles', 'constitute', 'competition',
    'scunthorpe', 'penistone', 'sussex', 'essex', 'middlesex',
    'document', 'circumstance', 'accumulate', 'cucumber',
    'shiitake', 'matsushita', 'phuket'
  ];

  /* PROMO — self-promo / off-platform contact phrases. Same matching as
     WORDS, and spaces and dots inside an entry are ignored, so 'wa.me'
     also catches "wa me" / "wa-me" and 'dm me' catches "dm  me". */
  var PROMO = [
    'whatsapp', 'whats app', 'wa.me', 'telegram', 't.me', 'snapchat',
    'dm me', 'dm me on', 'inbox me', 'message me on', 'contact me on',
    'text me on', 'add me on'

    /* Payment providers are deliberately absent — paytm, gpay, phonepe,
       upi, paypal, venmo, cash app. Blocking numbers was dropped so that
       payment threads keep working, and starring the provider names
       would undo that from the other direction ("I'll send it by ****").
       Add them here if you decide sellers shouldn't name a payment
       method at all. */
  ];

  /* ══════════════════════════════════════════════════════════════
     1b. PATTERNS — contact details, links and ID numbers.
     These are shapes, not words, so there's nothing to paste. Flip any
     of them off if it turns out to be too aggressive.
     ══════════════════════════════════════════════════════════════ */

  var BLOCK = {
    urls      : true,   /* https://… , www.… , and bare foo.com domains */
    emails    : true,   /* someone@somewhere.com                        */

    /* ── numbers are OFF ──
       Both of these were on at one point and taken back out on purpose.
       Numbers carry too much legitimate traffic here: order and payment
       references, Razorpay IDs, artwork and image IDs, dimensions, dates,
       version strings. A rule that stars any long digit run cannot tell
       those apart from a phone number, and the cost of a false positive
       (a broken payment thread) is worse than the thing it prevents.
       Flip either back to true if you change your mind — the patterns
       are still built and tested, just not armed. */
    digitRuns : false,  /* runs of DIGIT_MIN+ digits — phone, Aadhaar, card */
    govIds    : false   /* PAN / voter ID / GSTIN / passport shapes         */
  };

  var DIGIT_MIN = 10;   /* only consulted when digitRuns is true         */

  /* Domains that are still allowed through. Yours belongs here — an
     artist linking a DigiArtz page isn't promoting off-platform. */
  var DOMAIN_ALLOW = [
    'digiartz.net'
  ];

  /* Which suffixes count as a domain. Deliberately a fixed list rather
     than "a dot and some letters", so file names (art.png, sheet.psd)
     don't read as links. Longest-first inside each pair, so .com wins
     over .co. */
  var TLDS = [
    'com', 'net', 'org', 'info', 'biz', 'online', 'site', 'shop', 'store',
    'app', 'dev', 'link', 'live', 'club', 'fun', 'top', 'vip', 'pro',
    'xyz', 'io', 'co', 'in', 'me', 'gg', 'tv', 'ly', 'to', 'cc', 'ru',
    'uk', 'us', 'ca', 'au', 'de', 'fr', 'jp', 'cn', 'br', 'es', 'it',
    'nl', 'se', 'pl', 'tr', 'ir', 'pk', 'bd', 'lk', 'np'
  ];

  /* ══════════════════════════════════════════════════════════════
     2. TUNING  —  change these if you get false positives.
     ══════════════════════════════════════════════════════════════ */

  var MASK_CHAR   = '*';    /* what the word turns into                   */
  var APPLY_TO_DEV = false; /* true = dev accounts get filtered too       */
  var MIN_LEN     = 3;      /* ignore latin entries shorter than this. 2-letter
                               patterns match half the dictionary.        */
  var SKELETONS   = true;   /* also catch the vowel-dropped spelling:
                               fuck->fck, shit->sht, bitch->btch          */

  /* Skeletons are generated ONLY from this list, not from all 2,500
     entries. Generating them wholesale produced junk: Italian "cesso"
     gave css, "sorca" gave src, "gasti" gave gst, "taxna" gave txn,
     "picsa" gave pcs — so CSS, GST and transaction IDs were all getting
     starred. Vowel-dropping is an English internet habit anyway, so a
     short curated list catches everything real and invents nothing.
     Add a word here only if people actually abbreviate it. */
  var SKELETON_FROM = [
    'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'bullshit',
    'motherfucker', 'faggot', 'nigger', 'nigga', 'retard', 'wanker',
    'bollocks', 'arsehole', 'pussy', 'fucker', 'fucking'
    /* 'whore' left out on purpose: its skeleton is "whr", which is how
       people abbreviate "where". */
  ];
  var CJK_MIN     = 2;      /* Chinese/Japanese/Thai entries shorter than
                               this are skipped — a single character
                               matches inside too many innocent compounds */

  /* Leetspeak, applied to the word list and the text alike. One char in,
     one char out, so nothing shifts. */
  var LEET_MAP = {
    '@':'a', '4':'a', '8':'b', '(':'c', '3':'e', '6':'g', '9':'g',
    '1':'i', '!':'i', '|':'i', '0':'o', '$':'s', '5':'s', '7':'t',
    '+':'t', '2':'z', 'v':'u'
  };

  /* Endings the main list also catches: fuck -> fucks/fucked/fucking. */
  var SUFFIXES = ['ings','ing','ins','in','ers','er','ies','ed','es','s','y','z'];



  /* ══════════════════════════════════════════════════════════════
     3. WHICH COLUMNS GET CLEANED
     Explicit on purpose. Several text columns in this database are
     enum-constrained (resources.license, marketplace_items.license,
     marketplace_items.item_type, artwork_reports.reason, jobs.
     employment_type) or feed routing (blog_posts.slug) — masking any of
     those would break the write. Only real human prose is listed.
     Add a line when you add a table.
     ══════════════════════════════════════════════════════════════ */

  var FIELDS = {
    /* chat + comments */
    comments          : ['comment_text', 'username'],
    direct_messages   : ['content'],
    item_comments     : ['body', 'username'],

    /* profile */
    profiles          : ['bio', 'display_name'],   /* username: see USERNAME_POLICY */

    /* artwork + upload */
    artworks          : ['name', 'title', 'description', 'tags', 'software'],
    scheduled_uploads : ['name', 'description', 'tags', 'software'],
    comics            : ['title', 'description', 'tags'],
    albums            : ['name'],

    /* the five section tables */
    resources         : ['title', 'description', 'tags', 'software'],
    blog_posts        : ['title', 'excerpt', 'body', 'tags'],
    marketplace_items : ['title', 'description', 'tags'],
    jobs              : ['title', 'company', 'description', 'tags',
                         'location_city', 'location_region'],

    /* communities */
    communities       : ['name', 'description', 'rules'],

    /* reports — free-text side only, never the enum reason */
    artwork_reports   : ['details'],
    item_reports      : ['reason']
  };

  /* RPC arguments carrying human text (cm_create, mainly). */
  var RPC_ARGS = [
    'p_name', 'p_desc', 'p_description', 'p_title', 'p_body', 'p_text',
    'p_message', 'p_comment', 'p_reason', 'p_details', 'p_rules', 'p_bio',
    'p_content', 'p_excerpt', 'p_company'
  ];

  /* profiles.username is special. It drives the /profile/<name> URL, it
     has to stay unique, and it's locked behind a 90-day change cooldown
     (guard_profile_update). Masking it would strand someone as "****"
     for three months, so the default is to refuse the write instead.
       'block' — reject, let the UI show a message
       'mask'  — mask it like everything else
       'off'   — don't check usernames at all                          */
  var USERNAME_POLICY = 'block';

  /* A username is one unbroken token, so whole-word matching alone lets
     "fuckboy" straight through. For usernames only, also look for listed
     words INSIDE the handle. The length floor is what keeps it sane:
     at 4+, "fuckboy" and "shithead" are caught while Cassandra, Bassist
     and Classic_Art are not — those only contain 3-letter entries.
     Raise it if a legitimate handle gets refused. */
  var USERNAME_SUBSTRING = true;
  var USERNAME_MIN_SUB   = 4;

  /* ══════════════════════════════════════════════════════════════
     4. ENGINE  —  no editing needed below this line.

     Matching is a dictionary lookup, not a regex per word. With 2,500+
     entries the regex approach meant thousands of passes over every
     message (measured: 121ms on a blog body, ~9s to compile). This walks
     the text once and does hash lookups, so cost depends on message
     length, not on how many words are in the list.
     ══════════════════════════════════════════════════════════════ */

  var dict = null;

  function reEsc(c) { return c.replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&'); }

  /* ISO-ish date / timestamp — never a phone number */
  var DATE_SAFE = /\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?)?\b/g;

  /* ── shape patterns (links, phones, IDs) ── */
  function shapes() {
    var out = [];
    if (BLOCK.urls) {
      var tld = TLDS.slice().sort(function (a, b) { return b.length - a.length; })
                    .map(reEsc).join('|');
      out.push(/(?:https?:\/\/|www\.)[^\s<>"']+/g);
      out.push(new RegExp(
        '\\b[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:' + tld + ')\\b(?:\\/[^\\s<>"\']*)?', 'g'));
    }
    if (BLOCK.emails) out.push(/[a-z0-9._%+-]+\s?@\s?[a-z0-9.-]+\.[a-z]{2,}/g);
    if (BLOCK.digitRuns && DIGIT_MIN > 1) {
      out.push(new RegExp('\\+?\\d(?:[\\s.()+-]{0,2}\\d){' + (DIGIT_MIN - 1) + ',}', 'g'));
    }
    if (BLOCK.govIds) {
      out.push(/\b[a-z]{5}[0-9]{4}[a-z]\b/g);                     /* PAN      */
      out.push(/\b[0-9]{2}[a-z]{5}[0-9]{4}[a-z][0-9a-z]{3}\b/g);  /* GSTIN    */
      out.push(/\b[a-z]{3}[0-9]{7}\b/g);                          /* voter ID */
      out.push(/\b[a-z][0-9]{7}\b/g);                             /* passport */
    }
    return out;
  }

  /* ── text folding ──
     NFKD strips accents and full-width forms, so fück and ＦＵＣＫ both
     arrive as fuck. map[i] points back at the original character, which
     is how a hit becomes an exact span to star out. */
  function fold(s) {
    var n = '', map = [], i, j, d;
    for (i = 0; i < s.length; i++) {
      d = s.charAt(i);
      try { d = d.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
      d = d.toLowerCase();
      for (j = 0; j < d.length; j++) { n += d.charAt(j); map.push(i); }
    }
    return { n: n, map: map };
  }

  /* Leetspeak, applied to BOTH the text and the word list so the two
     always meet in the middle. One character in, one out — the string
     keeps its length, so spans stay aligned. */
  function canon(s) {
    var o = '', i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      o += (LEET_MAP[ch] || ch);
    }
    return o;
  }

  /* Unicode tokeniser, so Cyrillic / Devanagari / Arabic split into real
     words. Falls back to ASCII on engines without \p{...} support. */
  var UNI_SPLIT = null;
  try { UNI_SPLIT = new RegExp('[\\p{L}\\p{N}]+', 'gu'); } catch (e) { UNI_SPLIT = null; }

  var RE_CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u0e00-\u0e7f\uac00-\ud7af]/;

  /* Vowel-dropped spelling: fuck -> fck, shit -> sht, bitch -> btch.
     DERIVED from the entry, never guessed, so it can only match text
     that dropped the same letters. It will never turn "duck" into stars.
     Skipped below 3 characters — 2-letter keys hit half the dictionary. */
  function skeleton(w) {
    var sk = w.replace(/[aeiou]/g, '');
    return (sk.length >= 3 && sk.length < w.length) ? sk : null;
  }

  function squash(t) { return t.replace(/(.)\1+/g, '$1'); }      /* fuuuck -> fuck */
  function squash2(t) { return t.replace(/(.)\1{2,}/g, '$1$1'); } /* asssss -> ass  */

  /* ── dictionary build (once, lazily) ── */
  function compile() {
    if (dict) return dict;

    var plain = {}, suffixable = {}, phrases = {}, cjk = [], anywhere = [];
    var maxPhrase = 1;

    function tokens(w) {
      var t = [];
      if (UNI_SPLIT) {
        UNI_SPLIT.lastIndex = 0;
        var m; while ((m = UNI_SPLIT.exec(w)) !== null) t.push(m[0]);
      } else {
        t = w.split(/[^a-z0-9]+/);
      }
      return t.filter(function (x) { return !!x; });
    }

    function register(raw, bag, allowSkeleton) {
      /* Entries go through exactly the same folding as the text does,
         or an accented entry could never match its own folded form:
         piča -> pica, vögeln -> vogeln, fissehår -> fissehar. */
      var folded = fold(String(raw || '').trim()).n;
      if (!folded) return;

      if (RE_CJK.test(folded)) {                  /* no spaces in this script */
        /* NOT canon()'d: these are matched against the raw folded text,
           and leet-mapping would turn the digits in 13点 into letters. */
        if (folded.length >= CJK_MIN) cjk.push(folded);
        return;
      }
      var w = canon(folded);
      var tk = tokens(w);
      if (!tk.length) return;

      if (tk.length > 1) {                        /* "make me come", "wa.me" */
        var head = tk[0];
        (phrases[head] = phrases[head] || []).push(tk);
        if (tk.length > maxPhrase) maxPhrase = tk.length;
        return;
      }
      var t = tk[0];
      if (t.length < MIN_LEN) return;
      bag[t] = 1;
      if (allowSkeleton && SKELETONS && /^[a-z]+$/.test(t)) {
        var sk = skeleton(t);
        if (sk) plain[sk] = 1;
      }
    }

    var i;
    for (i = 0; i < WORDS.length; i++)  register(WORDS[i],  suffixable, false);
    for (i = 0; i < PROMO.length; i++)  register(PROMO[i],  suffixable, false);
    for (i = 0; i < STRICT.length; i++) register(STRICT[i], plain,      false);

    if (SKELETONS) {
      for (i = 0; i < SKELETON_FROM.length; i++) {
        var base = canon(fold(String(SKELETON_FROM[i] || '')).n).replace(/[^a-z]/g, '');
        var sk = base && skeleton(base);
        if (sk) plain[sk] = 1;
      }
    }

    /* ANYWHERE stays a regex — it has to match mid-word, and the list is
       small and hand-picked, so the cost is negligible. */
    for (i = 0; i < ANYWHERE.length; i++) {
      var a = canon(fold(String(ANYWHERE[i] || '')).n).replace(/[^a-z0-9]/g, '');
      if (a.length >= MIN_LEN) anywhere.push(a.split('').map(reEsc).join('+') + '+');
    }

    var cjkRe = null;
    if (cjk.length) {
      cjk.sort(function (x, y) { return y.length - x.length; });
      try { cjkRe = new RegExp('(?:' + cjk.map(function (x) {
        return x.split('').map(reEsc).join('');
      }).join('|') + ')', 'g'); } catch (e) { cjkRe = null; }
    }

    var anyRe = null;
    if (anywhere.length) {
      try { anyRe = new RegExp('(?:' + anywhere.join('|') + ')', 'g'); } catch (e) { anyRe = null; }
    }

    var allow = {};
    for (i = 0; i < ALLOW.length; i++) {
      var al = canon(fold(String(ALLOW[i] || '')).n).replace(/[^a-z0-9]/g, '');
      if (al) allow[al] = 1;
    }

    var okDomain = [];
    for (i = 0; i < DOMAIN_ALLOW.length; i++) {
      var dom = String(DOMAIN_ALLOW[i] || '').toLowerCase().trim();
      if (!dom) continue;
      okDomain.push(new RegExp(
        '(?:https?:\\/\\/)?(?:[a-z0-9-]+\\.)*' + reEsc(dom) + '\\b(?:\\/[^\\s<>"\']*)?', 'g'));
    }

    dict = {
      plain: plain, suffixable: suffixable, phrases: phrases,
      maxPhrase: maxPhrase, cjkRe: cjkRe, anyRe: anyRe,
      allow: allow, okDomain: okDomain, shapes: shapes()
    };
    return dict;
  }

  /* Is this single token a listed word? Tries the token as typed, with a
     common ending removed, and with stretched letters squeezed back. */
  function lookup(t) {
    var d = dict, i, s;
    if (t.length < MIN_LEN) return false;
    if (d.plain[t] || d.suffixable[t]) return true;

    for (i = 0; i < SUFFIXES.length; i++) {
      s = SUFFIXES[i];
      if (t.length > s.length + MIN_LEN - 1 &&
          t.slice(-s.length) === s && d.suffixable[t.slice(0, -s.length)]) return true;
    }
    var a = squash(t), b = squash2(t);
    if (a !== t && a.length >= MIN_LEN && (d.plain[a] || d.suffixable[a])) return true;
    if (b !== t && b !== a && b.length >= MIN_LEN && (d.plain[b] || d.suffixable[b])) return true;
    return false;
  }

  /* ── the scan ── */
  function find(text) {
    var d = compile();
    var f = fold(text), n = f.n;
    if (!n) return [];
    var c = canon(n);            /* same length as n, so spans line up */
    var hits = [], safe = [], m, k, i;

    /* regions that stay untouched */
    for (k = 0; k < d.okDomain.length; k++) {
      var od = d.okDomain[k]; od.lastIndex = 0;
      while ((m = od.exec(n)) !== null) {
        safe.push([m.index, m.index + m[0].length]);
        if (m.index === od.lastIndex) od.lastIndex++;
      }
    }
    if (BLOCK.digitRuns) {   /* only relevant while the digit rule is armed */
      DATE_SAFE.lastIndex = 0;
      while ((m = DATE_SAFE.exec(n)) !== null) {
        safe.push([m.index, m.index + m[0].length]);
        if (m.index === DATE_SAFE.lastIndex) DATE_SAFE.lastIndex++;
      }
    }

    /* tokenise once */
    var toks = [];
    if (UNI_SPLIT) {
      UNI_SPLIT.lastIndex = 0;
      while ((m = UNI_SPLIT.exec(c)) !== null) {
        toks.push({ t: m[0], a: m.index, b: m.index + m[0].length });
      }
    } else {
      var re = /[a-z0-9]+/g;
      while ((m = re.exec(c)) !== null) toks.push({ t: m[0], a: m.index, b: m.index + m[0].length });
    }

    /* allowlisted words shield their own span */
    for (i = 0; i < toks.length; i++) {
      if (d.allow[toks[i].t]) safe.push([toks[i].a, toks[i].b]);
    }
    function shielded(a, b) {
      for (var j = 0; j < safe.length; j++) if (a < safe[j][1] && b > safe[j][0]) return true;
      return false;
    }
    function hit(a, b) { if (!shielded(a, b)) hits.push([f.map[a], f.map[b - 1] + 1]); }

    /* A token that is nothing but digits is left alone. It has to be:
       canon() maps digits onto letters so leetspeak resolves, which means
       8080 reads as "bobo", 717 as "tit" and 455 as "ass". Without this
       guard a port number, an image ID or an order reference would get
       starred even with the digit rules switched off. */
    function allDigits(t) { return /^[0-9]+$/.test(n.slice(t.a, t.b)); }

    /* 1. plain tokens */
    for (i = 0; i < toks.length; i++) {
      if (allDigits(toks[i])) continue;
      if (lookup(toks[i].t)) hit(toks[i].a, toks[i].b);
    }

    /* 2. letters split apart to dodge the filter: "f u c k", "f.u.c.k",
       "fu ck". Only runs made entirely of 1-2 character pieces get glued
       back together, which is what keeps "the pen is mine" safe. */
    for (i = 0; i < toks.length; i++) {
      if (toks[i].t.length > 2 || allDigits(toks[i])) continue;
      var joined = '', j = i;
      while (j < toks.length && toks[j].t.length <= 2 && !allDigits(toks[j]) && j - i < 12) {
        joined += toks[j].t;
        if (j > i && joined.length >= MIN_LEN && lookup(joined)) hit(toks[i].a, toks[j].b);
        j++;
      }
    }

    /* 3. multi-word entries */
    for (i = 0; i < toks.length; i++) {
      var list = d.phrases[toks[i].t];
      if (!list) continue;
      for (k = 0; k < list.length; k++) {
        var ph = list[k];
        if (i + ph.length > toks.length) continue;
        var ok = true;
        for (var q = 1; q < ph.length; q++) {
          if (toks[i + q].t !== ph[q]) { ok = false; break; }
        }
        if (ok) hit(toks[i].a, toks[i + ph.length - 1].b);
      }
    }

    /* 4. scripts written without spaces — substring, no boundary */
    if (d.cjkRe) {
      d.cjkRe.lastIndex = 0;
      while ((m = d.cjkRe.exec(n)) !== null) {
        hit(m.index, m.index + m[0].length);
        if (m.index === d.cjkRe.lastIndex) d.cjkRe.lastIndex++;
      }
    }

    /* 5. ANYWHERE bucket + shape patterns */
    var pool = d.anyRe ? [d.anyRe].concat(d.shapes) : d.shapes;
    for (k = 0; k < pool.length; k++) {
      var p = pool[k]; p.lastIndex = 0;
      var target = (k === 0 && d.anyRe) ? c : n;
      while ((m = p.exec(target)) !== null) {
        if (m[0].length) hit(m.index, m.index + m[0].length);
        if (m.index === p.lastIndex) p.lastIndex++;
      }
    }

    if (!hits.length) return [];
    hits.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [hits[0]];
    for (k = 1; k < hits.length; k++) {
      var last = out[out.length - 1];
      if (hits[k][0] <= last[1]) { if (hits[k][1] > last[1]) last[1] = hits[k][1]; }
      else out.push(hits[k]);
    }
    return out;
  }

  function bypass() {
    if (APPLY_TO_DEV) return false;
    /* isDev is a top-level `let` in auth.js — same global lexical scope,
       but still in TDZ while this file parses, hence the guard. */
    try { if (typeof isDev !== 'undefined' && isDev === true) return true; } catch (e) {}
    return false;
  }

  function stars(n) { var s = ''; while (s.length < n) s += MASK_CHAR; return s; }

  /* The one function everything else calls. Pass {force:true} to mask
     even for a dev — handy for previewing what a visitor would see. */
  function mask(text, opts) {
    if (text === null || text === undefined) return text;
    var s = String(text);
    if (!s) return s;
    if (!(opts && opts.force) && bypass()) return s;

    var spans = find(s);
    if (!spans.length) return s;

    var out = '', prev = 0;
    for (var i = 0; i < spans.length; i++) {
      out += s.slice(prev, spans[i][0]) + stars(spans[i][1] - spans[i][0]);
      prev = spans[i][1];
    }
    return out + s.slice(prev);
  }

  function has(text) {
    if (text === null || text === undefined) return false;
    return find(String(text)).length > 0;
  }

  /* Usernames only — see USERNAME_SUBSTRING. */
  function hasInside(text) {
    if (text === null || text === undefined) return false;
    if (has(text)) return true;
    if (!USERNAME_SUBSTRING) return false;
    var d = compile();
    var t = canon(fold(String(text)).n).replace(/[^a-z]/g, '');
    if (t.length < USERNAME_MIN_SUB) return false;

    /* Blank out any allowlisted word sitting inside the handle first,
       or the scan finds "cock" inside Cockpit_Art and "cunt" inside
       Scunthorpe and refuses a perfectly good name. */
    var okAt = [], key, at;
    for (key in d.allow) {
      if (!Object.prototype.hasOwnProperty.call(d.allow, key)) continue;
      at = t.indexOf(key);
      while (at !== -1) { okAt.push([at, at + key.length]); at = t.indexOf(key, at + 1); }
    }
    function inside(a, b) {
      for (var z = 0; z < okAt.length; z++) if (a >= okAt[z][0] && b <= okAt[z][1]) return true;
      return false;
    }

    for (var i = 0; i < t.length; i++) {
      for (var len = USERNAME_MIN_SUB; i + len <= t.length; len++) {
        var sub = t.slice(i, i + len);
        if (d.allow[sub] || inside(i, i + len)) continue;
        if (d.plain[sub] || d.suffixable[sub]) return true;
      }
    }
    return false;
  }

  /* ── payload scrubbing ── */

  function scrubValue(v) {
    if (typeof v === 'string') return mask(v);
    if (Object.prototype.toString.call(v) === '[object Array]') {
      return v.map(function (x) { return typeof x === 'string' ? mask(x) : x; });
    }
    return v;
  }

  function scrubRow(table, row) {
    if (!row || typeof row !== 'object') return row;
    var cols = FIELDS[table];
    var copy = null, i, f;

    if (cols) {
      for (i = 0; i < cols.length; i++) {
        f = cols[i];
        if (!Object.prototype.hasOwnProperty.call(row, f)) continue;
        var cleaned = scrubValue(row[f]);
        if (cleaned !== row[f]) {
          if (!copy) copy = shallow(row);
          copy[f] = cleaned;
        }
      }
    }

    if (table === 'profiles' && USERNAME_POLICY !== 'off' &&
        Object.prototype.hasOwnProperty.call(row, 'username') && !bypass()) {
      var u = row.username;
      if (typeof u === 'string' && hasInside(u)) {
        if (USERNAME_POLICY === 'block') {
          var err = new Error('That username contains a blocked word.');
          err.code = 'DZ_BADWORD_USERNAME';
          throw err;
        }
        if (!copy) copy = shallow(row);
        copy.username = mask(u);
      }
    }
    return copy || row;
  }

  function shallow(o) {
    var c = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    return c;
  }

  function scrubPayload(table, values) {
    if (Object.prototype.toString.call(values) === '[object Array]') {
      var changed = false;
      var rows = values.map(function (r) {
        var c = scrubRow(table, r);
        if (c !== r) changed = true;
        return c;
      });
      return changed ? rows : values;
    }
    return scrubRow(table, values);
  }

  function scrubArgs(args) {
    if (!args || typeof args !== 'object') return args;
    var copy = null;
    for (var i = 0; i < RPC_ARGS.length; i++) {
      var k = RPC_ARGS[i];
      if (!Object.prototype.hasOwnProperty.call(args, k)) continue;
      var v = scrubValue(args[k]);
      if (v !== args[k]) { if (!copy) copy = shallow(args); copy[k] = v; }
    }
    return copy || args;
  }

  /* ── the choke point ──
     Wrap the client's write methods once, at creation. Reads, storage,
     auth and realtime are left completely alone. */
  function guard(client) {
    if (!client || client.__dzGuarded) return client;
    client.__dzGuarded = true;

    var origFrom = client.from.bind(client);
    client.from = function (table) {
      var qb = origFrom(table);
      ['insert', 'upsert', 'update'].forEach(function (fn) {
        if (typeof qb[fn] !== 'function') return;
        var real = qb[fn].bind(qb);
        qb[fn] = function (values, options) {
          return real(scrubPayload(table, values), options);
        };
      });
      return qb;
    };

    if (typeof client.rpc === 'function') {
      var origRpc = client.rpc.bind(client);
      client.rpc = function (fn, args, options) {
        return origRpc(fn, scrubArgs(args), options);
      };
    }
    return client;
  }

  if (window.supabase && typeof window.supabase.createClient === 'function') {
    var make = window.supabase.createClient;
    window.supabase.createClient = function () {
      return guard(make.apply(this, arguments));
    };
  } else {
    console.warn('badwords.js loaded before supabase-js — filter not installed.');
  }

  /* Public surface. dzMask() is also handy at render time if you ever
     want to clean rows that were written before this shipped. */
  window.dzMask = mask;
  window.dzHasBadWord = has;

  return {
    mask: mask, has: has, guard: guard,
    words: WORDS, strict: STRICT, anywhere: ANYWHERE, allow: ALLOW,
    fields: FIELDS,
    reload: function () { dict = null; }   /* re-read the lists after an edit */
  };
})();
