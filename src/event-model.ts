import { z } from 'zod';
import { calendarDateSchema, zoneSchema } from './schedule.js';
import { validateRrule } from './recurrence.js';

export const eventTypes = {
  course: '课程',
  exam: '考试',
  presentation: '演讲',
  meeting: '会议',
  other: '其他',
} as const;
export const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const eventPeriodsSchema = z
  .array(z.tuple([clockSchema, clockSchema]))
  .max(30)
  .superRefine((periods, ctx) => {
    periods.forEach(([start, end], index) => {
      if (index > 0 && start < periods[index - 1][1])
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: '时间段须按开始时间排序，结束晚于开始且互不重叠',
        });
    });
  });
export const eventTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    type: z.enum(['course', 'exam', 'presentation', 'meeting', 'other']),
    notes: z.string().max(50000).default(''),
    location: z.string().max(500).default(''),
    teacher: z.string().max(300).default(''),
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default('#4264b2'),
    allDay: z.boolean(),
    periods: eventPeriodsSchema,
    precision: z
      .object({
        start: z.number().int().min(0).max(59999),
        end: z.number().int().min(0).max(59999),
      })
      .strict()
      .optional(),
    /** Exclusive civil end date is represented as a day count for reusable templates. */
    durationDays: z.number().int().min(1).max(366).default(1),
    timeZone: zoneSchema,
  })
  .strict()
  .refine(
    (row) => (row.allDay ? row.periods.length === 0 : row.periods.length > 0),
    '全天日程不填写时间段，定时日程至少填写一个时间段',
  )
  .refine(
    (row) =>
      row.allDay ||
      (row.durationDays > 1 && row.periods.length === 1) ||
      row.periods.every(
        ([start, end]) =>
          end > start ||
          (row.periods.length === 1 &&
            end === start &&
            (row.precision?.end ?? 0) > (row.precision?.start ?? 0)),
      ),
    '结束时间必须晚于开始时间，跨日日程使用单个时间段',
  );
export const calendarEventSchema = eventTemplateSchema.safeExtend({
  id: z.string().min(1).max(100),
  date: calendarDateSchema,
  /** The original occurrence stays unchanged when an instance moves. */
  recurrenceId: z.string().max(150).nullable().default(null),
  source: z
    .object({
      kind: z.enum(['legacy-course', 'legacy-event', 'calendar']),
      id: z.string().max(500),
      uid: z.string().max(2000),
      fingerprint: z.string().max(100000),
      revision: z.string().max(100000).optional(),
      cancelled: z.boolean().optional(),
    })
    .strict()
    .nullable()
    .default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type EventTemplate = z.infer<typeof eventTemplateSchema>;

const recurrenceTime = z
  .string()
  .max(30)
  .refine((value) => {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:T([0-2]\d:[0-5]\d)(?::00)?)?$/);
    return (
      !!match &&
      calendarDateSchema.safeParse(match[1]).success &&
      (!match[2] || clockSchema.safeParse(match[2]).success)
    );
  }, '重复日期使用 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm');
export const recurrenceDefinitionSchema = z
  .object({
    dtstart: recurrenceTime,
    rrule: z
      .string()
      .max(2000)
      .refine((value) => {
        try {
          validateRrule(value);
          return true;
        } catch {
          return false;
        }
      }, 'RRULE 无效')
      .nullable()
      .default(null),
    rdate: z.array(recurrenceTime).max(20000).default([]),
    exdate: z.array(recurrenceTime).max(20000).default([]),
    timeZone: zoneSchema,
    /** Different weekly meeting times share their series prefix and retain their own template. */
    eventTemplate: eventTemplateSchema.optional(),
  })
  .strict()
  .refine(
    (row) =>
      [...row.rdate, ...row.exdate].every(
        (value) => value.includes('T') === row.dtstart.includes('T'),
      ),
    '额外日期、排除日期的日期类型须与首次发生一致',
  );
export type RecurrenceDefinition = z.infer<typeof recurrenceDefinitionSchema>;

export const calendarSubscriptionSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    provider: z.enum(['google', 'microsoft', 'apple', 'ics']),
    url: z
      .string()
      .max(8000)
      .refine((value) => {
        try {
          const url = new URL(value.replace(/^webcal:/i, 'https:'));
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, '请填写 HTTPS 或 webcal 日历订阅地址'),
    timeZone: zoneSchema,
    enabled: z.boolean(),
    updatedAt: z.string().datetime(),
    checkedAt: z.number().nonnegative().default(0),
    error: z.string().max(1000).default(''),
  })
  .strict();
export type CalendarSubscription = z.infer<typeof calendarSubscriptionSchema>;
