export const FUDAN_LOGIN_URL =
  'https://fdjwgl.fudan.edu.cn/student/sso/login?targetUrl=/student/for-std/course-table';

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

// Self-contained by design: the exact same source runs in the isolated desktop
// school view and the native Android WebView. Never return HTML or the raw API VM.
export const FUDAN_CAPTURE_SCRIPT = String.raw`(async function captureFudanCourses() {
  const url = new URL(location.href);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'fdjwgl.fudan.edu.cn' ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/student\/for-std\/course-table(?:\/|$)/.test(url.pathname)
  )
    throw new Error('请先登录并打开复旦教务系统的课程表页面。');
  const semesterId = document.querySelector('#semester')?.value;
  const list = window.semesters;
  if (!semesterId || !/^\d{1,12}$/.test(semesterId) || !Array.isArray(list))
    throw new Error('未找到选中的学期，请在课程表页面选择学期后重试。');
  const semester = list.find((item) => item && String(item.id) === semesterId);
  if (!semester) throw new Error('当前学期信息不可用，请重新选择学期。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let data;
  try {
    const response = await fetch(
      '/student/for-std/course-table/semester/' + semesterId + '/print-data?semesterId=' + semesterId + '&hasExperiment=true',
      { method: 'GET', credentials: 'same-origin', redirect: 'error', signal: controller.signal },
    );
    if (!response.ok) throw new Error('读取失败');
    data = await response.json();
  } catch {
    throw new Error('读取课表失败，请确认已经登录，稍后重试。');
  } finally {
    clearTimeout(timeout);
  }
  const activities = data?.studentTableVms?.[0]?.activities;
  if (!Array.isArray(activities) || activities.length > 2000)
    throw new Error('没有取得有效的课程表数据，请确认学期。');
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
  if (content.length > 262144) throw new Error('课表数据过大，请换一个学期或使用文件导入。');
  return content;
})()`;
