import { test, expect, type Page } from '@playwright/test';
import { emptyState, type AppState } from '../../src/model';
import { parseFudanCourses } from '../../src/fudan-import';
import { fudanSource, type FudanSource } from '../../src/fudan-refresh';

const now = Date.parse('2026-09-07T03:00:00Z');
const sourceKey = 'dayweave.fudan-source.v1';
const screenshots = 'release/synthetic-fudan-refresh';
const semester = { id: 215, startDate: '2026-09-07', endDate: '2027-01-24' };
const weeks = Array.from({ length: 20 }, (_, index) => index + 1);
const schoolRows = [
  {
    lessonId: 10,
    courseName: '合成·物理化学',
    weekday: 1,
    startTime: 800,
    endTime: 940,
    weekIndexes: weeks,
    room: '合成楼101',
    teacherName: '合成教师',
  },
  {
    lessonId: 11,
    courseName: '合成·撤回课程',
    weekday: 3,
    startTime: 1330,
    endTime: 1510,
    weekIndexes: weeks,
    room: '合成楼202',
    teacherName: '合成教师',
  },
];
const capture = (activities = schoolRows) => JSON.stringify({ semester, activities });
const changed = capture([
  { ...schoolRows[0], weekday: 5, startTime: 1000, endTime: 1140, room: '合成新教室' },
  { ...schoolRows[1], lessonId: 12, courseName: '合成·新增实验', weekday: 4 },
]);

interface NativeRequest {
  semesterId: string;
  settled: boolean;
  resolve(value: { content: string }): void;
  reject(error: Error): void;
}
interface NativeWrite {
  name: string;
  content: string;
  settled: boolean;
  resolve(): void;
  reject(error: Error): void;
}
interface NativeHarness {
  files: Record<string, string>;
  writes: Array<{ name: string; content: string }>;
  writeAttempts: Array<{ name: string; content: string }>;
  writeMode: 'normal' | 'fail' | 'defer';
  pendingWrites: NativeWrite[];
  finishWrite(index: number, error?: string): void;
  calls: Array<{ plugin: string; method: string }>;
  requests: NativeRequest[];
  canceled: number;
  imports: number;
  importContent: string | null;
  cancelMode: 'reject' | 'late';
  hidden: boolean;
  listeners: Map<string, { eventName: string; callback: (value: unknown) => void }>;
  respond(index: number, content?: string, error?: string): void;
  appState(isActive: boolean): void;
  visibility(hidden: boolean): void;
}
declare global {
  interface Window {
    __fudanTest: NativeHarness;
  }
}

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  timezoneId: 'America/New_York',
  reducedMotion: 'reduce',
});

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed())
    await page.screenshot({
      path: screenshots + '/' + info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png',
    });
});

