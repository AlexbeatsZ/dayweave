import { MAX_SCRIPT_LENGTH, timestamp, type GoalScript, type State } from './domain.js';

export function saveGoalScript(
  state: State,
  script: Omit<GoalScript, 'updatedAt'>,
  expected?: number,
) {
  const scripts = state.scripts ?? [];
  const previous = scripts.find((row) => row.id === script.id);
  if (previous?.updatedAt !== expected) throw new Error('脚本已在其他设备更新，请重新打开。');
  const name = script.name.trim();
  if (!name || name.length > 100) throw new Error('请填写有效的脚本名称。');
  if (script.code.length > MAX_SCRIPT_LENGTH) throw new Error('脚本不能超过 200 KB');
  if (!previous && scripts.length >= 200) throw new Error('脚本库最多 200 个脚本。');
  if (scripts.some((row) => row.id !== script.id && row.name === name))
    throw new Error('已有同名脚本。');
  const next = { ...script, name, updatedAt: timestamp(previous?.updatedAt) };
  return {
    ...state,
    scripts: previous
      ? scripts.map((row) => (row.id === script.id ? next : row))
      : [...scripts, next],
  };
}

export function removeGoalScript(state: State, id: string, expected: number) {
  const previous = state.scripts?.find((row) => row.id === id);
  if (!previous || previous.updatedAt !== expected)
    throw new Error('脚本已在其他设备更新，请重新打开。');
  if (state.goals.some((goal) => goal.kind === 'script' && goal.scriptId === id))
    throw new Error('有目标正在使用此脚本，请先修改或删除这些目标。');
  return { ...state, scripts: state.scripts!.filter((row) => row.id !== id) };
}
