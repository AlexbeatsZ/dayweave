import type { AppState } from '../model.js';
import type { SyncConflict, SyncDocument } from './document.js';

export type Peer = { name: string; endpoint: string; hubId: string };
export type SyncConfig = {
  version: 1;
  deviceId: string;
  name: string;
  enabled: boolean;
  endpoint?: string;
  hubId?: string;
  key?: string;
  seq: number;
  base?: SyncDocument;
  revision?: string;
  conflicts: SyncConflict[];
  hub?: {
    port: number;
    clients: Record<string, { name: string; key: string; seq: number }>;
    invite?: { key: string; expires: number };
  };
};
export type SyncStatus = {
  mode: 'off' | 'hub' | 'client';
  name: string;
  endpoint?: string;
  addresses?: string[];
  hubId?: string;
  connected: boolean;
  lastSync?: number;
  error: string;
  peers?: { id: string; name: string }[];
  conflicts: SyncConflict[];
};
export type SyncRequest = {
  seq: number;
  revision?: string;
  state?: AppState;
  base?: SyncDocument;
};
export type SyncReply = {
  seq: number;
  hubId: string;
  revision: string;
  state?: AppState;
  base?: SyncDocument;
  conflicts?: SyncConflict[];
};
export interface SyncStorage {
  read(): Promise<string | null>;
  write(content: string): Promise<void>;
}
export interface SyncState {
  snapshot(): Promise<{ state: AppState }>;
  mutate(transform: (state: AppState) => AppState): Promise<unknown>;
}
export type SyncBridge = {
  status(): Promise<SyncStatus>;
  discover(): Promise<Peer[]>;
  pair(invitation: string, endpoint?: string): Promise<SyncStatus>;
  now(): Promise<SyncStatus>;
  disconnect(): Promise<SyncStatus>;
  enableHub?(): Promise<SyncStatus>;
  invite?(): Promise<string>;
  revoke?(id: string): Promise<SyncStatus>;
  resolve(index: number, keepLocal: boolean): Promise<SyncStatus>;
};
