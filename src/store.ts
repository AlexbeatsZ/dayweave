import { useSyncExternalStore } from 'react';
import { emptyState, mergeImport, now, stateSchema, type AppState, type Task } from './model';
import { applyDelta, diffState, type StateDelta } from './state-delta';

import { setTimeZone } from './timezone';
const key = 'dayweave.v1';
type Snapshot = {
  data: AppState;
  loaded: boolean;
  error: string;
  errorKind?: 'conflict' | 'storage' | 'operation';
  saving: boolean;
  recovered: boolean;
  path: string;
};
let snapshot: Snapshot = {
  data: emptyState(),
  loaded: false,
  error: '',
  saving: false,
  recovered: false,
  path: '',
};
const listeners = new Set<() => void>();
const jobs: Array<{ delta: StateDelta; data: AppState }> = [];
let authoritative = snapshot.data;
let authoritativeRevision = '';
function acceptRemote(result: { state: AppState; revision?: string }) {
  const revision = result.revision ?? '';
  const [session, count] = revision.split(':');
  const [previousSession, previousCount] = authoritativeRevision.split(':');
  if (session && session === previousSession && Number(count) < Number(previousCount)) return;
  authoritative = stateSchema.parse(result.state);
  authoritativeRevision = revision;
}
let pending: Promise<void> = Promise.resolve();
let pumping = false,
  failed = false,
  closeListenerAttached = false,
  stateListenerAttached = false;
let recovering = false;
function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  setTimeZone(snapshot.data.settings.timeZone);
  listeners.forEach((f) => f());
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
function rebased() {
  return jobs.reduce((state, job) => applyDelta(state, job.delta, false), authoritative);
}
function pump() {
  if (pumping || failed) return pending;
  pumping = true;
  pending = (async () => {
    while (jobs.length) {
      const job = jobs[0];
      try {
        if (window.clearlist?.patch) {
          const result = await window.clearlist.patch(job.delta);
          acceptRemote(result);
        } else {
          if (window.clearlist) await window.clearlist.save(job.data);
          else {
            const previous = localStorage.getItem(key);
            if (previous) localStorage.setItem(`${key}.backup`, previous);
            localStorage.setItem(key, JSON.stringify(job.data));
          }
          authoritative = job.data;
        }
        jobs.shift();
        emit({ data: rebased(), saving: jobs.length > 0, error: '', errorKind: undefined });
      } catch (error) {
        failed = true;
        const conflict = message(error).includes('STATE_CONFLICT:');
        emit({
          saving: false,
          errorKind: conflict ? 'conflict' : 'storage',
          error: conflict
            ? `保存遇到并发冲突，未保存修改仍保留在本机：${message(error)}`
            : `保存失败，请先导出备份：${message(error)}`,
        });
        break;
      }
    }
    pumping = false;
  })();
  return pending;
}

function enqueue(data: AppState) {
  const delta = diffState(snapshot.data, data);
  jobs.push({ delta, data });
  emit({ data, saving: !failed });
  void pump();
}

