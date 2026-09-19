import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatHandle, hasOwnPhoto, ownerLabel, ownerPhoto, parseHandle } from "../../shared/profile";
import { api, type MaintainedProperty, type User } from "./api";
import { PersonAvatar, Spinner } from "./components";
import { snapshotPhotoFile } from "./optimize-photo";
import { type Toast } from "./property-shared";

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
export function ProfileCard({ user, onUser, showToast }: { user: User; onUser: () => Promise<void>; showToast: Toast }) {
  const [busy, setBusy] = useState(false);
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
          {hasOwnPhoto(user) ? (
            <img src={ownerPhoto(user)!} alt="" width={96} height={96} data-testid="profile-avatar" />
          ) : (
            <span className="profile-card-avatar-empty" data-testid="profile-avatar" aria-hidden="true">
              <CameraIcon />
            </span>
          )}
          {hasOwnPhoto(user) && (
            <span className="profile-card-avatar-cam" aria-hidden="true">
              <CameraIcon />
            </span>
          )}
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
    </>
  );
}

/**
 * The houses on the account. Choosing one scopes Visibility and Manage below
 * to it. One house is a full-width card; more than one is a snap carousel
 * whose focused card is the selection, with a sliver of the next house showing.
 */
export function PropertyPicker({
  properties,
  selectedId,
  onSelect,
}: {
  properties: MaintainedProperty[];
  selectedId: string | null;
  onSelect: (propertyId: string) => void;
}) {
  const carousel = properties.length > 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const ignoreScroll = useRef(false);

  const focusedId = (track: HTMLElement) => {
    const cards = [...track.querySelectorAll<HTMLElement>("[data-property-id]")];
    if (cards.length === 0) return null;
    const box = track.getBoundingClientRect();
    let best = cards[0]!;
    let bestDist = Infinity;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      const dist = Math.min(Math.abs(rect.left - box.left), Math.abs(rect.right - box.right));
      if (dist < bestDist) {
        bestDist = dist;
        best = card;
      }
    }
    return best.dataset.propertyId ?? null;
  };

  const scrollCardIntoView = (propertyId: string, instant = false) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>(`[data-property-id="${propertyId}"]`);
    if (!track || !card) return;
    const last = track.querySelector<HTMLElement>("[data-property-id]:last-child");
    ignoreScroll.current = true;
    card.scrollIntoView({
      inline: card === last ? "end" : "start",
      block: "nearest",
      behavior: instant ? "auto" : "smooth",
    });
    window.setTimeout(() => { ignoreScroll.current = false; }, instant ? 50 : 420);
  };

  useEffect(() => {
    if (!carousel || !selectedId) return;
    const track = trackRef.current;
    if (!track) return;
    if (focusedId(track) === selectedId) return;
    scrollCardIntoView(selectedId, true);
  }, [carousel, selectedId, properties.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !carousel) return;
    let timer = 0;
    const pick = () => {
      if (ignoreScroll.current) return;
      const id = focusedId(track);
      if (id) onSelect(id);
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(pick, 90);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("scrollend", pick);
    return () => {
      window.clearTimeout(timer);
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("scrollend", pick);
    };
  }, [carousel, onSelect]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!carousel) return;
    const index = properties.findIndex((property) => property.property_id === selectedId);
    if (event.key === "ArrowRight" && index < properties.length - 1) {
      event.preventDefault();
      const next = properties[index + 1]!.property_id;
      onSelect(next);
      scrollCardIntoView(next);
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      const next = properties[index - 1]!.property_id;
      onSelect(next);
      scrollCardIntoView(next);
    }
  };

  return (
    <div className={`property-picker${carousel ? " is-carousel" : ""}`}>
      {properties.length > 0 && (
        <div
          ref={trackRef}
          className="property-picker-track"
          role={carousel ? "radiogroup" : undefined}
          aria-label={carousel ? "Properties" : undefined}
          onKeyDown={onKeyDown}
        >
          {properties.map((property) => {
            const selected = property.property_id === selectedId;
            return (
              <button
                type="button"
                className={`picker-card${selected ? " is-selected" : ""}`}
                key={property.property_id}
                role={carousel ? "radio" : undefined}
                aria-checked={carousel ? selected : undefined}
                aria-label={property.formatted ?? shortAddress(property)}
                data-property-id={property.property_id}
                data-testid="owned-property"
                data-selected={selected || undefined}
                onClick={() => {
                  onSelect(property.property_id);
                  if (carousel) scrollCardIntoView(property.property_id);
                }}
              >
                <span className="picker-copy">
                  <span className="picker-addr">
                    <span className="row-label">{shortAddress(property)}</span>
                    {localityOf(property) && <span className="meta-line">{localityOf(property)}</span>}
                  </span>
                  {property.removed && <span className="badge">Removed</span>}
                  {property.maintainers.length > 0 && !property.removed && (
                    <span className="row-avatars">
                      {property.maintainers.map((person) => (
                        <PersonAvatar key={person.user_id} src={person.photo_url} alt={person.label} />
                      ))}
                    </span>
                  )}
                </span>
                <span className="picker-radio" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
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
  showToast,
}: {
  user: User;
  property: MaintainedProperty | null;
  onUser: () => Promise<void>;
  onProperty: (patch: Pick<MaintainedProperty, "property_id"> & Partial<MaintainedProperty>) => void;
  showToast: Toast;
}) {
  const [busy, setBusy] = useState<"handle" | null>(null);
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

  const flipVisibility = (field: "anonymize" | "hide_street", next: boolean, ok: (value: boolean) => string) => {
    if (!property) return;
    const previous = field === "anonymize" ? anonymize : hideStreet;
    onProperty({ property_id: property.property_id, [field]: next });
    void api.setPropertyVisibility(property.property_id, { [field]: next }).then((saved) => {
      onProperty(saved.property);
      showToast(ok(field === "anonymize" ? saved.property.anonymize : saved.property.hide_street));
    }).catch((err) => {
      onProperty({ property_id: property.property_id, [field]: previous });
      showToast(err instanceof Error ? err.message : "Could not update that.");
    });
  };
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
    flipVisibility("anonymize", !anonymize, (on) => (
      on
        ? (user.handle ? `${where} shows ${formatHandle(user.handle)} instead of your name.` : `Your name is hidden on ${where}. Add an alias below.`)
        : `${where} shows your real name again.`
    ));
  };

  const flipStreet = () => {
    if (!property) return;
    flipVisibility("hide_street", !hideStreet, (on) => (
      on ? `${where} now shows only the town.` : `${where} shows its street address again.`
    ));
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
  showToast,
}: {
  property: MaintainedProperty | null;
  onProperty: (patch: Pick<MaintainedProperty, "property_id"> & Partial<MaintainedProperty>) => void;
  showToast: Toast;
}) {
  const where = property ? shortAddress(property) : null;

  const flipRemoved = () => {
    if (!property) return;
    const next = !property.removed;
    onProperty({ property_id: property.property_id, removed: next });
    void api.setPropertyRemoved(property.property_id, next).then((saved) => {
      onProperty(saved.property);
      showToast(saved.property.removed
        ? `${where} is off Myplace. Turn this off to bring it back.`
        : `${where} is on Myplace again.`);
    }).catch((err) => {
      onProperty({ property_id: property.property_id, removed: !next });
      showToast(err instanceof Error ? err.message : "Could not update that.");
    });
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
                data-testid="remove-property-toggle"
                onClick={flipRemoved}
              >
                <span className="visually-hidden">{property.removed ? "On" : "Off"}</span>
              </button>
            </div>
          </div>
        )}
      </section>
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
