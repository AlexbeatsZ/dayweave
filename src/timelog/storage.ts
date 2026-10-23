import { store } from '../store';
import { validateState, type State } from './domain';
import { exportText } from '../files';
export async function readState() {
  return store.get().timelog;
}
export async function mutateState(fn: (state: State) => State) {
  return (await store.transact((s) => ({ ...s, timelog: validateState(fn(s.timelog)) }))).timelog;
}
export const download = exportText;
