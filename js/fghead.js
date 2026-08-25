// The head each gallery section leads with.
//
// The gallery used to open on a grid. Six chips said which of six sections you
// were looking at, and that was the whole of what the page told you about
// itself: no name for the section in its own words, no account of what is in
// it, and nothing to search or narrow it by without opening the filter sheet
// in the bar. A reader arriving on /resources from a search engine met a wall
// of thumbnails and a row of chips.
//
// So each of the five sections gets a head of its own, above its own body:
//
//   a title      — what this section is, in the words a reader would use
//   a paragraph  — what is in it and what to do with it, five or six lines
//   a search box — this section only, and half the page wide on a desktop
//   a chip rail  — every category the section has, All first
//
// The head is built once per section, the first time that section is shown,
// and lives inside its panel — so switching sections is still one class swap
// and nothing here is rebuilt to do it.
//
// The rail is one line at every width and is slid rather than wrapped: a
// mouse gets the two arrows in the gutters, a finger swipes it, and either can
// take hold of it and drag. Fifty-one categories do not wrap into anything a
// reader can use, and a rail that is honestly a rail is easier to read than
// six rows of chips pretending to be a paragraph.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return (typeof window.esc === 'function') ? window.esc(s) : String(s == null ? '' : s);
  }
  /* Escape first, then let the stars through as emphasis. The order is the
     whole point: nothing a section's copy contains can become a tag, because
     by the time this looks for stars every < and & in the text is already an
     entity. Unpaired stars are left alone rather than eating the rest of the
     line. */
  function mark(s) {
    return esc(s).replace(/\*([^*]+)\*/g, '<em class="fgHi">$1</em>');
  }
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function stillness() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* What each section says about itself.
     `lead` is the heading, in the second person the rest of the site uses.
     `desc` is the paragraph under it — long enough to say what is in the
     section, who put it there and what a reader can do with it, and short
     enough that nobody scrolls past it to reach the grid.

     *Stars mark the words that go in the brand red*, which is the emphasis the
     hero already uses on "Digital Art" and the wordmark uses on "Artz" — so a
     head reads in the site's own voice rather than inventing a second one. In
     the heading it is the thing being browsed; in the paragraph it is the two
     or three claims that are actually load-bearing, and no more than that: a
     paragraph with six red phrases in it has none.

     The stars are a convention of this file and not markup. `mark()` below
     escapes the text FIRST and converts them afterwards, so a section's copy
     can never put a tag on the page — the text is data even though it is
     written here. */
  var HEADS = {
    artworks: {
      lead: 'Browse *Artworks*',
      hint: 'Search artworks by title',
      desc: 'Every piece here was published by an artist in the DigiArtz community and ' +
            '*cleared before it went up*. Character illustration and concept art, anime and ' +
            'manga, fan art and original work, landscapes, vehicles, creatures, 3D renders ' +
            'and pixel art — fifty categories of it, from first sketches to finished ' +
            'commissions. Open a piece to see it full size, read how it was made and follow ' +
            '*the artist who made it*. Pick a category below to narrow the grid, or search it ' +
            'by name.'
    },
    marketplace: {
      lead: 'Browse the *Marketplace*',
      hint: 'Search listings',
      desc: 'Digital work for sale, *listed by the artists who made it*. Finished artwork and ' +
            'prints, brush and texture packs, website and UI templates, icon sets, 3D models, ' +
            'and commissions taken to order. Every listing says exactly what the buyer ' +
            'receives, in what format and under what licence, before any money is involved — ' +
            'and *what you buy is yours to download, not rented to you by a plan*. Narrow it by ' +
            'what you are after, or search by name.'
    },
    blog: {
      lead: 'Read the *Blog*',
      hint: 'Search posts',
      desc: 'Writing from the community: *step-by-step tutorials*, studio notes on how a piece ' +
            'came together, interviews with artists about how they work, tool and hardware ' +
            'reviews, and news from around the site. Posts are written by members rather than ' +
            '*by a marketing desk*, so they tend to be specific about the parts that are ' +
            'actually difficult. Pick a category to narrow the list, or search it for the ' +
            'subject you came for.'
    },
    resources: {
      lead: 'Find *Resources*',
      hint: 'Search resources',
      desc: 'Files other artists have *made and given away* — brush sets, textures and ' +
            'overlays, fonts, reference packs, colour palettes, mockups, layered PSDs, 3D ' +
            'assets, icons and plugins. Each one lists what is inside the download, what ' +
            'software it opens in and *what you are licensed to do with it*, so there is no ' +
            'guessing after the fact. Narrow it to the kind of file you need, or search for ' +
            'it by name.'
    },
    jobs: {
      lead: 'Find *Creative Work*',
      hint: 'Search postings',
      desc: '*Paid work for artists*, posted by the studios and people hiring. Freelance ' +
            'briefs, full-time and part-time roles, remote positions, internships, contests ' +
            'and open collaborations. Every posting has to *name a pay range and a way to ' +
            'apply* before it goes up, and postings *expire on their own* rather than sitting ' +
            'there long after the role is filled. Narrow it by the kind of work you want, or ' +
            'search it for a skill or a studio.'
    }
  };

  /* The chips.
     Artworks draws from the site's own category list, which is the same one the
     filter sheet and the upload form read, so a chip here and a checkbox there
     can never name different things. The other four draw from their section's
     own options in js/gallery.js, for the same reason. */
  function cats(sec) {
    if (sec === 'artworks') {
      var site = window.SITE_CATEGORIES;
      if (!Array.isArray(site)) return [];
      return site.map(function (c) { return { slug: c.slug, label: c.label }; });
    }
    var o = (window.FG_SECTIONS && window.FG_SECTIONS[sec] && window.FG_SECTIONS[sec].opts) || [];
    return o.map(function (x) { return { slug: slug(x), label: x }; });
  }

  // Which chip is lit. Artworks keeps its answer in js/app-core.js, where the
  // grid reads it; the other four keep theirs in js/gallery.js. Both are asked
  // rather than mirrored, so the chips cannot drift from what is on screen.
  function current(sec) {
    if (sec === 'artworks') {
      return (typeof window.dzArtCat === 'function') ? window.dzArtCat() : 'all';
    }
    return (window.fgSecFilter && window.fgSecFilter[sec]) || 'all';
  }

  var ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="%D"/></svg>';

  function build(sec) {
    var h = HEADS[sec];
    if (!h) return '';
    var chips = [{ slug: 'all', label: 'All' }].concat(cats(sec));
    var cur = current(sec);
    return '' +
      '<header class="fgHead" id="fgHead-' + sec + '">' +
        '<h2 class="fgHeadLead">' + mark(h.lead) + '</h2>' +
        '<p class="fgHeadDesc">' + mark(h.desc) + '</p>' +
        '<div class="fgHeadSearch">' +
          '<span class="fgHeadSIco" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/>' +
            '<path d="m20 20-3.6-3.6"/></svg></span>' +
          '<input type="search" class="fgHeadIn" id="' + fieldId(sec) + '" ' +
            'placeholder="' + esc(h.hint) + '" aria-label="' + esc(h.hint) + '" ' +
            'oninput="fgHeadSearch(\'' + sec + '\', this.value)">' +
          '<button type="button" class="fgHeadSX" aria-label="Clear search" ' +
            'onclick="fgHeadSearchClear(\'' + sec + '\')">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" ' +
            'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="fgCatWrap">' +
          '<button type="button" class="fgCatNav fgCatPrev" data-fgnav="-1" ' +
            'aria-label="Scroll categories left">' + ARROW.replace('%D', 'm15 19-7-7 7-7') + '</button>' +
          '<div class="fgCatRail" id="fgCatRail-' + sec + '" role="group" ' +
            'aria-label="Categories">' +
            chips.map(function (c) {
              return '<button type="button" class="fgCatChip' + (c.slug === cur ? ' on' : '') + '" ' +
                'id="fgCat-' + sec + '-' + esc(c.slug) + '" aria-pressed="' +
                (c.slug === cur ? 'true' : 'false') + '" ' +
                'onclick="fgHeadCat(\'' + sec + '\',\'' + esc(c.slug) + '\')">' +
                esc(c.label) + '</button>';
            }).join('') +
          '</div>' +
          '<button type="button" class="fgCatNav fgCatNext" data-fgnav="1" ' +
            'aria-label="Scroll categories right">' + ARROW.replace('%D', 'm9 5 7 7-7 7') + '</button>' +
        '</div>' +
      '</header>';
  }

  /* The artworks box is #fgSearchIn on purpose: js/app-core.js's grid render
     has always read a field by that name and there has not been one in the
     document for a while, so the section's own search is simply that field
     arriving. The other four hold their query in js/gallery.js instead. */
  function fieldId(sec) {
    return sec === 'artworks' ? 'fgSearchIn' : (sec + 'HeadIn');
  }

  // Build once, into the top of the section's own panel.
  function fgHeadBuild(sec) {
    if (!HEADS[sec]) return;
    var panel = el('fgSec-' + sec);
    if (!panel || el('fgHead-' + sec)) return;
    panel.insertAdjacentHTML('afterbegin', build(sec));
    railWatch(el('fgCatRail-' + sec));
  }

  /* ── searching one section ─────────────────────────────────────────────── */
  var timer = {};
  function fgHeadSearch(sec, v) {
    var wrap = el(fieldId(sec));
    if (wrap) wrap.parentNode.classList.toggle('hasQ', !!String(v || '').length);
    if (sec === 'artworks') {
      // debounced, because every keystroke re-sorts and re-renders the grid
      clearTimeout(timer[sec]);
      timer[sec] = setTimeout(function () {
        if (typeof window.dzArtSearch === 'function') window.dzArtSearch();
      }, 140);
      return;
    }
    // js/gallery.js debounces this one itself
    if (typeof window.fgSecSearchInput === 'function') window.fgSecSearchInput(sec, v);
  }
  function fgHeadSearchClear(sec) {
    var f = el(fieldId(sec));
    if (f) { f.value = ''; f.focus(); }
    fgHeadSearch(sec, '');
  }

  /* ── picking a category ────────────────────────────────────────────────── */
  function fgHeadCat(sec, s) {
    var rail = el('fgCatRail-' + sec);
    if (rail) {
      var on = rail.querySelectorAll('.fgCatChip'), i, hit;
      for (i = 0; i < on.length; i++) {
        hit = on[i].id === 'fgCat-' + sec + '-' + s;
        on[i].classList.toggle('on', hit);
        on[i].setAttribute('aria-pressed', hit ? 'true' : 'false');
      }
    }
    if (sec === 'artworks') {
      if (typeof window.dzArtCat === 'function') window.dzArtCat(s);
    } else {
      if (!window.fgSecFilter) window.fgSecFilter = {};
      window.fgSecFilter[sec] = s;
      if (typeof window.fgSyncFilterBtn === 'function') window.fgSyncFilterBtn();
      if (typeof window.dzSecRender === 'function') window.dzSecRender(sec);
    }
    // Keep the chip that was just pressed in view: pressing the last one
    // visible and having it half off the edge afterwards reads as a miss.
    var chip = el('fgCat-' + sec + '-' + s);
    if (rail && chip && chip.scrollIntoView) {
      try {
        chip.scrollIntoView({
          behavior: stillness() ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest'
        });
      } catch (e) {}
    }
  }

  /* Somebody else changed the filter — the sheet in the bar, or the gallery
     resetting itself on the way out. The chips are told rather than left
     claiming a category the grid is not showing. */
  function fgHeadSyncCat(sec) {
    var rail = el('fgCatRail-' + sec);
    if (!rail) return;
    var cur = current(sec);
    var on = rail.querySelectorAll('.fgCatChip'), i, hit;
    for (i = 0; i < on.length; i++) {
      hit = on[i].id === 'fgCat-' + sec + '-' + cur;
      on[i].classList.toggle('on', hit);
      on[i].setAttribute('aria-pressed', hit ? 'true' : 'false');
    }
  }
  function fgHeadSyncAll() {
    for (var sec in HEADS) fgHeadSyncCat(sec);
  }

  /* ── the rail ───────────────────────────────────────────────────────────
     Three ways along it, all moving the same scroller so there is one answer
     to where it is: the arrows for a mouse, a swipe for a finger, and a drag
     for either. The arrows are a desktop mouse's affordance only — a pointer
     that hovers, on a screen wide enough to have the gutter they stand in —
     and each is greyed out at its own end rather than disappearing, so the
     pair does not shift.

     The 1px slack in `ends` is the browser's: a rail scrolled to its end
     reports a fractional pixel short of it often enough that an exact test
     leaves an arrow lit with nowhere to go. */
  function ends(rail) {
    var wrap = rail.parentNode;
    var prev = wrap.querySelector('.fgCatPrev');
    var next = wrap.querySelector('.fgCatNext');
    var max  = rail.scrollWidth - rail.clientWidth;
    var can  = max > 1;
    if (prev) { prev.classList.toggle('fgNavOff', !can); prev.disabled = !can || rail.scrollLeft <= 1; }
    if (next) { next.classList.toggle('fgNavOff', !can); next.disabled = !can || rail.scrollLeft >= max - 1; }
  }

  function railWatch(rail) {
    if (!rail || rail.__fgWatched) return;
    rail.__fgWatched = true;

    var queued = false;
    function sync() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; ends(rail); });
    }
    rail.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    if (window.ResizeObserver) new ResizeObserver(sync).observe(rail);

    // the arrows, which are the rail's own two buttons
    var wrap = rail.parentNode;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-fgnav]');
      if (!b || b.disabled) return;
      // A little under a screenful, so the chip at the edge stays visible and
      // the reader can see where they came from.
      var by = rail.clientWidth * 0.8 * (+b.getAttribute('data-fgnav') < 0 ? -1 : 1);
      if (rail.scrollBy) rail.scrollBy({ left: by, behavior: stillness() ? 'auto' : 'smooth' });
      else rail.scrollLeft += by;
    });

    /* Take hold of the rail and pull it.
       Pointer events, so a mouse, a pen and a finger are one code path. The
       capture is what keeps the drag alive when the pointer leaves the rail
       mid-pull — without it a fast drag stops the moment it crosses the
       arrow beside it.

       A drag that never moved is a click, and the chip under it is allowed to
       have it: the threshold below is what tells the two apart, and .fgDrag
       is only worn once it has been crossed. */
    var down = false, moved = false, startX = 0, startLeft = 0, id = null;
    var SLOP = 4;

    rail.addEventListener('pointerdown', function (e) {
      // The middle and right buttons belong to the browser — a middle-click
      // opens a link, a right-click opens the menu — so only the primary one
      // starts a drag.
      if (e.button !== 0) return;
      down = true; moved = false;
      startX = e.clientX; startLeft = rail.scrollLeft; id = e.pointerId;
    });

    rail.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== id) return;
      var dx = e.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < SLOP) return;
        moved = true;
        rail.classList.add('fgDrag');
        // Only now, so a plain click is never captured away from its chip.
        try { rail.setPointerCapture(id); } catch (err) {}
      }
      // A touch is already scrolling the rail natively — hijacking it here
      // would move it twice as far as the finger did.
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      rail.scrollLeft = startLeft - dx;
    });

    function up(e) {
      if (!down || (e && e.pointerId !== id)) return;
      down = false;
      if (moved) {
        rail.classList.remove('fgDrag');
        try { rail.releasePointerCapture(id); } catch (err) {}
        // Swallow the click the release would otherwise deliver to whichever
        // chip the pointer happens to have landed on.
        rail.addEventListener('click', function swallow(ev) {
          ev.stopPropagation(); ev.preventDefault();
          rail.removeEventListener('click', swallow, true);
        }, true);
      }
      moved = false; id = null;
    }
    rail.addEventListener('pointerup', up);
    rail.addEventListener('pointercancel', up);

    ends(rail);
  }

  window.fgHeadBuild       = fgHeadBuild;
  window.fgHeadSearch      = fgHeadSearch;
  window.fgHeadSearchClear = fgHeadSearchClear;
  window.fgHeadCat         = fgHeadCat;
  window.fgHeadSyncCat     = fgHeadSyncCat;
  window.fgHeadSyncAll     = fgHeadSyncAll;
})();
