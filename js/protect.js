// image protection
// the download button is the only sanctioned way to pull a file off the site,
// so every shortcut the browser normally offers on an <img> gets closed here:
// the long press / right click menu ("Download image", "Copy image",
// "Open image"), drag to desktop, and the save page shortcut.
(function () {
  'use strict';

  var MEDIA = 'img,picture,canvas,video,svg,image';

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

  // ios long press starts a selection instead of a context menu
  document.addEventListener('selectstart', function (e) {
    if (isProtected(e.target)) e.preventDefault();
  }, true);

  // save page / save image shortcuts
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = (e.key || '').toLowerCase();
    if (k === 's') {                       // save page
      e.preventDefault();
      if (typeof window.showToast === 'function') {
        window.showToast('Use the Download button to save artwork');
      }
    }
  }, true);
})();