async function boot(page: Page) {
  const state = emptyState();
  state.settings.theme = 'dark';
  const preview = parseFudanCourses(capture(), state.schedule, now - 10000);
  const source = fudanSource(preview, 0);
  state.schedule = preview.schedule;
  state.schedule.holidays = ['2026-10-01'];
  state.schedule.courses.push({
    ...state.schedule.courses[0],
    id: 'manual-course',
    name: '合成·手动研讨',
    weekday: 2,
    start: '10:00',
    end: '10:45',
    location: '自填教室',
    teacher: '自填教师',
  });
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5178')
      throw new Error('Unexpected external request: ' + url.origin);
    return route.continue();
  });
  await page.addInitScript(
    ({ state, source, sourceKey }) => {
      const harness: NativeHarness = {
        files: { 'data.json': JSON.stringify(state) },
        writes: [],
        writeAttempts: [],
        writeMode: 'normal',
        pendingWrites: [],
        finishWrite(index, error) {
          const write = this.pendingWrites[index];
          if (!write || write.settled) throw new Error('No pending native write ' + index);
          write.settled = true;
          if (error) write.reject(new Error(error));
          else {
            this.files[write.name] = write.content;
            this.writes.push({ name: write.name, content: write.content });
            write.resolve();
          }
        },
        calls: [],
        requests: [],
        canceled: 0,
        imports: 0,
        importContent: null,
        cancelMode: 'reject',
        hidden: false,
        listeners: new Map(),
        respond(index, content, error) {
          const request = this.requests[index];
          if (!request || request.settled) throw new Error('No pending native refresh ' + index);
          request.settled = true;
          if (error) request.reject(new Error(error));
          else request.resolve({ content: content! });
        },
        appState(isActive) {
          for (const listener of this.listeners.values())
            if (listener.eventName === 'appStateChange') listener.callback({ isActive });
        },
        visibility(hidden) {
          this.hidden = hidden;
          document.dispatchEvent(new Event('visibilitychange'));
        },
      };
      let listenerId = 0;
      const promiseMethods = [
        'read',
        'write',
        'deviceInfo',
        'appearance',
        'discoverSync',
        'refreshFudan',
        'cancelFudanRefresh',
        'importFudan',
      ];
      Object.assign(window, {
        __fudanTest: harness,
        androidBridge: {},
        Capacitor: {
          PluginHeaders: [
            {
              name: 'DayweaveFiles',
              methods: promiseMethods.map((name) => ({ name, rtype: 'promise' })),
            },
            {
              name: 'App',
              methods: [
                { name: 'addListener', rtype: 'callback' },
                ...['removeListener', 'getLaunchUrl', 'minimizeApp'].map((name) => ({
                  name,
                  rtype: 'promise',
                })),
              ],
            },
          ],
          nativePromise: async (
            plugin: string,
            method: string,
            options: Record<string, string> = {},
          ) => {
            harness.calls.push({ plugin, method });
            if (plugin === 'App') {
              if (method === 'removeListener') {
                harness.listeners.delete(options.callbackId);
                return;
              }
              if (method === 'getLaunchUrl' || method === 'minimizeApp') return {};
            }
            if (plugin === 'DayweaveFiles') {
              if (method === 'read') return { content: harness.files[options.name] ?? null };
              if (method === 'write') {
                harness.writeAttempts.push({ name: options.name, content: options.content });
                // Only primary business writes are controlled; backups and sync still run normally.
                if (options.name === 'data.json') {
                  if (harness.writeMode === 'fail') throw new Error('合成测试：原生主文件写入失败');
                  if (harness.writeMode === 'defer')
                    return new Promise<void>((resolve, reject) => {
                      harness.pendingWrites.push({
                        name: options.name,
                        content: options.content,
                        settled: false,
                        resolve,
                        reject,
                      });
                    });
                }
                harness.files[options.name] = options.content;
                harness.writes.push({ name: options.name, content: options.content });
                return;
              }
              if (method === 'deviceInfo') return { name: '合成测试手机' };
              if (method === 'appearance') return;
              if (method === 'discoverSync') return { peers: [] };
              if (method === 'refreshFudan')
                return new Promise<{ content: string }>((resolve, reject) => {
                  harness.requests.push({
                    semesterId: options.semesterId,
                    settled: false,
                    resolve,
                    reject,
                  });
                });
              if (method === 'cancelFudanRefresh') {
                harness.canceled++;
                if (harness.cancelMode === 'reject')
                  for (const request of harness.requests) {
                    if (request.settled) continue;
                    request.settled = true;
                    request.reject(new Error('课表更新已取消，已有课表已保留。 [FUDAN_CANCELED]'));
                  }
                return;
              }
              if (method === 'importFudan') {
                harness.imports++;
                return { content: harness.importContent };
              }
            }
            throw new Error('Unexpected native method: ' + plugin + '.' + method);
          },
          nativeCallback: (
            plugin: string,
            method: string,
            options: { eventName: string },
            callback: (value: unknown) => void,
          ) => {
            if (plugin !== 'App' || method !== 'addListener')
              throw new Error('Unexpected native callback');
            const id = String(++listenerId);
            harness.listeners.set(id, { eventName: options.eventName, callback });
            return id;
          },
        },
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => harness.hidden });
      localStorage.setItem(sourceKey, JSON.stringify(source));
    },
    { state, source, sourceKey },
  );
  await page.goto('/#timetable');
  await expect(page.getByRole('region', { name: '每周课程表' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/native-mobile/);
  await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  expect(
    await page.evaluate(() => ({
      platform: window.clearlist?.platform,
      webState: localStorage.getItem('dayweave.v1'),
      semester: window.__fudanTest.requests[0].semesterId,
    })),
  ).toEqual({ platform: 'android', webState: null, semester: '215' });
  return state;
}

const saved = (page: Page): Promise<AppState> =>
  page.evaluate(() => JSON.parse(window.__fudanTest.files['data.json']));
const primaryWrites = (page: Page) =>
  page.evaluate(
    () => window.__fudanTest.writes.filter((write) => write.name === 'data.json').length,
  );
const checked = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.checkedAt ?? null,
    sourceKey,
  );
