import type { CSSProperties } from 'react';
import checklist from './icons/checklist.svg?raw';
import schedule from './icons/schedule.svg?raw';
import calendar from './icons/calendar-month.svg?raw';
import chart from './icons/bar-chart.svg?raw';

// Unmodified Google Material Symbols Rounded paths (Apache-2.0).
const symbols = { checklist, schedule, calendar, chart };
export type MaterialSymbolName = keyof typeof symbols;

export function MaterialSymbol({ name, size = 24 }: { name: MaterialSymbolName; size?: number }) {
  return (
    <span
      className="material-symbol"
      aria-hidden="true"
      style={{ '--symbol-size': `${size}px` } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: symbols[name] }}
    />
  );
}
