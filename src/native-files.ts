import { registerPlugin } from '@capacitor/core';
export interface NativeFiles {
  read(options: { name: string }): Promise<{ content: string | null }>;
  write(options: { name: string; content: string }): Promise<void>;
  pickBackup(): Promise<{ content: string | null }>;
  exportBackup(options: {
    content: string;
    name: string;
    mime?: string;
  }): Promise<{ saved: boolean }>;
  appearance(options: { dark: boolean }): Promise<void>;
  pinWidget(): Promise<{ supported: boolean; requested: boolean }>;
}
export const nativeFiles = registerPlugin<NativeFiles>('DayweaveFiles');
