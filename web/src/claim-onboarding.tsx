import { useEffect, useRef, useState, type ReactNode } from "react";
import { ownerPhoto, parseHandle, publicAddress } from "../../shared/profile";
import { api, type Claim, type User } from "./api";
import { Spinner } from "./components";

/**
 * The two steps between "your email works" and "prove you own it". Both write
 * onto the open claim so nothing is lost if the person leaves and comes back,
 * and nothing shows on the house until a reviewer says yes.
 */

export const ONBOARDING_STEPS = ["You", "Your home", "Proof"] as const;

export function OnboardingProgress({ step }: { step: number }) {
  return (
    <div className="onboard-progress" role="img" aria-label={`Step ${step} of ${ONBOARDING_STEPS.length}`}>
      {ONBOARDING_STEPS.map((label, i) => (
        <span key={label} className={i + 1 < step ? "is-done" : i + 1 === step ? "is-on" : ""} />
      ))}
    </div>
  );
}

/** Frame shared by every onboarding step: progress, headline, body, one fixed action row. */
export function OnboardingStep({
  step,
  kicker,
  title,
  lede,
  children,
  actions,
  onSubmit,
}: {
  step: number;
  kicker: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  onSubmit?: () => void;
}) {
  return (
    <form
      className="auth-form onboard-step"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div className="auth-body">
        <OnboardingProgress step={step} />
        <div className="kicker">{kicker}</div>
        <h1 className="display">{title}</h1>
        {lede && <p className="meta-line auth-lede onboard-lede">{lede}</p>}
        {children}
      </div>
      <div className="manage-cta onboard-cta">{actions}</div>
    </form>
  );
}

// ---- Identity ---------------------------------------------------------------

type NameMode = "name" | "alias";
type Placement = "street" | "town" | "hidden";

function placementOf(claim: Claim): Placement {
  if (claim.hide_listing) return "hidden";
  if (claim.hide_street) return "town";
  return "street";
}

