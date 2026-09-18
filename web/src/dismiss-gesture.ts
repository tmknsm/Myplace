import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

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

type Point = { x: number; y: number };

/**
 * Pointer + touch on the same node. Chrome's device-mode touch path often
 * skips pointermove, so touchmove itself has to drive the drag (and must
 * be non-passive so we can preventDefault).
 */
export function bindPressDrag(
  node: HTMLElement,
  handlers: {
    onStart: (point: Point, target: EventTarget | null) => boolean;
    onMove: (point: Point, event: Event) => void;
    onEnd: (point: Point) => void;
  },
): () => void {
  let active: "pointer" | "touch" | null = null;
  let pointerId: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (active) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType === "touch") return; // touch* handlers own fingers
    if (!handlers.onStart({ x: event.clientX, y: event.clientY }, event.target)) return;
    active = "pointer";
    pointerId = event.pointerId;
    node.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (active !== "pointer" || event.pointerId !== pointerId) return;
    handlers.onMove({ x: event.clientX, y: event.clientY }, event);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (active !== "pointer" || event.pointerId !== pointerId) return;
    active = null;
    pointerId = null;
    node.releasePointerCapture?.(event.pointerId);
    handlers.onEnd({ x: event.clientX, y: event.clientY });
  };

  const onTouchStart = (event: TouchEvent) => {
    if (active) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (!handlers.onStart({ x: touch.clientX, y: touch.clientY }, event.target)) return;
    active = "touch";
  };
  const onTouchMove = (event: TouchEvent) => {
    if (active !== "touch") return;
    const touch = event.touches[0];
    if (!touch) return;
    handlers.onMove({ x: touch.clientX, y: touch.clientY }, event);
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (active !== "touch") return;
    active = null;
    const touch = event.changedTouches[0];
    handlers.onEnd({ x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 });
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", onPointerUp);
  node.addEventListener("pointercancel", onPointerUp);
  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: false });
  node.addEventListener("touchend", onTouchEnd);
  node.addEventListener("touchcancel", onTouchEnd);
  return () => {
    node.removeEventListener("pointerdown", onPointerDown);
    node.removeEventListener("pointermove", onPointerMove);
    node.removeEventListener("pointerup", onPointerUp);
    node.removeEventListener("pointercancel", onPointerUp);
    node.removeEventListener("touchstart", onTouchStart);
    node.removeEventListener("touchmove", onTouchMove);
    node.removeEventListener("touchend", onTouchEnd);
    node.removeEventListener("touchcancel", onTouchEnd);
  };
}

type AxisLock = "pending" | "x" | "y";

/**
 * Vertical flick-to-dismiss for the photo lightbox. Horizontal travel pages
 * the snap track; once the gesture locks to Y the photo follows the finger
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
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const motionRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const dragged = useRef(false);
  const closeTimer = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), DISMISS_MS);
  }, []);

  useEffect(() => {
    const node = motionRef.current;
    if (!node || !enabled || leavingRef.current) return;

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let lock: AxisLock = "pending";
    let startScroll = 0;

    const beginY = () => {
      lock = "y";
      dragged.current = true;
      rootRef.current?.classList.add("is-dragging");
      const motion = motionRef.current;
      if (motion) motion.style.transition = "none";
      if (rootRef.current) rootRef.current.style.transition = "none";
    };

    const unbind = bindPressDrag(node, {
      onStart: (point, target) => {
        if (leavingRef.current) return false;
        if (isInteractiveTarget(target)) return false;
        dragged.current = false;
        startX = point.x;
        startY = point.y;
        lastY = point.y;
        lastT = performance.now();
        velocity = 0;
        lock = "pending";
        startScroll = trackRef.current?.scrollLeft ?? 0;
        return true;
      },
      onMove: (point, event) => {
        const sample = sampleVelocity(lastY, lastT, point.y, performance.now());
        velocity = sample.velocity;
        lastY = sample.lastY;
        lastT = sample.lastT;
        const dx = point.x - startX;
        const dy = point.y - startY;

        if (lock === "pending") {
          if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
          if (Math.abs(dy) > Math.abs(dx) * 1.15) beginY();
          else lock = "x";
        }

        if (lock === "x") {
          const track = trackRef.current;
          if (track) track.scrollLeft = startScroll - dx;
          return;
        }

        if (lock !== "y") return;
        if (event.cancelable) event.preventDefault();
        apply(dy);
      },
      onEnd: (point) => {
        if (lock === "x") {
          const track = trackRef.current;
          if (track) {
            const width = track.clientWidth || 1;
            const next = Math.round(track.scrollLeft / width);
            track.scrollTo({ left: next * width, behavior: "smooth" });
          }
          return;
        }
        if (lock !== "y" || leavingRef.current) return;
        const dy = point.y - startY;
        const height = rootRef.current?.offsetHeight || window.innerHeight;
        if (dismissIntent(dy, velocity, height, "vertical")) {
          flyAway(dy, velocity);
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
        root?.classList.remove("is-dragging");
        window.setTimeout(clearInline, DISMISS_MS);
      },
    });

    return unbind;
  }, [enabled, flyAway, leaving]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return { rootRef, motionRef, trackRef, dragged, leaving };
}
