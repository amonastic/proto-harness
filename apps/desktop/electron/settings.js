import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

const SETTINGS_FILE = 'settings.json';

function defaultSettings(app) {
  return {
    schema_version: 'pha-settings-v1',
    projectsRoot: process.env.PHA_PROJECTS_ROOT
      || path.join(app.getPath('documents'), 'Proto Harness Projects'),
    model: {
      kind: 'local-heuristic',
      baseUrl: 'https://api.openai.com/v1',
      model: '',
      jsonMode: true
    },
    apiKeyEnc: '',
    recentProjects: []
  };
}

function atomicWrite(filePath, value) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function createSettingsStore(app) {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const filePath = path.join(userData, SETTINGS_FILE);
  let settings = defaultSettings(app);
  try {
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    settings = {
      ...settings,
      ...loaded,
      model: { ...settings.model, ...(loaded.model || {}) },
      recentProjects: Array.isArray(loaded.recentProjects) ? loaded.recentProjects : []
    };
  } catch {
    // 首次运行或设置损坏：使用默认值，不覆盖项目数据
  }
  if (process.env.PHA_PROJECTS_ROOT) settings.projectsRoot = process.env.PHA_PROJECTS_ROOT;

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    atomicWrite(filePath, settings);
  }

  function publicSettings() {
    return {
      projectsRoot: settings.projectsRoot,
      model: {
        kind: settings.model.kind,
        baseUrl: settings.model.baseUrl,
        model: settings.model.model,
        jsonMode: settings.model.jsonMode !== false,
        hasKey: Boolean(settings.apiKeyEnc)
      },
      recentProjects: settings.recentProjects,
      userData,
      settingsFile: filePath
    };
  }

  function resolveApiKey() {
    if (!settings.apiKeyEnc) return '';
    try {
      return safeStorage.decryptString(Buffer.from(settings.apiKeyEnc, 'base64'));
    } catch {
      return '';
    }
  }

  function update(patch = {}) {
    const next = { ...settings };
    if (typeof patch.projectsRoot === 'string' && patch.projectsRoot.trim()) {
      let raw = patch.projectsRoot.trim();
      if (raw === '~' || raw.startsWith('~/')) {
        raw = path.join(app.getPath('home'), raw.slice(1));
      }
      if (!path.isAbsolute(raw)) {
        const error = new Error('项目根目录必须是绝对路径（或使用 ~/ 开头）');
        error.code = 'INVALID_INPUT';
        throw error;
      }
      const resolved = path.resolve(raw);
      fs.mkdirSync(resolved, { recursive: true });
      next.projectsRoot = resolved;
    }
    if (patch.model && typeof patch.model === 'object') {
      const model = { ...next.model, ...patch.model };
      if (!['local-heuristic', 'openai-compatible'].includes(model.kind)) {
        const error = new Error('未知的模型服务类型');
        error.code = 'INVALID_INPUT';
        throw error;
      }
      if (model.baseUrl && !/^https?:\/\//i.test(model.baseUrl)) {
        const error = new Error('模型服务地址必须以 http:// 或 https:// 开头');
        error.code = 'INVALID_INPUT';
        throw error;
      }
      next.model = {
        kind: model.kind,
        baseUrl: String(model.baseUrl || '').trim(),
        model: String(model.model || '').trim(),
        jsonMode: model.jsonMode !== false
      };
    }
    if (patch.clearApiKey) {
      next.apiKeyEnc = '';
    } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) {
        const error = new Error('系统安全存储不可用，无法保存 API Key');
        error.code = 'RUNTIME_NOT_CONFIGURED';
        throw error;
      }
      next.apiKeyEnc = safeStorage.encryptString(patch.apiKey.trim()).toString('base64');
    }
    settings = next;
    persist();
    return publicSettings();
  }

  function addRecent(root) {
    const resolved = path.resolve(root);
    settings.recentProjects = [resolved, ...settings.recentProjects.filter((item) => item !== resolved)].slice(0, 20);
    persist();
  }

  function forget(root) {
    const resolved = path.resolve(root);
    settings.recentProjects = settings.recentProjects.filter((item) => item !== resolved);
    persist();
  }

  function modelConfig() {
    return {
      kind: settings.model.kind,
      baseUrl: settings.model.baseUrl,
      model: settings.model.model,
      jsonMode: settings.model.jsonMode !== false,
      apiKey: resolveApiKey()
    };
  }

  return {
    publicSettings,
    update,
    addRecent,
    forget,
    modelConfig,
    projectsRoot: () => settings.projectsRoot,
    recentProjects: () => [...settings.recentProjects],
    settingsFile: () => filePath
  };
}
