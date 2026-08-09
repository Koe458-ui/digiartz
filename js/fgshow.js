// gallery featured showcase
  /* Six cards above the gallery's chip row, paired off across the three
     boards the site already scores: daily, weekly, monthly. Each pair is one
     artist and one artwork — the same two things the hero page's featured
     banner promotes, split into two cards so the gallery can show all three
     boards at once.

     Nothing here fetches artwork. `images` is already in hand from the home
     load and the boards are only reorderings of it, so the whole section is
     computed locally; the one request it can make is the profiles behind the
     cards, and that goes through dzArtistCache, which the hover chips and the
     hero's artist board have usually paid for already. */

  // Board per row, in reading order. `sort` is the same scorer the hero page
  // reads, so a card here and a card there never disagree about who is first.
  var FGS_ROWS = [
    { id:'daily',   word:'Daily',   art:'Artwork of the Day',   sort:function(l){ return sortByTrending(l); } },
    { id:'weekly',  word:'Weekly',  art:'Artwork of the Week',  sort:function(l){ return sortByWeekly(l);   } },
    { id:'monthly', word:'Monthly', art:'Artwork of the Month', sort:function(l){ return sortByMonthly(l);  } }
  ];

  var fgsSlots   = [];     // what is on screen, in order
  var fgsBuilt   = false;  // the track has been painted at least once
  var fgsRetry   = 0;      // waits left for the artwork load to land

  function fgsMotionOk(){
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function fgsFmt(n){
    return (typeof pfFmtCount === 'function') ? pfFmtCount(n) : String(+n || 0);
  }

  /* The six picks.

     Every card is an artwork and every card says the same six things about
     it — the picture, the title, who made it, a line or two of its
     description, its likes and its views, and a button that opens it. Only
     the chip differs, and it says which of the two slots in the pair this
     one took.

     The board leader takes the second slot plainly: it is that board's first
     place. The spotlight beside it is the best-placed piece by an artist who
     is NOT the one who just took the leader slot — otherwise a pair would be
     one person printed twice, side by side, which reads as a bug rather than
     a showcase.

     Picks are kept apart down the column too: on a quiet site the three
     boards can all lead with the same upload, and six cards showing one
     artwork is worse than five cards showing six. Anything already used is
     skipped, and a slot that cannot be filled without repeating is dropped —
     a small site gets a short row, not a padded one. */
  function fgsPick(){
    var all = (typeof filterHidden === 'function')
      ? filterHidden((typeof images !== 'undefined' ? images : []))
      : (typeof images !== 'undefined' ? images.slice() : []);
    if(!all.length) return [];

    var usedArt = {}, usedArtist = {}, out = [];

    function slot(a, row, kind){
      usedArt[a.id] = 1;
      if(a.user_id) usedArtist[a.user_id] = 1;
      return {
        row:row, art:a, kind:kind,
        uid:a.user_id ? String(a.user_id) : '',
        likes:+a.like_count || 0, views:+a.view_count || 0
      };
    }

    for(var r = 0; r < FGS_ROWS.length; r++){
      var row = FGS_ROWS[r];
      var board = row.sort(all.slice());
      var lead = null, spot = null, i;

      // first place on this board that no earlier row has already shown
      for(i = 0; i < board.length; i++){
        if(!usedArt[board[i].id]){ lead = board[i]; break; }
      }
      // then the best piece left by somebody else
      for(i = 0; i < board.length; i++){
        var uid = board[i].user_id;
        if(!uid || usedArt[board[i].id]) continue;
        if(usedArtist[uid] || (lead && uid === lead.user_id)) continue;
        spot = board[i]; break;
      }
      // spotlight first, the way the pair reads
      if(spot) out.push(slot(spot, row, 'Artist Spotlight'));
      if(lead) out.push(slot(lead, row, row.art));
    }
    return out;
  }

  // 60% of a card at each of the track's own column counts, scaled for the
  // screen's pixel ratio the way dzGridSizes does. The picture covers the
  // whole card, so these are the card's widths, not a slice of them.
  function fgsSizes(){
    var s = (typeof dzDprScale === 'function') ? dzDprScale() : 1;
    var f = function(vw){ return +(vw * s).toFixed(2); };
    return '(min-width:1600px) ' + f(31) + 'vw, (min-width:700px) ' + f(47) + 'vw, ' + f(92) + 'vw';
  }

  var FGS_ICO = {
    star:'<path d="M12 3.2l2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2 6.8 19.1 8 13.3 3.6 9.3l5.9-.7z"/>',
    crown:'<path d="M3.5 8.2l3.6 3 4.9-5.4 4.9 5.4 3.6-3-1.5 9.6H5z"/>',
    heart:'<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    eye:'<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    arrow:'<path d="M6 18 18 6"/><path d="M9.4 6H18v8.6"/>'
  };
  function fgsSvg(name, w){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (w || 1.9) +
           '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + FGS_ICO[name] + '</svg>';
  }

  /* Show the part of the artwork its uploader picked.

     They pick it in a SQUARE — the crop stage is 1:1 — and thumb_x/thumb_y
     are stored as an object-position, which is an anchor rather than a
     centre: it lines the point x% across the image up with the point x%
     across the box. That is exactly right as long as the box has the same
     shape as the stage, which every grid cell on this site does and this card
     does not. A card is 2:1, so it can only show a band, and anchoring slides
     that band away from the middle of the chosen square in proportion to how
     much shorter it is — up to 150px out on a portrait upload, in the one
     direction that pulls it back towards the centre of the file. A crop
     chosen at the top of an image was being answered with something closer to
     the middle of it, which is precisely what picking a crop is for avoiding.

     So the square is reconstructed — side min(w,h)/zoom, placed by the stored
     anchor — and the card is centred on ITS centre, clamped to the edges of
     the file. What the card shows is then always the middle of what they
     framed, whatever shape the card happens to be. At 50% nothing changes,
     which is why this never showed up in the middle of the range. */
  function fgsFrame(img){
    var a = img && img.__fgsArt;
    if(!a) return;
    var w = img.naturalWidth, h = img.naturalHeight;
    var bw = img.clientWidth, bh = img.clientHeight;
    if(!w || !h || !bw || !bh) return;

    var num = function(v, d){ return (v != null && isFinite(+v)) ? +v : d; };
    var tx = Math.max(0, Math.min(100, num(a.thumb_x, 50)));
    var ty = Math.max(0, Math.min(100, num(a.thumb_y, 50)));
    var tz = Math.max(1, Math.min(2, num(a.thumb_zoom, 1)));

    // the square they framed, in the file's own pixels, and its centre
    var m  = Math.min(w, h) / tz;
    var cx = ((tx / 100) * (w - m) + m / 2) / w;
    var cy = ((ty / 100) * (h - m) + m / 2) / h;

    // the band this card can show, put centrally over that
    var sc = Math.max(bw / w, bh / h);
    var vw = bw / sc, vh = bh / sc;
    var px = (w - vw) > 0.5 ? ((cx * w - vw / 2) / (w - vw)) * 100 : 50;
    var py = (h - vh) > 0.5 ? ((cy * h - vh / 2) / (h - vh)) * 100 : 50;
    px = Math.max(0, Math.min(100, px));
    py = Math.max(0, Math.min(100, py));

    img.style.objectPosition = px.toFixed(2) + '% ' + py.toFixed(2) + '%';
    // their zoom is theirs; the card magnifies by the same amount about the
    // same point, the way every other thumbnail on the site does
    if(tz > 1){
      img.style.transform = 'scale(' + tz + ')';
      img.style.transformOrigin = px.toFixed(2) + '% ' + py.toFixed(2) + '%';
    }
  }

  // the band depends on the card's shape, and the card's shape changes with
  // the window — one column becomes two, and every crop is re-cut
  function fgsReframe(){
    var track = document.getElementById('fgShowTrack');
    if(!track) return;
    var imgs = track.querySelectorAll('.fgsMedia img');
    for(var i = 0; i < imgs.length; i++) fgsFrame(imgs[i]);
  }

  function fgsCard(slot, idx){
    var a = slot.art;
    var spot = slot.kind === 'Artist Spotlight';
    var el = document.createElement('article');
    el.className = 'fgsCard';
    el.setAttribute('data-fgs', slot.row.id);
    if(slot.uid) el.setAttribute('data-uid', slot.uid);

    var line = String(a.description || '').replace(/\s+/g, ' ').trim();

    el.innerHTML =
      '<span class="fgsMedia" aria-hidden="true"><img alt="" decoding="async" loading="' +
        (idx < 2 ? 'eager' : 'lazy') + '" draggable="false"></span>' +
      '<span class="fgsScrim" aria-hidden="true"></span>' +
      '<div class="fgsBody">' +
        '<div class="fgsChips">' +
          '<span class="fgsKind">' + fgsSvg(spot ? 'star' : 'crown') +
            '<span>' + esc(slot.kind) + '</span></span>' +
          '<span class="fgsWhen">' + esc(slot.row.word) + '</span>' +
        '</div>' +
        '<h3 class="fgsTitle">' + esc(a.name || 'Untitled') + '</h3>' +
        // the handle is not known until the profile lands; the row is in the
        // card from the start so nothing below it jumps when the name arrives
        '<span class="fgsBy"></span>' +
        '<p class="fgsSub"' + (line ? '' : ' style="display:none"') + '>' + esc(line) + '</p>' +
        '<div class="fgsStats">' +
          '<span class="fgsStat"><span class="fgsStatIco fgsStatIco--like">' + fgsSvg('heart') + '</span>' +
            '<b>' + esc(fgsFmt(slot.likes)) + '</b><i>Likes</i></span>' +
          '<span class="fgsStat"><span class="fgsStatIco fgsStatIco--view">' + fgsSvg('eye', 1.7) + '</span>' +
            '<b>' + esc(fgsFmt(slot.views)) + '</b><i>Views</i></span>' +
        '</div>' +
        '<button class="fgsGo" type="button" aria-label="View artwork ' + esc(a.name || 'Untitled') + '">' +
          '<span>View Artwork</span>' + fgsSvg('arrow', 2.2) +
        '</button>' +
      '</div>';

    var img = el.querySelector('.fgsMedia img');
    if(typeof dzApplyThumb === 'function') dzApplyThumb(img, a.image_url || '');
    else img.src = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(a.image_url || '') : (a.image_url || '');
    // a card is two grid cells wide, so the grid's own sizes would hand it the
    // 300 for a box that wants the 1000
    if(img.srcset) img.sizes = fgsSizes();
    // the crop needs the file's real proportions, which are not known until it
    // has arrived; until then it sits centred, which is where it would have
    // sat anyway
    img.__fgsArt = a;
    if(img.complete && img.naturalWidth) fgsFrame(img);
    else img.onload = function(){ fgsFrame(img); };

    el.querySelector('.fgsGo').onclick = function(){
      if(typeof openLB !== 'function') return;
      openLB(a.image_url || '', a.name || 'Untitled',
             (typeof catList === 'function' ? (catList(a.category)[0] || 'others') : 'others'),
             a.description || '', a.id);
    };
    return el;
  }

  // The one thing a card cannot say until the profile lands: who made it.
  function fgsPaint(card, p){
    if(!card || card.classList.contains('fgsReady')) return;
    var by = card.querySelector('.fgsBy');
    if(by){
      var name = (p && (p.display_name || p.username)) || 'Artist';
      by.textContent = 'by ' + name;
    }
    card.classList.add('fgsReady');
  }

  /* One request for every profile the six cards need, and only for the ones
     dzArtistCache has not already got. Everything paints from the cache, so
     opening the gallery after scrolling the home page usually costs nothing
     at all. */
  function fgsFetchPeople(uids){
    var want = [], seen = {};
    uids.forEach(function(u){
      if(!u || seen[u]) return;
      seen[u] = 1;
      if(typeof dzArtistCache !== 'undefined' && dzArtistCache[u] !== undefined) return;
      want.push(String(u));
    });
    if(!want.length || typeof sb === 'undefined' || !sb){ fgsPaintAll(); return; }
    sb.from('profiles').select('id,username,display_name,avatar_url,banner_url,bio').in('id', want)
      .then(function(res){
        ((res && res.data) || []).forEach(function(p){ if(p && p.id) dzArtistCache[p.id] = p; });
        // a profile that came back empty is cached as missing, not retried
        want.forEach(function(u){ if(dzArtistCache[u] === undefined) dzArtistCache[u] = null; });
        fgsPaintAll();
      }, function(){ fgsPaintAll(); });
  }

  function fgsPaintAll(){
    var track = document.getElementById('fgShowTrack');
    if(!track) return;
    var cards = track.querySelectorAll('.fgsCard[data-uid]');
    for(var i = 0; i < cards.length; i++){
      var uid = cards[i].getAttribute('data-uid');
      if(typeof dzArtistCache !== 'undefined' && dzArtistCache[uid] !== undefined){
        fgsPaint(cards[i], dzArtistCache[uid]);
      }
    }
  }

  /* ---- the rail ------------------------------------------------------- */

  /* How wide a page is, measured off a card rather than guessed from a
     breakpoint — one number that stays true whatever the css does with the
     column count.

     It has to be the card plus the gap, not the track's own width: the track
     is padded by the page inset, which past 1280px is however much is left
     over once the grid below has taken its 1680, and on a 2200px screen that
     is 284px a side. Paging by clientWidth there would step nearly four cards
     at a time through a three-card row. The card's width is a percentage of
     the padded content box, so card + gap is the true stride, and it is also
     exactly where scroll-snap lands. */
  function fgsMetrics(){
    var track = document.getElementById('fgShowTrack');
    var card  = track && track.querySelector('.fgsCard');
    if(!track || !card) return { step:0, per:1, page:0 };
    var cs   = window.getComputedStyle(track);
    var gap  = parseFloat(cs.columnGap || cs.gap) || 0;
    var w    = card.getBoundingClientRect().width;
    var step = w + gap;
    if(!step) return { step:0, per:1, page:0 };
    var inner = track.clientWidth
              - (parseFloat(cs.paddingLeft) || 0)
              - (parseFloat(cs.paddingRight) || 0);
    var per = Math.max(1, Math.round(inner / step));
    return { step:step, per:per, page:per * step };
  }
  function fgsPages(){
    return Math.max(1, Math.ceil(fgsSlots.length / fgsMetrics().per));
  }
  function fgsPage(){
    var track = document.getElementById('fgShowTrack');
    var m = fgsMetrics();
    if(!track || !m.page) return 0;
    return Math.max(0, Math.min(fgsPages() - 1, Math.round(track.scrollLeft / m.page)));
  }

  function fgsTrack(){ return document.getElementById('fgShowTrack'); }

  // where the rail stands, counted in cards from the start
  function fgsCardAt(){
    var t = fgsTrack(), m = fgsMetrics();
    return (t && m.step) ? t.scrollLeft / m.step : 0;
  }

  /* Everything that moves the rail goes through one glide — a dot, an arrow
     key, a wheel step, a released drag — so they all feel like the same
     movement rather than four different ones.

     The glide runs with the snap switched off. A mandatory snap fights an
     animation in flight: it keeps pulling the rail to the nearest card while
     the scroll is still travelling, which is what made a dot press stutter
     instead of slide. It comes back on once the rail is standing on a card
     boundary, where switching it on moves nothing. */
  var fgsFreeT = null, fgsSnapT = null, fgsGliding = false;

  function fgsFree(){
    var t = fgsTrack(); if(!t) return;
    clearTimeout(fgsFreeT); clearTimeout(fgsSnapT);
    t.classList.add('fgsFree');
  }
  function fgsSnapBack(){
    clearTimeout(fgsSnapT);
    fgsSnapT = setTimeout(function(){
      var t = fgsTrack();
      fgsGliding = false;
      if(!t) return;
      t.classList.remove('fgsFree');
      fgsPaintDots(null);
    }, 460);
  }

  /* Slide to an exact offset, and mark the dot for it straight away rather
     than when the rail arrives. The reader pressed a dot; the answer to that
     is theirs immediately, not half a second later once an animation has
     finished reporting on itself. */
  function fgsSlideTo(left, page){
    var t = fgsTrack(); if(!t) return;
    var max = t.scrollWidth - t.clientWidth;
    left = Math.max(0, Math.min(max, left));
    fgsFree();
    fgsGliding = true;
    if(fgsMotionOk() && typeof t.scrollTo === 'function') t.scrollTo({ left:left, behavior:'smooth' });
    else t.scrollLeft = left;
    fgsPaintDots(page == null ? Math.max(0, Math.min(fgsPages() - 1, Math.round(left / (fgsMetrics().page || 1)))) : page);
    fgsSnapBack();
  }
  function fgsGoCard(n){
    var m = fgsMetrics();
    if(m.step) fgsSlideTo(n * m.step, null);
  }
  function fgsGoPage(n){
    var page = Math.max(0, Math.min(fgsPages() - 1, n));
    fgsSlideTo(page * fgsMetrics().page, page);
  }
  function fgsNav(dir){
    // the rail wraps, so a key is never a dead control
    var pages = fgsPages(), next = fgsPage() + (dir < 0 ? -1 : 1);
    if(next < 0) next = pages - 1;
    if(next > pages - 1) next = 0;
    fgsGoPage(next);
  }

  // which dot is lit. Given a page it takes that one on trust — mid-glide the
  // rail's own position is a worse answer than the one it is travelling to.
  function fgsPaintDots(page){
    var dots = document.getElementById('fgShowDots');
    if(!dots || dots.hidden) return;
    var here = (page == null) ? fgsPage() : page;
    for(var i = 0; i < dots.children.length; i++){
      var on = i === here;
      dots.children[i].classList.toggle('on', on);
      dots.children[i].setAttribute('aria-current', on ? 'true' : 'false');
    }
  }

  function fgsSyncNav(){
    var dots = document.getElementById('fgShowDots');
    if(!dots) return;
    var pages = fgsPages(), i;

    // a single page has nothing to page through, so it says nothing
    dots.hidden = pages < 2;
    if(pages < 2){ dots.innerHTML = ''; return; }

    if(dots.children.length !== pages){
      dots.innerHTML = '';
      for(i = 0; i < pages; i++){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'fgsDot';
        b.setAttribute('aria-label', 'Go to featured page ' + (i + 1) + ' of ' + pages);
        (function(n){ b.onclick = function(){ fgsGoPage(n); }; })(i);
        dots.appendChild(b);
      }
    }
    fgsPaintDots(null);
  }

  /* ---- entry ---------------------------------------------------------- */

  function fgShowRender(){
    var sec   = document.getElementById('fgShow');
    var track = document.getElementById('fgShowTrack');
    if(!sec || !track) return;

    var slots = fgsPick();
    if(!slots.length){
      sec.hidden = true;
      // opened before the artwork load landed — look again, a few times, then
      // leave the section out rather than poll for ever
      if(fgsRetry < 8){ fgsRetry++; setTimeout(fgShowRender, 400); }
      return;
    }
    fgsRetry = 0;

    // nothing moved since the last paint — keep the rail where the reader
    // left it instead of snapping it back to the first card
    var key = slots.map(function(s){ return s.kind + ':' + s.art.id; }).join('|');
    if(fgsBuilt && track.getAttribute('data-key') === key){
      sec.hidden = false;
      fgsPaintAll();
      fgsSyncNav();
      return;
    }

    fgsSlots = slots;
    track.setAttribute('data-key', key);
    track.innerHTML = '';
    var frag = document.createDocumentFragment();
    slots.forEach(function(s, i){ frag.appendChild(fgsCard(s, i)); });
    track.appendChild(frag);
    // back to the first card instantly — the rail is being rebuilt, so there
    // is nothing for a glide to read as movement across
    track.classList.add('fgsFree');
    track.scrollLeft = 0;
    track.classList.remove('fgsFree');
    sec.hidden = false;
    fgsBuilt = true;

    // A cached picture is already complete before the section is shown, and a
    // hidden box measures zero — so the crop is cut again here, once the cards
    // have a size to be cut against.
    fgsReframe();
    fgsPaintAll();
    fgsFetchPeople(slots.map(function(s){ return s.uid; }));
    fgsSyncNav();
  }

  (function(){
    var track = document.getElementById('fgShowTrack');
    if(!track) return;

    /* ---- driven by hand ------------------------------------------------
       While a gesture runs the rail is free: snap off, easing off, following
       the pointer one to one. Letting go settles it onto a card.

       Settling reads the direction the hand was going, not just where it
       stopped. Rounding to the nearest card undoes a deliberate push: a card
       here is 700px wide on a desktop, so a 300px drag rounds back to exactly
       where it started and the rail looks broken. Any push worth more than a
       nudge therefore lands on the NEXT card the way it was heading. */
    var settleT = null;
    var NUDGE = 0.12;             // of a card — under this it was not a push

    function fgsSettle(dir){
      clearTimeout(settleT);
      settleT = setTimeout(function(){
        var at = fgsCardAt(), off = at - Math.floor(at), to;
        if(dir > 0 && off > NUDGE)          to = Math.ceil(at);
        else if(dir < 0 && off < 1 - NUDGE) to = Math.floor(at);
        else                                to = Math.round(at);
        fgsGoCard(to);
      }, 0);
    }

    /* A wheel over the rail turns the rail, one card per turn of it.

       One card per GESTURE, not per event. A wheel does not report a turn, it
       reports a stream: a mouse sends several deltas for one notch and a
       trackpad sends dozens for one flick. Answering each of them walked the
       rail three or four cards along from a single movement of the hand — one
       scroll and you were on the fourth card. The stream is treated as one
       gesture until it goes quiet, and a gesture is worth one card however
       many events it was made of.

       It is a step rather than a free scroll because a card is far wider than
       a notch: a mouse reports about 100px a click and a card is seven times
       that, so following it one to one would move the rail a seventh of a
       card and settle it straight back. Both axes count, so a trackpad's
       sideways flick and a mouse's vertical wheel do the same thing.

       At either end the gesture is handed straight back to the page. Without
       that the section is a trap: a reader scrolling down the gallery would
       stop dead the moment the pointer crossed it, with the rail already on
       its last card and nothing left to give. */
    var wheelAcc = 0, wheelStepped = false, wheelT = null;
    var WHEEL_TRIP  = 14;         // px of wheel before the rail answers
    var WHEEL_QUIET = 160;        // ms of silence that ends a gesture

    track.addEventListener('wheel', function(e){
      if(e.ctrlKey) return;                       // pinch zoom is not ours
      var m = fgsMetrics();
      if(!m.step) return;
      var max = track.scrollWidth - track.clientWidth;
      if(max <= 1) return;

      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if(e.deltaMode === 1)      d *= 16;         // some mice report lines
      else if(e.deltaMode === 2) d *= track.clientWidth;
      if(!d) return;
      if((d < 0 && track.scrollLeft <= 1) || (d > 0 && track.scrollLeft >= max - 1)) return;

      e.preventDefault();
      // every event pushes the end of the gesture further out, so a stream
      // stays one gesture for as long as it keeps arriving
      clearTimeout(wheelT);
      wheelT = setTimeout(function(){ wheelAcc = 0; wheelStepped = false; }, WHEEL_QUIET);

      if(wheelStepped) return;                    // this gesture has had its card
      wheelAcc += d;
      if(Math.abs(wheelAcc) < WHEEL_TRIP) return;
      var dir = wheelAcc > 0 ? 1 : -1;
      wheelAcc = 0;
      wheelStepped = true;
      // the rail is standing on a boundary, so this is a clean one-card step
      fgsGoCard(Math.round(fgsCardAt()) + dir);
    }, { passive:false });

    /* And a mouse can take hold of it and pull. Touch is left alone: a finger
       already gets the browser's own swipe, which carries momentum this
       cannot, and taking that gesture over would only make it worse. */
    var dragId = null, dragFrom = 0, dragAt = 0, dragMax = 0, dragDir = 0, dragReal = false;
    var DRAG_SLOP = 6;                            // past this it is a drag, not a click

    track.addEventListener('pointerdown', function(e){
      if(e.pointerType !== 'mouse' || e.button !== 0) return;
      if(track.scrollWidth - track.clientWidth <= 1) return;
      dragId = e.pointerId; dragAt = e.clientX; dragFrom = track.scrollLeft;
      dragMax = 0; dragDir = 0; dragReal = false;
      try{ track.setPointerCapture(dragId); }catch(err){}
      track.classList.add('fgsDrag');
      fgsFree();
    });

    track.addEventListener('pointermove', function(e){
      if(dragId === null || e.pointerId !== dragId) return;
      var dx = e.clientX - dragAt;
      if(Math.abs(dx) > dragMax) dragMax = Math.abs(dx);
      if(dragMax > DRAG_SLOP){ dragReal = true; dragDir = dx < 0 ? 1 : -1; }
      var max = track.scrollWidth - track.clientWidth;
      track.scrollLeft = Math.max(0, Math.min(max, dragFrom - dx));
    });

    function dragEnd(e){
      if(dragId === null || (e && e.pointerId !== dragId)) return;
      try{ if(track.hasPointerCapture(dragId)) track.releasePointerCapture(dragId); }catch(err){}
      dragId = null;
      track.classList.remove('fgsDrag');
      fgsSettle(dragDir);
    }
    track.addEventListener('pointerup', dragEnd);
    track.addEventListener('pointercancel', dragEnd);

    /* The click that follows a real drag belongs to the drag, not to whatever
       button the hand happened to stop over. Caught on the way down, before
       the button ever hears about it. */
    track.addEventListener('click', function(e){
      if(!dragReal) return;
      dragReal = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    // a press that goes nowhere clears the flag rather than leaving it armed
    track.addEventListener('pointerdown', function(){ dragReal = false; }, true);

    /* The dots follow a finger's swipe too, settling rather than firing on
       every frame of it. A glide already lit the dot it is travelling to, so
       it is left alone: reading the rail's position halfway through would
       light whichever dot it happens to be passing and then correct itself,
       which is the flicker a dot press is supposed to have avoided. */
    var t = null;
    track.addEventListener('scroll', function(){
      if(fgsGliding) return;
      clearTimeout(t);
      t = setTimeout(function(){ fgsPaintDots(null); }, 90);
    }, { passive:true });

    // the page count is a function of the width, so it is re-read when the
    // width changes — a rotation can turn three pages into six
    var rt = null;
    window.addEventListener('resize', function(){
      clearTimeout(rt);
      rt = setTimeout(function(){ fgsSyncNav(); fgsReframe(); }, 140);
    }, { passive:true });

    // arrow keys walk the rail once it has focus, the way the chip row does
    track.addEventListener('keydown', function(e){
      if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      fgsNav(e.key === 'ArrowRight' ? 1 : -1);
    });
  })();

  window.fgShowRender = fgShowRender;
