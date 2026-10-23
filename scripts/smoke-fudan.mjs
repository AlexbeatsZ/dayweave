import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base = path.join(os.tmpdir(), '.agents');
await mkdir(base, { recursive: true });
const profile = await mkdtemp(path.join(base, 'dayweave-fudan-'));
const env = { ...process.env, DAYWEAVE_DATA_DIR: profile, DAYWEAVE_API_PORT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.DAYWEAVE_DEV_URL;
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeVisible();
  // Intercept only the new ephemeral school session. This exercises the actual
  // native view and toolbar without logging into a school or reading real data.
  await app.evaluate(({ app, session }) => {
    app.on('web-contents-created', (_event, contents) => {
      if (contents.session === session.defaultSession) return;
      void contents.session.protocol.handle('https', (request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/print-data'))
          return new Response(
            JSON.stringify({
              studentTableVms: [
                {
                  activities: [
                    {
                      courseName: '隔离窗口课程',
                      weekday: 1,
                      startTime: 800,
                      endTime: 845,
                      room: 'H4306',
                      weekIndexes: [1, 3],
                      teacherName: '示例教师',
                    },
                  ],
                },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        return new Response(
          url.pathname === '/student/for-std/course-table'
            ? '<!doctype html><meta charset="utf-8"><script>var semesters=[{id:215,startDate:"2026-09-07",endDate:"2027-01-17"}]</script><select id="semester"><option value="215">学期</option></select><h1>测试课表</h1>'
            : '<!doctype html><script>location.href="https://fdjwgl.fudan.edu.cn/student/for-std/course-table"</script>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      });
    });
  });
  async function openToolbar() {
    await page.evaluate(() => {
      window.testFudanResult = window.clearlist.importFudan();
    });
    // Electron also reports the school WebContentsView as a Playwright page;
    // select the local toolbar explicitly instead of racing the first event.
    await expect
      .poll(() => app.windows().some((window) => window.url().startsWith('data:text/html')))
      .toBe(true);
    return app.windows().find((window) => window.url().startsWith('data:text/html'));
  }
  const popup = await openToolbar();
  await expect(popup.getByRole('button', { name: '读取课表', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some(
            (contents) =>
              contents.getURL() === 'https://fdjwgl.fudan.edu.cn/student/for-std/course-table',
          ),
      ),
    )
    .toBe(true);
  const isolated = await app.evaluate(({ webContents, session }) => {
    const contents = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('https://fdjwgl'));
    const preferences = contents.getLastWebPreferences();
    return {
      isolated: contents.session !== session.defaultSession,
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      node: preferences.nodeIntegration,
    };
  });
  assert.deepEqual(isolated, {
    isolated: true,
    sandbox: true,
    contextIsolation: true,
    node: false,
  });
  await popup.getByRole('button', { name: '读取课表', exact: true }).click();
  const content = await page.evaluate(() => window.testFudanResult);
  assert.equal(JSON.parse(content).activities[0].courseName, '隔离窗口课程');
  const second = await openToolbar();
  await second.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testFudanResult), null);
  const state = await page.evaluate(() => window.clearlist.load());
  assert.equal(state.state.schedule.courses.length, 0);
  console.log(
    JSON.stringify({
      isolatedSchoolView: true,
      minimalCapture: true,
      cancel: true,
      previewOnly: true,
    }),
  );
} finally {
  await app?.close();
  assert.ok(path.resolve(profile).startsWith(path.resolve(base) + path.sep));
  await rm(profile, { recursive: true, force: true });
}
