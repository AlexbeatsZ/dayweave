import type { EventTemplate, RecurrenceDefinition } from '../event-model';

export function RecurrenceEditor({
  value,
  onChange,
  date,
  timeZone,
  eventTemplate,
}: {
  value: RecurrenceDefinition[];
  onChange: (value: RecurrenceDefinition[]) => void;
  date: string;
  timeZone: string;
  eventTemplate?: EventTemplate;
}) {
  const patch = (index: number, changes: Partial<RecurrenceDefinition>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  return (
    <fieldset className="recurrence-editor">
      <legend>重复与例外</legend>
      <select
        aria-label="重复频率"
        value={value.length ? 'repeat' : ''}
        onChange={(event) =>
          onChange(
            event.target.value
              ? [
                  {
                    dtstart:
                      eventTemplate && !eventTemplate.allDay
                        ? `${date}T${eventTemplate.periods[0][0]}`
                        : date,
                    rrule: 'FREQ=WEEKLY',
                    rdate: [],
                    exdate: [],
                    timeZone,
                  },
                ]
              : [],
          )
        }
      >
        <option value="">不自动重复</option>
        <option value="repeat">RRULE 重复</option>
      </select>
      {value.map((row, index) => (
        <div className="recurrence-definition" key={index}>
          <label>
            首次发生
            <input
              aria-label={`首次发生 ${index + 1}`}
              type={row.dtstart.includes('T') ? 'datetime-local' : 'date'}
              value={row.dtstart}
              onChange={(event) => patch(index, { dtstart: event.target.value })}
            />
          </label>
          <label>
            规则
            <select
              aria-label={`重复预设 ${index + 1}`}
              value={
                [
                  'FREQ=DAILY',
                  'FREQ=WEEKLY',
                  'FREQ=WEEKLY;INTERVAL=2',
                  'FREQ=MONTHLY',
                  'FREQ=YEARLY',
                ].includes(row.rrule ?? '')
                  ? row.rrule!
                  : 'custom'
              }
              onChange={(event) =>
                event.target.value !== 'custom' && patch(index, { rrule: event.target.value })
              }
            >
              <option value="FREQ=DAILY">每天</option>
              <option value="FREQ=WEEKLY">每周</option>
              <option value="FREQ=WEEKLY;INTERVAL=2">每两周</option>
              <option value="FREQ=MONTHLY">每月</option>
              <option value="FREQ=YEARLY">每年</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            RRULE
            <input
              aria-label={`RRULE ${index + 1}`}
              value={row.rrule ?? ''}
              onChange={(event) => patch(index, { rrule: event.target.value || null })}
              placeholder="FREQ=WEEKLY;INTERVAL=2;COUNT=8"
            />
          </label>
          <label>
            时区
            <input
              aria-label={`重复时区 ${index + 1}`}
              value={row.timeZone}
              onChange={(event) => patch(index, { timeZone: event.target.value })}
            />
          </label>
          <label>
            额外日期
            <textarea
              aria-label={`额外日期 ${index + 1}`}
              value={row.rdate.join(', ')}
              onChange={(event) =>
                patch(index, {
                  rdate: event.target.value
                    .split(/[,，\n]/)
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
              placeholder={row.dtstart}
            />
          </label>
          <label>
            排除日期
            <textarea
              aria-label={`排除日期 ${index + 1}`}
              value={row.exdate.join(', ')}
              onChange={(event) =>
                patch(index, {
                  exdate: event.target.value
                    .split(/[,，\n]/)
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
              placeholder={row.dtstart}
            />
          </label>
          {eventTemplate && (
            <label>
              此规则的时间段
              <input
                aria-label={`规则时间段 ${index + 1}`}
                value={(row.eventTemplate ?? eventTemplate).periods
                  .map((period) => period.join('–'))
                  .join(', ')}
                onChange={(event) =>
                  patch(index, {
                    eventTemplate: {
                      ...(row.eventTemplate ?? eventTemplate),
                      periods: event.target.value
                        .split(/[,，]/)
                        .map((part) => part.trim().split(/[–-]/) as [string, string]),
                    },
                  })
                }
              />
            </label>
          )}
          {value.length > 1 && (
            <button
              type="button"
              className="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              移除此规则
            </button>
          )}
        </div>
      ))}
      {value.length > 0 && (
        <>
          <p className="field-hint">
            单双教学周从首次上课日期起每两周发生。可用 COUNT 限定次数或 UNTIL
            限定截止日期。规则变更保留已生成实例及独立修改。
          </p>
          <button
            type="button"
            className="button"
            onClick={() =>
              onChange([
                ...value,
                {
                  dtstart: date,
                  rrule: 'FREQ=WEEKLY',
                  rdate: [],
                  exdate: [],
                  timeZone,
                  ...(eventTemplate ? { eventTemplate } : {}),
                },
              ])
            }
          >
            添加关联规则
          </button>
        </>
      )}
    </fieldset>
  );
}
