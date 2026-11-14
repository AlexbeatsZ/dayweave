import { z } from 'zod';
import { syncEndpoint } from './sync/crypto.js';

export const oauthProviders = ['google', 'microsoft'] as const;
export type OAuthProvider = (typeof oauthProviders)[number];
export type CalendarProvider = OAuthProvider | 'apple';
export const calendarProviderNames = {
  google: 'Google 日历',
  microsoft: 'Microsoft / Outlook',
  apple: 'Apple / iCloud',
};
export const calendarSetupUrls = {
  google: 'https://console.cloud.google.com/apis/credentials',
  googleApi: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  microsoft: 'https://entra.microsoft.com/',
  apple: 'https://account.apple.com/',
};

export const calendarAccountCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z
    .object({
      action: z.literal('configure'),
      provider: z.enum(oauthProviders),
      clientId: z.string().trim().min(1).max(1000),
      clientSecret: z.string().trim().max(4000).optional(),
      baseUrl: z.string().transform((value) => {
        const url = syncEndpoint(value);
        if (!url.startsWith('https://')) throw new Error('登录回调需要数据中心的 HTTPS 地址');
        return url;
      }),
    })
    .strict(),
  z.object({ action: z.literal('authorize'), provider: z.enum(oauthProviders) }).strict(),
  z
    .object({
      action: z.literal('apple'),
      username: z.string().trim().email().max(320),
      password: z
        .string()
        .trim()
        .regex(/^[a-z]{4}(?:-[a-z]{4}){3}$/i, '请填写 Apple 应用专用密码'),
    })
    .strict(),
  z
    .object({
      action: z.literal('select'),
      accountId: z.string().uuid(),
      importIds: z.array(z.string().min(1).max(4000)).max(100),
      publishId: z.string().min(1).max(4000).nullable(),
    })
    .strict(),
  z.object({ action: z.literal('refresh'), accountId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('disconnect'), accountId: z.string().uuid() }).strict(),
]);
export type CalendarAccountCommand = z.input<typeof calendarAccountCommand>;
export type RemoteCalendar = { id: string; name: string; writable: boolean };
export type CalendarAccountStatus = {
  id: string;
  provider: CalendarProvider;
  name: string;
  calendars: RemoteCalendar[];
  importIds: string[];
  publishId: string | null;
  checkedAt: number;
  error: string;
  refreshing: boolean;
};
export type CalendarAccountsStatus = {
  providers: Record<OAuthProvider, { configured: boolean; clientId: string; baseUrl: string }>;
  accounts: CalendarAccountStatus[];
};
export type CalendarAccountReply = { status: CalendarAccountsStatus; authorizationUrl?: string };

export function calendarAuthorizationUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    ![
      'https://accounts.google.com/o/oauth2/v2/auth',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    ].includes(url.origin + url.pathname)
  )
    throw new Error('日历登录地址无效');
  return url.toString();
}

export function calendarExternalUrl(input: string) {
  if (Object.values(calendarSetupUrls).includes(input)) return input;
  return calendarAuthorizationUrl(input);
}
