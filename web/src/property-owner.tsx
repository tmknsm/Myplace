import { useEffect, useMemo, useRef, useState } from "react";
import { formatHandle, parseHandle } from "../../shared/profile";
import { api, type Doc, type MaintainedProperty, type PageRefresh, type PropertyPage, type Viewer } from "./api";
import { useAuth } from "./auth";
import { patchMyProperty } from "./my-properties";
import { dropDocument, mapDocument, restoreDocument } from "./page-data";
import { dateLabel, DOCUMENT_TYPE_LABEL, fileSize, fileUrl, isImage, shortAddress, type Toast } from "./property-shared";

/**
 * Sections only a maintainer sees. Open disputes stay on the profile next to
 * the facts they contest. How the house shows you, the switch that takes it
 * off Myplace, the document vault, co-maintainers, email preferences, and
 * handoff live on the owner tools page. Incoming neighbor requests, change
 * requests, and notices are the notifications feed on the account page.
 */

// ---------------------------------------------------------------------------
// Visibility: how this house shows you
// ---------------------------------------------------------------------------

/**
 * Hide my address and Hide my name are each set per property; the alias is
 * one per account and appears when this house hides your name. `home` is the
 * viewer's own record of the house from the account list; null until it loads.
 */
export function VisibilitySection({
  home,
  onChange,
  toast,
}: {
  home: MaintainedProperty | null;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const { user, refresh: refreshUser } = useAuth();
  const [busy, setBusy] = useState<"handle" | null>(null);
  const [handleDraft, setHandleDraft] = useState((user?.handle ?? "").replace(/^@+/, ""));
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "unavailable" | "invalid">("idle");
  const [handleHint, setHandleHint] = useState<string | null>(null);
  const checkGen = useRef(0);
  useEffect(() => {
    setHandleDraft((user?.handle ?? "").replace(/^@+/, ""));
    setAvailability("idle");
    setHandleHint(null);
  }, [user?.handle]);

  useEffect(() => {
    const raw = handleDraft.trim();
    const current = user?.handle ?? "";
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
  }, [handleDraft, user?.handle]);

  if (!user) return null;

  const hideStreet = Boolean(home?.hide_street);
  const anonymize = Boolean(home?.anonymize);
  const where = home ? shortAddress(home) : "this property";

  const flipVisibility = (field: "anonymize" | "hide_street", next: boolean, ok: (value: boolean) => string) => {
    if (!home) return;
    const previous = field === "anonymize" ? anonymize : hideStreet;
    patchMyProperty({ property_id: home.property_id, [field]: next });
    void api.setPropertyVisibility(home.property_id, { [field]: next }).then((saved) => {
      patchMyProperty(saved.property);
      toast(ok(field === "anonymize" ? saved.property.anonymize : saved.property.hide_street));
      void onChange();
    }).catch((err) => {
      patchMyProperty({ property_id: home.property_id, [field]: previous });
      toast(err instanceof Error ? err.message : "Could not update that.");
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
    flipVisibility("anonymize", !anonymize, (on) => (
      on
        ? (user.handle ? `${where} shows ${formatHandle(user.handle)} instead of your name.` : `Your name is hidden on ${where}. Add an alias below.`)
        : `${where} shows your real name again.`
    ));
  };

  const flipStreet = () => {
    flipVisibility("hide_street", !hideStreet, (on) => (
      on ? `${where} now shows only the town.` : `${where} shows its street address again.`
    ));
  };

  const saveHandle = async () => {
    if (busy || !canSaveHandle) return;
    setBusy("handle");
    try {
      const saved = await api.updateMe({ handle: handleDraft.trim() });
      await refreshUser();
      toast(`Alias is now ${formatHandle(saved.user.handle)}.`);
      void onChange();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save that handle.";
      setAvailability("unavailable");
      setHandleHint(message);
      toast(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section" id="visibility" data-testid="visibility-section">
      <div className="section-head">
        <h2>Visibility</h2>
      </div>
      <div className="group profile-card-settings" aria-busy={!home}>
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
            disabled={!home}
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
            disabled={!home}
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
              void saveHandle();
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
  );
}

// ---------------------------------------------------------------------------
// Manage: take the house off Myplace
// ---------------------------------------------------------------------------

/**
 * Off by default. When on, the parcel disappears from search, the map, and
 * every public URL until it is turned back off. These settings stay reachable
 * the whole time, so this is also the way back.
 */
export function ManageSection({
  home,
  onChange,
  toast,
}: {
  home: MaintainedProperty | null;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const where = home ? shortAddress(home) : "this property";
  const removed = Boolean(home?.removed);

  const flipRemoved = () => {
    if (!home) return;
    const next = !home.removed;
    patchMyProperty({ property_id: home.property_id, removed: next });
    void api.setPropertyRemoved(home.property_id, next).then((saved) => {
      patchMyProperty(saved.property);
      toast(saved.property.removed
        ? `${where} is off Myplace. Turn this off to bring it back.`
        : `${where} is on Myplace again.`);
      void onChange();
    }).catch((err) => {
      patchMyProperty({ property_id: home.property_id, removed: !next });
      toast(err instanceof Error ? err.message : "Could not update that.");
    });
  };

  return (
    <section className="section" id="manage" data-testid="manage-section">
      <div className="section-head">
        <h2>Manage</h2>
      </div>
      <div className="group profile-card-settings" aria-busy={!home}>
        <div className="row">
          <div>
            <strong>Remove my property</strong>
            <div className="meta-line">Off the map, out of search, and gone from every public page.</div>
          </div>
          <button
            type="button"
            className={`switch${removed ? " on" : ""}`}
            role="switch"
            aria-checked={removed}
            aria-label={`Remove ${where}`}
            disabled={!home}
            data-testid="remove-property-toggle"
            onClick={flipRemoved}
          >
            <span className="visually-hidden">{removed ? "On" : "Off"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

const PREFERENCE_LABEL: Record<string, { label: string; help: string }> = {
  contribution_requests: { label: "Change requests", help: "Someone proposes a change to this page." },
  ownership_security: { label: "Ownership & security", help: "Claims, handoffs, and who can edit. Always sent." },
  official_changes: { label: "County record changes", help: "Assessment, sale, permit, or parcel updates from a source." },
  property_digest: { label: "Digest", help: "A summary of what changed around this house." },
};

const OPTION_LABEL: Record<string, string> = {
  immediate: "Immediately",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  off: "Off",
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function DocumentsSection({
  propertyId,
  documents,
  documentTypes,
  onChange,
  toast,
}: {
  propertyId: string;
  documents: Doc[];
  documentTypes: string[];
  onChange: PageRefresh;
  toast: Toast;
}) {
  const [type, setType] = useState("survey");
  const [busy, setBusy] = useState(false);
  const files = documents.filter((doc) => !isImage(doc));
  const transferable = files.filter((doc) => doc.transferability === "property_transferable");
  const personal = files.filter((doc) => doc.transferability !== "property_transferable");

  const upload = async (list: FileList | null) => {
    const items = Array.from(list ?? []);
    if (!items.length) return;
    setBusy(true);
    try {
      for (const file of items) await api.upload(propertyId, file, { documentType: type });
      toast(`${items.length} document${items.length === 1 ? "" : "s"} added to the vault.`);
      await onChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That file could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const table = (rows: Doc[]) => (
    <div className="table-scroll">
      <table>
        <thead><tr><th>Document</th><th>Type</th><th>Visibility</th><th>On handoff</th><th></th></tr></thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.document_id}>
              <td>
                <a href={fileUrl(doc)} target="_blank" rel="noreferrer">{doc.original_filename}</a>
                <small className="meta-line">{fileSize(doc.byte_size)}{doc.created_at ? ` · ${dateLabel(doc.created_at)}` : ""}</small>
              </td>
              <td>
                <select className="mini-select" value={doc.document_type} onChange={(event) => {
                  const documentType = event.target.value;
                  const previous = doc.document_type;
                  onChange((page) => mapDocument(page, doc.document_id, { document_type: documentType }));
                  void api.patchDocument(doc.document_id, { documentType }).catch(() => {
                    onChange((page) => mapDocument(page, doc.document_id, { document_type: previous }));
                  });
                }}>
                  {documentTypes.filter((key) => key !== "photo").map((key) => <option key={key} value={key}>{DOCUMENT_TYPE_LABEL[key] ?? key}</option>)}
                </select>
              </td>
              <td>
                <select className="mini-select" value={doc.visibility ?? "private"} onChange={(event) => {
                  const visibility = event.target.value;
                  const previous = doc.visibility;
                  onChange((page) => mapDocument(page, doc.document_id, { visibility }));
                  void api.patchDocument(doc.document_id, { visibility }).catch(() => {
                    onChange((page) => mapDocument(page, doc.document_id, { visibility: previous }));
                  });
                }}>
                  <option value="private">Private</option>
                  <option value="property_transferable">Visible on transfer</option>
                  <option value="public">Public</option>
                </select>
              </td>
              <td>
                <select className="mini-select" value={doc.transferability ?? "personal"} onChange={(event) => {
                  const transferability = event.target.value;
                  const previous = doc.transferability;
                  onChange((page) => mapDocument(page, doc.document_id, { transferability }));
                  void api.patchDocument(doc.document_id, { transferability }).catch(() => {
                    onChange((page) => mapDocument(page, doc.document_id, { transferability: previous }));
                  });
                }}>
                  <option value="property_transferable">Goes with the property</option>
                  <option value="personal">Stays with me</option>
                </select>
              </td>
              <td>
                <button type="button" className="text-link danger" onClick={() => {
                  onChange((page) => dropDocument(page, doc.document_id));
                  void api.deleteDocument(doc.document_id).catch(() => {
                    onChange((page) => restoreDocument(page, doc));
                    toast("Could not remove that document.");
                  });
                }}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="section" id="documents">
      <div className="section-head">
        <h2>Documents</h2>
      </div>
      <p className="meta-line section-note">
        Deed, survey, permits, warranties, the boiler manual. Private by default. Mark what travels with the house at closing; mortgage, insurance and personal notes stay with you unless you say otherwise.
      </p>
      <div className="group form-card upload-card">
        <label className="stack">
          <span>Document type</span>
          <select className="field" value={type} onChange={(event) => setType(event.target.value)} data-testid="document-type">
            {documentTypes.filter((key) => key !== "photo").map((key) => <option key={key} value={key}>{DOCUMENT_TYPE_LABEL[key] ?? key}</option>)}
          </select>
        </label>
        <label className={`btn file-btn ${busy ? "is-busy" : ""}`}>
          {busy ? "Uploading…" : "Choose files"}
          <input type="file" multiple disabled={busy} data-testid="document-input" onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
        </label>
      </div>
      {files.length === 0 && <div className="group empty-card">Empty so far. The survey or the last permit is a good first upload.</div>}
      {transferable.length > 0 && (
        <>
          <h3 className="subhead">Goes with the property</h3>
          {table(transferable)}
        </>
      )}
      {personal.length > 0 && (
        <>
          <h3 className="subhead">Stays with you</h3>
          {table(personal)}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Disputes, maintainers, notifications, handoff
// ---------------------------------------------------------------------------

export function DisputesSection({ disputes, onChange, toast }: { disputes: PropertyPage["disputes"]; onChange: PageRefresh; toast: Toast }) {
  return (
    <section className="section" id="disputes">
      <h2>Open disputes</h2>
      <p className="meta-line section-note">Official facts you've flagged. A reviewer settles each one; the county's value stays visible meanwhile.</p>
      <div className="group">
        {disputes.map((dispute) => (
          <div key={dispute.contributionId} className="row">
            <div>
              <strong>{dispute.label}</strong>
              <div className="meta-line">
                {dispute.proposedValue !== null && dispute.proposedValue !== "" ? <>Proposed: {String(dispute.proposedValue)}. </> : null}
                {dispute.note ? `“${dispute.note}” ` : ""}
                {dateLabel(dispute.createdAt)}
              </div>
            </div>
            <button type="button" className="text-link" onClick={async () => {
              await api.withdrawContribution(dispute.contributionId);
              toast("Dispute withdrawn.");
              await onChange();
            }}>Withdraw</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MaintainersSection({
  propertyId,
  maintainers,
  invitations,
  viewer,
  currentUserId,
  onChange,
  toast,
}: {
  propertyId: string;
  maintainers: PropertyPage["maintainers"];
  invitations: PropertyPage["invitations"];
  viewer: Viewer;
  currentUserId: string | null;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = invitations.filter((invitation) => invitation.role === "co_owner");
  return (
    <section className="section" id="maintainers">
      <h2>Who can edit</h2>
      <p className="meta-line section-note">Co-owners see everything you see and can change anything you can. Everyone's access ends at handoff.</p>
      <div className="group">
        {maintainers.map((maintainer) => (
          <div key={maintainer.maintainer_id} className="row">
            <div>
              <strong>{maintainer.label || maintainer.display_name || maintainer.primary_email}{maintainer.user_id === currentUserId ? " (you)" : ""}</strong>
              <div className="meta-line">{[maintainer.primary_email, maintainer.role === "co_owner" ? "co-owner" : "owner", `since ${dateLabel(maintainer.verified_at)}`].filter(Boolean).join(" · ")}</div>
            </div>
            {viewer.role === "owner" && maintainer.role === "co_owner" && maintainer.user_id !== currentUserId && (
              <button type="button" className="text-link danger" onClick={async () => {
                await api.removeMaintainer(propertyId, maintainer.maintainer_id);
                toast("Co-owner removed.");
                await onChange();
              }}>Remove</button>
            )}
          </div>
        ))}
        {pending.map((invitation) => (
          <div key={invitation.invitation_id} className="row">
            <div>
              <strong>{invitation.invited_email}</strong>
              <div className="meta-line">Invitation sent {dateLabel(invitation.created_at)} · waiting to accept</div>
            </div>
            <button type="button" className="text-link" onClick={async () => {
              await api.cancelInvitation(invitation.invitation_id);
              await onChange();
            }}>Cancel</button>
          </div>
        ))}
      </div>
      <form className="inline-form" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.inviteCoOwner(propertyId, email);
          toast(`Invitation sent to ${email}.`);
          setEmail("");
          await onChange();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not invite");
        } finally {
          setBusy(false);
        }
      }}>
        <input className="field" type="email" placeholder="Invite a co-owner by email" value={email} onChange={(event) => setEmail(event.target.value)} data-testid="invite-email" />
        <button type="submit" className="btn secondary" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Invite"}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function NotificationsSection({ propertyId, preferences, options, toast }: { propertyId: string; preferences: Record<string, string>; options: Record<string, string[]>; toast: Toast }) {
  const [prefs, setPrefs] = useState(preferences);
  useEffect(() => setPrefs(preferences), [preferences]);
  const keys = useMemo(() => Object.keys(PREFERENCE_LABEL), []);
  return (
    <section className="section" id="notifications">
      <h2>Email notifications</h2>
      <p className="meta-line section-note">How often we write to you about this page. Ownership and security notices can't be turned off.</p>
      <div className="group">
        {keys.map((key) => {
          const choices = options[key] ?? [prefs[key] ?? "immediate"];
          return (
            <div key={key} className="row">
              <div>
                <strong>{PREFERENCE_LABEL[key]?.label ?? key}</strong>
                <div className="meta-line">{PREFERENCE_LABEL[key]?.help}</div>
              </div>
              <select
                className="mini-select"
                value={prefs[key] ?? choices[0]}
                disabled={choices.length < 2}
                data-testid={`pref-${key}`}
                onChange={async (event) => {
                  const next = { ...prefs, [key]: event.target.value };
                  setPrefs(next);
                  const saved = await api.savePreferences(propertyId, { [key]: event.target.value });
                  setPrefs(saved.preferences);
                  toast("Notification preference saved.");
                }}
              >
                {choices.map((choice) => <option key={choice} value={choice}>{OPTION_LABEL[choice] ?? choice}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HandoffSection({ propertyId, toast, onChange }: { propertyId: string; toast: Toast; onChange: PageRefresh }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="section" id="handoff">
      <h2>Handoff</h2>
      <p className="meta-line section-note">
        Selling? Send the buyer one invitation. Once they're verified, the page is theirs and your access ends. Documents marked “goes with the property” travel; the rest stay with you.
      </p>
      <form className="inline-form" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.handoff(propertyId, email);
          toast(`Handoff invitation sent to ${email}.`);
          setEmail("");
          await onChange();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not send invitation");
        } finally {
          setBusy(false);
        }
      }}>
        <input className="field" type="email" placeholder="Buyer’s email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button type="submit" className="btn secondary" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Invite the new owner"}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
