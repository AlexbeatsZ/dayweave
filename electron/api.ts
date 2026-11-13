import { handleExtendedRoute } from './extended-api.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { writeAtomic } from './files.js';
import path from 'node:path';
import { z } from 'zod';
import {
  newTask,
  taskCompleted,
  now,
  uid,
  toggleTask,
  mergeImport,
  selectTasks,
  statistics,
  dayPlanGroups,
  dateKey,
  deletePlanGroup,
  newPlanGroup,
  changeSubtask,
  subtaskSchema,
  dateSchema,
  taskPrefix,
  type AppState,
  type Task,
  type View,
} from '../src/model.js';
import {
  repeatInputSchema,
  subtaskInputSchema,
  taskInputSchema,
  taskPatchSchema,
  listInputSchema,
  planGroupInputSchema,
  planGroupPatchSchema,
  settingsPatchSchema,
  openapi,
} from '../src/api-contract.js';
import { configureRepeat } from '../src/task-repeat.js';
import { StateConflict } from '../src/state-delta.js';
import { activeActivity } from '../src/timelog/domain.js';
import { TimeOverlap } from '../src/timelog/occupancy.js';
import { StateService, type StateSnapshot } from './state-service.js';
import type { SyncBridge } from '../src/sync/types.js';
import type { DesktopUsage } from './usage.js';
import { appVersion } from './version.js';

