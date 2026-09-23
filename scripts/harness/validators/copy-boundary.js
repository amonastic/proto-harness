'use strict';

// H03B：Copy-Boundary 验证器（页面正文边界词）。
// 判定规则来源：DEVELOPMENT.md 第 103 条（开发说明/测试提示等不得进入真实页面正文）。
// 边界词表硬编码（任务包第 8 节，不运行时读文件）。
// 纯函数：只扫描传入的 pageBodyText 字符串，不读取文件系统、不执行任何 I/O。
//
// 输出：{ verdict: 'pass'|'fail', hits: [{ term, position, context }] }
// 逐词扫描，每命中一处记录 charIndex 位置与前后 30 字上下文；命中 >0 即 fail。

const BOUNDARY_TERMS = Object.freeze([
  '开发说明', '测试提示', '模拟操作', '仅供测试', '调试用', '临时注释',
  '待删除', '待确认', 'TODO', 'FIXME', 'HACK', 'DEBUG'
]);

const CONTEXT_RADIUS = 30;

function checkCopyBoundary({ pageBodyText }) {
  if (typeof pageBodyText !== 'string') throw new Error('H03B_COPY pageBodyText must be string');

  const hits = [];
  for (const term of BOUNDARY_TERMS) {
    let position = pageBodyText.indexOf(term);
    while (position !== -1) {
      const start = Math.max(0, position - CONTEXT_RADIUS);
      const end = Math.min(pageBodyText.length, position + term.length + CONTEXT_RADIUS);
      hits.push({
        term,
        position,
        context: pageBodyText.slice(start, end)
      });
      position = pageBodyText.indexOf(term, position + term.length);
    }
  }

  // 按出现位置排序，保证输出确定性
  hits.sort((a, b) => a.position - b.position || a.term.localeCompare(b.term));

  return { verdict: hits.length > 0 ? 'fail' : 'pass', hits };
}

module.exports = {
  BOUNDARY_TERMS,
  CONTEXT_RADIUS,
  checkCopyBoundary
};
