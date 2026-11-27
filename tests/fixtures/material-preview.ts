import { newPlanGroup, newTask } from '../../src/model';
import { newEvent } from '../../src/event-domain';
import { dayStart } from '../../src/timelog/domain';
import { setTimeZone, shiftDay } from '../../src/timezone';
import { stateWithActivities } from './activities';

export const previewNow = Date.parse('2026-11-26T14:20:00+08:00');
export const previewDay = '2026-11-26';

/** Synthetic, isolated browser data. Never reads or connects to an installed profile. */
export function materialPreviewState(theme: 'light' | 'dark' = 'light') {
  setTimeZone('Asia/Shanghai');
  const state = stateWithActivities();
  state.settings.theme = theme;
  const morning = newPlanGroup(previewDay, {
    title: '上午 · 深度学习',
    until: '12:00',
    minutes: 120,
    order: 0,
  });
  const afternoon = newPlanGroup(previewDay, {
    title: '下午 · 实验与整理',
    until: '18:00',
    minutes: 150,
    order: 1,
  });
  state.planGroups = [morning, afternoon];
  state.lists.push(
    { id: 'study-list', name: '学习与研究', color: '#3f5f90', order: 1, activityId: 'study' },
    { id: 'work-list', name: '项目与实验', color: '#53786b', order: 2, activityId: 'work' },
    { id: 'life-list', name: '日常生活', color: '#92704a', order: 3, activityId: 'life' },
  );
  state.tagColors = {
    tasks: { 量子化学: '#3f5f90', 阅读: '#6f5675', 实验: '#53786b' },
    records: { 专注: '#3f5f90' },
  };
  state.tasks = [
    newTask('整理量子化学课堂笔记', {
      listId: 'study-list',
      dates: { [previewDay]: morning.id },
      tags: ['量子化学'],
      estimatedMinutes: 45,
      notes: '补齐波函数归一化的推导，整理课后的三个问题。',
      order: 0,
    }),
    newTask('完成物理化学第六章习题', {
      listId: 'study-list',
      dates: { [previewDay]: morning.id },
      estimatedMinutes: 60,
      order: 1,
    }),
    newTask('整理本周的实验数据', {
      listId: 'work-list',
      dates: { [previewDay]: afternoon.id },
      tags: ['实验'],
      estimatedMinutes: 45,
      notes: '核对红外光谱，更新实验记录。',
      order: 2,
    }),
    newTask('读完一篇新论文', {
      listId: 'study-list',
      dates: { [previewDay]: afternoon.id },
      tags: ['阅读'],
      estimatedMinutes: 30,
      order: 3,
    }),
    newTask('傍晚出去走一走', {
      listId: 'life-list',
      dates: { [previewDay]: null },
      estimatedMinutes: 30,
      order: 4,
    }),
    newTask('准备明天的实验材料', {
      listId: 'work-list',
      dates: { [shiftDay(previewDay, 1)]: null },
      order: 5,
    }),
    newTask('试试新的阅读方法', { listId: 'study-list', tags: ['阅读'], order: 6 }),
  ];
  const start = dayStart(previewDay);
  state.timelog.records = [
    {
      id: 'study-record',
      activityId: 'study',
      note: '量子化学 · 波函数与算符',
      tags: ['专注'],
      spans: [{ start: start + 3600000, end: start + 8700000 }],
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 8700000,
    },
    {
      id: 'reading-record',
      activityId: 'reading',
      note: '读文献，记录值得继续探索的问题',
      tags: [],
      spans: [{ start: start + 9000000, end: start + 11700000 }],
      nature: 'positive',
      deletedAt: null,
      updatedAt: start + 11700000,
    },
  ];
  state.timelog.goals = [
    {
      id: 'study-goal',
      name: '留两小时给学习',
      rules: [{ activities: ['study'], tags: [], excludeTags: [] }],
      period: 'day',
      comparison: 'atLeast',
      minutes: 120,
      archived: false,
      updatedAt: start,
    },
    {
      id: 'reading-goal',
      name: '每天读一点',
      rules: [{ activities: ['reading'], tags: [], excludeTags: [] }],
      period: 'day',
      comparison: 'atLeast',
      minutes: 30,
      archived: false,
      updatedAt: start,
    },
    {
      id: 'exercise-goal',
      name: '动起来，半小时',
      rules: [{ activities: ['exercise'], tags: [], excludeTags: [] }],
      period: 'day',
      comparison: 'atLeast',
      minutes: 30,
      archived: false,
      updatedAt: start,
    },
  ];
  state.calendarEvents = [
    newEvent({
      title: '物理化学',
      date: previewDay,
      type: 'course',
      periods: [['15:30', '17:10']],
      location: 'H4306',
      teacher: '任课教师',
      color: '#6f5675',
    }),
    newEvent({
      title: '量子化学',
      date: shiftDay(previewDay, -1),
      type: 'course',
      periods: [['09:55', '11:35']],
      location: 'H2105',
      color: '#3f5f90',
    }),
    newEvent({
      title: '实验室讨论',
      date: shiftDay(previewDay, 1),
      type: 'meeting',
      periods: [['13:30', '15:10']],
      location: '化学楼',
      color: '#53786b',
    }),
  ];
  return state;
}
