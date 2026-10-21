import { api, errorText } from '../lib/api.js';
import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';
import * as ui from '../lib/ui.js';

function toolStatus(value, { optional = false, note = '', detectedLabel = '已检测到' } = {}) {
  if (value) {
    return `<div class="stack" style="gap:5px"><div class="cluster"><span class="badge green">${fmt.escapeHtml(detectedLabel)}</span><span class="mono small">${fmt.escapeHtml(value)}</span></div>${note ? `<div class="hint">${fmt.escapeHtml(note)}</div>` : ''}</div>`;
  }
  return `<div class="cluster"><span class="badge ${optional ? 'gray' : 'amber'}">${optional ? '可选，未检测到' : '未检测到'}</span><span class="hint">${fmt.escapeHtml(note)}</span></div>`;
}

export async function renderSettingsPage(container) {
  const ctx = window.phaContext;
  const [settings, info] = await Promise.all([
    api('settings:get'),
    api('app:info')
  ]);
  ctx.state.settings = settings;
  ctx.state.appInfo = info;
  const model = settings.model;
  const isModel = model.kind === 'openai-compatible';

  container.innerHTML = `
    <div class="home">
      <header class="home-topbar">
        <div class="brand">
          <button class="btn ghost small" id="settings-back" style="margin-right:4px">${icons.arrowLeft(15)} 返回</button>
          <div class="brand-mark">PHA</div>
          <div><div class="brand-name">模型与工具</div><div class="brand-sub">Local-first configuration</div></div>
        </div>
        <div class="topbar-actions">
          <span class="badge ${info.app.packaged ? 'green' : 'outline'}">${info.app.packaged ? '安装版' : '开发模式'}</span>
        </div>
      </header>
      <main class="home-main" style="max-width:1060px">
        <div class="page-head">
          <div>
            <div class="page-eyebrow">Settings</div>
            <h1 class="page-title">模型、存储与运行环境</h1>
            <p class="page-sub">业务记录保存在项目文件中；API Key 只进入系统安全存储。更换模型或电脑后，规则、裁决与交付仍可继续使用。</p>
          </div>
          <div class="page-actions">
            <button class="btn" id="settings-test" data-testid="settings-test">${icons.shield(14)} 测试连接</button>
            <button class="btn primary" id="settings-save" data-testid="settings-save">保存设置</button>
          </div>
        </div>

        <div id="settings-message"></div>

        <div class="settings-grid">
          <div class="settings-section">
            <div class="card">
              <div class="card-head"><div><div class="card-title">分析来源</div><div class="card-sub">同一套业务内核可以切换本地规则分析或模型服务；数据格式不变。</div></div></div>
              <div class="card-body">
                <div class="form-grid">
                  <div class="field">
                    <label for="model-kind">运行时</label>
                    <select class="select" id="model-kind" data-testid="settings-model-kind">
                      <option value="local-heuristic" ${!isModel ? 'selected' : ''}>本地规则分析（不调用模型）</option>
                      <option value="openai-compatible" ${isModel ? 'selected' : ''}>OpenAI 兼容模型服务</option>
                    </select>
                  </div>
                  <div id="model-fields" class="${isModel ? '' : 'hidden'}">
                    <div class="form-grid">
                      <div class="field">
                        <label for="base-url">服务地址</label>
                        <input class="input" id="base-url" data-testid="settings-base-url" value="${fmt.escapeHtml(model.baseUrl || '')}" placeholder="https://api.openai.com/v1">
                        <div class="hint">支持 OpenAI 兼容 /chat/completions，例如 DeepSeek、Ollama、LM Studio 或团队网关。</div>
                      </div>
                      <div class="field">
                        <label for="model-id">模型 ID</label>
                        <input class="input" id="model-id" data-testid="settings-model-id" value="${fmt.escapeHtml(model.model || '')}" placeholder="例如 deepseek-chat">
                      </div>
                      <div class="field">
                        <label for="api-key">API Key ${model.hasKey ? '<span class="label-note">已保存；留空不修改</span>' : ''}</label>
                        <input class="input" id="api-key" data-testid="settings-api-key" type="password" autocomplete="off" placeholder="${model.hasKey ? '已保存在系统安全存储' : '输入 API Key'}">
                        <div class="hint">Key 不会写入项目文件、日志或导出包。${info.storage.safeStorage ? '系统安全存储可用。' : '系统安全存储不可用，无法保存 Key。'}</div>
                      </div>
                      <label class="checkbox-row"><input type="checkbox" id="clear-key"> <span>清除已保存的 API Key<span class="sub">下次使用模型前需要重新填写</span></span></label>
                      <label class="checkbox-row"><input type="checkbox" id="json-mode" ${model.jsonMode ? 'checked' : ''}> <span>请求 JSON 输出模式<span class="sub">部分兼容服务不支持；失败时会自动回退一次</span></span></label>
                    </div>
                  </div>
                  <div id="local-note" class="${isModel ? 'hidden' : ''}">
                    <div class="info-box"><strong>当前为本地规则分析</strong>只从你输入的目标、约束与来源文本中提取候选知识，不调用模型。它适合体验完整流程和重复验证；分析质量与模型模式不同，所有结果都要求在界面中确认。</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><div><div class="card-title">项目存储</div><div class="card-sub">新建与接入的项目会放在这个目录；原项目目录不会被修改。</div></div></div>
              <div class="card-body">
                <div class="field">
                  <label for="projects-root">项目根目录</label>
                  <div class="inline-field">
                    <input class="input" id="projects-root" data-testid="settings-projects-root" value="${fmt.escapeHtml(settings.projectsRoot)}">
                    <button class="btn" id="pick-projects-root">选择</button>
                  </div>
                </div>
                <div class="hint" style="margin-top:8px">项目内的 <code>.runtime</code> 为可重建索引与日志，默认不进入 Git。</div>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="card">
              <div class="card-head"><div><div class="card-title">运行环境</div></div></div>
              <div class="card-body">
                <div class="kv-list">
                  <div class="row"><span>客户端</span><strong>${fmt.escapeHtml(info.app.version)} ${info.app.packaged ? '（安装版）' : '（开发模式）'}</strong></div>
                  <div class="row"><span>Electron</span><strong>${fmt.escapeHtml(info.app.electron)}</strong></div>
                  <div class="row"><span>Node</span><strong>${fmt.escapeHtml(info.app.node)}</strong></div>
                  <div class="row"><span>用户数据</span><strong class="mono">${fmt.escapeHtml(info.storage.userData)}</strong></div>
                  <div class="row"><span>设置文件</span><strong class="mono">${fmt.escapeHtml(info.storage.settingsFile)}</strong></div>
                  <div class="row"><span>系统安全存储</span><strong>${info.storage.safeStorage ? '可用' : '不可用'}</strong></div>
                </div>
                <button class="btn small" id="open-user-guide" style="margin-top:12px">${icons.doc(13)} 打开用户手册</button>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><div><div class="card-title">外部工具</div><div class="card-sub">缺失的可选工具不会伪装成已完成能力。</div></div></div>
              <div class="card-body stack">
                <div><div class="conflict-label">Git</div>${toolStatus(info.tools.git, { note: '用于提交与推送；安装 Git 后才能使用同步功能', detectedLabel: '已安装' })}</div>
                <div><div class="conflict-label">pen.dev</div>${toolStatus(info.tools.pen, { optional: true, detectedLabel: '已安装应用', note: '首版只做能力探测，不执行 .pen 设计操作；HTML 原型与静态交付不依赖 pen.dev' })}</div>
                <div><div class="conflict-label">OpenCode</div>${toolStatus(info.tools.opencode, { optional: true, note: '首版未接入 OpenCode 运行时；当前生产适配器为 OpenAI 兼容接口' })}</div>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><div><div class="card-title">数据与安全</div></div></div>
              <div class="card-body">
                <div class="stack" style="gap:9px">
                  <div class="list-line"><span class="bullet"></span><span>项目文件是可读 JSON / Markdown，可被 Git 版本化，也可由人工审查。</span></div>
                  <div class="list-line"><span class="bullet"></span><span>模型只看当前任务上下文；界面显示分析来源，候选知识不会自动成为已生效规则。</span></div>
                  <div class="list-line"><span class="bullet"></span><span>原型在隔离沙箱中预览，不获得桌面文件系统或模型凭据。</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>`;

  const kind = container.querySelector('#model-kind');
  const syncKind = () => {
    const isModelNow = kind.value === 'openai-compatible';
    container.querySelector('#model-fields').classList.toggle('hidden', !isModelNow);
    container.querySelector('#local-note').classList.toggle('hidden', isModelNow);
  };
  kind.addEventListener('change', syncKind);
  container.querySelector('#settings-back').addEventListener('click', () => ctx.navigate('#/home'));
  container.querySelector('#open-user-guide')?.addEventListener('click', async () => {
    try {
      await api('app:open-guide');
    } catch (error) {
      ui.toast(errorText(error), 'error');
    }
  });
  container.querySelector('#pick-projects-root').addEventListener('click', async () => {
    try {
      const picked = await api('dialog:pick-directory');
      if (picked) container.querySelector('#projects-root').value = picked;
    } catch (error) {
      ui.toast(errorText(error), 'error');
    }
  });

  const save = async ({ rerender = true } = {}) => {
    const button = container.querySelector('#settings-save');
    ui.setBusy(button, true, '保存中…');
    try {
      const payload = {
        projectsRoot: container.querySelector('#projects-root').value.trim(),
        model: {
          kind: kind.value,
          baseUrl: container.querySelector('#base-url')?.value.trim() || model.baseUrl,
          model: container.querySelector('#model-id')?.value.trim() || '',
          jsonMode: container.querySelector('#json-mode')?.checked !== false
        },
        apiKey: container.querySelector('#api-key')?.value || '',
        clearApiKey: container.querySelector('#clear-key')?.checked || false
      };
      const saved = await api('settings:update', payload);
      ctx.state.settings = saved;
      if (rerender) {
        ui.toast('设置已保存', 'success');
        await renderSettingsPage(container);
      }
      return saved;
    } catch (error) {
      container.querySelector('#settings-message').innerHTML = ui.errorBox(error);
      throw error;
    } finally {
      ui.setBusy(button, false);
    }
  };
  container.querySelector('#settings-save').addEventListener('click', () => {
    save().catch(() => {});
  });

  container.querySelector('#settings-test').addEventListener('click', async () => {
    const button = container.querySelector('#settings-test');
    const message = container.querySelector('#settings-message');
    ui.setBusy(button, true, '测试中…');
    try {
      await save({ rerender: false });
      const result = await api('settings:test-model');
      message.innerHTML = `<div class="info-box"><strong>连接测试通过</strong>${fmt.escapeHtml(result.note || '')}</div>`;
      ui.toast('连接测试通过', 'success');
    } catch (error) {
      message.innerHTML = ui.errorBox(error);
      ui.toast(errorText(error), 'error');
    } finally {
      ui.setBusy(button, false);
    }
  });
}
