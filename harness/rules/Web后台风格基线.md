# Web 后台风格基线（门店后台 / 服务站后台 / 运维后台）

> 触发词：目标路径属于 `admin-portal/store-admin`、`admin-portal/station-admin` 或 `admin-portal/maintain-admin`  
> 适用场景：三个 Web 后台的列表页、详情页、弹窗、导入、设置等页面设计稿开发  
> 最后更新：2026-08-27

## 1. 定位

本文件为示例项目三个 Web 管理端（门店后台、服务站后台、运维后台）沉淀统一视觉基线。三端共享相同的布局体系、组件规范和交互模式，仅通过主题色区分归属。

- 不适用于移动作业端 App、用户端 App、用户小程序、门店小程序。
- 资产管理模块（`admin-portal/asset-admin`）是 Web 后台成熟基准之一（harness/10 成熟基准表登记），本基线与之一致。

## 2. 三端主题色

| 后台 | 主色 | 悬停色 | 适用路径 |
| --- | --- | --- | --- |
| 门店后台 | `#2563EB`（蓝） | `#1D4ED8` | `admin-portal/store-admin` |
| 服务站后台 | `#10B981`（绿） | `#059669` | `admin-portal/station-admin` |
| 运维后台 | `#7C3AED`（紫） | `#6D28D9` | `admin-portal/maintain-admin` |

除主色外，三端的布局、组件、字号、间距、弹窗、筛选区完全一致。新增页面时根据所属端自动应用主题色。

## 3. Style Clone-source 清单

### 门店后台

| 页面 | 路径 | 作为基准时主要吸收 |
| --- | --- | --- |
| 设备首页设置 | `admin-portal/store-admin/pages/设备首页设置.html` | 弹窗结构、模态框布局、表单输入 |
| 设备可视化 | `admin-portal/store-admin/pages/设备可视化.html` | 可视化页面布局、格口展示、状态色 |
| 站点列表 | `admin-portal/store-admin/pages/站点列表.html` | 筛选区控件复用（**杜绝测试胡乱测试**）、列表主表 |
| 资产标签管理 | `admin-portal/store-admin/pages/资产标签管理.html` | 列表页标准结构、弹窗 header 需求文档入口 |
| 客户管理 | `admin-portal/store-admin/pages/客户管理.html` | 客户列表、操作列按钮、批量操作 |

### 服务站后台

| 页面 | 路径 | 作为基准时主要吸收 |
| --- | --- | --- |
| 订单详情 | `admin-portal/station-admin/pages/订单详情.html` | 详情页分区卡片、顶部导航、信息网格 |
| 门店资料导入 | `admin-portal/station-admin/pages/门店资料导入.html` | 批量导入弹窗、步骤指示器、上传区 |

### 运维后台

| 页面 | 路径 | 作为基准时主要吸收 |
| --- | --- | --- |
| 开票记录 | `admin-portal/maintain-admin/pages/开票记录.html` | 列表页结构、新增开票申请弹窗 |
| 资产到期预警 | `admin-portal/maintain-admin/pages/资产到期预警.html` | 纯需求说明页（无列表、无表单），规则展示基线 |

### 跨端通用（资产管理模块）

| 页面 | 路径 | 作为基准时主要吸收 |
| --- | --- | --- |
| 资产列表 | `admin-portal/asset-admin/index.html` | harness/10 登记的 Web 主基准；抽屉组织方式、字段颗粒度 |

默认 clone-source 选择：

- 列表页优先看 `站点列表.html`、`资产标签管理.html`。
- 详情页优先看 `订单详情.html`。
- 弹窗（新增/编辑）优先看 `设备首页设置.html`、`开票记录.html`。
- 批量导入弹窗优先看 `门店资料导入.html`。
- 可视化/特殊展示优先看 `设备可视化.html`。
- 筛选区控件优先看 `站点列表.html`（标准 `.search-area` 结构）。

## 4. 视觉基线

### 4.1 页面布局

