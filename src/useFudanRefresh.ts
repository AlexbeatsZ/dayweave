import { useEffect, useSyncExternalStore } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { isMobileApp } from './files';
import { nativeFiles } from './native-files';
import { store, useStore } from './store';
import { parseFudanCourses } from './fudan-import';
import {
  fudanSource,
  fudanSourceSchema,
  refreshFudanSchedule,
  type FudanSource,
} from './fudan-refresh';
import type { ImportPreview } from './course-import';
import { mergeSchedule, type Schedule } from './schedule';

const key = 'dayweave.fudan-source.v1';
const interval = 15 * 60 * 1000;
let snapshot: { source: FudanSource | null; busy: boolean; error: string } = {
  source: null,
  busy: false,
  error: '',
};
let initialized = false,
  attemptedAt = 0,
  generation = 0,
  appActive = true,
  importActive = false,
  checkPending = false;
const listeners = new Set<() => void>();
function emit(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((notify) => notify());
}
function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    const content = localStorage.getItem(key);
    if (content) snapshot = { ...snapshot, source: fudanSourceSchema.parse(JSON.parse(content)) };
  } catch {
    snapshot = { ...snapshot, error: '自动更新设置无法读取，请重新通过网站导入课表。' };
  }
}
function save(source: FudanSource | null) {
  if (source) localStorage.setItem(key, JSON.stringify(source));
  else localStorage.removeItem(key);
  emit({ source, error: '' });
}
export function useFudanSource() {
  initialize();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}
function cancelRefresh() {
  generation++;
  attemptedAt = 0;
  if (isMobileApp && snapshot.busy) void nativeFiles.cancelFudanRefresh().catch(() => {});
}
function retainOwnership(source: FudanSource, next: FudanSource) {
  return {
    ...source,
    courseIds: [...new Set([...source.courseIds, ...next.courseIds])],
    eventIds: [...new Set([...source.eventIds, ...next.eventIds])],
  };
}
export function setFudanImportActive(active: boolean) {
  if (importActive === active) return;
  importActive = active;
  if (active) cancelRefresh();
  else void refreshFudan();
}
/** Confirmed imports and automatic refreshes share the course transaction and ownership journal. */
export async function confirmCourseImport(preview: ImportPreview) {
  initialize();
  cancelRefresh();
  const source = snapshot.source;
  const next =
    isMobileApp && preview.source?.kind === 'fudan' ? fudanSource(preview, Date.now()) : null;
  const replace = !!(next && source && next.semesterId === source.semesterId);
  const merge = (local: Schedule) =>
    replace
      ? refreshFudanSchedule(local, preview, source!)
      : mergeSchedule(local, preview.schedule);
  // Reject incompatible semesters before changing the journal or the business state.
  merge(store.get().schedule);
  if (next) save(replace ? retainOwnership(source!, next) : { ...next, checkedAt: 0 });
  await store.transact((state) => ({ ...state, schedule: merge(state.schedule) }));
  if (next) save(next);
}
export function stopFudanRefresh() {
  cancelRefresh();
  save(null);
}
export async function refreshFudan(force = false) {
  initialize();
  const source = snapshot.source;
  if (!isMobileApp || !source || snapshot.busy || importActive || !appActive || document.hidden)
    return;
  const at = Date.now();
  if (!force && at - Math.max(attemptedAt, source.checkedAt) < interval) return;
  attemptedAt = at;
  const active = generation;
  emit({ busy: true, error: '' });
  try {
    const { content } = await nativeFiles.refreshFudan({ semesterId: source.semesterId });
    if (generation !== active) return; // Disabling/reimporting invalidates an in-flight request.
    const preview = parseFudanCourses(content, store.get().schedule, at, true);
    // Preflight validates the selected semester before touching connection metadata or data.
    const before = store.get().schedule;
    const after = refreshFudanSchedule(before, preview, source);
    const nextSource = fudanSource(preview, at);
    if (after !== before) {
      // Track both generations before the transaction, so an interrupted save can be retried safely.
      save(retainOwnership(source, nextSource));
      await store.transact((state) => ({
        ...state,
        schedule: refreshFudanSchedule(state.schedule, preview, source),
      }));
    }
    // An unchanged optimistic view can still have failed or pending disk writes.
    // Never shrink the recovery journal until the underlying queue is healthy.
    const saved = await store.flush();
    if (!saved.loaded || saved.error) throw new Error(saved.error || '数据尚未载入');
    if (generation === active) save(nextSource);
  } catch (error) {
    if (generation === active) {
      const message = error instanceof Error ? error.message : String(error);
      // Returning from the official login window or backgrounding is not a school failure.
      if (/\[FUDAN_(?:CANCELED|BUSY)\]/.test(message)) attemptedAt = 0;
      else emit({ error: message || '课表更新失败，已有课表已保留。' });
    }
  } finally {
    emit({ busy: false });
    if (checkPending) {
      checkPending = false;
      void refreshFudan();
    }
  }
}
export function useFudanRefresh() {
  const { loaded } = useStore();
  useEffect(() => {
    if (!loaded || !isMobileApp) return;
    void refreshFudan();
    const resume = () => {
      if (!document.hidden && appActive) {
        if (snapshot.busy) checkPending = true;
        else void refreshFudan();
      } else if (snapshot.busy) cancelRefresh();
    };
    document.addEventListener('visibilitychange', resume);
    const timer = setInterval(resume, interval);
    const listener = NativeApp.addListener('appStateChange', ({ isActive }) => {
      appActive = isActive;
      resume();
    });
    return () => {
      document.removeEventListener('visibilitychange', resume);
      clearInterval(timer);
      cancelRefresh();
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [loaded]);
}
