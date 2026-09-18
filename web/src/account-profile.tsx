import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatHandle, ownerLabel, ownerPhoto, parseHandle } from "../../shared/profile";
import { api, type MaintainedProperty, type User } from "./api";
import { Spinner } from "./components";
import { snapshotPhotoFile } from "./optimize-photo";
import { useToast } from "./property-shared";

/** Street half of an address, for the picker row and the scope label under a section title. */
export function shortAddress(property: Pick<MaintainedProperty, "formatted" | "municipality">): string {
  const formatted = property.formatted?.trim();
  if (formatted) return formatted.split(",")[0]!.trim() || formatted;
  return property.municipality || "This property";
}

/** Everything after the street: "Claverack, NY". */
function localityOf(property: Pick<MaintainedProperty, "formatted" | "municipality">): string | null {
  const formatted = property.formatted?.trim();
  if (!formatted) return null;
  const comma = formatted.indexOf(",");
  return comma >= 0 ? formatted.slice(comma + 1).trim() || null : null;
}

/** Photo and the name on the account. What each property page shows is set per house below. */
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
  const label = ownerLabel({ ...user, anonymize: false });
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
        <p className="meta-line profile-card-sub" data-testid="profile-sub">{user.primary_email}</p>
      </section>
      {toast && (
        <div className="page-toast" role="status" data-testid="profile-toast">{toast}</div>
      )}
    </>
  );
}

/**
 * The houses on the account. Choosing one scopes Visibility and Manage below
 * to it. With a single house there is nothing to choose, so it reads as a
 * plain list.
 */
