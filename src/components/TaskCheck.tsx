import { Check } from 'lucide-react';

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
          {/* Share SVG geometry so CSS border rounding cannot change the apparent line weight. */}
          <svg
            className={`task-check-ring ${repeating ? 'task-check-cycle' : ''}`}
            width="23"
            height="23"
            viewBox="0 0 23 23"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {repeating ? (
              <path d="M22.25 11.5a10.75 10.75 0 1 1-1.44-5.375M20.81 1.625v4.5h-4.5" />
            ) : (
              <circle cx="11.5" cy="11.5" r="10.75" />
            )}
          </svg>
          {ordinal}
        </>
      )}
    </button>
  );
}
