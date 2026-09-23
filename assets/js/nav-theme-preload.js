(function () {
    var theme = 'dark';
    try {
        var storedTheme = localStorage.getItem('dg-nav-theme');
        if (storedTheme === 'light' || storedTheme === 'paper-dark' || storedTheme === 'dark') {
            theme = storedTheme;
        }
    } catch (e) {}
    document.documentElement.setAttribute('data-nav-theme', theme);
})();
