import type { AppState } from './model';
import type { StateDelta } from './state-delta';

declare global {
  interface Window {
    clearlist?: {
      pickText?(): Promise<string | null>;
      exportText?(name: string, data: string): Promise<boolean>;
      platform?: 'win32' | 'darwin' | 'linux' | 'android';
      setTheme?(theme: 'light' | 'dark' | 'system'): Promise<void>;
      load(): Promise<{ state: AppState; recovered: boolean; path: string; revision?: string }>;
      save(state: AppState): Promise<void>;
      patch?(delta: StateDelta): Promise<{ state: AppState; revision: string }>;
      onState?(callback: (snapshot: { state: AppState; revision: string }) => void): void;
      apiInfo?(): Promise<{ url: string; token: string; enabled: boolean }>;
      exportData(state: AppState): Promise<boolean>;
      importData(): Promise<AppState | null>;
      restoreData(): Promise<{ state: AppState; recovered: boolean; path: string } | null>;
      notify(title: string, body: string): Promise<void>;
      onBeforeClose(callback: () => Promise<void>): void;
      readyToClose(success: boolean): void;
    };
  }
}
