import { api, errorText } from '../../lib/api.js';
import * as fmt from '../../lib/format.js';
import { icons } from '../../lib/icons.js';
import * as ui from '../../lib/ui.js';

const DEFAULT_ENDPOINTS = '管理后台 | 产品运营 | Web\n作业端 App | 一线作业人员 | App';

export function openNewProduct(ctx) {
  let references = [];
  let analysis = null;
  let basics = null;

  const drawer = ui.openDrawer({
    eyebrow: '新建产品',
    title: '从一个产品目标开始',
    sub: '先形成业务基线，再进入首项需求。未知项会显式保留，不会用参考案例的参数自动填满。',
    width: '700px',
    footer: '<button class="btn" data-cancel>取消</button><button class="btn primary" data-analyze data-testid="np-analyze">开始分析</button>',
    onMount(handle) {
      renderStepOne(handle);
    }
  });

  drawer.foot.addEventListener('click', async (event) => {
    if (event.target.closest('[data-cancel]')) drawer.close();
    if (event.target.closest('[data-analyze]')) {
      const button = event.target.closest('[data-analyze]');
      const name = drawer.body.querySelector('#np-name')?.value.trim();
      const goal = drawer.body.querySelector('#np-goal')?.value.trim();
      if (!name || !goal) {
        ui.toast('请先填写产品名称与目标', 'error');
        return;
      }
      basics = {
        name,
        goal,
        audience: drawer.body.querySelector('#np-audience')?.value.trim() || '',
        constraints: fmt.lines(drawer.body.querySelector('#np-constraints')?.value),
        endpoints: fmt.parseEndpoints(drawer.body.querySelector('#np-endpoints')?.value)
      };
      ui.setBusy(button, true, '分析中…');
      try {
        analysis = await api('analysis:product', {
          product: {
            ...basics,
            references: references.map((item) => ({ title: item.title, text: item.text }))
          },
          references
        });
        renderStepTwo(drawer);
      } catch (error) {
        drawer.body.querySelector('#np-error').innerHTML = ui.errorBox(error);
        ui.setBusy(button, false);
        ui.toast(errorText(error), 'error');
      }
    }
  });

  function renderStepOne(handle) {
    handle.setBody(`
      <div class="wizard-steps">
        <span class="wizard-step active"><span class="num">1</span>产品信息</span>
        <span class="wizard-step"><span class="num">2</span>确认基线</span>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="np-name">产品名称</label>
          <input class="input" id="np-name" data-testid="np-name" placeholder="例如：社区驿站取件" value="${fmt.escapeHtml(basics?.name || '')}">
        </div>
        <div class="field">
          <label for="np-goal">产品目标 <span class="label-note">真正解决什么问题，影响谁</span></label>
          <textarea class="textarea" id="np-goal" data-testid="np-goal" placeholder="例如：让门店店员快速完成取件核销，同时保证订单状态与物流推送口径清晰">${fmt.escapeHtml(basics?.goal || '')}</textarea>
        </div>
        <div class="field">
          <label for="np-audience">服务对象</label>
          <input class="input" id="np-audience" data-testid="np-audience" placeholder="例如：门店店员、取件人、站点运营" value="${fmt.escapeHtml(basics?.audience || '')}">
        </div>
        <div class="field">
          <label for="np-constraints">已有约束 <span class="label-note">一行一条；没有可留空</span></label>
          <textarea class="textarea" id="np-constraints" data-testid="np-constraints" placeholder="例如：每个取件码仅可开柜一次&#10;重复开柜不得改变订单签收状态">${fmt.escapeHtml((basics?.constraints || []).join('\n'))}</textarea>
        </div>
        <div class="field">
          <label for="np-endpoints">端与角色 <span class="label-note">每行：名称 | 角色 | 平台</span></label>
          <textarea class="textarea" id="np-endpoints" data-testid="np-endpoints" style="min-height:72px">${fmt.escapeHtml(fmt.endpointLines(basics?.endpoints || fmt.parseEndpoints(DEFAULT_ENDPOINTS)))}</textarea>
        </div>
        <div class="field">
          <label>参考资料 <span class="label-note">可选；只作为来源，不会自动变成事实</span></label>
          <div class="btn-row">
            <button class="btn small" type="button" id="np-pick-references" data-testid="np-pick-references">${icons.folder(13)} 选择文件</button>
          </div>
          <div id="np-references" class="stack" style="gap:6px;margin-top:6px">
            ${references.map((item) => `<div class="cluster" style="justify-content:space-between;border:1px solid var(--line);border-radius:9px;padding:8px 10px;background:var(--surface)"><span class="small">${fmt.escapeHtml(item.title)}<span class="tiny muted" style="display:block">${fmt.escapeHtml(item.note || item.path || '')}</span></span><button class="link small" data-remove-ref="${fmt.escapeHtml(item.path)}">移除</button></div>`).join('') || '<span class="hint">尚未选择参考资料。</span>'}
          </div>
        </div>
        <div id="np-error"></div>
      </div>`);
    handle.setFooter('<button class="btn" data-cancel>取消</button><button class="btn primary" data-analyze data-testid="np-analyze">开始分析</button>');
    handle.body.querySelector('#np-pick-references')?.addEventListener('click', async () => {
      try {
        const files = await api('dialog:pick-reference-files');
        for (const file of files) {
          if (!references.some((item) => item.path === file.path)) {
            references.push({
              ...file,
              source_ref: file.path,
              source_abs: file.path
            });
          }
        }
        renderStepOne(handle);
      } catch (error) {
        ui.toast(errorText(error), 'error');
      }
    });
    handle.body.querySelectorAll('[data-remove-ref]').forEach((button) => {
      button.addEventListener('click', () => {
        references = references.filter((item) => item.path !== button.dataset.removeRef);
        renderStepOne(handle);
      });
    });
  }

  function renderStepTwo(handle) {
    const candidates = analysis.candidate_rules || [];
    const unknowns = analysis.unknowns || [];
    handle.setBody(`
      <div class="wizard-steps">
        <span class="wizard-step done"><span class="num">1</span>产品信息</span>
        <span class="wizard-step active"><span class="num">2</span>确认基线</span>
      </div>
      <div class="stack">
        <div class="info-box">
          <strong>分析来源：${fmt.escapeHtml(analysis.source === 'local-heuristic' ? '本地规则分析（不调用模型）' : analysis.source)}</strong>
          ${fmt.escapeHtml(analysis.summary || '')}
        </div>
        ${(analysis.warnings || []).length ? `<div class="warn-box">${analysis.warnings.map((item) => fmt.escapeHtml(item)).join('<br>')}</div>` : ''}
        <div>
          <div class="section-heading"><h2>候选规则</h2><span class="sub">默认选中；只有勾选并确认的规则会进入当前基线</span></div>
          <div class="stack" style="gap:7px">
            ${candidates.length > 0 ? candidates.map((rule, index) => `<label class="candidate-row">
              <input type="checkbox" data-rule-check="${index}" data-testid="np-rule-checkbox" checked>
              <span class="body">
                <span class="st">${fmt.escapeHtml(rule.statement)}</span>
                <span class="meta"><span>${fmt.escapeHtml(rule.topic || '规则')}</span>${rule.scope ? `<span>${fmt.escapeHtml(rule.scope)}</span>` : ''}<span>${fmt.escapeHtml(rule.source || analysis.source)}</span></span>
              </span>
            </label>`).join('') : '<p class="hint">没有从文本中提取到候选规则；可以在下方补充。</p>'}
          </div>
        </div>
        <div class="field">
          <label for="np-extra-rules">补充规则 <span class="label-note">一行一条；会加入当前基线</span></label>
          <textarea class="textarea" id="np-extra-rules" style="min-height:64px" placeholder="例如：开柜失败时必须保留原取件码状态"></textarea>
        </div>
        ${unknowns.length > 0 ? `<div>
          <div class="section-heading"><h2>需要确认的未知项</h2><span class="sub">阻塞项必须回答后才能建立基线</span></div>
          <div class="stack" style="gap:8px">
            ${unknowns.map((item, index) => `<div class="unknown-item ${item.blocking ? 'blocking' : ''}">
              <div class="unknown-q">${item.blocking ? '<span class="flag">阻塞</span>' : '<span class="flag" style="color:var(--muted);background:var(--paper-2);border-color:var(--line)">提示</span>'}<span>${fmt.escapeHtml(item.question)}</span></div>
              <div class="why">${fmt.escapeHtml(item.why_blocking || '')}</div>
              <input class="input" data-unknown-answer="${index}" data-testid="np-unknown-answer" placeholder="写下业务确认；不确定时也可明确写“按现状处理”">
            </div>`).join('')}
          </div>
        </div>` : ''}
        <div class="field">
          <label for="np-endpoints-2">端与角色</label>
          <textarea class="textarea" id="np-endpoints-2" style="min-height:62px">${fmt.escapeHtml(fmt.endpointLines(basics.endpoints))}</textarea>
        </div>
        <div id="np-error"></div>
      </div>`);
    handle.setFooter(`<button class="btn" data-back>返回修改</button><button class="btn" data-cancel>取消</button><button class="btn primary" data-create data-testid="np-create">创建产品并建立基线</button>`);
    handle.foot.querySelector('[data-back]')?.addEventListener('click', () => renderStepOne(handle));
    handle.foot.querySelector('[data-cancel]')?.addEventListener('click', () => handle.close());
    handle.foot.querySelector('[data-create]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const extraRules = fmt.lines(handle.body.querySelector('#np-extra-rules')?.value);
      const endpoints = fmt.parseEndpoints(handle.body.querySelector('#np-endpoints-2')?.value);
      if (endpoints.length === 0) { ui.toast('至少需要一个端', 'error'); return; }
      const selected = [];
      candidates.forEach((rule, index) => {
        const checked = handle.body.querySelector(`[data-rule-check="${index}"]`)?.checked;
        if (checked) selected.push(rule.statement);
      });
      const extraCandidates = extraRules.map((statement) => ({
        topic: '补充规则', statement, scope: '', evidence_refs: [], source: 'user'
      }));
      const unknownAnswers = {};
      unknowns.forEach((item, index) => {
        unknownAnswers[item.question] = handle.body.querySelector(`[data-unknown-answer="${index}"]`)?.value.trim() || '';
      });
      const blockingMissing = unknowns.some((item, index) => item.blocking && !handle.body.querySelector(`[data-unknown-answer="${index}"]`)?.value.trim());
      if (blockingMissing) {
        ui.toast('请回答所有阻塞未知项', 'error');
        return;
      }
      if (selected.length === 0 && extraCandidates.length === 0) {
        ui.toast('至少确认一条规则，或补充一条规则', 'error');
        return;
      }
      ui.setBusy(button, true, '创建中…');
      try {
        const enriched = {
          ...analysis,
          candidate_rules: [...candidates, ...extraCandidates]
        };
        const result = await api('projects:create', {
          name: basics.name,
          goal: basics.goal,
          audience: basics.audience,
          constraints: basics.constraints,
          endpoints,
          references,
          analysis: enriched,
          selectedStatements: [...selected, ...extraRules],
          unknownAnswers,
          baselineName: '初始基线'
        });
        handle.close();
        ui.toast('产品与初始基线已创建', 'success');
        ctx.openProduct(result.root, 'workbench');
      } catch (error) {
        handle.body.querySelector('#np-error').innerHTML = ui.errorBox(error);
        ui.setBusy(button, false);
        ui.toast(errorText(error), 'error');
      }
    });
  }
}
