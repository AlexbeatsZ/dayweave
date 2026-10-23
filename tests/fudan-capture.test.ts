import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {
  FUDAN_CAPTURE_SCRIPT,
  FUDAN_LOGIN_URL,
  isFudanCourseTable,
  isFudanNavigation,
} from '../src/fudan-capture.js';
import { parseFudanCourses } from '../src/fudan-import.js';
import { emptySchedule } from '../src/schedule.js';
import { importFudan } from '../src/files.js';

const tableUrl = 'https://fdjwgl.fudan.edu.cn/student/for-std/course-table';
const schoolResponse = {
  studentId: 'private-student-id',
  studentName: 'private-student-name',
  loginToken: 'private-login-token',
  studentTableVms: [
    {
      student: { id: 'private-student-id', name: 'private-student-name' },
      activities: [
        {
          courseName: '物理化学',
          weekday: 1,
          startTime: 800,
          endTime: 940,
          weekIndexes: [1, 3],
          room: { name: 'H4306', internalId: 'private-room-id' },
          teacherName: '',
          teacherNames: [{ nameZh: '示例教师', email: 'private-teacher-email' }],
          studentNames: ['private-student-name'],
          token: 'private-login-token',
        },
      ],
    },
  ],
};

function fixture(
  options: { url?: string; semesterId?: string; response?: unknown; ok?: boolean } = {},
) {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const document = {
    querySelector(selector: string) {
      assert.equal(selector, '#semester');
      return { value: options.semesterId ?? '215' };
    },
    get cookie(): never {
      throw new Error('Capture must never read cookies');
    },
    get documentElement(): never {
      throw new Error('Capture must never return page HTML');
    },
  };
  const context = vm.createContext({
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    location: { href: options.url ?? tableUrl },
    document,
    window: {
      semesters: [
        {
          id: 215,
          startDate: '2026-09-07',
          endDate: '2027-01-17',
          studentName: 'private-student-name',
        },
      ],
    },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, options: init });
      return { ok: options.ok ?? true, json: async () => options.response ?? schoolResponse };
    },
  });
  return { requests, run: () => vm.runInContext(FUDAN_CAPTURE_SCRIPT, context) as Promise<string> };
}

test('Fudan navigation only accepts official HTTPS hosts and capture only accepts the course-table path', async () => {
  for (const url of [
    FUDAN_LOGIN_URL,
    'https://id.fudan.edu.cn/ac/#/index',
    'https://uis.fudan.edu.cn/authserver/login',
  ])
    assert.equal(isFudanNavigation(url), true);
  assert.equal(isFudanCourseTable(tableUrl + '?semester=215'), true);
  assert.equal(isFudanCourseTable(FUDAN_LOGIN_URL), false);
  for (const url of [
    'http://fdjwgl.fudan.edu.cn/student/for-std/course-table',
    'https://fdjwgl.fudan.edu.cn.evil.test/student/for-std/course-table',
    'https://user@fdjwgl.fudan.edu.cn/student/for-std/course-table',
    'https://fdjwgl.fudan.edu.cn:8443/student/for-std/course-table',
    'file:///student/for-std/course-table',
    'javascript:alert(1)',
  ]) {
    assert.equal(isFudanNavigation(url), false, url);
    const browser = fixture({ url });
    await assert.rejects(browser.run(), /登录/);
    assert.equal(browser.requests.length, 0);
  }
  const login = fixture({ url: 'https://id.fudan.edu.cn/ac/#/index' });
  await assert.rejects(login.run(), /登录/);
  assert.equal(login.requests.length, 0);
});

test('the shared capture requests the selected semester and returns only minimal course fields', async () => {
  const browser = fixture();
  const content = await browser.run();
  assert.equal(browser.requests.length, 1);
  assert.equal(
    browser.requests[0].url,
    '/student/for-std/course-table/semester/215/print-data?semesterId=215&hasExperiment=true',
  );
  assert.equal(browser.requests[0].options.method, 'GET');
  assert.equal(browser.requests[0].options.credentials, 'same-origin');
  assert.equal(browser.requests[0].options.redirect, 'error');
  assert.equal(browser.requests[0].options.body, undefined);
  assert.equal(browser.requests[0].options.headers, undefined);
  const result = JSON.parse(content);
  assert.deepEqual(result.semester, {
    id: 215,
    startDate: '2026-09-07',
    endDate: '2027-01-17',
    weekStartOnSunday: null,
  });
  assert.equal(result.activities[0].id, null);
  assert.equal(result.activities[0].room, 'H4306');
  assert.deepEqual(result.activities[0].teacherNames, ['示例教师']);
  for (const secret of [
    'private-student-id',
    'private-student-name',
    'private-login-token',
    'private-teacher-email',
    'private-room-id',
  ])
    assert.equal(content.includes(secret), false, secret);
  assert.equal(Object.hasOwn(result, 'studentTableVms'), false);
});

test('actual capture output agrees with the native import parser including nullable IDs and teacher fallback', async () => {
  const content = await fixture().run();
  const preview = parseFudanCourses(content, emptySchedule(), Date.UTC(2026, 9, 23));
  assert.equal(preview.schedule.courses.length, 1);
  const course = preview.schedule.courses[0];
  assert.equal(course.name, '物理化学');
  assert.equal(course.teacher, '示例教师');
  assert.equal(course.location, 'H4306');
  assert.equal(course.start, '08:00');
  assert.equal(course.end, '09:40');
  assert.deepEqual(course.weeks, [1, 3]);
});

test('missing semester and unauthenticated responses fail without returning page or response contents', async () => {
  const noSemester = fixture({ semesterId: '../other' });
  await assert.rejects(noSemester.run(), /学期/);
  assert.equal(noSemester.requests.length, 0);
  await assert.rejects(fixture({ ok: false }).run(), /读取课表失败/);
  await assert.rejects(
    fixture({ response: { html: 'private-login-token' } }).run(),
    /有效的课程表/,
  );
});

test('the native Android asset contains the same executable JavaScript with no TypeScript runtime assumptions', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-capture-build-'));
  try {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../scripts/build-fudan-capture.mjs', import.meta.url))],
      { cwd: directory },
    );
    const asset = await readFile(
      path.join(directory, 'android/app/src/main/assets/fudan-capture.js'),
      'utf8',
    );
    assert.equal(asset, FUDAN_CAPTURE_SCRIPT);
    assert.doesNotThrow(() => new vm.Script(asset));
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(root) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop cancellation returns null and plain web shows the installation boundary', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { clearlist: { importFudan: async () => null } },
    });
    assert.equal(await importFudan(), null);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    await assert.rejects(importFudan(), /安装版/);
  } finally {
    if (before) Object.defineProperty(globalThis, 'window', before);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
