/** Browser adapter for the same script test execution used by the headless API. */
import type { AppState } from '../model.js';
import { loadUsageRange } from '../usage/client.js';
import type { ScriptGoal } from './domain.js';
import { testScript as runTest } from './script-test.js';

export { inspectScript } from './script-test.js';

export function testScript(
  code: string,
  state: AppState,
  goal: Pick<ScriptGoal, 'period' | 'params'>,
  key: string,
) {
  return runTest(code, state, goal, key, loadUsageRange);
}
