/* ── tagrail.js · tag rail + preferences ── */
  /* ═══════════════════════════════════════════════════════════════
     TAG RAIL + PREFERENCES (tg)
     ├─ tgLoad()        — top vocabulary + this user's picks
     ├─ tgRenderRail()  — the chip rows between #hero and .awTabs
     ├─ tgToggle()      — tick from the rail (rotates a fresh tag in)
     ├─ tgModOpen()     — the tag grid, opened by the search bar
     │                    above the rows (or ⌘K / Ctrl K)
     └─ tgPrioritize()  — reorders any feed list by preference

     Preferences BOOST, they never filter: tgPrioritize does a STABLE
     partition, so matching artwork moves to the front while trending
     order is preserved inside both halves. All 52 categories stay
     visible no matter what — a user with zero picks sees exactly
     what they see today, and there is no way to reach an empty feed.

     Vocabulary = free tags UNION category slugs (see get_top_tags).
     Free tags are unused site-wide right now, so a tags-only rail
     would render blank; categories populate it today and real tags
     mix in and outrank them as artists start tagging.
     ═══════════════════════════════════════════════════════════════ */
  var tgAll = [];              /* [{tag, uses, kind}] ranked vocabulary */
  var tgPrefs = new Set();     /* lowercase tokens this user prefers */
  var tgShown = [];            /* tokens currently in the rail, in order */
  var tgLoaded = false;
  /* Row count is a single knob: the markup ships this many .tgRowIn
     divs per rail and every loop below is written against TG_ROWS, so
     changing it here and in the two rails' HTML is the whole edit. */
  var TG_ROWS  = 2;
  /* The width the two rows are packed to, on EVERY device. A desktop
     container is already at least this wide, so the rows fill it and
     nothing scrolls; a phone packs the same length and swipes to reach
     it. That's the point: the vocabulary doesn't shrink because the
     screen did — a narrow screen just takes a swipe to see all of it. */
  var TG_DESKTOP_SPAN = 1360;
  var TG_SLOTS = 60;           /* upper bound; the width budget decides what fits */
  var TG_LS = 'dz_tagprefs1';

  /* Category slugs get their real label ("3d-art" → "3D Art"); free
     tags render exactly as the artist typed them. */
  /* A hidden category must not reach the rail from ANY direction.
     tgLabel() falls back to the raw slug for anything it has no label
     for, so a retired category would otherwise resurface as a bare
     lowercase chip ("ai-art") rather than disappearing. Guarded with a
     typeof test so the rail still works if app-core failed to load. */
  function tgVisible(tag){
    if(!tag) return false;
    return (typeof catHidden === 'function') ? !catHidden(tag) : true;
  }
  function tgLabel(t){
    if(typeof CAT_LABELS === 'object' && CAT_LABELS && CAT_LABELS[t]) return CAT_LABELS[t];
    return t;
  }
  function tgLocalSave(){
    try{ localStorage.setItem(TG_LS, JSON.stringify(Array.from(tgPrefs))); }catch(e){}
  }
  function tgLocalLoad(){
    try{
      var v = JSON.parse(localStorage.getItem(TG_LS) || '[]');
      return Array.isArray(v)
        ? v.filter(function(x){ return typeof x === 'string' && tgVisible(x); })
        : [];
    }catch(e){ return []; }
  }
  /* Guests keep their picks in localStorage; signed-in users get the
     DB copy so preferences follow them across devices. Writes go to
     BOTH, so the local mirror doubles as the offline fallback. */
  async function tgSave(tag, on){
    tgLocalSave();
    if(!currentUser || !sb) return;
    try{
      if(on){
        await sb.from('user_tag_prefs')
          .upsert({user_id:currentUser.id, tag:tag}, {onConflict:'user_id,tag', ignoreDuplicates:true});
      } else {
        await sb.from('user_tag_prefs').delete().eq('user_id', currentUser.id).eq('tag', tag);
      }
    }catch(e){ console.error('tgSave:', e && e.message); }
  }
  async function tgLoad(force){
    if(tgLoaded && !force) return;
    tgLoaded = true;
    var local = tgLocalLoad();
    tgPrefs = new Set(local);
    if(sb){
      try{
        const{data,error} = await sb.rpc('get_top_tags', {lim:200});
        if(error) throw error;
        tgAll = (data || []).filter(function(x){ return x && x.tag && tgVisible(x.tag); });
      }catch(e){
        /* Loud on purpose: this is the one call that decides whether the
           rail has anything to show, so a failure needs to be visible in
           the console rather than silently leaving an empty strip. */
        console.warn('get_top_tags failed — falling back to categories:', (e && e.message) || e);
        tgAll = [];
      }
      if(currentUser){
        try{
          const{data} = await sb.from('user_tag_prefs').select('tag').eq('user_id', currentUser.id);
          var rows = (data || []).map(function(r){ return r.tag; }).filter(tgVisible);
          if(rows.length){
            tgPrefs = new Set(rows);
            tgLocalSave();
          } else if(local.length){
            /* First sign-in on a device that already has picks — carry
               them up rather than silently dropping them. */
            await sb.from('user_tag_prefs')
              .upsert(local.map(function(t){ return {user_id:currentUser.id, tag:t}; }),
                      {onConflict:'user_id,tag', ignoreDuplicates:true});
          }
        }catch(e){ /* keep the local copy */ }
      }
    }
    /* Never let a network result decide whether the rail exists. */
    if(!tgAll.length) tgAll = tgFallbackVocab();
    /* Union in every category, used or not. Two reasons: a desktop row
       needs ~10 chips to reach the right edge and get_top_tags only
       returns categories that already have artwork in them (21 of 51
       today), and a user should be able to prefer a category before
       anything has been posted to it. Unused ones sort last. */
    (function(){
      var seen = {};
      for(var i=0;i<tgAll.length;i++) seen[tgAll[i].tag] = 1;
      var extra = tgFallbackVocab();
      for(var j=0;j<extra.length;j++) if(!seen[extra[j].tag]) tgAll.push(extra[j]);
    })();
    tgFill();
    tgRenderRail();
    /* Only disturb an already-painted grid if there's something to
       reorder by — on a fresh load with no picks this is a no-op. */
    if(tgPrefs.size) tgAfterChange();
  }
  /* The 51 categories are compiled into this page, so the rail can
     always render with ZERO network. Without this, any RPC hiccup —
     offline, a cold PostgREST schema cache right after a migration,
     a bad key — left tgAll empty and tgRenderRail() hid the whole
     strip, which looks identical to "the feature didn't deploy". */
  function tgFallbackVocab(){
    if(typeof SITE_CATEGORIES === 'undefined' || !Array.isArray(SITE_CATEGORIES)) return [];
    return SITE_CATEGORIES
      .filter(function(c){ return c && c.slug && c.slug.length <= TAG_MAX; })
      .map(function(c){ return { tag:c.slug, uses:0, kind:'cat' }; });
  }
  /* Rebuilds the rail's slot list: PICKED tags first, then the rest by
     usage.

     Picked tags used to be excluded outright — ticking one removed it
     and rotated a fresh tag into its slot. That made the filled state
     impossible to see at rest: a pick vanished the moment you made it,
     and the only way to review or undo one was to open the tag grid.
     Keeping them, at the front, is what makes a picked chip a visible,
     reversible state on the rail itself. */
  function tgFill(){
    var picked = [], rest = [];
    for(var i = 0; i < tgAll.length; i++){
      (tgPrefs.has(tgAll[i].tag) ? picked : rest).push(tgAll[i].tag);
    }
    tgShown = picked.concat(rest).slice(0, TG_SLOTS);
  }
  /* No tick and no plus: a picked chip is filled with the accent
     colour and that IS the state. A glyph on every chip made a row
     read as a checklist rather than a set of tags, and the fill is
     legible at a glance from further away than a 12px mark. */
  function tgChipHTML(tag){
    var on = tgPrefs.has(tag);
    return '<button type="button" class="tgChip'+(on?' on':'')+'" data-tag="'+esc(tag)+'" '+
      'onclick="tgToggle(this)" aria-pressed="'+(on?'true':'false')+'">'+
      '<span class="tgLbl">'+esc(tgLabel(tag))+'</span></button>';
  }
  /* The "All" chip. Not a tag — it opens the full tag grid, and it
     carries no data-tag so every lookup that walks the rail
     (tgTwins) skips it without a special case. */
  var TG_ALL_CHIP =
    '<button type="button" class="tgChip tgChipAll" onclick="tgModOpen()" '+
    'aria-haspopup="dialog" aria-label="Browse all tags">'+
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'+
    '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/>'+
    '<rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>'+
    '<span>All</span></button>';
  /* Lays the rail out to FIT rather than to a fixed chip count.
     Chip widths vary with label length, so any fixed count either
     leaves a gap on a wide monitor or overhangs on a narrow one.

     Budgets: both rows are flush left and share one target width, so
     they span [0, span] and finish at the same x. On desktop `span` is
     the container width, so nothing exceeds it and the rail never
     scrolls; on phones it's a multiple of the viewport, which is what
     turns the same two rows into one sideways swipe.

     Widths are measured, never estimated — labels run from "nft" to
     "traditional-art" and guessing would drift badly at the ends. */
  function tgBlockOf(rail){
    var p = rail && rail.parentNode;
    return (p && p.classList && p.classList.contains('tgBlock')) ? p : rail;
  }

  /* Paints EVERY rail on the page. There are two — the home one under
     the hero and the gallery one that replaced the featured strip — and
     they share all state, so a tick in either shows up in both. Each is
     measured and packed independently because their containers can be
     different widths. */
  function tgRenderRail(animate){
    var rails = document.querySelectorAll('.tgRail');
    for(var i = 0; i < rails.length; i++) tgLayoutRail(rails[i], animate);
  }
  function tgLayoutRail(rail, animate){
    if(!rail) return;
    var block = tgBlockOf(rail);
    if(!tgAll.length){ block.style.display = 'none'; return; }
    block.style.display = '';
    var scroll = rail.firstElementChild;
    /* Rows are found positionally, so every rail on the page uses the
       same markup with no unique ids to keep in sync. */
    var hosts = scroll ? scroll.querySelectorAll('.tgRowIn') : null;
    if(!scroll || !hosts || hosts.length < TG_ROWS) return;

    /* Pass 0 — remember where every chip currently sits, BEFORE the
       measuring pass wipes the rows. Keyed by tag so a chip that ends
       up in a different row can still be matched to its old spot. */
    var prev = null;
    if(animate){
      prev = {};
      var cur = rail.querySelectorAll('.tgChip[data-tag]');
      for(var c = 0; c < cur.length; c++){
        prev[cur[c].getAttribute('data-tag')] = cur[c].getBoundingClientRect();
      }
    }

    /* items[0] is the All chip. It's pinned to the front of row 0 and
       excluded from every move below, so the packer can never bury or
       drop it — it has to stay the first thing in the rail for the
       sticky-left rule in the CSS to hold it against the edge. */
    var items = [TG_ALL_CHIP].concat(tgShown.map(tgChipHTML));

    /* Pass 1 — paint everything into one row to read real widths. */
    for(var e = 1; e < TG_ROWS; e++) hosts[e].innerHTML = '';
    hosts[0].innerHTML = items.join('');
    /* getBoundingClientRect, NOT offsetWidth. offsetWidth rounds to a
       whole pixel, and with real webfont metrics a chip that lays out
       at 86.4px reports 86 — across ~16 chips that under-counts a row
       by several pixels, so the packer believed a row fitted when the
       real layout was a few px over and the rail scrolled on desktop
       by exactly that much. Fractional widths make the arithmetic
       match what the browser actually does. */
    var widths = [], kids = hosts[0].children;
    for(var i = 0; i < kids.length; i++) widths.push(kids[i].getBoundingClientRect().width);

    /* Pass 2 — per-row budgets from live computed style, so the
       responsive inset is picked up at every breakpoint without
       duplicating the numbers here. Both rows are flush left and get
       the SAME budget: two equal lines reading left to right, which is
       the whole shape now that there's no third row to stagger
       against. */
    var cs   = getComputedStyle(scroll);
    var gap  = parseFloat(cs.columnGap || cs.gap) || 10;
    var pad  = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    /* One pixel of headroom: clientWidth is an integer while the row is
       fractional, and scrollWidth rounds UP — without it a row landing
       on exactly the budget can still report a 1px overflow. */
    var avail = Math.max(0, rail.clientWidth - pad - 1);
    /* See TG_DESKTOP_SPAN: one desktop's worth of tags everywhere. */
    var span = Math.max(avail, TG_DESKTOP_SPAN);
    var budget = [];
    for(var s = 0; s < TG_ROWS; s++) budget.push(span);

    /* If the vocabulary can't fill those targets, shrink every row by
       the SAME factor instead of letting the rows end wherever they run
       out. That keeps the two lines even on a small tag list — without
       it, one row finishes short and the block looks broken. */
    var poolW = 0;
    for(var q = 0; q < items.length; q++) poolW += widths[q] + (q ? gap : 0);
    var need = 0;
    for(var n = 0; n < TG_ROWS; n++) need += budget[n];
    if(need > 0 && poolW < need){
      var shrink = poolW / need;
      for(var k2 = 0; k2 < TG_ROWS; k2++) budget[k2] *= shrink;
    }

    /* ── Packing ───────────────────────────────────────────────
       Rows are held as INDEX lists, because a row's width depends only
       on which chips are in it (sum of widths + gaps), never on their
       order. That makes every candidate rearrangement a cheap sum. */
    var rows = [];
    for(var z = 0; z < TG_ROWS; z++) rows.push([]);
    function rowW(r){
      var arr = rows[r], t = 0;
      for(var x = 0; x < arr.length; x++) t += widths[arr[x]];
      return t + (arr.length > 1 ? (arr.length - 1) * gap : 0);
    }
    function err(){
      var w = [], t = 0, mism = 0;
      for(var a = 0; a < TG_ROWS; a++){
        w[a] = rowW(a);
        t += Math.abs(w[a] - budget[a]);
        /* Overshoot is NOT symmetric with undershoot. A row finishing a
           few px short is invisible; a row finishing a few px long
           pushes the rail past its container, which switches the edge
           fade on and starts a scroll that shouldn't exist once the
           container is wider than TG_DESKTOP_SPAN.
           Priced to be PROHIBITIVE rather than merely expensive: at a
           mild multiplier the hill-climb would still take a 5px
           overshoot to close a 100px gap, and with real webfont metrics
           that happened at roughly one desktop width in three. The flat
           term is what makes any overshoot lose to any legal layout. */
        if(w[a] > budget[a]) t += 10000 + (w[a] - budget[a]) * 100;
      }
      /* Distance from target, PLUS a penalty for the rows disagreeing
         with each other. They start at the same x, so any difference
         between them shows up directly as a ragged right edge — the
         "bottom line is a tag short" case. Weighted up because that
         mismatch is far more visible than a row finishing a few px shy
         of its target; it's also the only term that cares about BALANCE
         once both rows are under budget, since the distances above then
         sum to a constant minus the total width. */
      for(var b = 0; b < TG_ROWS; b++){
        for(var d = b + 1; d < TG_ROWS; d++) mism += Math.abs(w[b] - w[d]);
      }
      return t + mism * 1.5;
    }
    rows[0].push(0);                      /* All chip — pinned, first row */
    /* tgFill() sorts picked tags to the front, so they occupy
       items[1..pickedN]. Those are MUST-KEEP: the refinement may still
       move them between rows to balance the two, but it may never drop
       or swap one out. Without this a chip you just picked could be
       packed straight back off the rail — the fill would land on the
       tap and then the tag would vanish, which reads as the tap having
       failed. */
    var pickedN = 0;
    while(pickedN < tgShown.length && tgPrefs.has(tgShown[pickedN])) pickedN++;
    var mustKeep = 1 + pickedN;
    var pool = [];
    for(var p = 1; p < items.length; p++) pool.push(p);

    /* Greedy seed — feed each chip to whichever row has the most room
       left. Gets close; the refinement pass does the rest. */
    for(var g = 0; g < pool.length; g++){
      var best = -1, bestRoom = -Infinity;
      for(var r = 0; r < TG_ROWS; r++){
        var room = budget[r] - rowW(r) - (rows[r].length ? gap : 0);
        if(room < widths[pool[g]]) continue;
        if(room > bestRoom){ bestRoom = room; best = r; }
      }
      /* A must-keep that fits nowhere still goes in — it lands in the
         emptier row and that row simply runs a little long. Better a
         slightly uneven pair of rows than a pick that isn't on screen. */
      if(best < 0){
        if(pool[g] >= mustKeep) continue;
        best = rowW(0) <= rowW(1) ? 0 : 1;
      }
      rows[best].push(pool[g]);
      pool[g] = -1;
    }
    pool = pool.filter(function(x){ return x >= 0; });

    /* ── Refinement ────────────────────────────────────────────
       Hill-climb toward the target widths, applying the single best
       improving change each pass and stopping the moment nothing helps.
       Starting from an already-good greedy layout means only a handful
       of chips ever actually move — which is what keeps the shuffle
       small enough to read as a few tags sliding into place. */
    for(var pass = 0; pass < 40; pass++){
      var base = err(), bestGain = 0, mv = null;
      for(var r = 0; r < TG_ROWS; r++){
        for(var i = 0; i < rows[r].length; i++){
          if(rows[r][i] === 0) continue;             /* All chip is pinned */
          /* Picked tags may be rebalanced across rows but never removed
             from the rail, so swap and drop are skipped for them. */
          if(rows[r][i] >= mustKeep){
            /* swap a placed chip for a leftover of a better width */
            for(var q = 0; q < pool.length; q++){
              var keep = rows[r][i]; rows[r][i] = pool[q];
              var e1 = err(); rows[r][i] = keep;
              if(base - e1 > bestGain){ bestGain = base - e1; mv = {t:'swap', r:r, i:i, q:q}; }
            }
            /* drop it entirely — sometimes a row is simply one chip long */
            var cut = rows[r].splice(i, 1)[0];
            var e2 = err();
            rows[r].splice(i, 0, cut);
            if(base - e2 > bestGain){ bestGain = base - e2; mv = {t:'drop', r:r, i:i}; }
          }
          /* hand it to another row */
          for(var d = 0; d < TG_ROWS; d++){
            if(d === r) continue;
            var cut2 = rows[r].splice(i, 1)[0];
            rows[d].push(cut2);
            var e3 = err();
            rows[d].pop(); rows[r].splice(i, 0, cut2);
            if(base - e3 > bestGain){ bestGain = base - e3; mv = {t:'move', r:r, i:i, d:d}; }
          }
        }
        /* pull a leftover in to lengthen a short row */
        for(var q2 = 0; q2 < pool.length; q2++){
          rows[r].push(pool[q2]);
          var e4 = err();
          rows[r].pop();
          if(base - e4 > bestGain){ bestGain = base - e4; mv = {t:'add', r:r, q:q2}; }
        }
      }
      if(!mv || bestGain <= 0.5) break;              /* nothing worth doing */
      if(mv.t === 'swap'){ var old = rows[mv.r][mv.i]; rows[mv.r][mv.i] = pool[mv.q]; pool[mv.q] = old; }
      else if(mv.t === 'drop'){ pool.push(rows[mv.r].splice(mv.i, 1)[0]); }
      else if(mv.t === 'move'){ rows[mv.d].push(rows[mv.r].splice(mv.i, 1)[0]); }
      else if(mv.t === 'add'){ rows[mv.r].push(pool.splice(mv.q, 1)[0]); }
    }

    var plan = [];
    for(var pr = 0; pr < TG_ROWS; pr++){
      plan.push([]);
      for(var pi = 0; pi < rows[pr].length; pi++) plan[pr].push(items[rows[pr][pi]]);
    }

    for(var r2 = 0; r2 < TG_ROWS; r2++){
      hosts[r2].innerHTML = plan[r2].join('');
      /* A vocabulary too small to fill both rows leaves the second one
         empty — hide it so it doesn't contribute phantom gap spacing
         under the first. */
      hosts[r2].style.display = plan[r2].length ? '' : 'none';
    }
    /* Rails ship with exactly TG_ROWS rows, but clear any extras that a
       stale cached shell might still have in the markup. */
    for(var r3 = TG_ROWS; r3 < hosts.length; r3++){
      hosts[r3].innerHTML = '';
      hosts[r3].style.display = 'none';
    }

    /* Pass 5 — FLIP the chips that actually moved. Anything whose
       position is unchanged is left completely alone, so a re-layout
       reads as a few tags sliding into place rather than the whole
       rail twitching. */
    if(prev) tgFlip(rail, prev);
    tgSyncOverflow();
  }
  /* First/Last/Invert/Play: the rows have already been repainted, so
     each chip is measured at its new spot, snapped back to the old one
     with a transform, then released on the next frame. */
  function tgFlip(rail, prev){
    var els = rail.querySelectorAll('.tgChip[data-tag]');
    var moved = [];
    for(var i = 0; i < els.length; i++){
      var el = els[i], was = prev[el.getAttribute('data-tag')];
      if(!was){ el.classList.add('tgEnter'); continue; }   /* new arrival */
      var now = el.getBoundingClientRect();
      var dx = was.left - now.left, dy = was.top - now.top;
      if(Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;   /* didn't move */
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      moved.push(el);
    }
    if(!moved.length) return;
    /* Commit the inverted transforms with a forced reflow rather than
       waiting on requestAnimationFrame — a double rAF costs a frame
       before anything visibly moves, which is exactly the lag that
       made the shuffle feel delayed. */
    void moved[0].offsetHeight;
    (function(){
      {
        for(var j = 0; j < moved.length; j++){
          (function(el){
            el.style.transition = 'transform .34s cubic-bezier(.22,1,.36,1)';
            el.style.transform = '';
            el.addEventListener('transitionend', function done(){
              el.style.transition = ''; el.style.transform = '';
              el.removeEventListener('transitionend', done);
            });
          })(moved[j]);
        }
      }
    })();
  }
  /* Re-checked on resize and after every render, since both change
     whether the rail overflows its container. */
  function tgSyncOverflow(){
    var rails = document.querySelectorAll('.tgRail');
    for(var i = 0; i < rails.length; i++){
      var el = rails[i];
      el.classList.toggle('ov', el.scrollWidth > el.clientWidth + 2);
    }
  }
  /* The row budgets are derived from the container width, so a resize
     needs a full re-layout — retesting overflow alone would leave the
     old chip distribution in place at the new width. */
  var tgRzTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(tgRzTimer);
    tgRzTimer = setTimeout(function(){ tgRenderRail(true); }, 150);
  });
  /* Every chip carrying this tag, across every rail. The home and
     gallery rails each render their own copy, so a tick has to be
     applied to both or they drift apart. */
  function tgTwins(tag){
    /* Matched in JS rather than via an attribute selector: building one
       needs CSS.escape, and when that's missing the whole lookup throws
       and silently collapses to just the clicked chip — which leaves the
       two rails out of step. Comparing values can't fail. */
    var out = [], els = document.querySelectorAll('.tgRail .tgChip[data-tag]');
    for(var i = 0; i < els.length; i++){
      if(els[i].getAttribute('data-tag') === tag) out.push(els[i]);
    }
    return out;
  }
  function tgMark(el, on){
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function tgToggle(btn){
    var tag = btn && btn.getAttribute('data-tag');
    if(!tag) return;
    var on = !tgPrefs.has(tag);
    if(on) tgPrefs.add(tag); else tgPrefs.delete(tag);
    tgSave(tag, on);

    /* Beat 1 — answer the tap NOW, on every rail, before any layout
       work. The fill lands on the press so it always feels answered. */
    var twins = tgTwins(tag);
    if(!twins.length) twins = [btn];
    for(var i = 0; i < twins.length; i++) tgMark(twins[i], on);

    /* Beat 2 — picked tags sort to the front, so re-fill and let the
       FLIP pass in tgLayoutRail glide every chip that moved to its new
       slot. The feed rebuild rides along at the end: it's the heaviest
       thing on this path, so it must not block the tap. */
    requestAnimationFrame(function(){
      tgFill();
      tgRenderRail(true);
      tgAfterChange();
    });
  }
  /* Stable partition — preferred artwork first, trending order intact
     inside each half. Matches on BOTH the tags and category arrays,
     since the rail's vocabulary spans the two. */
  function tgPrioritize(list){
    if(!tgPrefs.size || !Array.isArray(list) || list.length < 2) return list;
    var hit = [], rest = [];
    for(var i=0; i<list.length; i++){
      var a = list[i], toks = [], m = false;
      if(Array.isArray(a.tags)) toks = toks.concat(a.tags);
      toks = toks.concat(catList(a.category));
      for(var j=0; j<toks.length; j++){
        if(tgPrefs.has(String(toks[j]).trim().toLowerCase())){ m = true; break; }
      }
      (m ? hit : rest).push(a);
    }
    return hit.concat(rest);
  }
  function tgAfterChange(){
    try{
      if(typeof awTab !== 'undefined' && typeof awListForTab === 'function'){
        renderAwGrid(awListForTab(awTab), awTab);
      }
    }catch(e){}
  }

  /* ── "Search tag" grid — 2 cols phone / 3 mid / 4 desktop ── */
  function tgModOpen(){
    document.getElementById('tgMod').classList.add('open');
    document.body.style.overflow = 'hidden';
    var s = document.getElementById('tgModSearch');
    if(s) s.value = '';
    tgModRender('');
    setTimeout(function(){ if(s) s.focus(); }, 80);
  }
  function tgModClose(){
    document.getElementById('tgMod').classList.remove('open');
    restoreScroll();
    /* Picks made in the grid change which tags belong in the rail. */
    tgFill(); tgRenderRail(true);
  }
  function tgModRender(q){
    var host = document.getElementById('tgModGrid');
    if(!host) return;
    q = (q || '').trim().toLowerCase();
    var rows = tgAll.filter(function(x){
      return !q || x.tag.indexOf(q) !== -1 || tgLabel(x.tag).toLowerCase().indexOf(q) !== -1;
    });
    if(!rows.length){ host.innerHTML = '<div class="tgModNone">No matching tag</div>'; return; }
    host.innerHTML = rows.map(function(x){
      var on = tgPrefs.has(x.tag);
      return '<button type="button" class="tgModOpt'+(on?' on':'')+'" data-tag="'+esc(x.tag)+'" '+
        'onclick="tgModToggle(this)" aria-pressed="'+(on?'true':'false')+'">'+
        '<span class="tgModName">'+esc(tgLabel(x.tag))+'</span>'+
        '<span class="tgModTick" aria-hidden="true">'+(on?'\u2713':'')+'</span></button>';
    }).join('');
  }
  function tgModToggle(btn){
    var tag = btn && btn.getAttribute('data-tag');
    if(!tag) return;
    var on = !tgPrefs.has(tag);
    if(on) tgPrefs.add(tag); else tgPrefs.delete(tag);
    tgSave(tag, on);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var tick = btn.querySelector('.tgModTick');
    if(tick) tick.textContent = on ? '\u2713' : '';
    /* Keep any on-screen rail chip for this tag in step. */
    var tw = tgTwins(tag);
    for(var t2 = 0; t2 < tw.length; t2++) tgMark(tw[t2], on);
    requestAnimationFrame(function(){ tgAfterChange(); });
  }
  document.addEventListener('keydown', function(e){
    if(e.key !== 'Escape') return;
    var m = document.getElementById('tgMod');
    if(m && m.classList.contains('open')) tgModClose();
  });
  /* ⌘K / Ctrl K — the shortcut the bar advertises, so it has to work
     from anywhere on the page. Deliberately inert while a field has
     focus: the same chord is "delete to end of line" in a text input
     on macOS, and stealing it there would be worse than not having the
     shortcut at all. */
  document.addEventListener('keydown', function(e){
    if(e.key !== 'k' && e.key !== 'K') return;
    if(!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    /* Whichever bar is actually on screen — the gallery's while it's
       open, the home one otherwise. */
    var fg = document.getElementById('fg');
    var el = document.getElementById(
      (fg && fg.classList.contains('open')) ? 'fgSearchIn' : 'awSearchIn');
    if(!el) return;
    e.preventDefault();
    el.focus();
    el.select();
  });
  /* The hint is written as ⌘ in the markup and corrected here, so the
     Mac case renders straight from HTML with no flash and everyone
     else gets "Ctrl" before first paint of the bar. */
  function tgKbdHint(){
    if(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')) return;
    var els = document.querySelectorAll('.tgSearchKbd .tgKbdMod');
    for(var i = 0; i < els.length; i++) els[i].textContent = 'Ctrl';
  }
  tgKbdHint();

  /* Boot the rail. Deliberately independent of the gallery load: the
     rail paints as soon as the vocabulary lands, and tgPrioritize
     reads live state on every subsequent grid render, so the two can
     resolve in either order without a race. */
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ tgLoad(); });
  } else {
    tgLoad();
  }