- 页面背景：`#f5f7fa` 或 `#f0f2f5`。
- 页面容器：`padding: 20px 24px`，无固定宽度（响应式撑满）。
- 页面标题：`18px`，`600-700`，左侧 `4px` 宽色条（主题色），`gap: 8px`。
- 无手机壳（纯 Web 页面）。

### 4.2 筛选区

- 容器：白底，`border-radius: 8px`，`border: 1px solid #e5e7eb`，`padding: 20px 24px`。
- 筛选头部：图标（主题色）+ "筛选条件" 文字，`border-bottom: 1px solid #f0f0f0`。
- 筛选行：`display: flex; flex-wrap: wrap; gap: 12px 20px`。
- 筛选项：`label`（`13px`，`#606266`，右对齐，min-width `70px`）+ `input/select`。
- 输入框：高度 `34px`，`border: 1px solid #dcdfe6`，`border-radius: 4px`，宽度 `170px`。
- 下拉框：宽度 `150px`，自定义箭头图标，`appearance: none`。
- 查询/重置按钮：高度 `34px`，查询为主题色实心，重置为白底灰边。

**关键**：筛选区复用既有控件样式（`站点列表.html`），可以杜绝测试环节胡乱测试——筛选控件有明确的宽度、高度、边框和圆角标准，任何偏差一眼可见。

### 4.3 列表主表

- 容器：白底，`border-radius: 8px`，`border: 1px solid #e5e7eb`。
- 表头：`background: #f9fafb`，`font-size: 13px`，`color: #6b7280`，`font-weight: 500`。
- 表格行：`padding: 12px 16px`，`border-bottom: 1px solid #f3f4f6`。
- 正文字号：`13px-14px`，`color: #1f2937`。
- 操作列按钮：文字按钮，主题色，`font-size: 13px`，`gap: 12px`。
- 分页：底部右侧，标准分页组件。

### 4.4 弹窗

- 遮罩：`background: rgba(0, 0, 0, 0.45)`（注意：遮罩不得阻断需求抽屉，详见 DEVELOPMENT.md 业务对话框规则）。
- 弹窗容器：白底，`border-radius: 10px-12px`，`box-shadow: 0 8px 32px rgba(0,0,0,0.18)`，`max-height: 80vh`。
- 弹窗头部：标题（`16px`，`600`）+ 右侧关闭按钮 + 需求文档按钮（蓝底小按钮）。
- 弹窗底部：`border-top: 1px solid #e5e7eb`，右对齐按钮组（取消 + 确认）。
- 上传附件控件**优化要求**：新增页面时上传附件控件应使用：虚线边框拖拽区（`border: 2px dashed #d1d5db`，`border-radius: 8px`），居中上传图标 + "点击或拖拽上传" 文案，已上传文件以小卡片形式展示（文件名 + 删除按钮）。

### 4.5 批量导入弹窗

参考 `门店资料导入.html`（DEVELOPMENT.md 已有硬规则）：

- 步骤指示器：三步圆形编号（`28px` 圆，当前步绿色/蓝色填充，未来步灰色边框）。
- 模板下载区：浅灰背景卡片，图标 + 说明 + 下载按钮。
- 上传区：浅灰背景卡片，图标 + 说明 + 上传按钮。
- 导入说明区：业务文案说明。
- 底部：取消 + 下一步按钮。

### 4.6 详情页

参考 `订单详情.html`：

- 顶部导航栏：白底，返回按钮（灰边圆角）+ 页面标题。
- 信息分区卡片：白底，`border-radius: 22px`（站点详情风格较圆润），`padding: 22px`。
- 分区标题：`22px`（大标题）或 `16px`（中标题），左侧色条（渐变蓝）。
- 信息网格：两列或三列 grid，label-value 上下排列。
- 背景可使用微渐变：`radial-gradient(circle at top, #f8fbff 0%, #eef3f8 42%)`。

### 4.7 色彩规范

