import { useEffect, useRef, useState } from "react";
import { formatHandle, ownerLabel, ownerPhoto, parseHandle } from "../../shared/profile";
import { api, type MaintainedProperty, type User } from "./api";
import { Spinner } from "./components";
import { snapshotPhotoFile } from "./optimize-photo";
import { useToast } from "./property-shared";

/** Photo and the name property pages show. */
export function ProfileCard({ user, onUser }: { user: User; onUser: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const uploadPhoto = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.uploadAvatar(file);
      await onUser();
      showToast("Photo updated.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "That photo could not be uploaded.");
    } finally {
      setBusy(false);
    }
  };
  const label = ownerLabel(user);
  return (
    <>
      <section className="profile-card" data-testid="profile-card">
        <label className={`profile-card-avatar file-btn${busy ? " is-busy" : ""}`} aria-label="Change photo" aria-busy={busy}>
          <img src={ownerPhoto(user)} alt="" width={96} height={96} data-testid="profile-avatar" />
          <span className="profile-card-avatar-cam" aria-hidden="true">
            <CameraIcon />
          </span>
          {busy && <span className="profile-card-avatar-busy"><Spinner /></span>}
          <input
            type="file"
            accept="image/*"
            data-testid="avatar-input"
            disabled={busy}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              const copy = picked ? snapshotPhotoFile(picked) : null;
              event.target.value = "";
              if (!copy) return;
              void copy.then(uploadPhoto).catch((err) => showToast(err instanceof Error ? err.message : "That photo could not be read."));
            }}
          />
        </label>
        <h1 className="display profile-card-name" data-testid="profile-name">{label}</h1>
        <p className="meta-line profile-card-sub" data-testid="profile-sub">
          {user.anonymize ? "Real name is never displayed." : user.primary_email}
        </p>
      </section>
      {toast && (
        <div className="page-toast" role="status" data-testid="profile-toast">{toast}</div>
      )}
    </>
  );
}

/**
 * Hide my address is its own switch. Hide my name is off until they create
 * an alias; turning it on reveals the alias field.
 */
