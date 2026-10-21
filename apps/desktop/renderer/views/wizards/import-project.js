import { api, errorText } from '../../lib/api.js';
import * as fmt from '../../lib/format.js';
import { icons } from '../../lib/icons.js';
import * as ui from '../../lib/ui.js';

export function openImportProject(ctx) {
  let scan = null;
  let sourceRoot = '';

  const drawer = ui.openDrawer({
    eyebrow: '接入已有项目',
    title: '先建立映射，再决定基线',
    sub: '原始目录只读。导入会提取带来源的候选知识；冲突未裁决前不会进入当前基线。',
    width: '760px',
    footer: '<button class="btn" data-cancel>取消</button><button class="btn primary" data-scan data-testid="ip-scan">扫描目录</button>',
    onMount(handle) {
      renderStepOne(handle);
    }
  });

  drawer.foot.addEventListener('click', async (event) => {
    if (event.target.closest('[data-cancel]')) drawer.close();
    const scanButton = event.target.closest('[data-scan]');
    if (scanButton) {
      const input = drawer.body.querySelector('#ip-source');
      const value = input?.value.trim();
      if (!value) { ui.toast('请填写或选择项目目录', 'error'); return; }
      ui.setBusy(scanButton, true, '扫描中…');
      try {
        scan = await api('projects:import-scan', { sourceRoot: value });
        sourceRoot = value;
        renderStepTwo(drawer);
      } catch (error) {
        drawer.body.querySelector('#ip-error').innerHTML = ui.errorBox(error);
        ui.setBusy(scanButton, false);
        ui.toast(errorText(error), 'error');
      }
    }
  });

  function renderStepOne(handle) {
    handle.setBody(`
      <div class="wizard-steps">
        <span class="wizard-step active"><span class="num">1</span>选择目录</span>
        <span class="wizard-step"><span class="num">2</span>确认知识与冲突</span>
      </div>
      <div class="form-grid">
        <div class="info-box"><strong>支持范围</strong>Markdown、纯文本、JSON、HTML、CSS；单文件 ≤ 2 MB，最多 4000 个文件。目录中的脚本不会被执行，原文件不会被修改。</div>
        <div class="field">
          <label for="ip-source">已有项目目录</label>
          <div class="inline-field">
            <input class="input" id="ip-source" data-testid="ip-source" placeholder="/Users/you/Projects/your-product" value="${fmt.escapeHtml(sourceRoot)}">
            <button class="btn" type="button" id="ip-browse">${icons.folder(14)} 浏览</button>
          </div>
          <div class="hint">项目空间会创建在 ${fmt.escapeHtml(ctx.state.settings?.projectsRoot || '设置中的项目目录')}，不会写入来源目录。</div>
        </div>
        <div class="field">
          <label>扫描会识别什么</label>
          <div class="stack" style="gap:7px">
            <div class="list-line"><span class="bullet"></span><span>产品、端与角色线索，以及文件清单和内容摘要</span></div>
            <div class="list-line"><span class="bullet"></span><span>带 rule_key / 标题 / 段落定位的候选规则；历史状态会单独标记</span></div>
            <div class="list-line"><span class="bullet"></span><span>同一主题的不同口径会形成冲突，必须由你选择当前口径</span></div>
            <div class="list-line"><span class="bullet"></span><span>页面、内联颜色、CSS 声明值与用途</span></div>
          </div>
        </div>
        <div id="ip-error"></div>
      </div>`);
    handle.setFooter('<button class="btn" data-cancel>取消</button><button class="btn primary" data-scan data-testid="ip-scan">扫描目录</button>');
    handle.body.querySelector('#ip-browse')?.addEventListener('click', async () => {
      try {
        const picked = await api('dialog:pick-directory');
        if (picked) handle.body.querySelector('#ip-source').value = picked;
      } catch (error) {
        ui.toast(errorText(error), 'error');
      }
    });
  }

  function renderStepTwo(handle) {
    const currentCandidates = (scan.candidates || []).filter((item) => !(scan.conflicts || []).some((conflict) => conflict.candidates.includes(item.id)));
    handle.setBody(`
      <div class="wizard-steps">
        <span class="wizard-step done"><span class="num">1</span>选择目录</span>
        <span class="wizard-step active"><span class="num">2</span>确认知识与冲突</span>
      </div>
      <div class="stack">
        <div class="info-box"><strong>扫描完成：${fmt.escapeHtml(scan.product_guess)}</strong>${fmt.escapeHtml(scan.source_root)}</div>
        <div class="scan-stats">
          <div class="scan-stat"><strong>${scan.stats.files_scanned}</strong><span>文件</span></div>
          <div class="scan-stat"><strong>${scan.stats.candidates}</strong><span>候选规则</span></div>
          <div class="scan-stat"><strong>${scan.stats.conflicts}</strong><span>冲突</span></div>
          <div class="scan-stat"><strong>${scan.stats.evidence}</strong><span>来源证据</span></div>
        </div>
        ${(scan.warnings || []).length ? `<div class="warn-box">${scan.warnings.map((item) => fmt.escapeHtml(item)).join('<br>')}</div>` : ''}
        <div class="form-grid two">
          <div class="field"><label for="ip-name">产品名称</label><input class="input" id="ip-name" data-testid="ip-name" value="${fmt.escapeHtml(scan.product_guess)}"></div>
          <div class="field"><label for="ip-goal">产品目标</label><input class="input" id="ip-goal" value="${fmt.escapeHtml(scan.goal_guess || '')}" placeholder="可修改"></div>
        </div>
        <div class="field">
          <label for="ip-endpoints">端与角色 <span class="label-note">每行：名称 | 角色 | 平台</span></label>
          <textarea class="textarea" id="ip-endpoints" style="min-height:64px">${fmt.escapeHtml(fmt.endpointLines(scan.endpoints_guess || []))}</textarea>
        </div>
        ${(scan.conflicts || []).length > 0 ? `<div>
          <div class="section-heading"><h2>必须裁决的口径冲突</h2><span class="sub">${scan.conflicts.length} 组</span></div>
          <div class="stack" style="gap:10px">
            ${scan.conflicts.map((conflict, conflictIndex) => `<div class="conflict-box" data-conflict="${fmt.escapeHtml(conflict.id)}">
              <div class="title">${fmt.escapeHtml(conflict.topic)}</div>
              <div class="why">${fmt.escapeHtml(conflict.why)}</div>
              <div class="candidate-choice">
                ${(scan.candidates || []).filter((item) => conflict.candidates.includes(item.id)).map((candidate) => `<label class="${candidate.id === conflict.recommendation ? 'selected' : ''}">
                  <input type="radio" name="conflict-${conflictIndex}" value="${fmt.escapeHtml(candidate.id)}" data-conflict-choice="${fmt.escapeHtml(conflict.id)}" ${candidate.id === conflict.recommendation ? 'checked' : ''}>
                  <span><strong>${fmt.escapeHtml(candidate.topic)} · ${fmt.escapeHtml(candidate.status === 'current' ? '当前口径' : '历史口径')}</strong><span style="display:block;color:var(--muted);margin-top:2px">${fmt.escapeHtml(candidate.statement)}</span><span class="mono tiny" style="display:block;margin-top:3px">${fmt.escapeHtml(candidate.source_ref)} · ${fmt.escapeHtml(candidate.locator)}</span></span>
                </label>`).join('')}
              </div>
              <div class="field">
                <label>裁决理由 <span class="label-note">必填；被否定方案会保留</span></label>
                <input class="input" data-conflict-reason="${fmt.escapeHtml(conflict.id)}" data-testid="ip-conflict-reason" placeholder="例如：以已评审的当前口径为准，历史方案仅用于解释">
              </div>
            </div>`).join('')}
          </div>
        </div>` : ''}
        <div>
          <div class="section-heading"><h2>其他候选知识</h2><span class="sub">勾选后进入导入基线</span></div>
          <div class="stack" style="gap:7px">
            ${currentCandidates.length > 0 ? currentCandidates.map((candidate) => `<label class="candidate-row">
              <input type="checkbox" data-candidate="${fmt.escapeHtml(candidate.id)}" ${candidate.status === 'current' ? 'checked' : ''}>
              <span class="body">
                <span class="st">${fmt.escapeHtml(candidate.statement)}</span>
                <span class="meta"><span>${fmt.escapeHtml(candidate.topic || '规则')}</span><span>${fmt.escapeHtml(candidate.status)}</span><span class="mono">${fmt.escapeHtml(candidate.source_ref)}</span>${candidate.heuristic ? '<span>启发式</span>' : ''}</span>
              </span>
            </label>`).join('') : '<p class="hint">没有其他候选规则。</p>'}
          </div>
        </div>
        <details>
          <summary class="hint" style="cursor:pointer">查看扫描清单（${(scan.inventory || []).length} 个文件）</summary>
          <div class="inventory-list" style="margin-top:8px">
            ${(scan.inventory || []).map((item) => `<div>${fmt.escapeHtml(item.path)} · ${fmt.escapeHtml(item.title || '')}</div>`).join('') || '无'}
          </div>
        </details>
        ${(scan.skipped || []).length ? `<details><summary class="hint" style="cursor:pointer">查看跳过项（${scan.skipped.length}）</summary><div class="inventory-list" style="margin-top:8px">${scan.skipped.map((item) => `<div>${fmt.escapeHtml(item.path)} · ${fmt.escapeHtml(item.reason)}</div>`).join('')}</div></details>` : ''}
        <div id="ip-error"></div>
      </div>`);
    handle.setFooter('<button class="btn" data-back>返回</button><button class="btn" data-cancel>取消</button><button class="btn primary" data-create data-testid="ip-create">创建项目与导入基线</button>');
    handle.foot.querySelector('[data-back]')?.addEventListener('click', () => renderStepOne(handle));
    handle.foot.querySelector('[data-cancel]')?.addEventListener('click', () => handle.close());
    handle.foot.querySelector('[data-create]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const name = handle.body.querySelector('#ip-name')?.value.trim();
      const goal = handle.body.querySelector('#ip-goal')?.value.trim();
      const endpoints = fmt.parseEndpoints(handle.body.querySelector('#ip-endpoints')?.value);
      if (!name) { ui.toast('产品名称不能为空', 'error'); return; }
      if (endpoints.length === 0) { ui.toast('至少需要一个端', 'error'); return; }
      const selectedCandidateIds = [...handle.body.querySelectorAll('[data-candidate]:checked')].map((item) => item.dataset.candidate);
      const conflictResolutions = {};
      let missingReason = false;
      (scan.conflicts || []).forEach((conflict) => {
        const chosen = handle.body.querySelector(`[data-conflict-choice="${CSS.escape(conflict.id)}"]:checked`)?.value;
        const reason = handle.body.querySelector(`[data-conflict-reason="${CSS.escape(conflict.id)}"]`)?.value.trim();
        if (!reason) missingReason = true;
        conflictResolutions[conflict.id] = { chosenCandidateId: chosen, reason };
        if (chosen) selectedCandidateIds.push(chosen);
      });
      if (missingReason) { ui.toast('每组冲突都需要填写裁决理由', 'error'); return; }
      ui.setBusy(button, true, '导入中…');
      try {
        const result = await api('projects:import-apply', {
          sourceRoot,
          name,
          goal,
          endpoints,
          selectedCandidateIds,
          conflictResolutions
        });
        handle.close();
        ui.toast('已有项目已接入并形成导入基线', 'success');
        ctx.openProduct(result.root, 'workbench');
      } catch (error) {
        handle.body.querySelector('#ip-error').innerHTML = ui.errorBox(error);
        ui.setBusy(button, false);
        ui.toast(errorText(error), 'error');
      }
    });
  }
}
