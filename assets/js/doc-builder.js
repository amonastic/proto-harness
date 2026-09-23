/**
 * 需求文档共享渲染函数
 * 供 field-app、mini-program 等模块的 docs.js 引用
 * 后台模块因历史原因在本地 docs.js 保留了独立副本
 */

function docSection(title, content, options = {}) {
    const toneClass = /异常|边界|风险|失败|退款|作废/.test(title) ? ' doc-section-danger' : '';
    const customClass = options.className ? ` ${options.className}` : '';
    return `
        <section class="mb-6${toneClass}${customClass}">
            <h3 class="text-sm font-bold text-gray-700 mb-2 pb-1 border-b border-gray-200">${docFormatVersionTags(title)}</h3>
            ${content}
        </section>
    `;
}

function docParagraph(text) {
    return `<p class="text-sm text-gray-600 leading-relaxed">${text}</p>`;
}

function docFormatVersionTags(text) {
    if (text === undefined || text === null) return '';
    return String(text).replace(/\[((?:\d{6}[上下]|\d{8})(?:｜\d{8})?)\]/g, (match, label) => {
        const toneClass = label === '202605下' ? ' doc-version-tag-current' : ' doc-version-tag-history';
        return `<span class="doc-version-tag${toneClass}">${label}</span>`;
    });
}

function docList(items, ordered = false) {
    return `
        <div class="doc-point-grid">
            ${items.map((item, index) => `
                <div class="doc-point-card">
                    <span class="doc-point-mark">${ordered ? index + 1 : '•'}</span>
                    <p>${docFormatVersionTags(item)}</p>
                </div>
            `).join('')}
        </div>
    `;
}

function docTable(headers, rows) {
    return `
        <div class="bg-gray-50 p-3 rounded text-xs">
            <table class="doc-plain-table">
                <thead>
                    <tr>${headers.map((header) => `<th>${docFormatVersionTags(header)}</th>`).join('')}</tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `<tr>${row.map((cell) => `<td>${docFormatVersionTags(cell)}</td>`).join('')}</tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function docRuleCards(rows, labels) {
    return `
        <div class="bg-gray-50 p-3 rounded text-xs space-y-2">
            <div class="doc-rule-grid">
                ${rows.map((row) => `
                    <div class="doc-rule-card">
                        <div class="doc-rule-title">${docFormatVersionTags(row[0])}</div>
                        ${row.slice(1).map((cell, index) => `
                            <div class="doc-rule-line">
                                <span>${docFormatVersionTags(labels[index] || '说明')}：</span>
                                <p>${docFormatVersionTags(cell)}</p>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function docStatusMapping(config) {
    return `
        <div class="space-y-4">
            <div class="bg-blue-50 border border-blue-100 rounded-lg p-3">
                <div class="text-xs font-bold text-blue-700 mb-2">${docFormatVersionTags(config.title || '映射顺序')}</div>
                <ol class="list-decimal pl-5 space-y-1 text-sm text-gray-700 leading-relaxed">
                    ${config.priority.map((item) => `<li>${docFormatVersionTags(item)}</li>`).join('')}
                </ol>
            </div>
            ${config.groups.map((group) => `
                <div>
                    <div class="text-xs font-bold text-gray-700 mb-2">${docFormatVersionTags(group.title)}</div>
                    ${docTable(group.headers || ['原始状态', '页面口径', '系统状态', '处理口径'], group.rows)}
                </div>
            `).join('')}
        </div>
    `;
}

function docActionGroups(groups) {
    return groups.map(group => docSection(group.title, `
        <div class="doc-rule-grid">
            ${group.items.map(item => `
                <div class="doc-rule-card">
                    <div class="doc-rule-title">${docFormatVersionTags(item.title)}</div>
                    ${item.rules.map(rule => `
                        <div class="doc-rule-line">
                            <span>${docFormatVersionTags(rule.key)}：</span>
                            <p>${docFormatVersionTags(rule.value)}</p>
                        </div>
                    `).join('')}
                </div>
            `).join('')}
        </div>
    `, { className: group.className })).join('');
}

function docVersionBlock(config) {
    const stateClass = config.state === 'current' ? ' doc-version-block-current' : ' doc-version-block-history';
    const openAttr = config.defaultOpen ? ' open' : '';
    const title = docFormatVersionTags(config.title || '');
    const badge = config.badge ? `<span class="doc-version-badge">${docFormatVersionTags(config.badge)}</span>` : '';

    return `
        <details class="doc-version-block${stateClass}"${openAttr}>
            <summary>
                <span class="doc-version-title">${title}</span>
                ${badge}
            </summary>
            <div class="doc-version-body">
                ${config.content || ''}
            </div>
        </details>
    `;
}

function buildVersionedRequirementDoc(sections) {
    return (sections || []).map(docVersionBlock).join('');
}

function buildRequirementDoc(config) {
    const sections = [];
    const hasRows = (rows) => Array.isArray(rows) && rows.length > 0;
    const hasItems = (items) => Array.isArray(items) && items.length > 0;
    const pushSection = (title, content) => {
        if (!content) return;
        sections.push(docSection(title, content));
    };

    if (config.structureDiagram) {
        sections.push(config.structureDiagram);
    }

    if (hasItems(config.coreFlow)) {
        pushSection('核心流程', docList(config.coreFlow, true));
    }

    if (hasItems(config.statesBranches)) {
        pushSection('状态与分支', docList(config.statesBranches));
    }

    if (hasRows(config.filterRows)) {
        pushSection('筛选规则', docRuleCards(config.filterRows, ['控件形式', '输入 / 选择规则', '数据来源']));
    }

    if (hasRows(config.fieldRows)) {
        pushSection(
            config.fieldTitle || '字段说明',
            docTable(
                config.fieldHeaders || ['区块', '字段 / 内容', '展示规则'],
                config.fieldRows
            )
        );
    }

    if (hasRows(config.relationRows)) {
        pushSection('字段与接口关联', docRuleCards(config.relationRows, ['来源', '关联关系']));
    }

    if (config.statusMapping) {
        pushSection(config.statusMapping.sectionTitle || '状态映射', docStatusMapping(config.statusMapping));
    }

    if (hasItems(config.actionGroups)) {
        sections.push(docActionGroups(config.actionGroups));
    } else {
        if (hasItems(config.interactionRules)) {
            pushSection('交互规则', docList(config.interactionRules));
        }
    }

    if (hasItems(config.exceptionsBoundaries)) {
        pushSection('异常与边界', docList(config.exceptionsBoundaries));
    }

    if (hasItems(config.customSections)) {
        config.customSections.forEach((section) => {
            pushSection(section.title, section.content);
        });
    }

    if (config.showTestingNotes && hasItems(config.testingNotes)) {
        pushSection('测试注意事项', docList(config.testingNotes));
    }

    if (config.showAcceptanceCriteria && hasItems(config.acceptanceCriteria)) {
        pushSection('验收标准', docList(config.acceptanceCriteria));
    }

    const shouldShowTodo = config.showTodoOpenQuestions !== false;
    if (shouldShowTodo && hasItems(config.todoOpenQuestions)) {
        pushSection('待确认项', docList(config.todoOpenQuestions));
    }

    return sections.join('');
}
