import { useEffect, useMemo, useState } from "react";
import { formatHandle, ownerLabel, ownerPhoto } from "../../shared/profile";
import { api, type Doc, type PageRefresh, type PropertyPage, type User, type Viewer } from "./api";
import { dateLabel, DOCUMENT_TYPE_LABEL, fileSize, fileUrl, isImage, type Toast } from "./property-shared";

/**
 * Sections only a maintainer sees. Open disputes stay on the profile next to
 * the facts they contest. The document vault, co-maintainers, email
 * preferences, and handoff live on the owner tools page. Incoming requests
 * and notices sit in the inbox behind the bell.
 */

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
                <select className="mini-select" value={doc.document_type} onChange={async (event) => { await api.patchDocument(doc.document_id, { documentType: event.target.value }); await onChange(); }}>
                  {documentTypes.filter((key) => key !== "photo").map((key) => <option key={key} value={key}>{DOCUMENT_TYPE_LABEL[key] ?? key}</option>)}
                </select>
              </td>
              <td>
                <select className="mini-select" value={doc.visibility ?? "private"} onChange={async (event) => { await api.patchDocument(doc.document_id, { visibility: event.target.value }); await onChange(); }}>
                  <option value="private">Private</option>
                  <option value="property_transferable">Visible on transfer</option>
                  <option value="public">Public</option>
                </select>
              </td>
              <td>
                <select className="mini-select" value={doc.transferability ?? "personal"} onChange={async (event) => { await api.patchDocument(doc.document_id, { transferability: event.target.value }); await onChange(); }}>
                  <option value="property_transferable">Goes with the property</option>
                  <option value="personal">Stays with me</option>
                </select>
              </td>
              <td>
                <button type="button" className="text-link danger" onClick={async () => { await api.deleteDocument(doc.document_id); await onChange(); }}>Remove</button>
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

export function AnonymizeSection({
  user,
  onUser,
  toast,
}: {
  user: User;
  onUser: () => void | Promise<void>;
  toast: Toast;
}) {
  const [busy, setBusy] = useState(false);
  const [handleDraft, setHandleDraft] = useState((user.handle ?? "").replace(/^@+/, ""));
  useEffect(() => {
    setHandleDraft((user.handle ?? "").replace(/^@+/, ""));
  }, [user.handle]);
  const preview = {
    anonymize: user.anonymize,
    handle: user.handle,
    first_name: user.first_name,
    last_name: user.last_name,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    anonymous_avatar_url: user.anonymous_avatar_url,
  };
  const handle = formatHandle(user.handle);
  const flip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await api.updateMe({ anonymize: !user.anonymize });
      await onUser();
      toast(saved.user.anonymize ? "The page now shows your handle." : "The page now shows your name.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update that.");
    } finally {
      setBusy(false);
    }
  };
  const saveHandle = async () => {
    if (busy || !handleDraft.trim()) return;
    setBusy(true);
    try {
      await api.updateMe({ handle: handleDraft.trim() });
      await onUser();
      toast("Handle saved.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that handle.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section" id="anonymize" data-testid="anonymize-section">
      <h2>On the property page</h2>
      <p className="meta-line section-note">
        Your name and photo sit above the address. Anonymize to show {handle ?? "your @handle"} and a faceless mark instead. Co-owners set this on their own account.
      </p>
      <div className="group">
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
            <button type="submit" className="btn small secondary" disabled={busy || !handleDraft.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </form>
        )}
        <div className="row">
          <div>
            <strong>Anonymize</strong>
            <div className="meta-line">
              {user.anonymize
                ? `${handle ?? "Your handle"} and an abstract mark. Neighbors won’t see your name.`
                : "Your first and last name, with your photo."}
            </div>
            <div className="owner-byline owner-byline-preview" aria-hidden="true">
              <img src={ownerPhoto(preview)} alt="" width={16} height={16} />
              <span>{ownerLabel(preview)}</span>
            </div>
          </div>
          <button
            type="button"
            className={`switch${user.anonymize ? " on" : ""}`}
            role="switch"
            aria-checked={user.anonymize}
            aria-label="Anonymize"
            disabled={busy || !user.handle}
            data-testid="anonymize-toggle"
            onClick={() => void flip()}
          >
            <span className="visually-hidden">{user.anonymize ? "On" : "Off"}</span>
          </button>
        </div>
      </div>
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