const course = (page: Page, name: string) =>
  page.getByRole('button', { name: '编辑课程 ' + name, exact: true });
const journal = (page: Page): Promise<FudanSource | null> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), sourceKey);
const optimistic = (page: Page): Promise<AppState> =>
  page.evaluate(async () => {
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    return store.get();
  });
const primaryAttempts = (page: Page) =>
  page.evaluate(
    () => window.__fudanTest.writeAttempts.filter((write) => write.name === 'data.json').length,
  );
const schoolIds = (state: AppState) =>
  state.schedule.courses
    .filter((row) => row.id !== 'manual-course')
    .map((row) => row.id)
    .sort();
async function flushUi(page: Page) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  });
}
async function respond(page: Page, index: number, content = capture(), error?: string) {
  await page.evaluate(
    ({ index, content, error }) => window.__fudanTest.respond(index, content, error),
    { index, content, error },
  );
  await flushUi(page);
}
async function more(page: Page) {
  await page.getByRole('button', { name: '课程操作', exact: true }).click();
  const menu = page.getByRole('dialog', { name: '课程操作', exact: true });
  await menu.getByText('更多', { exact: true }).click();
  return menu;
}

for (const outcome of ['cancel', 'invalid'] as const) {
  test(`immediate ${outcome} import resumes refresh after its canceled callback settles`, async ({
    page,
  }) => {
    const initial = await boot(page);
    await page.evaluate((outcome) => {
      window.__fudanTest.cancelMode = 'late';
      window.__fudanTest.importContent = outcome === 'cancel' ? null : 'invalid';
    }, outcome);
    await page.getByRole('button', { name: '课程操作', exact: true }).click();
    await page
      .getByRole('dialog', { name: '课程操作', exact: true })
      .getByRole('button', { name: /网站导入/ })
      .click();
    await expect.poll(() => page.evaluate(() => window.__fudanTest.imports)).toBe(1);
    await expect(page.getByRole('button', { name: '课程操作', exact: true })).toBeEnabled();
    await expect(page.getByRole('dialog', { name: '预览导入课程', exact: true })).toHaveCount(0);
    expect(await saved(page)).toEqual(initial);
    expect(await primaryWrites(page)).toBe(0);
    await respond(page, 0, changed);
    await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(2);
    expect(await saved(page)).toEqual(initial);
    await respond(page, 1);
    await expect.poll(() => checked(page)).toBe(now);
  });
}

