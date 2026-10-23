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
  hold: ReturnType<typeof setTimeout>;
  frame?: number;
  ghost?: HTMLElement;
  overlay?: HTMLElement;
  offsetX: number;
  offsetY: number;
  target?: string;
};

// Touch moves stay native until the stationary hold succeeds. In particular, do
// not set touch-action:none on rows: that also prevents ordinary list scrolling.
export function useTaskDrag(id: string, onMove?: Move, disabled = false) {
  const ref = useRef<HTMLElement>(null);
  const move = useRef(onMove);
  move.current = onMove;
  const suppressClickUntil = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const row = ref.current;
    if (!row || !onMove || disabled) return;
    let gesture: Gesture | null = null;

    function stop() {
      if (!gesture) return;
      clearTimeout(gesture.hold);
      if (gesture.frame !== undefined) cancelAnimationFrame(gesture.frame);
      gesture.overlay?.remove();
      if (gesture.active) {
        suppressClickUntil.current = Date.now() + 500;
        setDragging(false);
        document.body.classList.remove('task-sort-active');
      }
      gesture = null;
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchCancel);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibilityChange);
    }

    function targetAtPointer(current: Gesture) {
      const target = document
        .elementFromPoint(current.x, current.y)
        ?.closest<HTMLElement>('[data-task-id][data-task-sortable="true"]');
      const targetId = target?.dataset.taskId;
      if (targetId === id) {
        current.target = undefined;
        return;
      }
      if (!target || !targetId || targetId === current.target) return;
      // The midpoint threshold keeps a nearby row from bouncing back and forth
      // while React moves the source placeholder into its new position.
      const sourceRect = row!.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const midpoint = targetRect.top + targetRect.height / 2;
      if (targetRect.top > sourceRect.top ? current.y < midpoint : current.y > midpoint) return;
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
      current.ghost.classList.add('task-sort-ghost');
      current.ghost.classList.remove('selected');
      current.ghost.removeAttribute('data-task-id');
      current.ghost.removeAttribute('data-testid');
      current.ghost.setAttribute('aria-hidden', 'true');
      current.ghost.setAttribute('inert', '');
      current.ghost.style.width = `${bounds.width}px`;
      current.ghost.style.height = `${bounds.height}px`;
      current.overlay = document.createElement('div');
      current.overlay.className = `task-sort-overlay ${row!.closest('.phone-tasks') ? 'phone-tasks' : ''}`;
      current.overlay.setAttribute('aria-hidden', 'true');
      current.overlay.append(current.ghost);
      document.body.append(current.overlay);
      document.body.classList.add('task-sort-active');
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
      const control = target.closest('button, input, textarea, select, a, [contenteditable]');
      if (control && !control.classList.contains('task-body')) return;
      gesture = {
        x,
        y,
        startX: x,
        startY: y,
        pointerId,
        touchId,
        active: false,
        hold: setTimeout(activate, 350),
        offsetX: 0,
        offsetY: 0,
      };
      window.addEventListener('pointermove', pointerMove);
      window.addEventListener('pointerup', pointerEnd);
      window.addEventListener('pointercancel', pointerEnd);
      window.addEventListener('touchmove', touchMove, { passive: false });
      window.addEventListener('touchend', touchEnd);
      window.addEventListener('touchcancel', touchCancel);
      window.addEventListener('blur', stop);
      document.addEventListener('visibilitychange', visibilityChange);
    }

    function update(x: number, y: number, event: Event) {
      const current = gesture;
      if (!current) return;
      current.x = x;
      current.y = y;
      if (!current.active) {
        if (Math.hypot(x - current.startX, y - current.startY) > 9) stop();
        return;
      }
      if (event.cancelable) event.preventDefault();
      updateGhost(current);
    }

    function pointerStart(event: PointerEvent) {
      if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
      start(event.target, event.clientX, event.clientY, event.pointerId, null);
    }
    function pointerMove(event: PointerEvent) {
      if (gesture?.pointerId === event.pointerId) update(event.clientX, event.clientY, event);
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
    function contextMenu(event: Event) {
      if (gesture) event.preventDefault();
    }
    function visibilityChange() {
      if (document.hidden) stop();
    }
    row.addEventListener('pointerdown', pointerStart);
    row.addEventListener('touchstart', touchStart, { passive: true });
    row.addEventListener('contextmenu', contextMenu);
    row.addEventListener('dragstart', stop);
    return () => {
      stop();
      row.removeEventListener('pointerdown', pointerStart);
      row.removeEventListener('touchstart', touchStart);
      row.removeEventListener('contextmenu', contextMenu);
      row.removeEventListener('dragstart', stop);
    };
  }, [id, disabled, !!onMove]);

  return {
    ref,
    dragging,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (dragging || Date.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
