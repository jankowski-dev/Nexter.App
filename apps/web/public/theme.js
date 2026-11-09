(function () {
  try {
    if (localStorage.getItem('nexter-theme') === 'dark') {
      document.documentElement.dataset.theme = 'dark';
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#202329');
    }
  } catch {
    // Storage may be unavailable; keep the light theme.
  }
})();