test('startup and resume refresh preserve manual edits made during capture', async ({ page }) => {
  await boot(page);
  await course(page, '合成·手动研讨').click();
  const editor = page.getByRole('dialog', { name: '编辑课程', exact: true });
  await editor.getByLabel('课程名称').fill('合成·读取中手动修改');
  await editor.getByLabel('教室 / 地点').fill('手动保留教室');
  await editor.getByRole('button', { name: '保存课程', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const manual = (await saved(page)).schedule.courses.find((row) => row.id === 'manual-course')!;
  expect(manual.name).toBe('合成·读取中手动修改');
  await respond(page, 0, changed);
  await expect.poll(() => checked(page)).toBe(now);
  expect((await saved(page)).schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
    manual,
  );
  await expect(course(page, '合成·撤回课程')).toHaveCount(0);
  await expect(course(page, '合成·物理化学')).toContainText('合成新教室');
  await expect(course(page, manual.name)).toBeVisible();
  expect(await primaryWrites(page)).toBe(2);
  await page.evaluate(() => window.__fudanTest.appState(true));
  await flushUi(page);
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  await page.clock.setFixedTime(new Date(now + 16 * 60000));
  await page.evaluate(() => {
    window.__fudanTest.appState(false);
    window.__fudanTest.appState(true);
  });
  await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(2);
  await respond(page, 1, changed);
  await expect.poll(() => checked(page)).toBe(now + 16 * 60000);
  expect((await saved(page)).schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
    manual,
  );
  expect(await primaryWrites(page)).toBe(2);
});

test('unchanged refresh updates connection metadata without writing business state', async ({
  page,
}) => {
  const initial = await boot(page);
  const bytes = await page.evaluate(() => window.__fudanTest.files['data.json']);
  await respond(page, 0);
  await expect.poll(() => checked(page)).toBe(now);
  expect(await saved(page)).toEqual(initial);
  expect(await page.evaluate(() => window.__fudanTest.files['data.json'])).toBe(bytes);
  expect(await primaryWrites(page)).toBe(0);
  expect(
    await page.evaluate(() =>
      window.__fudanTest.writes.some((write) => write.name === 'data.backup.json'),
    ),
  ).toBe(false);
  await expect(course(page, '合成·物理化学')).toBeVisible();
  await expect(course(page, '合成·手动研讨')).toBeVisible();
});

test('expired login retains courses and offers the official re-login action', async ({ page }) => {
  const initial = await boot(page);
  await respond(page, 0, capture(), '课表登录状态已失效，请重新登录后读取。 [FUDAN_SESSION]');
  expect(await saved(page)).toEqual(initial);
  expect(await primaryWrites(page)).toBe(0);
  await expect(course(page, '合成·物理化学')).toBeVisible();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('已有课程仍保留');
  await expect(alert).toContainText('[FUDAN_SESSION]');
  await alert.getByRole('button', { name: '重新登录并读取课表', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fudanTest.imports)).toBe(1);
  expect(await saved(page)).toEqual(initial);
  expect(await primaryWrites(page)).toBe(0);
});

test('disabling subscription cancels native refresh and discards a late successful response', async ({
  page,
}) => {
  const initial = await boot(page);
  await page.evaluate(() => {
    window.__fudanTest.cancelMode = 'late';
  });
  const menu = await more(page);
  await menu.getByRole('button', { name: '关闭自动更新，保留课程', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fudanTest.canceled)).toBe(1);
  expect(await checked(page)).toBeNull();
  await expect(menu.getByRole('button', { name: '立即更新课表', exact: true })).toHaveCount(0);
  await respond(page, 0, changed);
  expect(await saved(page)).toEqual(initial);
  expect(await primaryWrites(page)).toBe(0);
  await page.getByRole('button', { name: '关闭课程操作', exact: true }).click();
  await page.clock.setFixedTime(new Date(now + 16 * 60000));
  await page.evaluate(() => window.__fudanTest.appState(true));
  await flushUi(page);
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  await expect(course(page, '合成·撤回课程')).toBeVisible();
});

for (const boundary of ['native', 'visibility'] as const) {
  test('background cancellation and foreground retry through ' + boundary, async ({ page }) => {
    const initial = await boot(page);
    await page.evaluate((boundary) => {
      if (boundary === 'native') window.__fudanTest.appState(false);
      else window.__fudanTest.visibility(true);
    }, boundary);
    await expect.poll(() => page.evaluate(() => window.__fudanTest.canceled)).toBe(1);
    await flushUi(page);
    expect(await saved(page)).toEqual(initial);
    expect(await primaryWrites(page)).toBe(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => window.__fudanTest.requests[0].settled)).toBe(true);
    // Retry within the normal 15-minute interval; cancellation must clear the throttle.
    await page.clock.setFixedTime(new Date(now + 60000));
    await page.evaluate((boundary) => {
      if (boundary === 'native') window.__fudanTest.appState(true);
      else window.__fudanTest.visibility(false);
    }, boundary);
    await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(2);
    await respond(page, 1, changed);
    await expect.poll(() => checked(page)).toBe(now + 60000);
    const next = await saved(page);
    expect(next.schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
      initial.schedule.courses.find((row) => row.id === 'manual-course'),
    );
    expect(next.schedule.courses).toHaveLength(3);
    expect(next.schedule.courses.some((row) => row.name === '合成·撤回课程')).toBe(false);
    expect(await primaryWrites(page)).toBe(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('explicit same-semester website re-import replaces rescheduled and withdrawn rows without duplicates', async ({
  page,
}) => {
  const initial = await boot(page);
  await respond(page, 0);
  await expect.poll(() => checked(page)).toBe(now);
  await page.evaluate((content) => {
    window.__fudanTest.importContent = content;
  }, changed);
  const before = await saved(page);
  const expectedSchool = parseFudanCourses(changed, initial.schedule, now).schedule.courses;
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByRole('button', { name: '课程操作', exact: true }).click();
    await page
      .getByRole('dialog', { name: '课程操作', exact: true })
      .getByRole('button', { name: /网站导入/ })
      .click();
    const preview = page.getByRole('dialog', { name: '预览导入课程', exact: true });
    await expect(preview).toContainText('合成新教室');
    await expect(preview).toContainText('合成·新增实验');
    expect(await primaryWrites(page)).toBe(repeat);
    if (repeat === 0) expect(await saved(page)).toEqual(before);
    await preview.getByRole('button', { name: '合并导入', exact: true }).click();
    await expect(preview).toHaveCount(0);
    const result = await saved(page);
    expect(result.schedule.courses).toHaveLength(3);
    expect(result.schedule.courses.filter((row) => row.id !== 'manual-course')).toEqual(
      expectedSchool,
    );
    expect(result.schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
      initial.schedule.courses.find((row) => row.id === 'manual-course'),
    );
    for (const old of initial.schedule.courses.filter((row) => row.id !== 'manual-course'))
      expect(result.schedule.courses.some((row) => row.id === old.id)).toBe(false);
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).courseIds.slice().sort(),
        sourceKey,
      ),
    ).toEqual(expectedSchool.map((row) => row.id).sort());
    await expect(course(page, '合成·物理化学')).toHaveCount(1);
    await expect(course(page, '合成·撤回课程')).toHaveCount(0);
    await expect(course(page, '合成·新增实验')).toHaveCount(1);
    await expect(course(page, '合成·手动研讨')).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.__fudanTest.imports)).toBe(2);
  expect(await primaryWrites(page)).toBe(2);
});

