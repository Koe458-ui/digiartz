// signed-in AND entitled only: the moderation and administration panel
//
// This file exists for the reason /api/store exists, and the reasoning is
// worth repeating rather than cross-referencing.
//
// js/pfedit.js is a static asset. Cloudflare serves it to anyone who asks, the
// service worker caches it, and Googlebot reads it. The admin panel used to
// live there — seven hundred lines naming every privileged endpoint, every
// telemetry field, the partner programme, the invite flow and the ban engine.
// None of it was exploitable: every action behind it is refused by a SECURITY
// DEFINER guard in Postgres, and a member who edited their role in a console
// got a panel of buttons that all answered 403.
//
// But "not exploitable" is not the standard the rest of this system is held
// to. A signed-out visitor's page source names no payment provider and quotes
// no price. It should not describe the moderation tooling either.
//
// So the panel is served from here instead, and TWO things gate it:
//
//   1. A valid Supabase session, checked against the auth server.
//   2. A role of admin, dev or partner, checked by asking Postgres — never by
//      believing a header. An ordinary member gets a comment and no code.
//
// AND THE MODULE IS BUILT FOR THE CALLER. A partner is entitled to reports and
// moderation, so that is the whole of what they are sent: their copy contains
// no telemetry code, no partner list, no invite flow, no audit reader and no
// broadcast composer. Not hidden — absent. There is nothing in their browser
// to read, re-enable in a console, or find in a cache.
//
// Environment: SB_URL / SB_KEY. No service key: this endpoint reads a role and
// serves text, and everything the text goes on to do is guarded again.

import { sbUrl, sbAnon, sbUser } from '../lib/sb.js';

// ---------------------------------------------------------------------------
// Which tabs each role gets, and in the order they are useful. Reports leads
// for a partner because it is the only queue they act on; telemetry leads for
// staff because it is what anyone opening an admin panel looks at first.
const TABS_STAFF = [
  ['tel', 'TELEMETRY'], ['rpt', 'REPORTS'], ['mod', 'MODERATION'],
  ['prt', 'PARTNERS'], ['log', 'AUDIT'], ['noti', 'NOTIFY'],
];
const TABS_PARTNER = [['rpt', 'REPORTS'], ['mod', 'MODERATION']];

// ---------------------------------------------------------------------------
// The stylesheet travels with the module, and is split the same way the code
// is.
//
// It used to be appended to css/admin.css, which is as public as the script
// was: .admPrtAdd, .admBanGo and .admTelGrid describe the panel to anyone who
// reads the file, and moving the JavaScript while leaving its stylesheet
// behind would have been a half-move. css/admin.css is back to exactly what it
// was before any of this — the shell, the tabs and the notification composer
// it has always carried.
//
// Splitting it matters for the same reason splitting the code did. A partner
// who received the whole sheet would be holding class names for a telemetry
// grid, a partner list and an invite button — which describes the staff panel
// just as plainly as the functions would have. Telemetry first, then the two
// halves both roles need, then partners and the audit trail.
const STYLE_STAFF = `
.admTelGrp{margin-bottom:1.6rem;}
.admTelHd{margin:0 0 .6rem;font-family:var(--fm);font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--txd);}
.admTelGrid{list-style:none;margin:0;padding:0;display:grid;gap:.6rem;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));}
.admTelCell{padding:.8rem .85rem;border:1px solid var(--bdr);border-radius:10px;background:var(--sur);}
.admTelN{display:block;font-family:var(--fd);font-size:1.5rem;font-weight:800;line-height:1.1;color:var(--tx);}
.admTelL{display:block;margin-top:.2rem;font-family:var(--fm);font-size:.6rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--txd);}
.admTelToday{display:block;margin-top:.35rem;font-family:var(--fm);font-size:.6rem;font-weight:700;color:#16a34a;}
.admTelAt{margin:0;font-family:var(--fb);font-size:.76rem;line-height:1.55;color:var(--txd);}
`;

