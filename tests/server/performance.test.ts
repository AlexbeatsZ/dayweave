import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { UsageStore } from '../../electron/usage-store.js';
import { emptyState } from '../../src/model.js';

test(
  'large imported history yields to health/export during source scans and status, and cancels on stop',
  { timeout: 60000 },
  async () => {
    const base = path.join(os.tmpdir(), '.agents');
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, 'dayweave-large-history-'));
    const profile = path.join(root, 'profile');
    await mkdir(profile);
    const sourceFile = path.join(root, 'source.db');
    const source = new DatabaseSync(sourceFile);
    const store = new UsageStore(path.join(profile, 'usage.db'));
    const count = 100000;
    const title = 'Synthetic fixture '.repeat(75);
    source.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;
    CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,platform TEXT);
    CREATE TABLE events(device_id TEXT,id TEXT,timestamp INTEGER,payload TEXT,synced INTEGER,PRIMARY KEY(device_id,id));
    CREATE INDEX events_time ON events(timestamp DESC,id DESC);`);
    store.database.exec('PRAGMA synchronous=OFF');
    const insertSource = source.prepare('INSERT INTO events VALUES(?,?,?,?,1)');
    const insertUsage = store.database.prepare(
      'INSERT INTO usage_events(id,device,start,end,payload,owner,pending) VALUES(?,?,?,?,?,?,0)',
    );
    source.prepare('INSERT INTO devices VALUES(?,?,?)').run('fixture', 'Fixture', 'win32');
    source.exec('BEGIN');
    store.database.exec('BEGIN');
    for (let index = 0; index < count; index++) {
      const id = String(index).padStart(9, '0'),
        seconds = 1770000000 + index * 10;
      insertSource.run(
        'fixture',
        id,
        seconds,
        JSON.stringify({
          id,
          device_id: 'fixture',
          timestamp: seconds,
          duration: 10,
          app_name: 'Synthetic',
          window_title: title,
        }),
      );
      const event = {
        id: `work-review:fixture:${id}`,
        deviceId: 'work-review:fixture',
        deviceName: 'Fixture',
        platform: 'win32',
        source: 'work-review',
        kind: 'app',
        start: seconds * 1000,
        end: (seconds + 10) * 1000,
        app: 'Synthetic',
        title,
        url: '',
        category: '',
        revision: 1,
        deleted: false,
      };
      insertUsage.run(
        event.id,
        event.deviceId,
        event.start,
        event.end,
        JSON.stringify(event),
        '@local',
      );
    }
    source.exec('COMMIT');
    store.database.exec('COMMIT');
    source.close();
    store.setMeta('sources', { 'work-review': sourceFile });
    store.close();
    await writeFile(path.join(profile, 'data.json'), JSON.stringify(emptyState()));
    const config = path.join(root, 'server.json');
    await writeFile(
      config,
      JSON.stringify({
        profile,
        createProfile: true,
        apiPort: 0,
        hub: 'enable',
        initialHubPort: 0,
        discovery: false,
      }),
    );
    const child = spawn(
      process.execPath,
      [
        path.join(
          process.env.DAYWEAVE_TEST_SERVER_PACKAGE ?? path.resolve('release/Dayweave-Server'),
          'server.mjs',
        ),
        '--config',
        config,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const exited = once(child, 'exit');
    let output = '',
      info: any;
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const request = async (route: string, method = 'GET') => {
      try {
        const response = await fetch(info.url + route, {
          method,
          // Fixture VACUUM can block this client past a pooled socket's idle
          // lifetime. A fresh connection measures service latency independently.
          headers: { Authorization: `Bearer ${info.token}`, Connection: 'close' },
          signal: AbortSignal.timeout(5000),
        });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        return result.data;
      } catch (error) {
        throw new Error(
          `${route} failed; process exit=${child.exitCode}; server output=${output}`,
          { cause: error },
        );
      }
    };
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(output);
        try {
          info = JSON.parse(await readFile(path.join(profile, 'api.json'), 'utf8'));
          break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(info, output);
      const healthTimes: number[] = [];
      let statusDone = false,
        scanDone = false;
      const detailed = request('/server/status').finally(() => {
        statusDone = true;
      });
      const scan = request('/sync/now', 'POST').finally(() => {
        scanDone = true;
      });
      void detailed.catch(() => {});
      void scan.catch(() => {});
      let whileStatus = 0,
        whileScan = 0;
      for (let attempt = 0; attempt < 30 && (!statusDone || !scanDone); attempt++) {
        const started = performance.now();
        await request(attempt % 2 ? '/export' : '/health');
        healthTimes.push(performance.now() - started);
        if (!statusDone) whileStatus++;
        if (!scanDone) whileScan++;
      }
      assert.ok(
        whileStatus >= 2,
        'Health/export must respond while detailed aggregation is still running',
      );
      assert.ok(
        whileScan >= 2,
        'Health/export must respond while historical import scanning is still running',
      );
      // Source writes can synchronously wait for SQLite locks. Keep that fixture
      // work outside the response window, so it cannot delay the probe client.
      const append = new DatabaseSync(sourceFile);
      try {
        append.exec('PRAGMA busy_timeout=5000');
        append.prepare('INSERT INTO events VALUES(?,?,?,?,1)').run(
          'fixture',
          'late-during-scan',
          1,
          JSON.stringify({
            id: 'late-during-scan',
            device_id: 'fixture',
            timestamp: 1,
            duration: 10,
            app_name: 'Late synthetic',
            window_title: 'old timestamp received during a scan',
          }),
        );
      } finally {
        append.close();
      }
      assert.equal((await detailed).usage.count, count);
      await scan;
      // Re-scan if the append happened just after the prior scan's end. An old
      // timestamp must remain eligible without relying on a persistent watermark.
      await request('/sync/now', 'POST');
      assert.equal((await request('/usage/status')).count, count + 1);
      const vacuum = new DatabaseSync(sourceFile);
      try {
        vacuum.exec('PRAGMA busy_timeout=5000; VACUUM');
      } finally {
        vacuum.close();
      }
      const until = Date.now() + 16500;
      while (Date.now() < until) {
        const start = performance.now();
        await request('/health');
        healthTimes.push(performance.now() - start);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.ok(Math.max(...healthTimes) < 1500, JSON.stringify(healthTimes));
      // No-op historical scans must not allocate delivery sequence numbers.
      const reader = new DatabaseSync(path.join(profile, 'usage.db'), { readOnly: true });
      assert.equal(
        reader.prepare("SELECT seq FROM sqlite_sequence WHERE name='usage_events'").get()!.seq,
        count + 1,
      );
      reader.close();
      const active = request('/sync/now', 'POST');
      const reading = fetch(info.url + '/server/status', {
        headers: { Authorization: `Bearer ${info.token}`, Connection: 'close' },
        signal: AbortSignal.timeout(5000),
      }).then(async (response) => ({ status: response.status, value: await response.json() }));
      await request('/health');
      const stopping = performance.now();
      await request('/server/shutdown', 'POST');
      await active;
      assert.ok(
        [500, 503].includes((await reading).status),
        'Shutdown must cancel and close the in-flight status reader',
      );
      const [code] = await exited;
      assert.equal(code, 0, output);
      assert.ok(performance.now() - stopping < 5000);
      const saved = new UsageStore(path.join(profile, 'usage.db'));
      assert.equal(
        saved.database
          .prepare(
            "SELECT count(*) AS count FROM usage_events WHERE id='work-review:fixture:late-during-scan'",
          )
          .get()!.count,
        1,
      );
      saved.close();
      console.log(
        JSON.stringify({
          syntheticRows: count,
          maxHealthExportMs: Math.max(...healthTimes),
          responsesDuringStatus: whileStatus,
          responsesDuringScan: whileScan,
          stopMs: performance.now() - stopping,
        }),
      );
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exited;
      }
      assert.ok(root.startsWith(base + path.sep));
      await rm(root, { recursive: true, force: true });
    }
  },
);
