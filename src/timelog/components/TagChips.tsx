import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';

const cleanTag = (text: string) => text.trim().replace(/^#+/, '').slice(0, 40);

/** Inline "新标签 +" field shared by every tag chip row. */
export function TagAdder({ label, onAdd }: { label: string; onAdd: (tag: string) => void }) {
  const [draft, setDraft] = useState('');
  function add() {
    const tag = cleanTag(draft);
    if (!tag) return;
    onAdd(tag);
    setDraft('');
  }
  return (
    <span className="tag-adder">
      <input
        aria-label={label}
        placeholder="新标签"
        maxLength={40}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter inside a form would submit it; adding the tag is what the user means.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            add();
          }
        }}
      />
      <button type="button" aria-label="添加标签" onClick={add}>
        <Plus size={14} />
      </button>
    </span>
  );
}

/**
 * Record tags as toggle chips: tap to add or remove, type a new one at the end. Used by the
 * record editor and the running timer so both pick tags the same way.
 */
export function TagToggles({
  options,
  selected,
  colors,
  label,
  onChange,
  children,
}: {
  options: string[];
  selected: string[];
  colors: Record<string, string>;
  label: string;
  onChange: (tags: string[]) => void;
  children?: ReactNode;
}) {
  // A stable order: a chip never moves under the finger when it is toggled.
  const tags = [...new Set([...options, ...selected])].sort();
  return (
    <div className="phone-tag-chips" role="group" aria-label={label}>
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          style={{ color: colors[tag] }}
          aria-pressed={selected.includes(tag)}
          onClick={() =>
            onChange(
              selected.includes(tag)
                ? selected.filter((value) => value !== tag)
                : [...selected, tag],
            )
          }
        >
          #{tag}
        </button>
      ))}
      <TagAdder
        label={`${label}：新标签`}
        onAdd={(tag) => !selected.includes(tag) && onChange([...selected, tag])}
      />
      {children}
    </div>
  );
}