function useHandleCheck(handle: string, own: string | null) {
  const [state, setState] = useState<"idle" | "checking" | "available" | "unavailable" | "invalid">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const gen = useRef(0);
  useEffect(() => {
    const current = ++gen.current;
    if (!handle) {
      setState("idle");
      setHint(null);
      return;
    }
    const parsed = parseHandle(handle);
    if ("error" in parsed) {
      setState("invalid");
      setHint(parsed.error);
      return;
    }
    if (own && parsed.handle === own.toLowerCase()) {
      setState("available");
      setHint(null);
      return;
    }
    setState("checking");
    setHint(null);
    const timer = window.setTimeout(() => {
      void api.handleAvailable(parsed.handle).then((res) => {
        if (current !== gen.current) return;
        setState(res.available ? "available" : "unavailable");
      }).catch((err) => {
        if (current !== gen.current) return;
        setState("invalid");
        setHint(err instanceof Error ? err.message : null);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [handle, own]);
  return { state, hint };
}

export function IdentityStep({
  user,
  claim,
  property,
  onDone,
  onUser,
}: {
  user: User;
  claim: Claim;
  property: { formatted: string | null; municipality: string | null; county: string };
  onDone: (claim: Claim) => void;
  onUser: () => Promise<unknown>;
}) {
  const [mode, setMode] = useState<NameMode>(() => (claim.anonymize || (!user.first_name && user.handle) ? "alias" : "name"));
  const [firstName, setFirstName] = useState(user.first_name ?? "");
  const [lastName, setLastName] = useState(user.last_name ?? "");
  const [handle, setHandle] = useState((user.handle ?? "").replace(/^@+/, ""));
  const [placement, setPlacement] = useState<Placement>(() => placementOf(claim));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useHandleCheck(mode === "alias" ? handle : "", user.handle);

  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  const label = mode === "alias" ? (handle ? `@${handle}` : "@yourname") : fullName || "Your name";
  const streetOnly = property.formatted?.split(",")[0]?.trim() || property.municipality || "your home";
  const townLine = publicAddress({ ...property, hideStreet: true }) ?? property.municipality ?? "";
  const addressLine = placement === "street"
    ? property.formatted ?? townLine
    : placement === "town"
      ? townLine
      : "Hidden from the map and search";

  const ready = !busy && (mode === "name" ? Boolean(firstName.trim()) : check.state === "available");

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "name") {
        if (firstName.trim() !== (user.first_name ?? "") || lastName.trim() !== (user.last_name ?? "")) {
          await api.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() });
        }
      } else if (handle.toLowerCase() !== (user.handle ?? "").toLowerCase()) {
        await api.updateMe({ handle });
      }
      const saved = await api.patchClaim(claim.claim_id, {
        anonymize: mode === "alias",
        hide_street: placement !== "street",
        hide_listing: placement === "hidden",
      });
      await onUser();
      onDone(saved.claim);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
      setBusy(false);
    }
  };

  const handleTone = check.state === "available" ? " is-ok" : check.state === "unavailable" || check.state === "invalid" ? " is-error" : "";
  const handleHint = check.state === "available"
    ? "Available"
    : check.state === "unavailable"
      ? "Taken. Try another."
      : check.state === "checking"
        ? "Checking…"
        : check.hint ?? "Letters, numbers, and underscores.";

  return (
    <OnboardingStep
      step={1}
      kicker="Step 1 of 3"
      title="How should you appear?"
      lede={<>This is how {streetOnly} introduces you to the neighborhood. You can change any of it later.</>}
      onSubmit={() => void save()}
      actions={
        <button type="submit" className="btn" disabled={!ready} data-testid="onboard-identity-continue">
          {busy ? <Spinner /> : "Continue"}
        </button>
      }
    >
      <div className="onboard-preview" aria-live="polite">
        <img className="onboard-preview-avatar" src={ownerPhoto(user)} alt="" />
        <div className="onboard-preview-text">
          <strong key={label} className="onboard-preview-name">{label}</strong>
          <span key={addressLine} className={`onboard-preview-address${placement === "hidden" ? " is-hidden" : ""}`}>
            {placement === "hidden" && <HiddenIcon />}
            {addressLine}
          </span>
        </div>
      </div>

      <h2 className="onboard-label">Your name</h2>
      <div className="onboard-cards" role="radiogroup" aria-label="Your name">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "name"}
          className={`onboard-card${mode === "name" ? " is-on" : ""}`}
          onClick={() => setMode("name")}
          data-testid="onboard-name-real"
        >
          <PersonIcon />
          <strong>My name</strong>
          <span>First and last, the way neighbors know you.</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "alias"}
          className={`onboard-card${mode === "alias" ? " is-on" : ""}`}
          onClick={() => setMode("alias")}
          data-testid="onboard-name-alias"
        >
          <MaskIcon />
          <strong>A private alias</strong>
          <span>A handle instead. Your name stays off the page.</span>
        </button>
      </div>

      <div className="onboard-reveal" key={mode}>
        {mode === "name" ? (
          <div className="auth-names">
            <label className="stack">
              <span>First name</span>
              <input
                className="field"
                type="text"
                autoComplete="given-name"
                autoCapitalize="words"
                autoCorrect="off"
                autoFocus={!firstName}
                maxLength={80}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                data-testid="onboard-first-name"
              />
            </label>
            <label className="stack">
              <span>Last name</span>
              <input
                className="field"
                type="text"
                autoComplete="family-name"
                autoCapitalize="words"
                autoCorrect="off"
                maxLength={80}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <div className="stack onboard-alias">
            <label className="onboard-field-label" htmlFor="onboard-handle">Alias</label>
            <span className={`profile-handle${handleTone}`}>
              <span className="profile-handle-at" aria-hidden="true">@</span>
              <input
                id="onboard-handle"
                className="field"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={!handle}
                maxLength={24}
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 24))}
                placeholder="yourname"
                aria-invalid={check.state === "unavailable" || check.state === "invalid"}
                data-testid="onboard-handle"
              />
            </span>
            <span className={`meta-line onboard-hint${handleTone}`}>{handleHint}</span>
          </div>
        )}
      </div>

      <h2 className="onboard-label">Your address</h2>
      <div className="onboard-options" role="radiogroup" aria-label="Your address">
        <PlacementOption
          on={placement === "street"}
          onPick={() => setPlacement("street")}
          icon={<PinIcon />}
          title="Show my street address"
          body={property.formatted ?? streetOnly}
          testId="onboard-place-street"
        />
        <PlacementOption
          on={placement === "town"}
          onPick={() => setPlacement("town")}
          icon={<TownIcon />}
          title="Show only the town"
          body={townLine}
          testId="onboard-place-town"
        />
        <PlacementOption
          on={placement === "hidden"}
          onPick={() => setPlacement("hidden")}
          icon={<HiddenIcon />}
          title="Hide from the map and search"
          body="No pin, no search result, no public page. Your record is still yours."
          testId="onboard-place-hidden"
        />
      </div>
      {error && <p className="error">{error}</p>}
    </OnboardingStep>
  );
}

