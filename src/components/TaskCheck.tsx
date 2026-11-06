import { Check, RotateCw } from 'lucide-react';

/** The same completion control for tasks, inline subtasks and editor drafts. */
export function TaskCheck({
  checked,
  label,
  ordinal,
  onChange,
  disabled,
  repeating = false,
}: {
  checked: boolean;
  label: string;
  ordinal?: number;
  onChange: () => void;
  disabled?: boolean;
  repeating?: boolean;
}) {
  return (
    <button
      type="button"
      className={`task-check ${checked ? 'checked' : ''} ${repeating ? 'repeating' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
    >
      {checked ? (
        <Check size={13} strokeWidth={3} />
      ) : (
        <>
          {repeating && (
            <RotateCw
              className="task-check-cycle"
              size={23}
              viewBox="2.25 2.25 19.5 19.5"
              strokeWidth={1.25}
              aria-hidden
            />
          )}
          {ordinal}
        </>
      )}
    </button>
  );
}