test('failed native write keeps A union B ownership across an optimistic no-op until retry persists B', async ({
  page,
}) => {
  const initial = await boot(page);
  const a = schoolIds(initial);
  const b = parseFudanCourses(changed, initial.schedule, now)
    .schedule.courses.map((row) => row.id)
    .sort();
  const union = [...new Set([...a, ...b])].sort();
  await page.evaluate(() => {
    window.__fudanTest.writeMode = 'fail';
  });
  await respond(page, 0, changed);
  await expect(page.locator('.error-banner')).toContainText('原生主文件写入失败');
  const pendingB = await optimistic(page);
  expect(schoolIds(pendingB)).toEqual(b);
  expect(pendingB.schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
    initial.schedule.courses.find((row) => row.id === 'manual-course'),
  );
  expect(await saved(page)).toEqual(initial);
  expect(await primaryWrites(page)).toBe(0);
  expect(await primaryAttempts(page)).toBe(1);
  expect((await journal(page))?.courseIds.slice().sort()).toEqual(union);
  expect(await checked(page)).toBe(0);

  const menu = await more(page);
  const update = menu.getByRole('button', { name: '立即更新课表', exact: true });
  await expect(update).toBeEnabled();
  await page.clock.setFixedTime(new Date(now + 60000));
  await update.click();
  await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(2);
  // School B equals the current optimistic view, not the last successfully saved A.
  await respond(page, 1, changed);
  await expect(update).toBeEnabled();
  expect(await optimistic(page)).toEqual(pendingB);
  expect(await saved(page)).toEqual(initial);
  expect(await primaryAttempts(page)).toBe(1);
  expect((await journal(page))?.courseIds.slice().sort()).toEqual(union);
  expect(await checked(page)).toBe(0);
  await page.screenshot({
    path: screenshots + '/failed-write-no-op-retains-ownership-journal.png',
  });

  await page.evaluate(async () => {
    window.__fudanTest.writeMode = 'normal';
    const modulePath = '/src/store.ts';
    const { store } = await import(modulePath);
    // Drive the real retry API; do not replace or reload the optimistic store.
    store.retry();
    const snapshot = await store.flush();
    if (!snapshot.loaded || snapshot.error) throw new Error(snapshot.error || 'Retry did not load');
  });
  expect(await saved(page)).toEqual(pendingB);
  expect(await primaryWrites(page)).toBe(1);
  expect(await primaryAttempts(page)).toBe(2);
  expect((await journal(page))?.courseIds.slice().sort()).toEqual(union);

  await page.clock.setFixedTime(new Date(now + 120000));
  await update.click();
  await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(3);
  await respond(page, 2, changed);
  await expect.poll(() => checked(page)).toBe(now + 120000);
  expect((await journal(page))?.courseIds.slice().sort()).toEqual(b);
  expect(await saved(page)).toEqual(pendingB);
  expect(await primaryAttempts(page)).toBe(2);
  await page.getByRole('button', { name: '关闭课程操作', exact: true }).click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expect(course(page, '合成·物理化学')).toContainText('合成新教室');
});

