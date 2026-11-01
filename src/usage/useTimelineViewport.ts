import { useLayoutEffect, useRef, useState } from 'react';

/** Keep the full axis height, but only mount cards near the existing scroll window. */
export function useTimelineViewport(height: number) {
  const element = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, bottom: 2000 });
  const enabled = height > 0;
  useLayoutEffect(() => {
    const timeline = element.current;
    const container = timeline?.closest<HTMLElement>('.phone-content');
    if (!enabled || !timeline || !container) return;
    let frame = 0;
    const inspect = () => {
      frame = 0;
      const bounds = timeline.getBoundingClientRect();
      const window = container.getBoundingClientRect();
      const top = Math.max(0, window.top - bounds.top - 600);
      const bottom = Math.min(height, window.bottom - bounds.top + 600);
      setViewport((previous) =>
        previous.top === top && previous.bottom === bottom ? previous : { top, bottom },
      );
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(inspect);
    };
    const resize = new ResizeObserver(scroll);
    resize.observe(container);
    resize.observe(timeline);
    container.addEventListener('scroll', scroll, { passive: true });
    inspect();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      container.removeEventListener('scroll', scroll);
    };
  }, [enabled, height]);
  return { element, viewport: enabled ? viewport : undefined };
}
