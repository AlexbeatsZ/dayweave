import { Check } from 'lucide-react';

/** The same completion control for tasks, inline subtasks and editor drafts. */
export function TaskCheck({
  checked,
  label,
  ordinal,
  onChange,
}: {
  checked: boolean;
  label: string;
  ordinal?: number;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className={`task-check ${checked ? 'checked' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      {checked ? <Check size={13} strokeWidth={3} /> : ordinal}
    </button>
  );
}
