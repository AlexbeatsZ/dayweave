// Apply the cached theme before the application or its styles render.
(() => {
  let preference = 'system';
  try {
    preference = localStorage.getItem('dayweave.appearance') || 'system';
  } catch {}
  const dark =
    preference === 'dark' ||
    (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.style.backgroundColor = dark ? '#182230' : '#f9fbfe';
})();