type ApiInfo = { enabled: boolean; url: string; token: string };
export type ApiOptions = {
  health?: Record<string, unknown>;
  strictPort?: boolean;
  management?: {
    usage: DesktopUsage;
    closing(): boolean;
    shutdown(): void;
  };
};
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
/** A task may name only a live section of its own day. */
function planGroupFits(state: AppState, task: Task) {
  for (const [date, id] of Object.entries(task.dates)) {
    if (!id) continue;
    if (!state.planGroups.some((row) => row.id === id && row.date === date && !row.deletedAt))
      fail(400, 'Plan group must be live and belong to this business date');
  }
}
function taskAt(state: AppState, id: string) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) fail(404, 'Task not found');
  return task;
}
async function body(request: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  if (
    !(request.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
      .includes('application/json')
  )
    fail(415, 'Use Content-Type: application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) fail(413, 'Request body is too large');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return fail(400, 'Invalid JSON body');
  }
}

export async function startApi(
  service: StateService,
  requestedPort = 49731,
  getSync?: () => SyncBridge | undefined,
  options: ApiOptions = {},
) {
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)
    throw new Error('Invalid API port');
  await service.snapshot();
  const credentialFile = path.join(service.storage.directory, 'api.json');
  let token: string;
  try {
    const existing = JSON.parse(await readFile(credentialFile, 'utf8'));
    token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(existing.token);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'API credential file is invalid; preserve and repair api.json before enabling API',
      );
    token = randomBytes(32).toString('hex');
  }
  const authenticated = (request: IncomingMessage) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (data: unknown, snapshot: StateSnapshot) => {
      response.setHeader('ETag', `"${snapshot.revision}"`);
      response.end(JSON.stringify({ data, revision: snapshot.revision }));
    };
    try {
      if (
        request.headers.origin !== undefined ||
        !/^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host ?? '')
      )
        fail(403, 'Only local non-browser API clients are allowed');
      if (!authenticated(request)) fail(401, 'A valid Bearer token is required');
      if (options.management?.closing()) fail(503, 'Server is shutting down');
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/v1/')) fail(404, 'Route not found');
      const route = url.pathname.slice(7).replace(/\/$/, '');
      const method = request.method ?? 'GET';
      const expected = request.headers['if-match']?.toString().replace(/^"|"$/g, '');
      const mutate = (fn: (state: AppState) => AppState) => service.mutate(fn, expected);
      let snapshot = await service.snapshot();
      const health = {
        app: 'Dayweave',
        version: appVersion(),
        storage: 'ready',
        ...options.health,
        capabilities: {
          taskRecordLinks: true,
          timeOverlapProtection: true,
          calendarEvents: true,
          rrule: true,
          eventCalendarFeed: true,
          syncProtocol: 3,
        },
      };
      if (options.management) {
        if (route === '/server/status' && method === 'GET')
          return send(
            {
              ...health,
              pid: process.pid,
              uptimeSeconds: process.uptime(),
              profile: service.storage.directory,
              recovered: snapshot.recovered,
              tasks: snapshot.state.tasks.length,
              records: snapshot.state.timelog.records.length,
              sync: await getSync?.()?.status(),
              usage: await options.management.usage.health(),
            },
            snapshot,
          );
        if (route === '/usage/status' && method === 'GET')
          return send(await options.management.usage.health(), snapshot);
        if (route === '/server/shutdown' && method === 'POST') {
          response.once('finish', () => setImmediate(() => options.management!.shutdown()));
          return send({ accepted: true }, snapshot);
        }
      }
      if (route.startsWith('/sync/')) {
        const sync = getSync?.();
        if (!sync) fail(503, 'Sync unavailable');
        if (route === '/sync/status' && method === 'GET')
          return send(await sync!.status(), snapshot);
        if (route === '/sync/invite' && method === 'POST' && sync!.invite)
          return send({ invitation: await sync!.invite() }, snapshot);
        if (route === '/sync/hub' && method === 'POST' && sync!.enableHub)
          return send(await sync!.enableHub(), snapshot);
        if (route === '/sync/now' && method === 'POST')
          return send(await sync!.now(), await service.snapshot());
        if (route.startsWith('/sync/peers/') && method === 'DELETE' && sync!.revoke) {
          const id = decodeURIComponent(route.slice('/sync/peers/'.length));
          if (!/^[\w-]{1,100}$/.test(id)) fail(400, 'Invalid device ID');
          return send(await sync!.revoke(id), snapshot);
        }
      }
      if (
        await handleExtendedRoute({
          route,
          method,
          url,
          request,
          response,
          service,
          snapshot,
          mutate,
          send,
          readBody: body,
        })
      )
        return;
      if (route === '/health' && method === 'GET') return send(health, snapshot);
      if (route === '/openapi.json' && method === 'GET') {
        response.end(JSON.stringify(openapi));
        return;
      }
      if (route === '/export' && method === 'GET') return send(snapshot.state, snapshot);
      if (route === '/import' && method === 'POST') {
        const incoming = await body(request, 50 * 1024 * 1024);
        snapshot = await mutate((s) => mergeImport(s, incoming, { preserveBehaviorReviews: true }));
        return send(
          { tasks: snapshot.state.tasks.length, lists: snapshot.state.lists.length },
          snapshot,
        );
      }
      if (route === '/tasks' && method === 'GET') {
        const view = url.searchParams.get('view') ?? 'all';
        if (
          !['all', 'today', 'upcoming', 'inbox', 'completed', 'trash'].includes(view) &&
          !/^(list|tag):.+$/.test(view)
        )
          fail(400, 'Invalid task view');
        const limit = z.coerce
            .number()
            .int()
            .min(1)
            .max(500)
            .parse(url.searchParams.get('limit') ?? 100),
          offset = z.coerce
            .number()
            .int()
            .min(0)
            .parse(url.searchParams.get('offset') ?? 0);
        const tasks = selectTasks(
          snapshot.state,
          view as View,
          url.searchParams.get('q') ?? '',
          'date',
          ['today', 'upcoming'].includes(view)
            ? dateSchema.parse(url.searchParams.get('date') ?? dateKey())
            : dateKey(),
        );
        return send(
          { items: tasks.slice(offset, offset + limit), total: tasks.length, offset, limit },
          snapshot,
        );
      }
      if (route === '/tasks' && method === 'POST') {
        const input = taskInputSchema.parse(await body(request));
        let id = '';
        snapshot = await mutate((s) => {
          if (
            input.id !== undefined &&
            [...s.tasks, ...s.calendarEvents].some((task) => task.id === input.id)
          )
            fail(409, 'Task ID already exists; read the existing task before deciding');
          const task = newTask(input.title, input);
          planGroupFits(s, task);
          id = task.id;
          return { ...s, tasks: [...s.tasks, task] };
        });
        return send(taskAt(snapshot.state, id), snapshot);
      }
      if (route === '/repeat-rules' && method === 'GET')
        return send(snapshot.state.repeatRules, snapshot);
      if (route === '/repeat-rules/generate' && method === 'POST') {
        const input = z
          .object({ through: dateSchema })
          .strict()
          .parse(await body(request));
        const sync = getSync?.();
        if (!sync?.ensureTasks) fail(503, '同步中心尚未连接');
        const status = await sync!.ensureTasks!(input.through);
        if (!status.connected) fail(503, status.error || '同步中心尚未连接');
        return send(status, await service.snapshot());
      }
      const repeatMatch = route.match(/^\/tasks\/([^/]+)\/repeat$/);
      if (repeatMatch && ['PUT', 'DELETE'].includes(method)) {
        const id = decodeURIComponent(repeatMatch[1]);
        const input = method === 'PUT' ? repeatInputSchema.parse(await body(request)) : null;
        const sync = await getSync?.()?.status();
        if (!sync?.connected) fail(503, '重复任务需要连接同步中心');
        snapshot = await mutate((state) => {
          const task = taskAt(state, id);
          if (task.deletedAt) fail(409, 'Restore task before editing');
          return configureRepeat(state, task, input?.cron ?? null, input?.dateOffsets);
        });
        return send(
          snapshot.state.repeatRules.find((row) => row.prefix === taskPrefix(id)) ?? null,
          snapshot,
        );
      }
      const subMatch = route.match(/^\/tasks\/([^/]+)\/subtasks(?:\/([^/]+))?$/);
      if (subMatch && ['POST', 'PATCH', 'DELETE'].includes(method)) {
        const id = decodeURIComponent(subMatch[1]),
          subId = subMatch[2] && decodeURIComponent(subMatch[2]);
        if ((method === 'POST') === !!subId) fail(405, 'Invalid subtask action');
        const input =
          method === 'DELETE'
            ? null
            : (method === 'POST'
                ? subtaskInputSchema
                : subtaskInputSchema.omit({ id: true })
              ).parse(await body(request));
        snapshot = await mutate((state) => {
          const task = taskAt(state, id),
            at = now();
          if (task.deletedAt) fail(409, 'Restore task before editing');
          let next: Task;
          if (method === 'POST') {
            if (!input?.title) fail(400, 'Subtask title required');
            const row = subtaskSchema.parse({
              id: (input as { id?: string }).id ?? uid(),
              title: input!.title,
              done: input!.done ?? false,
            });
            if (task.subtasks.some((old) => old.id === row.id))
              fail(409, 'Subtask ID already exists');
            next = { ...task, subtasks: [...task.subtasks, row], updatedAt: at };
          } else {
            if (!task.subtasks.some((row) => row.id === subId && !row.deletedAt))
              fail(404, 'Subtask not found');
            next = changeSubtask(task, subId!, input ?? { deletedAt: at }, at);
          }
          return { ...state, tasks: state.tasks.map((row) => (row.id === id ? next : row)) };
        });
        return send(taskAt(snapshot.state, id), snapshot);
      }
      const taskMatch = route.match(/^\/tasks\/([^/]+)(?:\/(complete|reopen|restore))?$/);
      if (taskMatch) {
        const id = decodeURIComponent(taskMatch[1]),
          action = taskMatch[2];
        if (method === 'GET' && !action) return send(taskAt(snapshot.state, id), snapshot);
        if (method === 'PATCH' && !action) {
          const input = taskPatchSchema.parse(await body(request));
          snapshot = await mutate((s) => {
            const task = taskAt(s, id);
            if (task.deletedAt) fail(409, 'Restore task before editing');
            const { subtasks, ...fields } = input;
            const next: Task = {
              ...task,
              ...fields,
              subtasks: subtasks
                ? subtasks.map((row) =>
                    subtaskSchema.parse({
                      ...task.subtasks.find((old) => old.id === row.id),
                      ...row,
                    }),
                  )
                : task.subtasks,
              updatedAt: now(),
            };
            planGroupFits(s, next);
            return { ...s, tasks: s.tasks.map((t) => (t.id === id ? next : t)) };
          });
          return send(taskAt(snapshot.state, id), snapshot);
        }
        if ((method === 'DELETE' && !action) || (method === 'POST' && action)) {
          snapshot = await mutate((s) => {
            const task = taskAt(s, id);
            if (method === 'DELETE')
              return task.deletedAt
                ? s
                : {
                    ...s,
                    tasks: s.tasks.map((t) =>
                      t.id === id ? { ...t, deletedAt: now(), updatedAt: now() } : t,
                    ),
                  };
            if (action === 'restore')
              return {
                ...s,
                tasks: s.tasks.map((t) =>
                  t.id === id ? { ...t, deletedAt: null, updatedAt: now() } : t,
                ),
              };
            if (task.deletedAt) fail(409, 'Restore task before changing completion');
            return (action === 'complete' && !taskCompleted(task)) ||
              (action === 'reopen' && taskCompleted(task))
              ? toggleTask(s, id)
              : s;
          });
          return send(taskAt(snapshot.state, id), snapshot);
        }
      }
      if (route === '/plan-groups' && method === 'GET') {
        const date = url.searchParams.get('date') ?? dateKey();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'date must be YYYY-MM-DD');
        return send(dayPlanGroups(snapshot.state, date), snapshot);
      }
      if (route === '/plan-groups' && method === 'POST') {
        const input = planGroupInputSchema.parse(await body(request));
        const group = newPlanGroup(input.date, input);
        snapshot = await mutate((s) => ({ ...s, planGroups: [...s.planGroups, group] }));
        return send(group, snapshot);
      }
      const groupMatch = route.match(/^\/plan-groups\/([^/]+)$/);
      if (groupMatch && ['PATCH', 'DELETE'].includes(method)) {
        const id = decodeURIComponent(groupMatch[1]);
        const input = method === 'PATCH' ? planGroupPatchSchema.parse(await body(request)) : null;
        snapshot = await mutate((s) => {
          if (!s.planGroups.some((g) => g.id === id && !g.deletedAt))
            fail(404, 'Plan group not found');
          if (!input) return deletePlanGroup(s, id);
          return {
            ...s,
            planGroups: s.planGroups.map((g) =>
              g.id === id ? { ...g, ...input, updatedAt: now() } : g,
            ),
          };
        });
        return send(
          input ? snapshot.state.planGroups.find((g) => g.id === id) : { deleted: id },
          snapshot,
        );
      }
      if (route === '/lists' && method === 'GET') return send(snapshot.state.lists, snapshot);
      if (route === '/lists' && method === 'POST') {
        const input = listInputSchema.parse(await body(request));
        const list = { id: uid(), color: '#326559', order: Date.now(), ...input };
        snapshot = await mutate((s) => {
          if (
            list.activityId &&
            !s.timelog.activities.some((row) => row.id === list.activityId && activeActivity(row))
          )
            fail(400, 'Choose an available activity');
          return { ...s, lists: [...s.lists, list] };
        });
        return send(list, snapshot);
      }
      const listMatch = route.match(/^\/lists\/([^/]+)$/);
      if (listMatch && ['PATCH', 'DELETE'].includes(method)) {
        const id = decodeURIComponent(listMatch[1]);
        const input =
          method === 'PATCH' ? listInputSchema.partial().parse(await body(request)) : null;
        snapshot = await mutate((s) => {
          if (!s.lists.some((l) => l.id === id)) fail(404, 'List not found');
          if (method === 'PATCH') {
            if (
              input?.activityId &&
              !s.timelog.activities.some(
                (row) => row.id === input.activityId && activeActivity(row),
              )
            )
              fail(400, 'Choose an available activity');
            return { ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, ...input } : l)) };
          }
          if (id === 'inbox') fail(409, 'The default list cannot be deleted');
          return {
            ...s,
            lists: s.lists.filter((l) => l.id !== id),
            tasks: s.tasks.map((t) =>
              t.listId === id ? { ...t, listId: 'inbox', updatedAt: now() } : t,
            ),
          };
        });
        return send(
          method === 'DELETE' ? { deleted: id } : snapshot.state.lists.find((l) => l.id === id),
          snapshot,
        );
      }
      if (route === '/settings' && method === 'GET') return send(snapshot.state.settings, snapshot);
      if (route === '/settings' && method === 'PATCH') {
        const input = settingsPatchSchema.parse(await body(request));
        snapshot = await mutate((s) => ({ ...s, settings: { ...s.settings, ...input } }));
        return send(snapshot.state.settings, snapshot);
      }
      if (route === '/stats' && method === 'GET')
        return send(
          {
            days: statistics(snapshot.state),
            activeTasks: snapshot.state.tasks.filter((t) => !t.deletedAt && !taskCompleted(t))
              .length,
            completedTasks: snapshot.state.tasks.filter((t) => !t.deletedAt && taskCompleted(t))
              .length,
            focusMinutes: snapshot.state.sessions.reduce((n, s) => n + s.minutes, 0),
          },
          snapshot,
        );
      fail(404, 'Route not found');
    } catch (error) {
      const status =
        error instanceof z.ZodError || error instanceof URIError
          ? 400
          : error instanceof StateConflict
            ? 409
            : ((error as { status?: number }).status ?? 500);
      response.statusCode = status;
      response.end(
        JSON.stringify({
          error: {
            code: status,
            ...(error instanceof TimeOverlap
              ? { reason: error.reason, details: error.detail }
              : {}),
            message:
              error instanceof z.ZodError
                ? 'Invalid input or data references'
                : status >= 500
                  ? 'Operation could not be saved; inspect the application storage status'
                  : (error as Error).message,
          },
        }),
      );
    }
  }
  async function listen(port: number) {
    await new Promise<void>((resolve, reject) => {
      const failure = (error: Error) => {
        server.off('listening', ready);
        reject(error);
      };
      const ready = () => {
        server.off('error', failure);
        resolve();
      };
      server.once('error', failure);
      server.once('listening', ready);
      server.listen(port, '127.0.0.1');
    });
  }
  try {
    await listen(requestedPort);
  } catch (error) {
    if (
      options.strictPort ||
      (error as NodeJS.ErrnoException).code !== 'EADDRINUSE' ||
      requestedPort === 0
    )
      throw error;
    await listen(0);
  }
  const port = (server.address() as { port: number }).port;
  const info: ApiInfo = { enabled: true, url: `http://127.0.0.1:${port}/api/v1`, token };
  try {
    await writeAtomic(credentialFile, JSON.stringify({ ...info, pid: process.pid }, null, 2));
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return {
    info,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