// And the half both roles get: the reports queue and the member card.
const STYLE_CORE = `
.admRptSwitch{display:flex;gap:.4rem;margin-bottom:1rem;}
.admRptTog{padding:.42rem .85rem;border:1px solid var(--bdr);border-radius:999px;background:var(--sur);color:var(--txd);font-family:var(--fm);font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;}
.admRptTog.active{border-color:var(--pg);background:var(--pdim);color:var(--pg);}
@media(hover:hover){.admRptTog:not(.active):hover{border-color:var(--bdrh);}}
.admRptCard{display:flex;flex-direction:column;gap:.35rem;}
.admRptWhy{font-family:var(--fm);font-size:.66rem;font-weight:700;letter-spacing:.08em;color:var(--danger);}
.admRptWho{font-family:var(--fd);font-size:.92rem;font-weight:700;color:var(--tx);}
.admRptBanned{font-family:var(--fm);font-size:.58rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--danger);}
.admRptDet{font-family:var(--fb);font-size:.82rem;line-height:1.5;color:var(--txd);white-space:pre-wrap;word-break:break-word;}
.admRptMeta{font-family:var(--fm);font-size:.6rem;color:var(--txd);opacity:.8;}
.admRptActs{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.3rem;}

.admModLbl{font-family:var(--fm);font-size:.68rem;font-weight:700;letter-spacing:.1em;color:var(--tx);margin-bottom:.3rem;}
.admModNote{margin:0 0 .9rem;font-family:var(--fb);font-size:.82rem;line-height:1.5;color:var(--txd);}
.admModForm{display:flex;gap:.5rem;margin-bottom:1.1rem;}
.admModIn{flex:1 1 auto;min-width:0;padding:.62rem .8rem;border:1px solid var(--bdr);border-radius:9px;background:var(--sur2);color:var(--tx);font-family:var(--fb);font-size:.86rem;}
.admModIn:focus-visible{outline:2px solid var(--pg);outline-offset:1px;}
.admModGo{flex:0 0 auto;padding:.62rem 1.1rem;border:none;border-radius:9px;background:var(--pg);color:var(--text-on-accent);font-family:var(--fm);font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;}
@media(hover:hover){.admModGo:hover{filter:brightness(1.1);}}
.admMemb{padding:1rem;border:1px solid var(--bdr);border-radius:12px;background:var(--sur);}
.admMembTop{display:flex;align-items:flex-start;gap:.8rem;flex-wrap:wrap;}
.admMembName{font-family:var(--fd);font-size:1.05rem;font-weight:800;color:var(--tx);}
.admMembSub{margin-top:.15rem;font-family:var(--fb);font-size:.8rem;color:var(--txd);}
.admMembTags{margin-left:auto;display:flex;gap:.35rem;flex-wrap:wrap;}
.admTag{padding:.2rem .5rem;border:1px solid var(--bdr);border-radius:999px;background:var(--sur2);color:var(--txd);font-family:var(--fm);font-size:.56rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.admTag--admin,.admTag--dev{border-color:var(--pg);color:var(--pg);}
.admTag--partner{border-color:#16a34a;color:#16a34a;}
.admTag--ban{border-color:var(--danger);color:var(--danger);}
.admMembId{margin-top:.6rem;font-family:var(--fm);font-size:.6rem;color:var(--txd);opacity:.7;word-break:break-all;}
.admMembBan{margin-top:.6rem;padding:.55rem .7rem;border-radius:8px;background:var(--danger-bg);color:var(--danger);font-family:var(--fb);font-size:.8rem;line-height:1.45;}
.admMembActs{margin-top:.9rem;}
.admMembNo{margin:0;font-family:var(--fb);font-size:.8rem;line-height:1.5;color:var(--txd);}
.admBanForm{display:flex;flex-direction:column;gap:.55rem;}
.admBanRow{display:flex;gap:.5rem;}
.admBanLen{flex:1 1 auto;padding:.6rem .7rem;border:1px solid var(--bdr);border-radius:9px;background:var(--sur2);color:var(--tx);font-family:var(--fb);font-size:.84rem;}
.admBanGo{flex:0 0 auto;padding:.6rem 1.3rem;border:1px solid var(--danger);border-radius:9px;background:var(--danger-bg);color:var(--danger);font-family:var(--fm);font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;}
@media(hover:hover){.admBanGo:hover{background:var(--danger-bg-hover);}}
`;

// Partners and the audit trail, staff only, continued.
const STYLE_STAFF2 = `
.admPrtTop{display:flex;align-items:center;gap:.7rem;margin-bottom:1rem;}
.admPrtLbl{font-family:var(--fm);font-size:.68rem;font-weight:700;letter-spacing:.1em;color:var(--tx);}
.admPrtAdd{margin-left:auto;width:34px;height:34px;border:1px solid var(--pg);border-radius:999px;background:var(--pdim);color:var(--pg);font-size:1.25rem;line-height:1;cursor:pointer;display:grid;place-items:center;}
@media(hover:hover){.admPrtAdd:hover{background:var(--pg);color:var(--text-on-accent);}}
.admPrtAdd:focus-visible{outline:2px solid var(--pg);outline-offset:2px;}
.admPrtList{display:flex;flex-direction:column;gap:.6rem;}
.admPrt{display:flex;align-items:center;gap:.8rem;padding:.85rem .95rem;border:1px solid var(--bdr);border-radius:10px;background:var(--sur);}
.admPrtMain{flex:1 1 auto;min-width:0;}
.admPrtName{font-family:var(--fd);font-size:.92rem;font-weight:700;color:var(--tx);}
.admPrtSub{margin-top:.2rem;font-family:var(--fm);font-size:.62rem;color:var(--txd);}
.admPrtCode{font-weight:800;letter-spacing:.14em;color:var(--pg);}
.admPrtOff{color:var(--danger);}
.admPrtMoney{margin-top:.25rem;font-family:var(--fm);font-size:.62rem;color:var(--txd);opacity:.85;}
.admPrtActs{flex:0 0 auto;}

.admLogList{display:flex;flex-direction:column;}
.admLog{padding:.7rem 0;border-bottom:1px solid var(--bdr);display:flex;flex-direction:column;gap:.2rem;}
.admLog:last-child{border-bottom:none;}
.admLogMain{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;}
.admLogWho{font-family:var(--fm);font-size:.78rem;font-weight:700;color:var(--tx);}
.admLogRole{padding:.1rem .4rem;border:1px solid var(--bdr);border-radius:999px;font-family:var(--fm);font-size:.54rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--txd);}
.admLogAct{font-family:var(--fb);font-size:.8rem;color:var(--txd);}
.admLogTgt{font-family:var(--fm);font-size:.78rem;font-weight:700;color:var(--tx);}
.admLogWhy{font-family:var(--fb);font-size:.78rem;font-style:italic;color:var(--txd);word-break:break-word;}
.admLogWhen{font-family:var(--fm);font-size:.6rem;color:var(--txd);opacity:.75;}
`;

