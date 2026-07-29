// community header modes
    (function () {
      'use strict';
      function $ (id) { return document.getElementById(id); }
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
      window.cmHdrHomeMode = function () {
        var hdr = $('cmHdr'); if (hdr) hdr.classList.remove('chat');
        var t = $('cmHdrTitleTxt'); if (t) t.textContent = 'COMMUNITY';
        var back = $('cmHdrBack'); if (back) back.classList.remove('show');
        var tap = $('cmHdrTap');
        if (tap) { tap.onclick = null; tap.classList.remove('on'); }
      };
    })();
