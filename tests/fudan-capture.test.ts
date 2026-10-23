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
  FUDAN_CAPTURE_RESULT_SCRIPT,
  FUDAN_CAPTURE_RESULT_FUNCTION,
  FUDAN_LOGIN_URL,
  fudanCaptureError,
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
  options: {
    url?: string;
    semesterId?: string;
    response?: unknown;
    status?: number;
    redirected?: boolean;
    semesterBinding?: 'let' | 'const' | 'missing';
    networkError?: boolean;
    invalidJson?: boolean;
    timeout?: boolean;
    onJson?: () => void;
    semesters?: unknown;
    control?: 'semester' | 'allSemesters';
    currentSemester?: unknown;
  } = {},
) {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  let selected = options.semesterId ?? '215';
  const document = {
    querySelector(selector: string) {
      assert.ok(['#semester', '#allSemesters'].includes(selector));
      return selector === '#' + (options.control ?? 'semester') ? { value: selected } : null;
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
    setTimeout: options.timeout ? (callback: () => void) => setTimeout(callback, 1) : setTimeout,
    clearTimeout,
    location: { href: options.url ?? tableUrl },
    document,
    window: {
      currentSemester: options.currentSemester,
      semesters: options.semesters ?? [
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
      if (options.networkError) throw new Error('private-login-token');
      if (options.timeout)
        await new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('private-login-token')), {
            once: true,
          }),
        );
      const status = options.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        type: options.redirected ? 'opaqueredirect' : 'basic',
        json: async () => {
          options.onJson?.();
          if (options.invalidJson) throw new Error('private-login-token');
          return options.response ?? schoolResponse;
        },
      };
    },
  });
  if (options.semesterBinding === 'missing') vm.runInContext('delete window.semesters', context);
  else if (options.semesterBinding)
    vm.runInContext(
      `${options.semesterBinding} semesters = window.semesters; delete window.semesters;`,
      context,
    );
  return {
    requests,
    select: (id: string) => {
      selected = id;
    },
    navigate: (url: string) => {
      context.location.href = url;
    },
    requested: (id: string) =>
      vm.runInContext(FUDAN_CAPTURE_RESULT_FUNCTION, context)(id) as Promise<{
        content?: string;
        error?: string;
      }>,
    run: () => vm.runInContext(FUDAN_CAPTURE_SCRIPT, context) as Promise<string>,
    result: () =>
      vm.runInContext(FUDAN_CAPTURE_RESULT_SCRIPT, context) as Promise<{
        content?: string;
        error?: string;
      }>,
  };
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
  assert.equal(browser.requests[0].options.redirect, 'manual');
  assert.equal(browser.requests[0].options.body, undefined);
  assert.equal(browser.requests[0].options.headers, undefined);
  const result = JSON.parse(content);
  assert.deepEqual(result.semester, {
    id: 215,
    startDate: '2026-09-07',
    endDate: '2027-01-17',
    weekStartOnSunday: false,
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
  await assert.rejects(fixture({ status: 401 }).run(), /FUDAN_SESSION/);
  await assert.rejects(
    fixture({ response: { html: 'private-login-token' } }).run(),
    /FUDAN_FORMAT/,
  );
});

test('capture reads let and const semester bindings which are not window properties', async () => {
  for (const semesterBinding of ['let', 'const'] as const) {
    const result = await fixture({ semesterBinding }).result();
    assert.equal(result.error, undefined);
    const preview = parseFudanCourses(result.content!, emptySchedule());
    assert.equal(preview.schedule.courses[0].name, '物理化学');
  }
});

