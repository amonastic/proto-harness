/* 全局搜索逻辑
 * 依赖：assets/js/search-index.js（window.__SEARCH_INDEX__）
 * 运行：在 index.html 标题下方放搜索框 #global-search-input 与结果容器 #global-search-results
 */
(function () {
    'use strict';

    var input = document.getElementById('global-search-input');
    var resultsEl = document.getElementById('global-search-results');
    if (!input || !resultsEl) return;

    var idx = window.__SEARCH_INDEX__ || { menus: [], docs: [] };
    var menus = idx.menus || [];
    var docs = idx.docs || [];

    // 按菜单标题分组：同 title 聚合，列出所有来源
    function searchMenus(q) {
        var ql = q.toLowerCase();
        var hits = menus.filter(function (m) {
            return (
                m.title.toLowerCase().indexOf(ql) !== -1 ||
                (m.group && m.group.toLowerCase().indexOf(ql) !== -1) ||
                (m.iterTag && m.iterTag.toLowerCase().indexOf(ql) !== -1)
            );
        });
        // 按 title 分组
        var groups = {};
        hits.forEach(function (m) {
            var key = m.title;
            if (!groups[key]) groups[key] = [];
            groups[key].push(m);
        });
        return Object.keys(groups).map(function (k) {
            return { title: k, items: groups[k] };
        });
    }

    // 文档搜索：docId + 全文
    function searchDocs(q) {
        var ql = q.toLowerCase();
        return docs
            .filter(function (d) {
                return (
                    d.docId.toLowerCase().indexOf(ql) !== -1 ||
                    d.fullText.toLowerCase().indexOf(ql) !== -1
                );
            })
            .map(function (d) {
                // 找命中上下文
                var ctx = '';
                var lower = d.fullText.toLowerCase();
                var pos = lower.indexOf(ql);
                if (pos !== -1) {
                    var start = Math.max(0, pos - 30);
                    var end = Math.min(d.fullText.length, pos + q.length + 60);
                    ctx = (start > 0 ? '…' : '') + d.fullText.slice(start, end) + (end < d.fullText.length ? '…' : '');
                } else {
                    ctx = d.snippet;
                }
                return { docId: d.docId, module: d.module, pageUrl: d.pageUrl, ctx: ctx };
            })
            .slice(0, 20);
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function highlight(text, q) {
        if (!q) return escapeHtml(text);
        var lower = text.toLowerCase();
        var ql = q.toLowerCase();
        var out = '';
        var i = 0;
        var pos;
        while ((pos = lower.indexOf(ql, i)) !== -1) {
            out += escapeHtml(text.slice(i, pos));
            out += '<mark style="background:rgba(99,102,241,0.35);color:var(--nav-text);padding:0 2px;border-radius:2px;">' + escapeHtml(text.slice(pos, pos + q.length)) + '</mark>';
            i = pos + q.length;
        }
        out += escapeHtml(text.slice(i));
        return out;
    }

    function renderResults(q) {
        if (!q) {
            resultsEl.style.display = 'none';
            resultsEl.innerHTML = '';
            return;
        }
        var menuGroups = searchMenus(q);
        var docHits = searchDocs(q);
        if (menuGroups.length === 0 && docHits.length === 0) {
            resultsEl.innerHTML =
                '<div style="padding:24px;text-align:center;color:var(--nav-muted);font-size:13px;">未找到"' +
                escapeHtml(q) +
                '"相关结果</div>';
            resultsEl.style.display = 'block';
            return;
        }
        var html = '';
        // 菜单分组
        if (menuGroups.length > 0) {
            html += '<div style="padding:8px 16px;font-size:11px;color:var(--nav-subtle);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--nav-border);">菜单 (' +
                menuGroups.length +
                ')</div>';
            menuGroups.forEach(function (g) {
                g.items.forEach(function (m, idx) {
                    var sourceLabel =
                        m.sourceType === 'iteration'
                            ? '迭代·' + m.module
                            : '源文件·' + m.module;
                    var tag = m.iterTag ? '<span style="margin-left:6px;padding:1px 6px;font-size:10px;background:rgba(99,102,241,0.3);color:#a5b4fc;border-radius:8px;">' + escapeHtml(m.iterTag) + '</span>' : '';
                    html +=
                        '<a href="' +
                        escapeHtml(m.url) +
                        '" target="_blank" style="display:block;padding:10px 16px;text-decoration:none;color:var(--nav-text);border-bottom:1px solid var(--nav-border);" onmouseover="this.style.background=\'var(--nav-surface-hover)\'" onmouseout="this.style.background=\'transparent\'">' +
                        '<div style="display:flex;align-items:center;gap:8px;">' +
                        '<i class="fas fa-list-ul" style="color:#818cf8;font-size:11px;width:14px;"></i>' +
                        '<span style="font-size:13px;font-weight:500;">' +
                        highlight(g.title, q) +
                        '</span>' +
                        tag +
                        '</div>' +
                        '<div style="margin-left:22px;margin-top:2px;font-size:11px;color:var(--nav-subtle);">' +
                        escapeHtml(sourceLabel) +
                        (m.group ? ' · ' + escapeHtml(m.group) : '') +
                        '</div>' +
                        '</a>';
                });
            });
        }
        // 文档命中
        if (docHits.length > 0) {
            html += '<div style="padding:8px 16px;font-size:11px;color:var(--nav-subtle);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--nav-border);border-top:1px solid var(--nav-border);">需求文档 (' +
                docHits.length +
                ')</div>';
            docHits.forEach(function (d) {
                var target = d.pageUrl || '';
                var clickable = !!target;
                var tag = clickable
                    ? 'target="_blank"'
                    : 'onclick="return false;" style="opacity:0.5;cursor:not-allowed;"';
                html +=
                    '<a href="' +
                    escapeHtml(target || '#') +
                    '" ' +
                    tag +
                    ' style="display:block;padding:10px 16px;text-decoration:none;color:var(--nav-text);border-bottom:1px solid var(--nav-border);"' +
                    (clickable ? '' : ' title="该文档未关联具体页面"') +
                    ' onmouseover="if(this.style.cursor!==\'not-allowed\')this.style.background=\'var(--nav-surface-hover)\'" onmouseout="if(this.style.cursor!==\'not-allowed\')this.style.background=\'transparent\'">' +
                    '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<i class="fas fa-book" style="color:#34d399;font-size:11px;width:14px;"></i>' +
                    '<span style="font-size:13px;font-weight:500;">' +
                    highlight(d.docId, q) +
                    '</span>' +
                    '<span style="margin-left:6px;padding:1px 6px;font-size:10px;background:rgba(52,211,153,0.2);color:#6ee7b7;border-radius:8px;">' +
                    escapeHtml(d.module) +
                    '</span>' +
                    '</div>' +
                    '<div style="margin-left:22px;margin-top:2px;font-size:11px;color:var(--nav-muted);line-height:1.5;">' +
                    highlight(d.ctx, q) +
                    '</div>' +
                    '</a>';
            });
        }
        resultsEl.innerHTML = html;
        resultsEl.style.display = 'block';
    }

    var debounceTimer = null;
    input.addEventListener('input', function () {
        var v = input.value.trim();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
            renderResults(v);
        }, 150);
    });

    input.addEventListener('focus', function () {
        if (input.value.trim()) renderResults(input.value.trim());
    });

    // 点击外部关闭
    document.addEventListener('click', function (e) {
        if (!input.contains(e.target) && !resultsEl.contains(e.target)) {
            resultsEl.style.display = 'none';
        }
    });

    // ESC 清空
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            input.value = '';
            resultsEl.style.display = 'none';
            input.blur();
        }
    });
})();
