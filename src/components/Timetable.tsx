import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Plus,
  Minus,
  Clock3,
  Settings2,
  Trash2,
  Globe,
  LayoutGrid,
} from 'lucide-react';
import { store, useStore } from '../store';
import {
  courseOccurrences,
  semesterWeek,
  courseSchema,
  occurrenceSchema,
  scheduleSchema,
  parseWeeks,
  mergeSchedule,
  type Course,
  type CoursePeriod,
  type Occurrence,
} from '../schedule';
import {
  zoneDateKey,
  zoneClock,
  shiftDay,
  dayStart,
  wallTime,
  deviceZone,
  zoneLabel,
  timeZones,
} from '../timezone';
import { importCourses, csvTemplate, type ImportPreview } from '../course-import';
import { importFudanCourses } from '../fudan-import';
import { pickText, exportText, isMobileApp, requestWidget } from '../files';
import { Modal } from './Modal';
import { ColorPicker } from './ColorPicker';
import { FloatingAdd } from '../phone/Navigation';
import { usePhone } from '../phone/usePhone';
import './Timetable.css';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const clockOf = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const sectionNames = { morning: '上午', afternoon: '下午', evening: '晚上' };
const sections = ['morning', 'afternoon', 'evening'] as const;
type Slot = { weekday: number; start: string; end: string };
type CourseTarget = { course?: Course; event?: Occurrence; initial?: Slot };
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
function CourseEditor({ target, close }: { target: CourseTarget; close: () => void }) {
  const { data } = useStore(),
    phone = usePhone();
  const old = target.course,
    event = target.event;
  const [timeZone] = useState(data.schedule.timeZone);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [color, setColor] = useState(old?.color ?? event?.color ?? '#5274a3');
  const [weeks, setWeeks] = useState(old?.weeks.join(',') ?? `1-${data.schedule.totalWeeks}`);
  const selectedWeeks = useMemo(() => {
    if (!weeks.trim()) return [];
    try {
      return parseWeeks(weeks, data.schedule.totalWeeks);
    } catch {
      return [];
    }
  }, [weeks, data.schedule.totalWeeks]);
  const allWeeks = Array.from({ length: data.schedule.totalWeeks }, (_, index) => index + 1);
  const sameVersion = (state: typeof data) => {
    if (state.schedule.timeZone !== timeZone) throw new Error('课程时区已改变，请重新打开。');
    if (
      old &&
      state.schedule.courses.find((item) => item.id === old.id)?.updatedAt !== old.updatedAt
    )
      throw new Error('课程已在其他位置修改，请重新打开。');
    if (
      event &&
      state.schedule.events.find((item) => item.id === event.id)?.updatedAt !== event.updatedAt
    )
      throw new Error('课程已在其他位置修改，请重新打开。');
  };
  async function save(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(submit.currentTarget),
      text = (key: string) => String(form.get(key) ?? '');
    try {
      await store.transact((state) => {
        sameVersion(state);
        const common = {
          name: text('name'),
          location: text('location'),
          teacher: text('teacher'),
          color,
          updatedAt: Math.max(Date.now(), (old?.updatedAt ?? event?.updatedAt ?? 0) + 1),
        };
        if (event) {
          const eventTime = (dateField: string, timeField: string, previous: number) =>
            text(dateField) === zoneDateKey(previous, timeZone) &&
            text(timeField) === zoneClock(previous, timeZone)
              ? previous
              : wallTime(text(dateField), text(timeField), timeZone);
          const item = occurrenceSchema.parse({
            ...event,
            ...common,
            start: eventTime('startDate', 'start', event.start),
            end: eventTime('endDate', 'end', event.end),
            timeZone: state.schedule.timeZone,
          });
          return {
            ...state,
            schedule: scheduleSchema.parse({
              ...state.schedule,
              events: state.schedule.events.map((row) => (row.id === item.id ? item : row)),
            }),
          };
        }
        if (!weeks.trim()) throw new Error('请至少选择一个教学周。');
        const item = courseSchema.parse({
          ...common,
          id: old?.id ?? crypto.randomUUID(),
          weekday: Number(text('weekday')),
          start: text('start'),
          end: text('end'),
          weeks: parseWeeks(weeks, state.schedule.totalWeeks),
          excludedDates: text('excludedDates')
            .split(/[\s,，]+/)
            .filter(Boolean),
        });
        return {
          ...state,
          schedule: scheduleSchema.parse({
            ...state.schedule,
            courses: old
              ? state.schedule.courses.map((row) => (row.id === item.id ? item : row))
              : [...state.schedule.courses, item],
          }),
        };
      });
      close();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await store.transact((state) => {
        sameVersion(state);
        return {
          ...state,
          schedule: {
            ...state.schedule,
            courses: old
              ? state.schedule.courses.filter((row) => row.id !== old.id)
              : state.schedule.courses,
            events: event
              ? state.schedule.events.filter((row) => row.id !== event.id)
              : state.schedule.events,
          },
        };
      });
      close();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={old || event ? '编辑课程' : '添加课程'} close={close} sheet={phone}>
      <form onSubmit={save} className="course-form timetable-form">
        <label>
          课程名称
          <input
            required
            autoFocus
            name="name"
            aria-label="课程名称"
            maxLength={300}
            placeholder="课程名"
            defaultValue={old?.name ?? event?.name}
          />
        </label>
        <div className="form-pair">
          <label>
            教室 / 地点
            <input
              name="location"
              aria-label="教室 / 地点"
              defaultValue={old?.location ?? event?.location}
            />
          </label>
          <label>
            教师
            <input name="teacher" aria-label="教师" defaultValue={old?.teacher ?? event?.teacher} />
          </label>
        </div>
        {event ? (
          <div className="form-pair">
            <label>
              开始日期
              <input
                name="startDate"
                type="date"
                required
                defaultValue={zoneDateKey(event.start, data.schedule.timeZone)}
              />
            </label>
            <label>
              结束日期
              <input
                name="endDate"
                type="date"
                required
                defaultValue={zoneDateKey(event.end, data.schedule.timeZone)}
              />
            </label>
          </div>
        ) : (
          <label>
            星期
            <select
              name="weekday"
              aria-label="上课星期"
              defaultValue={old?.weekday ?? target.initial?.weekday ?? 1}
            >
              {weekdays.map((day, index) => (
                <option key={day} value={index + 1}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-pair">
          <label>
            上课时间
            <input
              required
              name="start"
              type="time"
              aria-label="上课时间"
              defaultValue={
                old?.start ??
                (event
                  ? zoneClock(event.start, data.schedule.timeZone)
                  : (target.initial?.start ?? data.schedule.periods[0].start))
              }
            />
          </label>
          <label>
            下课时间
            <input
              required
              name="end"
              type="time"
              aria-label="下课时间"
              defaultValue={
                old?.end ??
                (event
                  ? zoneClock(event.end, data.schedule.timeZone)
                  : (target.initial?.end ?? data.schedule.periods[0].end))
              }
            />
          </label>
        </div>
        <p className="field-hint">上课时间按 {zoneLabel(data.schedule.timeZone)} 计算。</p>
        {!event && (
          <>
            <fieldset className="course-weeks">
              <legend>上课周数</legend>
              <div className="week-preset-buttons">
                {[
                  { label: '单周', values: allWeeks.filter((value) => value % 2 === 1) },
                  { label: '双周', values: allWeeks.filter((value) => value % 2 === 0) },
                  { label: '全选', values: allWeeks },
                ].map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    aria-pressed={
                      item.values.length > 0 && selectedWeeks.join(',') === item.values.join(',')
                    }
                    onClick={() => setWeeks(item.values.join(','))}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="course-week-choices">
                {allWeeks.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`第 ${value} 教学周`}
                    aria-pressed={selectedWeeks.includes(value)}
                    onClick={() =>
                      setWeeks(
                        selectedWeeks.includes(value)
                          ? selectedWeeks.filter((week) => week !== value).join(',')
                          : [...selectedWeeks, value].sort((a, b) => a - b).join(','),
                      )
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              教学周
              <input
                name="weeks"
                aria-label="教学周"
                placeholder="1-16 或 1-15单 或 1,3,5"
                value={weeks}
                onChange={(change) => setWeeks(change.target.value)}
              />
            </label>
            <details className="course-advanced">
              <summary>停课日期</summary>
              <input
                name="excludedDates"
                aria-label="停课日期"
                placeholder="2026-10-01,2026-10-02"
                defaultValue={old?.excludedDates.join(',')}
              />
            </details>
          </>
        )}
        <fieldset className="course-color-field">
          <legend>课程颜色</legend>
          <ColorPicker value={color} onChange={setColor} label="课程颜色" />
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          {(old || event) && (
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void remove()}
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
    phone = usePhone();
  const [initial] = useState(() => ({
    semesterStart: data.schedule.semesterStart,
    totalWeeks: data.schedule.totalWeeks,
    timeZone: data.schedule.timeZone,
    holidays: data.schedule.holidays,
  }));
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="学期与时区" close={close} sheet={phone}>
      <form
        className="course-form timetable-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          const form = new FormData(event.currentTarget);
          try {
            await store.transact((state) => {
              const current = {
                semesterStart: state.schedule.semesterStart,
                totalWeeks: state.schedule.totalWeeks,
                timeZone: state.schedule.timeZone,
                holidays: state.schedule.holidays,
              };
              if (JSON.stringify(initial) !== JSON.stringify(current))
                throw new Error('学期设置已在其他位置修改，请重新打开。');
              return {
                ...state,
                schedule: scheduleSchema.parse({
                  ...state.schedule,
                  semesterStart: String(form.get('start')),
                  totalWeeks: Number(form.get('weeks')),
                  timeZone: String(form.get('zone')),
                  holidays: String(form.get('holidays'))
                    .split(/[\s,，]+/)
                    .filter(Boolean),
                }),
              };
            });
            close();
          } catch (cause) {
            setError(errorText(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          第一周的周一
          <input
            name="start"
            aria-label="第一周的周一"
            type="date"
            required
            defaultValue={initial.semesterStart}
          />
        </label>
        <label>
          学期周数
          <input
            name="weeks"
            aria-label="学期周数"
            type="number"
            min={1}
            max={60}
            defaultValue={initial.totalWeeks}
          />
        </label>
        <label>
          课程时区
          <input
            name="zone"
            aria-label="课程时区"
            list="course-timezones"
            required
            defaultValue={initial.timeZone}
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
          周课程按这个时区上课。设备时区不改变上课时刻，已导入日历课程保留真实时刻。
        </p>
        <label>
          全校停课日期
          <textarea
            name="holidays"
            rows={3}
            placeholder="2026-10-01,2026-10-02"
            defaultValue={initial.holidays.join(',')}
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <button className="button primary" type="submit" disabled={busy}>
            保存学期
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function PeriodEditor({ close }: { close: () => void }) {
  const { data } = useStore(),
    phone = usePhone();
  const [initial] = useState(() => JSON.stringify(data.schedule.periods));
  const [periods, setPeriods] = useState<CoursePeriod[]>(() =>
    structuredClone(data.schedule.periods),
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  function add(section: CoursePeriod['section']) {
    const group = periods.filter((period) => period.section === section);
    const start = group.length
      ? Math.min(23 * 60, minuteOf(group.at(-1)!.end) + 10)
      : section === 'morning'
        ? 8 * 60
        : section === 'afternoon'
          ? 13 * 60 + 30
          : 18 * 60 + 30;
    const next = { section, start: clockOf(start), end: clockOf(Math.min(1439, start + 45)) };
    setPeriods(
      sections.flatMap((part) => [
        ...periods.filter((period) => period.section === part),
        ...(part === section ? [next] : []),
      ]),
    );
  }
  return (
    <Modal title="节次设置" close={close} sheet={phone}>
      <form
        className="course-form timetable-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            await store.transact((state) => {
              if (JSON.stringify(state.schedule.periods) !== initial)
                throw new Error('节次已在其他位置修改，请重新打开。');
              return { ...state, schedule: scheduleSchema.parse({ ...state.schedule, periods }) };
            });
            close();
          } catch (cause) {
            setError(errorText(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="field-hint">设置各段节数与时间。已有课程保留自己的上课、下课时间。</p>
        {sections.map((section) => (
          <fieldset className="period-section" key={section}>
            <legend>{sectionNames[section]}</legend>
            <div className="period-count">
              <span>{periods.filter((period) => period.section === section).length} 节</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`减少${sectionNames[section]}节次`}
                disabled={
                  !periods.some((period) => period.section === section) || periods.length <= 1
                }
                onClick={() => {
                  const last = periods.map((period) => period.section).lastIndexOf(section);
                  setPeriods(periods.filter((_, index) => index !== last));
                }}
              >
                <Minus size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`增加${sectionNames[section]}节次`}
                disabled={periods.length >= 30}
                onClick={() => add(section)}
              >
                <Plus size={18} />
              </button>
            </div>
            {periods.map((period, index) =>
              period.section !== section ? null : (
                <div className="period-time-row" key={index}>
                  <strong>{index + 1}</strong>
                  <label>
                    <span>上课</span>
                    <input
                      required
                      type="time"
                      aria-label={`第 ${index + 1} 节上课时间`}
                      value={period.start}
                      onChange={(event) =>
                        setPeriods(
                          periods.map((row, i) =>
                            i === index ? { ...row, start: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <span>—</span>
                  <label>
                    <span>下课</span>
                    <input
                      required
                      type="time"
                      aria-label={`第 ${index + 1} 节下课时间`}
                      value={period.end}
                      onChange={(event) =>
                        setPeriods(
                          periods.map((row, i) =>
                            i === index ? { ...row, end: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ),
            )}
          </fieldset>
        ))}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <button className="button primary" type="submit" disabled={busy}>
            保存节次
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** Place simultaneous courses beside each other while preserving their true time coordinates. */
function layoutCourses(items: Occurrence[], start: number, end: number) {
  const placed: Array<{
    item: Occurrence;
    start: number;
    end: number;
    lane: number;
    lanes: number;
  }> = [];
  let cluster: typeof placed = [],
    clusterEnd = -Infinity;
  const finish = () => {
    const lanes = Math.max(1, ...cluster.map((row) => row.lane + 1));
    cluster.forEach((row) => (row.lanes = lanes));
    cluster = [];
  };
  for (const item of items
    .filter((item) => item.start < end && item.end > start)
    .sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (item.start >= clusterEnd) finish();
    let lane = 0;
    while (cluster.some((row) => row.lane === lane && row.end > item.start)) lane++;
    const row = {
      item,
      start: Math.max(item.start, start),
      end: Math.min(item.end, end),
      lane,
      lanes: 1,
    };
    cluster.push(row);
    placed.push(row);
    clusterEnd = Math.max(cluster.length === 1 ? -Infinity : clusterEnd, item.end);
  }
  finish();
  return placed;
}

export function Timetable({ clock }: { clock: number }) {
  const { data } = useStore(),
    phone = usePhone(),
    schedule = data.schedule;
  const today = zoneDateKey(clock, schedule.timeZone),
    current = semesterWeek(schedule, today);
  const [week, setWeek] = useState(Math.min(schedule.totalWeeks, Math.max(1, current)));
  const [editor, setEditor] = useState<CourseTarget | null>(null),
    [menu, setMenu] = useState(false),
    [semester, setSemester] = useState(false),
    [periodSettings, setPeriodSettings] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null),
    [selected, setSelected] = useState<Slot | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setWeek((value) => Math.min(schedule.totalWeeks, Math.max(1, value)));
    setSelected(null);
  }, [schedule.semesterStart, schedule.totalWeeks, schedule.timeZone]);
  const start = shiftDay(schedule.semesterStart, (week - 1) * 7),
    days = Array.from({ length: 7 }, (_, index) => shiftDay(start, index));
  const items = useMemo(
    () =>
      courseOccurrences(
        schedule,
        dayStart(start, schedule.timeZone),
        dayStart(shiftDay(start, 7), schedule.timeZone),
      ),
    [schedule, start],
  );
  const bounds = useMemo(() => {
    let from = minuteOf(schedule.periods[0].start),
      until = minuteOf(schedule.periods.at(-1)!.end);
    for (const day of days) {
      const begin = dayStart(day, schedule.timeZone),
        finish = dayStart(shiftDay(day, 1), schedule.timeZone);
      for (const item of items.filter((item) => item.start < finish && item.end > begin)) {
        from = Math.min(
          from,
          item.start < begin ? 0 : minuteOf(zoneClock(item.start, schedule.timeZone)),
        );
        until = Math.max(
          until,
          item.end >= finish ? 1440 : minuteOf(zoneClock(item.end, schedule.timeZone)),
        );
      }
    }
    return { from, until };
  }, [schedule.periods, items, start, schedule.timeZone]);
  const height = (bounds.until - bounds.from) * 1.35,
    position = (minute: number) => (minute - bounds.from) * 1.35;
  const css = { '--timetable-height': `${height}px` } as CSSProperties;
  function choose(slot: Slot) {
    if (
      selected?.weekday === slot.weekday &&
      selected.start === slot.start &&
      selected.end === slot.end
    ) {
      setEditor({ initial: slot });
      setSelected(null);
    } else setSelected(slot);
  }
  function blank(event: MouseEvent<HTMLDivElement>, dayIndex: number) {
    if (event.target !== event.currentTarget) return;
    const minute = Math.max(
      bounds.from,
      Math.min(
        1434,
        Math.floor(
          (bounds.from + (event.clientY - event.currentTarget.getBoundingClientRect().top) / 1.35) /
            5,
        ) * 5,
      ),
    );
    choose({
      weekday: dayIndex + 1,
      start: clockOf(minute),
      end: clockOf(Math.min(1439, minute + 45)),
    });
  }
  async function receive(website = false) {
    if (busy) return;
    setMenu(false);
    setError('');
    setBusy(true);
    try {
      if (website) {
        const result = await importFudanCourses(store.get().schedule);
        if (result) setPreview(result);
      } else {
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
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function exportSchedule(template = false) {
    try {
      await exportText(
        template ? 'Dayweave-courses.csv' : 'Dayweave-timetable.json',
        template ? '\uFEFF' + csvTemplate : JSON.stringify(schedule, null, 2),
        template ? 'text/csv' : 'application/json',
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <div className="timetable-view timetable-grid-view">
      <div className="timetable-week-nav">
        <button
          className="icon-button"
          aria-label="上一周"
          disabled={week <= 1}
          onClick={() => {
            setWeek(week - 1);
            setSelected(null);
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="timetable-current-week"
          aria-label="回到本周"
          onClick={() => {
            setWeek(Math.min(schedule.totalWeeks, Math.max(1, current)));
            setSelected(null);
          }}
        >
          <strong>第 {week} 周</strong>
          <small>
            {start.slice(5).replace('-', '/')} — {days[6].slice(5).replace('-', '/')}
          </small>
        </button>
        <button
          className="icon-button"
          aria-label="下一周"
          disabled={week >= schedule.totalWeeks}
          onClick={() => {
            setWeek(week + 1);
            setSelected(null);
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="timetable-notice">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status" className="timetable-notice">
          正在读取课程…
        </p>
      )}
      <div
        className="timetable-scroll"
        data-no-swipe
        role="region"
        aria-label="每周课程表"
        tabIndex={0}
      >
        <div className="timetable-matrix" style={css}>
          <div className="timetable-corner" aria-hidden>
            节次
          </div>
          {days.map((day, index) => (
            <header
              className={`timetable-day-heading ${day === today ? 'is-today' : ''}`}
              key={day}
            >
              <strong>{weekdays[index]}</strong>
              <span>{day.slice(5).replace('-', '/')}</span>
            </header>
          ))}
          <div className="timetable-ruler">
            {schedule.periods.map((period, index) => (
              <button
                key={index}
                className="timetable-period"
                aria-label={`第 ${index + 1} 节，打开节次设置`}
                style={{
                  top: position(minuteOf(period.start)),
                  height: (minuteOf(period.end) - minuteOf(period.start)) * 1.35,
                }}
                onClick={() => setPeriodSettings(true)}
              >
                <strong>{index + 1}</strong>
                <span>{period.start}</span>
                <span>{period.end}</span>
              </button>
            ))}
          </div>
          {days.map((day, index) => {
            const begin = dayStart(day, schedule.timeZone),
              finish = dayStart(shiftDay(day, 1), schedule.timeZone);
            const courses = layoutCourses(items, begin, finish);
            return (
              <div
                key={day}
                className={`timetable-day-column ${day === today ? 'is-today' : ''}`}
                onClick={(event) => blank(event, index)}
              >
                {schedule.periods.map((period, periodIndex) => {
                  const slot = { weekday: index + 1, start: period.start, end: period.end },
                    active =
                      selected?.weekday === slot.weekday &&
                      selected.start === slot.start &&
                      selected.end === slot.end;
                  return (
                    <button
                      key={periodIndex}
                      className={`timetable-empty-slot ${active ? 'is-selected' : ''}`}
                      data-weekday={index + 1}
                      data-period={periodIndex + 1}
                      aria-label={`${weekdays[index]}第 ${periodIndex + 1} 节，${period.start} 至 ${period.end}${active ? '，添加课程' : ''}`}
                      aria-pressed={active}
                      style={{
                        top: position(minuteOf(period.start)),
                        height: (minuteOf(period.end) - minuteOf(period.start)) * 1.35,
                      }}
                      onClick={() => choose(slot)}
                    >
                      {active && <Plus size={23} />}
                    </button>
                  );
                })}
                {selected?.weekday === index + 1 &&
                  !schedule.periods.some(
                    (period) => period.start === selected.start && period.end === selected.end,
                  ) && (
                    <button
                      className="timetable-empty-slot is-selected"
                      aria-label="添加选中时间的课程"
                      style={{
                        top: position(minuteOf(selected.start)),
                        height: (minuteOf(selected.end) - minuteOf(selected.start)) * 1.35,
                      }}
                      onClick={() => choose(selected)}
                    >
                      <Plus size={23} />
                    </button>
                  )}
                {courses.map(({ item, lane, lanes }) => {
                  const from =
                      item.start < begin ? 0 : minuteOf(zoneClock(item.start, schedule.timeZone)),
                    until =
                      item.end >= finish ? 1440 : minuteOf(zoneClock(item.end, schedule.timeZone));
                  return (
                    <button
                      key={item.id}
                      className={`timetable-course ${item.start <= clock && item.end > clock ? 'class-now' : ''}`}
                      aria-label={`编辑课程 ${item.name}`}
                      style={
                        {
                          '--course-color': item.color,
                          top: position(from) + 2,
                          height: Math.max(24, (until - from) * 1.35 - 4),
                          left: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                        } as CSSProperties
                      }
                      onClick={() => {
                        const course = schedule.courses.find(
                          (course) => course.id === item.courseId,
                        );
                        const event = schedule.events.find((event) => event.id === item.id);
                        if (course || event) setEditor({ course, event });
                        setSelected(null);
                      }}
                    >
                      <strong>{item.name}</strong>
                      {item.location && (
                        <span className="timetable-course-location">{item.location}</span>
                      )}
                      <time>
                        {zoneClock(item.start, schedule.timeZone)}–
                        {zoneClock(item.end, schedule.timeZone)}
                      </time>
                      {item.teacher && <small>{item.teacher}</small>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <FloatingAdd
        label="课程操作"
        disabled={busy}
        onClick={() => {
          setError('');
          setMenu(true);
        }}
      />
      {menu && (
        <Modal title="课程操作" close={() => setMenu(false)} sheet={phone}>
          <div className="timetable-action-menu">
            <button onClick={() => void receive(true)}>
              <Globe size={21} />
              <span>
                网站导入<small>登录复旦教务系统，确认后读取课表</small>
              </span>
            </button>
            <button onClick={() => void receive()}>
              <Upload size={21} />
              <span>
                文件导入<small>CSV、JSON 或 ICS 日历</small>
              </span>
            </button>
            <button
              onClick={() => {
                setMenu(false);
                setEditor({});
              }}
            >
              <Plus size={21} />
              <span>手动添加课程</span>
            </button>
            <details>
              <summary>更多</summary>
              <button
                onClick={() => {
                  setMenu(false);
                  setSemester(true);
                }}
              >
                <Settings2 size={19} />
                <span>学期与时区</span>
              </button>
              <button
                onClick={() => {
                  setMenu(false);
                  setPeriodSettings(true);
                }}
              >
                <LayoutGrid size={19} />
                <span>节次设置</span>
              </button>
              <button onClick={() => void exportSchedule(true)}>
                <Download size={19} />
                <span>CSV 模板</span>
              </button>
              <button onClick={() => void exportSchedule()}>
                <Download size={19} />
                <span>导出课程表</span>
              </button>
              {isMobileApp && (
                <button
                  onClick={async () => {
                    setMenu(false);
                    try {
                      const result = await requestWidget();
                      setNotice(
                        result.requested
                          ? '已请求添加；若桌面未提示，请从小组件 → 安卓小部件中选择时织'
                          : '请从桌面的小组件 → 安卓小部件中选择时织',
                      );
                    } catch (cause) {
                      setError(errorText(cause));
                    }
                  }}
                >
                  <CalendarDays size={19} />
                  <span>添加桌面小组件</span>
                </button>
              )}
            </details>
          </div>
        </Modal>
      )}
      {editor && (
        <CourseEditor
          key={
            editor.course?.id ??
            editor.event?.id ??
            `${editor.initial?.weekday}:${editor.initial?.start}`
          }
          target={editor}
          close={() => setEditor(null)}
        />
      )}
      {semester && <SemesterEditor close={() => setSemester(false)} />}
      {periodSettings && <PeriodEditor close={() => setPeriodSettings(false)} />}
      {preview && (
        <Modal title="预览导入课程" close={() => setPreview(null)} sheet={phone}>
          <div className="course-form timetable-form">
            <p>
              <b>{preview.summary}</b>
            </p>
            <p>
              {preview.schedule.semesterStart} 起 · {preview.schedule.totalWeeks} 周 ·{' '}
              {preview.schedule.timeZone}
            </p>
            {preview.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <ul>
              {[...preview.schedule.courses, ...preview.schedule.events].slice(0, 8).map((item) => (
                <li key={item.id}>
                  {item.name} · {item.location}
                </li>
              ))}
            </ul>
            <p className="field-hint">合并课程，相同编号按更新时间更新。</p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <footer>
              <button className="button" disabled={busy} onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError('');
                  try {
                    await store.transact((state) => ({
                      ...state,
                      schedule: mergeSchedule(state.schedule, preview.schedule),
                    }));
                    setNotice('课程已导入');
                    setPreview(null);
                    setWeek(1);
                  } catch (cause) {
                    setError(errorText(cause));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                合并导入
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
