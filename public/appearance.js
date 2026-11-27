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
  // Material HCT surface roles; keep in sync with npm run theme:generate.
  document.documentElement.style.backgroundColor = dark ? '#111318' : '#f9f9ff';
})();
