// Applied before first paint so a saved theme choice never flashes the other one.
try {
  var saved = localStorage.getItem('hlm-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch (e) {}
