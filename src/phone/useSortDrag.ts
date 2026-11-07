import { useEffect, useRef, useState, type MouseEvent } from 'react';

type Move = (source: string, target: string) => void;
type Gesture = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  pointerId: number | null;
  touchId: number | null;
  active: boolean;
  /** Moved enough to drag, rather than just holding still. */
  moved: boolean;
  hold?: ReturnType<typeof setTimeout>;
  frame?: number;
  ghost?: HTMLElement;
  overlay?: HTMLElement;
  offsetX: number;
  offsetY: number;
  target?: string;
};

export const SORT_HOLD_MS = 350;

/** Fixed-position ghosts leave their list, so they are wrapped in class-only copies of
 *  the row's ancestors (display: contents) to keep scoped descendant selectors working. */
function overlayFor(row: HTMLElement) {
  const overlay = document.createElement('div');
  overlay.className = 'sort-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  let parent = overlay;
  const chain: Element[] = [];
  for (let node = row.parentElement; node && node !== document.body; node = node.parentElement)
    chain.unshift(node);
  for (const node of chain) {
    const copy = document.createElement('div');
    copy.className = node.getAttribute('class') ?? '';
    copy.style.display = 'contents';
    parent.append(copy);
    parent = copy;
  }
  return { overlay, parent };
}

/**
 * Drag ordering shared by tasks, activities and goals. Mouse/pen movement starts the drag;
 * touch waits for a stationary hold. The sortable element
 * carries `data-sort-id` and `data-sort-group`; only elements of the same group are targets.
 * Gestures may start on plain content or on a control marked `data-sort-handle`.
 * Touch moves stay native until the stationary hold succeeds. In particular, do not
 * set touch-action:none on rows: that also prevents ordinary list scrolling.
 */
