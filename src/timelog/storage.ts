import { store } from '../store';
import { validateState, type State } from './domain';
import { exportText } from '../files';
export const subscribe = store.subscribe;
export async function readState() {
  return store.get().timelog;
}
export async function mutateState(fn: (state: State) => State) {
  return (await store.transact((s) => ({ ...s, timelog: validateState(fn(s.timelog)) }))).timelog;
}
export async function readRawStorage() {
  return JSON.stringify(store.get(), null, 2);
}
export const download = exportText;
