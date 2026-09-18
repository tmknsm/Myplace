import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DISMISS_EASE,
  DISMISS_MS,
  bindPressDrag,
  dismissIntent,
  isInteractiveTarget,
  sampleVelocity,
  scrollChainAtTop,
  sheetModeFromTravel,
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

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || phase !== "open") return;

    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let mode: DragMode = "pending";
    let fromHandle = false;
    let startTarget: EventTarget | null = null;

    const canPullFrom = (target: EventTarget | null) => (
      fromHandle || scrollChainAtTop(target, bodyRef.current)
    );

    const beginSheetDrag = () => {
      mode = "sheet";
      panel.classList.add("is-dragging");
      panel.style.transition = "none";
      panel.style.animation = "none";
      if (backdropRef.current) backdropRef.current.style.transition = "none";
      if (bodyRef.current) bodyRef.current.style.overflow = "hidden";
    };

    const applySheetDrag = (dy: number) => {
      const offset = dy > 0 ? dy : dy * 0.16;
      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
      if (backdropRef.current) {
        const fade = Math.max(0.28, 1 - Math.max(0, offset) / (panel.offsetHeight || 640));
        backdropRef.current.style.setProperty("--sheet-dim", String(fade));
      }
    };

    return bindPressDrag(panel, {
      onStart: (point, target) => {
        if (isInteractiveTarget(target)) return false;
        fromHandle = Boolean((target as Element | null)?.closest?.(".sheet-panel-head"));
        startTarget = target;
        startY = point.y;
        lastY = point.y;
        lastT = performance.now();
        velocity = 0;
        mode = fromHandle ? "sheet" : "pending";
        if (fromHandle) beginSheetDrag();
        return true;
      },
      onMove: (point, event) => {
        const sample = sampleVelocity(lastY, lastT, point.y, performance.now());
        velocity = sample.velocity;
        lastY = sample.lastY;
        lastT = sample.lastT;
        const dy = point.y - startY;

        if (mode === "pending") {
          const next = sheetModeFromTravel(dy, canPullFrom(startTarget));
          if (next === "pending") return;
          if (next === "sheet") beginSheetDrag();
          else {
            mode = "scroll";
            return;
          }
        }
        if (mode !== "sheet") return;
        if (event.cancelable) event.preventDefault();
        applySheetDrag(dy);
      },
      onEnd: (point) => {
        panel.classList.remove("is-dragging");
        if (bodyRef.current) bodyRef.current.style.overflow = "";
        const dy = point.y - startY;
        if (mode === "pending") {
          mode = sheetModeFromTravel(dy, canPullFrom(startTarget));
        }
        if (mode !== "sheet") return;
        const traveled = Math.max(0, dy);
        const height = panel.offsetHeight || 640;
        panel.style.transition = `transform ${DISMISS_MS}ms ${DISMISS_EASE}`;
        if (backdropRef.current) backdropRef.current.style.transition = "";
        if (dismissIntent(traveled, velocity, height, "down")) {
          dragDismiss.current = true;
          panel.style.transform = "translate3d(0, 110%, 0)";
          onCloseRef.current();
          return;
        }
        panel.style.transform = "";
        panel.style.animation = "";
        backdropRef.current?.style.removeProperty("--sheet-dim");
        window.setTimeout(() => { panel.style.transition = ""; }, DISMISS_MS);
      },
    });
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
