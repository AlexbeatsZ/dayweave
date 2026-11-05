import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileCode2, FlaskConical, Plus, Upload } from 'lucide-react';
import { exportText, pickText } from '../../files';
import { useStore } from '../../store';
import { businessDateKey } from '../../timezone';
import {
  MAX_SCRIPT_LENGTH,
  newId,
  timestamp,
  type Goal,
  type GoalScript,
  type ScriptParam,
  type State,
} from '../domain';
import type { ScriptRun } from '../script-engine';
import { inspectScript, testScript } from '../script-runner';
import { scriptTemplates } from '../script-templates';
import { normalizeParam, type ScriptMeta } from '../script-util';
import { Dialog } from './Dialog';
import type { Commit } from './Editor';

// Loading a module is the only way to read its exports; keep one answer per source text.
const metas = new Map<string, Promise<ScriptMeta>>();
function metaOf(code: string) {
  if (!metas.has(code)) metas.set(code, inspectScript(code));
  return metas.get(code)!;
}
function useMeta(code: string | undefined) {
  const [meta, setMeta] = useState<{ code?: string; meta?: ScriptMeta; error?: string }>({});
  useEffect(() => {
    if (code === undefined) return;
    let current = true;
    metaOf(code).then(
      (meta) => current && setMeta({ code, meta }),
      (error: Error) => current && setMeta({ code, error: error.message }),
    );
    return () => {
      current = false;
    };
  }, [code]);
  return meta.code === code ? meta : {};
}
const paramText = (value: ScriptParam | undefined) =>
  Array.isArray(value) ? value.join(', ') : value === undefined ? '' : String(value);

/** The goal editor's 自动化脚本 section: library, chosen script and its parameters. */
export function GoalScripts({
  state,
  commit,
  period,
  scriptId,
  onScript,
  params,
  onParams,
}: {
  state: State;
  commit: Commit;
  period: Goal['period'];
  scriptId: string;
  onScript: (id: string) => void;
  params: Record<string, ScriptParam>;
  onParams: (params: Record<string, ScriptParam>) => void;
}) {
  const scripts = state.scripts ?? [];
  const selected = scripts.find((row) => row.id === scriptId);
  const { meta, error } = useMeta(selected?.code);
  const [editing, setEditing] = useState<{ script?: GoalScript; code?: string } | null>(null);
  // The script editor has its own form, so it renders beside (not inside) the goal form, but
  // still within the goal dialog so the module's scoped styles apply.
  const ref = useRef<HTMLFieldSetElement>(null);
  const [notice, setNotice] = useState('');
  // List parameters stay as typed ("a, b,") while editing; the goal stores the parsed list.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  async function importScript() {
    setNotice('');
    try {
      const code = await pickText('.js,.mjs');
      if (code === null) return;
      if (code.length > MAX_SCRIPT_LENGTH) throw new Error('脚本不能超过 200 KB');
      const meta = await metaOf(code);
      setEditing({ code: code, script: undefined });
      setNotice(meta.name ? '' : '已读取脚本，请确认名称后保存');
    } catch (error) {
      setNotice(error instanceof Error ? `无法导入：${error.message}` : String(error));
    }
  }
  return (
    <fieldset className="goal-scripts" ref={ref}>
      <legend>判定脚本</legend>
      <div className="script-list" role="radiogroup" aria-label="脚本库">
        {scripts.map((script) => (
          <ScriptOption
            key={script.id}
            script={script}
            checked={script.id === scriptId}
            onSelect={() => {
              onScript(script.id);
              setDrafts({});
            }}
          />
        ))}
        {!scripts.length && <p className="muted">脚本库还是空的：新建或导入一个 .js 脚本。</p>}
      </div>
      <div className="script-actions">
        <button type="button" className="secondary" onClick={() => setEditing({})}>
          <Plus size={15} /> 新建脚本
        </button>
        <button type="button" className="secondary" onClick={() => void importScript()}>
          <Upload size={15} /> 导入脚本
        </button>
        {selected && (
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing({ script: selected })}
          >
            <FileCode2 size={15} /> 编辑脚本
          </button>
        )}
      </div>
      {notice && <p className="form-error">{notice}</p>}
      {selected && error && <p className="form-error">脚本有错误：{error}</p>}
      {selected &&
        meta?.params.map((spec) => (
          <label key={spec.key} className={spec.type === 'boolean' ? 'script-check' : ''}>
            {spec.type !== 'boolean' && spec.label}
            {spec.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={(params[spec.key] ?? spec.default) === true}
                onChange={(event) => onParams({ ...params, [spec.key]: event.target.checked })}
              />
            ) : (
              <input
                inputMode={spec.type === 'number' ? 'decimal' : undefined}
                value={drafts[spec.key] ?? paramText(params[spec.key] ?? spec.default)}
                onChange={(event) => {
                  setDrafts({ ...drafts, [spec.key]: event.target.value });
                  onParams({
                    ...params,
                    [spec.key]: normalizeParam(spec.type, event.target.value),
                  });
                }}
              />
            )}
            {spec.type === 'boolean' && spec.label}
            {spec.hint && <small className="muted">{spec.hint}</small>}
          </label>
        ))}
      {editing &&
        createPortal(
          <ScriptEditor
            script={editing.script}
            initialCode={editing.code}
            state={state}
            commit={commit}
            test={{ period, params }}
            close={() => setEditing(null)}
            onSaved={(id) => {
              onScript(id);
              setDrafts({});
            }}
          />,
          ref.current?.closest('dialog') ?? document.body,
        )}
    </fieldset>
  );
}
function ScriptOption({
  script,
  checked,
  onSelect,
}: {
  script: GoalScript;
  checked: boolean;
  onSelect: () => void;
}) {
  const { meta, error } = useMeta(script.code);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className="script-option"
      onClick={onSelect}
    >
      <FileCode2 size={17} aria-hidden />
      <span>
        <strong>{script.name}</strong>
        <small className={error ? 'script-error' : ''}>
          {error ? `错误：${error}` : (meta?.description ?? '读取中…')}
        </small>
      </span>
    </button>
  );
}

