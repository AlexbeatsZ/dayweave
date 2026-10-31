import { mkdir, readFile, readdir, stat, open, rename } from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { UsageStore } from './usage-store.js';
import { parseUsageImport } from '../src/usage/import.js';
import { syncUsage } from '../src/usage/sync.js';
import {
  usageSettingsSchema,
  type UsageEvent,
  type UsageSettings,
  type UsageQuery,
  type UsageBridge,
} from '../src/usage/domain.js';
import type { DesktopSync } from './sync.js';

export class DesktopUsage implements UsageBridge {
  private timer?: ReturnType<typeof setInterval>;
  private child?: ChildProcess;
  private running?: Promise<void>;
  private closing = false;
  private error = '';
  private sourceScans = new Map<string, { checkedAt: number; error: string }>();
  constructor(
    readonly store: UsageStore,
    readonly syncEngine: DesktopSync,
    readonly directory: string,
    readonly binary: string,
    readonly localCapture = true,
  ) {
    syncEngine.usage = store;
    syncEngine.refreshUsage = () => this.sync();
  }
  async initialize() {
    await this.applyCollector();
    this.timer = setInterval(() => {
      void this.sync().catch(() => {});
    }, 15000);
    void this.sync().catch(() => {});
    return this;
  }
  query(query: UsageQuery) {
    return Promise.resolve(this.store.query(query));
  }
  async applications() {
    return this.store.database
      .prepare(
        "SELECT DISTINCT json_extract(payload,'$.app') AS app FROM usage_events WHERE json_extract(payload,'$.kind')='app' AND json_extract(payload,'$.app')<>'' ORDER BY app COLLATE NOCASE",
      )
      .all()
      .map((row) => ({ id: String(row.app), name: String(row.app) }));
  }
  async status() {
    let capture = !this.localCapture
      ? '服务器模式已禁用本机采集'
      : this.child
        ? '正在采集'
        : this.store.settings().enabled
          ? '采集不可用'
          : '未启用';
    let error = this.error;
    if (this.child)
      try {
        const status = JSON.parse(
          await readFile(path.join(this.directory, 'collector', 'status.json'), 'utf8'),
        );
        capture =
          (
            {
              recording: '正在采集',
              idle: '本机闲置',
              locked: '本机已锁定',
              permission: '请在系统设置中授权辅助功能',
              paused: '采集已暂停',
              error: '采集异常',
            } as Record<string, string>
          )[status.capture?.state] ?? capture;
        error = status.capture?.last_error || error;
      } catch {}
    const status = this.store.status();
    return {
      ...status,
      pending: this.syncEngine.client.config.hub ? 0 : status.pending,
      capture,
      error,
      permissionRequired: process.platform === 'darwin' && capture === '请在系统设置中授权辅助功能',
    };
  }
  async configure(value: UsageSettings) {
    this.store.configure(usageSettingsSchema.parse(value));
    this.error = '';
    await this.applyCollector();
    return this.status();
  }
  async import(events: UsageEvent[]) {
    return this.store.import(events);
  }
  async connectSource(kind: 'work-review' | 'activitywatch', file: string) {
    const sources = this.store.meta('sources') ?? {};
    sources[kind] = file;
    this.store.setMeta('sources', sources);
    await this.sync();
    return this.status();
  }
  async health() {
    const sources = this.store.meta('sources') ?? {};
    return {
      ...(await this.status()),
      localCapture: this.localCapture,
      sources: [
        { kind: 'collector-cache', path: path.join(this.directory, 'collector', 'agent.db') },
        ...Object.entries(sources).map(([kind, file]) => ({ kind, path: String(file) })),
      ].map((source) => ({
        ...source,
        exists: existsSync(source.path),
        ...this.sourceScans.get(source.path),
      })),
    };
  }
  private async applyCollector() {
    if (!this.localCapture) return;
    const settings = this.store.settings();
    const collector = path.join(this.directory, 'collector');
    if (!settings.enabled) {
      await this.stopCollector();
      return;
    }
    if (!['win32', 'darwin'].includes(process.platform)) {
      this.error = '此平台暂不支持原生采集，可查看所有设备的同步记录';
      return;
    }
    if (!existsSync(this.binary)) {
      this.error =
        '此开发包尚未构建采集程序，请运行 npm run build:collector；已有历史仍可导入和同步';
      return;
    }
    await mkdir(collector, { recursive: true });
    const file = path.join(collector, 'config.json');
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const content = JSON.stringify({
      ...config,
      device: {
        id: this.syncEngine.client.config.deviceId,
        name: os.hostname(),
        platform: process.platform,
      },
      enabled: true,
      screenshot_interval: settings.sampleSeconds,
      idle_threshold_minutes: settings.idleMinutes,
      server_url: null,
      token: null,
      browser_enabled: settings.browser,
      ocr_enabled: false,
      storage: { screenshots_enabled: false },
      privacy: {
        excluded_apps: settings.excludedApps,
        excluded_domains: settings.excludedDomains,
        excluded_keywords: settings.excludedKeywords,
        app_rules: [],
      },
    });
    const handle = await open(file + '.tmp', 'w', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(file + '.tmp', file);
    if (this.child || this.closing) return;
    const log = createWriteStream(path.join(collector, 'collector.log'), {
      flags: 'a',
      mode: 0o600,
    });
    const child = spawn(this.binary, ['--data-dir', collector, 'run', '--host-managed'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.error = '';
    child.stdin?.on('error', () => {});
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once('error', (error) => {
      this.error = `采集启动失败：${error.message}`;
    });
    child.once('close', (code) => {
      if (this.child === child) {
        this.child = undefined;
        if (!this.closing && settings.enabled)
          this.error = `采集已停止（${code ?? 'signal'}），将在下轮重试`;
      }
      log.end();
    });
  }
  private importWorkReview(file: string) {
    if (!existsSync(file)) return;
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      database.prepare('ATTACH DATABASE ? AS merged').run(this.store.file);
      const rows = database
        .prepare(
          "SELECT e.timestamp,e.id,e.device_id,e.payload FROM events e WHERE NOT EXISTS (SELECT 1 FROM merged.usage_events u WHERE u.id='work-review:'||e.device_id||':'||e.id) ORDER BY e.timestamp,e.id,e.device_id LIMIT 2000",
        )
        .all();
      const devices = new Map(
        database
          .prepare('SELECT id,name,platform FROM devices')
          .all()
          .map((device) => [String(device.id), device]),
      );
      const events = rows.flatMap((row) => {
        const data = JSON.parse(String(row.payload));
        const device = devices.get(data.device_id);
        return parseUsageImport({
          ...data,
          device_name: device?.name ?? os.hostname(),
          platform: device?.platform ?? process.platform,
        });
      });
      this.store.transaction(() => {
        for (let offset = 0; offset < events.length; offset += 500) {
          const batch = events.slice(offset, offset + 500);
          for (const event of batch)
            this.store.database
              .prepare(
                `INSERT OR IGNORE INTO usage_events(id,device,start,end,payload,owner,pending) VALUES(?,?,?,?,?,'@local',1)`,
              )
              .run(event.id, event.deviceId, event.start, event.end, JSON.stringify(event));
        }
      });
      if (file === path.join(this.directory, 'collector', 'agent.db')) {
        const local = new DatabaseSync(file);
        try {
          local.exec('BEGIN IMMEDIATE');
          local.prepare('ATTACH DATABASE ? AS merged').run(this.store.file);
          local.exec(
            "UPDATE events SET synced=1 WHERE synced=0 AND EXISTS (SELECT 1 FROM merged.usage_events u WHERE u.id='work-review:'||events.device_id||':'||events.id)",
          );
          local.exec('COMMIT');
        } finally {
          local.close();
        }
      }
    } finally {
      database.close();
    }
  }
  private async importActivityWatch(root: string) {
    let processed = 0;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 4 || processed >= 200) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory() && entry.name !== 'exports') await walk(file, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.json') && processed < 200) {
          const info = await stat(file),
            signature = `${info.mtimeMs}:${info.size}`;
          if (this.store.meta(`source:${file}`) === signature) continue;
          if (info.size > 10 * 1024 * 1024) throw new Error('AW 批次超过 10 MB');
          const content = JSON.parse(await readFile(file, 'utf8'));
          if (
            !Array.isArray(content) &&
            !content?.bucket &&
            !content?.buckets &&
            !content?.bucket_id &&
            content?.format !== 'dayweave-usage' &&
            !Array.isArray(content?.items)
          )
            continue;
          const events = parseUsageImport(content, Math.floor(info.mtimeMs));
          this.store.import(events);
          this.store.setMeta(`source:${file}`, signature);
          processed++;
        }
      }
    };
    await walk(root, 0);
  }
  sync() {
    if (this.closing) return Promise.resolve();
    if (this.running) return this.running;
    this.running = (async () => {
      const sources = this.store.meta('sources') ?? {};
      if (this.localCapture && this.store.settings().enabled && !this.child)
        await this.applyCollector();
      const ownDatabase = path.join(this.directory, 'collector', 'agent.db');
      const failures: string[] = [];
      const scan = async (file: string, action: () => void | Promise<void>) => {
        let error = '';
        try {
          await action();
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
          failures.push(error);
        }
        this.sourceScans.set(file, { checkedAt: Date.now(), error });
      };
      await scan(ownDatabase, () => this.importWorkReview(ownDatabase));
      if (sources['work-review'])
        await scan(sources['work-review'], () => this.importWorkReview(sources['work-review']));
      if (sources.activitywatch)
        await scan(sources.activitywatch, () => this.importActivityWatch(sources.activitywatch));
      if (!this.closing) await syncUsage(this.syncEngine.client, this.store);
      if (failures.length) throw new Error(failures.join('; '));
      if (this.error.startsWith('同步或载入失败')) this.error = '';
    })()
      .catch((error) => {
        this.error = `同步或载入失败：${error instanceof Error ? error.message : String(error)}`;
        throw error;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await this.stopCollector();
    await this.running?.catch(() => {});
    this.store.close();
  }
  private async stopCollector() {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    const stopped = new Promise<void>((resolve) => child.once('close', () => resolve()));
    const timeout = setTimeout(() => child.kill(), 5000);
    child.stdin?.end();
    try {
      await stopped;
    } finally {
      clearTimeout(timeout);
    }
  }
}