function PlacementOption({
  on,
  onPick,
  icon,
  title,
  body,
  testId,
}: {
  on: boolean;
  onPick: () => void;
  icon: ReactNode;
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={`onboard-option${on ? " is-on" : ""}`}
      onClick={onPick}
      data-testid={testId}
    >
      <span className="onboard-option-icon">{icon}</span>
      <span className="onboard-option-text">
        <strong>{title}</strong>
        <span>{body}</span>
      </span>
      <span className="onboard-option-check" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 10.5l3.2 3.2L15 7" />
        </svg>
      </span>
    </button>
  );
}

// ---- Hero photo -------------------------------------------------------------

const CAPTION_MAX = 2000;

export function HeroStep({
  claim,
  onBack,
  onDone,
}: {
  claim: Claim;
  onBack: () => void;
  onDone: (claim: Claim) => void;
}) {
  const [documentId, setDocumentId] = useState<string | null>(claim.hero_document_id ?? null);
  const [preview, setPreview] = useState<string | null>(claim.hero_document_id ? `/api/documents/${claim.hero_document_id}/file` : null);
  const [caption, setCaption] = useState(claim.hero_caption ?? "");
  const [asPost, setAsPost] = useState(claim.hero_as_post ?? true);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const uploadGen = useRef(0);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setError("Choose a photo.");
      return;
    }
    const gen = ++uploadGen.current;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);
    setError(null);
    setUploading(true);
    try {
      const res = await api.upload(claim.property_id, file, { claimId: claim.claim_id, hero: "true" });
      if (gen !== uploadGen.current) return;
      setDocumentId(res.documentId);
    } catch (err) {
      if (gen !== uploadGen.current) return;
      setPreview(documentId ? `/api/documents/${documentId}/file` : null);
      setError(err instanceof Error ? err.message : "Could not upload that photo.");
    } finally {
      if (gen === uploadGen.current) setUploading(false);
    }
  };

  const remove = async () => {
    uploadGen.current += 1;
    setUploading(false);
    setPreview(null);
    const previous = documentId;
    setDocumentId(null);
    if (fileRef.current) fileRef.current.value = "";
    if (previous) {
      await api.patchClaim(claim.claim_id, { hero_document_id: null }).catch(() => undefined);
    }
  };

  const hasPhoto = Boolean(documentId) && !uploading;
  const finish = async (skip: boolean) => {
    if (busy || uploading) return;
    setBusy(true);
    setError(null);
    try {
      if (skip && documentId) await api.patchClaim(claim.claim_id, { hero_document_id: null });
      const saved = await api.patchClaim(claim.claim_id, skip
        ? { hero_caption: null }
        : { hero_caption: caption.trim() || null, hero_as_post: asPost });
      onDone(saved.claim);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
      setBusy(false);
    }
  };

  const remaining = CAPTION_MAX - caption.length;

  return (
    <OnboardingStep
      step={2}
      kicker="Step 2 of 3 · Optional"
      title="Show off your home"
      lede="One photo you love becomes the face of your page. You can skip this and add one later."
      onSubmit={() => void finish(!hasPhoto)}
      actions={
        <>
          <button type="button" className="btn secondary onboard-back" onClick={onBack} disabled={busy}>Back</button>
          {hasPhoto ? (
            <button type="submit" className="btn" disabled={busy || uploading} data-testid="onboard-hero-continue">
              {busy ? <Spinner /> : "Continue"}
            </button>
          ) : (
            <button type="submit" className="btn" disabled={busy || uploading} data-testid="onboard-hero-skip">
              {busy ? <Spinner /> : uploading ? "Uploading…" : "Skip for now"}
            </button>
          )}
        </>
      }
    >
      <div className={`hero-drop${preview ? " has-photo" : ""}${uploading ? " is-uploading" : ""}`}>
        {preview ? (
          <>
            <img src={preview} alt="Your home" />
            <div className="hero-drop-tools">
              <label className="hero-tool file-btn">
                Replace
                <input type="file" accept="image/*,.heic,.heif" onChange={(e) => void pick(e.target.files?.[0])} disabled={uploading} />
              </label>
              <button type="button" className="hero-tool" onClick={() => void remove()} disabled={uploading}>Remove</button>
            </div>
            {uploading && (
              <div className="hero-drop-busy" role="status" aria-label="Uploading">
                <Spinner />
              </div>
            )}
          </>
        ) : (
          <label className="hero-drop-empty">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              onChange={(e) => void pick(e.target.files?.[0])}
              data-testid="onboard-hero-file"
            />
            <span className="hero-drop-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
                <circle cx="12" cy="12.3" r="3.3" />
              </svg>
            </span>
            <strong>Add a photo</strong>
            <span>The front of the house, the porch, the view from the yard.</span>
          </label>
        )}
      </div>

      <div className={`onboard-hero-details${preview ? " is-open" : ""}`} aria-hidden={!preview}>
        <div className="onboard-hero-details-slot">
        <div className="stack">
          <label className="onboard-field-label" htmlFor="onboard-hero-caption">Caption</label>
          <textarea
            id="onboard-hero-caption"
            className="field hero-caption"
            rows={3}
            maxLength={CAPTION_MAX}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Say something about it."
            tabIndex={preview ? 0 : -1}
            data-testid="onboard-hero-caption"
          />
          {remaining < 200 && <span className="meta-line onboard-hint">{remaining} left</span>}
        </div>
        <div className="onboard-toggle">
          <div className="onboard-toggle-text">
            <strong>Share as your first post</strong>
            <span>Neighbors see it in their feed once you're verified. Off keeps it as the cover only.</span>
          </div>
          <button
            type="button"
            className={`switch${asPost ? " on" : ""}`}
            role="switch"
            aria-checked={asPost}
            aria-label="Share as your first post"
            onClick={() => setAsPost((v) => !v)}
            tabIndex={preview ? 0 : -1}
            data-testid="onboard-hero-as-post"
          >
            <span className="visually-hidden">{asPost ? "On" : "Off"}</span>
          </button>
        </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </OnboardingStep>
  );
}

