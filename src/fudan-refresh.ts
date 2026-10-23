import { z } from 'zod';
import type { ImportPreview } from './course-import';
import { mergeSchedule, type Schedule } from './schedule';

// Device-local connection metadata, never credentials or a second copy of courses.
export const fudanSourceSchema = z.object({
  semesterId: z.string().regex(/^\d{1,12}$/),
  semesterStart: z.iso.date(),
  totalWeeks: z.number().int().min(1).max(60),
  courseIds: z.array(z.string()).max(4000),
  eventIds: z.array(z.string()).max(240000),
  checkedAt: z.number().finite().nonnegative(),
});
export type FudanSource = z.infer<typeof fudanSourceSchema>;

export function fudanSource(preview: ImportPreview, at: number): FudanSource {
  return fudanSourceSchema.parse({
    semesterId: preview.source?.semesterId,
    semesterStart: preview.schedule.semesterStart,
    totalWeeks: preview.schedule.totalWeeks,
    courseIds: preview.schedule.courses.map((course) => course.id),
    eventIds: preview.schedule.events.map((event) => event.id),
    checkedAt: at,
  });
}

/** Replace only the rows owned by this school subscription; preserve manual arrangements. */
export function refreshFudanSchedule(
  local: Schedule,
  preview: ImportPreview,
  source: FudanSource,
): Schedule {
  if (
    preview.source?.semesterId !== source.semesterId ||
    [local, preview.schedule].some(
      (schedule) =>
        schedule.semesterStart !== source.semesterStart ||
        schedule.totalWeeks !== source.totalWeeks ||
        schedule.timeZone !== 'Asia/Shanghai',
    )
  )
    throw new Error('学期或时区已改变，自动更新已暂停；请通过网站导入重新确认学期。');
  const courses = new Set(source.courseIds),
    events = new Set(source.eventIds);
  const next = mergeSchedule(
    {
      ...local,
      courses: local.courses.filter((course) => !courses.has(course.id)),
      events: local.events.filter((event) => !events.has(event.id)),
    },
    preview.schedule,
  );
  // Empty school semesters must not reset locally adjusted periods or other settings.
  const result = { ...local, courses: next.courses, events: next.events };
  const content = (schedule: Schedule) =>
    JSON.stringify({
      courses: schedule.courses
        .map(({ updatedAt: _, ...course }) => course)
        .sort((a, b) => a.id.localeCompare(b.id)),
      events: schedule.events
        .map(({ updatedAt: _, ...event }) => event)
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  return content(result) === content(local) ? local : result;
}
