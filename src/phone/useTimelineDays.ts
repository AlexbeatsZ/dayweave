import { useEffect, useRef, useState } from 'react';
import { shiftDay } from '../timelog/domain';

/** Owns the scroll window; the visible date is only a projection, never the window anchor. */
export function useTimelineDays(
  enabled: boolean,
  initialDate: string,
  onVisibleDate: (date: string) => void,
) {
  const [window, setWindow] = useState({ anchor: initialDate, count: 1, revision: 0 });
  const list = useRef<HTMLDivElement>(null);
  const visible = useRef(onVisibleDate);
  visible.current = onVisibleDate;
  const jump = (date: string) => {
    if (!date) return;
    setWindow((previous) => ({ anchor: date, count: 1, revision: previous.revision + 1 }));
    visible.current(date);
  };
  useEffect(() => {
    if (!enabled || !list.current) return;
    list.current.closest('.phone-content')?.scrollTo({ top: 0 });
  }, [enabled, window.revision]);
  useEffect(() => {
    if (!enabled || !list.current) return;
    const container = list.current.closest<HTMLElement>('.phone-content');
    if (!container) return;
    let frame = 0;
    const inspect = () => {
      frame = 0;
      const toolbar = container.querySelector('.phone-record-toolbar');
      const edge =
        container.getBoundingClientRect().top + (toolbar?.getBoundingClientRect().height || 0) + 12;
      const sections = [...list.current!.querySelectorAll<HTMLElement>('[data-timeline-day]')];
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= edge) current = section;
        else break;
      }
      if (current?.dataset.timelineDay) visible.current(current.dataset.timelineDay);
      if (
        container.scrollHeight - container.clientHeight - container.scrollTop < 140 &&
        shiftDay(window.anchor, -window.count) >= '2000-01-01'
      ) {
        setWindow((previous) =>
          previous.count === window.count ? { ...previous, count: previous.count + 1 } : previous,
        );
      }
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(inspect);
    };
    const previousPadding = container.style.scrollPaddingTop;
    const toolbar = container.querySelector('.phone-record-toolbar');
    const resize = new ResizeObserver(() => {
      container.style.scrollPaddingTop = `${(toolbar?.getBoundingClientRect().height || 0) + 12}px`;
      scroll();
    });
    if (toolbar) resize.observe(toolbar);
    container.addEventListener('scroll', scroll, { passive: true });
    scroll();
    return () => {
      container.removeEventListener('scroll', scroll);
      resize.disconnect();
      container.style.scrollPaddingTop = previousPadding;
      cancelAnimationFrame(frame);
    };
  }, [enabled, window.anchor, window.count, window.revision]);
  return {
    list,
    dates: Array.from({ length: window.count }, (_, index) => shiftDay(window.anchor, -index)),
    jump,
  };
}
