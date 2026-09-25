/**
 * 模块级需求文档数据源。
 * requirement：抽屉渲染用的结构化入参（doc-builder.js 渲染）。
 * content：同源全文投影，供 build-search-index.js 抽取需求文档检索文本。
 */
window.DocsData = Object.assign(window.DocsData || {}, {
  "miniapp-order-create": {
    title: "下单页（小程序）",
    requirement: {
      "coreFlow": [
        "选择寄件地址与收件地址",
        "填写物品名称与数量",
        "选择期望送达时间段并提交订单"
      ],
      "fieldRows": [
        [
          "地址区",
          "寄件地址",
          "默认带出上次使用地址，可重新选择"
        ],
        [
          "地址区",
          "收件地址",
          "必填；未选择时提交按钮置灰"
        ],
        [
          "物品区",
          "物品名称",
          "必填，20 字以内"
        ],
        [
          "物品区",
          "物品数量",
          "默认 1，整数，1–99"
        ],
        [
          "时间区",
          "期望送达",
          "时间段选项由站点配送时段决定"
        ],
        [
          "时间区",
          "备注",
          "选填，50 字以内"
        ]
      ],
      "interactionRules": [
        "提交前校验必填项，未通过时定位到首个缺失项",
        "提交成功后进入订单详情并提示结果"
      ],
      "exceptionsBoundaries": [
        "站点未配置配送时段时，期望送达项展示为「暂不可选」"
      ]
    },
    content: "下单页（小程序）；coreFlow；选择寄件地址与收件地址；填写物品名称与数量；选择期望送达时间段并提交订单；fieldRows；地址区；寄件地址；默认带出上次使用地址，可重新选择；地址区；收件地址；必填；未选择时提交按钮置灰；物品区；物品名称；必填，20 字以内；物品区；物品数量；默认 1，整数，1–99；时间区；期望送达；时间段选项由站点配送时段决定；时间区；备注；选填，50 字以内；interactionRules；提交前校验必填项，未通过时定位到首个缺失项；提交成功后进入订单详情并提示结果；exceptionsBoundaries；站点未配置配送时段时，期望送达项展示为「暂不可选」"
  }
});
/**
 * 页面级 CSS 规范数据源：docId → { headers, rows } 规范条目表。
 * 每条数据以「颜色规范 / 字体规范 / 圆角规范 / 间距规范」四章节开头，其后为页面专属条目（沿用页面原有条目）。
 * getDocCssContent(docId) 供页面级工具读取；下方回填到 DocsData 的 css 字段，供需求文档抽屉「CSS 规范」页签渲染。
 */
var DOCS_CSS_DATA = {
  "miniapp-order-create": {
    "headers": [
      "选择器 / 元素",
      "规范说明"
    ],
    "rows": [
      [
        "颜色规范",
        "卡片边框 #eef2f7；分隔线 #f1f5f9；标签 #334155；未填值 #94a3b8 / 已填 #0f172a"
      ],
      [
        "字体规范",
        "顶栏 15px/700；表单标签与取值 13px；辅助 12px"
      ],
      [
        "圆角规范",
        "表单卡片 14px；提交按钮 999px"
      ],
      [
        "间距规范",
        "表单行内边距 13px 0；卡片内边距 4px 14px、卡间距 12px；底部栏 12px 16px 22px"
      ],
      [
        ".phone",
        "小程序模型 375×812，圆角 40px，深色描边 10px"
      ],
      [
        ".form-card",
        "白底圆角 14px，行内 13px 字号，分节间距 12px"
      ],
      [
        ".form-row",
        "左右分栏布局，右侧值弱化字色，占位态 #94a3b8"
      ],
      [
        ".btn-submit",
        "底部主按钮高 44px，999px 圆角，全宽"
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