// ---------------------------------------------------------------------------
// The module: the head, then whichever panels the caller is entitled to, then
// the boot line. Everything lives in one IIFE over an injected config object,
// so nothing here reaches window except the two handles the rest of the app
// genuinely needs — and both of those are closers, not openers.
//
// Written with no backticks and no ${ } below, the same discipline
// functions/api/store.js keeps, so this reads as ordinary JavaScript rather
// than an escaping puzzle.
const HEAD = `
(function(C){
  'use strict';

  var TABS = C.tabs;
  var PANELS = {};          // filled in below by whatever was spliced in
  var tab = TABS[0][0];

  function esc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function toast(m){ if(typeof showToast==='function') showToast(m); }

  // Amounts are stored in each currency's smallest unit, and a zero-decimal
  // currency's smallest unit IS its major unit — 100 JPY is stored as 100, not
  // 10000. The partner list used to print the raw figure with "(minor units)"
  // beside it, which is a number nobody reads as money: 7250 for what the
  // partner's own hub, three taps away, calls $72.50.
  var ZERO_DEC = { JPY:1, HUF:1, TWD:1 };
  function money(minor, cur){
    var n = Number(minor) || 0;
    var v = ZERO_DEC[cur] ? n : n / 100;
    try {
      return new Intl.NumberFormat(undefined, { style:'currency', currency:cur,
        minimumFractionDigits: ZERO_DEC[cur] ? 0 : 2 }).format(v);
    } catch(e) {
      return cur + ' ' + v.toFixed(ZERO_DEC[cur] ? 0 : 2);
    }
  }

  function style(){
    if(document.getElementById('dzOpsCss')) return;
    var s = document.createElement('style');
    s.id = 'dzOpsCss';
    s.textContent = C.css;
    document.head.appendChild(s);
  }

  // Everything privileged goes through /api/collab, which asks Postgres who
  // the caller is on every single call. Nothing this module decides is
  // trusted by anything on the other side of it.
  function api(action, body){
    if(typeof sb === 'undefined' || !sb) return Promise.reject(new Error('Not signed in'));
    return sb.auth.getSession().then(function(s){
      var session = s && s.data && s.data.session;
      if(!session) throw new Error('Not signed in');
      return fetch('/api/collab', {
        method:'POST',
        headers:{'content-type':'application/json',
                 authorization:'Bearer ' + session.access_token},
        cache:'no-store',
        body:JSON.stringify(Object.assign({action:action}, body || {}))
      });
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(j){
        if(!res.ok) throw new Error((j && j.error) || 'That did not work');
        return j;
      });
    });
  }

  function btn(text, fn){
    var b = document.createElement('button');
    b.className = 'rptBtn';
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  // ---- the shell ----------------------------------------------------------
  // index.html carries an empty div and nothing else; this writes the inside
  // of it. No inline onclick anywhere — every handler is attached here, so the
  // panel exposes no function names to the page it is drawn into.
  function build(el){
    if(el.firstElementChild) return;
    style();
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal','true');
    el.setAttribute('aria-label', C.title);

    el.innerHTML =
      '<div class="subPgHdr">' +
        '<button class="subPgX" type="button" aria-label="Close">\\u2190</button>' +
        '<div class="subPgTitle">' + esc(C.title.toUpperCase()) + '</div>' +
      '</div>' +
      '<div class="admBdy">' +
        '<div class="pfTabs" role="tablist"><div class="pfTabGroup">' +
          TABS.map(function(t, i){
            return '<button class="pfTab' + (i===0?' active':'') +
              '" data-t="' + esc(t[0]) + '" role="tab" aria-selected="' +
              (i===0?'true':'false') + '">' + esc(t[1]) +
              (t[0]==='rpt' ? '<span class="admTabCount" hidden>0</span>' : '') +
            '</button>';
          }).join('') +
        '</div></div>' +
        TABS.map(function(t, i){
          return '<div class="pfPanel' + (i===0?' active':'') +
                 '" data-p="' + esc(t[0]) + '">' +
                 (PANELS[t[0]] && PANELS[t[0]].html ? PANELS[t[0]].html() : '') +
                 '</div>';
        }).join('') +
      '</div>';

    el.querySelector('.subPgX').addEventListener('click', close);
    Array.prototype.forEach.call(el.querySelectorAll('.pfTab'), function(b){
      b.addEventListener('click', function(){ switchTo(b.getAttribute('data-t')); });
    });
    TABS.forEach(function(t){
      var p = PANELS[t[0]];
      if(p && p.wire) p.wire(el.querySelector('[data-p="' + t[0] + '"]'));
    });
  }

  function open(){
    var el = document.getElementById('admPage');
    if(!el) return;
    build(el);
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    load(tab);
    loadReports();                       // the tab badge, whichever tab is up
  }

  function close(){
    var el = document.getElementById('admPage');
    if(!el) return;
    el.classList.remove('open');
    if(typeof restoreScroll === 'function') restoreScroll();
    else document.body.style.overflow = '';
  }

  function switchTo(t){
    tab = t;
    var el = document.getElementById('admPage');
    if(!el) return;
    Array.prototype.forEach.call(el.querySelectorAll('.pfTab'), function(b){
      var on = b.getAttribute('data-t') === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(el.querySelectorAll('.pfPanel'), function(p){
      p.classList.toggle('active', p.getAttribute('data-p') === t);
    });
    load(t);
  }

  function load(t){
    var p = PANELS[t];
    if(p && p.load) p.load();
  }

  function panelEl(name){
    var el = document.getElementById('admPage');
    return el ? el.querySelector('[data-p="' + name + '"]') : null;
  }

  // ---- reports ------------------------------------------------------------
  var RPT_LABELS = {
    copyright:'Copyright infringement', ai_undisclosed:'AI-generated without disclosure',
    nudity:'Nudity / Sexual content', violence:'Violence / Gore',
    hate:'Hate speech / Harassment', spam:'Spam / Advertising',
    misinformation:'Misinformation', impersonation:'Impersonation',
    illegal:'Illegal content', offtopic:'Off-topic / Wrong category',
    lowquality:'Low-quality / Broken upload', other:'Other',
    dmca:'DMCA / Copyright', harassment:'Harassment', fraud:'Fraud'
  };
  var rptWhich = 'user';

  PANELS.rpt = {
    html: function(){
      return '<div class="admRptSwitch" role="group" aria-label="Which reports">' +
          '<button type="button" class="admRptTog active" data-q="user">Accounts</button>' +
          '<button type="button" class="admRptTog" data-q="item">Uploads</button>' +
        '</div>' +
        '<div class="pfGrid" data-r="list"></div>' +
        '<div class="pfEmpty" data-r="empty" hidden>' +
          '<span class="admEmptyIcon">\\u2713</span>No open reports.</div>';
    },
    wire: function(host){
      Array.prototype.forEach.call(host.querySelectorAll('.admRptTog'), function(b){
        b.addEventListener('click', function(){
          rptWhich = b.getAttribute('data-q');
          Array.prototype.forEach.call(host.querySelectorAll('.admRptTog'), function(x){
            x.classList.toggle('active', x.getAttribute('data-q') === rptWhich);
          });
          loadReports();
        });
      });
    },
    load: function(){ loadReports(); }
  };

  function rptParts(){
    var host = panelEl('rpt');
    if(!host) return null;
    return { host:host,
             list: host.querySelector('[data-r="list"]'),
             empty: host.querySelector('[data-r="empty"]') };
  }

  function rptCount(n){
    var el = document.getElementById('admPage');
    var b = el && el.querySelector('.admTabCount');
    if(!b) return;
    b.textContent = n;
    b.hidden = !n;
  }

  function rptEmpty(p, msg){
    p.list.innerHTML = '';
    p.empty.hidden = false;
    if(msg) p.empty.textContent = msg;
    else p.empty.innerHTML = '<span class="admEmptyIcon">\\u2713</span>No open reports.';
  }

  function loadReports(){
    return rptWhich === 'item' ? loadItemReports() : loadUserReports();
  }

  // Accounts. The queue a partner is here for, and the one the ban engine
  // acts on. dz_reports_queue already narrows a partner's rows to the accounts
  // they may act on, so nothing is filtered here.
  function loadUserReports(){
    var p = rptParts();
    if(!p) return;
    api('reports', {status:'pending'}).then(function(r){
      var rows = (r && r.reports) || [];
      rptCount(rows.length);
      if(!rows.length) return rptEmpty(p);
      p.empty.hidden = true;
      p.list.innerHTML = '';
      rows.forEach(function(rep){
        var card = document.createElement('div');
        card.className = 'pfCard admRptCard';
        card.innerHTML =
          '<div class="admRptWhy">\\ud83d\\udea9 ' +
            esc(RPT_LABELS[rep.reason] || rep.reason) + '</div>' +
          '<div class="admRptWho">@' + esc(rep.target_username || 'unknown') +
            (rep.target_banned ? ' <span class="admRptBanned">banned</span>' : '') + '</div>' +
          (rep.details ? '<div class="admRptDet"></div>' : '') +
          '<div class="admRptMeta">by @' + esc(rep.reporter_username || 'someone') +
            ' \\u00b7 ' + esc(rep.created_at ? new Date(rep.created_at).toLocaleString() : '') +
          '</div><div class="admRptActs"></div>';
        // The reporter's own words. The one field on this card somebody else
        // typed, so it goes in as text.
        if(rep.details) card.querySelector('.admRptDet').textContent = rep.details;

        var acts = card.querySelector('.admRptActs');
        acts.appendChild(btn('REVIEW', function(){
          switchTo('mod');
          modSearch(rep.target_id, true);
        }));
        acts.appendChild(btn('RESOLVE', function(){ resolveUser(rep.id, 'resolved'); }));
        acts.appendChild(btn('DISMISS', function(){ resolveUser(rep.id, 'dismissed'); }));
        p.list.appendChild(card);
      });
    }, function(err){ rptEmpty(p, err.message); });
  }

  function resolveUser(id, status){
    api('report-resolve', {id:id, status:status}).then(function(){
      toast(status === 'resolved' ? 'Report resolved' : 'Report dismissed');
      loadReports();
    }, function(e){ toast(e.message || 'Action failed'); });
  }

  // Uploads. The queue that predates all of this, reading the same table it
  // always did — artwork_reports is governed by its own policy and needs no
  // endpoint of its own.
  function loadItemReports(){
    var p = rptParts();
    if(!p || typeof sb === 'undefined' || !sb) return;
    sb.from('artwork_reports')
      .select('id,artwork_id,reason,details,created_at,reporter_id,artworks(name,image_url,user_id)')
      .eq('status','open').order('created_at',{ascending:false}).limit(100)
      .then(function(r){
        if(r.error){ rptEmpty(p, 'Could not load reports.'); return; }
        var rows = r.data || [];
        if(!rows.length) return rptEmpty(p);
        p.empty.hidden = true;
        p.list.innerHTML = '';
        rows.forEach(function(rep){
          var art = rep.artworks || {};
          var card = document.createElement('div');
          card.className = 'pfCard admRptCard';
          card.innerHTML =
            '<div class="admRptWhy">\\ud83d\\udea9 ' +
              esc(RPT_LABELS[rep.reason] || rep.reason) + '</div>' +
            '<div class="admRptWho"></div>' +
            (rep.details ? '<div class="admRptDet"></div>' : '') +
            '<div class="admRptMeta">' +
              esc(rep.created_at ? new Date(rep.created_at).toLocaleString() : '') +
            '</div><div class="admRptActs"></div>';
          card.querySelector('.admRptWho').textContent = art.name || '(untitled artwork)';
          if(rep.details) card.querySelector('.admRptDet').textContent = rep.details;

          var acts = card.querySelector('.admRptActs');
          acts.appendChild(btn('VIEW', function(){
            if(typeof openArtworkById === 'function') openArtworkById(String(rep.artwork_id), false);
          }));
          acts.appendChild(btn('RESOLVE', function(){ resolveItem(rep.id, 'resolved'); }));
          acts.appendChild(btn('DISMISS', function(){ resolveItem(rep.id, 'dismissed'); }));
          p.list.appendChild(card);
        });
      }, function(){ rptEmpty(p, 'Could not load reports.'); });
  }

  function resolveItem(id, status){
    sb.from('artwork_reports').update({status:status}).eq('id', id).then(function(r){
      if(r.error){ toast('Action failed \\u2014 try again'); return; }
      toast(status === 'resolved' ? 'Report resolved' : 'Report dismissed');
      loadReports();
    }, function(){ toast('Action failed \\u2014 try again'); });
  }

  // ---- moderation ---------------------------------------------------------
  //
  // One member at a time, found exactly. dz_mod_find refuses a prefix, so this
  // cannot be walked to enumerate accounts, and it withholds role and email
  // from a partner so it cannot be used to work out who the other partners
  // are. The reply carries can_moderate, computed by Postgres for THIS
  // moderator against THIS target, so the buttons drawn are the ones that will
  // work.
  PANELS.mod = {
    html: function(){
      return '<div class="admModLbl">FIND A MEMBER</div>' +
        '<p class="admModNote">Search by username, email address or user ID. ' +
          'It has to be exact \\u2014 this does not list members, it finds one.</p>' +
        '<form class="admModForm" data-m="form">' +
          '<input type="text" data-m="q" class="admModIn" autocomplete="off" ' +
            'spellcheck="false" placeholder="@handle, email, or ID" ' +
            'aria-label="Username, email address or user ID">' +
          '<button type="submit" class="admModGo">Find</button>' +
        '</form>' +
        '<div data-m="result"></div>';
    },
    wire: function(host){
      host.querySelector('[data-m="form"]').addEventListener('submit', function(e){
        e.preventDefault();
        modSearch(host.querySelector('[data-m="q"]').value);
      });
    }
  };

  function modSearch(query, fill){
    var host = panelEl('mod');
    if(!host) return;
    var out = host.querySelector('[data-m="result"]');
    if(fill) host.querySelector('[data-m="q"]').value = query;
    var q = String(query || '').trim();
    if(q.length < 2){ out.innerHTML = '<div class="pfEmpty">Type a little more.</div>'; return; }
    out.innerHTML = '<div class="pfEmpty">Looking\\u2026</div>';

    api('mod-find', {query:q}).then(function(r){
      var u = r && r.user;
      if(!u){ out.innerHTML = '<div class="pfEmpty">No member matches that exactly.</div>'; return; }
      renderMember(out, u);
    }, function(err){
      out.innerHTML = '<div class="pfEmpty">' + esc(err.message) + '</div>';
    });
  }

  // role and email come back null for a partner, and neither is invented here:
  // the role chip is drawn only when there is a role to draw. Labelling a
  // withheld role 'member' would have shown a partner a badge saying the
  // opposite of the truth, and then refused them when they acted on it.
  function renderMember(out, u){
    out.innerHTML =
      '<div class="admMemb">' +
        '<div class="admMembTop">' +
          '<div>' +
            '<div class="admMembName">@' + esc(u.username || '\\u2014') + '</div>' +
            (u.email ? '<div class="admMembSub">' + esc(u.email) + '</div>' : '') +
          '</div>' +
          '<div class="admMembTags">' +
            (u.role ? '<span class="admTag admTag--' + esc(u.role) + '">' +
                      esc(u.role) + '</span>' : '') +
            '<span class="admTag">' + esc(u.tier || 'guest') + '</span>' +
            (u.banned ? '<span class="admTag admTag--ban">banned</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="admMembId">' + esc(u.id) + '</div>' +
        (u.banned && u.ban_reason
          ? '<div class="admMembBan">Banned for ' + esc(u.ban_reason) +
            (u.ban_expires_at
              ? ' until ' + esc(new Date(u.ban_expires_at).toLocaleDateString())
              : ' \\u2014 no end date') + '</div>'
          : '') +
        '<div class="admMembActs"></div>' +
      '</div>';

    var acts = out.querySelector('.admMembActs');

    // Postgres has already answered whether this moderator may touch this
    // member. Where it says no, the reason is a sentence rather than a button
    // that would answer 403.
    if(!u.can_moderate){
      var no = document.createElement('p');
      no.className = 'admMembNo';
      no.textContent = C.staff
        ? 'Staff accounts cannot be banned from here.'
        : 'You can moderate ordinary members. Admins, devs and other partners ' +
          'are outside what this account may do.';
      acts.appendChild(no);
      return;
    }

    if(u.banned){
      acts.appendChild(btn('LIFT BAN', function(){
        api('unban', {userId:u.id}).then(function(){
          toast('Ban lifted');
          modSearch(u.id, true);
          loadReports();
        }, function(e){ toast(e.message || 'Could not lift that ban'); });
      }));
      return;
    }

    var form = document.createElement('div');
    form.className = 'admBanForm';
    form.innerHTML =
      '<input type="text" data-b="why" class="admModIn" maxlength="60" ' +
        'placeholder="Reason (shown in the audit log)" aria-label="Reason for the ban">' +
      '<div class="admBanRow">' +
        '<select data-b="len" class="admBanLen" aria-label="How long">' +
          '<option value="">Permanent</option>' +
          '<option value="1">1 day</option>' +
          '<option value="7">7 days</option>' +
          '<option value="30">30 days</option>' +
          '<option value="90">90 days</option>' +
        '</select>' +
        '<button type="button" data-b="go" class="admBanGo">Ban</button>' +
      '</div>';
    acts.appendChild(form);

    form.querySelector('[data-b="go"]').addEventListener('click', function(){
      var why = String(form.querySelector('[data-b="why"]').value || '').trim();
      if(why.length < 2){ toast('Give a reason'); return; }
      var days = form.querySelector('[data-b="len"]').value;
      api('ban', {userId:u.id, reason:why, days:days ? Number(days) : null})
        .then(function(){
          toast('@' + (u.username || 'member') + ' banned');
          modSearch(u.id, true);
          loadReports();
        }, function(e){ toast(e.message || 'Could not ban that account'); });
    });
  }
`;