/** Edit, test, export or delete one library script. */
function ScriptEditor({
  script,
  initialCode,
  state,
  commit,
  test,
  close,
  onSaved,
}: {
  script?: GoalScript;
  initialCode?: string;
  state: State;
  commit: Commit;
  test: { period: Goal['period']; params: Record<string, ScriptParam> };
  close: () => void;
  onSaved: (id: string) => void;
}) {
  const { data } = useStore();
  const [code, setCode] = useState(script?.code ?? initialCode ?? scriptTemplates[0].code);
  const [name, setName] = useState(
    script?.name ?? (initialCode === undefined ? scriptTemplates[0].name : ''),
  );
  const [error, setError] = useState('');
  const [run, setRun] = useState<(ScriptRun & { meta?: ScriptMeta }) | 'running' | null>(null);
  const users = state.goals.filter(
    (goal) => goal.kind === 'script' && goal.scriptId === script?.id,
  );
  useEffect(() => {
    // Imported files usually name themselves through `export const name`.
    if (script || name) return;
    let current = true;
    metaOf(code).then(
      (meta) => current && meta.name && setName(meta.name),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    const id = script?.id ?? newId();
    const saved = await commit((current) => {
      const scripts = current.scripts ?? [];
      const existing = scripts.find((row) => row.id === id);
      if (script && existing?.updatedAt !== script.updatedAt)
        throw new Error('脚本已在其他设备更新，请重新打开。');
      if (!name.trim()) throw new Error('请填写脚本名称。');
      if (scripts.some((row) => row.id !== id && row.name === name.trim()))
        throw new Error('已有同名脚本。');
      const next: GoalScript = {
        id,
        name: name.trim(),
        code,
        ...(existing?.order === undefined ? {} : { order: existing.order }),
        updatedAt: timestamp(existing?.updatedAt),
      };
      return {
        ...current,
        scripts: existing ? scripts.map((row) => (row.id === id ? next : row)) : [...scripts, next],
      };
    }, '脚本已保存');
    if (saved) {
      onSaved(id);
      close();
    } else setError('未保存，请查看提示。');
  }
  async function remove() {
    if (!script) return;
    if (users.length) {
      setError(`有目标正在使用：${users.map((goal) => goal.name).join('、')}`);
      return;
    }
    if (!window.confirm(`删除脚本「${script.name}」？`)) return;
    const removed = await commit(
      (current) => ({
        ...current,
        scripts: (current.scripts ?? []).filter((row) => row.id !== script.id),
      }),
      '脚本已删除',
    );
    if (removed) close();
  }
  return (
    <Dialog title={script ? '编辑脚本' : '新建脚本'} close={close} wide className="script-editor">
      <form className="editor" onSubmit={(event) => void save(event)}>
        <div className="form-columns">
          <label>
            名称
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          </label>
          {!script && !initialCode && (
            <label>
              从模板开始
              <select
                aria-label="脚本模板"
                onChange={(event) => {
                  const template = scriptTemplates[Number(event.target.value)];
                  setCode(template.code);
                  if (!name.trim() || scriptTemplates.some((row) => row.name === name))
                    setName(template.name);
                }}
              >
                {scriptTemplates.map((template, index) => (
                  <option key={template.name} value={index}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label>
          代码（JavaScript 模块）
          <textarea
            className="script-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            rows={18}
            maxLength={MAX_SCRIPT_LENGTH}
          />
        </label>
        <p className="muted">
          export default async function judge(ctx) 返回 true / false / null 或{' '}
          {'{ met, progress, note }'}
          。用 ctx.records、ctx.usage、ctx.tasks、ctx.slots、ctx.classes 读取数据，接口见
          docs/goal-scripts.md。保存后由同步中心统一计算并分发结果；试运行只用本机数据。
        </p>
        {run && (
          <section className="script-run" aria-live="polite">
            {run === 'running' ? (
              <p>运行中…</p>
            ) : run.error ? (
              <p className="form-error">出错：{run.error}</p>
            ) : (
              <p>
                本机试运行（今天）：
                <strong>
                  {run.outcome?.met === true
                    ? '达成'
                    : run.outcome?.met === false
                      ? '未达成'
                      : '无法判定'}
                </strong>
                {run.outcome?.note && ` · ${run.outcome.note}`}
                {run.outcome && ` · 进度 ${Math.round(run.outcome.progress * 100)}%`}
              </p>
            )}
            {run !== 'running' && run.logs.length > 0 && <pre>{run.logs.join('\n')}</pre>}
          </section>
        )}
        {error && <p className="form-error">{error}</p>}
        <footer className="dialog-actions">
          {script && (
            <button type="button" className="danger" onClick={() => void remove()}>
              删除
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void exportText(`${name.trim() || 'goal-script'}.js`, code, 'text/javascript').catch(
                (error: Error) => setError(error.message),
              )
            }
          >
            导出
          </button>
          <button
            type="button"
            className="secondary"
            disabled={run === 'running'}
            onClick={async () => {
              setRun('running');
              setRun(await testScript(code, data, test, businessDateKey()));
            }}
          >
            <FlaskConical size={15} /> 试运行
          </button>
          <button type="submit" className="primary">
            保存
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
