import { escapeHtml } from './format.js';

let toastTimer = 0;

export function toast(message, type = 'default', timeout = 3600) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  while (root.children.length >= 3) root.firstElementChild?.remove();
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  root.appendChild(item);
  window.clearTimeout(toastTimer);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(4px)';
    item.style.transition = 'opacity .18s ease, transform .18s ease';
    setTimeout(() => item.remove(), 200);
  }, timeout);
}

export function openDrawer({
  eyebrow = '', title = '', sub = '', content = '', footer = '', width = '',
  closeOnBackdrop = false, onMount = null, onClose = null
} = {}) {
  const root = document.getElementById('drawer-root');
  root.innerHTML = '';
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.innerHTML = `
    <section class="drawer" role="dialog" aria-modal="true" style="${width ? `width:${width}` : ''}">
      <header class="drawer-head">
        <button class="btn ghost icon drawer-close" type="button" aria-label="关闭">${closeIcon()}</button>
        <div class="drawer-eyebrow">${escapeHtml(eyebrow)}</div>
        <h1 class="drawer-title">${escapeHtml(title)}</h1>
        <p class="drawer-sub">${escapeHtml(sub)}</p>
      </header>
      <div class="drawer-body"></div>
      <footer class="drawer-foot"></footer>
    </section>`;
  const drawer = backdrop.querySelector('.drawer');
  const body = backdrop.querySelector('.drawer-body');
  const foot = backdrop.querySelector('.drawer-foot');
  body.innerHTML = content;
  foot.innerHTML = footer;
  if (!footer) foot.classList.add('hidden');
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (onClose) onClose();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.querySelector('.drawer-close').addEventListener('click', close);
  if (closeOnBackdrop) {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
  }
  root.appendChild(backdrop);
  const handle = {
    el: drawer,
    body,
    foot,
    close,
    setTitle(value) { drawer.querySelector('.drawer-title').textContent = value; },
    setSub(value) { drawer.querySelector('.drawer-sub').textContent = value; },
    setBody(value) { body.innerHTML = value; },
    setFooter(value) { foot.innerHTML = value; foot.classList.toggle('hidden', !value); },
    setBusy(busy) {
      drawer.classList.toggle('is-busy', Boolean(busy));
      drawer.querySelectorAll('button, input, textarea, select').forEach((el) => {
        if (busy) el.setAttribute('disabled', '');
        else el.removeAttribute('disabled');
      });
    }
  };
  if (onMount) onMount(handle);
  return handle;
}

function closeIcon() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg>';
}

export function promptDialog({
  title = '请确认', sub = '', label = '说明', placeholder = '', value = '',
  confirmLabel = '确认', cancelLabel = '取消', danger = false
} = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    root.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2 class="modal-title">${escapeHtml(title)}</h2>
          <p class="modal-sub">${escapeHtml(sub)}</p>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="dialog-input">${escapeHtml(label)}</label>
            <textarea id="dialog-input" class="textarea" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </section>`;
    const input = backdrop.querySelector('#dialog-input');
    const finish = (result) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') finish(null);
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        finish(input.value.trim() || null);
      }
    };
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    backdrop.querySelector('[data-confirm]').addEventListener('click', () => {
      if (!input.value.trim()) { input.focus(); return; }
      finish(input.value.trim());
    });
    root.appendChild(backdrop);
    input.focus();
  });
}

export function confirmDialog({
  title = '确认操作', sub = '', confirmLabel = '确认', cancelLabel = '取消', danger = false
} = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    root.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h2 class="modal-title">${escapeHtml(title)}</h2>
          <p class="modal-sub">${escapeHtml(sub)}</p>
        </div>
        <div class="modal-foot" style="padding-top:16px">
          <button class="btn" data-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </section>`;
    const finish = (result) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };
    const onKey = (event) => { if (event.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    backdrop.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
    root.appendChild(backdrop);
  });
}

export function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.innerHTML = `<span class="spinner light"></span><span>${escapeHtml(label)}</span>`;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.original || button.innerHTML;
    button.disabled = false;
  }
}

export function errorBox(error) {
  const message = error?.message || String(error);
  const code = error?.code ? `[${error.code}] ` : '';
  return `<div class="error-box"><strong>${escapeHtml(code)}操作未完成</strong>${escapeHtml(message)}</div>`;
}

export function loadingBlock(label = '正在读取…') {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

export function infoBox(title, message) {
  return `<div class="info-box"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}
