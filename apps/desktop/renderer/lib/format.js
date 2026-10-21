export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function date(value, withTime = true) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const options = withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('zh-CN', options).format(d);
}

export function relative(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date(value, false);
}

export function truncate(value, max = 120) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function initials(value) {
  const text = String(value || 'P').trim();
  return text.slice(0, 1).toUpperCase();
}

export const STATUS_LABELS = {
  draft: '草稿',
  analyzing: '分析中',
  awaiting_decision: '待裁决',
  analyzed: '已分析',
  generating: '生成中',
  generated: '待评审',
  reviewed: '已评审',
  delivered: '已交付',
  blocked: '已阻塞',
  candidate: '候选',
  confirmed: '已确认',
  superseded: '已替代',
  planned: '计划生效',
  current: '当前生效',
  retired: '已停用'
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '未知';
}

export function statusClass(status) {
  if (['delivered', 'reviewed', 'current', 'confirmed'].includes(status)) return 'green';
  if (['awaiting_decision', 'blocked', 'superseded', 'retired'].includes(status)) return 'amber';
  if (['analyzing', 'generating', 'planned'].includes(status)) return 'blue';
  return 'gray';
}

export function statusBadge(status) {
  return `<span class="badge ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

export function ruleBadge(rule) {
  const knowledge = statusBadge(rule.knowledge_status);
  const effective = `<span class="badge ${rule.effective_state === 'current' ? 'green' : rule.effective_state === 'planned' ? 'blue' : 'gray'}">${escapeHtml(statusLabel(rule.effective_state))}</span>`;
  return `${knowledge} ${effective}`;
}

export function sourceChip(source) {
  if (!source) return '<span class="source-chip">来源未记录</span>';
  if (String(source).startsWith('model:')) {
    return `<span class="source-chip model">模型 · ${escapeHtml(String(source).slice(6))}</span>`;
  }
  return '<span class="source-chip local">本地规则分析</span>';
}

export function lines(value) {
  return String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
}

export function parseEndpoints(value) {
  return lines(value).map((line) => {
    const parts = line.split('|').map((item) => item.trim());
    return {
      name: parts[0] || '业务端',
      role: parts[1] || '使用者',
      platform: parts[2] || 'Web'
    };
  });
}

export function endpointLines(endpoints = []) {
  return endpoints.map((item) => `${item.name} | ${item.role || '使用者'} | ${item.platform || 'Web'}`).join('\n');
}

export function listItems(items, { empty = '暂无记录', className = '' } = {}) {
  if (!items || items.length === 0) return `<p class="hint">${escapeHtml(empty)}</p>`;
  return `<div class="list-block">${items.map((item) => `<div class="list-line ${className}"><span class="bullet"></span><span>${escapeHtml(item)}</span></div>`).join('')}</div>`;
}

export function markdown(value) {
  const source = String(value || '');
  const lines = source.replace(/\r/g, '').split('\n');
  const out = [];
  let inCode = false;
  let paragraph = [];
  let list = null;
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  const flush = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const inline = (text) => escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (/^```/.test(line)) {
      flush(); closeList();
      if (!inCode) out.push('<pre class="code-block"><code>');
      else out.push('</code></pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    if (/^\s*$/.test(line)) { flush(); closeList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush(); closeList();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ordered) {
      flush();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }
    if (/^\|/.test(line)) {
      flush(); closeList();
      out.push(`<p class="mono small">${inline(line)}</p>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flush(); closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

export function shortHash(value, length = 8) {
  return String(value || '').slice(0, length);
}

export function json(value) {
  return JSON.stringify(value, null, 2);
}

export function plural(count, unit) {
  return `${count} ${unit}`;
}
