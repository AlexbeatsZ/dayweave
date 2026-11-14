import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { v5 } from 'uuid';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as oauth from 'oauth4webapi';
import { z } from 'zod';
import {
  calendarAccountCommand,
  type CalendarAccountCommand,
  type CalendarAccountReply,
  type CalendarAccountsStatus,
  type OAuthProvider,
} from '../src/calendar-accounts.js';
import { previewCalendar, applyCalendarImport } from '../src/calendar-import.js';
import { generateRecurrences } from '../src/event-domain.js';
import { shiftDay, zoneDateKey } from '../src/timezone.js';
import { stable } from '../src/sync/document.js';
import { readOptional, writeAtomic } from './files.js';
import type { StateService } from './state-service.js';
import {
  connectedAccountSchema,
  calendarSession,
  calendarDigest,
  accountCalendarSource,
  type ConnectedAccount,
} from './calendar-providers.js';

const appSchema = z.object({ clientId: z.string(), clientSecret: z.string(), baseUrl: z.string() });
const privateSchema = z.object({
  version: z.literal(1),
  providers: z.object({ google: appSchema.optional(), microsoft: appSchema.optional() }),
  accounts: z.array(connectedAccountSchema),
});
const servers: Record<OAuthProvider, oauth.AuthorizationServer> = {
  google: {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
  },
  microsoft: {
    issuer: 'https://login.microsoftonline.com/common/v2.0',
    authorization_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  },
};
const scopes = {
  google: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
  microsoft: 'offline_access User.Read Calendars.ReadWrite',
};
type PendingAuthorization = {
  provider: OAuthProvider;
  verifier: string;
  actor: string;
  expires: number;
  generation: number;
  app: z.infer<typeof appSchema>;
};

