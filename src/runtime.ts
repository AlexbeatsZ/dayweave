import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from './store';
import { applyTheme } from './theme';
import { store } from './store';
import { finishDueTimer } from './timelog/domain';

let clock = Date.now();
let interval: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const subscribeClock = (notify: () => void) => {
  listeners.add(notify);
  if (!interval) {
    clock = Date.now();
    interval = setInterval(() => {
      clock = Date.now();
      listeners.forEach((listener) => listener());
    }, 1000);
  }
  return () => {
    listeners.delete(notify);
    if (!listeners.size) {
      clearInterval(interval);
      interval = undefined;
    }
  };
};
export function useClock() {
  return useSyncExternalStore(subscribeClock, () => clock);
}

export function useApplicationTheme() {
  const { data, loaded } = useStore();
  useEffect(() => {
    if (!loaded) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(data.settings.theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data.settings.theme, loaded]);
}

export function useCountdownCompletion() {
  const { data, loaded } = useStore(),
    clock = useClock();
  const timer = data.timelog.timer;
  useEffect(() => {
    if (
      !loaded ||
      timer?.runningSince == null ||
      timer.plannedEndAt == null ||
      clock < timer.plannedEndAt
    )
      return;
    void store
      .transact((state) => ({ ...state, timelog: finishDueTimer(state.timelog, Date.now()) }))
      .catch(() => {});
  }, [loaded, clock, timer?.id, timer?.runningSince, timer?.plannedEndAt]);
}
