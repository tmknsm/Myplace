import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 260;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.55; // px per ms

type Phase = "closed" | "open" | "closing";

/**
 * Every owner edit on the property page lives in one of these. On phones it
 * rises from the bottom like a native iOS sheet while the page behind recedes
 * and rounds off; on wide screens it is a centered card. Dismiss by the
 * close button, Escape, tapping the backdrop, or dragging the header down.
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
}: {
  open: boolean;
  title: string;
  lede?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(0);

  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    if (open) {
      setPhase("open");
      return;
    }
    if (phaseRef.current === "closed") return;
    setPhase("closing");
    closeTimer.current = window.setTimeout(() => setPhase("closed"), EXIT_MS);
    return () => window.clearTimeout(closeTimer.current);
  }, [open]);

  useLockPageScroll(phase !== "closed", phase === "open");

  useEffect(() => {
    if (phase !== "open") return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  // Drag the header to pull the sheet down. Tracks a single pointer; the body
  // keeps its own scroll so a drag never fights a scrolling form.
  const drag = useRef<{ startY: number; lastY: number; lastT: number; velocity: number } | null>(null);
  const onHandleDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    drag.current = { startY: event.clientY, lastY: event.clientY, lastT: performance.now(), velocity: 0 };
    const panel = panelRef.current;
    if (panel) panel.style.transition = "none";
    if (backdropRef.current) backdropRef.current.style.transition = "none";
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, []);
  const onHandleMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    const panel = panelRef.current;
    if (!state || !panel) return;
    const now = performance.now();
    const dy = Math.max(0, event.clientY - state.startY);
    const dt = Math.max(1, now - state.lastT);
    state.velocity = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastT = now;
    panel.style.transform = `translate3d(0, ${dy}px, 0)`;
    if (backdropRef.current) {
      const fade = Math.max(0.35, 1 - dy / (panel.offsetHeight || 600));
      backdropRef.current.style.setProperty("--sheet-dim", String(fade));
    }
  }, []);
  const onHandleUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!state || !panel) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const dy = Math.max(0, event.clientY - state.startY);
    const dismiss = dy > DISMISS_DISTANCE || (dy > 24 && state.velocity > DISMISS_VELOCITY);
    panel.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    if (backdropRef.current) backdropRef.current.style.transition = "";
    if (dismiss) {
      // Keep sliding from where the finger let go; the closing phase fades the
      // backdrop and lets the page behind settle back at the same time.
      panel.style.transform = "translate3d(0, 110%, 0)";
      onClose();
      return;
    }
    panel.style.transform = "";
    backdropRef.current?.style.removeProperty("--sheet-dim");
    window.setTimeout(() => { if (panel) panel.style.transition = ""; }, EXIT_MS);
  }, [onClose]);

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
        className={`sheet-panel${wide ? " is-wide" : ""}${phase === "closing" ? " is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        data-testid={testId ?? "sheet"}
      >
        <header
          className="sheet-panel-head"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <i className="sheet-grabber" aria-hidden="true" />
          <div className="sheet-panel-title">
            <h2 id="sheet-title">{title}</h2>
            {lede && <p className="meta-line">{lede}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="sheet-panel-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Freeze the page while a sheet is up. html is the viewport scroller, so body
 * is pinned at the current offset; `lift` adds the recede-and-round treatment
 * and is released first so the page eases back while the sheet sinks.
 */
export function useLockPageScroll(active: boolean, lift: boolean) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    html.style.setProperty("--sheet-scroll", `${scrollY}px`);
    html.classList.add("dialog-open");
    body.style.top = `-${scrollY}px`;
    return () => {
      html.classList.remove("dialog-open");
      body.style.top = "";
      window.scrollTo(0, scrollY);
    };
  }, [active]);
  useEffect(() => {
    const html = document.documentElement;
    if (lift) html.classList.add("sheet-lift");
    else html.classList.remove("sheet-lift");
    return () => html.classList.remove("sheet-lift");
  }, [lift]);
}

/** Open/close state plus a key that resets the form each time the sheet opens. */
export function useSheet(): { open: boolean; seq: number; show: () => void; hide: () => void } {
  const [open, setOpen] = useState(false);
  const [seq, setSeq] = useState(0);
  const show = useCallback(() => { setSeq((n) => n + 1); setOpen(true); }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, seq, show, hide };
}
