import { api, errorText } from '../../lib/api.js';
import * as fmt from '../../lib/format.js';
import { icons } from '../../lib/icons.js';
import * as ui from '../../lib/ui.js';

export async function openNewRequirement(ctx) {
  const root = ctx.state.current.root;
  let brain;
  try {
    brain = await api('brain:list', { root });
  } catch (error) {
    ui.toast(errorText(error), 'error');
    return;
  }
  const endpoints = ctx.state.current.endpoints || [];
  const currentBaseline = brain.current_baseline;
  const baselines = brain.baselines || [];
  const model = ctx.state.settings?.model || { kind: 'local-heuristic' };

  const drawer = ui.openDrawer({
    eyebrow: '发起需求',
    title: '这次要改变什么？',
    sub: '需求会固定基线并先做影响分析。业务冲突会暂停相关生成，等待你的裁决。',
    width: '680px',
    content: `
      <div class="form-grid">
        <div class="field">
          <label for="nr-title">需求标题</label>
          <input class="input" id="nr-title" data-testid="nr-title" placeholder="例如：支持同一取件码 2 分钟内重复开柜">
        </div>
        <div class="field">
          <label for="nr-goal">目标 <span class="label-note">真正要解决的业务问题</span></label>
          <textarea class="textarea" id="nr-goal" data-testid="nr-goal" style="min-height:70px" placeholder="例如：在不改变订单签收状态的前提下，允许短时重复开柜"></textarea>
        </div>
        <div class="field">
          <label for="nr-raw">需求描述与约束 <span class="label-note">尽量写出必须 / 不得 / 仅等业务约束</span></label>
          <textarea class="textarea" id="nr-raw" data-testid="nr-raw" style="min-height:120px" placeholder="例如：同一取件码在 2 分钟内可重复开柜，不改变订单状态。重复开柜不得触发新的物流推送。"></textarea>
        </div>
        <div class="field">
          <label for="nr-baseline">业务基线</label>
          <select class="select" id="nr-baseline" data-testid="nr-baseline">
            ${baselines.map((baseline) => `<option value="${fmt.escapeHtml(baseline.id)}" ${baseline.id === currentBaseline?.id ? 'selected' : ''}>${fmt.escapeHtml(baseline.name)} · ${fmt.escapeHtml(fmt.statusLabel(baseline.status))}</option>`).join('')}
          </select>
          <div class="hint">默认使用当前基线。选择计划基线表示本次设计依据已确认但尚未生效的下一版规则。</div>
        </div>
        <div class="field">
          <label>涉及端</label>
          <div class="stack" style="gap:6px">
            ${endpoints.map((endpoint) => `<label class="checkbox-row"><input type="checkbox" data-endpoint="${fmt.escapeHtml(endpoint.id)}" checked> <span>${fmt.escapeHtml(endpoint.name)}<span class="sub">${fmt.escapeHtml(endpoint.role || '')} · ${fmt.escapeHtml(endpoint.platform || '')}</span></span></label>`).join('') || '<p class="hint">产品没有配置端。</p>'}
          </div>
        </div>
        <div class="info-box"><strong>分析来源：${fmt.escapeHtml(model.kind === 'local-heuristic' ? '本地规则分析（不调用模型）' : `模型 · ${model.model || '未配置'}`)}</strong>分析结果会标注来源；候选规则不会自动成为已生效规则。</div>
        <div id="nr-error"></div>
      </div>`,
    footer: '<button class="btn" data-cancel>取消</button><button class="btn primary" data-create data-testid="nr-create">创建并分析</button>',
    onMount(handle) {
      handle.foot.querySelector('[data-cancel]').addEventListener('click', () => handle.close());
      handle.foot.querySelector('[data-create]').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const title = handle.body.querySelector('#nr-title')?.value.trim();
        const goal = handle.body.querySelector('#nr-goal')?.value.trim();
        const rawInput = handle.body.querySelector('#nr-raw')?.value.trim() || '';
        const baselineId = handle.body.querySelector('#nr-baseline')?.value;
        const endpointIds = [...handle.body.querySelectorAll('[data-endpoint]:checked')].map((item) => item.dataset.endpoint);
        if (!title || !goal) { ui.toast('需求标题与目标不能为空', 'error'); return; }
        if (endpointIds.length === 0) { ui.toast('至少选择一个涉及端', 'error'); return; }
        ui.setBusy(button, true, '创建并分析…');
        let created;
        try {
          created = await api('requirements:create', {
            root,
            title,
            goal,
            rawInput,
            baselineId,
            endpointIds
          });
        } catch (error) {
          handle.body.querySelector('#nr-error').innerHTML = ui.errorBox(error);
          ui.setBusy(button, false);
          ui.toast(errorText(error), 'error');
          return;
        }
        try {
          await api('requirements:analyze', { root, requirementId: created.id });
          ui.toast('需求已创建并完成分析', 'success');
        } catch (error) {
          ui.toast(`需求已创建，但分析未完成：${errorText(error)}`, 'error', 6000);
        }
        handle.close();
        ctx.navigate(ctx.productHash(root, 'requirements', created.id));
      });
    }
  });
}
