import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLockPageScroll } from "./sheet";

type Phase = "closed" | "open" | "closing";

const OUT_MS = 160;

function workingLabel(label: string) {
  return /e$/i.test(label) ? `${label.slice(0, -1)}ing…` : `${label}ing…`;
}

/**
 * A small centered card over a scrim. Built for destructive work — remove a
 * post, delete a room — and reusable anywhere a Keep / go-ahead is enough.
 * Dismiss with Keep, Escape, the close button, or a tap on the backdrop.
 * Sits above sheets so a confirm can ask over an editor.
 */
export function ConfirmDialog({
  open,
  title,
  lede,
  confirmLabel = "Remove",
  cancelLabel = "Keep",
  danger = true,
  busy = false,
  error,
  onConfirm,
  onClose,
  testId,
}: {
  open: boolean;
  title: string;
  lede?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  testId?: string;
}) {
  const titleId = useId();
  const ledeId = useId();
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const closeTimer = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.clearTimeout(closeTimer.current);
    if (open) {
      setPhase("open");
      return;
    }
    if (phaseRef.current === "closed") return;
    setPhase("closing");
    closeTimer.current = window.setTimeout(() => setPhase("closed"), OUT_MS);
    return () => window.clearTimeout(closeTimer.current);
  }, [open]);

  useLockPageScroll(phase !== "closed");

  useEffect(() => {
    if (phase !== "open") return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!busy) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, busy, onClose]);

  if (phase === "closed") return null;

  const closing = phase === "closing";
  return createPortal(
    <div
      className={`modal-backdrop confirm-backdrop${closing ? " is-closing" : ""}`}
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal confirm-dialog${closing ? " is-closing" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={lede ? ledeId : undefined}
        data-testid={testId ?? "confirm-dialog"}
      >
        <button type="button" className="modal-close" aria-label="Close" disabled={busy} onClick={onClose}>×</button>
        <h2 id={titleId}>{title}</h2>
        {lede && <p id={ledeId} className="meta-line">{lede}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="action-row">
          <button
            type="button"
            className={danger ? "btn danger" : "btn"}
            disabled={busy}
            data-testid="confirm-dialog-confirm"
            onClick={() => void onConfirm()}
          >
            {busy ? workingLabel(confirmLabel) : confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn secondary"
            disabled={busy}
            data-testid="confirm-dialog-cancel"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
