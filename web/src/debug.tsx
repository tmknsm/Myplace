import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DebugClaimResult, type DebugState } from "./api";
import { useAuth } from "./auth";

/**
 * Local-development helpers. Both components render only when `meta.debug` is
 * true, which the API sets exclusively outside production.
 */

export const OWNERSHIP_CHANGED = "myplace:ownership-changed";

export function announceOwnershipChange(propertyId: string) {
  window.dispatchEvent(new CustomEvent(OWNERSHIP_CHANGED, { detail: { propertyId } }));
}

export function useOwnershipChanges(propertyId: string | undefined, onChange: () => void) {
  useEffect(() => {
    if (!propertyId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ propertyId: string }>).detail;
      if (!detail || detail.propertyId === propertyId) onChange();
    };
    window.addEventListener(OWNERSHIP_CHANGED, handler);
    return () => window.removeEventListener(OWNERSHIP_CHANGED, handler);
  }, [propertyId, onChange]);
}

const PIN_LENGTH = 4;

export function PinClaimModal({
  propertyId,
  address,
  onClose,
  onClaimed,
}: {
  propertyId: string;
  address: string;
  onClose: () => void;
  onClaimed: (result: DebugClaimResult) => void;
}) {
  const { user, refresh } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (candidate: string) => {
    if (busy || candidate.length !== PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.debugClaim(propertyId, candidate);
      // Flip the property into the owner profile immediately. Auth refresh and
      // a background reload can lag on a cold hosted database; don't block the UI.
      onClaimed(result);
      if (result.signedIn) void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim");
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 450);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="kicker">Claim this property</div>
        <h2 id="pin-title">Enter your PIN</h2>
        <p className="meta-line">{address}</p>
        <label className={`pin-cells ${shake ? "shake" : ""}`} onClick={() => inputRef.current?.focus()}>
          <input
            ref={inputRef}
            className="pin-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={PIN_LENGTH}
            value={pin}
            aria-label="Four digit PIN"
            data-testid="pin-input"
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
              setPin(next);
              setError(null);
              if (next.length === PIN_LENGTH) void submit(next);
            }}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(pin); }}
          />
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span key={index} className={`pin-cell ${pin.length === index ? "active" : ""} ${pin[index] ? "filled" : ""}`}>
              {pin[index] ? "•" : ""}
            </span>
          ))}
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="meta-line pin-hint">
          {user
            ? <>Claiming as <strong>{user.primary_email}</strong>.</>
            : <>You are not signed in. A correct PIN signs you in as the debug owner account.</>}
        </p>
        <div className="action-row">
          <button type="button" className="btn" data-testid="pin-submit" disabled={busy || pin.length !== PIN_LENGTH} onClick={() => void submit(pin)}>
            {busy ? "Verifying…" : "Claim"}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
        <p className="modal-foot">
          Local development only. In production, this button opens ownership verification.{" "}
          <Link to={user ? `/property/${propertyId}/claim` : `/signin?next=/property/${propertyId}/claim`} onClick={onClose}>
            Use the production claim flow
          </Link>
        </p>
      </div>
    </div>
  );
}

export function DebugSheet({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth();
  const [state, setState] = useState<DebugState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.debugState().then(setState).catch((err) => setError(err.message));
  useEffect(() => { void load(); }, [user]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const revoke = async (propertyId: string, userId: string, maintainerId: string) => {
    setBusy(maintainerId);
    setError(null);
    try {
      await api.debugRevoke(propertyId, userId);
      await load();
      await refresh();
      announceOwnershipChange(propertyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke");
    } finally {
      setBusy(null);
    }
  };

  const mine = state?.maintainers.filter((row) => row.mine) ?? [];
  const others = state?.maintainers.filter((row) => !row.mine) ?? [];

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="debug-title">
        <div className="sheet-head">
          <div>
            <div className="kicker">Local development</div>
            <h2 id="debug-title">Debug</h2>
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="meta-line">
          None of this ships to production. The owner experience it unlocks is the real one.
        </p>

        <section className="sheet-section">
          <h3>Fake claim</h3>
          <p>Open any property and press <strong>Claim this property</strong>. The PIN is</p>
          <div className="pin-display">{state ? state.pin.split("").join(" ") : "· · · ·"}</div>
          <p className="meta-line">
            Signed in as {user ? <strong>{user.primary_email}</strong> : <>nobody — a correct PIN signs you in as <strong>{state?.debugOwnerEmail ?? "the debug owner"}</strong></>}.
          </p>
        </section>

        <section className="sheet-section">
          <h3>Your claimed properties</h3>
          {error && <p className="error">{error}</p>}
          {state && mine.length === 0 && <p className="meta-line">You do not maintain any properties right now.</p>}
          <div className="sheet-list">
            {mine.map((row) => (
              <div key={row.maintainer_id} className="sheet-row">
                <div>
                  <Link to={`/property/${row.property_id}`} onClick={onClose}>{row.formatted ?? row.property_id}</Link>
                  <small>{row.role.replace("_", "-")} · {row.method === "debug_pin" ? "debug PIN" : row.method ?? "verified"} · {new Date(row.verified_at).toLocaleDateString()}</small>
                </div>
                <button
                  type="button"
                  className="btn danger small"
                  data-testid={`revoke-${row.property_id}`}
                  disabled={busy === row.maintainer_id}
                  onClick={() => void revoke(row.property_id, row.user_id, row.maintainer_id)}
                >
                  {busy === row.maintainer_id ? "Revoking…" : "Revoke ownership"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {others.length > 0 && (
          <section className="sheet-section">
            <h3>Other maintainers</h3>
            <div className="sheet-list">
              {others.map((row) => (
                <div key={row.maintainer_id} className="sheet-row">
                  <div>
                    <Link to={`/property/${row.property_id}`} onClick={onClose}>{row.formatted ?? row.property_id}</Link>
                    <small>{row.primary_email} · {row.role.replace("_", "-")}</small>
                  </div>
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={busy === row.maintainer_id}
                    onClick={() => void revoke(row.property_id, row.user_id, row.maintainer_id)}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="sheet-section">
          <h3>Tools</h3>
          <div className="sheet-links">
            <Link to="/dev/mailbox" onClick={onClose}>Mailbox</Link>
            <Link to="/admin" onClick={onClose}>Admin review desk</Link>
            <Link to="/signin" onClick={onClose}>Sign in as someone else</Link>
          </div>
          <p className="meta-line">Admin: <code>admin@myplace.local</code>, code <code>000000</code> after <code>db:seed</code>.</p>
        </section>
      </aside>
    </div>
  );
}
