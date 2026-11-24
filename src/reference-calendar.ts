import type { CalendarEvent } from './event-model.js';
import { eventBounds } from './event-domain.js';
import { dayStart, shiftDay, zoneDateKey } from './timezone.js';
import { subtract } from './timelog/script-util.js';

/** Fixed UTC+8 reference axis, matching CodingWindowGuard schedule.json. */
export const referenceSlots = [
  {
    start: 0,
    end: 45,
    kind: 'study',
    label: '学习',
  },
  {
    start: 45,
    end: 55,
    kind: 'break',
    label: '休息',
  },
  {
    start: 55,
    end: 100,
    kind: 'study',
    label: '学习',
  },
  {
    start: 100,
    end: 110,
    kind: 'break',
    label: '休息',
  },
  {
    start: 110,
    end: 155,
    kind: 'study',
    label: '学习',
  },
  {
    start: 155,
    end: 165,
    kind: 'break',
    label: '休息',
  },
  {
    start: 165,
    end: 210,
    kind: 'study',
    label: '学习',
  },
  {
    start: 210,
    end: 220,
    kind: 'break',
    label: '休息',
  },
  {
    start: 315,
    end: 360,
    kind: 'study',
    label: '学习',
  },
  {
    start: 360,
    end: 370,
    kind: 'break',
    label: '休息',
  },
  {
    start: 370,
    end: 415,
    kind: 'study',
    label: '学习',
  },
  {
    start: 415,
    end: 425,
    kind: 'break',
    label: '休息',
  },
  {
    start: 425,
    end: 470,
    kind: 'study',
    label: '学习',
  },
  {
    start: 470,
    end: 480,
    kind: 'break',
    label: '休息',
  },
  {
    start: 480,
    end: 525,
    kind: 'study',
    label: '学习（第1节）',
  },
  {
    start: 525,
    end: 535,
    kind: 'break',
    label: '休息',
  },
  {
    start: 535,
    end: 580,
    kind: 'study',
    label: '学习（第2节）',
  },
  {
    start: 580,
    end: 595,
    kind: 'break',
    label: '休息',
  },
  {
    start: 595,
    end: 640,
    kind: 'study',
    label: '学习（第3节）',
  },
  {
    start: 640,
    end: 650,
    kind: 'break',
    label: '休息',
  },
  {
    start: 650,
    end: 695,
    kind: 'study',
    label: '学习（第4节）',
  },
  {
    start: 695,
    end: 705,
    kind: 'break',
    label: '休息',
  },
  {
    start: 705,
    end: 750,
    kind: 'study',
    label: '学习（第5节）',
  },
  {
    start: 750,
    end: 810,
    kind: 'break',
    label: '午休 / 吃饭',
  },
  {
    start: 810,
    end: 855,
    kind: 'study',
    label: '学习（第6节）',
  },
  {
    start: 855,
    end: 865,
    kind: 'break',
    label: '休息',
  },
  {
    start: 865,
    end: 910,
    kind: 'study',
    label: '学习（第7节）',
  },
  {
    start: 910,
    end: 925,
    kind: 'break',
    label: '休息',
  },
  {
    start: 925,
    end: 970,
    kind: 'study',
    label: '学习（第8节）',
  },
  {
    start: 970,
    end: 980,
    kind: 'break',
    label: '休息',
  },
  {
    start: 980,
    end: 1025,
    kind: 'study',
    label: '学习（第9节）',
  },
  {
    start: 1025,
    end: 1035,
    kind: 'break',
    label: '休息',
  },
  {
    start: 1035,
    end: 1080,
    kind: 'study',
    label: '学习（第10节）',
  },
  {
    start: 1080,
    end: 1110,
    kind: 'break',
    label: '晚饭 / 休息',
  },
  {
    start: 1110,
    end: 1155,
    kind: 'study',
    label: '学习（第11节）',
  },
  {
    start: 1155,
    end: 1165,
    kind: 'break',
    label: '休息',
  },
  {
    start: 1165,
    end: 1210,
    kind: 'study',
    label: '学习（第12节）',
  },
  {
    start: 1210,
    end: 1220,
    kind: 'break',
    label: '休息',
  },
  {
    start: 1220,
    end: 1265,
    kind: 'study',
    label: '学习（第13节）',
  },
  {
    start: 1265,
    end: 1275,
    kind: 'break',
    label: '休息',
  },
  {
    start: 1275,
    end: 1320,
    kind: 'study',
    label: '学习',
  },
  {
    start: 1320,
    end: 1330,
    kind: 'break',
    label: '休息',
  },
  {
    start: 1330,
    end: 1375,
    kind: 'study',
    label: '学习',
  },
  {
    start: 1375,
    end: 1385,
    kind: 'break',
    label: '休息',
  },
  {
    start: 1385,
    end: 1430,
    kind: 'study',
    label: '学习',
  },
  {
    start: 1430,
    end: 1440,
    kind: 'break',
    label: '休息',
  },
] as const;
export const referenceZone = '+08:00';
export type ReferenceBlock = {
  id: string;
  title: string;
  start: number;
  end: number;
  kind: 'study' | 'break';
};

/** Derived only: actual arrangements always win, and reference fragments can be any length. */
export function referenceBlocks(
  events: CalendarEvent[],
  first = zoneDateKey(Date.now(), referenceZone),
  days = 43,
): ReferenceBlock[] {
  const busy = events.filter((event) => !event.deletedAt).map(eventBounds);
  const result: ReferenceBlock[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = shiftDay(first, offset),
      midnight = dayStart(date, referenceZone);
    const daily = busy.filter((span) => span.start < midnight + 86400000 && span.end > midnight);
    for (const slot of referenceSlots) {
      for (const piece of subtract(
        { start: midnight + slot.start * 60000, end: midnight + slot.end * 60000 },
        daily,
      )) {
        result.push({
          ...piece,
          id: `reference-${date}-${slot.start}-${piece.start}-${piece.end}`,
          title: `参考 · ${slot.kind === 'study' ? '学习' : slot.label}`,
          kind: slot.kind,
        });
      }
    }
  }
  return result;
}
