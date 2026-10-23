import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { importFudan } from './files';
import {
  courseSchema,
  scheduleSchema,
  type Course,
  type Occurrence,
  type Schedule,
} from './schedule';
import { shiftDay, weekday, wallTime } from './timezone';
import type { ImportPreview } from './course-import';

const semesterSchema = z.object({
  id: z.union([z.string().max(100), z.number().finite()]),
  startDate: z.string().min(10).max(40),
  endDate: z.string().min(10).max(40),
  weekStartOnSunday: z.boolean().nullish(),
});
const activitySchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  lessonId: z.union([z.string(), z.number()]).nullish(),
  courseId: z.union([z.string(), z.number()]).nullish(),
  courseName: z.string().trim().min(1).max(300),
  weekday: z.coerce.number().int().min(1).max(7),
  startTime: z.union([z.string(), z.number()]),
  endTime: z.union([z.string(), z.number()]),
  room: z.string().max(500).nullable().optional(),
  weekIndexes: z.array(z.coerce.number().int().min(1).max(60)).min(1).max(60),
  teacherName: z.string().max(300).nullable().optional(),
  teacher: z
    .union([z.string().max(300), z.array(z.string().max(300)).max(20)])
    .nullable()
    .optional(),
  teacherNames: z
    .union([z.string().max(300), z.array(z.string().max(300)).max(20)])
    .nullable()
    .optional(),
});
const captureSchema = z.object({
  semester: semesterSchema,
  activities: z.array(activitySchema).max(2000),
});
const colors = ['#76b9ed', '#6eb7ad', '#b69cda', '#d2ac73', '#b98f9c'];
function hash(text: string) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
}
function clock(value: string | number) {
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::00)?$/) ?? text.match(/^(\d{1,2})(\d{2})$/);
  if (!match || +match[1] > 23 || +match[2] > 59)
    throw new Error('复旦课表时间无法识别，请重新读取或使用文件导入。 [FUDAN_TIME]');
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}
function date(value: string) {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error('复旦课表未提供有效学期日期，请重新进入个人课表后读取');
  try {
    const day = Temporal.PlainDate.from(match[0]);
    if (day.year < 2000 || day.year > 2200) throw new Error();
    return day;
  } catch {
    throw new Error('复旦课表学期日期无效，请重新选择学期。 [FUDAN_SEMESTER_DATA]');
  }
}

/** Only a course-shaped, minimal capture enters the normal preview/merge path. */
export function parseFudanCourses(
  content: string,
  base: Schedule,
  at = Date.now(),
  allowEmpty = false,
): ImportPreview {
  if (new TextEncoder().encode(content).length > 10 * 1024 * 1024)
    throw new Error('复旦课表数据不能超过 10 MB');
  let capture: z.infer<typeof captureSchema>;
  try {
    capture = captureSchema.parse(JSON.parse(content));
  } catch {
    throw new Error('没有读到完整的复旦课表。请登录后打开个人课表、选好学期，再点读取课表。');
  }
  if (!allowEmpty && !capture.activities.length) throw new Error('所选学期没有可导入的课程。');
  const semesterId = String(capture.semester.id);
  if (!/^[0-9]{1,12}$/.test(semesterId))
    throw new Error('复旦课表学期标识无效，请重新选择学期。 [FUDAN_SEMESTER]');
  const first = date(capture.semester.startDate),
    last = date(capture.semester.endDate);
  if (Temporal.PlainDate.compare(last, first) < 0) throw new Error('复旦学期结束日期早于开始日期');
  // The school can number weeks from Sunday. Preserve those Sunday instants as
  // dated events instead of shifting them into the following Monday-based week.
  const sundayStart = !!capture.semester.weekStartOnSunday;
  const anchor = shiftDay(
    first.toString(),
    sundayStart ? -(weekday(first.toString()) % 7) : 1 - weekday(first.toString()),
  );
  const monday = sundayStart ? shiftDay(anchor, 1) : anchor;
  const metadataWeeks = Math.ceil((Temporal.PlainDate.from(anchor).until(last).days + 1) / 7);
  const totalWeeks = Math.max(
    metadataWeeks,
    ...capture.activities.map((activity) => Math.max(...activity.weekIndexes)),
  );
  if (totalWeeks < 1 || totalWeeks > 60) throw new Error('复旦学期范围超出支持的 1 至 60 周');
  const courses = new Map<string, Course>(),
    events = new Map<string, Occurrence>();
  const warnings: string[] = [];
  for (const activity of capture.activities) {
    const start = clock(activity.startTime),
      end = clock(activity.endTime);
    const teacher =
      activity.teacherName ||
      (activity.teacherNames?.length ? activity.teacherNames : activity.teacher) ||
      '';
    const teacherText = (Array.isArray(teacher) ? teacher.join('、') : teacher).trim();
    if (end <= start) throw new Error('复旦课表结束时间必须晚于开始时间。 [FUDAN_TIME]');
    if (teacherText.length > 300)
      throw new Error('复旦课表教师名称过长，请使用文件导入。 [FUDAN_FORMAT]');
    const identity = activity.lessonId ?? activity.courseId ?? activity.id ?? activity.courseName;
    const key = `fudan-${hash(JSON.stringify([Number(semesterId), identity, activity.courseName, activity.weekday, start, end, activity.room ?? '', teacherText]))}`;
    const previous = courses.get(key);
    const course = courseSchema.parse({
      id: key,
      name: activity.courseName,
      teacher: teacherText,
      location: activity.room ?? '',
      weekday: activity.weekday,
      start,
      end,
      weeks: [...new Set([...(previous?.weeks ?? []), ...activity.weekIndexes])].sort(
        (a, b) => a - b,
      ),
      color: colors[parseInt(hash(activity.courseName), 36) % colors.length],
      excludedDates: [],
      updatedAt: at,
    });
    if (sundayStart && activity.weekday === 7) {
      for (const week of course.weeks) {
        const day = shiftDay(anchor, (week - 1) * 7);
        const id = `${key}@${day}`;
        events.set(id, {
          id,
          courseId: key,
          name: course.name,
          teacher: course.teacher,
          location: course.location,
          color: course.color,
          start: wallTime(day, start, 'Asia/Shanghai'),
          end: wallTime(day, end, 'Asia/Shanghai'),
          timeZone: 'Asia/Shanghai',
          updatedAt: at,
        });
      }
    } else courses.set(key, course);
  }
  if (events.size)
    warnings.push('学校按周日起算的周日课程已保留为实际日期课程，避免移动到下一周。');
  const schedule = scheduleSchema.parse({
    ...base,
    semesterStart: monday,
    totalWeeks,
    timeZone: 'Asia/Shanghai',
    courses: [...courses.values()],
    events: [...events.values()],
    holidays: [],
  });
  return {
    source: { kind: 'fudan', semesterId },
    schedule,
    summary: `复旦课表 · ${schedule.courses.length} 条周课程${events.size ? `，${events.size} 节日期课程` : ''}`,
    warnings,
  };
}

export async function importFudanCourses(base: Schedule): Promise<ImportPreview | null> {
  const content = await importFudan();
  return content === null ? null : parseFudanCourses(content, base);
}