/** Private center-owned credentials stay outside business JSON, sync, renderer state and exports. */
export class CalendarAccounts {
  private data: z.infer<typeof privateSchema> = { version: 1, providers: {}, accounts: [] };
  private loaded?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, PendingAuthorization>();
  private generation = 0;
  private disconnected = new Map<string, number>();
  private commands = new Map<string, { expires: number; result: Promise<CalendarAccountReply> }>();
  private jobs = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private closed = false;
  private storageError = '';
  private file: string;
  constructor(
    private service: StateService,
    directory: string,
    private authorized: (actor: string) => boolean,
    private request = fetch,
  ) {
    this.file = path.join(directory, 'calendar-accounts.json');
  }
  private load() {
    this.loaded ??= readOptional(this.file).then((raw) => {
      if (raw !== null) this.data = privateSchema.parse(JSON.parse(raw));
    });
    return this.loaded;
  }
  private update(transform: (data: typeof this.data) => typeof this.data) {
    const operation = this.writes.then(async () => {
      const next = privateSchema.parse(transform(this.data));
      try {
        await writeAtomic(this.file, JSON.stringify(next, null, 2));
        this.storageError = '';
      } catch (error) {
        this.storageError = '无法保存日历连接，请检查数据中心存储。';
        throw new Error(this.storageError, { cause: error });
      }
      this.data = next;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  private status(): CalendarAccountsStatus {
    const configured = (provider: OAuthProvider) => {
      const app = this.data.providers[provider];
      return {
        configured: !!(app?.clientId && app.clientSecret && app.baseUrl),
        clientId: app?.clientId ?? '',
        baseUrl: app?.baseUrl ?? '',
      };
    };
    return {
      providers: { google: configured('google'), microsoft: configured('microsoft') },
      accounts: this.data.accounts.map(
        ({ id, provider, name, calendars, importIds, publishId, checkedAt, error }) => ({
          id,
          provider,
          name,
          calendars,
          importIds,
          publishId,
          checkedAt,
          error: this.storageError || error,
          refreshing: this.jobs.has(id),
        }),
      ),
    };
  }
  command(input: CalendarAccountCommand, actor: string, requestId: string = randomUUID()) {
    if (this.closed || !this.authorized(actor)) throw new Error('请先连接同步中心');
    const key = `${actor}:${requestId}`;
    for (const [id, entry] of this.commands)
      if (entry.expires < Date.now()) this.commands.delete(id);
    const cached = this.commands.get(key);
    if (cached) return cached.result;
    if (this.commands.size >= 256) throw new Error('日历连接操作过多，请稍后重试');
    const result = this.execute(input, actor);
    this.commands.set(key, { expires: Date.now() + 5 * 60000, result });
    return result;
  }
  private async execute(
    input: CalendarAccountCommand,
    actor: string,
  ): Promise<CalendarAccountReply> {
    await this.load();
    if (this.closed || !this.authorized(actor)) throw new Error('请先连接同步中心');
    const command = calendarAccountCommand.parse(input);
    if (command.action === 'status') return { status: this.status() };
    if (command.action === 'configure') {
      const old = this.data.providers[command.provider];
      const clientSecret =
        command.clientSecret || (old?.clientId === command.clientId ? old.clientSecret : '');
      if (!clientSecret) throw new Error('请填写 OAuth 应用的客户端密钥');
      await this.update((data) => ({
        ...data,
        providers: {
          ...data.providers,
          [command.provider]: {
            clientId: command.clientId,
            clientSecret,
            baseUrl: command.baseUrl,
          },
        },
      }));
    } else if (command.action === 'authorize') {
      const app = this.data.providers[command.provider];
      if (!app) throw new Error('请先配置此服务的登录应用');
      for (const [state, item] of this.pending)
        if (
          item.expires < Date.now() ||
          (item.actor === actor && item.provider === command.provider)
        )
          this.pending.delete(state);
      if (this.pending.size >= 32) throw new Error('待完成的登录过多，请稍后重试');
      const state = oauth.generateRandomState(),
        verifier = oauth.generateRandomCodeVerifier();
      this.pending.set(state, {
        provider: command.provider,
        verifier,
        actor,
        expires: Date.now() + 10 * 60000,
        generation: ++this.generation,
        app,
      });
      const url = new URL(servers[command.provider].authorization_endpoint!);
      url.search = new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: `${app.baseUrl}/calendar-oauth/callback`,
        response_type: 'code',
        state,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        scope: scopes[command.provider],
        ...(command.provider === 'google'
          ? { access_type: 'offline', prompt: 'consent' }
          : { prompt: 'select_account' }),
      }).toString();
      return { status: this.status(), authorizationUrl: url.toString() };
    } else if (command.action === 'apple') {
      const generation = ++this.generation;
      const account: ConnectedAccount = {
        id: v5(`apple:${command.username.toLowerCase()}`, v5.URL),
        provider: 'apple',
        identity: command.username.toLowerCase(),
        name: command.username,
        apple: { username: command.username, password: command.password },
        calendars: [],
        importIds: [],
        publishId: null,
        published: {},
        checkedAt: 0,
        error: '',
      };
      const controller = new AbortController();
      this.controllers.set(account.id, controller);
      try {
        account.calendars = await (
          await calendarSession(account, controller.signal, this.request)
        ).list();
        await this.addAccount(account, generation);
      } finally {
        this.controllers.delete(account.id);
      }
    } else {
      const account = this.data.accounts.find((row) => row.id === command.accountId);
      if (!account) throw new Error('此日历账号已断开');
      if (command.action === 'refresh') {
        void this.refreshAccount(account.id, true);
      } else {
        this.controllers.get(account.id)?.abort();
        await this.jobs.get(account.id);
        if (command.action === 'disconnect') {
          this.disconnected.set(account.id, ++this.generation);
          await this.update((data) => ({
            ...data,
            accounts: data.accounts.filter((row) => row.id !== account.id),
          }));
        } else {
          const ids = new Set(account.calendars.map((row) => row.id));
          if (
            command.importIds.some((id) => !ids.has(id)) ||
            (command.publishId &&
              !account.calendars.some((row) => row.id === command.publishId && row.writable))
          )
            throw new Error('请选择仍可访问的日历');
          await this.update((data) => ({
            ...data,
            accounts: data.accounts.map((row) =>
              row.id === account.id
                ? {
                    ...row,
                    importIds: [...new Set(command.importIds)],
                    publishId: command.publishId,
                    checkedAt: 0,
                    error: '',
                  }
                : row,
            ),
          }));
          void this.refreshAccount(account.id, true);
        }
      }
    }
    return { status: this.status() };
  }
  private async addAccount(account: ConnectedAccount, generation: number) {
    const existing = this.data.accounts.find(
      (row) => row.provider === account.provider && row.identity === account.identity,
    );
    if (existing) {
      this.controllers.get(existing.id)?.abort();
      await this.jobs.get(existing.id);
      account = { ...account, id: existing.id };
    }
    await this.update((data) => {
      if (this.closed || (this.disconnected.get(account.id) ?? 0) > generation)
        throw new Error('登录请求已取消，请返回时织重新连接。');
      const current = data.accounts.find((row) => row.id === account.id);
      return {
        ...data,
        accounts: [
          ...data.accounts.filter((row) => row.id !== account.id),
          {
            ...account,
            ...(current
              ? {
                  importIds: current.importIds,
                  publishId: current.publishId,
                  published: current.published,
                }
              : {}),
          },
        ],
      };
    });
  }
  async callback(request: IncomingMessage, response: ServerResponse) {
    if (request.url?.split('?')[0] !== '/calendar-oauth/callback') return false;
    request.resume();
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return true;
    }
    let message = '登录已完成，请返回时织选择要导入或发布的日历。';
    let status = 200;
    try {
      await this.load();
      const url = new URL(request.url, 'https://calendar.invalid');
      const state = url.searchParams.get('state') ?? '';
      const pending = this.pending.get(state);
      this.pending.delete(state);
      if (
        !pending ||
        pending.expires < Date.now() ||
        !this.authorized(pending.actor) ||
        this.closed
      )
        throw new Error('登录请求已过期，请返回时织重新连接。');
      if (url.searchParams.has('error')) throw new Error('登录授权已取消，请返回时织重新连接。');
      const { provider, app, verifier } = pending;
      if (stable(this.data.providers[provider]) !== stable(app))
        throw new Error('登录应用配置已更改，请返回时织重新登录。');
      const server = servers[provider],
        client = { client_id: app.clientId };
      const parameters = oauth.validateAuthResponse(server, client, url.searchParams, state);
      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        server,
        client,
        oauth.ClientSecretPost(app.clientSecret),
        parameters,
        `${app.baseUrl}/calendar-oauth/callback`,
        verifier,
        { [oauth.customFetch]: this.request, signal: AbortSignal.timeout(20000) },
      );
      const tokens = await oauth.processAuthorizationCodeResponse(server, client, tokenResponse);
      const profileResponse = await this.request(
        provider === 'google'
          ? 'https://www.googleapis.com/oauth2/v3/userinfo'
          : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName',
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        },
      );
      if (!profileResponse.ok) throw new Error('无法读取日历账号，请返回时织重试。');
      const profile = await profileResponse.json();
      const identity = provider === 'google' ? profile.sub : profile.id;
      const name =
        profile.email || profile.mail || profile.userPrincipalName || profile.displayName;
      if (typeof identity !== 'string' || typeof name !== 'string')
        throw new Error('无法识别日历账号，请返回时织重试。');
      const prior = this.data.accounts.find(
        (row) => row.provider === provider && row.identity === identity,
      );
      const refreshToken = tokens.refresh_token || prior?.token?.refreshToken;
      if (!refreshToken) throw new Error('未取得持续访问授权，请返回时织重新连接并同意日历权限。');
      const account: ConnectedAccount = {
        id: prior?.id ?? v5(`${provider}:${identity}`, v5.URL),
        provider,
        identity,
        name,
        token: {
          accessToken: tokens.access_token,
          refreshToken,
          expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        },
        calendars: [],
        importIds: [],
        publishId: null,
        published: {},
        checkedAt: 0,
        error: '',
      };
      account.calendars = await (
        await calendarSession(account, AbortSignal.timeout(30000), this.request)
      ).list();
      if (!this.authorized(pending.actor) || this.closed)
        throw new Error('设备连接已撤销，请返回时织重新连接。');
      await this.addAccount(account, pending.generation);
    } catch (error) {
      status = 400;
      message =
        error instanceof Error && /^(登录|无法|未取得|设备连接)/.test(error.message)
          ? error.message
          : '日历登录未完成，请返回时织检查应用配置并重试。';
    }
    response
      .writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
      })
      .end(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>时织日历连接</title><style>body{font:17px system-ui;max-width:34rem;margin:15vh auto;padding:24px;line-height:1.7}h1{font-size:24px}</style><h1>时织日历连接</h1><p>${message}</p></html>`,
      );
    return true;
  }
  async refresh() {
    await this.load();
    if (this.closed) return;
    await Promise.all(this.data.accounts.map((account) => this.refreshAccount(account.id)));
  }
  private refreshAccount(id: string, force = false) {
    const running = this.jobs.get(id);
    if (running) return running;
    const account = this.data.accounts.find((row) => row.id === id);
    if (this.closed || !account || (!force && Date.now() - account.checkedAt < 5 * 60000))
      return Promise.resolve();
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const job = this.poll(account, controller.signal)
      .catch(async () => {
        if (!controller.signal.aborted)
          await this.update((data) => ({
            ...data,
            accounts: data.accounts.map((row) =>
              row.id === id
                ? {
                    ...row,
                    checkedAt: Date.now(),
                    error: '日历同步失败，请检查网络和授权，或重新连接账号。',
                  }
                : row,
            ),
          }));
      })
      .catch(() => {
        // A failed status write is exposed by storageError; background work remains retryable.
      })
      .finally(() => {
        this.jobs.delete(id);
        this.controllers.delete(id);
      });
    this.jobs.set(id, job);
    return job;
  }
  private async poll(account: ConnectedAccount, signal: AbortSignal) {
    if (account.token && account.token.expiresAt < Date.now() + 60000) {
      const provider = account.provider as OAuthProvider,
        app = this.data.providers[provider];
      if (!app) throw new Error('登录应用配置已移除');
      const server = servers[provider],
        client = { client_id: app.clientId };
      const response = await oauth.refreshTokenGrantRequest(
        server,
        client,
        oauth.ClientSecretPost(app.clientSecret),
        account.token.refreshToken,
        {
          [oauth.customFetch]: this.request,
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        },
      );
      const tokens = await oauth.processRefreshTokenResponse(server, client, response);
      account = {
        ...account,
        token: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || account.token.refreshToken,
          expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        },
      };
      const token = account.token;
      await this.update((data) => ({
        ...data,
        accounts: data.accounts.map((row) => (row.id === account.id ? { ...row, token } : row)),
      }));
    }
    const session = await calendarSession(account, signal, this.request);
    const calendars = await session.list();
    if (account.publishId && !signal.aborted)
      await this.service.mutate((current) =>
        generateRecurrences(current, undefined, Date.now(), true),
      );
    const state = (await this.service.snapshot()).state;
    const today = zoneDateKey(Date.now(), state.schedule.timeZone),
      from = shiftDay(today, -366),
      through = shiftDay(today, 366);
    for (const calendarId of account.importIds) {
      if (signal.aborted) return;
      const { text, instants } = await session.read(
        calendarId,
        shiftDay(from, -2),
        shiftDay(through, 2),
      );
      const preview = previewCalendar(
        text,
        { id: accountCalendarSource(account.id, calendarId), timeZone: state.schedule.timeZone },
        from,
        through,
      );
      // Native APIs expand recurring series and keep an immutable ID for each occurrence.
      // Keep that identity when an occurrence's date/time moves.
      if (account.provider !== 'apple')
        for (const item of preview.items) {
          item.original = '0';
          if (item.event) {
            item.event.recurrenceId = '0';
            const bounds = instants?.get(item.uid);
            if (bounds)
              item.event.precision = { start: bounds.start % 60000, end: bounds.end % 60000 };
          }
        }
      if (signal.aborted) return;
      await this.service.mutate((current) => applyCalendarImport(current, preview));
    }
    if (account.publishId) {
      if (!calendars.some((row) => row.id === account.publishId && row.writable))
        throw new Error('发布日历已失去写入权限');
      for (const event of (await this.service.snapshot()).state.calendarEvents) {
        if (signal.aborted) return;
        if (event.source?.kind === 'calendar') continue;
        const key = JSON.stringify([account.publishId, event.id]),
          prior = account.published[key];
        if (event.deletedAt && !prior) continue;
        const fingerprint = calendarDigest(stable(event));
        if (prior?.fingerprint === fingerprint) continue;
        const remoteId = await session.publish(account.publishId, event, prior);
        if (signal.aborted) return;
        const published = { id: remoteId, fingerprint };
        await this.update((data) => ({
          ...data,
          accounts: data.accounts.map((row) =>
            row.id === account.id
              ? { ...row, published: { ...row.published, [key]: published } }
              : row,
          ),
        }));
      }
    }
    if (!signal.aborted)
      await this.update((data) => ({
        ...data,
        accounts: data.accounts.map((row) =>
          row.id === account.id ? { ...row, calendars, checkedAt: Date.now(), error: '' } : row,
        ),
      }));
  }
  async close() {
    this.closed = true;
    this.pending.clear();
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([
      ...this.jobs.values(),
      ...[...this.commands.values()].map((row) => row.result),
    ]);
    await this.writes;
  }
}