export function PropertyPicker({
  properties,
  selectedId,
  onSelect,
  children,
}: {
  properties: MaintainedProperty[];
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
  children?: ReactNode;
}) {
  const selectable = properties.length > 1;
  return (
    <div className="group property-picker" role={selectable ? "radiogroup" : undefined} aria-label={selectable ? "Properties" : undefined}>
      {properties.map((property) => {
        const selected = selectable && property.property_id === selectedId;
        return (
          <div
            className={`row picker-row${selected ? " is-selected" : ""}${selectable ? " is-selectable" : ""}`}
            key={property.property_id}
            data-testid="owned-property"
            data-selected={selected || undefined}
          >
            <button
              type="button"
              className="picker-choice"
              role={selectable ? "radio" : undefined}
              aria-checked={selectable ? selected : undefined}
              aria-label={selectable ? `Settings for ${property.formatted ?? shortAddress(property)}` : undefined}
              onClick={() => onSelect(property.property_id)}
              data-testid="picker-choice"
            >
              <span className="picker-addr">
                <span className="row-label">{shortAddress(property)}</span>
                {localityOf(property) && <span className="meta-line">{localityOf(property)}</span>}
              </span>
              {property.removed && <span className="badge">Removed</span>}
              {property.maintainers.length > 0 && !property.removed && (
                <span className="row-avatars">
                  {property.maintainers.map((person) => (
                    <img key={person.user_id} src={person.photo_url} alt={person.label} />
                  ))}
                </span>
              )}
            </button>
            {!property.removed && (
              <Link
                className="picker-open"
                to={`/property/${property.property_id}`}
                aria-label={`Open ${property.formatted ?? shortAddress(property)}`}
                data-testid="picker-open"
              >
                <ChevronIcon />
              </Link>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}

/** Section title with the address the controls under it apply to. */
function ScopedHead({ title, property }: { title: string; property: MaintainedProperty | null }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {property && (
        <span className="section-scope" key={property.property_id} data-testid={`${title.toLowerCase()}-scope`}>
          {shortAddress(property)}
        </span>
      )}
    </div>
  );
}

/**
 * How this house shows you. Hide my address and Hide my name are each set
 * per property; the alias is one per account and appears when any house
 * hides your name.
 */
export function VisibilityCard({
  user,
  property,
  onUser,
  onProperty,
}: {
  user: User;
  property: MaintainedProperty | null;
  onUser: () => Promise<void>;
  onProperty: (patch: Pick<MaintainedProperty, "property_id"> & Partial<MaintainedProperty>) => void;
}) {
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

  const hideStreet = Boolean(property?.hide_street);
  const anonymize = Boolean(property?.anonymize);
  const where = property ? shortAddress(property) : null;
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
      : handleHint ?? (user.handle ? "One alias for your account, used wherever your name is hidden." : "Letters, numbers, and underscores. Starts with a letter.");

  const flipName = () => {
    if (!property) return;
    void run("anonymize", async () => {
      const saved = await api.setPropertyVisibility(property.property_id, { anonymize: !anonymize });
      onProperty(saved.property);
      return saved.property.anonymize
        ? (user.handle ? `${where} shows ${formatHandle(user.handle)} instead of your name.` : `Your name is hidden on ${where}. Add an alias below.`)
        : `${where} shows your real name again.`;
    }, "Could not update that.");
  };

  const flipStreet = () => {
    if (!property) return;
    void run("street", async () => {
      const saved = await api.setPropertyVisibility(property.property_id, { hide_street: !hideStreet });
      onProperty(saved.property);
      return saved.property.hide_street
        ? `${where} now shows only the town.`
        : `${where} shows its street address again.`;
    }, "Could not update that.");
  };

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
        <ScopedHead title="Visibility" property={property} />
        {!property ? (
          <div className="group profile-card-settings">
            <div className="empty-card">Claim a property to choose what its page shows.</div>
          </div>
        ) : (
          <div className="group profile-card-settings scope-swap" key={property.property_id}>
            <div className="row">
              <div>
                <strong>Hide my address</strong>
                <div className="meta-line">Show only the town on this property's page.</div>
              </div>
              <button
                type="button"
                className={`switch${hideStreet ? " on" : ""}`}
                role="switch"
                aria-checked={hideStreet}
                aria-label={`Hide my address on ${where}`}
                disabled={busy !== null}
                data-testid="hide-street-toggle"
                onClick={flipStreet}
              >
                <span className="visually-hidden">{hideStreet ? "On" : "Off"}</span>
              </button>
            </div>
            <div className="row">
              <div>
                <strong>Hide my name</strong>
                <div className="meta-line">
                  Use an alias instead of your real name on this page and with its neighbors.
                </div>
              </div>
              <button
                type="button"
                className={`switch${anonymize ? " on" : ""}`}
                role="switch"
                aria-checked={anonymize}
                aria-label={`Hide my name on ${where}`}
                disabled={busy !== null}
                data-testid="anonymize-toggle"
                onClick={flipName}
              >
                <span className="visually-hidden">{anonymize ? "On" : "Off"}</span>
              </button>
            </div>
            {anonymize && (
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
        )}
      </section>
      {toast && (
        <div className="page-toast" role="status" data-testid="visibility-toast">{toast}</div>
      )}
    </>
  );
}

/**
 * Take the selected house off Myplace. Off by default. When on, the parcel
 * disappears from search, the map, and every public URL until it is turned
 * back off. Other houses on the account are untouched.
 */
export function ManageCard({
  property,
  onProperty,
}: {
  property: MaintainedProperty | null;
  onProperty: (patch: Pick<MaintainedProperty, "property_id"> & Partial<MaintainedProperty>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const where = property ? shortAddress(property) : null;

  const flipRemoved = () => {
    if (busy || !property) return;
    setBusy(true);
    void (async () => {
      try {
        const saved = await api.setPropertyRemoved(property.property_id, !property.removed);
        onProperty(saved.property);
        showToast(saved.property.removed
          ? `${where} is off Myplace. Turn this off to bring it back.`
          : `${where} is on Myplace again.`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Could not update that.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <section className="section" data-testid="manage-section">
        <ScopedHead title="Manage" property={property} />
        {!property ? (
          <div className="group profile-card-settings">
            <div className="empty-card">Claim a property to take it off Myplace.</div>
          </div>
        ) : (
          <div className="group profile-card-settings scope-swap" key={property.property_id}>
            <div className="row">
              <div>
                <strong>Remove my property</strong>
                <div className="meta-line">Off the map, out of search, and gone from every public page.</div>
              </div>
              <button
                type="button"
                className={`switch${property.removed ? " on" : ""}`}
                role="switch"
                aria-checked={property.removed}
                aria-label={`Remove ${where}`}
                disabled={busy}
                data-testid="remove-property-toggle"
                onClick={flipRemoved}
              >
                <span className="visually-hidden">{property.removed ? "On" : "Off"}</span>
              </button>
            </div>
          </div>
        )}
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