export function useSortDrag(id: string, group: string, onMove?: Move, disabled = false) {
  const ref = useRef<HTMLElement>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const suppressClickUntil = useRef(0);
  const cancel = useRef<() => void>(() => {});
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const row = ref.current;
    if (!row || !onMove || disabled) return;
    let gesture: Gesture | null = null;
    // Cancelling (e.g. an editor opened by the same hold) does not swallow later clicks.
    cancel.current = () => stop(false);

    function stop(suppressClick = true) {
      if (!gesture) return;
      clearTimeout(gesture.hold);
      if (gesture.frame !== undefined) cancelAnimationFrame(gesture.frame);
      gesture.overlay?.remove();
      if (gesture.active) {
        // A hold that never moved stays an ordinary click (e.g. a long mouse press still
        // starts an activity); only a real drag swallows the click that follows it.
        if (suppressClick && gesture.moved) suppressClickUntil.current = performance.now() + 500;
        setDragging(false);
        document.body.classList.remove('sort-active');
      }
      gesture = null;
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchCancel);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibilityChange);
    }

    function targetAtPointer(current: Gesture) {
      const target = document
        .elementFromPoint(current.x, current.y)
        ?.closest<HTMLElement>(`[data-sort-id][data-sort-group="${CSS.escape(group)}"]`);
      const targetId = target?.dataset.sortId;
      if (targetId === id) {
        current.target = undefined;
        return;
      }
      if (!target || !targetId || targetId === current.target) return;
      // The midpoint threshold keeps a nearby item from bouncing back and forth while
      // React moves the source placeholder. Grids compare horizontally within a row.
      const source = row!.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const sameRow = Math.abs(rect.top - source.top) < Math.min(rect.height, source.height) / 2;
      if (sameRow) {
        const midpoint = rect.left + rect.width / 2;
        if (rect.left > source.left ? current.x < midpoint : current.x > midpoint) return;
      } else {
        const midpoint = rect.top + rect.height / 2;
        if (rect.top > source.top ? current.y < midpoint : current.y > midpoint) return;
      }
      current.target = targetId;
      move.current?.(id, targetId);
    }

    function updateGhost(current: Gesture) {
      if (current.ghost) {
        current.ghost.style.left = `${current.x - current.offsetX}px`;
        current.ghost.style.top = `${current.y - current.offsetY}px`;
      }
      targetAtPointer(current);
    }

    function scrollFrame() {
      const current = gesture;
      if (!current?.active) return;
      const container = row!.closest<HTMLElement>('.phone-content');
      if (container) {
        const bounds = container.getBoundingClientRect();
        const edge = Math.min(72, bounds.height / 5);
        const speed =
          current.y < bounds.top + edge
            ? -Math.min(13, (bounds.top + edge - current.y) / 5)
            : current.y > bounds.bottom - edge
              ? Math.min(13, (current.y - bounds.bottom + edge) / 5)
              : 0;
        if (speed) {
          container.scrollTop += speed;
          targetAtPointer(current);
        }
      }
      current.frame = requestAnimationFrame(scrollFrame);
    }

    function activate() {
      const current = gesture;
      if (!current || !row!.isConnected) return;
      const bounds = row!.getBoundingClientRect();
      current.active = true;
      current.offsetX = current.startX - bounds.left;
      current.offsetY = current.startY - bounds.top;
      current.ghost = row!.cloneNode(true) as HTMLElement;
      current.ghost.classList.add('sort-ghost');
      current.ghost.classList.remove('selected');
      for (const name of ['data-sort-id', 'data-sort-group', 'data-task-id', 'data-testid'])
        current.ghost.removeAttribute(name);
      current.ghost.setAttribute('aria-hidden', 'true');
      current.ghost.setAttribute('inert', '');
      current.ghost.style.width = `${bounds.width}px`;
      current.ghost.style.height = `${bounds.height}px`;
      const { overlay, parent } = overlayFor(row!);
      current.overlay = overlay;
      parent.append(current.ghost);
      document.body.append(overlay);
      document.body.classList.add('sort-active');
      window.getSelection()?.removeAllRanges();
      setDragging(true);
      updateGhost(current);
      current.frame = requestAnimationFrame(scrollFrame);
    }

    function start(
      target: EventTarget | null,
      x: number,
      y: number,
      pointerId: number | null,
      touchId: number | null,
    ) {
      if (gesture || !(target instanceof Element)) return;
      const control = target.closest(
        'button, input, textarea, select, a, summary, [contenteditable]',
      );
      if (control && !control.hasAttribute('data-sort-handle')) return;
      gesture = {
        x,
        y,
        startX: x,
        startY: y,
        pointerId,
        touchId,
        active: false,
        moved: false,
        hold: touchId !== null ? setTimeout(activate, SORT_HOLD_MS) : undefined,
        offsetX: 0,
        offsetY: 0,
      };
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerEnd);
      window.addEventListener('pointercancel', pointerEnd);
      window.addEventListener('touchmove', touchMove, { passive: false });
      window.addEventListener('touchend', touchEnd);
      window.addEventListener('touchcancel', touchCancel);
      window.addEventListener('blur', blur);
      document.addEventListener('visibilitychange', visibilityChange);
    }

    function update(x: number, y: number, event: Event) {
      const current = gesture;
      if (!current) return;
      current.x = x;
      current.y = y;
      const distance = Math.hypot(x - current.startX, y - current.startY);
      if (!current.active) {
        if (current.touchId !== null) {
          if (distance > 9) stop();
        } else if (distance >= 5) {
          if (event.cancelable) event.preventDefault();
          current.moved = true;
          activate();
        }
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (distance > 9) current.moved = true;
      updateGhost(current);
    }

    function pointerStart(event: PointerEvent) {
      if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
      start(event.target, event.clientX, event.clientY, event.pointerId, null);
    }
    function pointerMove(event: PointerEvent) {
      if (gesture?.pointerId === event.pointerId) update(event.clientX, event.clientY, event);
      // Chrome withholds touchmove inside its touch slop but still sends pointermove, so a
      // small touch movement before the hold must cancel here too.
      else if (event.pointerType === 'touch' && gesture?.touchId != null && !gesture.active)
        update(event.clientX, event.clientY, event);
    }
    function pointerEnd(event: PointerEvent) {
      if (gesture?.pointerId === event.pointerId) stop();
    }
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        stop();
        return;
      }
      const touch = event.touches[0];
      start(event.target, touch.clientX, touch.clientY, null, touch.identifier);
    }
    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 1) {
        stop();
        return;
      }
      const touch = Array.from(event.touches).find((item) => item.identifier === gesture?.touchId);
      if (touch) update(touch.clientX, touch.clientY, event);
    }
    function touchEnd(event: TouchEvent) {
      if (Array.from(event.changedTouches).some((touch) => touch.identifier === gesture?.touchId)) {
        if (gesture?.active && event.cancelable) event.preventDefault();
        stop();
      }
    }
    function touchCancel() {
      stop();
    }
    function blur() {
      stop();
    }
    function contextMenu(event: Event) {
      if (gesture) event.preventDefault();
    }
    function nativeDragStart(event: DragEvent) {
      // Text, links and images must not replace the shared pointer gesture with a
      // browser drag session, which otherwise stops delivering pointer events.
      event.preventDefault();
    }
    function visibilityChange() {
      if (document.hidden) stop();
    }
    row.addEventListener('pointerdown', pointerStart);
    row.addEventListener('touchstart', touchStart, { passive: true });
    row.addEventListener('contextmenu', contextMenu);
    row.addEventListener('dragstart', nativeDragStart);
    return () => {
      stop();
      row.removeEventListener('pointerdown', pointerStart);
      row.removeEventListener('touchstart', touchStart);
      row.removeEventListener('contextmenu', contextMenu);
      row.removeEventListener('dragstart', nativeDragStart);
      cancel.current = () => {};
    };
  }, [id, group, disabled, !!onMove]);

  return {
    ref,
    dragging,
    /** Ends a pending or active gesture without moving anything. */
    cancel: () => cancel.current(),
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (dragging || performance.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
