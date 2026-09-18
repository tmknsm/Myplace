import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Shared flick-to-dismiss physics for the photo lightbox and bottom sheets. */

export const DISMISS_MS = 280;
export const DISMISS_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const AXIS_LOCK = 10;
export const DISMISS_DISTANCE = 100;
export const DISMISS_VELOCITY = 0.36; // px per ms — a short flick, not a slam
export const DISMISS_FLICK_MIN = 18;

export type DismissAxis = "down" | "vertical";
export type AxisLock = "pending" | "x" | "y";
export type SheetDragMode = "pending" | "sheet" | "scroll";

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

/** Lock the lightbox to paging (x) or dismiss (y) once the finger has chosen. */
export function lockFromTravel(dx: number, dy: number, threshold = AXIS_LOCK): AxisLock {
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return "pending";
  return Math.abs(dy) > Math.abs(dx) * 1.15 ? "y" : "x";
}

/** Pulling down on a sheet (or its scrolled-to-top body) owns the gesture. */
export function sheetModeFromTravel(
  dy: number,
  canDismiss: boolean,
  threshold = AXIS_LOCK,
): SheetDragMode {
  if (Math.abs(dy) < threshold) return "pending";
  return dy > 0 && canDismiss ? "sheet" : "scroll";
}

/** True when every overflow ancestor between the press and the sheet is at top. */
export function scrollChainAtTop(target: EventTarget | null, root: HTMLElement | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== root) {
    const style = typeof getComputedStyle === "function" ? getComputedStyle(node) : undefined;
    const overflowY = style?.overflowY ?? "";
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      && node.scrollHeight > node.clientHeight + 1
    ) {
      return node.scrollTop <= 0;
    }
    node = node.parentElement;
  }
  return (root?.scrollTop ?? 0) <= 0;
}

type Point = { x: number; y: number };
export type DragInput = "mouse" | "touch" | "pen";

/**
 * Press-drag that survives Chrome device-mode and automation gaps.
 * Pointer events cover mouse and most fingers. Window-level move/end
 * listeners (plus touchmove, non-passive) keep the surface under the
 * finger when the node itself never sees pointermove. When the browser
 * claims the gesture for native scrolling (pointercancel) the drag is
 * cancelled rather than finished.
 */
