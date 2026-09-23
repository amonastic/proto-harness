(function () {
    var STORAGE_KEY = 'dg-nav-theme';
    var THEMES = {
        dark: {
            bg: '#030609',
            helperBg: 'rgba(13, 19, 24, 0.92)',
            helperBorder: 'rgba(138, 160, 178, 0.18)',
            helperText: '#F4F7F8',
            helperMuted: 'rgba(244, 247, 248, 0.68)'
        },
        light: {
            bg: '#F6F8FB',
            helperBg: '#FFFFFF',
            helperBorder: 'rgba(43, 55, 74, 0.14)',
            helperText: '#162033',
            helperMuted: 'rgba(22, 32, 51, 0.62)'
        },
        'paper-dark': {
            bg: '#171613',
            helperBg: 'rgba(33, 31, 26, 0.94)',
            helperBorder: 'rgba(232, 224, 205, 0.12)',
            helperText: '#ECE6D8',
            helperMuted: 'rgba(236, 230, 216, 0.58)'
        }
    };

    function readTheme() {
        var parentTheme = document.documentElement.getAttribute('data-parent-nav-theme');
        if (THEMES[parentTheme]) return parentTheme;
        try {
            var storedTheme = localStorage.getItem(STORAGE_KEY);
            if (THEMES[storedTheme]) return storedTheme;
        } catch (e) {}
        return 'dark';
    }

    function ensureStyle() {
        var style = document.querySelector('style[data-prototype-canvas-theme-style]');
        if (!style) {
            style = document.querySelector('style[data-prototype-canvas-theme="true"]');
        }
        if (!style) {
            style = document.createElement('style');
            style.setAttribute('data-prototype-canvas-theme-style', 'true');
            document.head.appendChild(style);
        } else {
            style.setAttribute('data-prototype-canvas-theme-style', 'true');
        }
        return style;
    }

    function renderTheme(theme) {
        var tokens = THEMES[theme] || THEMES.dark;
        ensureStyle().textContent = [
            'html[data-prototype-canvas-theme] body{background:' + tokens.bg + '!important;background-image:none!important;}',
            'html[data-prototype-canvas-theme] body > .page-wrapper,',
            'html[data-prototype-canvas-theme] body > .stage,',
            'html[data-prototype-canvas-theme] body > .phone-stage,',
            'html[data-prototype-canvas-theme] body > .device-stage,',
            'html[data-prototype-canvas-theme] body > .prototype-stage,',
            'html[data-prototype-canvas-theme] body > .mockup-stage,',
            'html[data-prototype-canvas-theme] body > .main-layout,',
            'html[data-prototype-canvas-theme] body > .desktop-stage{background:' + tokens.bg + '!important;background-image:none!important;}',
            'html[data-prototype-canvas-theme] .helper,',
            'html[data-prototype-canvas-theme] .helper-card,',
            'html[data-prototype-canvas-theme] .tools,',
            'html[data-prototype-canvas-theme] .side-panel,',
            'html[data-prototype-canvas-theme] .control-panel{background:' + tokens.helperBg + '!important;border-color:' + tokens.helperBorder + '!important;color:' + tokens.helperText + '!important;}',
            'html[data-prototype-canvas-theme] .helper-title,',
            'html[data-prototype-canvas-theme] .helper-text{color:' + tokens.helperText + '!important;}',
            'html[data-prototype-canvas-theme] .helper-sub,',
            'html[data-prototype-canvas-theme] .helper-route{color:' + tokens.helperMuted + '!important;border-color:' + tokens.helperBorder + '!important;}'
        ].join('\n');
        document.documentElement.setAttribute('data-prototype-canvas-theme', theme);
    }

    function applyTheme(theme) {
        renderTheme(THEMES[theme] ? theme : readTheme());
    }

    function boot() {
        applyTheme(readTheme());
    }

    window.addEventListener('storage', function (event) {
        if (event.key === STORAGE_KEY) applyTheme(event.newValue);
    });
    window.addEventListener('message', function (event) {
        var data = event.data || {};
        if (data.type === 'dg-nav-theme-change') applyTheme(data.theme);
    });
    document.addEventListener('nav-theme-change', function (event) {
        applyTheme(event.detail && event.detail.theme);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