// ---------------------------------------------------------------------------
// STAFF-ONLY PANELS.
//
// Spliced into the module only when the caller is admin or dev. A partner's
// copy does not contain these strings at all — not commented out, not behind a
// flag, not present. There is nothing in their browser to find in a cache, read
// in a console, or re-enable by flipping a variable.
const PANEL_TEL = `
  // ---- telemetry ----------------------------------------------------------
  //
  // One call. Nine separate fetches would show a submission count from one
  // second beside an active-user count from another, and somebody eventually
  // reconciles the two and finds a bug that is not there.
  PANELS.tel = {
    html: function(){ return '<div data-tel="host"></div>'; },
    load: function(){
      var host = panelEl('tel');
      if(!host) return;
      host = host.querySelector('[data-tel="host"]');

      api('telemetry', {}).then(function(r){
        var t = r && r.telemetry;
        if(!t){ host.innerHTML = '<div class="pfEmpty">Could not read telemetry.</div>'; return; }
        var c = t.content || {}, day = c.today || {}, s = t.subscriptions || {},
            e = t.engagement || {}, d = t.devices || {}, m = t.moderation || {};

        host.innerHTML =
          group('Live submissions', [
            stat('Artworks', c.artworks, day.artworks),
            stat('Resources', c.resources, day.resources),
            stat('Marketplace', c.marketplace, day.marketplace),
            stat('Blogs', c.blogs, day.blogs),
            stat('Jobs', c.jobs, day.jobs),
            stat('Communities', c.communities, null)
          ]) +
          group('Subscriptions, live', [
            stat('Lite', s.lite), stat('Premium', s.premium), stat('Max', s.max),
            stat('Free', s.free), stat('Partners', s.partners), stat('Members', s.total)
          ]) +
          group('Engagement', [
            stat('DAU', e.dau), stat('MAU', e.mau),
            stat('Signed-in DAU', e.dau_signed_in),
            stat('Events, 24h', e.events_24h),
            stat('New members, 24h', e.new_members_24h)
          ]) +
          group('Devices, 24h', Object.keys(d).sort().map(function(k){
            return stat(k.charAt(0).toUpperCase() + k.slice(1), d[k]);
          })) +
          group('Moderation', [
            stat('Open account reports', m.open_user_reports),
            stat('Open upload reports', m.open_item_reports),
            stat('Active bans', m.active_bans)
          ]) +
          '<p class="admTelAt">Read at ' +
            esc(t.at ? new Date(t.at).toLocaleTimeString() : '') +
            '. Subscription counts are live \\u2014 a lapsed plan is not counted ' +
            'as active. Device and engagement figures cover recorded activity only.</p>';
      }, function(err){
        host.innerHTML = '<div class="pfEmpty">' + esc(err.message) + '</div>';
      });
    }
  };

  function group(title, cells){
    var body = cells.filter(Boolean).join('');
    if(!body) return '';
    return '<section class="admTelGrp"><h3 class="admTelHd">' + esc(title) + '</h3>' +
           '<ul class="admTelGrid">' + body + '</ul></section>';
  }

  // A zero is drawn as a zero rather than hidden: "0 today" is information,
  // where a missing line is ambiguous between none and not measured.
  function stat(label, n, today){
    return '<li class="admTelCell">' +
      '<span class="admTelN">' + esc(Number(n) || 0) + '</span>' +
      '<span class="admTelL">' + esc(label) + '</span>' +
      (today == null ? '' :
        '<span class="admTelToday">+' + esc(Number(today) || 0) + ' today</span>') +
    '</li>';
  }
`;

