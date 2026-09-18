import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AXIS_LOCK,
  DISMISS_EASE,
  DISMISS_MS,
  dismissIntent,
  isInteractiveTarget,
  sampleVelocity,
} from "./dismiss-gesture";

type Phase = "closed" | "open" | "closing";
type DragMode = "pending" | "sheet" | "scroll";

/**
 * Every owner edit on the property page lives in one of these. On phones it
 * rises from the bottom like a native iOS sheet over a black scrim; on wide
 * screens it is a centered card over the same scrim. `half` is the medium
 * detent: same chrome and motion, about half the viewport. Dismiss by the
 * close button, Escape, tapping the backdrop, or flicking the sheet down —
 * from the grabber, or from the body when it is already scrolled to the top.
 *
 * Callers own the `open` flag and keep children mounted; the sheet stays in
 * the tree just long enough to animate out.
 */
export function Sheet({
  open,
  title,
  lede,
  onClose,
  children,
  testId,
  wide = false,
  half = false,
}: {
  open: boolean;
  title: string;
  lede?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
  half?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(0);
  const dragDismiss = useRef(false);

  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    if (open) {
      dragDismiss.current = false;
      setPhase("open");
      return;
    }
    if (phaseRef.current === "closed") return;
    setPhase("closing");
    closeTimer.current = window.setTimeout(() => setPhase("closed"), DISMISS_MS);
    return () => window.clearTimeout(closeTimer.current);
  }, [open]);

  useLockPageScroll(phase !== "closed");

  useEffect(() => {
    if (phase !== "open") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const drag = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    mode: DragMode;
    fromHandle: boolean;
  } | null>(null);

  const bodyAtTop = () => (bodyRef.current?.scrollTop ?? 0) <= 0;

  const beginSheetDrag = (state: NonNullable<typeof drag.current>, target: HTMLElement) => {
    state.mode = "sheet";
    const panel = panelRef.current;
    if (panel) {
      panel.style.transition = "none";
      panel.style.animation = "none";
    }
    if (backdropRef.current) backdropRef.current.style.transition = "none";
    if (bodyRef.current) bodyRef.current.style.overflow = "hidden";
    target.setPointerCapture?.(state.pointerId);
  };

  const applySheetDrag = (dy: number) => {
    const panel = panelRef.current;
    if (!panel) return;
    const offset = Math.max(0, dy);
    panel.style.transform = `translate3d(0, ${offset}px, 0)`;
    if (backdropRef.current) {
      const fade = Math.max(0.28, 1 - offset / (panel.offsetHeight || 640));
      backdropRef.current.style.setProperty("--sheet-dim", String(fade));
    }
  };

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (phaseRef.current !== "open") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    const fromHandle = Boolean((event.target as Element).closest?.(".sheet-panel-head"));
    const state = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: performance.now(),
      velocity: 0,
      mode: (fromHandle ? "sheet" : "pending") as DragMode,
      fromHandle,
    };
    drag.current = state;
    if (fromHandle) beginSheetDrag(state, event.currentTarget);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const sample = sampleVelocity(state.lastY, state.lastT, event.clientY, performance.now());
    state.velocity = sample.velocity;
    state.lastY = sample.lastY;
    state.lastT = sample.lastT;

    if (state.mode === "pending") {
      const dy = event.clientY - state.startY;
      if (Math.abs(dy) < AXIS_LOCK) return;
      if (dy > 0 && (state.fromHandle || bodyAtTop())) {
        beginSheetDrag(state, event.currentTarget);
      } else {
        state.mode = "scroll";
        return;
      }
    }

    if (state.mode !== "sheet") return;
    event.preventDefault();
    applySheetDrag(event.clientY - state.startY);
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!state || !panel) return;
    if (state.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (bodyRef.current) bodyRef.current.style.overflow = "";
    if (state.mode !== "sheet") return;

    const dy = Math.max(0, event.clientY - state.startY);
    const height = panel.offsetHeight || 640;
    const dismiss = dismissIntent(dy, state.velocity, height, "down");
    panel.style.transition = `transform ${DISMISS_MS}ms ${DISMISS_EASE}`;
    if (backdropRef.current) backdropRef.current.style.transition = "";
    if (dismiss) {
      dragDismiss.current = true;
      panel.style.transform = "translate3d(0, 110%, 0)";
      onClose();
      return;
    }
    panel.style.transform = "";
    panel.style.animation = "";
    backdropRef.current?.style.removeProperty("--sheet-dim");
    window.setTimeout(() => { if (panel) panel.style.transition = ""; }, DISMISS_MS);
  }, [onClose]);

  // Native touchmove is passive at React's root; we need preventDefault so a
  // downward flick from the top of the list cannot rubber-band the body scroll.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || phase !== "open") return;
    const onTouchMove = (event: TouchEvent) => {
      const state = drag.current;
      if (!state) return;
      const y = event.touches[0]?.clientY;
      if (y == null) return;
      if (state.mode === "sheet") {
        event.preventDefault();
        return;
      }
      if (state.mode === "pending" && y > state.startY && (state.fromHandle || bodyAtTop())) {
        event.preventDefault();
      }
    };
    panel.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => panel.removeEventListener("touchmove", onTouchMove);
  }, [phase]);

  if (phase === "closed") return null;

  return createPortal(
    <div
      ref={backdropRef}
      className={`sheet-backdrop-v2${phase === "closing" ? " is-closing" : ""}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onWheel={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }}
    >
      <div
        ref={panelRef}
        className={`sheet-panel${wide ? " is-wide" : ""}${half ? " is-half" : ""}${phase === "closing" ? " is-closing" : ""}${dragDismiss.current ? " is-drag-dismiss" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        data-testid={testId ?? "sheet"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <header className="sheet-panel-head">
          <i className="sheet-grabber" aria-hidden="true" />
          <div className="sheet-panel-title">
            <h2 id="sheet-title">{title}</h2>
            {lede && <p className="meta-line">{lede}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div ref={bodyRef} className="sheet-panel-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Freeze the page while a sheet is up. html is the viewport scroller, so body
 * is pinned at the current offset and restored on close.
 */
export function useLockPageScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    html.classList.add("dialog-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      html.classList.remove("dialog-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}

/** Open/close state plus a key that resets the form each time the sheet opens. */
export function useSheet(): { open: boolean; seq: number; show: () => void; hide: () => void } {
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(0);
  const show = useCallback(() => { setSeq((n) => n + 1); setOpen(true); }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, seq, show, hide };
}
