(function () {
    var STORAGE_KEY = 'dg-nav-theme';
    var THEMES = [
        { value: 'dark', label: '墨玉' },
        { value: 'light', label: '浅色' },
        { value: 'paper-dark', label: '暗纸' }
    ];
    var THEME_TOKENS = {
        dark: {
            surface: '#0D1318',
            surfaceSoft: '#121920',
            border: 'rgba(138, 160, 178, 0.18)'
        },
        light: {
            surface: '#FFFFFF',
            surfaceSoft: '#EEF2F7',
            border: 'rgba(43, 55, 74, 0.14)'
        },
        'paper-dark': {
            surface: '#211F1A',
            surfaceSoft: '#2A2721',
            border: 'rgba(232, 224, 205, 0.12)'
        }
    };

    function getStoredTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    function ensureRuntimeStyle() {
        var style = document.querySelector('[data-nav-theme-runtime-style]');
        if (!style) {
            style = document.createElement('style');
            style.setAttribute('data-nav-theme-runtime-style', 'true');
            style.textContent = [
                'body{background:var(--nav-bg)!important;color:var(--nav-text)!important;}',
                'html[data-nav-theme="paper-dark"] body{background-image:radial-gradient(rgba(255,255,255,0.16) 1px,transparent 1px),radial-gradient(rgba(0,0,0,0.1) 1px,transparent 1px)!important;background-position:0 0,7px 9px!important;background-size:18px 18px,22px 22px!important;background-attachment:fixed!important;}',
                'html[data-nav-theme="dark"] body,html[data-nav-theme="light"] body{background-image:none!important;}',
                'html[data-nav-theme] [class~="bg-white/10"],html[data-nav-theme] [class~="bg-white/5"],html[data-nav-theme] .card-hover,html[data-nav-theme] .module-card,html[data-nav-theme] .sprint-card{background-color:var(--nav-surface)!important;border-color:var(--nav-border)!important;}',
                'html[data-nav-theme] [class~="hover:bg-white/20"]:hover{background-color:var(--nav-surface-hover)!important;}',
                'html[data-nav-theme] [class~="hover:text-white"]:hover{color:var(--nav-accent)!important;}',
                'html[data-nav-theme] .text-white{color:var(--nav-text)!important;}',
                'html[data-nav-theme] [class~="text-white/80"],html[data-nav-theme] [class~="text-white/70"],html[data-nav-theme] [class~="text-white/60"],html[data-nav-theme] [class~="text-white/50"],html[data-nav-theme] [class~="text-white/40"]{color:var(--nav-muted)!important;}',
                'html[data-nav-theme] [class~="border-white/10"]{border-color:var(--nav-border)!important;}',
                'html[data-nav-theme] .nav-header,html[data-nav-theme] .system-nav .nav-logo,html[data-nav-theme] .dg-sidebar .nav-logo{background:var(--nav-surface)!important;box-shadow:0 1px 0 var(--nav-border),var(--nav-shadow)!important;color:var(--nav-text)!important;}',
                'html[data-nav-theme] .nav-header *,html[data-nav-theme] .system-nav .nav-logo *{color:inherit!important;}',
                'html[data-nav-theme] .nav-header .back-link,html[data-nav-theme] .system-nav .back-link{background:var(--nav-surface-soft)!important;color:var(--nav-muted)!important;border:1px solid var(--nav-border)!important;}',
                'html[data-nav-theme] .nav-header .back-link:hover,html[data-nav-theme] .system-nav .back-link:hover{background:var(--nav-surface-hover)!important;color:var(--nav-accent)!important;}',
                'html[data-nav-theme] a[title="返回总导航"],html[data-nav-theme] a[title="返回总导航"] *,html[data-nav-theme] [aria-label="返回总导航"],html[data-nav-theme] [aria-label="返回总导航"] *{color:var(--nav-muted)!important;}',
                'html[data-nav-theme] a[title="返回总导航"]:hover,html[data-nav-theme] a[title="返回总导航"]:hover *,html[data-nav-theme] [aria-label="返回总导航"]:hover,html[data-nav-theme] [aria-label="返回总导航"]:hover *{color:var(--nav-accent)!important;}',
                'html[data-nav-theme="dark"] .card-hover,html[data-nav-theme="dark"] .module-card,html[data-nav-theme="dark"] .sprint-card{box-shadow:inset 0 1px 0 rgba(255,255,255,0.035)!important;}',
                'html[data-nav-theme] .card-hover:hover,html[data-nav-theme] .module-card:hover,html[data-nav-theme] .sprint-card:hover{box-shadow:var(--nav-shadow)!important;}',
                'html[data-nav-theme="dark"] .status-badge,html[data-nav-theme="dark"] .stat-tag,html[data-nav-theme="dark"] [class*="bg-blue-500/20"],html[data-nav-theme="dark"] [class*="bg-green-500/20"],html[data-nav-theme="dark"] [class*="bg-orange-500/20"],html[data-nav-theme="dark"] [class*="bg-purple-500/20"],html[data-nav-theme="dark"] [class*="bg-amber-500/20"],html[data-nav-theme="dark"] [class*="bg-cyan-500/20"],html[data-nav-theme="dark"] [class*="bg-teal-500/20"],html[data-nav-theme="dark"] [class*="bg-violet-500/20"],html[data-nav-theme="dark"] [class*="bg-yellow-500/20"]{filter:saturate(0.88) contrast(1.02);}',
                'html[data-nav-theme="light"] .status-badge,html[data-nav-theme="light"] .stat-tag,html[data-nav-theme="light"] [class*="bg-blue-500/20"],html[data-nav-theme="light"] [class*="bg-green-500/20"],html[data-nav-theme="light"] [class*="bg-orange-500/20"],html[data-nav-theme="light"] [class*="bg-purple-500/20"],html[data-nav-theme="light"] [class*="bg-amber-500/20"],html[data-nav-theme="light"] [class*="bg-cyan-500/20"],html[data-nav-theme="light"] [class*="bg-teal-500/20"],html[data-nav-theme="light"] [class*="bg-violet-500/20"],html[data-nav-theme="light"] [class*="bg-yellow-500/20"]{filter:saturate(1.12) contrast(1.08);}',
                'html[data-nav-theme="dark"] .text-blue-400{color:#B4BBC4!important;}',
                'html[data-nav-theme="dark"] .text-green-400{color:#D3D8DC!important;}',
                'html[data-nav-theme="dark"] .text-orange-400{color:#DEB08A!important;}',
                'html[data-nav-theme="dark"] .text-purple-400,html[data-nav-theme="dark"] .text-violet-400{color:#CBD1D8!important;}',
                'html[data-nav-theme="dark"] .text-amber-400,html[data-nav-theme="dark"] .text-yellow-300,html[data-nav-theme="dark"] .text-yellow-400{color:#D3D8DE!important;}',
                'html[data-nav-theme="dark"] .text-cyan-300,html[data-nav-theme="dark"] .text-cyan-400,html[data-nav-theme="dark"] .text-teal-400{color:#C5CCD2!important;}',
                'html[data-nav-theme="light"] .text-blue-400{color:#1D4ED8!important;}',
                'html[data-nav-theme="light"] .text-green-400{color:#15803D!important;}',
                'html[data-nav-theme="light"] .text-orange-400{color:#C2410C!important;}',
                'html[data-nav-theme="light"] .text-purple-400,html[data-nav-theme="light"] .text-violet-400{color:#6D28D9!important;}',
                'html[data-nav-theme="light"] .text-amber-400,html[data-nav-theme="light"] .text-yellow-300,html[data-nav-theme="light"] .text-yellow-400{color:#A16207!important;}',
                'html[data-nav-theme="light"] .text-cyan-300,html[data-nav-theme="light"] .text-cyan-400,html[data-nav-theme="light"] .text-teal-400{color:#0F766E!important;}',
                'html[data-nav-theme="light"] .text-indigo-400{color:#4338CA!important;}',
                'html[data-nav-theme="light"] .text-emerald-400{color:#047857!important;}',
                'html[data-nav-theme="light"] .bg-blue-500,html[data-nav-theme="light"] .bg-green-500,html[data-nav-theme="light"] .bg-orange-500,html[data-nav-theme="light"] .bg-purple-500,html[data-nav-theme="light"] .bg-indigo-500,html[data-nav-theme="light"] .bg-yellow-500,html[data-nav-theme="light"] .bg-cyan-500,html[data-nav-theme="light"] .bg-slate-600{border:1px solid var(--nav-border)!important;}',
                'html[data-nav-theme="light"] .bg-blue-500{background-color:#DBEAFE!important;color:#1D4ED8!important;}',
                'html[data-nav-theme="light"] .bg-green-500{background-color:#DCFCE7!important;color:#15803D!important;}',
                'html[data-nav-theme="light"] .bg-orange-500{background-color:#FFEDD5!important;color:#C2410C!important;}',
                'html[data-nav-theme="light"] .bg-purple-500{background-color:#F3E8FF!important;color:#6D28D9!important;}',
                'html[data-nav-theme="light"] .bg-indigo-500{background-color:#E0E7FF!important;color:#4338CA!important;}',
                'html[data-nav-theme="light"] .bg-yellow-500{background-color:#FEF3C7!important;color:#A16207!important;}',
                'html[data-nav-theme="light"] .bg-cyan-500{background-color:#CFFAFE!important;color:#0E7490!important;}',
                'html[data-nav-theme="light"] .bg-slate-600{background-color:#E2E8F0!important;color:#334155!important;}',
                'html[data-nav-theme="light"] .bg-blue-500 .text-white,html[data-nav-theme="light"] .bg-blue-500.text-white{color:#1D4ED8!important;}',
                'html[data-nav-theme="light"] .bg-green-500 .text-white,html[data-nav-theme="light"] .bg-green-500.text-white{color:#15803D!important;}',
                'html[data-nav-theme="light"] .bg-orange-500 .text-white,html[data-nav-theme="light"] .bg-orange-500.text-white{color:#C2410C!important;}',
                'html[data-nav-theme="light"] .bg-purple-500 .text-white,html[data-nav-theme="light"] .bg-purple-500.text-white{color:#6D28D9!important;}',
                'html[data-nav-theme="light"] .bg-indigo-500 .text-white,html[data-nav-theme="light"] .bg-indigo-500.text-white{color:#4338CA!important;}',
                'html[data-nav-theme="light"] .bg-yellow-500 .text-white,html[data-nav-theme="light"] .bg-yellow-500.text-white{color:#A16207!important;}',
                'html[data-nav-theme="light"] .bg-cyan-500 .text-white,html[data-nav-theme="light"] .bg-cyan-500.text-white{color:#0E7490!important;}',
                'html[data-nav-theme="light"] .bg-slate-600 .text-white,html[data-nav-theme="light"] .bg-slate-600.text-white{color:#334155!important;}',
                'html[data-nav-theme="paper-dark"] .bg-blue-500,html[data-nav-theme="paper-dark"] .bg-green-500,html[data-nav-theme="paper-dark"] .bg-orange-500,html[data-nav-theme="paper-dark"] .bg-purple-500,html[data-nav-theme="paper-dark"] .bg-indigo-500,html[data-nav-theme="paper-dark"] .bg-yellow-500,html[data-nav-theme="paper-dark"] .bg-cyan-500,html[data-nav-theme="paper-dark"] .bg-slate-600{background-color:var(--nav-active-bg)!important;border:1px solid var(--nav-border)!important;color:var(--nav-accent)!important;}',
                'html[data-nav-theme="paper-dark"] .bg-blue-500 .text-white,html[data-nav-theme="paper-dark"] .bg-green-500 .text-white,html[data-nav-theme="paper-dark"] .bg-orange-500 .text-white,html[data-nav-theme="paper-dark"] .bg-purple-500 .text-white,html[data-nav-theme="paper-dark"] .bg-indigo-500 .text-white,html[data-nav-theme="paper-dark"] .bg-yellow-500 .text-white,html[data-nav-theme="paper-dark"] .bg-cyan-500 .text-white,html[data-nav-theme="paper-dark"] .bg-slate-600 .text-white{color:var(--nav-accent)!important;}'
            ].join('\n');
        }
        document.head.appendChild(style);
    }

    function setTheme(value) {
        var theme = THEMES.some(function (item) { return item.value === value; }) ? value : 'dark';
        document.documentElement.setAttribute('data-nav-theme', theme);
        ensureRuntimeStyle();
        applyThemeSurfaces(theme);
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {}
        syncVisibleIframeCanvases();
        scheduleIdleIframeCanvasSync();
        document.querySelectorAll('.nav-theme-option').forEach(function (button) {
            button.classList.toggle('is-active', button.getAttribute('data-theme-value') === theme);
        });
        document.dispatchEvent(new CustomEvent('nav-theme-change', { detail: { theme: theme } }));
    }

    function applyThemeSurfaces(theme) {
        var tokens = THEME_TOKENS[theme] || THEME_TOKENS.dark;
        document.querySelectorAll('.card-hover, .module-card, .sprint-card').forEach(function (el) {
            el.style.setProperty('background-color', tokens.surface, 'important');
            el.style.setProperty('border-color', tokens.border, 'important');
        });
        document.querySelectorAll('[class~="bg-white/5"]').forEach(function (el) {
            if (el.matches('.card-hover, .module-card, .sprint-card')) return;
            el.style.setProperty('background-color', tokens.surfaceSoft, 'important');
        });
        document.querySelectorAll('[class~="border-white/10"]').forEach(function (el) {
            el.style.setProperty('border-color', tokens.border, 'important');
        });
    }

    function getCanvasTokens() {
        var styles = getComputedStyle(document.documentElement);
        return {
            bg: styles.getPropertyValue('--nav-bg').trim() || '#F6F8FB',
            text: styles.getPropertyValue('--nav-text').trim() || '#162033'
        };
    }

    function syncIframeCanvas(iframe) {
        var tokens = getCanvasTokens();
        try {
            var doc = iframe.contentDocument;
            if (!doc || !doc.documentElement || !doc.body) return;
            iframe.style.setProperty('background', tokens.bg, 'important');
            iframe.style.setProperty('background-color', tokens.bg, 'important');
            doc.documentElement.setAttribute('data-parent-nav-theme', getStoredTheme());
            var style = doc.querySelector('[data-parent-nav-theme-canvas]');
            if (!style) {
                style = doc.createElement('style');
                style.setAttribute('data-parent-nav-theme-canvas', 'true');
                doc.head.appendChild(style);
            }
            style.textContent = [
                'html[data-parent-nav-theme] body{background:' + tokens.bg + '!important;background-image:none!important;}',
                'html[data-parent-nav-theme] body > .page-wrapper,',
                'html[data-parent-nav-theme] body > .stage,',
                'html[data-parent-nav-theme] body > .phone-stage,',
                'html[data-parent-nav-theme] body > .device-stage,',
                'html[data-parent-nav-theme] body > .prototype-stage,',
                'html[data-parent-nav-theme] body > .mockup-stage{background:' + tokens.bg + '!important;background-image:none!important;}'
            ].join('\n');
        } catch (e) {}
        try {
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'dg-nav-theme-change',
                    theme: getStoredTheme()
                }, '*');
            }
        } catch (e) {}
    }

    function syncIframeCanvases() {
        document.querySelectorAll('iframe').forEach(syncIframeCanvas);
    }

    function isVisibleIframe(iframe) {
        var rect = iframe.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function syncVisibleIframeCanvases() {
        document.querySelectorAll('iframe').forEach(function (iframe) {
            if (isVisibleIframe(iframe)) syncIframeCanvas(iframe);
        });
    }

    function scheduleIdleIframeCanvasSync() {
        var run = function () {
            document.querySelectorAll('iframe').forEach(function (iframe) {
                if (!isVisibleIframe(iframe)) syncIframeCanvas(iframe);
            });
        };
        if (window.requestIdleCallback) {
            window.requestIdleCallback(run, { timeout: 1200 });
        } else {
            window.setTimeout(run, 300);
        }
    }

    function bindIframeCanvasSync() {
        document.querySelectorAll('iframe').forEach(function (iframe) {
            if (iframe.dataset.navThemeCanvasBound === 'true') return;
            iframe.dataset.navThemeCanvasBound = 'true';
            iframe.addEventListener('load', function () {
                syncIframeCanvas(iframe);
            });
        });
        syncVisibleIframeCanvases();
    }

    setTheme(getStoredTheme());

    function mount() {
        if (document.querySelector('.nav-theme-switcher')) return;
        ensureRuntimeStyle();

        var wrap = document.createElement('div');
        wrap.className = 'nav-theme-switcher';

        var menu = document.createElement('div');
        menu.className = 'nav-theme-menu';

        THEMES.forEach(function (theme) {
            var option = document.createElement('button');
            option.type = 'button';
            option.className = 'nav-theme-option';
            option.setAttribute('data-theme-value', theme.value);
            option.setAttribute('aria-label', '切换为' + theme.label);
            option.title = theme.label;
            option.addEventListener('click', function () {
                setTheme(theme.value);
            });
            menu.appendChild(option);
        });

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'nav-theme-trigger';
        trigger.setAttribute('aria-label', '切换导航风格');
        trigger.title = '切换导航风格';
        trigger.innerHTML = '<i class="fas fa-palette"></i>';

        wrap.appendChild(menu);
        wrap.appendChild(trigger);
        document.body.appendChild(wrap);
        setTheme(getStoredTheme());
        bindIframeCanvasSync();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    document.addEventListener('nav-theme-change', bindIframeCanvasSync);
})();
