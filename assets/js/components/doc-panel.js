/**
 * doc-panel.js —— 需求文档抽屉（公共组件，无第三方依赖）
 *
 * 设计目标：让任何页面用一段 script 引入即可获得「需求文档 / CSS 规范」双 Tab 抽屉。
 *
 * 数据契约：
 *   window.DocsData[docId] = {
 *     title: '页面名称',
 *     requirement: { ...buildRequirementDoc 的结构化入参（doc-builder.js 已加载时渲染） } ,
 *     requirementHtml: '<section class="doc-section">…</section>',   // 可选：直出 HTML（与 requirement 二选一）
 *     css: { headers: ['选择器 / 元素', '规范说明'], rows: [[a, b], …] } // 或直接传二维数组
 *   };
 *
 * API：
 *   DocPanel.open(docId)      打开指定文档
 *   DocPanel.close()          关闭抽屉
 *   DocPanel.toggle(docId)    切换（按钮 onclick 常用）
 *   DocPanel.autoShow(docId)  App / 小程序页面默认自动展开
 *   DocPanel.isOpen()         当前是否打开
 *
 * 交互：ESC 关闭 + 右上角关闭按钮 + 双 Tab 切换；不渲染全屏遮罩，不阻断页面其他入口。
 */
(function () {
  'use strict';

  var PANEL_ID = 'dg-doc-panel';
  var STYLE_ID = 'dg-doc-panel-style';
  var activeDocId = null;
  var activeTab = 'requirement';

  function escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function docsData() {
    if (!window.DocsData || typeof window.DocsData !== 'object') window.DocsData = {};
    return window.DocsData;
  }

  function docOf(docId) {
    var doc = docsData()[docId];
    return doc || { title: docId || '需求文档' };
  }

  function tableHtml(headers, rows) {
    var head = (headers || []).map(function (cell) {
      return '<th>' + escapeHtml(cell) + '</th>';
    }).join('');
    var body = (rows || []).map(function (row) {
      return '<tr>' + row.map(function (cell) {
        return '<td>' + escapeHtml(cell) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="doc-plain-table"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderRequirement(doc) {
    if (typeof window.buildRequirementDoc === 'function' && doc.requirement) {
      return window.buildRequirementDoc(doc.requirement);
    }
    if (doc.requirementHtml) return doc.requirementHtml;
    return '<section class="doc-section"><h3 class="doc-section-title">需求说明</h3><p>该示例模块未提供结构化需求数据，可在 window.DocsData 中补充 requirement 字段。</p></section>';
  }

  function renderCssSpec(doc) {
    var spec = doc.css;
    var rows = [];
    var headers = ['选择器 / 元素', '规范说明'];
    if (Array.isArray(spec)) {
      rows = spec;
    } else if (spec && typeof spec === 'object') {
      rows = Array.isArray(spec.rows) ? spec.rows : [];
      if (Array.isArray(spec.headers) && spec.headers.length) headers = spec.headers;
    }
    if (!rows.length) {
      return '<section class="doc-section"><h3 class="doc-section-title">CSS 规范</h3><p>暂无规范条目。</p></section>';
    }
    return '<section class="doc-section"><h3 class="doc-section-title">CSS 规范</h3>' + tableHtml(headers, rows) + '</section>';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + PANEL_ID + '{position:fixed;top:0;right:0;height:100vh;width:780px;max-width:94vw;background:#fff;',
      'box-shadow:-10px 0 32px rgba(15,23,42,.16);transform:translateX(102%);transition:transform .28s ease;',
      'z-index:12000;display:flex;flex-direction:column;}',
      '#' + PANEL_ID + '.dg-open{transform:translateX(0);}',
      '#' + PANEL_ID + ' .dg-doc-panel-head{display:flex;align-items:center;justify-content:space-between;',
      'padding:14px 18px;border-bottom:1px solid #e5e7eb;}',
      '#' + PANEL_ID + ' .dg-doc-panel-title{font-size:15px;font-weight:700;color:#0f172a;}',
      '#' + PANEL_ID + ' .dg-doc-close{border:none;background:#f1f5f9;color:#475569;width:30px;height:30px;',
      'border-radius:8px;cursor:pointer;font-size:15px;line-height:1;}',
      '#' + PANEL_ID + ' .dg-doc-close:hover{background:#e2e8f0;}',
      '#' + PANEL_ID + ' .dg-doc-panel-tabs{display:flex;gap:8px;padding:10px 18px 0;background:#f8fafc;}',
      '#' + PANEL_ID + ' .dg-doc-tab{border:1px solid transparent;background:#eef2f7;color:#475569;font-size:13px;',
      'padding:7px 16px;border-radius:8px 8px 0 0;cursor:pointer;}',
      '#' + PANEL_ID + ' .dg-doc-tab.dg-active{background:#fff;border-color:#e5e7eb;border-bottom-color:#fff;',
      'color:#0f172a;font-weight:600;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body{flex:1;overflow-y:auto;padding:16px 20px 36px;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-plain-table{width:100%;border-collapse:collapse;font-size:12px;',
      'border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-plain-table th{background:#f1f5f9;color:#334155;text-align:left;',
      'padding:8px 10px;border-bottom:1px solid #e5e7eb;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-plain-table td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#475569;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-section{margin-bottom:20px;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-section-title{font-size:13px;font-weight:700;color:#334155;',
      'margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body p{font-size:13px;color:#475569;line-height:1.7;margin:0 0 8px;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-rule-card{background:#f8fafc;border:1px solid #eef2f7;',
      'border-radius:8px;padding:10px 12px;margin-bottom:8px;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-rule-title{font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;}',
      '#' + PANEL_ID + ' .dg-doc-panel-body .doc-rule-line{display:flex;gap:6px;font-size:12px;color:#475569;margin-top:4px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensurePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    ensureStyle();
    panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '需求文档抽屉');
    panel.innerHTML = [
      '<div class="dg-doc-panel-head">',
      '  <span class="dg-doc-panel-title" id="dg-doc-panel-title">需求文档</span>',
      '  <button type="button" class="dg-doc-close" aria-label="关闭需求文档">✕</button>',
      '</div>',
      '<div class="dg-doc-panel-tabs">',
      '  <button type="button" class="dg-doc-tab dg-active" data-tab="requirement">需求文档</button>',
      '  <button type="button" class="dg-doc-tab" data-tab="css">CSS 规范</button>',
      '</div>',
      '<div class="dg-doc-panel-body doc-panel-body" id="dg-doc-panel-body"></div>'
    ].join('');
    document.body.appendChild(panel);
    panel.querySelector('.dg-doc-close').addEventListener('click', function () { close(); });
    panel.querySelectorAll('.dg-doc-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        activeTab = tab.getAttribute('data-tab') || 'requirement';
        render();
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) close();
    });
    return panel;
  }

  function render() {
    var panel = ensurePanel();
    var doc = docOf(activeDocId);
    var title = doc.title || activeDocId || '需求文档';
    panel.querySelector('#dg-doc-panel-title').textContent = title;
    panel.querySelectorAll('.dg-doc-tab').forEach(function (tab) {
      tab.classList.toggle('dg-active', tab.getAttribute('data-tab') === activeTab);
    });
    var body = panel.querySelector('#dg-doc-panel-body');
    body.innerHTML = activeTab === 'css' ? renderCssSpec(doc) : renderRequirement(doc);
  }

  function open(docId) {
    activeDocId = docId || activeDocId;
    render();
    ensurePanel().classList.add('dg-open');
  }

  function close() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.classList.remove('dg-open');
  }

  function toggle(docId) {
    if (docId && docId !== activeDocId) {
      open(docId);
      return;
    }
    if (isOpen()) close();
    else open(docId || activeDocId);
  }

  function autoShow(docId) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { open(docId); });
    } else {
      open(docId);
    }
  }

  function isOpen() {
    var panel = document.getElementById(PANEL_ID);
    return !!(panel && panel.classList.contains('dg-open'));
  }

  window.DocPanel = {
    open: open,
    close: close,
    toggle: toggle,
    autoShow: autoShow,
    isOpen: isOpen
  };
})();