test('explicit B confirmation ignores old refresh C while native persistence is pending', async ({
  page,
}) => {
  const initial = await boot(page);
  const bRows = parseFudanCourses(changed, initial.schedule, now).schedule.courses;
  const b = bRows.map((row) => row.id).sort();
  const union = [...new Set([...schoolIds(initial), ...b])].sort();
  const c = capture([
    { ...schoolRows[0], lessonId: 13, courseName: '合成·迟到刷新C', room: '旧刷新教室' },
  ]);
  const cIds = parseFudanCourses(c, initial.schedule, now).schedule.courses.map((row) => row.id);
  await page.evaluate((content) => {
    window.__fudanTest.cancelMode = 'late';
    window.__fudanTest.writeMode = 'defer';
    window.__fudanTest.importContent = content;
  }, changed);
  await page.getByRole('button', { name: '课程操作', exact: true }).click();
  await page
    .getByRole('dialog', { name: '课程操作', exact: true })
    .getByRole('button', { name: /网站导入/ })
    .click();
  const preview = page.getByRole('dialog', { name: '预览导入课程', exact: true });
  await expect(preview).toContainText('合成新教室');
  await expect
    .poll(() => page.evaluate(() => window.__fudanTest.canceled))
    .toBeGreaterThanOrEqual(1);
  expect(await saved(page)).toEqual(initial);
  expect(await primaryAttempts(page)).toBe(0);
  // A foreground event during preview must not admit another automatic capture.
  await page.evaluate(() => window.__fudanTest.appState(true));
  await flushUi(page);
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);

  await preview.getByRole('button', { name: '合并导入', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fudanTest.pendingWrites.length)).toBe(1);
  await expect(preview.getByRole('button', { name: '合并导入', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: '关闭预览导入课程', exact: true }).click();
  await expect(preview).toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new Event('clearlist:back', { cancelable: true })),
  );
  await expect(preview).toBeVisible();
  await page.evaluate(() => window.__fudanTest.appState(true));
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  const pendingB = await optimistic(page);
  expect(pendingB.schedule.courses.filter((row) => row.id !== 'manual-course')).toEqual(bRows);
  expect(await saved(page)).toEqual(initial);
  expect(await primaryWrites(page)).toBe(0);
  const pendingJournal = await journal(page);
  expect(pendingJournal?.courseIds.slice().sort()).toEqual(union);

  // Complete the canceled pre-import capture only after B is optimistic and its write is blocked.
  await respond(page, 0, c);
  expect(await optimistic(page)).toEqual(pendingB);
  expect(await saved(page)).toEqual(initial);
  expect(await journal(page)).toEqual(pendingJournal);
  expect(await primaryAttempts(page)).toBe(1);
  expect(await page.evaluate(() => window.__fudanTest.pendingWrites.length)).toBe(1);
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  await page.screenshot({
    path: screenshots + '/explicit-import-pending-write-ignores-old-refresh.png',
  });

  await page.evaluate(() => window.__fudanTest.finishWrite(0));
  await expect(preview).toHaveCount(0);
  await expect.poll(() => checked(page)).toBe(now);
  await flushUi(page);
  const persisted = await saved(page);
  expect(persisted).toEqual(pendingB);
  expect(persisted.schedule.courses).toHaveLength(3);
  expect(schoolIds(persisted)).toEqual(b);
  expect(persisted.schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
    initial.schedule.courses.find((row) => row.id === 'manual-course'),
  );
  expect((await journal(page))?.courseIds.slice().sort()).toEqual(b);
  expect((await journal(page))?.courseIds.some((id) => cIds.includes(id))).toBe(false);
  expect(await primaryWrites(page)).toBe(1);
  expect(await primaryAttempts(page)).toBe(1);
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  await expect(course(page, '合成·物理化学')).toHaveCount(1);
  await expect(course(page, '合成·新增实验')).toHaveCount(1);
  await expect(course(page, '合成·迟到刷新C')).toHaveCount(0);
});

