/* 自动生成，请勿手动编辑。运行 node scripts/build-search-index.js 重新生成 */
window.__SEARCH_INDEX__ = {
  "builtAt": "2026-09-25T12:49:36.280Z",
  "menus": [
    {
      "platform": "迭代索引",
      "module": "202605下",
      "group": "迭代入口",
      "pageId": "overview",
      "title": "迭代导航",
      "iterTag": "",
      "url": "迭代索引/202605下.html?page=overview",
      "sourceType": "iteration",
      "pageFile": ""
    },
    {
      "platform": "迭代索引",
      "module": "202605下",
      "group": "订单履约（初版）",
      "pageId": "order-list",
      "title": "订单列表（初版）",
      "iterTag": "",
      "url": "迭代索引/202605下.html?page=order-list",
      "sourceType": "iteration",
      "pageFile": "迭代索引/snapshots/202605下/订单列表.html"
    },
    {
      "platform": "迭代索引",
      "module": "202605下",
      "group": "订单履约（初版）",
      "pageId": "order-create",
      "title": "下单页（初版）",
      "iterTag": "",
      "url": "迭代索引/202605下.html?page=order-create",
      "sourceType": "iteration",
      "pageFile": ""
    },
    {
      "platform": "迭代索引",
      "module": "202606下",
      "group": "迭代入口",
      "pageId": "overview",
      "title": "迭代导航",
      "iterTag": "",
      "url": "迭代索引/202606下.html?page=overview",
      "sourceType": "iteration",
      "pageFile": ""
    },
    {
      "platform": "迭代索引",
      "module": "202606下",
      "group": "资产台账",
      "pageId": "asset-list",
      "title": "资产列表",
      "iterTag": "",
      "url": "迭代索引/202606下.html?page=asset-list",
      "sourceType": "iteration",
      "pageFile": "admin-portal/asset-admin/pages/资产列表.html"
    },
    {
      "platform": "迭代索引",
      "module": "202606下",
      "group": "订单履约",
      "pageId": "order-list",
      "title": "订单列表",
      "iterTag": "",
      "url": "迭代索引/202606下.html?page=order-list",
      "sourceType": "iteration",
      "pageFile": "field-app/main/pages/订单列表.html"
    },
    {
      "platform": "迭代索引",
      "module": "202606下",
      "group": "订单履约",
      "pageId": "order-create",
      "title": "下单页",
      "iterTag": "",
      "url": "迭代索引/202606下.html?page=order-create",
      "sourceType": "iteration",
      "pageFile": ""
    },
    {
      "platform": "源文件",
      "module": "asset-admin",
      "group": "功能菜单",
      "pageId": "asset-list",
      "title": "资产列表",
      "iterTag": "",
      "url": "admin-portal/asset-admin/index.html?page=asset-list",
      "sourceType": "source",
      "pageFile": "admin-portal/asset-admin/pages/资产列表.html"
    },
    {
      "platform": "源文件",
      "module": "main",
      "group": "功能菜单",
      "pageId": "order-list",
      "title": "订单列表",
      "iterTag": "",
      "url": "field-app/main/index.html?page=order-list",
      "sourceType": "source",
      "pageFile": "field-app/main/pages/订单列表.html"
    },
    {
      "platform": "源文件",
      "module": "main",
      "group": "功能菜单",
      "pageId": "order-create",
      "title": "下单页",
      "iterTag": "",
      "url": "mini-program/main/index.html?page=order-create",
      "sourceType": "source",
      "pageFile": "mini-program/main/pages/下单.html"
    }
  ],
  "docs": [
    {
      "docId": "asset-admin-module",
      "title": "asset-admin-module",
      "platform": "admin-portal",
      "module": "asset-admin",
      "pageUrl": "",
      "snippet": "资产管理模块（承载页）；coreFlow；在左侧菜单选择功能页面，右侧 iframe 加载对应源页面；支持通过 URL 参数 ?page=页面ID 直达指定功能页；需求文档按钮固定在顶栏右侧，手动打开抽屉；fieldRows；承载页；pageNames；页面 ID 到中文名的映射，用于顶栏标题与菜单高亮；承载页；iframe src；指向 pages/ 下的源页面，模块承载页不直接写业务内容；承载",
      "fullText": "资产管理模块（承载页）；coreFlow；在左侧菜单选择功能页面，右侧 iframe 加载对应源页面；支持通过 URL 参数 ?page=页面ID 直达指定功能页；需求文档按钮固定在顶栏右侧，手动打开抽屉；fieldRows；承载页；pageNames；页面 ID 到中文名的映射，用于顶栏标题与菜单高亮；承载页；iframe src；指向 pages/ 下的源页面，模块承载页不直接写业务内容；承载页；data-page；菜单项与 page-section 一一对应，切换时同步顶栏标题；interactionRules；点击菜单项切换 active 状态与对应 page-section 显示；URL 显式参数 ?page=xxx 的优先级高于默认第一项；承载页需求抽屉展示的是模块级说明，具体页面规则在各自源页面抽屉中；exceptionsBoundaries；pageNames 未覆盖的页面 ID 进入时，标题回退为「资产管理」",
      "sourceType": "docs"
    },
    {
      "docId": "asset-list",
      "title": "asset-list",
      "platform": "admin-portal",
      "module": "asset-admin",
      "pageUrl": "admin-portal/asset-admin/pages/资产列表.html?doc=asset-list",
      "snippet": "资产列表；coreFlow；按关键字 / 类型 / 状态组合筛选资产台账；列表展示资产编号、名称、类型、归属站点、状态与到期日期；临近到期资产以橙色标签提示，点击行进入资产详情（本期不含）；filterRows；关键字；文本输入，支持资产编号与名称模糊匹配；资产台账接口；资产类型；下拉单选：全部 / 标签类 / 设备类；类型字典；状态；下拉单选：全部 / 使用中 / 闲置 / 临近到期；状态字段；",
      "fullText": "资产列表；coreFlow；按关键字 / 类型 / 状态组合筛选资产台账；列表展示资产编号、名称、类型、归属站点、状态与到期日期；临近到期资产以橙色标签提示，点击行进入资产详情（本期不含）；filterRows；关键字；文本输入，支持资产编号与名称模糊匹配；资产台账接口；资产类型；下拉单选：全部 / 标签类 / 设备类；类型字典；状态；下拉单选：全部 / 使用中 / 闲置 / 临近到期；状态字段；fieldRows；列表列；资产编号；唯一编号，等宽字体展示；列表列；状态；枚举标签：使用中（绿）/ 闲置（灰）/ 临近到期（橙）；列表列；到期日期；YYYY-MM-DD；空值展示为 -；列表列；归属站点；站点名称，超长省略并悬浮展示全称；interactionRules；查询按钮提交当前筛选条件并回到第一页；重置按钮清空筛选条件但不自动查询；分页仅展示页码占位，本期不实现真实翻页；exceptionsBoundaries；筛选无结果时列表区展示空状态占位；资产编号重复属数据异常，列表按原值展示并在详情页提示；todoOpenQuestions；资产导出能力是否需要在本期一并提供",
      "sourceType": "docs"
    },
    {
      "docId": "app-order-list",
      "title": "app-order-list",
      "platform": "field-app",
      "module": "main",
      "pageUrl": "field-app/main/pages/订单列表.html?doc=app-order-list",
      "snippet": "订单列表（移动端 App）；coreFlow；进入订单列表，默认加载全部进行中的订单；顶部搜索框支持按订单编号或物品名称检索；点击订单卡片进入订单详情（本期不含详情页）；fieldRows；顶部；搜索框；默认提示文案「搜索订单编号 / 物品名称」，支持模糊匹配；卡片；订单编号；等宽小字展示，前缀 NO-；卡片；状态标签；配送中（蓝）/ 已签收（绿）/ 超时未签收（橙）；卡片；订单摘要；物品名称 ×",
      "fullText": "订单列表（移动端 App）；coreFlow；进入订单列表，默认加载全部进行中的订单；顶部搜索框支持按订单编号或物品名称检索；点击订单卡片进入订单详情（本期不含详情页）；fieldRows；顶部；搜索框；默认提示文案「搜索订单编号 / 物品名称」，支持模糊匹配；卡片；订单编号；等宽小字展示，前缀 NO-；卡片；状态标签；配送中（蓝）/ 已签收（绿）/ 超时未签收（橙）；卡片；订单摘要；物品名称 × 数量 + 站点 + 时间，最多两行；interactionRules；列表按创建时间倒序排列；下拉刷新重新拉取第一页数据（静态原型不实现）；exceptionsBoundaries；无订单时展示空状态占位与「去下单」引导；超时未签收订单允许在详情页发起退回，列表页仅展示状态",
      "sourceType": "docs"
    },
    {
      "docId": "miniapp-order-create",
      "title": "miniapp-order-create",
      "platform": "mini-program",
      "module": "main",
      "pageUrl": "mini-program/main/pages/下单.html?doc=miniapp-order-create",
      "snippet": "下单页（小程序）；coreFlow；选择寄件地址与收件地址；填写物品名称与数量；选择期望送达时间段并提交订单；fieldRows；地址区；寄件地址；默认带出上次使用地址，可重新选择；地址区；收件地址；必填；未选择时提交按钮置灰；物品区；物品名称；必填，20 字以内；物品区；物品数量；默认 1，整数，1–99；时间区；期望送达；时间段选项由站点配送时段决定；时间区；备注；选填，50 字以内；inte",
      "fullText": "下单页（小程序）；coreFlow；选择寄件地址与收件地址；填写物品名称与数量；选择期望送达时间段并提交订单；fieldRows；地址区；寄件地址；默认带出上次使用地址，可重新选择；地址区；收件地址；必填；未选择时提交按钮置灰；物品区；物品名称；必填，20 字以内；物品区；物品数量；默认 1，整数，1–99；时间区；期望送达；时间段选项由站点配送时段决定；时间区；备注；选填，50 字以内；interactionRules；提交前校验必填项，未通过时定位到首个缺失项；提交成功后进入订单详情并提示结果；exceptionsBoundaries；站点未配置配送时段时，期望送达项展示为「暂不可选」",
      "sourceType": "docs"
    }
  ]
};
