'use strict';

// H03A：Task-Auth 验证器（任务授权验证器）。
// 语义唯一来源：standards/授权词表.md（L3×18、L2×6、非授权×8，2026-07-10 全量确认）。
// 词条硬编码于本文件（任务包 Slice A 停止条件：不得在运行时读取词表文件）。
// 纯函数：不读取文件系统、不执行 git 命令、不发起网络请求；所有判定只依赖传入参数。
//
// 判定规则（确定性）：
//   1. 空消息 → fail（无授权消息）
//   2. 旧授权继承标记（"上次说过/之前已授权/上一轮/旧会话"）→ fail（旧授权继承不合法），
//      即使消息同时包含 L3 词条（A00-06）
//   3. 长词优先词条匹配：全部 32 词条按长度降序，首个命中词条决定级别
//      ——非授权短语（如"分析一下"）长于 L3"继续"→ "继续分析一下"命中非授权（A00-08）
//      ——L3"执行修复"长于非授权"修复"→ "执行修复"命中 L3
//   4. 命中 L3 后对象检查：
//      - plannedFiles 为空 → fail（计划目标文件为空）
//      - 消息中出现 ≥2 个不同对象引用 → fail（多对象歧义，A00-04）
//      - 消息中出现 1 个对象引用但与 plannedFiles 无交集 → fail（授权对象不一致，A00-05）
//      - 消息中无对象引用（依赖上下文对象）且 plannedFiles 非空 → pass（A00-01）
//   5. 命中 L2 → fail（缺 L3）；命中非授权 → fail（非授权/讨论态）

// ---- 词条表（与 standards/授权词表.md 逐条对应，硬编码）----
const L3_TERMS = Object.freeze([
  '继续按刚才方案执行', '执行修复', '补充到规则里', '补充到 Harness', '写入文档', '执行方案', '开始改', '直接做',
  '按这个改', '落文档', '落报告', '输出 md', '更新规则', '优化一下', '改一下', '补充', '继续', '执行'
]);

const L2_TERMS = Object.freeze([
  '需求说明 OK', '同意该方案', '方案 OK', '按这个方向', '可以先准备', '可以做'
]);

// 非授权词条：按长到短，避免"修复"被"执行修复"误吞
const NON_AUTH_TERMS = Object.freeze([
  '帮我修复一下', '帮我看下', '分析一下', '先讨论', '怎么优化', '看看', '审一下', '查一下', '修复'
]);

const OLD_AUTH_MARKERS = Object.freeze(['上次说过', '之前已授权', '上一轮', '旧会话', '以前已授权']);

// 消息中的对象引用提取：backtick 引用 + 常见文件/模块路径模式。
// 返回去重后的对象引用列表（按出现顺序）。
function extractObjectRefs(message) {
  const refs = [];
  const seen = new Set();
  const push = (value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    refs.push(trimmed);
  };
  // backtick 引用：`...`
  const backtickPattern = /`([^`]+)`/g;
  let match;
  while ((match = backtickPattern.exec(message)) !== null) push(match[1]);
  // 路径/文件引用：a/b/c.ext 或 a/b/c 目录形态（排除常见中文与空白）
  const pathPattern = /(?:^|[\s，。、,;：:])([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})(?=$|[\s，。、,;：:])/g;
  while ((match = pathPattern.exec(message)) !== null) push(match[1]);
  return refs;
}

// 对象引用与计划文件是否匹配：精确相等或路径后缀相等（不含前导 ./）。
function refMatchesPlanned(ref, plannedFiles) {
  const normalize = (value) => value.replace(/^\.\//, '').replace(/\/+$/, '');
  const target = normalize(ref);
  return plannedFiles.some((file) => {
    const planned = normalize(file);
    return planned === target || planned.endsWith(`/${target}`) || target.endsWith(`/${planned}`);
  });
}

// 判定授权是否覆盖计划目标。
// 输入：{ message: string, plannedFiles: string[] }
// 输出：{ level: 'L3'|'L2'|'none', matched_term: string|null, verdict: 'pass'|'fail', reason: string }
function checkTaskAuth({ message, plannedFiles }) {
  const msg = typeof message === 'string' ? message : '';
  const planned = Array.isArray(plannedFiles) ? plannedFiles : [];

  // 1. 空消息
  if (msg.trim().length === 0) {
    return { level: 'none', matched_term: null, verdict: 'fail', reason: '无授权消息（消息为空）' };
  }

  // 2. 旧授权继承标记（先于词条匹配：即使含 L3 词也不合法）
  if (OLD_AUTH_MARKERS.some((marker) => msg.includes(marker))) {
    return { level: 'none', matched_term: null, verdict: 'fail', reason: `旧授权继承不合法（命中 ${OLD_AUTH_MARKERS.find((marker) => msg.includes(marker))}）` };
  }

  // 3. 长词优先词条匹配（全部词条按长度降序）
  const allTerms = [
    ...L3_TERMS.map((term) => ({ term, level: 'L3' })),
    ...L2_TERMS.map((term) => ({ term, level: 'L2' })),
    ...NON_AUTH_TERMS.map((term) => ({ term, level: 'none' }))
  ].sort((a, b) => b.term.length - a.term.length);

  let matched = null;
  for (const entry of allTerms) {
    if (msg.toLowerCase().includes(entry.term.toLowerCase())) {
      matched = entry;
      break;
    }
  }

  if (matched === null) {
    return { level: 'none', matched_term: null, verdict: 'fail', reason: '未命中任何授权词条（无授权表达）' };
  }

  if (matched.level === 'none') {
    return { level: 'none', matched_term: matched.term, verdict: 'fail', reason: `非授权词条（讨论/分析态）：${matched.term}` };
  }

  if (matched.level === 'L2') {
    return { level: 'L2', matched_term: matched.term, verdict: 'fail', reason: `仅命中 L2 词条（${matched.term}），缺少 L3 明确授权` };
  }

  // 4. L3 对象检查
  if (planned.length === 0) {
    return { level: 'L3', matched_term: matched.term, verdict: 'fail', reason: '计划目标文件为空（L3 授权无执行对象）' };
  }

  const refs = extractObjectRefs(msg);
  if (refs.length >= 2) {
    return { level: 'L3', matched_term: matched.term, verdict: 'fail', reason: `多对象歧义：消息含 ${refs.length} 个对象引用（${refs.join('、')}），plannedFiles 无法唯一映射` };
  }
  if (refs.length === 1) {
    if (!refMatchesPlanned(refs[0], planned)) {
      return { level: 'L3', matched_term: matched.term, verdict: 'fail', reason: `授权对象不一致：消息对象 ${refs[0]} 与计划目标 ${planned.join('、')} 无交集` };
    }
    return { level: 'L3', matched_term: matched.term, verdict: 'pass', reason: `L3 授权命中（${matched.term}），对象 ${refs[0]} 与计划目标匹配` };
  }

  // 无显式对象引用：依赖上下文对象（plannedFiles 即上下文），单一明确
  return { level: 'L3', matched_term: matched.term, verdict: 'pass', reason: `L3 授权命中（${matched.term}），上下文对象由 plannedFiles 唯一确定（${planned.join('、')}）` };
}

module.exports = {
  L3_TERMS,
  L2_TERMS,
  NON_AUTH_TERMS,
  OLD_AUTH_MARKERS,
  extractObjectRefs,
  refMatchesPlanned,
  checkTaskAuth
};