| 语义 | 色值 |
| --- | --- |
| 页面背景 | `#f5f7fa`、`#f0f2f5` |
| 卡片/容器 | `#FFFFFF` |
| 边框 | `#e5e7eb`、`#dcdfe6` |
| 分割线 | `#f0f0f0`、`#f3f4f6` |
| 主文本 | `#1f2937`、`#1a1a1a` |
| 次级文本 | `#6b7280`、`#606266` |
| 辅助文本 | `#9ca3af`、`#c0c4cc` |
| 成功 | `#10B981` |
| 危险 | `#EF4444`、`#FF4D4F` |
| 警告 | `#F59E0B` |

### 4.8 字体与字号

- 字体族：`-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif`。
- 页面标题：`18px`，`600-700`。
- 分区标题：`16px`，`600`。
- 正文/表格/表单：`13px-14px`。
- Label：`13px`，`#606266`。
- 辅助说明：`12px`。
- 按钮：`13px`，`500`。

### 4.9 按钮规范

- 主按钮：高度 `34px`，`padding: 0 16px`，主题色背景，白色文字，`border-radius: 4px-6px`。
- 次要按钮：白底，主题色边框和文字。
- 重置/取消按钮：白底，灰色边框 `#dcdfe6`。
- 文字按钮（操作列）：无背景无边框，主题色文字，hover 下划线。
- 按钮间距：`gap: 10px-12px`。

### 4.10 需求文档与抽屉

- Web 后台默认 `docPanelMode: click-toggle`（点击打开，非自动）。
- 需求文档按钮位置：页面右上角 toolbar 区域，或弹窗 header 右侧（关闭按钮左侧）。
- 弹窗 header 需求文档按钮样式：`background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; height: 28px; font-size: 12px`。
- 抽屉宽度 `780px`，按 `standards/doc-spec.json` 执行。

## 5. 页面类型执行模板

### 5.1 列表页（最高频）

```
.page-container
  .page-header（标题 + 操作按钮）
  .search-area（筛选区：label + input/select + 查询/重置）
  .list-section（列表头 + 表格 + 分页）
```

### 5.2 详情页

```
.top-bar（返回按钮 + 标题）
.detail-view
  .detail-section × N（分区卡片：标题 + 信息网格）
```

### 5.3 弹窗页（新增/编辑）

```
.modal-overlay
  .modal-container
    .modal-header（标题 + 需求文档按钮 + 关闭按钮）
    .modal-body（表单区）
    .modal-footer（取消 + 确认）
```

### 5.4 批量导入弹窗

```
.modal
  .modal-header
  .modal-body
    .import-steps（步骤 1-2-3）
    .import-info-block（模板下载）
    .import-info-block（上传文件）
    .import-desc（导入说明）
  .modal-footer（取消 + 下一步）
```

### 5.5 设置/配置页

```
.page-container
  .page-header
  .config-section × N（白底卡片，表单项纵向排列）
  .page-footer（保存/取消）
```

## 6. 范围值设置特殊说明

`范围值设置` 类页面（如超期费、系统服务费批量设置等）采用横向对比表格布局：

- 左列固定为规则名称/范围标签。
- 右侧为可编辑值区域。
- 表格行高统一，编辑态 input 内嵌行内。
- 保存按钮底部固定或卡片内。

## 7. 禁止项

- 禁止把本基线用于移动端（App、小程序）。
- 禁止在列表页额外造快捷筛选按钮（筛选区已覆盖）。
- 禁止弹窗遮罩阻断需求抽屉操作（遵循 DEVELOPMENT.md 业务对话框规则）。
- 禁止为不同后台端使用不同布局体系——只允许主题色不同。
- 禁止上传附件使用原始 `<input type="file">` 裸控件；必须使用虚线拖拽区 + 文件卡片展示。
- 禁止把需求说明、开发备注写进真实页面正文。

## 8. 验证清单

- 是否仍以 `AGENTS.md` 为主入口。
- 目标是否属于 `admin-portal/` 下登记的模块之一。
- 主题色是否正确（门店蓝、站点绿、运营紫）。
- 筛选区是否复用 `站点列表.html` 标准控件（高度 34px、宽度 170px、圆角 4px）。
- 弹窗是否包含需求文档入口按钮。
- 上传控件是否使用优化后的虚线拖拽区（非裸 input）。
- 真实页面正文是否没有混入需求说明或开发备注。
