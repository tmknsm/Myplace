import { useEffect, useRef, useState } from "react";
import { formatHandle, ownerLabel, ownerPhoto, parseHandle } from "../../shared/profile";
import { api, type User } from "./api";
import { Spinner } from "./components";
import { snapshotPhotoFile } from "./optimize-photo";
import { useToast } from "./property-shared";

/**
 * The top of the account page: one photo (tap the camera to change it), the
 * name property pages show, then handle + anonymize. Anonymize only swaps the
 * name for the handle; the photo is whatever they last chose.
 */
export function ProfileCard({ user, onUser }: { user: User; onUser: () => Promise<void> }) {
  const [busy, setBusy] = useState<"anonymize" | "handle" | "photo" | null>(null);
  const [toast, showToast] = useToast();
  const [handleDraft, setHandleDraft] = useState((user.handle ?? "").replace(/^@+/, ""));
  const [handleError, setHandleError] = useState<string | null>(null);
  const checkGen = useRef(0);
  useEffect(() => {
    setHandleDraft((user.handle ?? "").replace(/^@+/, ""));
    setHandleError(null);
  }, [user.handle]);

  useEffect(() => {
    const raw = handleDraft.trim();
    if (!raw) {
      setHandleError(user.handle ? "Choose a handle." : null);
      return;
    }
    const parsed = parseHandle(raw);
    if ("error" in parsed) {
      setHandleError(parsed.error);
      return;
    }
    if (parsed.handle === user.handle) {
      setHandleError(null);
      return;
    }
    const gen = ++checkGen.current;
    const timer = window.setTimeout(() => {
      void api.handleAvailable(parsed.handle).then((res) => {
        if (gen !== checkGen.current) return;
        setHandleError(res.available ? null : "That handle is already taken.");
      }).catch(() => {
        if (gen !== checkGen.current) return;
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [handleDraft, user.handle]);

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<string>, failure: string) => {
    if (busy) return;
    setBusy(kind);
    try {
      showToast(await work());
    } catch (err) {
      const message = err instanceof Error ? err.message : failure;
      if (kind === "handle") setHandleError(message);
      showToast(message);
    } finally {
      setBusy(null);
    }
  };

  const handle = formatHandle(user.handle);
  const label = ownerLabel(user);
  const dirty = handleDraft.trim().toLowerCase().replace(/^@+/, "") !== (user.handle ?? "");
  const canSaveHandle = dirty && !handleError && Boolean(handleDraft.trim());

  const flip = () =>
    run("anonymize", async () => {
      const saved = await api.updateMe({ anonymize: !user.anonymize });
      await onUser();
      return saved.user.anonymize ? "Property pages now show your handle." : "Property pages now show your name.";
    }, "Could not update that.");

  const saveHandle = () => {
    if (busy || !canSaveHandle) return;
    void run("handle", async () => {
      const saved = await api.updateMe({ handle: handleDraft.trim() });
      await onUser();
      return `Handle is now ${formatHandle(saved.user.handle)}.`;
    }, "Could not save that handle.");
  };

  const uploadPhoto = (file: File) =>
    run("photo", async () => {
      await api.uploadAvatar(file);
      await onUser();
      return "Photo updated.";
    }, "That photo could not be uploaded.");

  return (
    <>
      <section className="profile-card" data-testid="profile-card">
        <label className={`profile-card-avatar file-btn${busy === "photo" ? " is-busy" : ""}`} aria-label="Change photo" aria-busy={busy === "photo"}>
          <img src={ownerPhoto(user)} alt="" width={96} height={96} data-testid="profile-avatar" />
          <span className="profile-card-avatar-cam" aria-hidden="true">
            <CameraIcon />
          </span>
          {busy === "photo" && <span className="profile-card-avatar-busy"><Spinner /></span>}
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
              void copy.then(uploadPhoto).catch((err) => showToast(err instanceof Error ? err.message : "That photo could not be read."));
            }}
          />
        </label>
        <h1 className="display profile-card-name" data-testid="profile-name">{label}</h1>
        <p className="meta-line profile-card-sub" data-testid="profile-sub">
          {user.anonymize ? "Real name is never displayed." : user.primary_email}
        </p>
      </section>
      <section className="section" data-testid="visibility-section">
        <h2>Visibility</h2>
        <div className="group profile-card-settings">
          <form
            className="row profile-handle-row"
            onSubmit={(event) => {
              event.preventDefault();
              saveHandle();
            }}
          >
            <label className="profile-handle-label">
              <strong>Handle</strong>
              <span className={`profile-handle${handleError ? " is-error" : ""}`}>
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
                  onBlur={() => saveHandle()}
                  placeholder="yourname"
                  aria-invalid={Boolean(handleError)}
                  data-testid="profile-handle"
                />
              </span>
              <span className={`meta-line${handleError ? " is-error" : ""}`} data-testid="profile-handle-hint">
                {handleError ?? (user.handle ? "Shown on property pages when Anonymous is on." : "Add a handle to go anonymous.")}
              </span>
            </label>
          </form>
          <div className="row">
            <div>
              <strong>Anonymous</strong>
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
              aria-label="Anonymous"
              disabled={busy !== null || !user.handle}
              data-testid="anonymize-toggle"
              onClick={() => void flip()}
            >
              <span className="visually-hidden">{user.anonymize ? "On" : "Off"}</span>
            </button>
          </div>
        </div>
      </section>
      {toast && (
        <div className="page-toast" role="status" data-testid="profile-toast">{toast}</div>
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
