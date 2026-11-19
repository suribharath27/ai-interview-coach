import {
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  /** Window bounds resolved — safe to call setPosition. */
  ready: boolean;
  moved: boolean;
};

const INTERACTIVE =
  "button, input, textarea, select, a, label, option, .cue-menu, .cue-answer-body, .cue-live-transcript, .cue-question-input, .cue-input-wrap, .cue-menu-opacity, .interview-menu, .rail-popover";

/** Pixels (manhattan) before a press counts as a drag, not a tap. */
const TAP_SLOP = 6;

function shouldIgnoreDrag(
  target: EventTarget | null,
  current: EventTarget | null
) {
  if (!(target instanceof Element) || !(current instanceof Element)) return true;
  const interactive = target.closest(INTERACTIVE);
  if (!interactive) return false;
  // Pressing the drag root itself (e.g. float chip button) is allowed.
  if (interactive === current) return false;
  return current.contains(interactive);
}

/**
 * Drag the Electron window from an overlay/float surface.
 * Optional onTap fires only for a true click (pointer barely moved).
 * Buttons must not also wire onClick — use onTap via this hook, and keep the
 * returned onClick so ghost clicks after a drag are swallowed.
 */
export function useFloatDrag(onTap?: () => void) {
  const dragRef = useRef<DragState | null>(null);
  /** Suppress the synthetic click that browsers fire after a drag on <button>. */
  const suppressClickRef = useRef(false);

  const onPointerDown = useCallback(
    async (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if (shouldIgnoreDrag(e.target, e.currentTarget)) return;

      const startX = e.screenX;
      const startY = e.screenY;
      const pointerId = e.pointerId;
      suppressClickRef.current = false;
      e.currentTarget.setPointerCapture(pointerId);

      // Seed immediately so early moves aren't dropped while bounds load.
      dragRef.current = {
        pointerId,
        startX,
        startY,
        originX: startX,
        originY: startY,
        ready: false,
        moved: false,
      };

      const bounds = await window.meetingCue?.getBounds?.();
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== pointerId) return;
      if (!bounds) {
        // Browser preview / missing API — cancel drag.
        dragRef.current = null;
        return;
      }
      drag.originX = bounds.x;
      drag.originY = bounds.y;
      drag.ready = true;
    },
    []
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.screenX - drag.startX;
    const dy = e.screenY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > TAP_SLOP) drag.moved = true;
    if (!drag.ready) return;
    void window.meetingCue?.setPosition?.(drag.originX + dx, drag.originY + dy);
  }, []);

  const finishPointer = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;

      if (cancelled) {
        suppressClickRef.current = drag.moved;
        return;
      }

      if (drag.moved) {
        // Swallow the click that follows pointerup on <button>.
        suppressClickRef.current = true;
        e.preventDefault();
        return;
      }

      onTap?.();
    },
    [onTap]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => finishPointer(e, false),
    [finishPointer]
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => finishPointer(e, true),
    [finishPointer]
  );

  const onClick = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClick,
    style: { touchAction: "none", cursor: "default" } as const,
  };
}
