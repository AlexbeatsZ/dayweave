import { useStore, store } from '../store';
export type ThemePreference = 'system' | 'light' | 'dark';
export function useTheme() {
  const { data } = useStore();
  const preference = data.settings.theme;
  return {
    preference,
    resolved: document.documentElement.dataset.theme ?? 'light',
    choose: (theme: ThemePreference) =>
      store.update((s) => ({ ...s, settings: { ...s.settings, theme } })),
  };
}