test('rapid pause and resume schedules a retry after the old callback finally completes', async ({
  page,
}) => {
  const initial = await boot(page);
  await page.evaluate(() => {
    window.__fudanTest.cancelMode = 'late';
    window.__fudanTest.appState(false);
    window.__fudanTest.appState(true);
  });
  await expect.poll(() => page.evaluate(() => window.__fudanTest.canceled)).toBe(1);
  await flushUi(page);
  expect(await page.evaluate(() => window.__fudanTest.requests.length)).toBe(1);
  expect(await page.evaluate(() => window.__fudanTest.requests[0].settled)).toBe(false);
  expect(await saved(page)).toEqual(initial);
  expect(await primaryWrites(page)).toBe(0);

  // No additional resume event follows this callback: checkPending must drive the retry.
  await respond(page, 0, changed);
  await expect.poll(() => page.evaluate(() => window.__fudanTest.requests.length)).toBe(2);
  expect(await saved(page)).toEqual(initial);
  expect(await optimistic(page)).toEqual(initial);
  expect(await checked(page)).toBe(0);
  expect(await primaryWrites(page)).toBe(0);
  await respond(page, 1, changed);
  await expect.poll(() => checked(page)).toBe(now);
  const persisted = await saved(page);
  expect(schoolIds(persisted)).toEqual(
    parseFudanCourses(changed, initial.schedule, now)
      .schedule.courses.map((row) => row.id)
      .sort(),
  );
  expect(persisted.schedule.courses.find((row) => row.id === 'manual-course')).toEqual(
    initial.schedule.courses.find((row) => row.id === 'manual-course'),
  );
  expect(await primaryWrites(page)).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
