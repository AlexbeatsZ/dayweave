import { useEffect, useRef, useState } from 'react';
import { importCourses, type ImportPreview } from '../course-import';
import { importFudanCourses } from '../fudan-import';
import { isMobileApp, pickText } from '../files';
import { store } from '../store';
import { confirmCourseImport, setFudanImportActive } from '../useFudanRefresh';
import { usePhone } from '../phone/usePhone';
import { Modal } from './Modal';

export function useCourseImport(onImported: () => void) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setFudanImportActive(false);
    };
  }, []);
  async function receive(website = false) {
    if (pending.current || preview) return;
    pending.current = true;
    setFudanImportActive(true);
    setBusy(true);
    setError('');
    let next: ImportPreview | null = null;
    try {
      if (website) {
        next = await importFudanCourses(store.get().schedule);
      } else {
        const text = await pickText();
        if (!mounted.current) return;
        next =
          text === null
            ? null
            : importCourses(
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
              );
      }
      if (mounted.current) setPreview(next);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        setFudanImportActive(!!next);
      }
    }
  }

  async function confirm() {
    if (pending.current || !preview) return;
    pending.current = true;
    setBusy(true);
    setError('');
    let imported = false;
    try {
      await confirmCourseImport(preview);
      imported = true;
      if (mounted.current) {
        setPreview(null);
        onImported();
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        if (imported) setFudanImportActive(false);
      }
    }
  }

  function cancel() {
    if (pending.current) return;
    setPreview(null);
    setFudanImportActive(false);
  }
  return { preview, busy, error, receive, confirm, cancel, clearError: () => setError('') };
}

export function CourseImportDialog({ workflow }: { workflow: ReturnType<typeof useCourseImport> }) {
  const phone = usePhone();
  const { preview, busy, error, confirm, cancel } = workflow;
  if (!preview) return null;
  return (
    <Modal title="预览导入课程" close={cancel} sheet={phone}>
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
        {isMobileApp && preview.source?.kind === 'fudan' && (
          <p className="field-hint">
            确认后在这台设备自动检查所选学期；网站课程随学校更新，手动添加的课程保留。可在课程操作 →
            更多中关闭。
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <button className="button" disabled={busy} onClick={cancel}>
            取消
          </button>
          <button className="button primary" disabled={busy} onClick={() => void confirm()}>
            合并导入
          </button>
        </footer>
      </div>
    </Modal>
  );
}
