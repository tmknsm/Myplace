import { useEffect, useRef, useState } from "react";
import { formatHandle, ownerLabel, ownerPhoto } from "../../shared/profile";
import { api, type User } from "./api";
import { Spinner } from "./components";
import { snapshotPhotoFile } from "./optimize-photo";

/**
 * The top of the account page: one photo, the name the property page shows,
 * and the anonymize switch. Anonymize only swaps the name for the handle; the
 * photo is whatever the person chose, so a faceless picture is a photo change,
 * not a second stored image.
 */
export function ProfileCard({ user, onUser }: { user: User; onUser: () => Promise<void> }) {
  const [busy, setBusy] = useState<"anonymize" | "handle" | "photo" | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [handleDraft, setHandleDraft] = useState((user.handle ?? "").replace(/^@+/, ""));
  const noteTimer = useRef(0);
  useEffect(() => {
    setHandleDraft((user.handle ?? "").replace(/^@+/, ""));
  }, [user.handle]);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  const say = (text: string, error = false) => {
    setNote({ text, error });
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), error ? 6000 : 3000);
  };
  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<string>, failure: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      say(await work());
    } catch (err) {
      say(err instanceof Error ? err.message : failure, true);
    } finally {
      setBusy(null);
    }
  };

  const handle = formatHandle(user.handle);
  const label = ownerLabel(user);
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.display_name || user.primary_email;

  const flip = () =>
    run("anonymize", async () => {
      const saved = await api.updateMe({ anonymize: !user.anonymize });
      await onUser();
      return saved.user.anonymize ? "Property pages now show your handle." : "Property pages now show your name.";
    }, "Could not update that.");

  const saveHandle = () =>
    run("handle", async () => {
      await api.updateMe({ handle: handleDraft.trim() });
      await onUser();
      return "Handle saved.";
    }, "Could not save that handle.");

  const uploadPhoto = (file: File) =>
    run("photo", async () => {
      await api.uploadAvatar(file);
      await onUser();
      return "Photo updated.";
    }, "That photo could not be uploaded.");

  const usePreset = (preset: "abstract" | "default") =>
    run("photo", async () => {
      await api.updateMe({ avatar: preset });
      await onUser();
      return preset === "abstract" ? "Your photo is now an abstract mark." : "Back to the default photo.";
    }, "Could not change the photo.");

  return (
    <section className="profile-card" data-testid="profile-card">
      <div className="profile-card-avatar">
        <img src={ownerPhoto(user)} alt="" width={96} height={96} data-testid="profile-avatar" />
        {busy === "photo" && <span className="profile-card-avatar-busy"><Spinner /></span>}
      </div>
      <h1 className="display profile-card-name" data-testid="profile-name">{label}</h1>
      <p className="meta-line profile-card-sub">
        {user.anonymize ? fullName : handle ?? "No handle yet"}
        <span aria-hidden="true"> · </span>
        {user.primary_email}
      </p>

      <div className="profile-card-photo-actions">
        <label className={`text-btn accent file-btn${busy === "photo" ? " is-busy" : ""}`} aria-busy={busy === "photo"}>
          Change photo
          <input
            type="file"
            accept="image/*"
            data-testid="avatar-input"
            disabled={busy !== null}
            onChange={(event) => {
              const picked = event.target.files?.[0];
              // Copy before the handler returns; iOS revokes picker files after.
              const copy = picked ? snapshotPhotoFile(picked) : null;
              event.target.value = "";
              if (!copy) return;
              void copy.then(uploadPhoto).catch((err) => say(err instanceof Error ? err.message : "That photo could not be read.", true));
            }}
          />
        </label>
        <span className="profile-card-dot" aria-hidden="true">·</span>
        <button type="button" className="text-btn" disabled={busy !== null} data-testid="avatar-abstract" onClick={() => void usePreset("abstract")}>
          Use an abstract mark
        </button>
      </div>

      <div className="group profile-card-settings">
        {!user.handle && (
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              void saveHandle();
            }}
          >
            <label className="stack" style={{ flex: 1 }}>
              <span>Handle</span>
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
                placeholder="@yourname"
                data-testid="anonymize-handle"
              />
            </label>
            <button type="submit" className="btn small secondary" disabled={busy !== null || !handleDraft.trim()}>
              {busy === "handle" ? "Saving…" : "Save"}
            </button>
          </form>
        )}
        <div className="row">
          <div>
            <strong>Anonymize</strong>
            <div className="meta-line">
              {user.anonymize
                ? `Property pages show ${handle ?? "your handle"} instead of your name.`
                : user.handle
                  ? `Show ${handle} instead of your name on property pages. Your photo stays the same.`
                  : "Add a handle to show it instead of your name on property pages."}
            </div>
          </div>
          <button
            type="button"
            className={`switch${user.anonymize ? " on" : ""}`}
            role="switch"
            aria-checked={user.anonymize}
            aria-label="Anonymize"
            disabled={busy !== null || !user.handle}
            data-testid="anonymize-toggle"
            onClick={() => void flip()}
          >
            <span className="visually-hidden">{user.anonymize ? "On" : "Off"}</span>
          </button>
        </div>
      </div>
      {note && (
        <p className={`meta-line profile-card-note${note.error ? " is-error" : ""}`} role="status" data-testid="profile-note">
          {note.text}
        </p>
      )}
    </section>
  );
}
