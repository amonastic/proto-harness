(function () {
  var COPY_TOAST_ID = 'dg-sidebar-copy-toast';
  var COPY_MENU_ID = 'dg-sidebar-copy-menu';
  var REVIEW_STYLE_ID = 'dg-sidebar-review-style';
  var REVIEW_STATE_LABELS = {
    polish: '待打磨',
    designing: '设计中',
    blocked: '待处理',
    review: '可评审'
  };
  var REVIEW_STATE_TONES = {
    polish: '#F59E0B',
    designing: '#38BDF8',
    blocked: '#F43F5E',
    review: '#34D399'
  };
  var KNOWN_ROOTS = [
    '专项聚合',
    'admin-portal',
    'field-app',
    'mini-program',
    '迭代索引',
    '零散设计',
    '投标截图原型',
    'templates'
  ];

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function getReviewStorageScope() {
    return normalizePathFromUrl(window.location.href).replace(/\?.*$/, '');
  }

  function getReviewStorageKey(reviewId) {
    return 'dg-sidebar-review-state:' + getReviewStorageScope() + ':' + reviewId;
  }

  function getStoredReviewState(reviewId) {
    if (!reviewId) return '';
    try {
      var state = window.localStorage && window.localStorage.getItem(getReviewStorageKey(reviewId));
      return REVIEW_STATE_TONES[state] ? state : '';
    } catch (error) {
      return '';
    }
  }

  function setStoredReviewState(reviewId, state) {
    if (!reviewId) return false;
    try {
      if (!window.localStorage) return false;
      var key = getReviewStorageKey(reviewId);
      if (state && REVIEW_STATE_TONES[state]) {
        window.localStorage.setItem(key, state);
      } else {
        window.localStorage.removeItem(key);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  function textFromElement(element) {
    if (!element) return '';
    var clone = element.cloneNode(true);
    clone.querySelectorAll('i, svg, .nav-item-desc, .badge, .tag').forEach(function (node) {
      node.remove();
    });
    return cleanText(clone.textContent);
  }

  function getPageTitle() {
    var logo = document.querySelector('.nav-logo');
    var logoText = textFromElement(logo);
    var title = logoText || cleanText((document.title || '').replace(/\s*[-|｜].*$/, ''));
    if (!title) return '当前页面';
    var path = window.location.pathname || '';
    if (/\/index\.html$/.test(path) && !/(主页面|总导航|迭代|导航)$/.test(title)) {
      return title + '主页面';
    }
    return title;
  }

  function getGroupTitle(item) {
    var group = item.closest('.nav-group');
    return textFromElement(group && group.querySelector('.nav-group-title'));
  }

  function getItemTitle(item) {
    var label = item.querySelector('span:not(.nav-item-desc)') || item;
    return textFromElement(label);
  }

  function stripVersion(urlText) {
    return (urlText || '').replace(/[?&]v=\d+/g, '').replace(/[?&]$/, '');
  }

  function normalizePathFromUrl(urlText) {
    if (!urlText) return '';
    var parsed;
    try {
      parsed = new URL(urlText, window.location.href);
    } catch (error) {
      return stripVersion(urlText);
    }

    var path = decodeURIComponent(parsed.pathname || '');
    if (!path) return stripVersion(urlText);

    var normalized = path.replace(/^\/+/, '');
    for (var i = 0; i < KNOWN_ROOTS.length; i += 1) {
      var root = KNOWN_ROOTS[i];
      var index = normalized.indexOf(root + '/');
      if (index >= 0) {
        normalized = normalized.slice(index);
        break;
      }
    }

    return stripVersion(normalized || path);
  }

  function normalizePathWithSearchFromUrl(urlText, baseUrl) {
    if (!urlText) return '';
    var parsed;
    try {
      parsed = new URL(urlText, baseUrl || window.location.href);
    } catch (error) {
      return stripVersion(urlText);
    }

    var path = normalizePathFromUrl(parsed.href);
    var params = [];
    parsed.searchParams.forEach(function (value, key) {
      if (key === 'v') return;
      params.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return path + (params.length ? '?' + params.join('&') : '');
  }

  function getDirectoryPath(filePath) {
    if (!filePath) return '';
    var cleanPath = String(filePath).split('?')[0].replace(/\/+$/, '');
    var index = cleanPath.lastIndexOf('/');
    return index >= 0 ? cleanPath.slice(0, index + 1) : cleanPath;
  }

  function getReferenceType(filePath) {
    return /^迭代索引\/snapshots\//.test(filePath || '') ? 'snapshot' : 'live-source';
  }

  function getEntryPath(pageId) {
    var path = normalizePathFromUrl(window.location.href);
    var separator = path.indexOf('?') >= 0 ? '&' : '?';
    return path + separator + 'page=' + pageId;
  }

  function getSourceIframePath(pageId) {
    var section = document.getElementById('page-' + pageId);
    var iframe = section && section.querySelector('iframe[src]');
    if (!iframe) return '';
    return normalizePathWithSearchFromUrl(iframe.getAttribute('src'));
  }

  function getSourceFilePath(pageId) {
    var section = document.getElementById('page-' + pageId);
    var iframe = section && section.querySelector('iframe[src]');
    if (!iframe) return '';
    return normalizePathFromUrl(iframe.getAttribute('src'));
  }

  function getPageSectionId(pageId) {
    return pageId && pageExists(pageId) ? 'page-' + pageId : '';
  }

  function getSourceDocument(pageId) {
    var section = document.getElementById('page-' + pageId);
    var iframe = section && section.querySelector('iframe[src]');
    if (!iframe) return null;
    try {
      return iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document) || null;
    } catch (error) {
      return null;
    }
  }

  function findSourceDocId(sourceDocument) {
    if (!sourceDocument) return '';
    var nodes = sourceDocument.querySelectorAll('[onclick]');
    for (var i = 0; i < nodes.length; i += 1) {
      var onclick = nodes[i].getAttribute('onclick') || '';
      var match = onclick.match(/(?:DocPanel\.toggle|toggleDocPanel)\(['"]([^'"]+)['"]\)/);
      if (match && match[1]) return match[1];
    }
    var scripts = sourceDocument.querySelectorAll('script');
    for (var j = 0; j < scripts.length; j += 1) {
      var scriptText = scripts[j].textContent || '';
      var autoMatch = scriptText.match(/DocPanel\.autoShow\(['"]([^'"]+)['"]\)/);
      if (autoMatch && autoMatch[1]) return autoMatch[1];
    }
    return '';
  }

  function findSourceDocsPath(sourceDocument) {
    if (!sourceDocument) return '';
    var scripts = sourceDocument.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i += 1) {
      var src = scripts[i].getAttribute('src') || '';
      if (/\/?docs\.js(?:[?#]|$)/.test(src)) {
        return normalizePathWithSearchFromUrl(src, sourceDocument.location && sourceDocument.location.href);
      }
    }
    return '';
  }

  function getLocatorContext(item) {
    var pageId = item.getAttribute('data-page') || '';
    var parts = [getPageTitle(), getGroupTitle(item), getItemTitle(item)].filter(Boolean);
    var sourceDocument = getSourceDocument(pageId);
    return {
      pageId: pageId,
      title: parts.join(' > '),
      entryPath: getEntryPath(pageId),
      sourcePath: getSourceFilePath(pageId),
      iframePath: getSourceIframePath(pageId),
      referenceType: getReferenceType(getSourceFilePath(pageId)),
      referenceDirectory: getDirectoryPath(getSourceFilePath(pageId)),
      pageSectionId: getPageSectionId(pageId),
      docId: findSourceDocId(sourceDocument),
      docsPath: findSourceDocsPath(sourceDocument),
      reviewTargetId: getReviewTargetId(item)
    };
  }

  function buildIterationLocatorText(context) {
    var lines = [];
    if (context.title) lines.push('【迭代目录】' + context.title);
    if (context.iframePath) lines.push('【iframe】' + context.iframePath);
    return lines.join('\n');
  }

  function buildSourceLocatorText(context) {
    return context.sourcePath ? '【源文件】' + context.sourcePath : '';
  }

  function ensureToast() {
    var toast = document.getElementById(COPY_TOAST_ID);
    if (toast) return toast;

    toast = document.createElement('div');
    toast.id = COPY_TOAST_ID;
    toast.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:24px',
      'transform:translateX(-50%)',
      'z-index:99999',
      'padding:9px 14px',
      'border-radius:6px',
      'background:rgba(15,23,42,.92)',
      'color:#fff',
      'font-size:13px',
      'line-height:1.4',
      'box-shadow:0 10px 28px rgba(15,23,42,.24)',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity .16s ease'
    ].join(';');
    document.body.appendChild(toast);
    return toast;
  }

  function ensureReviewStyle() {
    if (document.getElementById(REVIEW_STYLE_ID)) return;

    var style = document.createElement('style');
    style.id = REVIEW_STYLE_ID;
    style.textContent = [
      '.dg-sidebar .nav-item.dg-review-item{position:relative;padding-right:38px!important;}',
      '.dg-sidebar .dg-review-pulse{position:absolute;right:18px;top:50%;width:7px;height:7px;border-radius:999px;transform:translateY(-50%);background:var(--dg-review-color,#38BDF8);box-shadow:0 0 0 1px rgba(255,255,255,.14),0 0 7px color-mix(in srgb,var(--dg-review-color,#38BDF8) 72%,transparent);pointer-events:none;animation:dgReviewBreath 3.8s ease-in-out infinite;}',
      '.dg-sidebar .nav-subitem .dg-review-pulse{right:16px;}',
      '@keyframes dgReviewBreath{0%,100%{opacity:.74;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 0 5px color-mix(in srgb,var(--dg-review-color,#38BDF8) 58%,transparent);}45%{opacity:.96;box-shadow:0 0 0 2px color-mix(in srgb,var(--dg-review-color,#38BDF8) 10%,transparent),0 0 10px color-mix(in srgb,var(--dg-review-color,#38BDF8) 82%,transparent);}70%{opacity:.84;}}',
      '@supports not (color:color-mix(in srgb,#fff 50%,transparent)){.dg-sidebar .dg-review-pulse{box-shadow:0 0 0 1px rgba(255,255,255,.14),0 0 7px var(--dg-review-color,#38BDF8);}@keyframes dgReviewBreath{0%,100%{opacity:.74;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 0 5px var(--dg-review-color,#38BDF8);}45%{opacity:.96;box-shadow:0 0 0 2px rgba(56,189,248,.10),0 0 10px var(--dg-review-color,#38BDF8);}70%{opacity:.84;}}}'
    ].join('');
    document.head.appendChild(style);
  }

  function findReviewSource(sidebar, sourceId) {
    if (!sourceId) return null;
    return sidebar.querySelector('.nav-item[data-page="' + cssEscape(sourceId) + '"], .nav-item[data-review-id="' + cssEscape(sourceId) + '"]');
  }

  function getReviewId(item) {
    return item.getAttribute('data-review-id') || item.getAttribute('data-page') || '';
  }

  function getReviewTargetId(item) {
    return item.getAttribute('data-review-source') || getReviewId(item);
  }

  function resolveReviewState(item, sidebar, visited) {
    var reviewId = getReviewTargetId(item);
    var storedState = getStoredReviewState(reviewId);
    if (storedState) return storedState;

    var directState = item.getAttribute('data-review-state');
    if (directState) return directState;

    var sourceId = item.getAttribute('data-review-source');
    if (!sourceId) return '';

    visited = visited || {};
    if (visited[sourceId]) return '';
    visited[sourceId] = true;

    var source = findReviewSource(sidebar, sourceId);
    return source ? resolveReviewState(source, sidebar, visited) : '';
  }

  function applyReviewIndicators(sidebar) {
    ensureReviewStyle();
    sidebar.querySelectorAll('.nav-item[data-review-state], .nav-item[data-review-source]').forEach(function (item) {
      var state = resolveReviewState(item, sidebar);
      var tone = REVIEW_STATE_TONES[state];
      if (!tone) return;

      var pulse = item.querySelector(':scope > .dg-review-pulse');
      if (!pulse) {
        pulse = document.createElement('span');
        pulse.className = 'dg-review-pulse';
        pulse.setAttribute('aria-hidden', 'true');
        item.appendChild(pulse);
      }

      item.classList.add('dg-review-item');
      item.dataset.reviewResolvedState = state;
      item.dataset.reviewTargetId = getReviewTargetId(item);
      pulse.style.setProperty('--dg-review-color', tone);

      var label = REVIEW_STATE_LABELS[state] || state;
      var titleBase = cleanText((item.getAttribute('title') || '').replace(/状态：[^｜]+(?:｜|$)/, ''));
      var sourceId = item.getAttribute('data-review-source');
      var localMark = getStoredReviewState(getReviewTargetId(item)) ? '，本地标记' : '';
      var statusTitle = sourceId ? '状态：' + label + '（跟随 ' + sourceId + localMark + '）' : '状态：' + label + (localMark ? '（本地标记）' : '');
      item.setAttribute('title', titleBase ? statusTitle + '｜' + titleBase : statusTitle);
    });
  }

  function ensureCopyMenu() {
    var menu = document.getElementById(COPY_MENU_ID);
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = COPY_MENU_ID;
    menu.style.cssText = [
      'position:fixed',
      'z-index:100000',
      'min-width:148px',
      'padding:6px',
      'border-radius:6px',
      'background:#fff',
      'border:1px solid rgba(148,163,184,.45)',
      'box-shadow:0 16px 38px rgba(15,23,42,.22)',
      'display:none',
      'color:#0f172a',
      'font-size:13px'
    ].join(';');

    function createMenuButton(action, icon, label, toastText) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.toast = toastText;
      button.style.cssText = [
        'width:100%',
        'border:0',
        'border-radius:4px',
        'background:transparent',
        'padding:8px 10px',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'color:inherit',
        'font:inherit',
        'text-align:left',
        'cursor:pointer'
      ].join(';');
      button.innerHTML = '<span style="width:16px;text-align:center;color:#2563eb;">' + icon + '</span><span>' + label + '</span>';
      button.addEventListener('mouseenter', function () {
        button.style.background = '#eff6ff';
      });
      button.addEventListener('mouseleave', function () {
        button.style.background = 'transparent';
      });
      button.addEventListener('click', function () {
        if (action.indexOf('review-') === 0) {
          var reviewTargetId = menu.dataset.reviewTargetId || '';
          hideCopyMenu();
          if (!reviewTargetId) {
            showToast('当前目录不支持状态标记');
            return;
          }
          var nextState = button.dataset.reviewState || '';
          var ok = setStoredReviewState(reviewTargetId, nextState);
          applyReviewIndicators(document);
          showToast(ok ? button.dataset.toast : '本地状态保存失败');
          return;
        }

        if (!menu.dataset.hasLocator) {
          hideCopyMenu();
          showToast('当前目录没有页面定位');
          return;
        }

        var text = action === 'copy-source' ? menu.dataset.sourceText || '' : menu.dataset.iterationText || '';
        hideCopyMenu();
        if (!text) return;
        copyText(text).then(function (ok) {
          showToast(ok ? button.dataset.toast : '复制失败，请重试');
        });
      });
      return button;
    }

    menu.appendChild(createMenuButton('copy-source', '⌘', '复制源文件目录定位', '已复制源文件目录定位'));
    menu.appendChild(createMenuButton('copy-iteration', '↳', '复制迭代目录导航定位', '已复制迭代目录导航定位'));
    var divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:rgba(148,163,184,.25);margin:6px 4px';
    menu.appendChild(divider);

    Object.keys(REVIEW_STATE_LABELS).forEach(function (state) {
      var button = createMenuButton('review-' + state, '●', REVIEW_STATE_LABELS[state], '已切换为' + REVIEW_STATE_LABELS[state]);
      button.dataset.reviewState = state;
      button.querySelector('span').style.color = REVIEW_STATE_TONES[state];
      menu.appendChild(button);
    });
    menu.appendChild(createMenuButton('review-reset', '○', '恢复默认', '已恢复默认状态'));
    document.body.appendChild(menu);
    return menu;
  }

  function hideCopyMenu() {
    var menu = document.getElementById(COPY_MENU_ID);
    if (!menu) return;
    menu.style.display = 'none';
    menu.dataset.sourceText = '';
    menu.dataset.iterationText = '';
    menu.dataset.reviewTargetId = '';
    menu.dataset.hasLocator = '';
  }

  function showCopyMenu(event, context) {
    var menu = ensureCopyMenu();
    menu.dataset.sourceText = buildSourceLocatorText(context);
    menu.dataset.iterationText = buildIterationLocatorText(context);
    menu.dataset.reviewTargetId = context.reviewTargetId || '';
    menu.dataset.hasLocator = context.pageId ? 'true' : '';
    menu.style.display = 'block';

    var menuRect = menu.getBoundingClientRect();
    var left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
    var top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
  }

  function showToast(message) {
    var toast = ensureToast();
    toast.textContent = message;
    toast.style.opacity = '1';
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      toast.style.opacity = '0';
    }, 1600);
  }

  function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(textarea);
    textarea.select();
    var ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }, function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function pageExists(pageId) {
    return Boolean(pageId && document.getElementById('page-' + pageId));
  }

  function syncPageParam(pageId) {
    if (!pageExists(pageId)) return;
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get('page') === pageId) return;
      url.searchParams.set('page', pageId);
      window.history.replaceState(null, '', url.toString());
    } catch (error) {
      // URL state sync is an enhancement; page switching should keep working if it fails.
    }
  }

  function getInitialPageFromUrl() {
    try {
      return new URLSearchParams(window.location.search).get('page') || '';
    } catch (error) {
      return '';
    }
  }

  function patchSwitchPageStateSync() {
    if (typeof window.switchPage !== 'function' || window.switchPage.dgPageStateSync === true) return;

    var originalSwitchPage = window.switchPage;
    var wrappedSwitchPage = function (pageId) {
      var result = originalSwitchPage.apply(this, arguments);
      syncPageParam(pageId);
      return result;
    };
    wrappedSwitchPage.dgPageStateSync = true;
    wrappedSwitchPage.dgOriginalSwitchPage = originalSwitchPage;
    window.switchPage = wrappedSwitchPage;

    var initialPage = getInitialPageFromUrl();
    if (pageExists(initialPage)) {
      window.setTimeout(function () {
        var activePage = document.querySelector('.page-section.active');
        if (!activePage || activePage.id !== 'page-' + initialPage) {
          window.switchPage(initialPage);
        }
      }, 0);
    }
  }

  function bindCopyLocator(sidebar) {
    sidebar.querySelectorAll('.nav-item[data-page], .nav-item[data-review-state], .nav-item[data-review-source]').forEach(function (item) {
      if (item.dataset.copyLocatorReady === 'true') return;
      item.dataset.copyLocatorReady = 'true';
      var titleText = cleanText(item.getAttribute('title') || '');
      if (!titleText) {
        titleText = '右键打开菜单';
      } else if (titleText.indexOf('右键打开') < 0) {
        titleText += '｜右键打开菜单';
      }
      item.setAttribute('title', titleText);
      item.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        event.stopPropagation();
        showCopyMenu(event, getLocatorContext(item));
      });
    });
  }

  function applyStandardSidebar(root) {
    var sidebars = root.querySelectorAll('nav.system-nav, nav[data-role="system-sidebar"]');
    sidebars.forEach(function (sidebar) {
      sidebar.classList.add('dg-sidebar');
      applyReviewIndicators(sidebar);
      bindCopyLocator(sidebar);
    });
    if (sidebars.length) patchSwitchPageStateSync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      applyStandardSidebar(document);
    });
  } else {
    applyStandardSidebar(document);
  }

  document.addEventListener('click', function (event) {
    var menu = document.getElementById(COPY_MENU_ID);
    if (menu && !menu.contains(event.target)) hideCopyMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hideCopyMenu();
  });
  window.addEventListener('scroll', hideCopyMenu, true);

  window.DGSidebar = { apply: applyStandardSidebar, syncPageParam: syncPageParam };
})();
