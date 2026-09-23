/**
 * 需求分组实时导出器（浏览器端）
 *
 * 在迭代索引页点击下载入口时，现场读取当前 DOM 的分组结构，
 * 抓取分组内各源页面并内联全部外部资源（CSS/JS/图片/字体），
 * 拼装成单文件自包含 HTML（iframe srcdoc 合并，需求抽屉交互保留）后触发下载。
 * 与 scripts/export-requirement-group.js（Node 批量预生成）口径一致：
 *   - 需求抽屉只保留当前迭代区块（历史版本区块隐藏）
 *   - 存量 ../ 层级写错逐级回退解析
 *   - 入口 query（如 ?view=order）通过 URLSearchParams 垫片注入
 *
 * 用法（迭代页内）：
 *   RequirementExporter.download('202609上', '入库货架号新增')
 * 依赖：迭代页 DOM 含 nav-group / nav-group-title / nav-item[data-page] /
 *       #page-{id} iframe / pageNames 映射（迭代索引页既有结构）。
 * 边界：file:// 打开时 fetch 受限，需 http 环境（线上或 npm run serve:local）。
 */
(function (global) {
  'use strict';

  var MIME = {
    woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon'
  };

  function stripVersion(ref) {
    return ref.split('?')[0].split('#')[0];
  }

  function joinRel(baseDir, rel) {
    // baseDir 如 "../admin-portal/maintain-admin/pages"，rel 如 "../../assets/css/x.css"
    // 注意：顶部越出根目录的前导 .. 必须保留（迭代页在 /迭代索引/ 下，资源相对服务根解析）
    var parts = (baseDir + '/' + rel).split('/');
    var stack = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
        else stack.push('..');
      } else {
        stack.push(p);
      }
    }
    return stack.join('/');
  }

  function fetchText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.text();
    });
  }

  function fetchDataURL(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(new Error('readAsDataURL failed: ' + url)); };
        fr.readAsDataURL(blob);
      });
    });
  }

  /** 逐级回退：先按 baseDir 原样解析，失败则逐级多上一层（兼容存量 ../ 层级写错） */
  function fetchWithFallback(rel, baseDir) {
    var attempt = 0;
    function tryNext() {
      var url = joinRel(baseDir, attempt === 0 ? rel : new Array(attempt + 1).join('../') + rel);
      return fetchText(url).then(function (text) {
        return { text: text, url: url, dir: url.slice(0, url.lastIndexOf('/')) };
      }).catch(function (e) {
        attempt++;
        if (attempt > 4) throw e;
        return tryNext();
      });
    }
    return tryNext();
  }

  /** 逐级回退抓取二进制资源转 data URI */
  function fetchDataURLWithFallback(rel, baseDir) {
    var attempt = 0;
    function tryNext() {
      var url = joinRel(baseDir, attempt === 0 ? rel : new Array(attempt + 1).join('../') + rel);
      return fetchDataURL(url).catch(function (e) {
        attempt++;
        if (attempt > 4) throw e;
        return tryNext();
      });
    }
    return tryNext();
  }

  function extOf(url) {
    var m = stripVersion(url).match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function toDataURI(url) {
    var ext = extOf(url);
    if (!MIME[ext]) return Promise.resolve(null);
    return fetchDataURL(url).catch(function () { return null; });
  }

  /** 内联 CSS 文本里的 url(...) 引用 */
  function inlineCssUrls(css, baseDir) {
    var jobs = [];
    var out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, quote, url) {
      if (/^(data:|https?:|\/\/|#)/.test(url)) return m;
      var clean = stripVersion(url);
      var p = fetchDataURLWithFallback(clean, baseDir).then(function (uri) {
        return uri ? 'url(' + quote + uri + quote + ')' : m;
      }).catch(function () { return m; });
      jobs.push(p);
      return '\u0000JOB' + (jobs.length - 1) + '\u0000';
    });
    return Promise.all(jobs).then(function (results) {
      return out.replace(/\u0000JOB(\d+)\u0000/g, function (m, i) { return results[+i]; });
    });
  }

  function getAttr(tag, name) {
    var m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'))
      || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
    return m ? m[1] : null;
  }

  /** 抓取并把单个源页面变成自包含 HTML（口径与 Node 版一致） */
  function inlinePage(pageUrl, query) {
    return fetchText(pageUrl).then(function (html) {
      var pageDir = pageUrl.slice(0, pageUrl.lastIndexOf('/'));
      var jobs = [];

      function reg(promise) {
        jobs.push(promise);
        return '\u0000JOB' + (jobs.length - 1) + '\u0000';
      }

      // 1. 外部 CSS -> <style>
      html = html.replace(/<link\b[^>]*>/gi, function (tag) {
        var href = getAttr(tag, 'href');
        var rel = (getAttr(tag, 'rel') || '').toLowerCase();
        if (!href || rel.indexOf('stylesheet') < 0 || !/\.css(\?|#|$)/i.test(href)) return tag;
        var p = fetchWithFallback(stripVersion(href), pageDir).then(function (res) {
          return inlineCssUrls(res.text, res.dir).then(function (css) {
            return '<style data-inlined-from="' + stripVersion(href) + '">\n' + css + '\n</style>';
          });
        }).catch(function () { return tag; });
        return reg(p);
      });

      // 2. 外部 JS -> 内联 <script>
      html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, function (tag, src) {
        var p = fetchWithFallback(stripVersion(src), pageDir).then(function (res) {
          var js = res.text.replace(/<\/script/gi, '<\\/script');
          return '<script data-inlined-from="' + stripVersion(src) + '">\n' + js + '\n</script>';
        }).catch(function () { return tag; });
        return reg(p);
      });

      // 3. <img> -> data URI
      html = html.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi, function (m, head, src, tail) {
        if (/^(data:|https?:|\/\/)/.test(src)) return m;
        var p = toDataURI(joinRel(pageDir, src)).then(function (uri) {
          return uri ? head + uri + tail : m;
        });
        return reg(p);
      });

      // 4. 页面内联 <style> 的 url(...)
      html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, function (m, attrs, css) {
        if (attrs && attrs.indexOf('data-inlined-from') >= 0) return m;
        var p = inlineCssUrls(css, pageDir).then(function (out) {
          return '<style' + attrs + '>' + out + '</style>';
        });
        return reg(p);
      });

      return Promise.all(jobs).then(function (results) {
        html = html.replace(/\u0000JOB(\d+)\u0000/g, function (m, i) { return results[+i]; });
        return html;
      });
    }).then(function (html) {
      // 5. 导出口径：只保留当前迭代区块
      var filterStyle = '<style data-export-filter>details.doc-version-block:not(.doc-version-block-current){display:none!important}</style>';
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, '    ' + filterStyle + '\n</head>');
      } else {
        html = filterStyle + html;
      }
      // 6. 入口 query 垫片
      if (query) {
        var shim = '<script data-export-query>(function(){var q=\'' + query + '\';var O=window.URLSearchParams;window.URLSearchParams=function(i){if(i==null||i===\'\'||i===window.location.search){return new O(q);}return new O(i);};})();</script>';
        if (/<head[^>]*>/i.test(html)) {
          html = html.replace(/<head[^>]*>/i, function (m) { return m + '\n    ' + shim; });
        } else {
          html = shim + html;
        }
      }
      return html;
    });
  }

  /** 从迭代页 DOM 读出所有分组（页面标签直接从导航结构拼「页面名 · 端」） */
  function readGroupsFromDOM(doc) {
    var groups = [];
    var navGroups = Array.prototype.slice.call(doc.querySelectorAll('nav .nav-group'));
    navGroups.forEach(function (navGroup) {
      var titleEl = navGroup.querySelector('.nav-group-title span');
      if (!titleEl) return;
      var title = titleEl.textContent.trim();
      if (!title || title === '迭代入口') return;
      var pages = [];
      Array.prototype.slice.call(navGroup.querySelectorAll('.nav-item[data-page]')).forEach(function (item) {
        var pid = item.getAttribute('data-page');
        if (!pid || pid === 'overview') return;
        var frame = doc.getElementById('page-' + pid);
        if (!frame) return;
        var iframe = frame.querySelector('iframe');
        if (!iframe || !iframe.getAttribute('src')) return;
        var src = iframe.getAttribute('src');
        var qIndex = src.indexOf('?');
        var query = qIndex >= 0 ? src.slice(qIndex + 1) : '';
        var file = qIndex >= 0 ? src.slice(0, qIndex) : src;
        var label = item.querySelector('span') ? item.querySelector('span').textContent.trim() : pid;
        var subgroup = item.closest ? item.closest('.nav-subgroup') : null;
        var endLabel = subgroup && subgroup.querySelector('.nav-subgroup-title span')
          ? subgroup.querySelector('.nav-subgroup-title span').textContent.trim() : '';
        var name = endLabel ? label + ' · ' + endLabel : label;
        pages.push({ id: pid, name: name, src: file, query: query });
      });
      if (pages.length) groups.push({ title: title, pages: pages });
    });
    return groups;
  }

  function escapeSrcdoc(html) {
    return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function buildWrapper(iterName, group, generatedAt) {
    var frames = group.pages.map(function (p, i) {
      return '        <iframe id="frame-' + i + '" class="exp-frame' + (i === 0 ? ' active' : '') + '" data-name="' + p.name + '" srcdoc="' + escapeSrcdoc(p.__html) + '"></iframe>';
    }).join('\n');

    var navItems = group.pages.map(function (p, i) {
      var endLabel = p.name.indexOf('·') >= 0 ? p.name.split('·').pop().trim() : '';
      var pageLabel = p.name.indexOf('·') >= 0 ? p.name.split('·')[0].trim() : p.name;
      return '                <button class="exp-nav-item' + (i === 0 ? ' active' : '') + '" data-frame="frame-' + i + '" type="button">\n'
        + '                    <span class="exp-nav-page">' + pageLabel + '</span>\n'
        + (endLabel ? '                    <span class="exp-nav-end">' + endLabel + '</span>\n' : '')
        + '                </button>';
    }).join('\n');

    return '<!DOCTYPE html>\n'
      + '<html lang="zh-CN">\n'
      + '<!-- generated-by: assets/js/requirement-exporter.js (runtime) -->\n'
      + '<!-- generated-at: ' + generatedAt + ' -->\n'
      + '<!-- source-iteration: ' + iterName + ' -->\n'
      + '<!-- source-group: ' + group.title + ' -->\n'
      + '<!-- 本文件为自包含导出物：全部样式/脚本/图片已内联，可直接转发或另存，勿手工编辑 -->\n'
      + '<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
      + '    <title>' + iterName + ' · ' + group.title + ' · 需求包</title>\n'
      + '    <style>\n'
      + '        * { margin: 0; padding: 0; box-sizing: border-box; }\n'
      + '        body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif; display: flex; height: 100vh; overflow: hidden; background: #F1F5F9; }\n'
      + '        .exp-nav { width: 264px; flex-shrink: 0; background: linear-gradient(180deg, #1E293B 0%, #0F172A 100%); color: #CBD5E1; display: flex; flex-direction: column; }\n'
      + '        .exp-nav-head { padding: 20px 18px 14px; border-bottom: 1px solid #334155; }\n'
      + '        .exp-nav-iter { font-size: 12px; color: #94A3B8; }\n'
      + '        .exp-nav-title { font-size: 17px; font-weight: 700; color: #fff; margin-top: 4px; }\n'
      + '        .exp-nav-meta { font-size: 11px; color: #64748B; margin-top: 6px; }\n'
      + '        .exp-nav-list { flex: 1; overflow-y: auto; padding: 10px 0; }\n'
      + '        .exp-nav-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 18px; background: none; border: none; border-left: 3px solid transparent; color: #CBD5E1; font-size: 14px; text-align: left; cursor: pointer; }\n'
      + '        .exp-nav-item:hover { background: rgba(255,255,255,0.05); color: #fff; }\n'
      + '        .exp-nav-item.active { background: rgba(59,130,246,0.14); color: #fff; border-left-color: #3B82F6; }\n'
      + '        .exp-nav-end { flex-shrink: 0; font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(148,163,184,0.18); color: #94A3B8; }\n'
      + '        .exp-nav-foot { padding: 12px 18px; border-top: 1px solid #334155; font-size: 11px; color: #64748B; line-height: 1.7; }\n'
      + '        .exp-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }\n'
      + '        .exp-header { padding: 10px 20px; background: #fff; border-bottom: 1px solid #E2E8F0; font-size: 13px; color: #64748B; display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n'
      + '        .exp-header strong { color: #1E293B; }\n'
      + '        .exp-stage { flex: 1; position: relative; background: #F8FAFC; }\n'
      + '        .exp-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: none; background: #fff; display: none; }\n'
      + '        .exp-frame.active { display: block; }\n'
      + '    </style>\n'
      + '</head>\n'
      + '<body>\n'
      + '    <aside class="exp-nav">\n'
      + '        <div class="exp-nav-head">\n'
      + '            <div class="exp-nav-iter">' + iterName + '</div>\n'
      + '            <div class="exp-nav-title">' + group.title + '</div>\n'
      + '            <div class="exp-nav-meta">共 ' + group.pages.length + ' 个页面 · 需求包导出</div>\n'
      + '        </div>\n'
      + '        <div class="exp-nav-list">\n' + navItems + '\n        </div>\n'
      + '        <div class="exp-nav-foot">\n'
      + '            每页右上角「需求文档」按钮可查看该页需求说明。<br>\n'
      + '            本文件已内联全部样式与资源，可整包转发给开发。\n'
      + '        </div>\n'
      + '    </aside>\n'
      + '    <main class="exp-main">\n'
      + '        <div class="exp-header">\n'
      + '            <span><strong>' + iterName + '</strong> · ' + group.title + ' · 需求包</span>\n'
      + '            <span>生成时间 ' + generatedAt + '</span>\n'
      + '        </div>\n'
      + '        <div class="exp-stage">\n' + frames + '\n        </div>\n'
      + '    </main>\n'
      + '    <script>\n'
      + '        (function () {\n'
      + '            var items = document.querySelectorAll(\'.exp-nav-item\');\n'
      + '            items.forEach(function (item) {\n'
      + '                item.addEventListener(\'click\', function () {\n'
      + '                    items.forEach(function (it) { it.classList.remove(\'active\'); });\n'
      + '                    item.classList.add(\'active\');\n'
      + '                    document.querySelectorAll(\'.exp-frame\').forEach(function (f) { f.classList.remove(\'active\'); });\n'
      + '                    document.getElementById(item.getAttribute(\'data-frame\')).classList.add(\'active\');\n'
      + '                });\n'
      + '            });\n'
      + '        })();\n'
      + '    <\\/script>\n'
      + '</body>\n'
      + '</html>\n';
  }

  function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|\s]+/g, '');
  }

  /**
   * 实时导出并下载一个分组
   * @param {string} groupTitle 迭代页内的一级分组标题
   * @param {string} [iterName] 迭代名，默认取 document.title
   */
  function download(groupTitle, iterName) {
    var doc = document;
    iterName = iterName || (doc.querySelector('.sprint-title') ? doc.querySelector('.sprint-title').textContent.trim() : doc.title);
    var groups = readGroupsFromDOM(doc);
    var group = groups.filter(function (g) { return g.title === groupTitle; })[0];
    if (!group) {
      alert('未找到分组「' + groupTitle + '」，现有：' + groups.map(function (g) { return g.title; }).join('、'));
      return Promise.resolve();
    }
    var statusEl = showStatus('正在生成「' + groupTitle + '」需求包…');
    var generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return Promise.all(group.pages.map(function (p) {
      return inlinePage(p.src, p.query).then(function (html) { p.__html = html; });
    })).then(function () {
      var wrapper = buildWrapper(iterName, group, generatedAt);
      var blob = new Blob([wrapper], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = sanitizeName(iterName) + '-' + sanitizeName(group.title) + '-需求包.html';
      doc.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        a.remove();
        if (statusEl) statusEl.remove();
      }, 1000);
    }).catch(function (e) {
      alert('需求包生成失败：' + e.message + '（file:// 环境不支持实时导出，请通过线上地址或 npm run serve:local 访问）');
      if (statusEl) statusEl.remove();
    });
  }

  function showStatus(text) {
    var el = document.createElement('div');
    el.setAttribute('data-export-status', '1');
    el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;background:#1E293B;color:#fff;font-size:13px;padding:10px 16px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);';
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  global.RequirementExporter = { download: download, readGroupsFromDOM: readGroupsFromDOM, inlinePage: inlinePage };
})(window);