const PANEL_PRT = `
  // ---- partners -----------------------------------------------------------
  PANELS.prt = {
    html: function(){
      return '<div class="admPrtTop">' +
          '<div class="admPrtLbl">PARTNERS</div>' +
          '<button type="button" class="admPrtAdd" data-prt="add" ' +
            'aria-label="Add a partner">+</button>' +
        '</div>' +
        '<div data-prt="list" class="admPrtList"></div>' +
        '<div class="pfEmpty" data-prt="empty" hidden>' +
          '<span class="admEmptyIcon">\\ud83e\\udd1d</span>' +
          'No partners yet. Use + to invite one.</div>';
    },
    wire: function(host){
      host.querySelector('[data-prt="add"]').addEventListener('click', invite);
    },
    load: function(){
      var host = panelEl('prt');
      if(!host) return;
      var list = host.querySelector('[data-prt="list"]');
      var empty = host.querySelector('[data-prt="empty"]');

      api('partners', {}).then(function(r){
        var rows = (r && r.partners) || [];
        list.innerHTML = '';
        if(!rows.length){ empty.hidden = false; return; }
        empty.hidden = true;

        rows.forEach(function(p){
          // Every partner's earnings, unblurred, because this is the staff
          // view — the isolation rule is about what one PARTNER sees of
          // another, and dz_admin_partners refuses anyone who is not staff.
          var earned = p.earned_json || {};
          var earnedTxt = Object.keys(earned).map(function(c){
            return esc(money(earned[c], c));
          }).join(' \\u00b7 ');

          var row = document.createElement('div');
          row.className = 'admPrt';
          row.innerHTML =
            '<div class="admPrtMain">' +
              '<div class="admPrtName">@' + esc(p.username || '\\u2014') + '</div>' +
              '<div class="admPrtSub">' +
                (p.code
                  ? '<span class="admPrtCode">' + esc(p.code) + '</span>' +
                    (p.code_active ? '' : ' <span class="admPrtOff">inactive</span>') +
                    ' \\u00b7 ' + esc(p.usage_count || 0) + ' uses'
                  : 'No code yet') +
                (p.max_claimed ? ' \\u00b7 Max claimed' : '') +
              '</div>' +
              (earnedTxt ? '<div class="admPrtMoney">' + earnedTxt +
                           ' earned</div>' : '') +
            '</div><div class="admPrtActs"></div>';

          row.querySelector('.admPrtActs').appendChild(btn('REVOKE', function(){
            if(!confirm('Remove partner status from @' + (p.username || 'this member') +
                        '? Their code stops taking new orders. Anything already ' +
                        'earned stays theirs.')) return;
            api('revoke-partner', {userId:p.partner_id}).then(function(){
              toast('Partner removed');
              PANELS.prt.load();
            }, function(e){ toast(e.message || 'Could not remove that partner'); });
          }));
          list.appendChild(row);
        });
      }, function(err){
        list.innerHTML = '';
        empty.hidden = false;
        empty.textContent = err.message;
      });
    }
  };

  // An email address, because that is what an admin has to hand: they are
  // inviting somebody they have spoken to, not somebody they found in a list.
  // An unregistered address is refused rather than held as a pending
  // invitation, so no state can hand the role to whoever signs up with that
  // address later.
  function invite(){
    var email = prompt('Email address of the member to make a partner:', '');
    if(email === null) return;
    email = String(email).trim();
    if(!email) return;
    api('add-partner', {email:email}).then(function(r){
      toast(r && r.changed
        ? '@' + (r.username || 'they') + ' is now a partner'
        : 'That member was already a partner');
      PANELS.prt.load();
    }, function(e){ toast(e.message || 'Could not add that partner'); });
  }
`;

