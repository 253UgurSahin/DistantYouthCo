// Sets the chosen theme before the first paint. No attribute means the default: dark.
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark' || t === 'system') document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: keep the default */ }
