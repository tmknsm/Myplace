import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { hasOwnPhoto, ownerLabel, ownerPhoto } from "../../shared/profile";
import { api, type MaintainedProperty, type User } from "./api";
import { PersonAvatar, Spinner } from "./components";
import { markNotificationsSeen } from "./my-properties";
import { snapshotPhotoFile } from "./optimize-photo";
import { InboxRows, useInbox } from "./property-manage";
import { localityOf, shortAddress, type Toast } from "./property-shared";

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
 * The houses on the account. A tap opens the house (or its settings, if it is
 * off Myplace). With more than one, the track is a snap carousel: swipe to
 * focus a card, and the notifications feed below follows. A red dot beside
 * the address means notifications landed since the last look.
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
          aria-label="Properties"
          onKeyDown={onKeyDown}
        >
          {properties.map((property) => {
            const selected = property.property_id === selectedId;
            const href = property.removed
              ? `/property/${property.property_id}/manage`
              : `/property/${property.property_id}`;
            return (
              <Link
                className={`picker-card${selected ? " is-selected" : ""}`}
                key={property.property_id}
                to={href}
                aria-label={property.removed
                  ? `${shortAddress(property)} is off Myplace. Open its settings`
                  : property.formatted ?? shortAddress(property)}
                data-property-id={property.property_id}
                data-testid="owned-property"
                data-selected={selected || undefined}
              >
                {/* At the card's edge so it shows in the sliver of the next house too. */}
                <span
                  className={`picker-dot${property.unseen > 0 ? " is-on" : ""}`}
                  role={property.unseen > 0 ? "img" : undefined}
                  aria-label={property.unseen > 0 ? "New notifications" : undefined}
                  aria-hidden={property.unseen > 0 ? undefined : true}
                  data-testid={property.unseen > 0 ? "picker-unseen" : undefined}
                />
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
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

const FEED_LIMIT = 5;
const SEEN_AFTER_MS = 1200;

/**
 * The selected house's notifications: neighbor requests, change requests,
 * disputes, and county notices, newest first. Five rows here; View all opens
 * the whole list. Showing the feed is what marks the house as seen.
 */
export function NotificationsFeed({
  property,
  showToast,
}: {
  property: MaintainedProperty | null;
  showToast: Toast;
}) {
  const propertyId = property?.property_id ?? null;
  const inbox = useInbox(propertyId, undefined, showToast);
  const unseen = property?.unseen ?? 0;
  // A beat after the rows are on screen, the house counts as seen: the dot on
  // its card and the count on your name fade rather than vanish on arrival.
  useEffect(() => {
    if (!propertyId || !inbox.items || unseen === 0) return;
    const timer = window.setTimeout(() => markNotificationsSeen(propertyId), SEEN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [propertyId, inbox.items, unseen]);

  const items = inbox.items;
  const more = Boolean(propertyId && items && items.length > FEED_LIMIT);
  return (
    <section className="section" data-testid="notifications-section">
      <div className="section-head">
        <h2>Notifications</h2>
        {property && (
          <div className="section-head-actions">
            <span className="section-scope" key={property.property_id} data-testid="notifications-scope">
              {shortAddress(property)}
            </span>
            {more && (
              <Link className="text-btn accent" to={`/property/${property.property_id}/manage/inbox`} data-testid="notifications-view-all">
                View all
              </Link>
            )}
          </div>
        )}
      </div>
      {inbox.error && <p className="error">{inbox.error}</p>}
      {propertyId && items === null && !inbox.error && (
        <div className="group empty-card" role="status" aria-label="Loading notifications">
          <Spinner />
        </div>
      )}
      {(!propertyId || (items && items.length === 0)) && (
        <div className="group" data-testid="notifications-empty">
          <div className="row"><span className="meta-line">None yet</span></div>
        </div>
      )}
      {propertyId && items && items.length > 0 && (
        <div className="scope-swap" key={propertyId}>
          <InboxRows propertyId={propertyId} items={items.slice(0, FEED_LIMIT)} busy={inbox.busy} onAct={inbox.act} />
        </div>
      )}
    </section>
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