test('live Selectize semester control and plural teachers import with the school Sunday week anchor', async () => {
  const response = {
    studentTableVms: [
      {
        activities: [
          {
            lessonId: 10,
            courseName: '示例课程',
            weekday: 1,
            startTime: '8:00',
            endTime: '9:40',
            weekIndexes: [1, 2],
            room: '示例教室',
            teachers: ['教师甲', '教师乙'],
          },
        ],
      },
    ],
  };
  const browser = fixture({
    control: 'allSemesters',
    semesterId: '527',
    response,
    semesters: [{ id: 527, startDate: '2026-09-06', endDate: '2027-01-09' }],
    currentSemester: { id: 527, weekStartOnSunday: true },
  });
  const result = await browser.result();
  assert.equal(result.error, undefined);
  assert.equal(JSON.parse(result.content!).semester.weekStartOnSunday, true);
  assert.deepEqual(JSON.parse(result.content!).activities[0].teacherNames, ['教师甲', '教师乙']);
  const preview = parseFudanCourses(result.content!, emptySchedule());
  assert.equal(preview.schedule.semesterStart, '2026-09-07');
  assert.equal(preview.schedule.courses[0].teacher, '教师甲、教师乙');
  assert.equal(preview.schedule.courses[0].start, '08:00');
  assert.ok(browser.requests[0].url.includes('/semester/527/print-data'));
  browser.select('505');
  assert.equal((await browser.requested('527')).error, undefined);
});

test('semester date anchors remain host-timezone independent when the list omits the week-start flag', async () => {
  for (const [startDate, flag] of [
    ['2026-09-06', true],
    ['2026-09-07', false],
  ] as const) {
    const result = await fixture({
      control: 'allSemesters',
      semesters: [{ id: 215, startDate, endDate: '2027-01-09' }],
      currentSemester: { id: 999, weekStartOnSunday: !flag },
    }).requested('215');
    assert.equal(result.error, undefined);
    assert.equal(JSON.parse(result.content!).semester.weekStartOnSunday, flag);
    assert.equal(
      parseFudanCourses(result.content!, emptySchedule()).schedule.semesterStart,
      '2026-09-07',
    );
  }
});

test('native capture preserves actionable error stages without exposing raw school errors', async () => {
  const cases = [
    [fixture({ semesterId: '' }), 'SEMESTER'],
    [fixture({ semesterBinding: 'missing' }), 'SEMESTER_DATA'],
    [fixture({ status: 403 }), 'SESSION'],
    [fixture({ redirected: true, status: 0 }), 'SESSION'],
    [fixture({ status: 404 }), 'REQUEST_404'],
    [fixture({ status: 500 }), 'REQUEST_500'],
    [fixture({ networkError: true }), 'NETWORK'],
    [fixture({ invalidJson: true }), 'FORMAT'],
    [fixture({ response: { lessons: [] } }), 'FORMAT'],
    [fixture({ response: { studentTableVms: [{ activities: [] }] } }), 'EMPTY'],
  ] as const;
  for (const [browser, code] of cases) {
    const result = await browser.result();
    assert.equal(result.content, undefined);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error!.endsWith(`[FUDAN_${code}]`), result.error ?? code);
    assert.equal(result.error!.includes('private-'), false);
  }
});

test('the native Android asset contains the same executable JavaScript with no TypeScript runtime assumptions', async () => {
  const root = path.join(os.tmpdir(), '.agents');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'dayweave-capture-build-'));
  try {
    await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('../scripts/build-fudan-capture.mjs', import.meta.url)),
        path.join(directory, 'android/app/src/main/assets/fudan-capture.js'),
      ],
      { cwd: directory },
    );
    const asset = await readFile(
      path.join(directory, 'android/app/src/main/assets/fudan-capture.js'),
      'utf8',
    );
    assert.equal(asset, FUDAN_CAPTURE_RESULT_FUNCTION);
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

test('refresh captures only its saved semester even when the page selected another semester', async () => {
  const browser = fixture({ semesterId: '999' });
  const result = await browser.requested('215');
  assert.equal(result.error, undefined);
  assert.equal(JSON.parse(result.content!).semester.id, 215);
  assert.ok(browser.requests[0].url.includes('/semester/215/'));
  for (const id of ['999', '../215', '', '215&token=private-login-token']) {
    const missing = fixture();
    assert.ok((await missing.requested(id)).error?.includes('[FUDAN_SEMESTER'));
    assert.equal(missing.requests.length, 0);
  }
});