const PANEL_LOG = `
  // ---- the audit trail ----------------------------------------------------
  //
  // The actor's role is shown from the row rather than looked up now, because
  // that is how it was recorded: a partner demoted since must not make the ban
  // they placed look like a member placed it.
  var VERB = {
    ban_user:'banned', unban_user:'lifted the ban on',
    grant_partner:'made a partner', revoke_partner:'removed as a partner',
    create_promo:'created a promo code', claim_max:'claimed Max',
    resolve_report:'resolved a report about'
  };

  PANELS.log = {
    html: function(){
      return '<div class="admModLbl">WHO DID WHAT</div>' +
        '<p class="admModNote">Every privileged action on this platform, newest ' +
          'first. Append-only \\u2014 nothing here can be edited or deleted, by ' +
          'anyone.</p>' +
        '<div data-log="list" class="admLogList"></div>' +
        '<div class="pfEmpty" data-log="empty" hidden>' +
          '<span class="admEmptyIcon">\\ud83d\\udccb</span>Nothing logged yet.</div>';
    },
    load: function(){
      var host = panelEl('log');
      if(!host) return;
      var list = host.querySelector('[data-log="list"]');
      var empty = host.querySelector('[data-log="empty"]');

      api('audit', {limit:100}).then(function(r){
        var rows = (r && r.entries) || [];
        list.innerHTML = '';
        if(!rows.length){ empty.hidden = false; return; }
        empty.hidden = true;

        rows.forEach(function(e){
          var row = document.createElement('div');
          row.className = 'admLog';
          var who  = e.actor_username ? '@' + e.actor_username : 'someone';
          var whom = e.target_username ? '@' + e.target_username : '';
          // The reason a moderator typed is the one field here somebody else
          // wrote, so it goes in as text rather than as markup.
          var why = (e.metadata && e.metadata.reason) ? String(e.metadata.reason) : '';

          row.innerHTML =
            '<div class="admLogMain">' +
              '<span class="admLogWho">' + esc(who) + '</span>' +
              '<span class="admLogRole">' + esc(e.actor_role || 'member') + '</span>' +
              '<span class="admLogAct">' + esc(VERB[e.action] || e.action) + '</span>' +
              (whom ? '<span class="admLogTgt">' + esc(whom) + '</span>' : '') +
            '</div>' +
            (why ? '<div class="admLogWhy"></div>' : '') +
            '<div class="admLogWhen">' +
              esc(e.created_at ? new Date(e.created_at).toLocaleString() : '') +
            '</div>';
          if(why) row.querySelector('.admLogWhy').textContent = '\\u201c' + why + '\\u201d';
          list.appendChild(row);
        });
      }, function(err){
        list.innerHTML = '';
        empty.hidden = false;
        empty.textContent = err.message;
      });
    }
  };
`;

