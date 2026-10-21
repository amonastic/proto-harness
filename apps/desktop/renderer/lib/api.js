export async function api(channel, payload = {}) {
  if (!window.pha || typeof window.pha.call !== 'function') {
    throw Object.assign(new Error('客户端桥接不可用'), { code: 'BRIDGE_MISSING' });
  }
  const response = await window.pha.call(channel, payload);
  if (!response || response.ok !== true) {
    const info = response?.error || {};
    const error = new Error(info.message || '操作失败');
    error.code = info.code || 'UNKNOWN';
    error.details = info.details || null;
    throw error;
  }
  return response.data;
}

export function errorText(error) {
  if (!error) return '未知错误';
  const code = error.code ? `[${error.code}] ` : '';
  const details = error.details
    ? `\n${typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2)}`
    : '';
  return `${code}${error.message || String(error)}${details}`;
}
