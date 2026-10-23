import { useRef, type ReactNode } from 'react';
import { Plus } from 'lucide-react';

export type PhoneTab<T extends string = string> = { id: T; label: string; count?: number };

export function useSwipeTabs<T extends string>(
  tabs: readonly PhoneTab<T>[],
  value: string,
  onChange: (value: T) => void,
) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  return {
    onTouchStart(event: React.TouchEvent) {
      if (
        event.touches.length !== 1 ||
        (event.target as Element).closest(
          'input, textarea, select, dialog, [contenteditable], [data-no-swipe]',
        )
      ) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    },
    onTouchEnd(event: React.TouchEvent) {
      const previous = start.current;
      start.current = null;
      if (!previous || !event.changedTouches.length) return;
      const touch = event.changedTouches[0],
        dx = touch.clientX - previous.x,
        dy = touch.clientY - previous.y;
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - previous.at > 900)
        return;
      const index = tabs.findIndex((tab) => tab.id === value);
      const next = tabs[index + (dx < 0 ? 1 : -1)];
      if (index >= 0 && next) onChange(next.id);
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}

export function PhoneTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly PhoneTab<T>[];
  value: string;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="phone-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const index = tabs.findIndex((item) => item.id === tab.id);
            const next =
              event.key === 'ArrowRight'
                ? tabs[index + 1]
                : event.key === 'ArrowLeft'
                  ? tabs[index - 1]
                  : undefined;
            if (!next) return;
            event.preventDefault();
            onChange(next.id);
            (
              event.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement
            )?.focus();
          }}
        >
          {tab.label}
          {tab.count ? <small>{tab.count}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function FloatingAdd({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="phone-fab" aria-label={label} disabled={disabled} onClick={onClick}>
      <Plus size={26} strokeWidth={1.8} />
    </button>
  );
}

export function PhoneTopbar({
  title,
  openMenu,
  children,
}: {
  title: string;
  openMenu: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={`phone-header ${children ? 'has-tabs' : ''}`}>
      <div className="phone-header-line">
        {openMenu}
        <h1>{title}</h1>
      </div>
      {children}
    </header>
  );
}