export function VisibilityCard({ user, onUser }: { user: User; onUser: () => Promise<void> }) {
  const [busy, setBusy] = useState<"anonymize" | "handle" | "street" | null>(null);
  const [toast, showToast] = useToast();
  const [handleDraft, setHandleDraft] = useState((user.handle ?? "").replace(/^@+/, ""));
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "unavailable" | "invalid">("idle");
  const [handleHint, setHandleHint] = useState<string | null>(null);
  const checkGen = useRef(0);
  useEffect(() => {
    setHandleDraft((user.handle ?? "").replace(/^@+/, ""));
    setAvailability("idle");
    setHandleHint(null);
  }, [user.handle]);

  useEffect(() => {
    const raw = handleDraft.trim();
    const current = user.handle ?? "";
    if (!raw || raw.toLowerCase() === current) {
      setAvailability("idle");
      setHandleHint(null);
      return;
    }
    const parsed = parseHandle(raw);
    if ("error" in parsed) {
      setAvailability("invalid");
      setHandleHint(parsed.error);
      return;
    }
    const gen = ++checkGen.current;
    setAvailability("checking");
    setHandleHint(null);
    const timer = window.setTimeout(() => {
      void api.handleAvailable(parsed.handle).then((res) => {
        if (gen !== checkGen.current) return;
        setAvailability(res.available ? "available" : "unavailable");
        setHandleHint(null);
      }).catch(() => {
        if (gen !== checkGen.current) return;
        setAvailability("invalid");
        setHandleHint("Could not check that handle.");
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [handleDraft, user.handle]);

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<string>, failure: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      showToast(await work());
    } catch (err) {
      const message = err instanceof Error ? err.message : failure;
      if (kind === "handle") {
        setAvailability("unavailable");
        setHandleHint(message);
      }
      showToast(message);
    } finally {
      setBusy(null);
    }
  };

  const hideStreet = Boolean(user.hide_street);
  const canSaveHandle = availability === "available";
  const hintClass = availability === "available"
    ? " is-ok"
    : availability === "unavailable" || availability === "invalid"
      ? " is-error"
      : "";
  const hintText = availability === "available"
    ? "Available"
    : availability === "unavailable"
      ? "Unavailable"
      : handleHint ?? (user.handle ? "Shown on property pages instead of your real name." : "Letters, numbers, and underscores. Starts with a letter.");

  const flipPrivate = () =>
    run("anonymize", async () => {
      const saved = await api.updateMe({ anonymize: !user.anonymize });
      await onUser();
      return saved.user.anonymize
        ? "Your name is hidden. Add an alias to use on property pages."
        : "Property pages now show your real name.";
    }, "Could not update that.");

  const flipStreet = () =>
    run("street", async () => {
      const saved = await api.updateMe({ hide_street: !hideStreet });
      await onUser();
      return saved.user.hide_street
        ? "Your street address is hidden on your property page."
        : "Your street address is visible on your property page.";
    }, "Could not update that.");

  const saveHandle = () => {
    if (busy || !canSaveHandle) return;
    void run("handle", async () => {
      const saved = await api.updateMe({ handle: handleDraft.trim() });
      await onUser();
      return `Alias is now ${formatHandle(saved.user.handle)}.`;
    }, "Could not save that handle.");
  };

  return (
    <>
      <section className="section" data-testid="visibility-section">
        <h2>Visibility</h2>
        <div className="group profile-card-settings">
          <div className="row">
            <div>
              <strong>Hide my address</strong>
              <div className="meta-line">Hide your street address on your property page.</div>
            </div>
            <button
              type="button"
              className={`switch${hideStreet ? " on" : ""}`}
              role="switch"
              aria-checked={hideStreet}
              aria-label="Hide my address"
              disabled={busy !== null}
              data-testid="hide-street-toggle"
              onClick={() => void flipStreet()}
            >
              <span className="visually-hidden">{hideStreet ? "On" : "Off"}</span>
            </button>
          </div>
          <div className="row">
            <div>
              <strong>Hide my name</strong>
              <div className="meta-line">
                Create an alias to use instead of your real name on property pages.
              </div>
            </div>
            <button
              type="button"
              className={`switch${user.anonymize ? " on" : ""}`}
              role="switch"
              aria-checked={user.anonymize}
              aria-label="Hide my name"
              disabled={busy !== null}
              data-testid="anonymize-toggle"
              onClick={() => void flipPrivate()}
            >
              <span className="visually-hidden">{user.anonymize ? "On" : "Off"}</span>
            </button>
          </div>
          {user.anonymize && (
            <form
              className="row profile-handle-row"
              onSubmit={(event) => {
                event.preventDefault();
                saveHandle();
              }}
            >
              <label className="profile-handle-label">
                <strong>Alias</strong>
                <span className={`profile-handle${availability === "unavailable" || availability === "invalid" ? " is-error" : availability === "available" ? " is-ok" : ""}`}>
                  <span className="profile-handle-at" aria-hidden="true">@</span>
                  <input
                    className="field"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={24}
                    value={handleDraft}
                    onChange={(event) => setHandleDraft(event.target.value.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 24))}
                    placeholder="yourname"
                    aria-invalid={availability === "unavailable" || availability === "invalid"}
                    data-testid="profile-handle"
                  />
                </span>
                <span className={`meta-line${hintClass}`} data-testid="profile-handle-hint">
                  {hintText}
                </span>
              </label>
              <div className={`profile-handle-accept${canSaveHandle ? " is-on" : ""}`}>
                <div className="profile-handle-accept-slot">
                  <button
                    type="submit"
                    className="btn profile-handle-accept-btn"
                    disabled={!canSaveHandle || busy !== null}
                    tabIndex={canSaveHandle ? 0 : -1}
                    data-testid="profile-handle-accept"
                  >
                    {busy === "handle" ? "Saving…" : "Accept"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </section>
      {toast && (
        <div className="page-toast" role="status" data-testid="visibility-toast">{toast}</div>
      )}
    </>
  );
}

/**
 * Take a claimed house off Myplace. Off by default. When on, the parcel
 * disappears from search, the map, and every public URL.
 */
export function ManageCard({
  properties,
  onChange,
}: {
  properties: MaintainedProperty[];
  onChange: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const flipRemoved = (property: MaintainedProperty) => {
    if (busyId) return;
    setBusyId(property.property_id);
    void (async () => {
      try {
        const saved = await api.setPropertyRemoved(property.property_id, !property.removed);
        await onChange();
        showToast(saved.property.removed
          ? "That property is off Myplace. Toggle this off to bring it back."
          : "That property is on Myplace again.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Could not update that.");
      } finally {
        setBusyId(null);
      }
    })();
  };

  return (
    <>
      <section className="section" data-testid="manage-section">
        <h2>Manage</h2>
        <div className="group profile-card-settings">
          {properties.length === 0 && (
            <div className="row">
              <span className="meta-line">Claim a property to take it off Myplace.</span>
            </div>
          )}
          {properties.map((property) => (
            <div className="row" key={property.property_id}>
              <div>
                <strong>Remove my property</strong>
                <div className="meta-line">
                  {property.formatted
                    ? `${property.formatted}. Off the map, out of search, and gone from every public page.`
                    : "Off the map, out of search, and gone from every public page."}
                </div>
              </div>
              <button
                type="button"
                className={`switch${property.removed ? " on" : ""}`}
                role="switch"
                aria-checked={property.removed}
                aria-label={property.formatted ? `Remove ${property.formatted}` : "Remove my property"}
                disabled={busyId !== null}
                data-testid="remove-property-toggle"
                onClick={() => flipRemoved(property)}
              >
                <span className="visually-hidden">{property.removed ? "On" : "Off"}</span>
              </button>
            </div>
          ))}
        </div>
      </section>
      {toast && (
        <div className="page-toast" role="status" data-testid="manage-toast">{toast}</div>
      )}
    </>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8.6h2.1l1.5-2.3h8.8l1.5 2.3H20a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10.6a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="14.2" r="3.2" />
    </svg>
  );
}
