/**
 * 模块级需求文档数据源。
 * requirement：抽屉渲染用的结构化入参（doc-builder.js 渲染）。
 * content：同源全文投影，供 build-search-index.js 抽取需求文档检索文本。
 */
window.DocsData = Object.assign(window.DocsData || {}, {
  "app-order-list": {
    title: "订单列表（移动端 App）",
    requirement: {
      "coreFlow": [
        "进入订单列表，默认加载全部进行中的订单",
        "顶部搜索框支持按订单编号或物品名称检索",
        "点击订单卡片进入订单详情（本期不含详情页）"
      ],
      "fieldRows": [
        [
          "顶部",
          "搜索框",
          "默认提示文案「搜索订单编号 / 物品名称」，支持模糊匹配"
        ],
        [
          "卡片",
          "订单编号",
          "等宽小字展示，前缀 NO-"
        ],
        [
          "卡片",
          "状态标签",
          "配送中（蓝）/ 已签收（绿）/ 超时未签收（橙）"
        ],
        [
          "卡片",
          "订单摘要",
          "物品名称 × 数量 + 站点 + 时间，最多两行"
        ]
      ],
      "interactionRules": [
        "列表按创建时间倒序排列",
        "下拉刷新重新拉取第一页数据（静态原型不实现）"
      ],
      "exceptionsBoundaries": [
        "无订单时展示空状态占位与「去下单」引导",
        "超时未签收订单允许在详情页发起退回，列表页仅展示状态"
      ]
    },
    content: "订单列表（移动端 App）；coreFlow；进入订单列表，默认加载全部进行中的订单；顶部搜索框支持按订单编号或物品名称检索；点击订单卡片进入订单详情（本期不含详情页）；fieldRows；顶部；搜索框；默认提示文案「搜索订单编号 / 物品名称」，支持模糊匹配；卡片；订单编号；等宽小字展示，前缀 NO-；卡片；状态标签；配送中（蓝）/ 已签收（绿）/ 超时未签收（橙）；卡片；订单摘要；物品名称 × 数量 + 站点 + 时间，最多两行；interactionRules；列表按创建时间倒序排列；下拉刷新重新拉取第一页数据（静态原型不实现）；exceptionsBoundaries；无订单时展示空状态占位与「去下单」引导；超时未签收订单允许在详情页发起退回，列表页仅展示状态"
  }
});
/**
 * 页面级 CSS 规范数据源：docId → { headers, rows } 规范条目表。
 * 每条数据以「颜色规范 / 字体规范 / 圆角规范 / 间距规范」四章节开头，其后为页面专属条目（沿用页面原有条目）。
 * getDocCssContent(docId) 供页面级工具读取；下方回填到 DocsData 的 css 字段，供需求文档抽屉「CSS 规范」页签渲染。
 */
var DOCS_CSS_DATA = {
  "app-order-list": {
    "headers": [
      "选择器 / 元素",
      "规范说明"
    ],
    "rows": [
      [
        "颜色规范",
        "状态标签三色语义：配送中蓝 / 已签收绿 / 超时未签收橙；卡片边框 #eef2f7；编号 #94a3b8"
      ],
      [
        "字体规范",
        "顶栏 15px/700；卡片正文 13px；订单编号 11px 等宽"
      ],
      [
        "圆角规范",
        "手机模型 42px；订单卡片 14px；搜索框 999px"
      ],
      [
        "间距规范",
        "手机模型 393×852；状态栏 44px、顶栏 48px；卡片内边距 13px 14px"
      ],
      [
        ".phone",
        "手机模型 393×852，圆角 42px，深色描边 10px"
      ],
      [
        ".order-card",
        "白底卡片圆角 14px，13px 主字号，卡片间距 10px"
      ],
      [
        ".order-status",
        "状态标签 999px 圆角 + 11px 字号，三色语义与 Web 端一致"
      ],
      [
        ".control-rail",
        "右侧控制区宽 300px，半透明深色底，不进入手机模型正文"
      ]
    ]
  }
};

function getDocCssContent(docId) {
  return DOCS_CSS_DATA[docId] || { headers: [], rows: [] };
}

window.DOCS_CSS_DATA = DOCS_CSS_DATA;
window.getDocCssContent = getDocCssContent;

Object.keys(DOCS_CSS_DATA).forEach(function (docId) {
  if (window.DocsData[docId]) window.DocsData[docId].css = DOCS_CSS_DATA[docId];
});
