/**
 * 迭代状态统计
 * 按子项（nav-item）计数，来源为各迭代子页面左侧导航的打标
 * 口径：online(已上线) / dev(开发中) / test(测试中) / pending(待开发) / designOver(design over) / deprecated(已废弃) / unmarked(未标记)
 */
const SprintStats = {
    '202603 上': { online: 2 },
    '202603 下': { online: 3 },
    '202604 上': { online: 1 },
    '202604 下': { online: 2 },
    '202605 上': { online: 1 },
    '202605 下': { online: 2 },
    '202606 上': {},
    '202606 下': { dev: 3 },
    '202607 上': {},
    '202607 下': {},
    '202608 上': {},
    '202608 下': {},
    '202609 上': {},
    '202609 下': {},
    '202610 上': {},
    '202610 下': {},
    '202611 上': {},
    '202611 下': {},
    '202612 上': {},
    '202612 下': {}
};

/**
 * 迭代配置数据
 * 定义每个迭代周期包含的功能模块
 *
 * 格式说明：
 * - sprint: 迭代号，格式 YYYYMM 上/下
 * - status: 状态 planning(规划中) / active(进行中) / overdue(已超期) / completed(已完成)
 * - modules: 包含的功能模块列表
 *   - path: 模块路径（相对于设计稿目录）
 *   - name: 模块名称
 *   - platform: 所属平台
 * 本文件为仓库自带虚构示例的迭代配置，全部模块均为演示数据。
 */

