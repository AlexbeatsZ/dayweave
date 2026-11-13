import path from 'node:path';
import os from 'node:os';
import { FileStore } from './storage.js';
import { StateService } from './state-service.js';
import { startApi } from './api.js';
import { lockProfile } from './profile-lock.js';
import { DesktopSync } from './sync.js';
import { UsageStore } from './usage-store.js';
import { DesktopUsage } from './usage.js';
import { startScriptJudge, type ScriptJudge } from './script-judge.js';

export { lockProfile };
export function defaultProfile() {
  const root =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library/Application Support')
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  if (!root) throw new Error('APPDATA is unavailable; specify an absolute profile path');
  return path.join(root, 'Dayweave');
}

export type HeadlessOptions = {
  directory: string;
  apiPort?: number;
  /** false leaves the local API off (DAYWEAVE_API_DISABLE). */
  api?: boolean;
  discovery?: boolean;
  binary?: string;
  enableHub?: boolean;
  initialHubPort?: number;
  server?: { version: string; appVersion: string; sourceCommit: string };
  onShutdown?: (error?: unknown) => void;
};
type Part = 'state' | 'sync' | 'usage' | 'judge' | 'api';

/**
 * The one owner of a profile's services for the desktop app, the AI tools and the server:
 * profile lock, state queue, sync, automatic records, script goals and the local API.
 */
export class Runtime {
  readonly service: StateService;
  sync?: DesktopSync;
  usage?: DesktopUsage;
  judge?: ScriptJudge;
  api?: Awaited<ReturnType<typeof startApi>>;
  /** Failures by part, kept separately so one does not mask or stop another. */
  readonly errors: Partial<Record<Part, string>> = {};
  private closing = false;
  private shutdown?: Promise<void>;
  private constructor(
    readonly directory: string,
    private readonly unlock: () => Promise<void>,
    private readonly options: HeadlessOptions,
  ) {
    this.service = new StateService(new FileStore(directory));
  }
  static async open(options: HeadlessOptions) {
    const directory = path.resolve(options.directory);
    return new Runtime(directory, await lockProfile(directory), options);
  }
  get isClosing() {
    return this.closing;
  }
  /**
   * Start every part that is not running yet; calling it again after a restore starts the rest.
   * Strict mode (server, AI tools) fails on the first error. The desktop keeps its recovery
   * screen available and records each part's failure on its own.
   */
  async start(strict: boolean) {
    const run = async (part: Part, action: () => Promise<unknown>) => {
      if (this.closing) return false;
      try {
        await action();
        delete this.errors[part];
        return true;
      } catch (error) {
        this.errors[part] = error instanceof Error ? error.message : String(error);
        if (strict) throw error;
        return false;
      }
    };
    // Sync, records and goal scripts all read saved state; without it only the API may answer.
    if (await run('state', () => this.service.snapshot())) {
      if (!this.sync)
        await run('sync', async () => {
          const sync = new DesktopSync(
            this.service,
            this.directory,
            this.options.discovery ?? true,
          );
          try {
            await sync.initialize();
          } catch (error) {
            await sync.close().catch(() => {});
            throw error;
          }
          this.sync = sync;
        });
      const sync = this.sync;
      let startedUsage: DesktopUsage | undefined;
      if (sync && !this.usage)
        await run('usage', async () => {
          const usage = new DesktopUsage(
            new UsageStore(path.join(this.directory, 'usage.db')),
            sync.client,
            this.directory,
            this.options.binary ?? '',
            !this.options.server,
          );
          sync.usage = usage.store;
          sync.refreshUsage = () => usage.sync();
          try {
            await usage.initialize(!this.options.server);
          } catch (error) {
            sync.usage = undefined;
            sync.refreshUsage = undefined;
            await usage.close().catch(() => {});
            throw error;
          }
          this.usage = startedUsage = usage;
        });
      if (sync && this.options.enableHub)
        await run('sync', () => sync.enableHub(this.options.initialHubPort));
      if (sync && !this.judge)
        await run('judge', async () => {
          this.judge = startScriptJudge(this.service, sync, () => this.usage?.store);
        });
      await this.startApi(run);
      // The server begins background scans only once its API is accepting management requests.
      if (this.options.server) startedUsage?.startBackground();
      return;
    }
    await this.startApi(run);
  }
  private async startApi(run: (part: Part, action: () => Promise<unknown>) => Promise<boolean>) {
    if (this.api || this.options.api === false) return;
    const server = this.options.server,
      usage = this.usage;
    await run('api', async () => {
      this.api = await startApi(this.service, this.options.apiPort, () => this.sync, {
        ...(server && usage
          ? {
              health: {
                ...server,
                mode: 'server',
                product: 'Dayweave Server',
                hubPort: this.sync?.client.config.hub?.port,
              },
              strictPort: true,
              management: {
                usage,
                closing: () => this.closing,
                shutdown: () => {
                  void this.close().then(
                    () => this.options.onShutdown?.(),
                    (error) => this.options.onShutdown?.(error),
                  );
                },
              },
            }
          : {}),
      });
    });
  }
  close() {
    this.closing = true;
    this.usage?.stopBackground();
    this.shutdown ??= (async () => {
      // Do not release the profile if draining/closing fails: the caller exits nonzero,
      // and stale-lock recovery can then check that this process really ended.
      await this.api?.close();
      await this.judge?.close();
      await this.sync?.close();
      await this.usage?.close();
      this.service.dispose();
      await this.service.flush();
      await this.unlock();
    })();
    return this.shutdown;
  }
}

/** Server and AI-tools entry: every part must start, or the profile is released again. */
export async function startHeadless(options: HeadlessOptions) {
  const runtime = await Runtime.open(options);
  try {
    await runtime.start(true);
  } catch (error) {
    await runtime.close().catch((failure) => {
      console.error('Dayweave startup cleanup failed:', failure);
    });
    throw error;
  }
  return {
    service: runtime.service,
    sync: runtime.sync!,
    usage: runtime.usage!,
    api: runtime.api!,
    close: () => runtime.close(),
  };
}
