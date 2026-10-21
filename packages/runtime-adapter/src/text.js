const OBJECT_TERMS = [
  '取件码', '订单', '包裹', '柜格', '柜机', '门店', '站点', '仓库', '货架', '库存', '商品',
  '客户', '账户', '账单', '结算', '发票', '合同', '审批', '工单', '任务', '车辆', '路线',
  '设备', '会员', '积分', '优惠券', '价格', '员工', '商家', '用户', '记录', '快照', '日志',
  '凭证', '额度', '权限', '角色', '班次', '排班', '报表', '标签', '地址', '运单', '司机'
];

const ROLE_TERMS = [
  '管理员', '超级管理员', '操作员', '店员', '店长', '骑手', '司机', '用户', '客户',
  '财务', '审核员', '审批人', '运营', '仓管', '商家', '买家', '卖家', '员工', '主管',
  '经理', '负责人', '产品经理', '设计师', '开发', '测试'
];

const RULE_MARKERS = /(必须|不得|不能|禁止|仅|只允许|只能|需要|要求|支持|允许|可在|可再次|可重复|可重新|可以|无需|不应)/;

const STOP_TERMS = new Set(['用户', '需求', '功能', '系统', '进行', '一个', '这个', '以及', '相关', '支持', '可以']);

export function sentences(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/[。！？!?\n；;]/)
    .map((item) => item.trim().replace(/^[-*•\d.\s]+/, ''))
    .filter((item) => item.length >= 4 && item.length <= 400);
}

export function detectTerms(text, dictionary) {
  const source = String(text || '');
  const found = dictionary.filter((term) => source.includes(term));
  return [...new Set(found)];
}

export function detectObjects(text) {
  return detectTerms(text, OBJECT_TERMS);
}

export function detectRoles(text) {
  return detectTerms(text, ROLE_TERMS);
}

export function ruleLikeSentences(text) {
  return sentences(text).filter((item) => RULE_MARKERS.test(item));
}

export function detectEndpoints(text, fallbackRole = '产品运营') {
  const source = String(text || '');
  const endpoints = [];
  if (/后台|管理端|配置端|运营端/.test(source)) {
    endpoints.push({ name: '管理后台', role: '产品运营', platform: 'Web' });
  }
  if (/APP|App|app|作业端|骑手|司机|配送/.test(source)) {
    endpoints.push({ name: '作业端 App', role: '一线作业人员', platform: 'App' });
  }
  if (/小程序/.test(source)) {
    endpoints.push({ name: '小程序', role: '终端用户', platform: 'MiniProgram' });
  }
  if (/用户端|客户端|顾客|买家/.test(source)) {
    endpoints.push({ name: '用户端', role: '终端用户', platform: 'App' });
  }
  if (endpoints.length === 0) {
    endpoints.push({ name: '管理后台', role: fallbackRole, platform: 'Web' });
  }
  return endpoints.filter((item, index, list) => list.findIndex((it) => it.name === item.name) === index);
}

export function extractNumbers(text) {
  const out = [];
  const regex = /(\d+(?:\.\d+)?)\s*(分钟|小时|秒|天|次|个|元|%|％)/g;
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) {
    out.push({ value: Number(match[1]), unit: match[2] });
  }
  return out;
}

export function termsForOverlap(text) {
  const lower = String(text || '').toLowerCase();
  const terms = new Set();
  for (const term of [...OBJECT_TERMS, ...ROLE_TERMS]) {
    if (lower.includes(term)) terms.add(term);
  }
  const chunks = lower.split(/[\s，。、；;,:：/|()[\]{}"'“”‘’!?！？\-]+/).filter(Boolean);
  for (const chunk of chunks) {
    if (/[\u4e00-\u9fa5]/.test(chunk)) {
      for (let i = 0; i < chunk.length - 1; i += 1) {
        const bigram = chunk.slice(i, i + 2);
        if (!STOP_TERMS.has(bigram)) terms.add(bigram);
      }
    } else if (chunk.length >= 3) {
      terms.add(chunk);
    }
  }
  return [...terms];
}

export function overlapScore(left, right) {
  const a = new Set(termsForOverlap(left));
  const b = new Set(termsForOverlap(right));
  let score = 0;
  for (const term of a) {
    if (!b.has(term)) continue;
    if (OBJECT_TERMS.includes(term)) score += 4;
    else if (ROLE_TERMS.includes(term)) score += 2;
    else score += 1;
  }
  return score;
}

export function contradicts(existing, proposed) {
  const a = String(existing || '');
  const b = String(proposed || '');
  const repeatProposal = /(可重复|可以重复|允许重复|可再次|可以再次|允许再次|支持重复|再次开|重复开)/.test(b)
    && !/(不得|禁止|不能|不允许)/.test(b);
  const onceOnly = /(仅|只允许|只能|一次|不得重复|禁止重复)/.test(a);
  if (repeatProposal && onceOnly) return '新需求允许重复操作，而现行规则限制为一次或禁止重复';
  const negative = /(不得|禁止|不能|不允许)/.test(b);
  const positive = /(可以|允许|支持)/.test(a);
  if (negative && positive) return '新需求禁止或限制某项行为，而现行规则允许';
  const numsA = extractNumbers(a);
  const numsB = extractNumbers(b);
  for (const left of numsA) {
    for (const right of numsB) {
      if (left.unit === right.unit && left.value !== right.value) {
        return `同一时间/数量口径不同：现行 ${left.value}${left.unit}，新需求 ${right.value}${right.unit}`;
      }
    }
  }
  return null;
}

export function sentenceTopic(sentence) {
  const objects = detectObjects(sentence);
  if (objects.length > 0) return objects.slice(0, 2).join('·');
  return String(sentence || '').replace(RULE_MARKERS, '').slice(0, 18) || '业务规则';
}

export function summarize(text, max = 120) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  return source.length > max ? `${source.slice(0, max)}…` : source;
}

export { OBJECT_TERMS, ROLE_TERMS, RULE_MARKERS };
