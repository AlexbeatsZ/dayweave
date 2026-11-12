import { useState } from 'react';
import { Ban, Plus, Trash2 } from 'lucide-react';
import {
  activeActivity,
  dayKey,
  dayRange,
  describeRule,
  emptyRule,
  formatDuration,
  matchedMinutes,
  type RecordRule,
  type State,
} from '../domain';
import { TagAdder } from './TagChips';

type Choice = 'any' | 'include' | 'exclude';
const choiceText: Record<Choice, string> = { any: '不限', include: '包含', exclude: '排除' };

/**
 * Rules deciding which saved records a time goal counts. A record counts when it matches any
 * rule; inside a rule, any chosen activity, every included tag and no excluded tag.
 */
export function GoalRules({
  state,
  tagOptions,
  rules,
  onChange,
}: {
  state: State;
  tagOptions: string[];
  rules: RecordRule[];
  onChange: (rules: RecordRule[]) => void;
}) {
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const tags = [
    ...new Set([
      ...tagOptions,
      ...extraTags,
      ...rules.flatMap((rule) => [...rule.tags, ...rule.excludeTags]),
    ]),
  ].sort();
  const today = matchedMinutes(state, rules, dayRange(dayKey(Date.now())));
  const update = (index: number, rule: RecordRule) =>
    onChange(rules.map((row, position) => (position === index ? rule : row)));
  function cycleTag(index: number, tag: string) {
    const rule = rules[index];
    // One tap cycles 不限 → 包含 → 排除 → 不限.
    if (rule.tags.includes(tag))
      update(index, {
        ...rule,
        tags: rule.tags.filter((item) => item !== tag),
        excludeTags: [...rule.excludeTags, tag],
      });
    else if (rule.excludeTags.includes(tag))
      update(index, { ...rule, excludeTags: rule.excludeTags.filter((item) => item !== tag) });
    else update(index, { ...rule, tags: [...rule.tags, tag] });
  }
  function addTag(index: number, tag: string) {
    setExtraTags((rows) => [...rows, tag]);
    const rule = rules[index];
    if (!rule.tags.includes(tag) && !rule.excludeTags.includes(tag))
      update(index, { ...rule, tags: [...rule.tags, tag] });
  }
  return (
    <fieldset className="goal-rules">
      <legend>计入规则</legend>
      <p className="muted">
        满足任一规则的记录都计时。规则内：选中的活动任选其一（不选为任意活动），标签点一下为必须带上，再点一下为不能带。
      </p>
      {rules.map((rule, index) => (
        <section className="goal-rule" key={index} aria-label={`规则 ${index + 1}`}>
          <header>
            <strong>{index ? `或 规则 ${index + 1}` : '规则 1'}</strong>
            {rules.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label={`删除规则 ${index + 1}`}
                onClick={() => onChange(rules.filter((_, position) => position !== index))}
              >
                <Trash2 size={15} />
              </button>
            )}
          </header>
          <div className="match-heading">活动</div>
          <div
            className="phone-activity-chips"
            role="group"
            aria-label={`规则 ${index + 1} 的活动`}
          >
            {state.activities
              .filter((row) => activeActivity(row) || rule.activities.includes(row.id))
              .map((activity) => {
                const selected = rule.activities.includes(activity.id);
                return (
                  <button
                    type="button"
                    key={activity.id}
                    aria-pressed={selected}
                    onClick={() =>
                      update(index, {
                        ...rule,
                        activities: selected
                          ? rule.activities.filter((item) => item !== activity.id)
                          : [...rule.activities, activity.id],
                      })
                    }
                  >
                    <i style={{ background: activity.color }} />
                    {activity.name}
                    {!activeActivity(activity) && '（历史）'}
                  </button>
                );
              })}
          </div>
          <div className="match-heading">标签</div>
          <div className="phone-tag-chips" role="group" aria-label={`规则 ${index + 1} 的标签`}>
            {tags.map((tag) => {
              const choice: Choice = rule.tags.includes(tag)
                ? 'include'
                : rule.excludeTags.includes(tag)
                  ? 'exclude'
                  : 'any';
              return (
                <button
                  type="button"
                  key={tag}
                  aria-pressed={choice === 'include'}
                  data-choice={choice}
                  aria-label={`#${tag}：${choiceText[choice]}`}
                  title={`${choiceText[choice]}，点按切换`}
                  onClick={() => cycleTag(index, tag)}
                >
                  {choice === 'exclude' && <Ban size={12} />}#{tag}
                </button>
              );
            })}
            <TagAdder label={`规则 ${index + 1} 添加标签`} onAdd={(tag) => addTag(index, tag)} />
          </div>
          <p className="match-summary">{describeRule(rule, state.activities)}</p>
        </section>
      ))}
      <button
        type="button"
        className="secondary goal-rule-add"
        onClick={() => onChange([...rules, emptyRule()])}
      >
        <Plus size={15} />
        添加规则
      </button>
      <p className="match-summary" aria-live="polite">
        今天已匹配 {formatDuration(today * 60000)}
      </p>
    </fieldset>
  );
}