test('empty refresh requires an explicit valid semester and one unambiguous table', async () => {
  const response = { studentTableVms: [{ activities: [] }] };
  const result = await fixture({ response }).requested('215');
  assert.equal(result.error, undefined);
  const base = emptySchedule();
  const before = structuredClone(base);
  assert.throws(() => parseFudanCourses(result.content!, base), /没有可导入/);
  const preview = parseFudanCourses(result.content!, base, Date.now(), true);
  assert.deepEqual(preview.schedule.courses, []);
  assert.deepEqual(preview.schedule.events, []);
  assert.equal(preview.source?.semesterId, '215');
  assert.deepEqual(base, before);
  for (const studentTableVms of [
    [],
    [{ activities: [] }, { activities: schoolResponse.studentTableVms[0].activities }],
    [{ activities: null }],
  ]) {
    const invalid = await fixture({ response: { studentTableVms } }).requested('215');
    assert.ok(invalid.error?.endsWith('[FUDAN_FORMAT]'));
    assert.equal(invalid.content, undefined);
  }
});

test('capture rejects a changed page or selected semester instead of delivering stale course rows', async () => {
  for (const change of ['url', 'semester', 'allSemesters']) {
    const browser = fixture({
      control: change === 'allSemesters' ? 'allSemesters' : 'semester',
      onJson: () =>
        change === 'url' ? browser.navigate(tableUrl + '/other') : browser.select('999'),
    });
    const result = await browser.result();
    assert.equal(result.content, undefined);
    assert.ok(result.error?.endsWith('[FUDAN_PAGE]'));
  }
});

test('timeouts, invalid semester metadata and unexpected script errors never expose remote text', async () => {
  const timeout = await fixture({ timeout: true }).result();
  assert.ok(timeout.error?.endsWith('[FUDAN_TIMEOUT]'));
  const missing = await fixture({
    semesters: [{ id: 215, startDate: 'private-student-id', endDate: '2027-01-17' }],
  }).result();
  assert.ok(missing.error?.endsWith('[FUDAN_SEMESTER_DATA]'));
  const script = await fixture({
    onJson: () => {
      throw new Error('private-student-name');
    },
  }).result();
  assert.equal(script.error?.includes('private-'), false);
  for (const value of [
    'private-student-name',
    'private-login-token [FUDAN_REQUEST_503]',
    'private-login-token [FUDAN_UNKNOWN]',
    null,
    { error: 'private-student-id' },
  ]) {
    const message = fudanCaptureError(value);
    assert.equal(message.includes('private-'), false);
    assert.ok(
      message.endsWith(
        value === 'private-login-token [FUDAN_REQUEST_503]'
          ? '[FUDAN_REQUEST_503]'
          : '[FUDAN_SCRIPT]',
      ),
    );
  }
});

test('parser errors redact invalid school field values and equivalent semester IDs stay stable', async () => {
  const content = await fixture().run();
  const capture = JSON.parse(content);
  const first = parseFudanCourses(content, emptySchedule());
  capture.semester.id = String(capture.semester.id);
  const second = parseFudanCourses(JSON.stringify(capture), emptySchedule());
  assert.equal(second.schedule.courses[0].id, first.schedule.courses[0].id);
  for (const value of ['private-login-token', '25:00']) {
    capture.activities[0].startTime = value;
    assert.throws(
      () => parseFudanCourses(JSON.stringify(capture), emptySchedule()),
      (error: Error) => error.message.includes('[FUDAN_TIME]') && !error.message.includes(value),
    );
  }
  capture.activities[0].startTime = '08:00';
  capture.semester.startDate = '2026-99-99';
  assert.throws(
    () => parseFudanCourses(JSON.stringify(capture), emptySchedule()),
    /FUDAN_SEMESTER_DATA/,
  );
});