const PANEL_NOTI = `
  // ---- the broadcast composer ---------------------------------------------
  //
  // Posts through /api/collab rather than straight at the notifications table.
  // A row with a null user_id is a row every member reads, so who may write one
  // is not a question to leave to whichever policy happens to be on that table:
  // the endpoint asks Postgres whether the caller is staff and only then picks
  // up the service role.
  PANELS.noti = {
    html: function(){
      return '<div class="admNotiLbl">SEND NOTIFICATION TO ALL USERS</div>' +
        '<div class="admNotiCompose">' +
          '<input type="text" data-n="title" class="admNotiInput" placeholder="Title" maxlength="80">' +
          '<textarea data-n="msg" class="admNotiTextarea" placeholder="Message" maxlength="500" rows="3"></textarea>' +
          '<button class="admNotiSendBtn" data-n="send">Send to All Users</button>' +
        '</div>' +
        '<div class="admNotiSentLbl">RECENTLY SENT</div>' +
        '<div class="pfEmpty" data-n="empty" hidden>' +
          '<span class="admEmptyIcon">\\ud83d\\udd14</span>No notifications sent yet.</div>' +
        '<div data-n="list" class="admNotiSentList"></div>';
    },
    wire: function(host){
      host.querySelector('[data-n="send"]').addEventListener('click', function(){
        send(host);
      });
    },
    load: function(){
      var host = panelEl('noti');
      if(!host || typeof sb === 'undefined' || !sb) return;
      var wrap = host.querySelector('[data-n="list"]');
      var empty = host.querySelector('[data-n="empty"]');
      sb.from('notifications').select('*').is('user_id', null)
        .order('created_at',{ascending:false}).limit(20)
        .then(function(r){
          if(r.error) return;
          var rows = r.data || [];
          wrap.innerHTML = rows.map(function(x){
            return '<div class="admNotiSentItem">' +
              '<div class="admNotiSentTitle">' + esc(x.title) + '</div>' +
              '<div class="admNotiSentMsg">' + esc(x.message) + '</div>' +
              '<div class="admNotiSentTime">' +
                esc(x.created_at ? new Date(x.created_at).toLocaleString() : '') +
              '</div></div>';
          }).join('');
          empty.hidden = !!rows.length;
        }, function(){});
    }
  };

  function send(host){
    var t = host.querySelector('[data-n="title"]');
    var m = host.querySelector('[data-n="msg"]');
    var b = host.querySelector('[data-n="send"]');
    var title = (t.value || '').trim(), message = (m.value || '').trim();
    if(!title || !message){ toast('Enter a title and message'); return; }
    b.disabled = true;
    api('broadcast', {title:title, message:message}).then(function(){
      t.value = ''; m.value = '';
      toast('Notification sent to all users');
      b.disabled = false;
      PANELS.noti.load();
    }, function(e){
      b.disabled = false;
      toast(e.message || 'Could not send that');
    });
  }
`;