const SprintConfig = {
    // 2026年3月上半月
    '202603 上': {
        sprint: '202603 上',
        status: 'overdue',
        period: '2026-03-01 ~ 2026-03-15',
        modules: [
            {
                path: 'admin-portal/asset-admin',
                name: '服务商后台框架',
                platform: '后台',
                pageFile: 'index.html',
                features: [
                    '建立模块承载页（左侧菜单 + iframe 承载 + pageNames 路由）',
                    '沉淀公共文档抽屉组件'
                ]
            }
        ]
    },

    // 2026年3月下半月
    '202603 下': {
        sprint: '202603 下',
        status: 'overdue',
        period: '2026-03-16 ~ 2026-03-31',
        modules: [
            {
                path: 'admin-portal/asset-admin/pages',
                name: '资产列表',
                platform: '后台',
                pageFile: '资产列表.html',
                features: [
                    '资产列表筛选与表格展示',
                    '状态标签口径统一',
                    '需求文档抽屉接入'
                ]
            }
        ]
    },

    // 2026年4月上半月
    '202604 上': {
        sprint: '202604 上',
        status: 'completed',
        period: '2026-04-01 ~ 2026-04-15',
        modules: [
            {
                path: 'mini-program/main',
                name: '下单页框架',
                platform: '小程序',
                pageFile: 'pages/下单.html',
                features: [
                    '轻量表单骨架与底部操作栏'
                ]
            }
        ]
    },

    // 2026年4月下半月
    '202604 下': {
        sprint: '202604 下',
        status: 'completed',
        period: '2026-04-16 ~ 2026-04-30',
        modules: [
            {
                path: 'field-app/main/pages',
                name: '订单列表骨架',
                platform: 'APP',
                pageFile: '订单列表.html',
                features: [
                    '手机模型 + 右侧设计稿控制区',
                    '卡片列表基础结构'
                ]
            }
        ]
    },

    // 2026年5月上半月
    '202605 上': {
        sprint: '202605 上',
        status: 'completed',
        period: '2026-05-01 ~ 2026-05-15',
        modules: [
            {
                path: 'admin-portal/asset-admin/pages',
                name: '资产状态标签',
                platform: '后台',
                pageFile: '资产列表.html',
                features: [
                    '在用 / 维修 / 报废三态标签'
                ]
            }
        ]
    },

    // 2026年5月下半月
    '202605 下': {
        sprint: '202605 下',
        status: 'completed',
        period: '2026-05-16 ~ 2026-05-31',
        modules: [
            {
                path: 'field-app/main/pages',
                name: '订单列表（初版）',
                platform: 'APP',
                pageFile: '订单列表.html',
                features: [
                    '卡片列表与筛选初版',
                    '自动展开需求抽屉'
                ]
            },
            {
                path: 'mini-program/main/pages',
                name: '下单页（初版）',
                platform: '小程序',
                pageFile: '下单.html',
                features: [
                    '字段级需求说明初版',
                    '底部操作栏静态原型'
                ]
            }
        ]
    },

    // 2026年6月上半月
    '202606 上': {
        sprint: '202606 上',
        status: 'completed',
        period: '2026-06-01 ~ 2026-06-15',
        modules: []
    },

    // 2026年6月下半月（当前进行中）
    '202606 下': {
        sprint: '202606 下',
        status: 'active',
        period: '2026-06-16 ~ 2026-06-30',
        modules: [
            {
                path: 'admin-portal/asset-admin/pages',
                name: '资产台账完善',
                platform: '后台',
                pageFile: '资产列表.html',
                features: [
                    '筛选区与列表主表收口',
                    '手动需求抽屉接入页面级数据源'
                ]
            },
            {
                path: 'field-app/main/pages',
                name: '订单履约完善',
                platform: 'APP',
                pageFile: '订单列表.html',
                features: [
                    '需求文档抽屉版本区块分层'
                ]
            },
            {
                path: 'mini-program/main/pages',
                name: '在线下单收口',
                platform: '小程序',
                pageFile: '下单.html',
                features: [
                    '底部操作栏与抽屉口径对齐'
                ]
            }
        ]
    },

    // 2026 年后续规划迭代，具体模块待登记
    '202607 上': { sprint: '202607 上', status: 'planning', period: '2026-07-01 ~ 2026-07-15', modules: [] },
    '202607 下': { sprint: '202607 下', status: 'planning', period: '2026-07-16 ~ 2026-07-31', modules: [] },
    '202608 上': { sprint: '202608 上', status: 'planning', period: '2026-08-01 ~ 2026-08-15', modules: [] },
    '202608 下': { sprint: '202608 下', status: 'planning', period: '2026-08-16 ~ 2026-08-31', modules: [] },
    '202609 上': { sprint: '202609 上', status: 'planning', period: '2026-09-01 ~ 2026-09-15', modules: [] },
    '202609 下': { sprint: '202609 下', status: 'planning', period: '2026-09-16 ~ 2026-09-30', modules: [] },
    '202610 上': { sprint: '202610 上', status: 'planning', period: '2026-10-01 ~ 2026-10-15', modules: [] },
    '202610 下': { sprint: '202610 下', status: 'planning', period: '2026-10-16 ~ 2026-10-31', modules: [] },
    '202611 上': { sprint: '202611 上', status: 'planning', period: '2026-11-01 ~ 2026-11-15', modules: [] },
    '202611 下': { sprint: '202611 下', status: 'planning', period: '2026-11-16 ~ 2026-11-30', modules: [] },
    '202612 上': { sprint: '202612 上', status: 'planning', period: '2026-12-01 ~ 2026-12-15', modules: [] },
    '202612 下': { sprint: '202612 下', status: 'planning', period: '2026-12-16 ~ 2026-12-31', modules: [] }
};

/**
 * 根据模块路径获取所属迭代
 * @param {string} modulePath - 模块路径
 * @returns {string|null} 迭代号
 */
function getSprintByModule(modulePath) {
    for (const [sprint, config] of Object.entries(SprintConfig)) {
        for (const module of config.modules) {
            if (modulePath.includes(module.path)) {
                return sprint;
            }
        }
    }
    return null;
}

/**
 * 获取指定迭代的所有模块
 * @param {string} sprint - 迭代号
 * @returns {Array} 模块列表
 */
function getModulesBySprint(sprint) {
    return SprintConfig[sprint]?.modules || [];
}

/**
 * 获取当前进行中的迭代
 * @returns {string|null} 迭代号
 */
function getActiveSprint() {
    for (const [sprint, config] of Object.entries(SprintConfig)) {
        if (config.status === 'active') {
            return sprint;
        }
    }
    return null;
}

// 暴露全局
window.SprintConfig = SprintConfig;
window.SprintStats = SprintStats;
window.getSprintByModule = getSprintByModule;
window.getModulesBySprint = getModulesBySprint;
window.getActiveSprint = getActiveSprint;
