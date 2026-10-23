export const FUDAN_LOGIN_URL =
  'https://fdjwgl.fudan.edu.cn/student/sso/login?targetUrl=/student/for-std/course-table';
export const FUDAN_TABLE_URL = 'https://fdjwgl.fudan.edu.cn/student/for-std/course-table';

export function isFudanNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['fdjwgl.fudan.edu.cn', 'id.fudan.edu.cn', 'uis.fudan.edu.cn'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isFudanCourseTable(value: string): boolean {
  if (!isFudanNavigation(value)) return false;
  const url = new URL(value);
  return (
    url.hostname === 'fdjwgl.fudan.edu.cn' &&
    /^\/student\/for-std\/course-table(?:\/|$)/.test(url.pathname)
  );
}

const captureErrors = {
  PAGE: '请先登录并打开复旦教务系统的课程表页面。',
  SEMESTER: '未找到选中的学期，请在课程表页面选择学期后重试。',
  SEMESTER_DATA: '未读到当前学期的日期信息，请重新选择学期后重试。',
  SESSION: '课表登录状态已失效，请重新登录后读取。',
  REQUEST: '学校课表接口返回错误，请稍后重试。',
  NETWORK: '课表数据请求失败，请检查网络后重试。',
  TIMEOUT: '课表数据请求超时，请稍后重试。',
  FORMAT: '学校返回的课表数据格式无法识别。',
  EMPTY: '所选学期没有可导入的课程。',
  SIZE: '课表数据过大，请换一个学期或使用文件导入。',
  SCRIPT: '课表读取程序执行失败。',
};

// Self-contained by design: the exact same source runs in the isolated desktop
// school view and the native Android WebView. Never return HTML or the raw API VM.
const captureFunction = String.raw`(async function captureFudanCourses(requestedSemester) {
  const messages = ${JSON.stringify(captureErrors)};
  const fail = (code, status) => {
    const error = new Error(messages[code] + ' [FUDAN_' + code + (status ? '_' + status : '') + ']');
    error.captureCode = code;
    error.captureStatus = status;
    throw error;
  };
  const url = new URL(location.href);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'fdjwgl.fudan.edu.cn' ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/student\/for-std\/course-table(?:\/|$)/.test(url.pathname)
  )
    fail('PAGE');
  const initialUrl = location.href;
  const semesterId = requestedSemester ?? document.querySelector('#semester')?.value;
  // Top-level let/const bindings are not properties of window.
  const list = typeof semesters !== 'undefined' ? semesters : window.semesters;
  if (!semesterId || !/^\d{1,12}$/.test(semesterId)) fail('SEMESTER');
  if (!Array.isArray(list)) fail('SEMESTER_DATA');
  const semester = list.find((item) => item && String(item.id) === semesterId);
  if (!semester || typeof semester.startDate !== 'string' || typeof semester.endDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}/.test(semester.startDate)
    || !/^\d{4}-\d{2}-\d{2}/.test(semester.endDate)) fail('SEMESTER_DATA');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let data;
  try {
    const response = await fetch(
      '/student/for-std/course-table/semester/' + semesterId + '/print-data?semesterId=' + semesterId + '&hasExperiment=true',
      { method: 'GET', credentials: 'same-origin', redirect: 'manual', signal: controller.signal },
    );
    if (response.status === 401 || response.status === 403 || response.type === 'opaqueredirect')
      fail('SESSION');
    if (!response.ok) fail('REQUEST', response.status);
    try { data = await response.json(); }
    catch { fail(controller.signal.aborted ? 'TIMEOUT' : 'FORMAT'); }
  } catch (error) {
    if (error?.captureCode) throw error;
    fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timeout);
  }
  if (location.href !== initialUrl || (!requestedSemester && document.querySelector('#semester')?.value !== semesterId))
    fail('PAGE');
  // An ambiguous/missing table must never become an empty refresh that deletes courses.
  if (!Array.isArray(data?.studentTableVms) || data.studentTableVms.length !== 1) fail('FORMAT');
  const activities = data.studentTableVms[0]?.activities;
  if (!Array.isArray(activities) || activities.length > 2000)
    fail('FORMAT');
  if (!activities.length && !requestedSemester) fail('EMPTY');
  const text = (value, max = 500) =>
    typeof value === 'string' ? value.slice(0, max) : '';
  const primitive = (value) =>
    typeof value === 'string'
      ? value.slice(0, 200)
      : typeof value === 'number' && Number.isFinite(value)
        ? value
        : null;
  const teachers = (value) =>
    Array.isArray(value)
      ? value
          .slice(0, 20)
          .map((item) =>
            typeof item === 'string'
              ? text(item, 100)
              : item && typeof item === 'object'
                ? text(item.name || item.nameZh || item.nameEn, 100)
                : null,
          )
          .filter(Boolean)
      : text(value, 300);
  const content = JSON.stringify({
    semester: {
      id: primitive(semester.id),
      startDate: text(semester.startDate, 40),
      endDate: text(semester.endDate, 40),
      weekStartOnSunday:
        typeof semester.weekStartOnSunday === 'boolean' ? semester.weekStartOnSunday : null,
    },
    activities: activities.map((row) => ({
      id: primitive(row?.id),
      lessonId: primitive(row?.lessonId),
      courseId: primitive(row?.courseId),
      code: primitive(row?.code),
      courseName: text(row?.courseName, 300),
      weekday: primitive(row?.weekday),
      startTime: primitive(row?.startTime),
      endTime: primitive(row?.endTime),
      room: typeof row?.room === 'string' ? text(row.room) : text(row?.room?.name),
      weekIndexes: Array.isArray(row?.weekIndexes)
        ? row.weekIndexes.slice(0, 100).map(primitive)
        : primitive(row?.weekIndexes),
      teacherName: text(row?.teacherName, 300),
      teacher: teachers(row?.teacher),
      teacherNames: teachers(row?.teacherNames),
    })),
  });
  if (content.length > 262144) fail('SIZE');
  return content;
})`;
export const FUDAN_CAPTURE_SCRIPT = `${captureFunction}()`;

// Both native hosts receive only our bounded messages, never raw website errors.
// Keep this envelope in the generated Android asset as well as Electron.
export const FUDAN_CAPTURE_RESULT_FUNCTION = `(async (semesterId) => {
  try { return { content: await ${captureFunction}(semesterId) }; }
  catch (error) {
    const messages = ${JSON.stringify(captureErrors)};
    const code = Object.prototype.hasOwnProperty.call(messages, error?.captureCode) ? error.captureCode : 'SCRIPT';
    const status = code === 'REQUEST' && Number.isInteger(error.captureStatus)
      && error.captureStatus >= 400 && error.captureStatus <= 599 ? '_' + error.captureStatus : '';
    return { error: messages[code] + ' [FUDAN_' + code + status + ']' };
  }
})`;
export const FUDAN_CAPTURE_RESULT_SCRIPT = `${FUDAN_CAPTURE_RESULT_FUNCTION}()`;

/** Reconstruct native status text; never display arbitrary remote error strings. */
export function fudanCaptureError(value: unknown): string {
  const match =
    typeof value === 'string' ? /\[FUDAN_([A-Z_]+?)(?:_([45][0-9]{2}))?\]$/.exec(value) : null;
  const code = match?.[1];
  if (!code || !Object.hasOwn(captureErrors, code)) return captureErrors.SCRIPT + ' [FUDAN_SCRIPT]';
  const status = code === 'REQUEST' && match?.[2] ? '_' + match[2] : '';
  return captureErrors[code as keyof typeof captureErrors] + ' [FUDAN_' + code + status + ']';
}
