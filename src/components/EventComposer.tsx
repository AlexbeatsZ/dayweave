import { useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { RecurrenceEditor } from './RecurrenceEditor';
import { ColorPicker } from './ColorPicker';
import { usePhone } from '../phone/usePhone';
import { store, useStore } from '../store';
import {
  calendarEventSchema,
  eventTemplateSchema,
  eventTypes,
  type CalendarEvent,
} from '../event-model';
import { newEvent, saveEvent, deleteEvent, configureRecurrence } from '../event-domain';
import { taskPrefix } from '../task-domain';
import { zoneDateKey } from '../timezone';

export function EventComposer({
  event,
  date,
  close,
}: {
  event?: CalendarEvent;
  date: string;
  close: () => void;
}) {
  const { data } = useStore();
  const phone = usePhone();
  const [draft, setDraft] = useState(
    () =>
      event ?? {
        ...newEvent({ title: '新日程', date, timeZone: data.schedule.timeZone }),
        title: '',
      },
  );
  const existingRule = event
    ? data.recurrences.find((row) => row.prefix === taskPrefix(event.id))
    : undefined;
  const [ruleBaseline] = useState(existingRule?.updatedAt);
  const [definitions, setDefinitions] = useState(
    existingRule?.enabled ? existingRule.definitions : [],
  );
  const [scope, setScope] = useState<'single' | 'future' | 'all'>('single');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const patch = (changes: Partial<CalendarEvent>) =>
    setDraft({ ...draft, ...changes, ...('periods' in changes ? { precision: undefined } : {}) });
  const repeated =
    !!event &&
    (existingRule ||
      data.calendarEvents.some(
        (row) => row.id !== event.id && taskPrefix(row.id) === taskPrefix(event.id),
      ));
  async function save(input: FormEvent) {
    input.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parsed = calendarEventSchema.parse({
        ...draft,
        periods: [...draft.periods].sort((a, b) => a[0].localeCompare(b[0])),
      });
      if (scope === 'all' && !confirmed) throw new Error('请确认批量更新包含各实例的独立修改');
      await store.transact((state) => {
        const current = state.recurrences.find((row) => row.prefix === taskPrefix(parsed.id));
        const ruleChanged =
          JSON.stringify(definitions) !==
          JSON.stringify(existingRule?.enabled ? existingRule.definitions : []);
        if (ruleChanged && current?.updatedAt !== ruleBaseline)
          throw new Error('系列规则已在其他位置修改，请重新打开');
        let next = saveEvent(state, parsed, event?.updatedAt, scope);
        if (ruleChanged) {
          if (definitions.length) next = configureRecurrence(next, parsed, 'event', definitions);
          else
            next = {
              ...next,
              recurrences: next.recurrences.map((row) =>
                row.prefix === taskPrefix(parsed.id)
                  ? { ...row, enabled: false, updatedAt: new Date().toISOString() }
                  : row,
              ),
            };
        }
        return next;
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={event ? '编辑日程' : '新建日程'} close={() => !busy && close()} sheet={phone}>
      <form className="event-form" onSubmit={save}>
        <label>
          标题
          <input
            aria-label="日程标题"
            autoFocus
            required
            maxLength={500}
            value={draft.title}
            onChange={(input) => patch({ title: input.target.value })}
          />
        </label>
        <div className="event-form-pair">
          <label>
            类型
            <select
              aria-label="日程类型"
              value={draft.type}
              onChange={(input) => patch({ type: input.target.value as CalendarEvent['type'] })}
            >
              {Object.entries(eventTypes).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            日期
            <input
              aria-label="日程日期"
              type="date"
              required
              value={draft.date}
              onChange={(input) => patch({ date: input.target.value })}
            />
          </label>
        </div>
        <label className="event-checkbox">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(input) =>
              patch({
                allDay: input.target.checked,
                periods: input.target.checked ? [] : [['09:00', '10:00']],
              })
            }
          />
          全天
        </label>
        <label>
          持续天数
          <input
            aria-label="持续天数"
            type="number"
            min={1}
            max={366}
            value={draft.durationDays}
            onChange={(input) => patch({ durationDays: Number(input.target.value) })}
          />
        </label>
        {!draft.allDay && (
          <fieldset>
            <legend>时间段</legend>
            {draft.periods.map(([start, end], index) => (
              <div className="event-period" key={index}>
                <input
                  aria-label={`开始时间 ${index + 1}`}
                  type="time"
                  required
                  value={start}
                  onChange={(input) =>
                    patch({
                      periods: draft.periods.map((period, i) =>
                        i === index ? [input.target.value, end] : period,
                      ),
                    })
                  }
                />
                <span>–</span>
                <input
                  aria-label={`结束时间 ${index + 1}`}
                  type="time"
                  required
                  value={end}
                  onChange={(input) =>
                    patch({
                      periods: draft.periods.map((period, i) =>
                        i === index ? [start, input.target.value] : period,
                      ),
                    })
                  }
                />
                {draft.periods.length > 1 && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => patch({ periods: draft.periods.filter((_, i) => i !== index) })}
                  >
                    移除
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="button"
              onClick={() => patch({ periods: [...draft.periods, ['10:00', '10:45']] })}
            >
              添加时间段
            </button>
          </fieldset>
        )}
        <label>
          地点
          <input
            aria-label="日程地点"
            maxLength={500}
            value={draft.location}
            onChange={(input) => patch({ location: input.target.value })}
          />
        </label>
        <label>
          教师 / 主持人
          <input
            value={draft.teacher}
            maxLength={300}
            onChange={(input) => patch({ teacher: input.target.value })}
          />
        </label>
        <label>
          时区
          <input
            aria-label="日程时区"
            required
            value={draft.timeZone}
            onChange={(input) => patch({ timeZone: input.target.value })}
          />
        </label>
        <label>
          备注
          <textarea
            aria-label="日程备注"
            value={draft.notes}
            onChange={(input) => patch({ notes: input.target.value })}
          />
        </label>
        <ColorPicker
          label="顶部标记颜色"
          value={draft.color}
          onChange={(color) => patch({ color })}
        />
        {repeated && (
          <label>
            修改范围
            <select
              aria-label="日程修改范围"
              value={scope}
              onChange={(input) => {
                setScope(input.target.value as typeof scope);
                setConfirmed(false);
              }}
            >
              <option value="single">仅本次日程</option>
              <option value="future">本次和系列的后续生成模板</option>
              <option value="all">关联系列全部已生成实例及模板</option>
            </select>
          </label>
        )}
        {scope === 'all' && (
          <label className="event-checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(input) => setConfirmed(input.target.checked)}
            />
            确认将本次更改的属性应用到关联实例，包含独立修改
          </label>
        )}
        <details>
          <summary>重复规则与例外</summary>
          <RecurrenceEditor
            value={definitions}
            onChange={setDefinitions}
            date={draft.date || zoneDateKey()}
            timeZone={draft.timeZone}
            eventTemplate={eventTemplateSchema.strip().safeParse(draft).data}
          />
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {event && (
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (scope === 'all' && !confirmed) {
                  setError('请先确认批量修改范围');
                  return;
                }
                try {
                  await store.transact((state) =>
                    deleteEvent(state, event.id, scope === 'all', event.updatedAt),
                  );
                  close();
                } catch (cause) {
                  setError(String(cause));
                }
              }}
            >
              {scope === 'all' ? '删除关联系列' : '删除本次'}
            </button>
          )}
          <button type="button" className="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存
          </button>
        </footer>
      </form>
    </Modal>
  );
}
