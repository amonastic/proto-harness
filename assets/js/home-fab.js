/**
 * Home FAB - 快速返回根目录悬浮按钮
 * 
 * 使用：在任意页面 </body> 前 <script src="...home-fab.js"></script>
 * 路径自动从 script src 推导，无需手动配置
 * 
 * 可调参数（在加载本脚本前设置 window 变量）：
 *   HOME_FAB_RIGHT   - 距右侧距离，默认 '24px'（调水平位置用这个）
 *   HOME_FAB_BOTTOM  - 距底部距离，默认 '24px'
 *   HOME_FAB_SIZE    - 按钮高度，默认 '40px'
 *   HOME_FAB_OPACITY - 默认透明度，默认 '0.7'
 *   HOME_FAB_HREF    - 覆盖自动计算的首页链接
 *   HOME_FAB_FORCE   - 强制在左侧目录页展示，默认 false
 */
(function () {
    var pathname = '';
    try {
        pathname = decodeURIComponent(window.location.pathname || '');
    } catch (e) {
        pathname = window.location.pathname || '';
    }

    var isNavigationPage = [
        '/admin-portal/index.html',
        '/mini-program/index.html',
        '/field-app/index.html',
        '/迭代索引/index.html'
    ].some(function (suffix) {
        return pathname.slice(-suffix.length) === suffix;
    });

    // 只在总导航下一层的导航页展示；具体需求页面即使误引入脚本也不展示。
    if (!window.HOME_FAB_FORCE && !isNavigationPage) {
        return;
    }

    // 左侧目录页底部或顶部已有返回入口，不重复渲染右下角按钮。
    if (!window.HOME_FAB_FORCE && document.querySelector('.system-nav, .dg-sidebar, #module-nav')) {
        return;
    }

    var LEFT = window.HOME_FAB_LEFT || '24px';
    var BOTTOM = window.HOME_FAB_BOTTOM || '24px';
    var SIZE = window.HOME_FAB_SIZE || '40px';
    var LABEL = window.HOME_FAB_LABEL || '总导航';

    // 从 script 标签的 src 推导根路径
    var homeHref = window.HOME_FAB_HREF || null;
    if (!homeHref) {
        var me = document.currentScript;
        if (me && me.getAttribute('src')) {
            // src 如 "../../../assets/js/home-fab.js" → root = "../../../"
            var src = me.getAttribute('src');
            var rootPrefix = src.replace(/assets\/js\/home-fab\.js$/, '');
            homeHref = rootPrefix + 'index.html';
        }
        if (!homeHref) homeHref = '../index.html'; // 兜底
    }

    // 注入样式（左下角 + 高对比度深色底白字，全主题可读）
    var style = document.createElement('style');
    style.textContent = [
        '.home-fab{',
        '  position:fixed;',
        '  left:' + LEFT + ';',
        '  bottom:' + BOTTOM + ';',
        '  min-width:92px;',
        '  height:' + SIZE + ';',
        '  padding:0 14px;',
        '  gap:8px;',
        '  border-radius:999px;',
        '  background:rgba(30,41,59,0.92);',
        '  color:#ffffff;',
        '  border:1px solid rgba(255,255,255,0.12);',
        '  display:flex;',
        '  align-items:center;',
        '  justify-content:center;',
        '  font-size:13px;',
        '  font-weight:600;',
        '  cursor:pointer;',
        '  box-shadow:0 4px 14px rgba(0,0,0,0.35);',
        '  transition:background 0.2s,transform 0.15s,box-shadow 0.2s;',
        '  z-index:9999;',
        '  text-decoration:none;',
        '  white-space:nowrap;',
        '}',
        '.home-fab i{font-size:14px;}',
        '.home-fab:hover{background:rgba(51,65,85,0.95);transform:scale(1.08);box-shadow:0 6px 20px rgba(0,0,0,0.45);}',
        '.home-fab:active{transform:scale(0.95);}'
    ].join('\n');
    document.head.appendChild(style);

    // 注入按钮
    var btn = document.createElement('a');
    btn.className = 'home-fab';
    btn.href = homeHref;
    btn.target = '_top';
    btn.title = '返回总导航';
    btn.innerHTML = '<i class="fas fa-home"></i><span>' + LABEL + '</span>';
    document.body.appendChild(btn);
})();
