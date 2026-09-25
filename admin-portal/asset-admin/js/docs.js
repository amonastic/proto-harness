/**
 * 模块级需求文档数据源。
 * requirement：抽屉渲染用的结构化入参（doc-builder.js 渲染）。
 * content：同源全文投影，供 build-search-index.js 抽取需求文档检索文本。
 */
window.DocsData = Object.assign(window.DocsData || {}, {
  "asset-admin-module": {
    title: "资产管理模块（承载页）",
    requirement: {
      "coreFlow": [
        "在左侧菜单选择功能页面，右侧 iframe 加载对应源页面",
        "支持通过 URL 参数 ?page=页面ID 直达指定功能页",
        "需求文档按钮固定在顶栏右侧，手动打开抽屉"
      ],
      "fieldRows": [
        [
          "承载页",
          "pageNames",
          "页面 ID 到中文名的映射，用于顶栏标题与菜单高亮"
        ],
        [
          "承载页",
          "iframe src",
          "指向 pages/ 下的源页面，模块承载页不直接写业务内容"
        ],
        [
          "承载页",
          "data-page",
          "菜单项与 page-section 一一对应，切换时同步顶栏标题"
        ]
      ],
      "interactionRules": [
        "点击菜单项切换 active 状态与对应 page-section 显示",
        "URL 显式参数 ?page=xxx 的优先级高于默认第一项",
        "承载页需求抽屉展示的是模块级说明，具体页面规则在各自源页面抽屉中"
      ],
      "exceptionsBoundaries": [
        "pageNames 未覆盖的页面 ID 进入时，标题回退为「资产管理」"
      ]
    },
    content: "资产管理模块（承载页）；coreFlow；在左侧菜单选择功能页面，右侧 iframe 加载对应源页面；支持通过 URL 参数 ?page=页面ID 直达指定功能页；需求文档按钮固定在顶栏右侧，手动打开抽屉；fieldRows；承载页；pageNames；页面 ID 到中文名的映射，用于顶栏标题与菜单高亮；承载页；iframe src；指向 pages/ 下的源页面，模块承载页不直接写业务内容；承载页；data-page；菜单项与 page-section 一一对应，切换时同步顶栏标题；interactionRules；点击菜单项切换 active 状态与对应 page-section 显示；URL 显式参数 ?page=xxx 的优先级高于默认第一项；承载页需求抽屉展示的是模块级说明，具体页面规则在各自源页面抽屉中；exceptionsBoundaries；pageNames 未覆盖的页面 ID 进入时，标题回退为「资产管理」"
  },
  "asset-list": {
    title: "资产列表",
    requirement: {
      "coreFlow": [
        "按关键字 / 类型 / 状态组合筛选资产台账",
        "列表展示资产编号、名称、类型、归属站点、状态与到期日期",
        "临近到期资产以橙色标签提示，点击行进入资产详情（本期不含）"
      ],
      "filterRows": [
        [
          "关键字",
          "文本输入，支持资产编号与名称模糊匹配",
          "资产台账接口"
        ],
        [
          "资产类型",
          "下拉单选：全部 / 标签类 / 设备类",
          "类型字典"
        ],
        [
          "状态",
          "下拉单选：全部 / 使用中 / 闲置 / 临近到期",
          "状态字段"
        ]
      ],
      "fieldRows": [
        [
          "列表列",
          "资产编号",
          "唯一编号，等宽字体展示"
        ],
        [
          "列表列",
          "状态",
          "枚举标签：使用中（绿）/ 闲置（灰）/ 临近到期（橙）"
        ],
        [
          "列表列",
          "到期日期",
          "YYYY-MM-DD；空值展示为 -"
        ],
        [
          "列表列",
          "归属站点",
          "站点名称，超长省略并悬浮展示全称"
        ]
      ],
      "interactionRules": [
        "查询按钮提交当前筛选条件并回到第一页",
        "重置按钮清空筛选条件但不自动查询",
        "分页仅展示页码占位，本期不实现真实翻页"
      ],
      "exceptionsBoundaries": [
        "筛选无结果时列表区展示空状态占位",
        "资产编号重复属数据异常，列表按原值展示并在详情页提示"
      ],
      "todoOpenQuestions": [
        "资产导出能力是否需要在本期一并提供"
      ]
    },
    content: "资产列表；coreFlow；按关键字 / 类型 / 状态组合筛选资产台账；列表展示资产编号、名称、类型、归属站点、状态与到期日期；临近到期资产以橙色标签提示，点击行进入资产详情（本期不含）；filterRows；关键字；文本输入，支持资产编号与名称模糊匹配；资产台账接口；资产类型；下拉单选：全部 / 标签类 / 设备类；类型字典；状态；下拉单选：全部 / 使用中 / 闲置 / 临近到期；状态字段；fieldRows；列表列；资产编号；唯一编号，等宽字体展示；列表列；状态；枚举标签：使用中（绿）/ 闲置（灰）/ 临近到期（橙）；列表列；到期日期；YYYY-MM-DD；空值展示为 -；列表列；归属站点；站点名称，超长省略并悬浮展示全称；interactionRules；查询按钮提交当前筛选条件并回到第一页；重置按钮清空筛选条件但不自动查询；分页仅展示页码占位，本期不实现真实翻页；exceptionsBoundaries；筛选无结果时列表区展示空状态占位；资产编号重复属数据异常，列表按原值展示并在详情页提示；todoOpenQuestions；资产导出能力是否需要在本期一并提供"
  }
});
/**
 * 页面级 CSS 规范数据源：docId → { headers, rows } 规范条目表。
 * 每条数据以「颜色规范 / 字体规范 / 圆角规范 / 间距规范」四章节开头，其后为页面专属条目（沿用页面原有条目）。
 * getDocCssContent(docId) 供页面级工具读取；下方回填到 DocsData 的 css 字段，供需求文档抽屉「CSS 规范」页签渲染。
 */
