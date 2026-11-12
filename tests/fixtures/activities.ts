import { emptyState } from '../../src/model.js';
import { initialState, type Activity } from '../../src/timelog/domain.js';

// Tests that record time provide their own activity catalog, like a real profile.
export function timelogWithActivities() {
  const entries: [id: string, name: string, nature: Activity['nature']][] = [
    ['study', '学习', 'positive'],
    ['work', '工作', 'positive'],
    ['reading', '阅读', 'positive'],
    ['exercise', '运动', 'positive'],
    ['life', '日常生活', 'neutral'],
    ['scroll', '无目的刷手机', 'negative'],
  ];
  const colors = ['#4264b2', '#56876e', '#927aa6', '#7a913d', '#a98145', '#b66773'];
  const state = initialState();
  state.activities = entries.map(([id, name, nature], index) => ({
    id,
    name,
    nature,
    color: colors[index],
    archived: false,
    updatedAt: state.settings.updatedAt,
  }));
  return state;
}

export function stateWithActivities() {
  return { ...emptyState(), timelog: timelogWithActivities() };
}
