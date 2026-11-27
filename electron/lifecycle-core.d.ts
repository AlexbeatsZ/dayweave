declare module '@alexbeatsz/file-sync-core' {
  export function lifecyclePolicy(value?: unknown): any;
  export class BackupRepository {
    constructor(root: string, policy?: unknown);
    snapshot(files: Record<string, string>, options?: unknown): Promise<any>;
    prune(options?: unknown): Promise<any>;
    status(): Promise<any>;
    snapshots(): Promise<any[]>;
    restore(id: string, destination: string): Promise<any>;
  }
  export function pruneUpgrades(
    directory: string,
    policy: unknown,
    options?: unknown,
  ): Promise<any>;
  export function verifyUpgrade(directory: string): Promise<any>;
}
