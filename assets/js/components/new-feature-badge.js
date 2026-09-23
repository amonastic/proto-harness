/**
 * 新功能提示标记组件
 * NewFeatureBadge - 用于标记新功能入口，2秒后自动消失
 * 
 * 使用方式：
 * 1. 在目标元素上添加 data-new-feature 属性
 * 2. 可选：data-new-feature-text="自定义文本"（默认"新功能"）
 * 3. 可选：data-new-feature-id="自定义ID"（用于区分同页面多个标记）
 * 
 * 示例：
 * <div class="card" data-new-feature data-new-feature-text="NEW">...</div>
 * 
 * 开发规范：
 * - 所有新功能入口都应使用此组件统一标记
 * - 标记显示2秒后自动消失，避免干扰用户
 * - 每次进入页面都显示，同页面停留期间只显示一次
 * - 切换菜单/iframe重新加载后会再次显示
 */

const NewFeatureBadge = {
    // 默认配置
    defaults: {
        text: '新功能',
        duration: 2000,      // 显示时长（毫秒）
        delay: 100,          // 延迟显示（毫秒）
        position: 'top-right' // 默认位置
    },

    // 内存存储：记录当前页面已显示的标记（页面刷新/iframe重新加载后重置）
    _shownBadges: new Set(),

    // 已注入样式的标记
    _styleInjected: false,

    /**
     * 注入全局样式
     */
    injectStyles() {
        if (this._styleInjected) return;
        
        const style = document.createElement('style');
        style.textContent = `
            /* 新功能标记基础样式 */
            .new-feature-badge {
                position: absolute;
                top: -6px;
                right: 12px;
                background: linear-gradient(135deg, #FF4D4F, #FF7875);
                color: white;
                font-size: 11px;
                font-weight: 600;
                padding: 4px 10px;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(255, 77, 79, 0.4);
                animation: newFeatureBadgeFloat 2s ease-in-out forwards;
                opacity: 0;
                pointer-events: none;
                white-space: nowrap;
                z-index: 10;
            }

            .new-feature-badge::after {
                content: '';
                position: absolute;
                bottom: -4px;
                right: 16px;
                width: 0;
                height: 0;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 4px solid #FF4D4F;
            }

            /* 位置变体 */
            .new-feature-badge--top-left {
                right: auto;
                left: 12px;
            }
            .new-feature-badge--top-left::after {
                right: auto;
                left: 16px;
            }

            .new-feature-badge--top-center {
                right: 50%;
                transform: translateX(50%);
            }
            .new-feature-badge--top-center::after {
                right: 50%;
                transform: translateX(50%);
            }

            /* 动画 */
            @keyframes newFeatureBadgeFloat {
                0% {
                    opacity: 0;
                    transform: translateY(8px) scale(0.9);
                }
                15% {
                    opacity: 1;
                    transform: translateY(0) scale(1.05);
                }
                20% {
                    transform: translateY(0) scale(1);
                }
                85% {
                    opacity: 1;
                    transform: translateY(0);
                }
                100% {
                    opacity: 0;
                    transform: translateY(-4px);
                }
            }

            /* 目标元素需要相对定位 */
            [data-new-feature] {
                position: relative;
            }
        `;
        document.head.appendChild(style);
        this._styleInjected = true;
    },

    /**
     * 初始化所有标记
     */
    init() {
        this.injectStyles();
        
        const elements = document.querySelectorAll('[data-new-feature]');
        elements.forEach(el => this.show(el));
    },

    /**
     * 为指定元素显示新功能标记
     * @param {HTMLElement} element - 目标元素
     * @param {Object} options - 配置选项
     */
    show(element, options = {}) {
        // 确保有相对定位
        const computedStyle = window.getComputedStyle(element);
        if (computedStyle.position === 'static') {
            element.style.position = 'relative';
        }

        // 获取配置
        const text = element.dataset.newFeatureText || options.text || this.defaults.text;
        const badgeId = element.dataset.newFeatureId || `badge_${Array.from(element.parentElement.children).indexOf(element)}`;
        const duration = parseInt(element.dataset.newFeatureDuration) || options.duration || this.defaults.duration;
        const delay = parseInt(element.dataset.newFeatureDelay) || options.delay || this.defaults.delay;
        const position = element.dataset.newFeaturePosition || options.position || this.defaults.position;

        // 检查当前页面是否已经展示过（内存检查，页面刷新后重置）
        if (this._shownBadges.has(badgeId)) return;

        // 创建标记元素
        const badge = document.createElement('div');
        badge.className = `new-feature-badge new-feature-badge--${position}`;
        badge.textContent = text;
        
        // 延迟显示
        setTimeout(() => {
            element.appendChild(badge);
            
            // 动画结束后移除元素并标记已展示
            setTimeout(() => {
                if (badge.parentElement) {
                    badge.remove();
                }
                this._shownBadges.add(badgeId);
            }, duration);
        }, delay);
    },

    /**
     * 手动显示标记（用于动态添加的元素）
     * @param {string|HTMLElement} target - 选择器或元素
     * @param {Object} options - 配置选项
     */
    showOn(target, options = {}) {
        this.injectStyles();
        
        const element = typeof target === 'string' 
            ? document.querySelector(target) 
            : target;
            
        if (element) {
            this.show(element, options);
        }
    },

    /**
     * 重置指定标记的显示状态（调试用）
     * @param {string} badgeId - 标记ID，不传则重置当前页面所有
     */
    reset(badgeId) {
        if (badgeId) {
            this._shownBadges.delete(badgeId);
        } else {
            // 重置当前页面的所有标记
            this._shownBadges.clear();
        }
    }
};

// 自动初始化（DOM加载完成后）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => NewFeatureBadge.init());
} else {
    NewFeatureBadge.init();
}

// 暴露全局
window.NewFeatureBadge = NewFeatureBadge;

console.log('[NewFeatureBadge] 新功能标记组件已加载');
