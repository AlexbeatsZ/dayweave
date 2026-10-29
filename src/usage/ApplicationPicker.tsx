import { useEffect, useState } from 'react';
import { AppWindow, Search } from 'lucide-react';
import { Modal } from '../components/Modal';
import { usageBridge } from './client';
import type { UsageApplication } from './domain';

export function ApplicationPicker({
  selected,
  close,
  onSave,
}: {
  selected: string[];
  close: () => void;
  onSave: (values: string[]) => void;
}) {
  const [applications, setApplications] = useState<UsageApplication[]>([]);
  const [draft, setDraft] = useState(selected);
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const matches = (application: UsageApplication, rule: string) =>
    `${application.name}\n${application.id}`.toLowerCase().includes(rule.toLowerCase());
  useEffect(() => {
    let active = true;
    void (usageBridge().applications?.() ?? Promise.resolve([]))
      .then((values) => {
        if (active) setApplications(values);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const rows: UsageApplication[] = [
    ...applications,
    ...draft
      .filter((rule) => !applications.some((application) => matches(application, rule)))
      .map((rule): UsageApplication => ({ id: rule, name: rule })),
  ]
    .filter((application) =>
      `${application.name} ${application.id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((application) => !onlySelected || draft.some((rule) => matches(application, rule)))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id),
    );
  return (
    <Modal title="忽略应用" close={close} sheet>
      <div className="usage-app-picker">
        <label className="usage-app-search">
          <Search size={18} />
          <input
            type="search"
            aria-label="搜索应用"
            placeholder="搜索应用"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="phone-segments" aria-label="应用范围">
          <button type="button" aria-pressed={!onlySelected} onClick={() => setOnlySelected(false)}>
            全部应用
          </button>
          <button type="button" aria-pressed={onlySelected} onClick={() => setOnlySelected(true)}>
            已忽略 · {draft.length}
          </button>
        </div>
        <div className="usage-app-list">
          {loading && <p role="status">正在读取应用…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !rows.length && <p className="usage-empty">暂无应用</p>}
          {rows.map((application) => {
            const checked = draft.some((rule) => matches(application, rule));
            return (
              <label className="usage-app-row" key={application.id}>
                {application.icon ? (
                  <img src={application.icon} width={36} height={36} alt="" />
                ) : (
                  <span className="usage-app-icon">
                    <AppWindow size={22} />
                  </span>
                )}
                <span>
                  <strong>{application.name}</strong>
                  {application.name !== application.id && <small>{application.id}</small>}
                </span>
                <input
                  type="checkbox"
                  aria-label={`忽略 ${application.name} ${application.id}`}
                  checked={checked}
                  disabled={!checked && draft.length >= 200}
                  onChange={() =>
                    setDraft(
                      checked
                        ? draft.filter((rule) => !matches(application, rule))
                        : [...draft, application.id],
                    )
                  }
                />
              </label>
            );
          })}
        </div>
        <footer>
          <button type="button" onClick={close}>
            取消
          </button>
          <button type="button" className="primary-button" onClick={() => onSave(draft)}>
            完成
          </button>
        </footer>
      </div>
    </Modal>
  );
}