var DOCS_CSS_DATA = {
  "asset-admin-module": {
    "headers": [
      "选择器 / 元素",
      "规范说明"
    ],
    "rows": [
      [
        "颜色规范",
        "侧栏底色 #0f172a；导航文字 #cbd5e1，激活态浅蓝底；顶栏白底 + 1px #e5e7eb 下边线"
      ],
      [
        "字体规范",
        "模块名 15px/700；导航项 13px；顶栏标题 15px；需求文档按钮 12px"
      ],
      [
        "圆角规范",
        "菜单项 9px；需求文档按钮 8px；承载区不加圆角"
      ],
      [
        "间距规范",
        "侧栏内边距 22px 14px；菜单项内边距 9px 10px；顶栏内边距 12px 22px"
      ],
      [
        ".module-sidebar",
        "深色侧栏固定 232px，菜单项圆角 9px，激活态用浅蓝底"
      ],
      [
        ".module-topbar",
        "白底顶栏 12px/22px 内边距，右侧固定需求文档按钮"
      ],
      [
        ".page-section",
        "默认 display:none，active 时 display:flex 并铺满剩余高度"
      ],
      [
        "iframe",
        "去除边框，背景 #f8fafc，与源页面背景保持一致"
      ]
    ]
  },
  "asset-list": {
    "headers": [
      "选择器 / 元素",
      "规范说明"
    ],
    "rows": [
      [
        "颜色规范",
        "入口按钮 #0369a1 + 浅蓝底 #f0f9ff；边框 #e5e7eb；文字 #0f172a / #64748b / #94a3b8"
      ],
      [
        "字体规范",
        "区块标题 15px/600；表头 12.5px；正文 13px；辅助说明 12px"
      ],
      [
        "圆角规范",
        "筛选区与卡片 12px；输入与下拉 8px；状态标签 999px"
      ],
      [
        "间距规范",
        "筛选区内边距 14px 16px，与列表间距 16px；控件高 32px"
      ],
      [
        ".filter-bar",
        "白底卡片，圆角 12px，控件间距 10px，输入框高 32px"
      ],
      [
        "table thead th",
        "浅灰底 #f8fafc，12.5px 字号，左对齐，行高由 11px 内边距撑开"
      ],
      [
        ".tag-inuse / .tag-idle / .tag-expiring",
        "状态标签统一 999px 圆角 + 11px 字号，绿 / 灰 / 橙三色语义"
      ],
      [
        ".table-foot",
        "列表底部信息条，左侧计数、右侧页码，12px 弱化字色"
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
