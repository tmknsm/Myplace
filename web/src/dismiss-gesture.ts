import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Shared flick-to-dismiss physics for the photo lightbox and bottom sheets. */

export const DISMISS_MS = 280;
export const DISMISS_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const AXIS_LOCK = 10;
export const DISMISS_DISTANCE = 100;
export const DISMISS_VELOCITY = 0.36; // px per ms — a short flick, not a slam
export const DISMISS_FLICK_MIN = 18;

export type DismissAxis = "down" | "vertical";

export function dismissIntent(
  offset: number,
  velocity: number,
  size: number,
  axis: DismissAxis,
): boolean {
  const traveled = axis === "down" ? Math.max(0, offset) : Math.abs(offset);
  const threshold = Math.min(DISMISS_DISTANCE, Math.max(72, size * 0.16));
  if (traveled >= threshold) return true;
  const sameWay = axis === "down"
    ? velocity > 0
    : offset === 0 || Math.sign(velocity) === Math.sign(offset);
  return traveled >= DISMISS_FLICK_MIN && sameWay && Math.abs(velocity) >= DISMISS_VELOCITY;
}

export function dismissDirection(offset: number, velocity: number): 1 | -1 {
  const lead = Math.abs(velocity) >= 0.08 ? velocity : offset;
  return lead < 0 ? -1 : 1;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest("button, a, input, select, textarea, label, [role='tab']"),
  );
}

export function sampleVelocity(
  lastY: number,
  lastT: number,
  y: number,
  now: number,
): { velocity: number; lastY: number; lastT: number } {
  const dt = Math.max(1, now - lastT);
  return { velocity: (y - lastY) / dt, lastY: y, lastT: now };
}

type AxisLock = "pending" | "x" | "y";

/**
 * Vertical flick-to-dismiss for the photo lightbox. Horizontal travel is left
 * to the snap track; once the gesture locks to Y the photo follows the finger
 * up or down and a flick or a long drag closes it.
 */
export function useLightboxDismiss(
  enabled: boolean,
  onClose: () => void,
): {
  rootRef: RefObject<HTMLDivElement | null>;
  motionRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  dragged: RefObject<boolean>;
  leaving: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const motionRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const dragged = useRef(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    lock: AxisLock;
  } | null>(null);
  const closeTimer = useRef(0);

  const apply = (dy: number) => {
    const motion = motionRef.current;
    const root = rootRef.current;
    if (!motion || !root) return;
    const height = root.offsetHeight || window.innerHeight;
    const progress = Math.min(1, Math.abs(dy) / height);
    const scale = 1 - progress * 0.08;
    motion.style.transform = `translate3d(0, ${dy}px, 0) scale(${scale})`;
    motion.style.opacity = String(1 - progress * 0.12);
    root.style.background = `rgba(0, 0, 0, ${1 - progress * 0.72})`;
  };

  const clearInline = () => {
    const motion = motionRef.current;
    const root = rootRef.current;
    if (motion) {
      motion.style.transform = "";
      motion.style.opacity = "";
      motion.style.transition = "";
    }
    if (root) {
      root.style.background = "";
      root.style.transition = "";
    }
    if (trackRef.current) trackRef.current.style.overflow = "";
    rootRef.current?.classList.remove("is-dragging");
  };

  const flyAway = useCallback((offset: number, velocity: number) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    const motion = motionRef.current;
    const root = rootRef.current;
    const dir = dismissDirection(offset, velocity);
    const distance = Math.max(window.innerHeight, 720);
    if (motion) {
      motion.style.transition = `transform ${DISMISS_MS}ms ${DISMISS_EASE}, opacity ${DISMISS_MS}ms ease`;
      motion.style.transform = `translate3d(0, ${dir * distance}px, 0) scale(0.9)`;
      motion.style.opacity = "0";
    }
    if (root) {
      root.style.transition = `background ${DISMISS_MS}ms ease`;
      root.style.background = "rgba(0, 0, 0, 0)";
      root.classList.remove("is-dragging");
      root.classList.add("is-dismissing");
    }
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(onClose, DISMISS_MS);
  }, [onClose]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || leavingRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    dragged.current = false;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: performance.now(),
      velocity: 0,
      lock: "pending",
    };
  }, [enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || leavingRef.current) return;
    const sample = sampleVelocity(state.lastY, state.lastT, event.clientY, performance.now());
    state.velocity = sample.velocity;
    state.lastY = sample.lastY;
    state.lastT = sample.lastT;

    if (state.lock === "pending") {
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        state.lock = "y";
        dragged.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        rootRef.current?.classList.add("is-dragging");
        if (trackRef.current) trackRef.current.style.overflow = "hidden";
        const motion = motionRef.current;
        if (motion) motion.style.transition = "none";
        if (rootRef.current) rootRef.current.style.transition = "none";
      } else {
        state.lock = "x";
        return;
      }
    }

    if (state.lock !== "y") return;
    event.preventDefault();
    apply(event.clientY - state.startY);
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state || state.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (state.lock !== "y" || leavingRef.current) return;

    const dy = event.clientY - state.startY;
    const height = rootRef.current?.offsetHeight || window.innerHeight;
    if (dismissIntent(dy, state.velocity, height, "vertical")) {
      flyAway(dy, state.velocity);
      return;
    }
    const motion = motionRef.current;
    const root = rootRef.current;
    if (motion) {
      motion.style.transition = `transform ${DISMISS_MS}ms ${DISMISS_EASE}, opacity ${DISMISS_MS}ms ease`;
      motion.style.transform = "";
      motion.style.opacity = "";
    }
    if (root) {
      root.style.transition = `background ${DISMISS_MS}ms ease`;
      root.style.background = "";
    }
    if (trackRef.current) trackRef.current.style.overflow = "";
    root?.classList.remove("is-dragging");
    window.setTimeout(clearInline, DISMISS_MS);
  }, [flyAway]);

  useEffect(() => {
    const node = motionRef.current;
    if (!node || !enabled) return;
    const onTouchMove = (event: TouchEvent) => {
      const state = drag.current;
      if (!state) return;
      if (state.lock === "y") {
        event.preventDefault();
        return;
      }
      if (state.lock !== "pending") return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - state.startX;
      const dy = touch.clientY - state.startY;
      if (Math.abs(dy) > AXIS_LOCK && Math.abs(dy) > Math.abs(dx) * 1.15) {
        event.preventDefault();
      }
    };
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => node.removeEventListener("touchmove", onTouchMove);
  }, [enabled]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return { rootRef, motionRef, trackRef, dragged, leaving, onPointerDown, onPointerMove, onPointerUp };
}
