## 改了什么

<!-- 一句话到位。机制改动与示例内容改动请分成两个 PR。 -->

## 为什么

<!-- 对应的 issue 编号，或这条规则/缺陷的出处（文件 + 章节）。 -->

## 如何验证

```bash
# 把实际跑过的命令与关键输出贴进来
npm run check:ui
node --test
```

- [ ] 页面 / 组件 / 示例改动：已跑 `npm run check:ui`
- [ ] 治理机制与脚本改动：已跑 `node --test`，并对改动过的脚本跑 `node --check`
- [ ] 若改了 CSS/JS 引用：已跑 `npm run cache:bust:write`，复跑 `node scripts/cache-bust-html.js` 输出 `Would update 0 HTML file(s)`
- [ ] 未提交真实业务内容（业务名称、页面数据、截图、接口地址、账号信息）

## 影响面

- 是否改变现有机检结论（原本绿的可能变红）：是 / 否
- 是否触及历史迭代、`迭代索引/snapshots/**`、`AGENTS.md`、`harness/`、`standards/`、`templates/`：是 / 否
  - 若是，逐项说明改了什么、为什么必须改
- 新增页面是否已完成源目录入口闭环（菜单项 / 承载区或 `href` / `pageNames` 映射）：是 / 否 / 不涉及

## 还没做什么

<!-- 明确列出本 PR 故意留下的部分，避免后续接力时被当成已完成。 -->
