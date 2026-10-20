import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FileText, RotateCcw } from 'lucide-react';
import {
  dayKey,
  duration,
  formatDuration,
  makeBackup,
  mergeBackup,
  parseBackup,
  timestamp,
  toCsv,
  toMarkdown,
  validateState,
  type Backup,
  type State,
} from '../domain';
import { download, readState } from '../storage';
import { isAndroid, nativeFiles } from '../platform';

import { useTheme } from '../theme';
import { Dialog } from './Dialog';
import type { Commit } from './Editor';
export function Settings({
  state,
  date,
  commit,
  close,
}: {
  state: State;
  date: string;
  commit: Commit;
  close: () => void;
}) {
  const theme = useTheme(),
    input = useRef<HTMLInputElement>(null);
  const [connection, setConnection] = useState<{
      url: string;
      token: string;
      discoveryPath: string;
    } | null>(null),
    [reveal, setReveal] = useState(false),
    [error, setError] = useState(''),
    [backup, setBackup] = useState<Backup | null>(null),
    [mode, setMode] = useState('merge'),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    window.clearlist
      ?.apiInfo?.()
      .then((info) => setConnection({ ...info, discoveryPath: 'Dayweave/api.json' }))
      .catch(() => {});
  }, []);
  async function saveFile(name: string, data: string, mime?: string) {
    try {
      setError('');
      await download(name, data, mime);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  async function openFile(file?: File) {
    try {
      setError('');
      const text = isAndroid ? (await nativeFiles.open()).data : file ? await file.text() : null;
      if (text) {
        setBackup(parseBackup(text));
        setMode('merge');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (input.current) input.current.value = '';
    }
  }
  async function restore() {
    if (!backup) return;
    setBusy(true);
    setError('');
    try {
      const current = await readState(),
        previous = JSON.stringify(current);
      const next =
        mode === 'merge' ? mergeBackup(current, backup.data) : validateState(backup.data);
      await download(
        `open-timelog-before-import-${Date.now()}.json`,
        JSON.stringify(makeBackup(current), null, 2),
      );
      if (
        await commit(
          (state) => {
            if (JSON.stringify(state) !== previous)
              throw new Error('备份期间记录发生变化，请重新预览。');
            return next;
          },
          mode === 'merge' ? '备份已合并' : '备份已恢复',
        )
      )
        setBackup(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="设置与数据" close={close} wide>
      <div className="settings-content">
        <section>
          <h3>外观</h3>
          <label className="setting-row">
            <span>颜色模式</span>
            <select
              aria-label="颜色模式"
              value={theme.preference}
              onChange={(event) => theme.choose(event.target.value as 'system' | 'light' | 'dark')}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色模式</option>
              <option value="dark">暗色模式</option>
            </select>
          </label>
        </section>
        <section>
          <h3>备份与导出</h3>
          <p className="muted">完整备份包含活动、记录、目标和进行中的计时。请定期独立保存。</p>
          <div className="export-actions">
            <button
              className="secondary"
              onClick={() =>
                saveFile(
                  `open-timelog-${dayKey(Date.now())}.json`,
                  JSON.stringify(makeBackup(state), null, 2),
                )
              }
            >
              <ArrowDownToLine size={15} />
              导出 JSON
            </button>
            <button
              className="secondary"
              onClick={() => (isAndroid ? openFile() : input.current?.click())}
            >
              导入备份
            </button>
            <button
              className="secondary"
              onClick={() =>
                saveFile(`timelog-${date}.csv`, toCsv(state), 'text/csv;charset=utf-8')
              }
            >
              导出 CSV
            </button>
            <button
              className="secondary"
              onClick={() =>
                saveFile(
                  `timelog-${date}.md`,
                  toMarkdown(state, date),
                  'text/markdown;charset=utf-8',
                )
              }
            >
              <FileText size={15} />
              导出当日 Markdown
            </button>
          </div>
          <input
            type="file"
            ref={input}
            hidden
            aria-label="导入备份文件"
            accept=".json,application/json"
            onChange={(event) => openFile(event.target.files?.[0])}
          />
          {backup && (
            <div className="import-preview">
              <strong>预览备份</strong>
              <p>
                {backup.data.records.filter((row) => !row.deletedAt).length} 条有效记录 ·{' '}
                {backup.data.activities.length} 项活动
              </p>
              <label>
                导入方式
                <select
                  aria-label="导入方式"
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <option value="merge">合并到现有数据</option>
                  <option value="restore">完整恢复（替换本机数据）</option>
                </select>
              </label>
              <p className="muted">
                {mode === 'merge'
                  ? '相同 ID 保留较新版本。进行中的计时请先保存。'
                  : '将替换本机完整状态，包括正在进行的计时。'}
                执行前会先保存本机备份；取消保存则不导入。
              </p>
              <div className="inline-actions">
                <button className="secondary" onClick={() => setBackup(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy || (mode === 'merge' && !!(state.timer || backup.data.timer))}
                  onClick={restore}
                >
                  {mode === 'merge' ? '备份当前数据并合并' : '备份当前数据并完整恢复'}
                </button>
              </div>
            </div>
          )}
        </section>
        {connection && (
          <section className="api-settings">
            <h3>AI 与本机 API</h3>
            <p className="muted">
              仅供本机工具使用。命令行可自动读取连接文件，无需在对话中粘贴令牌。
            </p>
            <label>
              接口地址
              <input aria-label="API 地址" readOnly value={`${connection.url}/timelog`} />
            </label>
            <label>
              连接令牌
              <div className="token-row">
                <input
                  aria-label="API 连接令牌"
                  type={reveal ? 'text' : 'password'}
                  readOnly
                  value={connection.token}
                />
                <button className="secondary" onClick={() => setReveal(!reveal)}>
                  {reveal ? '隐藏' : '显示'}
                </button>
              </div>
            </label>
            <code className="api-path">{connection.discoveryPath}</code>
          </section>
        )}
        <section>
          <h3>最近删除</h3>
          {state.records.some((row) => row.deletedAt) ? (
            state.records
              .filter((row) => row.deletedAt)
              .slice()
              .reverse()
              .map((record) => (
                <div className="setting-row" key={record.id}>
                  <span>
                    {state.activities.find((a) => a.id === record.activityId)?.name}
                    <small>
                      {dayKey(record.spans[0].start)} · {formatDuration(duration(record.spans))}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      commit(
                        (current) => ({
                          ...current,
                          records: current.records.map((row) =>
                            row.id === record.id
                              ? { ...row, deletedAt: null, updatedAt: timestamp(row.updatedAt) }
                              : row,
                          ),
                        }),
                        '记录已恢复',
                      )
                    }
                  >
                    <RotateCcw size={14} />
                    恢复
                  </button>
                </div>
              ))
          ) : (
            <p className="muted">没有已删除的记录。</p>
          )}
        </section>
        {state.goals.some((row) => row.archived) && (
          <section>
            <h3>已归档目标</h3>
            {state.goals
              .filter((row) => row.archived)
              .map((goal) => (
                <div key={goal.id} className="setting-row">
                  <span>{goal.name}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      commit(
                        (current) => ({
                          ...current,
                          goals: current.goals.map((row) =>
                            row.id === goal.id
                              ? { ...row, archived: false, updatedAt: timestamp(row.updatedAt) }
                              : row,
                          ),
                        }),
                        '目标已恢复',
                      )
                    }
                  >
                    恢复
                  </button>
                </div>
              ))}
          </section>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="settings-about">
          时迹 · Open Timelog {'0.3.0'} · MIT
          <p>数据保存在此设备。当前通过 JSON 手动迁移，不自动同步。</p>
        </footer>
      </div>
    </Dialog>
  );
}
