(function () {
  const RETRY_DELAYS = [80, 250, 600, 1200];

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isPanelOpen(doc) {
    const openPanel = doc.querySelector('#doc-panel.open, #doc-panel.is-open, #docPanel.open, #docPanel.is-open, .doc-panel.open, .doc-panel.is-open, .doc-drawer.open, .doc-drawer.is-open');
    if (openPanel) return true;

    const panel = doc.querySelector('#doc-panel, #docPanel, .doc-panel, .doc-drawer');
    if (!panel) return false;
    if (panel.classList.contains('translate-x-full') || panel.classList.contains('is-hidden') || panel.classList.contains('hidden')) return false;

    const view = doc.defaultView;
    const style = view.getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = panel.getBoundingClientRect();
    const nearRight = rect.right > view.innerWidth - 24 && rect.left < view.innerWidth - 80;
    return rect.width >= 240 && nearRight && style.transform !== 'matrix(1, 0, 0, 1, 780, 0)';
  }

  function getDocButtons(doc) {
    return Array.from(doc.querySelectorAll('button, a, [role="button"], .doc-btn, .dg-doc-btn, .btn-doc, .tool-btn'))
      .filter((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const onclick = el.getAttribute('onclick') || '';
        return isVisible(el) && (text.indexOf('需求文档') !== -1 || onclick.indexOf('DocPanel') !== -1 || onclick.indexOf('toggleDocPanel') !== -1 || onclick.indexOf('openDoc') !== -1);
      });
  }

  function getDocIdFromButton(button) {
    const onclick = button.getAttribute('onclick') || '';
    const match = onclick.match(/(?:DocPanel\.(?:toggle|show|autoShow)|toggleDocPanel)\(['"]([^'"]+)['"]\)/);
    return match && match[1] ? match[1] : '';
  }

  function openChildDocPanel(iframe) {
    let win;
    let doc;
    try {
      win = iframe.contentWindow;
      doc = iframe.contentDocument || (win && win.document);
    } catch (err) {
      return false;
    }
    if (!win || !doc || isPanelOpen(doc)) return false;

    const buttons = getDocButtons(doc);
    for (const button of buttons) {
      const docId = getDocIdFromButton(button);
      if (docId && win.DocPanel && typeof win.DocPanel.autoShow === 'function') {
        win.DocPanel.autoShow(docId);
        return true;
      }
    }

    if (typeof win.openDoc === 'function') {
      win.openDoc();
      return true;
    }

    const firstButton = buttons[0];
    if (firstButton && !isPanelOpen(doc)) {
      firstButton.click();
      return true;
    }
    return false;
  }

  function scheduleOpen(iframe) {
    RETRY_DELAYS.forEach((delay) => {
      window.setTimeout(() => openChildDocPanel(iframe), delay);
    });
  }

  function initIterationDocAutoOpen() {
    document.querySelectorAll('iframe.iframe-page').forEach((iframe) => {
      if (iframe.dataset.iterationDocAutopen === '1') return;
      iframe.dataset.iterationDocAutopen = '1';
      iframe.addEventListener('load', () => scheduleOpen(iframe));
      scheduleOpen(iframe);
    });
  }

  window.IterationDocAutoOpen = {
    openAll: initIterationDocAutoOpen,
    openFrame: scheduleOpen
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIterationDocAutoOpen);
  } else {
    initIterationDocAutoOpen();
  }
})();
