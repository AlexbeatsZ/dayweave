import Workspace, { type TimePage } from '../timelog/Workspace';
import '../timelog/scoped.css';
import { store, useStore } from '../store';
import { finishTimer, duration, liveSpans, formatDuration } from '../timelog/domain';
import { useState } from 'react';
export function TimeLog({
  page,
  onPageChange,
  initialDate,
  filter,
}: {
  page: TimePage;
  onPageChange: (page: TimePage) => void;
  initialDate?: string;
  filter?: { activityId?: string; tag?: string };
}) {
  const { data } = useStore();
  const [error, setError] = useState('');
  return (
    <div className="timelog-module">
      {!!data.timelog.conflictedTimers?.length && (
        <section className="sync-conflicts">
          <h3>离线期间出现了同时计时</h3>
          <p>每一条都已保留，请检查后分别结束。</p>
          {data.timelog.conflictedTimers.map((timer) => (
            <div className="sync-peer" key={timer.id}>
              <span>
                {timer.note || data.timelog.activities.find((a) => a.id === timer.activityId)?.name}{' '}
                · {formatDuration(duration(liveSpans(timer, Date.now())))}
              </span>
              <button
                className="button"
                onClick={() =>
                  void store
                    .transact((state) => {
                      const current = state.timelog.conflictedTimers?.find(
                        (t) => t.id === timer.id,
                      );
                      if (!current) return state;
                      const ended = finishTimer(
                        { ...state.timelog, timer: current, conflictedTimers: [] },
                        Date.now(),
                      );
                      return {
                        ...state,
                        timelog: {
                          ...state.timelog,
                          records: ended.records,
                          conflictedTimers: state.timelog.conflictedTimers?.filter(
                            (t) => t.id !== timer.id,
                          ),
                        },
                      };
                    })
                    .catch((e) => setError(String(e)))
                }
              >
                结束并保存
              </button>
            </div>
          ))}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      <Workspace
        page={page}
        onPageChange={onPageChange}
        initialDate={initialDate}
        filter={filter}
      />
    </div>
  );
}