// ---------------------------------------------------------------------------
// The boot line, and the only two names this module puts on window.
//
// Both are closers. There is no window.openAdmPage: the menu entry this module
// builds holds the opener in a closure, so the panel cannot be opened by name
// from a console — not that opening it would show anything, since every panel
// fetches its contents through a guard.
const FOOT = `
  // The Settings entry, built here rather than in index.html, so the menu of
  // an account without the role carries no trace of it. Same slot the static
  // page leaves empty, same setGo the items written above it use, so closing
  // the panel returns to the menu rather than to a profile.
  function menu(){
    var gate = document.getElementById('setAdmGate');
    if(!gate) return;
    // Replaced, not skipped. Switching accounts in one tab injects a second
    // copy of this module built for the new role, and an early return here
    // would have left the previous account's entry — and its closure — in
    // place, so a partner could land on a menu row built for an admin.
    var old = gate.querySelector('#smAdmBtn');
    if(old) old.parentNode.removeChild(old);
    var b = document.createElement('button');
    b.id = 'smAdmBtn';
    b.type = 'button';
    b.className = 'pfMenuItem';
    b.textContent = C.menu;
    b.addEventListener('click', function(){
      if(typeof closeMenu === 'function') closeMenu();
      if(typeof setGo === 'function') setGo(open, 'admPage');
      else open();
    });
    gate.appendChild(b);
  }

  // Closing and resetting only. js/auth.js shuts this panel on sign-out and
  // the global escape handler shuts it with everything else; neither needs to
  // be able to OPEN it, so neither is given the means. There is no
  // window.openAdmPage: the menu entry holds the opener in a closure, so the
  // panel cannot be opened by name from a console.
  //
  // reset empties the shell as well as closing it. build() returns early when
  // the shell already has content, so without this a panel built for one
  // account would still be standing when a different one signed in, and the
  // incoming module would decline to redraw it.
  function reset(){
    close();
    var el = document.getElementById('admPage');
    if(el){ el.innerHTML = ''; }
    var gate = document.getElementById('setAdmGate');
    var b = gate && gate.querySelector('#smAdmBtn');
    if(b) b.parentNode.removeChild(b);
  }

  window.dzOpsClose = close;
  window.dzOpsReset = reset;
  window.dzOpsMenu = menu;
  menu();
})(__dzOps);
`;

// ---------------------------------------------------------------------------
// Supabase environment names. Two spellings are in use across this project and
// both are accepted; see the same note in functions/api/payouts.js.

// Asked of Postgres, as the caller. Never read from a header, a query string
// or anything else the browser is in a position to write.
async function roleOf(env, request) {
  const res = await fetch(sbUrl(env) + '/rest/v1/rpc/dz_my_collab_state', {
    method: 'POST',
    headers: {
      apikey: sbAnon(env),
      authorization: request.headers.get('authorization') || '',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function onRequestGet({ env, request }) {
  // Every refusal looks the same from outside: a JavaScript comment, no-store,
  // noindex. An ordinary member cannot tell "you are not entitled to this" from
  // "there is nothing here", which is the point of serving it this way at all.
  const deny = (s) =>
    new Response(s === 401 ? '/* sign in required */' : '/* unavailable */', {
      status: s,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store, private, max-age=0',
        'x-robots-tag': 'noindex, nofollow',
      },
    });

  if (!sbUrl(env) || !sbAnon(env)) return deny(503);

  const user = await sbUser(env, request);
  if (!user) return deny(401);

  const state = await roleOf(env, request);
  if (!state) return deny(503);

  const staff = !!state.is_staff;
  const partner = !!state.is_partner;
  // 404, not 403. A member who is neither gets the same answer they would get
  // for an endpoint that does not exist.
  if (!staff && !partner) return deny(404);

  const cfg = {
    staff,
    tabs: staff ? TABS_STAFF : TABS_PARTNER,
    // A partner opens something called MODERATION, not something called ADMIN
    // PANEL with most of it missing.
    title: staff ? 'Admin panel' : 'Moderation',
    menu: staff ? '⚙ ADMIN PANEL' : '🛡 MODERATION',
    css: STYLE_CORE + (staff ? STYLE_STAFF + STYLE_STAFF2 : ''),
  };

  // The staff panels are concatenated in only for staff. This is the line that
  // makes the difference real rather than cosmetic: a partner's response body
  // does not contain the telemetry, partner-management, audit or broadcast
  // code in any form.
  const body =
    'var __dzOps = ' + JSON.stringify(cfg) + ';\n' +
    HEAD +
    (staff ? PANEL_TEL + PANEL_PRT + PANEL_LOG + PANEL_NOTI : '') +
    FOOT;

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
