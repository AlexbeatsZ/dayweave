import type { AppState } from './model';
import type { StateDelta } from './state-delta';

declare global {
  interface Window {
    clearlist?: {
      usage?: import('./usage/domain').UsageBridge;
      sync?: import('./sync/types').SyncBridge;
      pickText?(): Promise<string | null>;
      importFudan?(): Promise<string | null>;
      exportText?(name: string, data: string, mime?: string): Promise<boolean>;
      platform?: 'win32' | 'darwin' | 'linux' | 'android';
      setTheme?(theme: 'light' | 'dark' | 'system'): Promise<void>;
      load(): Promise<{ state: AppState; recovered: boolean; path: string; revision?: string }>;
      /** Full-state save for platforms without a main-process delta queue (Android). */
      save?(state: AppState): Promise<void>;
      patch?(delta: StateDelta): Promise<{ state: AppState; revision: string }>;
      onState?(callback: (snapshot: { state: AppState; revision: string }) => void): void;
      apiInfo?(): Promise<{ url: string; token: string; enabled: boolean }>;
      exportData(state: AppState): Promise<boolean>;
      importData(): Promise<AppState | null>;
      restoreData(): Promise<{ state: AppState; recovered: boolean; path: string } | null>;
      onBeforeClose(callback: () => Promise<void>): void;
      readyToClose(success: boolean): void;
    };
  }
}