export function bindPressDrag(
  node: HTMLElement,
  handlers: {
    onStart: (point: Point, target: EventTarget | null, input: DragInput) => boolean;
    onMove: (point: Point, event: Event) => void;
    onEnd: (point: Point) => void;
    onCancel?: () => void;
  },
): () => void {
  let armed = false;
  let pointerId: number | null = null;
  const windowListeners: Array<() => void> = [];

  const detachWindow = () => {
    while (windowListeners.length) windowListeners.pop()?.();
  };

  const onWin = <K extends keyof WindowEventMap>(
    type: K,
    fn: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ) => {
    window.addEventListener(type, fn, options);
    windowListeners.push(() => window.removeEventListener(type, fn, options));
  };

  const finish = (point: Point) => {
    if (!armed) return;
    armed = false;
    pointerId = null;
    detachWindow();
    handlers.onEnd(point);
  };

  const cancel = () => {
    if (!armed) return;
    armed = false;
    pointerId = null;
    detachWindow();
    handlers.onCancel?.();
  };

  const attachWindow = () => {
    detachWindow();
    onWin("pointermove", (event) => {
      if (!armed) return;
      if (pointerId != null && event.pointerId !== pointerId) return;
      handlers.onMove({ x: event.clientX, y: event.clientY }, event);
    }, { capture: true });
    onWin("mousemove", (event) => {
      if (!armed || event.buttons === 0) return;
      handlers.onMove({ x: event.clientX, y: event.clientY }, event);
    }, { capture: true });
    const onTouchMove = (event: TouchEvent) => {
      if (!armed) return;
      const touch = event.touches[0];
      if (!touch) return;
      handlers.onMove({ x: touch.clientX, y: touch.clientY }, event);
    };
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    windowListeners.push(() => {
      window.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
    });
    onWin("pointerup", (event) => {
      if (pointerId != null && event.pointerId !== pointerId) return;
      finish({ x: event.clientX, y: event.clientY });
    }, { capture: true });
    onWin("pointercancel", (event) => {
      if (pointerId != null && event.pointerId !== pointerId) return;
      cancel();
    }, { capture: true });
    onWin("mouseup", (event) => finish({ x: event.clientX, y: event.clientY }), { capture: true });
    onWin("touchend", (event) => {
      const touch = event.changedTouches[0];
      finish({ x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 });
    }, { capture: true });
    onWin("touchcancel", () => cancel(), { capture: true });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (armed) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const input: DragInput = event.pointerType === "pen" ? "pen" : event.pointerType === "touch" ? "touch" : "mouse";
    if (!handlers.onStart({ x: event.clientX, y: event.clientY }, event.target, input)) return;
    armed = true;
    pointerId = event.pointerId;
    if (input === "mouse") {
      try { node.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    }
    attachWindow();
  };

  const onTouchStart = (event: TouchEvent) => {
    if (armed) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (!handlers.onStart({ x: touch.clientX, y: touch.clientY }, event.target, "touch")) return;
    armed = true;
    attachWindow();
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("touchstart", onTouchStart, { passive: true });
  return () => {
    armed = false;
    detachWindow();
    node.removeEventListener("pointerdown", onPointerDown);
    node.removeEventListener("touchstart", onTouchStart);
  };
}

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
    let input: DragInput = "mouse";

    const beginY = () => {
      lock = "y";
      dragged.current = true;
      rootRef.current?.classList.add("is-dragging");
      const motion = motionRef.current;
      if (motion) motion.style.transition = "none";
      if (rootRef.current) rootRef.current.style.transition = "none";
    };

    // Fingers page the snap track natively (touch-action: pan-x). Only a
    // mouse needs us to move the track by hand.
    const beginX = () => {
      lock = "x";
      dragged.current = true;
      if (input === "mouse") rootRef.current?.classList.add("is-paging");
    };

    const settleTrack = () => {
      const track = trackRef.current;
      const root = rootRef.current;
      if (!track || input !== "mouse") return;
      const width = track.clientWidth || 1;
      const next = Math.round(track.scrollLeft / width);
      track.scrollTo({ left: next * width, behavior: "smooth" });
      window.setTimeout(() => root?.classList.remove("is-paging"), DISMISS_MS + 120);
    };

    const springBack = () => {
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
    };

    const unbind = bindPressDrag(node, {
      onStart: (point, target, kind) => {
        if (leavingRef.current) return false;
        if (isInteractiveTarget(target)) return false;
        dragged.current = false;
        input = kind;
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
          const next = lockFromTravel(dx, dy);
          if (next === "pending") return;
          if (next === "y") beginY();
          else beginX();
        }

        if (lock === "x") {
          const track = trackRef.current;
          if (track && input === "mouse") track.scrollLeft = startScroll - dx;
          return;
        }

        if (lock !== "y") return;
        if (event.cancelable) event.preventDefault();
        apply(dy);
      },
      onEnd: (point) => {
        const dx = point.x - startX;
        const dy = point.y - startY;
        if (Math.abs(dx) >= 6 || Math.abs(dy) >= 6) dragged.current = true;
        if (lock === "pending") {
          const inferred = lockFromTravel(dx, dy);
          if (inferred === "y") beginY();
          else if (inferred === "x") beginX();
        }
        if (lock === "x") {
          settleTrack();
          return;
        }
        if (lock !== "y" || leavingRef.current) return;
        const height = rootRef.current?.offsetHeight || window.innerHeight;
        if (dismissIntent(dy, velocity, height, "vertical")) {
          flyAway(dy, velocity);
          return;
        }
        springBack();
      },
      onCancel: () => {
        // The browser took the gesture for a native swipe between photos.
        if (lock === "y") springBack();
        else rootRef.current?.classList.remove("is-paging");
        dragged.current = lock !== "pending";
      },
    });

    return unbind;
  }, [enabled, flyAway, leaving]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return { rootRef, motionRef, trackRef, dragged, leaving };
}
