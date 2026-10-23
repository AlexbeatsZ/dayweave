export type ThemePreference = 'light' | 'dark' | 'system';
const key = 'dayweave.appearance';
export function resolveTheme(theme: ThemePreference, systemDark: boolean) {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
export function applyTheme(theme: ThemePreference) {
  const resolved = resolveTheme(theme, matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.documentElement.style.backgroundColor = resolved === 'dark' ? '#181818' : '#f2f2f2';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#181818' : '#f2f2f2');
  try {
    localStorage.setItem(key, theme);
  } catch {
    /* Appearance cache is optional. */
  }
  void window.clearlist?.setTheme?.(theme).catch(() => {});
}
export function initializeTheme() {
  let theme: ThemePreference = 'system';
  try {
    const value = localStorage.getItem(key);
    if (value === 'light' || value === 'dark') theme = value;
  } catch {
    /* Optional cache. */
  }
  applyTheme(theme);
}
