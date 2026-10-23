import { startTaskTimer } from '../src/model.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { type AppState, uid, selectTasks, dateKey } from '../src/model.js';
import {
  scheduleSchema,
  coursePeriodsSchema,
  courseSchema,
  occurrenceSchema,
  courseOccurrences,
  nextClasses,
  mergeSchedule,
} from '../src/schedule.js';
import { importCourses } from '../src/course-import.js';
import { handleApi } from '../src/timelog/api.js';
import {
  startTimer,
  finishTimer,
  liveSpans,
  duration,
  activeActivity,
} from '../src/timelog/domain.js';
import { toDocument } from '../src/sync/document.js';
import type { StateService, StateSnapshot } from './state-service.js';

type Context = {
  route: string;
  method: string;
  url: URL;
  request: IncomingMessage;
  response: ServerResponse;
  service: StateService;
  snapshot: StateSnapshot;
  mutate: (fn: (s: AppState) => AppState) => Promise<StateSnapshot>;
  send: (data: unknown, snapshot: StateSnapshot) => void;
  readBody: (r: IncomingMessage, limit?: number) => Promise<unknown>;
};
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
function activityId(state: AppState, requested?: string) {
  const activity = state.timelog.activities.find(
    (item) => activeActivity(item) && (requested === undefined || item.id === requested),
  );
  if (!activity) return fail(400, '请选择可用的活动');
  return activity.id;
}
export function decisionContext(state: AppState, now = Date.now()) {
  return {
    now: new Date(now).toISOString(),
    epochMs: now,
    timeZone: state.settings.timeZone,
    courseTimeZone: state.schedule.timeZone,
    today: dateKey(new Date(now)),
    tasks: selectTasks(state, 'today'),
    timeTimer: state.timelog.timer,
    simultaneousTimers: state.timelog.conflictedTimers ?? [],
    timeElapsedMs: state.timelog.timer ? duration(liveSpans(state.timelog.timer, now)) : 0,
    ...nextClasses(state.schedule, now),
    classes: courseOccurrences(state.schedule, now, now + 7 * 86400000).slice(0, 150),
  };
}
export async function handleExtendedRoute(c: Context): Promise<boolean> {
  let { route, method, snapshot } = c;
  const { send, mutate } = c;
  if (route === '/context' && method === 'GET') {
    send(decisionContext(snapshot.state), snapshot);
    return true;
  }
  const unifiedRecords = (state: AppState) =>
    Object.entries(toDocument(state))
      .filter(([key]) => key.startsWith('records/'))
      .map(([, row]) => {
        const { timing, ...rest } = row;
        const t = timing as {
          startAt: number;
          endAt: number | null;
          plannedEndAt?: number | null;
          runningSince: number | null;
          spans: { start: number; end: number }[];
        };
        return {
          ...rest,
          id: row.id as string,
          ...t,
          plannedEndAt: t.plannedEndAt ?? null,
          elapsedMs:
            duration(t.spans) +
            (t.runningSince === null
              ? 0
              : Math.max(0, Math.min(Date.now(), t.plannedEndAt ?? Infinity) - t.runningSince)),
        };
      });
  if (route === '/time-records' && method === 'GET') {
    send(
      unifiedRecords(snapshot.state)
        .sort((a, b) => b.startAt - a.startAt)
        .slice(0, 1000),
      snapshot,
    );
    return true;
  }
  if (route === '/time-records' && method === 'POST') {
    const input = z
      .object({
        startAt: z.number().finite().min(946684800000),
        endAt: z.number().finite().nullable().optional(),
        activityId: z.string().min(1).max(100).optional(),
        taskId: z.string().min(1).max(100).optional(),
        note: z.string().max(4000).default(''),
        tags: z.array(z.string().max(40)).max(16).default([]),
      })
      .strict()
      .parse(await c.readBody(c.request));
    const now = Date.now();
    if (input.startAt > now || (input.endAt != null && input.endAt - input.startAt < 1000))
      fail(400, '记录时间范围无效');
    const open = input.endAt == null || input.endAt > now;
    let createdId = '';
    snapshot = await mutate((s) => {
      if (open && (s.timelog.timer || s.timelog.conflictedTimers?.length))
        fail(409, '请先结束已有计时');
      const work = startTimer(
        { ...s.timelog, timer: null, conflictedTimers: [] },
        activityId(s, input.activityId),
        input.note,
        input.startAt,
        {
          ...(open && input.endAt != null ? { plannedEndAt: input.endAt } : {}),
          tags: input.tags,
          ...(input.taskId ? { taskId: input.taskId } : {}),
        },
      );
      createdId = work.timer!.id;
      const result = open ? work : finishTimer(work, input.endAt!);
      if (!open) {
        result.timer = s.timelog.timer;
        result.conflictedTimers = s.timelog.conflictedTimers;
      }
      return { ...s, timelog: result };
    });
    send(
      unifiedRecords(snapshot.state).find((r) => r.id === createdId),
      snapshot,
    );
    return true;
  }
  const stopRecord = route.match(/^\/time-records\/([^/]+)\/stop$/);
  if (stopRecord && method === 'POST') {
    const id = decodeURIComponent(stopRecord[1]);
    const input = z
      .object({ endAt: z.number().finite().optional() })
      .strict()
      .parse(await c.readBody(c.request));
    if (input.endAt !== undefined && input.endAt > Date.now())
      fail(400, '结束时间不能晚于当前时间');
    snapshot = await mutate((s) => {
      const target =
        s.timelog.timer?.id === id
          ? s.timelog.timer
          : s.timelog.conflictedTimers?.find((t) => t.id === id);
      if (!target) fail(409, '计时已经结束或不存在');
      const ended = finishTimer(
        { ...s.timelog, timer: target!, conflictedTimers: [] },
        input.endAt ?? Date.now(),
      );
      return {
        ...s,
        timelog: {
          ...s.timelog,
          timer: s.timelog.timer?.id === id ? null : s.timelog.timer,
          records: ended.records,
          conflictedTimers: s.timelog.conflictedTimers?.filter((t) => t.id !== id),
        },
      };
    });
    send(
      unifiedRecords(snapshot.state).find((r) => r.id === id),
      snapshot,
    );
    return true;
  }
  if (route.startsWith('/timelog/')) {
    const result = await handleApi(
      {
        method,
        path: '/v1/' + route.slice(9) + c.url.search,
        body: ['POST', 'PATCH', 'DELETE'].includes(method)
          ? await c.readBody(c.request, 10 * 1024 * 1024)
          : undefined,
      },
      {
        readState: async () => (await c.service.snapshot()).state.timelog,
        mutateState: async (fn) => {
          snapshot = await mutate((s) => ({ ...s, timelog: fn(s.timelog) }));
          return snapshot.state.timelog;
        },
      },
    );
    c.response.statusCode = result.status;
    send(result.body, snapshot);
    return true;
  }
  const tracking = route.match(/^\/tasks\/([^/]+)\/track$/);
  if (tracking && method === 'POST') {
    const input = z
      .object({ activityId: z.string().optional() })
      .strict()
      .parse(await c.readBody(c.request));
    const id = decodeURIComponent(tracking[1]);
    snapshot = await mutate((state) => startTaskTimer(state, id, Date.now(), input.activityId));
    send(snapshot.state.timelog.timer, snapshot);
    return true;
  }
  if (route === '/schedule' && method === 'GET') {
    send(snapshot.state.schedule, snapshot);
    return true;
  }
  if (route === '/schedule' && method === 'PATCH') {
    const input = z
      .object(scheduleSchema.shape)
      .pick({
        semesterStart: true,
        totalWeeks: true,
        timeZone: true,
        holidays: true,
        periods: true,
      })
      .partial()
      .extend({ periods: coursePeriodsSchema.optional() })
      .strict()
      .parse(await c.readBody(c.request));
    snapshot = await mutate((s) => ({
      ...s,
      schedule: scheduleSchema.parse({ ...s.schedule, ...input }),
    }));
    send(snapshot.state.schedule, snapshot);
    return true;
  }
  if (route === '/schedule/next' && method === 'GET') {
    send(nextClasses(snapshot.state.schedule), snapshot);
    return true;
  }
  if (route === '/schedule/occurrences' && method === 'GET') {
    const from = z.coerce
      .number()
      .finite()
      .nonnegative()
      .parse(c.url.searchParams.get('from') ?? Date.now());
    const until = z.coerce
      .number()
      .finite()
      .parse(c.url.searchParams.get('until') ?? from + 7 * 86400000);
    if (until <= from || until - from > 400 * 86400000) fail(400, '查询范围须在 1 到 400 天内');
    send(courseOccurrences(snapshot.state.schedule, from, until), snapshot);
    return true;
  }
  if (route === '/schedule/import' && method === 'POST') {
    const input = z
      .object({
        content: z.string().max(10 * 1024 * 1024),
        name: z.string().max(300),
        preview: z.boolean().default(true),
      })
      .strict()
      .parse(await c.readBody(c.request, 12 * 1024 * 1024));
    const preview = (() => {
      try {
        return importCourses(input.content, input.name, snapshot.state.schedule);
      } catch (error) {
        return fail(400, error instanceof Error ? error.message : String(error));
      }
    })();
    if (input.preview) {
      send(preview, snapshot);
      return true;
    }
    snapshot = await mutate((s) => ({
      ...s,
      schedule: mergeSchedule(s.schedule, preview.schedule),
    }));
    send({ summary: preview.summary, schedule: snapshot.state.schedule }, snapshot);
    return true;
  }
  if (route === '/schedule/courses' && method === 'POST') {
    const input = z
      .object(courseSchema.shape)
      .omit({ id: true, updatedAt: true })
      .parse(await c.readBody(c.request));
    const course = courseSchema.parse({ ...input, id: uid(), updatedAt: Date.now() });
    snapshot = await mutate((s) => ({
      ...s,
      schedule: scheduleSchema.parse({ ...s.schedule, courses: [...s.schedule.courses, course] }),
    }));
    send(course, snapshot);
    return true;
  }
  if (route === '/schedule/events' && method === 'GET') {
    send(snapshot.state.schedule.events, snapshot);
    return true;
  }
  if (route === '/schedule/events' && method === 'POST') {
    const input = z
      .object(occurrenceSchema.shape)
      .omit({ id: true, updatedAt: true })
      .parse(await c.readBody(c.request));
    const event = occurrenceSchema.parse({ ...input, id: uid(), updatedAt: Date.now() });
    snapshot = await mutate((s) => ({
      ...s,
      schedule: { ...s.schedule, events: [...s.schedule.events, event] },
    }));
    send(event, snapshot);
    return true;
  }
  const eventMatch = route.match(/^\/schedule\/events\/([^/]+)$/);
  if (eventMatch && ['PATCH', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(eventMatch[1]);
    const input =
      method === 'PATCH'
        ? z
            .object(occurrenceSchema.shape)
            .omit({ id: true, updatedAt: true })
            .partial()
            .parse(await c.readBody(c.request))
        : null;
    snapshot = await mutate((s) => {
      if (!s.schedule.events.some((e) => e.id === id)) fail(404, '课程实例不存在');
      return {
        ...s,
        schedule: scheduleSchema.parse({
          ...s.schedule,
          events: input
            ? s.schedule.events.map((e) =>
                e.id === id
                  ? { ...e, ...input, updatedAt: Math.max(e.updatedAt + 1, Date.now()) }
                  : e,
              )
            : s.schedule.events.filter((e) => e.id !== id),
        }),
      };
    });
    send(snapshot.state.schedule, snapshot);
    return true;
  }
  const match = route.match(/^\/schedule\/courses\/([^/]+)$/);
  if (match && ['PATCH', 'DELETE'].includes(method)) {
    const id = decodeURIComponent(match[1]);
    const patch =
      method === 'PATCH'
        ? z
            .object(courseSchema.shape)
            .omit({ id: true, updatedAt: true })
            .partial()
            .parse(await c.readBody(c.request))
        : null;
    snapshot = await mutate((s) => {
      const old = s.schedule.courses.find((x) => x.id === id);
      if (!old) fail(404, '课程不存在');
      return {
        ...s,
        schedule: scheduleSchema.parse({
          ...s.schedule,
          courses: patch
            ? s.schedule.courses.map((x) =>
                x.id === id
                  ? { ...x, ...patch, updatedAt: Math.max(Date.now(), x.updatedAt + 1) }
                  : x,
              )
            : s.schedule.courses.filter((x) => x.id !== id),
        }),
      };
    });
    send(snapshot.state.schedule, snapshot);
    return true;
  }
  return false;
}