// ---- Icons ------------------------------------------------------------------

function PersonIcon() {
  return (
    <svg className="onboard-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.8 20c.7-3.6 3.6-5.6 7.2-5.6s6.5 2 7.2 5.6" />
    </svg>
  );
}

function MaskIcon() {
  return (
    <svg className="onboard-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7.5c2.6-1 5.3-1.5 8-1.5s5.4.5 8 1.5v4.3c0 4.4-3.5 7.7-8 8.2-4.5-.5-8-3.8-8-8.2V7.5Z" />
      <path d="M8 12.2c.9-.6 2-.6 3 0M13 12.2c.9-.6 2-.6 3 0" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" />
      <circle cx="12" cy="10.6" r="2.1" />
    </svg>
  );
}

function TownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 20h17" />
      <path d="M5 20V9.5l4-3 4 3V20" />
      <path d="M13 20v-8h6v8" />
      <path d="M8 13h2M8 16.5h2M15.5 15h1" />
    </svg>
  );
}

function HiddenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 12s3.2-5.8 8.5-5.8 8.5 5.8 8.5 5.8-3.2 5.8-8.5 5.8S3.5 12 3.5 12Z" />
      <circle cx="12" cy="12" r="2.3" />
      <path d="M4.5 4.5l15 15" />
    </svg>
  );
}