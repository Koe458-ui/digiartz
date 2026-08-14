// image and text protection
// the download button is the only sanctioned way to pull a file off the site,
// so every shortcut the browser normally offers on an <img> gets closed here:
// the long press / right click menu ("Download image", "Copy image",
// "Open image"), drag to desktop, and the save page shortcut.
//
// text works the same way. css/select.css marks the site's own wording as
// unselectable and opts user written text back in; this file enforces that
// same line against the routes that reach the clipboard without a visible
// selection — select all then copy, find in page then copy, the menu bar.
(function () {
  'use strict';

  var MEDIA = 'img,picture,canvas,video,svg,image';
  var FIELD = 'input,textarea,[contenteditable=""],[contenteditable="true"]';

  // anything that is a media element, or sits inside a protected surface
  function isProtected(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[data-allow-save]')) return false;
    if (el.matches(MEDIA)) return true;
    return !!el.closest(MEDIA);
  }

  // long press on android / right click on desktop
  document.addEventListener('contextmenu', function (e) {
    if (isProtected(e.target)) e.preventDefault();
  }, true);

  // drag an image straight into a folder or another tab
  document.addEventListener('dragstart', function (e) {
    if (isProtected(e.target)) e.preventDefault();
  }, true);

  // a typing surface, where selecting is the whole point
  function inField(el) {
    if (!el || el.nodeType !== 1) return false;
    return !!(el.closest && el.closest(FIELD));
  }

  // css decides what may be selected, so ask css rather than keeping a
  // second list here that could drift out of step with css/select.css
  function selectable(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    if (!el || el.nodeType !== 1) return false;
    var cs = window.getComputedStyle(el);
    var v = cs.webkitUserSelect || cs.userSelect;
    return !!v && v !== 'none';
  }

  // a range is copyable only if every word in it came from a person.
  // walking text nodes rather than trusting the common ancestor means a
  // selection that starts in a comment and runs out into the page chrome is
  // caught, and select all is rejected on the first bit of site wording.
  function rangeAllowed(range) {
    var root = range.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentElement;
    if (!root) return false;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var node, seen = 0;
    while ((node = walker.nextNode())) {
      if (++seen > 5000) return false;     // pathological selection, refuse
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (range.intersectsNode && !range.intersectsNode(node)) continue;
      if (!selectable(node.parentElement)) return false;
    }
    return true;
  }

  // ctrl/cmd+c, the right click menu, the mac menu bar, and anything else
  // that ends in a copy event all land here
  function guardClipboard(e) {
    if (inField(e.target) || inField(document.activeElement)) return;

    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { e.preventDefault(); return; }

    for (var i = 0; i < sel.rangeCount; i++) {
      if (!rangeAllowed(sel.getRangeAt(i))) {
        e.preventDefault();
        sel.removeAllRanges();             // drop the select all highlight too
        return;
      }
    }
  }

  document.addEventListener('copy', guardClipboard, true);
  document.addEventListener('cut', guardClipboard, true);

  // ios long press starts a selection instead of a context menu, and on the
  // desktop a drag does the same, so refuse the selection before it forms
  document.addEventListener('selectstart', function (e) {
    if (isProtected(e.target)) { e.preventDefault(); return; }
    if (inField(e.target)) return;
    if (!selectable(e.target)) e.preventDefault();
  }, true);

  // save page / save image shortcuts
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // Not while somebody is typing. Every other handler in this file exempts a
    // field first; this one did not, so the save reflex in the middle of a
    // blog post or a long description answered with "Use the Download button
    // to save artwork" — advice about a page the writer was not looking at.
    if (inField(e.target) || inField(document.activeElement)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 's') {                       // save page
      e.preventDefault();
      if (typeof window.showToast === 'function') {
        window.showToast('Use the Download button to save artwork');
      }
    }
  }, true);
})();
