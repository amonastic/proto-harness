'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'settings:get',
  'settings:update',
  'settings:test-model',
  'app:info',
  'app:open-guide',
  'projects:list',
  'projects:create',
  'projects:import-scan',
  'projects:import-apply',
  'projects:open',
  'projects:forget',
  'analysis:product',
  'brain:list',
  'brain:rule',
  'brain:decide',
  'brain:activate-baseline',
  'requirements:list',
  'requirements:get',
  'requirements:create',
  'requirements:analyze',
  'requirements:answer-unknown',
  'requirements:generate',
  'requirements:review',
  'deliveries:list',
  'deliveries:create',
  'deliveries:export',
  'deliveries:open',
  'git:status',
  'git:init',
  'git:commit',
  'git:push',
  'dialog:pick-directory',
  'dialog:pick-reference-files',
  'shell:open-path',
  'shell:show-item',
  'shell:open-external'
]);

contextBridge.exposeInMainWorld('pha', {
  call(channel, payload) {
    if (!CHANNELS.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'FORBIDDEN_CHANNEL', message: `未授权的 IPC 通道：${channel}` }
      });
    }
    return ipcRenderer.invoke(channel, payload);
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});
