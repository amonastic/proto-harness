(function () {
  function isDocButtonText(text) {
    return text === '需求文档';
  }

  function normalizeDocButtons(root) {
    var candidates = root.querySelectorAll('button, a, [role="button"], .doc-btn, .btn-doc');
    candidates.forEach(function (el) {
      if (el.classList.contains('dg-doc-btn')) return;
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (isDocButtonText(text)) {
        el.classList.add('dg-doc-btn');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      normalizeDocButtons(document);
    });
  } else {
    normalizeDocButtons(document);
  }

  window.DGDocButton = { normalize: normalizeDocButtons };
})();
