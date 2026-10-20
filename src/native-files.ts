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
  discoverSync(): Promise<{ peers: import('./sync/types').Peer[] }>;
  postSync(options: {
    endpoint: string;
    path: string;
    body: import('./sync/crypto').Envelope;
  }): Promise<{ body: import('./sync/crypto').Envelope }>;
}
export const nativeFiles = registerPlugin<NativeFiles>('DayweaveFiles');
