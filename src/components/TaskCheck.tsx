import { Check } from 'lucide-react';

/** The same completion control for tasks, inline subtasks and editor drafts. */
export function TaskCheck({
  checked,
  label,
  ordinal,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  ordinal?: number;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`task-check ${checked ? 'checked' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
    >
      {checked ? <Check size={13} strokeWidth={3} /> : ordinal}
    </button>
  );
}