export const store = {
  async initialize() {
    if (jobs.length || recovering) return;
    if (window.clearlist && !closeListenerAttached) {
      closeListenerAttached = true;
      window.clearlist.onBeforeClose(async () => {
        await pending;
        window.clearlist!.readyToClose(!snapshot.loaded || !snapshot.error);
      });
    }
    if (window.clearlist?.onState && !stateListenerAttached) {
      stateListenerAttached = true;
      window.clearlist.onState((result) => {
        try {
          acceptRemote(result);
          emit({ data: rebased() });
        } catch (error) {
          failed = true;
          emit({ errorKind: 'conflict', error: `其他修改与未保存内容发生冲突：${message(error)}` });
        }
      });
    }
    try {
      if (window.clearlist) {
        const result = await window.clearlist.load();
        acceptRemote(result);
        emit({
          data: authoritative,
          loaded: true,
          recovered: result.recovered,
          path: result.path,
          error: '',
          errorKind: undefined,
        });
      } else {
        const raw = localStorage.getItem(key);
        let recovered = false,
          data: AppState;
        try {
          data = raw ? stateSchema.parse(JSON.parse(raw)) : emptyState();
        } catch (error) {
          const backup = localStorage.getItem(`${key}.backup`);
          if (!backup) throw error;
          data = stateSchema.parse(JSON.parse(backup));
          localStorage.setItem(`${key}.corrupt.${Date.now()}`, raw!);
          localStorage.setItem(key, JSON.stringify(data));
          recovered = true;
        }
        authoritative = data;
        emit({ data, loaded: true, recovered, path: '当前浏览器 · 本地存储', error: '' });
      }
    } catch (error) {
      emit({ error: `无法读取数据：${message(error)}`, loaded: false });
    }
  },
  get: () => snapshot.data,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  async transact(transform: (state: AppState) => AppState) {
    if (recovering) throw new Error('正在恢复数据，请稍后重试');
    if (!snapshot.loaded || snapshot.error) throw new Error(snapshot.error || '数据尚未载入');
    // A rejected user operation is recoverable, unlike a failed disk write.
    // Validate before publishing so a short timer or stale edit cannot poison later saves.
    enqueue(stateSchema.parse(transform(snapshot.data)));
    await store.flush();
    if (snapshot.error) throw new Error(snapshot.error);
    return snapshot.data;
  },
  update(transform: (state: AppState) => AppState) {
    if (!snapshot.loaded || failed || recovering) return;
    let data: AppState;
    try {
      data = stateSchema.parse(transform(snapshot.data));
    } catch (error) {
      emit({ errorKind: 'operation', error: `修改未应用：${message(error)}` });
      return;
    }
    enqueue(data);
  },
  async retry() {
    if (recovering) return;
    failed = false;
    if (jobs.length) {
      emit({ saving: true });
      await pump();
    } else emit({ error: '', errorKind: undefined });
  },
  async reload() {
    if (recovering) return false;
    recovering = true;
    try {
      await pending;
      const result = window.clearlist
        ? await window.clearlist.load()
        : {
            state: stateSchema.parse(JSON.parse(localStorage.getItem(key) ?? 'null')),
            recovered: false,
            path: '当前浏览器 · 本地存储',
          };
      acceptRemote(result);
      jobs.splice(0);
      failed = false;
      emit({
        data: authoritative,
        loaded: true,
        recovered: result.recovered,
        path: result.path,
        saving: false,
        error: '',
        errorKind: undefined,
      });
      return true;
    } catch (error) {
      emit({ error: `重新读取失败，未保存内容仍保留：${message(error)}` });
      return false;
    } finally {
      recovering = false;
    }
  },
  patchTask(id: string, patch: Partial<Task>) {
    store.update((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)),
    }));
  },
  async exportData() {
    const data = snapshot.data;
    if (window.clearlist) return window.clearlist.exportData(data);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `Dayweave-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  },
  async importData(data: unknown) {
    return await store.transact((state) => {
      try {
        return stateSchema.parse(mergeImport(state, data));
      } catch (cause) {
        throw new Error('请使用有效的时织 JSON 备份，版本需为 1。原有数据未改变。', { cause });
      }
    });
  },
  async flush() {
    await pending;
    return snapshot;
  },
  async restore(value?: unknown) {
    if (snapshot.loaded || recovering) return;
    recovering = true;
    try {
      let result: { state: AppState; recovered: boolean; path: string; revision?: string } | null;
      if (window.clearlist) result = await window.clearlist.restoreData();
      else {
        const state = stateSchema.parse(value);
        for (const name of [key, `${key}.backup`]) {
          const raw = localStorage.getItem(name);
          if (raw !== null) localStorage.setItem(`${name}.before-restore.${Date.now()}`, raw);
        }
        localStorage.setItem(key, JSON.stringify(state));
        result = { state, recovered: true, path: '当前浏览器 · 本地存储' };
      }
      if (result) {
        acceptRemote(result);
        jobs.splice(0);
        failed = false;
        emit({
          data: authoritative,
          recovered: result.recovered,
          path: result.path,
          loaded: true,
          error: '',
          errorKind: undefined,
        });
      }
    } catch {
      emit({ error: '恢复失败：请选择有效的时织 JSON 备份。原文件仍保留。' });
    } finally {
      recovering = false;
    }
  },
};
export function useStore() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => snapshot,
  );
}
