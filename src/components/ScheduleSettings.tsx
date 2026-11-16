import { useState } from 'react';
import { useStore } from '../store';
import { exportText, isMobileApp, requestWidget } from '../files';
import { csvTemplate } from '../course-import';
import { useFudanSource, refreshFudan, stopFudanRefresh } from '../useFudanRefresh';
import { arrangementMigrationReport } from '../event-migration';
import { CourseImportDialog, useCourseImport } from './CourseImport';
import { SemesterEditor, PeriodEditor } from './Timetable';
import { CalendarFeedSettings } from './CalendarFeedSettings';

/** Course import, semester/period configuration and calendar feeds, all under Settings. */
export function ScheduleSettings() {
  const { data } = useStore();
  const imports = useCourseImport(() => undefined);
  const fudan = useFudanSource();
  const [editor, setEditor] = useState<'semester' | 'periods'>();
  const [error, setError] = useState('');
  const report = arrangementMigrationReport(data);
  const run = (action: () => Promise<unknown>) => {
    setError('');
    void action().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const warnings = [
    ...report.needsReview.map((task) => `${task.title} · ${task.reason}`),
    ...report.legacyRepeats
      .filter((rule) => rule.warning)
      .map((rule) => `${rule.cron} · ${rule.warning}`),
  ];
  return (
    <>
      <section className="settings-section">
        <h3>课程导入</h3>
        <div className="data-actions">
          <button
            type="button"
            className="button"
            disabled={imports.busy}
            onClick={() => void imports.receive(true)}
          >
            网站导入（复旦教务）
          </button>
          <button
            type="button"
            className="button"
            disabled={imports.busy}
            onClick={() => void imports.receive()}
          >
            文件导入（CSV / JSON / ICS）
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              run(() => exportText('Dayweave-courses.csv', '﻿' + csvTemplate, 'text/csv'))
            }
          >
            下载 CSV 模板
          </button>
        </div>
        {imports.busy && <p className="field-hint">正在读取课程…</p>}
        {fudan.source && (
          <>
            <p className="field-hint">复旦课表自动更新 · {fudan.source.semesterId}</p>
            {fudan.error && (
              <p className="form-error" role="alert">
                {fudan.error}
              </p>
            )}
            <div className="data-actions">
              <button
                type="button"
                className="button"
                disabled={fudan.busy}
                onClick={() => void refreshFudan(true)}
              >
                立即更新课表
              </button>
              <button type="button" className="button" onClick={stopFudanRefresh}>
                关闭自动更新，保留课程
              </button>
            </div>
          </>
        )}
      </section>
      <section className="settings-section">
        <h3>学期与节次</h3>
        <div className="data-actions">
          <button type="button" className="button" onClick={() => setEditor('semester')}>
            学期与时区
          </button>
          <button type="button" className="button" onClick={() => setEditor('periods')}>
            节次设置
          </button>
          {isMobileApp && (
            <button type="button" className="button" onClick={() => run(requestWidget)}>
              添加桌面小组件
            </button>
          )}
        </div>
      </section>
      <CalendarFeedSettings />
      <section className="settings-section">
        <h3>课表数据</h3>
        <div className="data-actions">
          <button
            type="button"
            className="button"
            onClick={() =>
              run(() =>
                exportText(
                  'Dayweave-timetable.json',
                  JSON.stringify(data.schedule, null, 2),
                  'application/json',
                ),
              )
            }
          >
            导出原课表数据
          </button>
        </div>
        <p className="field-hint">已迁移 {report.migratedEvents} 条课程日程，原课表数据保留。</p>
        {warnings.map((warning) => (
          <p className="field-hint" key={warning}>
            {warning}
          </p>
        ))}
      </section>
      {(error || imports.error) && (
        <p className="form-error" role="alert">
          {error || imports.error}
        </p>
      )}
      {editor === 'semester' && <SemesterEditor close={() => setEditor(undefined)} />}
      {editor === 'periods' && <PeriodEditor close={() => setEditor(undefined)} />}
      <CourseImportDialog workflow={imports} />
    </>
  );
}
