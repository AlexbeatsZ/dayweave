import { handleExtendedRoute } from './extended-api.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  newTask,
  now,
  uid,
  toggleTask,
  mergeImport,
  finishTimer,
  remainingSeconds,
  selectTasks,
  statistics,
  type AppState,
  type View,
} from '../src/model.js';
import {
  taskInputSchema,
  taskPatchSchema,
  listInputSchema,
  settingsPatchSchema,
  focusInputSchema,
  openapi,
} from '../src/api-contract.js';
import { StateConflict } from '../src/state-delta.js';
import { StateService, type StateSnapshot } from './state-service.js';
import type { SyncBridge } from '../src/sync/types.js';

type ApiInfo = { enabled: boolean; url: string; token: string };
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
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
) {
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
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/api/v1/')) fail(404, 'Route not found');
      const route = url.pathname.slice(7).replace(/\/$/, '');
      const method = request.method ?? 'GET';
      const expected = request.headers['if-match']?.toString().replace(/^"|"$/g, '');
      const mutate = (fn: (state: AppState) => AppState) => service.mutate(fn, expected);
      let snapshot = await service.snapshot();
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
      if (route === '/health' && method === 'GET')
        return send({ app: 'Dayweave', version: '0.3.3', storage: 'ready' }, snapshot);
      if (route === '/openapi.json' && method === 'GET') {
        response.end(JSON.stringify(openapi));
        return;
      }
      if (route === '/export' && method === 'GET') return send(snapshot.state, snapshot);
      if (route === '/import' && method === 'POST') {
        const incoming = await body(request, 50 * 1024 * 1024);
        snapshot = await mutate((s) => mergeImport(s, incoming));
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
          const task = newTask(input.title, input);
          id = task.id;
          return { ...s, tasks: [...s.tasks, task] };
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
            return {
              ...s,
              tasks: s.tasks.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      ...input,
                      ...(input.due ? { repeatDay: Number(input.due.slice(-2)) } : {}),
                      updatedAt: now(),
                    }
                  : t,
              ),
            };
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
            return (action === 'complete' && !task.completedAt) ||
              (action === 'reopen' && task.completedAt)
              ? toggleTask(s, id)
              : s;
          });
          return send(taskAt(snapshot.state, id), snapshot);
        }
      }
      if (route === '/lists' && method === 'GET') return send(snapshot.state.lists, snapshot);
      if (route === '/lists' && method === 'POST') {
        const input = listInputSchema.parse(await body(request));
        const list = { id: uid(), color: '#326559', order: Date.now(), ...input };
        snapshot = await mutate((s) => ({ ...s, lists: [...s.lists, list] }));
        return send(list, snapshot);
      }
      const listMatch = route.match(/^\/lists\/([^/]+)$/);
      if (listMatch && ['PATCH', 'DELETE'].includes(method)) {
        const id = decodeURIComponent(listMatch[1]);
        const input =
          method === 'PATCH' ? listInputSchema.partial().parse(await body(request)) : null;
        snapshot = await mutate((s) => {
          if (!s.lists.some((l) => l.id === id)) fail(404, 'List not found');
          if (method === 'PATCH')
            return { ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, ...input } : l)) };
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
            activeTasks: snapshot.state.tasks.filter((t) => !t.deletedAt && !t.completedAt).length,
            completedTasks: snapshot.state.tasks.filter((t) => !t.deletedAt && t.completedAt)
              .length,
            focusMinutes: snapshot.state.sessions.reduce((n, s) => n + s.minutes, 0),
          },
          snapshot,
        );
      if (route === '/focus' && method === 'GET') {
        snapshot = await service.mutate((s) => finishTimer(s));
        return send(
          { timer: snapshot.state.timer, sessions: snapshot.state.sessions.slice(-100).reverse() },
          snapshot,
        );
      }
      if (route === '/focus/start' && method === 'POST') {
        const input = focusInputSchema.parse(await body(request));
        snapshot = await mutate((s) => {
          s = finishTimer(s);
          if (s.timer) fail(409, 'A timer is already active');
          const task = input.taskId ? taskAt(s, input.taskId) : null;
          if (task?.deletedAt || task?.completedAt) fail(409, 'Choose an active task');
          const duration =
            (input.minutes ??
              (input.kind === 'focus' ? s.settings.focusMinutes : s.settings.breakMinutes)) * 60;
          return {
            ...s,
            timer: {
              id: uid(),
              taskId: task?.id ?? null,
              title: input.kind === 'break' ? '休息一下' : (task?.title ?? '自由专注'),
              kind: input.kind,
              duration,
              remaining: duration,
              endAt: Date.now() + duration * 1000,
            },
          };
        });
        return send(snapshot.state.timer, snapshot);
      }
      if (/^\/focus\/(pause|resume|cancel)$/.test(route) && method === 'POST') {
        snapshot = await mutate((s) => {
          s = finishTimer(s);
          const timer = s.timer;
          if (!timer) return s;
          if (route.endsWith('/cancel')) return { ...s, timer: null };
          return {
            ...s,
            timer: {
              ...timer,
              remaining: remainingSeconds(timer),
              endAt: route.endsWith('/pause')
                ? null
                : (timer.endAt ?? Date.now() + timer.remaining * 1000),
            },
          };
        });
        return send(snapshot.state.timer, snapshot);
      }
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
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || requestedPort === 0) throw error;
    await listen(0);
  }
  const port = (server.address() as { port: number }).port;
  const info: ApiInfo = { enabled: true, url: `http://127.0.0.1:${port}/api/v1`, token };
  try {
    await writeFile(credentialFile, JSON.stringify({ ...info, pid: process.pid }, null, 2), {
      mode: 0o600,
    });
    await chmod(credentialFile, 0o600);
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
