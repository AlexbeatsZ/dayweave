import { useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Plus, Minus, Clock3 } from 'lucide-react';
import { store, useStore } from '../store';
import { scheduleSchema, type CoursePeriod } from '../schedule';
import { calendarOccurrences } from '../event-domain';
import { zoneDateKey, zoneClock, deviceZone, zoneLabel, timeZones } from '../timezone';
import { Modal } from './Modal';
import { usePhone } from '../phone/usePhone';
import './Timetable.css';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const clockOf = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const sectionNames = { morning: '上午', afternoon: '下午', evening: '晚上' };
const sections = ['morning', 'afternoon', 'evening'] as const;
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
  const occurrences = useMemo(
    () => calendarOccurrences(data.calendarEvents),
    [data.calendarEvents],
  );
  const current = occurrences.filter((e) => e.start <= clock && e.end > clock),
    next = occurrences.find((e) => e.start > clock) ?? null;
  const item = current[0] ?? next;
  if (!item)
    return (
      <section className={`next-class ${compact ? 'compact' : ''}`}>
        <CalendarDays size={22} />
        <div>
          <span className="eyebrow">日程 · {data.schedule.timeZone}</span>
          <h3>接下来没有日程</h3>
          <p>添加日程或导入课程，就能在这里查看。</p>
        </div>
        {onOpen && (
          <button className="button" onClick={onOpen}>
            打开日程
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
        <span>{active ? '进行中' : '下一项日程'}</span>
        <strong>{remaining}</strong>
        <small>{active ? '后结束' : '后开始'}</small>
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
            下一项：{next.name} · {zoneClock(next.start, data.schedule.timeZone)}
          </small>
        )}
      </div>
      {onOpen && (
        <button className="icon-button" aria-label="打开日程" onClick={onOpen}>
          <ChevronRight size={20} />
        </button>
      )}
    </section>
  );
}
export function SemesterEditor({ close }: { close: () => void }) {
  const { data } = useStore(),
    phone = usePhone();
  const [initial] = useState(() => ({
    semesterStart: data.schedule.semesterStart,
    totalWeeks: data.schedule.totalWeeks,
    timeZone: data.schedule.timeZone,
    displayDays: data.schedule.displayDays,
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
                displayDays: state.schedule.displayDays,
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
                  displayDays:
                    form.get('displayDays') === 'auto' ? 'auto' : Number(form.get('displayDays')),
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
          课表显示天数
          <select name="displayDays" aria-label="课表显示天数" defaultValue={initial.displayDays}>
            <option value="auto">自动：无周末课程时显示 5 天</option>
            <option value="5">固定 5 天（周一至周五）</option>
            <option value="7">固定 7 天（周一至周日）</option>
          </select>
        </label>
        <p className="field-hint">
          自动检查整个学期的周末安排。固定天数只改变课表显示，不删除课程。
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

export function PeriodEditor({ close }: { close: () => void }) {
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
