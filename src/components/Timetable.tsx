import { useEffect, useRef, useState, useMemo, type FormEvent } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Plus,
  X,
  MapPin,
  Clock3,
  Settings2,
  Trash2,
} from 'lucide-react';
import { store, useStore } from '../store';
import {
  courseOccurrences,
  nextClasses,
  semesterWeek,
  courseSchema,
  scheduleSchema,
  parseWeeks,
  mergeSchedule,
  type Course,
  type Occurrence,
} from '../schedule';
import {
  zoneDateKey,
  zoneClock,
  shiftDay,
  weekday,
  dayStart,
  deviceZone,
  zoneLabel,
  timeZones,
} from '../timezone';
import { importCourses, csvTemplate, type ImportPreview } from '../course-import';
import { pickText, exportText, isMobileApp, requestWidget } from '../files';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function NextClass({
  clock,
  compact = false,
  onOpen,
}: {
  clock: number;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { data } = useStore();
  const occurrences = useMemo(() => courseOccurrences(data.schedule), [data.schedule]);
  const current = occurrences.filter((e) => e.start <= clock && e.end > clock),
    next = occurrences.find((e) => e.start > clock) ?? null;
  const item = current[0] ?? next;
  if (!item)
    return (
      <section className={`next-class ${compact ? 'compact' : ''}`}>
        <CalendarDays size={22} />
        <div>
          <span className="eyebrow">课程 · {data.schedule.timeZone}</span>
          <h3>接下来没有课程</h3>
          <p>导入课表或手动添加课程，就能在这里查看。</p>
        </div>
        {onOpen && (
          <button className="button" onClick={onOpen}>
            打开课表
          </button>
        )}
      </section>
    );
  const active = current.length > 0,
    target = active ? item.end : item.start;
  const minutes = Math.max(0, Math.ceil((target - clock) / 60000));
  const hours = Math.floor(minutes / 60),
    days = Math.floor(hours / 24);
  const remaining = days
    ? `${days} 天 ${hours % 24} 小时`
    : hours
      ? `${hours} 小时 ${minutes % 60} 分`
      : `${minutes} 分钟`;
  return (
    <section
      className={`next-class ${compact ? 'compact' : ''}`}
      style={{ '--course-color': item.color } as React.CSSProperties}
    >
      <div className="next-class-state">
        <Clock3 size={21} />
        <span>{active ? '正在上课' : '下一节课'}</span>
        <strong>{remaining}</strong>
        <small>{active ? '后下课' : '后上课'}</small>
      </div>
      <div className="next-class-detail">
        <span className="eyebrow">
          {zoneDateKey(item.start, data.schedule.timeZone)} · {data.schedule.timeZone}
        </span>
        <h3>{item.name}</h3>
        <p>
          <b>
            {zoneClock(item.start, data.schedule.timeZone)}–
            {zoneClock(item.end, data.schedule.timeZone)}
          </b>
          <span> · {item.location || '未填写地点'}</span>
        </p>
        {deviceZone() !== data.schedule.timeZone && (
          <p className="device-time">
            设备时间 {zoneDateKey(item.start, deviceZone())} {zoneClock(item.start, deviceZone())} ·{' '}
            {deviceZone()}
          </p>
        )}
        {active && next && (
          <small>
            下一节：{next.name} · {zoneClock(next.start, data.schedule.timeZone)}
          </small>
        )}
      </div>
      {onOpen && (
        <button className="icon-button" aria-label="打开课表" onClick={onOpen}>
          <ChevronRight size={20} />
        </button>
      )}
    </section>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="course-dialog"
      aria-label={title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function CourseEditor({ course, close }: { course: Course | 'new'; close: () => void }) {
  const { data } = useStore(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const old = course === 'new' ? null : course;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '');
    try {
      const item = courseSchema.parse({
        id: old?.id ?? crypto.randomUUID(),
        name: text('name'),
        location: text('location'),
        teacher: text('teacher'),
        weekday: Number(text('weekday')),
        start: text('start'),
        end: text('end'),
        weeks: parseWeeks(text('weeks'), data.schedule.totalWeeks),
        color: text('color'),
        excludedDates: text('excludedDates')
          .split(/[\s,，]+/)
          .filter(Boolean),
        updatedAt: Math.max(Date.now(), (old?.updatedAt ?? 0) + 1),
      });
      await store.transact((s) => {
        if (old && s.schedule.courses.find((c) => c.id === old.id)?.updatedAt !== old.updatedAt)
          throw new Error('课程已改变，请重新打开');
        return {
          ...s,
          schedule: scheduleSchema.parse({
            ...s.schedule,
            courses: old
              ? s.schedule.courses.map((c) => (c.id === item.id ? item : c))
              : [...s.schedule.courses, item],
          }),
        };
      });
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={old ? '编辑课程' : '添加课程'} close={close}>
      <form onSubmit={save} className="course-form">
        <label>
          课程名称
          <input
            required
            name="name"
            aria-label="课程名称"
            maxLength={300}
            defaultValue={old?.name}
          />
        </label>
        <div className="form-pair">
          <label>
            教师
            <input name="teacher" defaultValue={old?.teacher} />
          </label>
          <label>
            教室 / 地点
            <input name="location" defaultValue={old?.location} />
          </label>
        </div>
        <div className="form-pair">
          <label>
            星期
            <select name="weekday" defaultValue={old?.weekday ?? 1}>
              {weekdays.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            颜色
            <input type="color" name="color" defaultValue={old?.color ?? '#4264b2'} />
          </label>
        </div>
        <div className="form-pair">
          <label>
            上课时间
            <input
              required
              name="start"
              type="time"
              aria-label="上课时间"
              defaultValue={old?.start ?? '08:00'}
            />
          </label>
          <label>
            下课时间
            <input
              required
              name="end"
              type="time"
              aria-label="下课时间"
              defaultValue={old?.end ?? '09:40'}
            />
          </label>
        </div>
        <p className="field-hint">上课时间按 {zoneLabel(data.schedule.timeZone)} 计算。</p>
        <label>
          教学周
          <input
            name="weeks"
            aria-label="教学周"
            placeholder="1-16 或 1-15单 或 1,3,5"
            defaultValue={old?.weeks.join(',') ?? `1-${data.schedule.totalWeeks}`}
          />
        </label>
        <label>
          停课日期
          <input
            name="excludedDates"
            placeholder="2026-10-01,2026-10-02"
            defaultValue={old?.excludedDates.join(',')}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          {old && (
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                try {
                  await store.transact((s) => ({
                    ...s,
                    schedule: {
                      ...s.schedule,
                      courses: s.schedule.courses.filter((c) => c.id !== old.id),
                    },
                  }));
                  close();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              <Trash2 size={16} />
              删除课程
            </button>
          )}
          <button className="button primary" type="submit" disabled={busy}>
            保存课程
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function SemesterEditor({ close }: { close: () => void }) {
  const { data } = useStore(),
    [error, setError] = useState('');
  return (
    <Modal title="学期与时区" close={close}>
      <form
        className="course-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await store.transact((s) => ({
              ...s,
              schedule: scheduleSchema.parse({
                ...s.schedule,
                semesterStart: String(f.get('start')),
                totalWeeks: Number(f.get('weeks')),
                timeZone: String(f.get('zone')),
                holidays: String(f.get('holidays'))
                  .split(/[\s,，]+/)
                  .filter(Boolean),
              }),
            }));
            close();
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        <label>
          第一周的周一
          <input name="start" type="date" required defaultValue={data.schedule.semesterStart} />
        </label>
        <label>
          学期周数
          <input
            name="weeks"
            type="number"
            min={1}
            max={60}
            defaultValue={data.schedule.totalWeeks}
          />
        </label>
        <label>
          课程时区
          <input
            name="zone"
            list="course-timezones"
            required
            defaultValue={data.schedule.timeZone}
          />
          <datalist id="course-timezones">
            {timeZones.map(([zone, label]) => (
              <option key={zone} value={zone}>
                {label}
              </option>
            ))}
          </datalist>
        </label>
        <p className="field-hint">
          周课程始终按这个时区上课。日历课程保留导入时的真实时间。设备时区不会改变上课时刻。
        </p>
        <label>
          全校停课日期
          <textarea
            name="holidays"
            rows={3}
            placeholder="2026-10-01,2026-10-02"
            defaultValue={data.schedule.holidays.join(',')}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <button className="button primary" type="submit">
            保存学期
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function Timetable({ clock }: { clock: number }) {
  const { data } = useStore();
  const schedule = data.schedule,
    today = zoneDateKey(clock, schedule.timeZone);
  const current = semesterWeek(schedule, today);
  const [week, setWeek] = useState(Math.min(schedule.totalWeeks, Math.max(1, current)));
  const [editor, setEditor] = useState<Course | 'new' | null>(null),
    [semester, setSemester] = useState(false),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const start = shiftDay(schedule.semesterStart, (week - 1) * 7),
    days = Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
  const items = useMemo(
    () =>
      courseOccurrences(
        schedule,
        dayStart(start, schedule.timeZone),
        dayStart(shiftDay(start, 7), schedule.timeZone),
      ),
    [schedule, start],
  );
  const [selectedDay, setSelectedDay] = useState(weekday(today) - 1);
  const [detail, setDetail] = useState<Occurrence | null>(null);
  async function receive() {
    setError('');
    try {
      const text = await pickText();
      if (text === null) return;
      setPreview(
        importCourses(
          text,
          /BEGIN:VCALENDAR/i.test(text)
            ? 'courses.ics'
            : text
                  .trim()
                  .replace(/^\uFEFF/, '')
                  .startsWith('{')
              ? 'courses.json'
              : 'courses.csv',
          store.get().schedule,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="timetable-view">
      <NextClass clock={clock} />
      <div className="course-toolbar">
        <div className="week-switch">
          <button
            className="icon-button"
            aria-label="上一周"
            disabled={week <= 1}
            onClick={() => setWeek(week - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <strong>第 {week} 周</strong>
          <button
            className="icon-button"
            aria-label="下一周"
            disabled={week >= schedule.totalWeeks}
            onClick={() => setWeek(week + 1)}
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="button small"
            onClick={() => setWeek(Math.min(schedule.totalWeeks, Math.max(1, current)))}
          >
            本周
          </button>
        </div>
        <div className="course-actions">
          <button className="button" onClick={() => setSemester(true)}>
            <Settings2 size={16} />
            学期设置
          </button>
          <button className="button" onClick={receive}>
            <Upload size={16} />
            导入课程
          </button>
          <button className="button primary" onClick={() => setEditor('new')}>
            <Plus size={16} />
            添加课程
          </button>
        </div>
      </div>
      <p className="course-range">
        {start} — {days[6]} <span>{zoneLabel(schedule.timeZone, clock)}</span>
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="course-day-tabs">
        {days.map((d, i) => (
          <button
            aria-pressed={i === selectedDay}
            className={i === selectedDay ? 'active' : ''}
            key={d}
            onClick={() => setSelectedDay(i)}
          >
            {weekdays[i]}
            <small>{d.slice(5)}</small>
          </button>
        ))}
      </div>
      <div className="course-week-grid" role="region" aria-label="每周课程表">
        {days.map((day, i) => {
          const classes = items.filter((e) => zoneDateKey(e.start, schedule.timeZone) === day);
          return (
            <section
              key={day}
              className={`course-day ${day === today ? 'is-today' : ''} ${i === selectedDay ? 'day-selected' : ''}`}
            >
              <header>
                <strong>{weekdays[i]}</strong>
                <span>{day.slice(5)}</span>
                {day === today && <i>今天</i>}
              </header>
              <div className="course-day-events">
                {classes.map((item) => (
                  <button
                    className={`course-card ${item.start <= clock && item.end > clock ? 'class-now' : ''}`}
                    key={item.id}
                    style={{ '--course-color': item.color } as React.CSSProperties}
                    onClick={() => {
                      const course = schedule.courses.find((c) => c.id === item.courseId);
                      if (course) setEditor(course);
                      else setDetail(item);
                    }}
                  >
                    <time>
                      {zoneClock(item.start, schedule.timeZone)}
                      <span>{zoneClock(item.end, schedule.timeZone)}</span>
                    </time>
                    <h3>{item.name}</h3>
                    <p>
                      <MapPin size={12} />
                      {item.location || '未填教室'}
                    </p>
                    {item.teacher && <small>{item.teacher}</small>}
                  </button>
                ))}
                {!classes.length && <p className="course-free">没有课程</p>}
              </div>
            </section>
          );
        })}
      </div>
      {!schedule.courses.length && !schedule.events.length && (
        <div className="course-empty">
          <CalendarDays size={32} />
          <h2>把这学期放进来</h2>
          <p>
            先设置开学日期和周数，再导入 CSV、JSON 或日历
            ICS。支持单双周、指定教学周、停课日期与教室。
          </p>
          <button
            className="button"
            onClick={() =>
              void exportText('Dayweave-courses.csv', '\uFEFF' + csvTemplate, 'text/csv')
            }
          >
            <Download size={16} />
            下载 CSV 模板
          </button>
        </div>
      )}
      <div className="course-footer">
        <button
          className="button small"
          onClick={() =>
            void exportText('Dayweave-timetable.json', JSON.stringify(schedule, null, 2))
          }
        >
          导出课程表
        </button>
        <button
          className="button small"
          onClick={() =>
            void exportText('Dayweave-courses.csv', '\uFEFF' + csvTemplate, 'text/csv')
          }
        >
          CSV 模板
        </button>
        {isMobileApp && (
          <button
            className="button"
            onClick={async () => {
              try {
                const r = await requestWidget();
                setNotice(
                  r.requested ? '请在桌面确认添加课程小组件' : '请长按桌面 → 小组件 → 时织课程表',
                );
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            添加桌面小组件
          </button>
        )}
        <p>JSON 保留完整课表；ICS 按当前学期范围导入。可在设置中导入两个旧程序的 JSON 备份。</p>
      </div>
      {editor && (
        <CourseEditor
          key={editor === 'new' ? 'new' : editor.id}
          course={editor}
          close={() => setEditor(null)}
        />
      )}
      {semester && <SemesterEditor close={() => setSemester(false)} />}
      {preview && (
        <Modal title="预览导入课程" close={() => setPreview(null)}>
          <div className="course-form">
            <p>
              <b>{preview.summary}</b>
            </p>
            <p>
              {preview.schedule.semesterStart} 起 · {preview.schedule.totalWeeks} 周 ·{' '}
              {preview.schedule.timeZone}
            </p>
            {preview.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <ul>
              {[...preview.schedule.courses, ...preview.schedule.events].slice(0, 8).map((c) => (
                <li key={c.id}>
                  {c.name} · {c.location}
                </li>
              ))}
            </ul>
            <p className="field-hint">合并课程，相同编号按更新时间更新。</p>
            <footer>
              <button className="button" onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await store.transact((s) => ({
                      ...s,
                      schedule: mergeSchedule(s.schedule, preview.schedule),
                    }));
                    setNotice('课程已导入');
                    setPreview(null);
                  } catch (e) {
                    setError(errorText(e));
                    setPreview(null);
                  }
                }}
              >
                合并导入
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.name} close={() => setDetail(null)}>
          <div className="course-form">
            <p>
              {zoneDateKey(detail.start, schedule.timeZone)} ·{' '}
              {zoneClock(detail.start, schedule.timeZone)}–
              {zoneClock(detail.end, schedule.timeZone)}
            </p>
            <p>
              {detail.location} · {detail.teacher}
            </p>
            <footer>
              <button
                className="button danger"
                onClick={async () => {
                  try {
                    await store.transact((s) => ({
                      ...s,
                      schedule: {
                        ...s.schedule,
                        events: s.schedule.events.filter((e) => e.id !== detail.id),
                      },
                    }));
                    setDetail(null);
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                删除这节课
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
