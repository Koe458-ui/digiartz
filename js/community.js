// community header modes
    (function () {
      'use strict';
      function $ (id) { return document.getElementById(id); }

      // the chat panel slides in over the community page, which stays mounted
      window.cmChatPanelOpen = function () {
        var p = $('cmChatPanel'); if (!p) return;
        p.style.paddingBottom = '';
        p.classList.add('open');
      };
      window.cmChatPanelClose = function () {
        var p = $('cmChatPanel'); if (!p) return;
        p.classList.remove('open');
        p.style.paddingBottom = ''; // drop any keyboard offset
      };
      // the whole section is leaving, so skip the slide
      window.cmChatPanelReset = function () {
        var p = $('cmChatPanel'); if (!p) return;
        p.classList.add('noAnim');
        p.classList.remove('open');
        p.style.paddingBottom = '';
        void p.offsetWidth;          // commit the closed state untransitioned
        p.classList.remove('noAnim'); // next open slides again
      };

      window.cmHdrChatMode = function (o) {
        o = o || {};
        var hdr = $('cmHdr'); if (!hdr) return;
        var img = $('cmHdrAvImg'), txt = $('cmHdrAvTxt'), av = $('cmHdrAv');
        var nm  = $('cmHdrName'), sub = $('cmHdrSub'), tap = $('cmHdrTap');

        if (av)  av.style.background = o.grad || 'linear-gradient(135deg,var(--pb),var(--pg))';
        if (img && txt) {
          if (o.avatar) {
            img.src = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(o.avatar) : o.avatar;
            img.style.display = 'block'; txt.style.display = 'none';
            // fallback to initial
            img.onerror = function () {
              img.style.display = 'none'; txt.style.display = '';
              txt.textContent = o.emoji || o.letter || '?';
            };
          } else {
            img.removeAttribute('src'); img.style.display = 'none';
            txt.style.display = ''; txt.textContent = o.emoji || o.letter || '?';
          }
        }
        if (nm)  nm.textContent = o.name || 'Chat';
        if (sub) {
          sub.innerHTML = '';
          if (o.subDot) { var d = document.createElement('span'); d.className = 'dot'; sub.appendChild(d); }
          if (o.sub) { var s = document.createElement('span'); s.textContent = o.sub; sub.appendChild(s); }
          sub.style.display = (o.sub || o.subDot) ? 'flex' : 'none';
        }
        if (tap) {
          tap.onclick = o.tap || null;
          tap.classList.toggle('on', !!o.tap);
          if (o.tap) { tap.setAttribute('role', 'button'); tap.setAttribute('tabindex', '0'); }
          else { tap.removeAttribute('role'); tap.removeAttribute('tabindex'); }
        }
        hdr.classList.add('chat');
        var back = $('cmHdrBack'); if (back) back.classList.add('show');
      };
      // the header lives in the chat panel, so leave its look alone while it
      // slides out — only the handlers need clearing
      window.cmHdrHomeMode = function () {
        var tap = $('cmHdrTap');
        if (tap) {
          tap.onclick = null;
          tap.classList.remove('on');
          tap.removeAttribute('role');
          tap.removeAttribute('tabindex');
        }
      };
    })();
