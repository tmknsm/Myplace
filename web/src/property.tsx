import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Doc, type Fact, type Improvement, type PropertyPage, type Viewer } from "./api";
import { useAuth } from "./auth";
import { actorLabel, eventLabel, ParcelMap, STATUS_LABEL, unknownHint } from "./components";
import { PinClaimModal, useOwnershipChanges } from "./debug";
import { useMeta } from "./meta";

type PageData = { property: PropertyPage; viewer: Viewer };

const MULTILINE_FIELDS = new Set(["renovations", "additions", "structures", "maintenance"]);

const CATEGORY_LABEL: Record<string, string> = {
  roof: "Roof",
  hvac: "Heating & cooling",
  plumbing: "Plumbing",
  electrical: "Electrical",
  septic_well: "Septic & well",
  windows_doors: "Windows & doors",
  kitchen: "Kitchen",
  bath: "Bath",
  exterior: "Exterior & siding",
  landscaping: "Landscaping",
  structure: "Structure & foundation",
  appliance: "Appliance",
  energy: "Energy & solar",
  maintenance: "Maintenance",
  other: "Other",
};

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  survey: "Survey",
  permit: "Permit",
  certificate_of_occupancy: "Certificate of occupancy",
  deed: "Deed",
  plans: "Plans & drawings",
  inspection: "Inspection report",
  warranty: "Warranty",
  manual: "Manual",
  receipt: "Receipt / invoice",
  photo: "Photo",
  insurance: "Insurance",
  mortgage: "Mortgage",
  other: "Other",
};

const PREFERENCE_LABEL: Record<string, { label: string; help: string }> = {
  contribution_requests: { label: "Contribution requests", help: "Someone proposes a change to this record." },
  ownership_security: { label: "Ownership & security", help: "Claims, handoffs, and maintainer changes. Always sent." },
  official_changes: { label: "Official record changes", help: "Assessment, sale, permit, or parcel updates from a source." },
  property_digest: { label: "Property digest", help: "A summary of what changed around this property." },
};

const OPTION_LABEL: Record<string, string> = {
  immediate: "Immediately",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  off: "Off",
};

function money(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function dateLabel(value: string | null | undefined, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", options);
}

function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(doc: Doc): boolean {
  return Boolean(doc.mime_type?.startsWith("image/")) || doc.document_type === "photo";
}

function fileUrl(doc: Doc): string {
  return `/api/documents/${doc.document_id}/file?v=${doc.byte_size ?? 0}`;
}

function useToast(): [string | null, (message: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((message: string) => {
    setToast(message);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  return [toast, show];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PropertyPageView() {
  const { id } = useParams();
  const { user } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [toast, showToast] = useToast();
  const [improvementFormOpen, setImprovementFormOpen] = useState(false);
  const improvementsRef = useRef<HTMLElement | null>(null);
  const documentsRef = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api.property(id).then((next) => {
      setData(next);
      setError(null);
    }).catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => { void load(); }, [load, user?.user_id]);
  useOwnershipChanges(id, load);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data || !id) return <div className="page">Loading record…</div>;

  const { property, viewer } = data;
  const owner = viewer.maintainer;
  const facts = (group: string) => property.facts.filter((f) => f.group === group);
  const title = property.formatted?.split(",")[0] ?? "Untitled parcel";
  const locality = property.formatted?.includes(",")
    ? property.formatted.slice(property.formatted.indexOf(",") + 1).trim()
    : null;
  const address = property.formatted ?? "this property";
  const ownerFacts = facts("owner");
  const publicOwnerFacts = ownerFacts.filter((fact) => fact.status !== "unknown");
  const photos = [
    ...property.documents.filter(isImage),
    ...property.improvements.flatMap((item) => item.documents.filter(isImage)),
  ];

  const startClaim = () => {
    if (meta?.debug) {
      setPinOpen(true);
      return;
    }
    navigate(user ? `/property/${id}/claim` : `/signin?next=/property/${id}/claim`);
  };

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="page wide">
      <div className={`property-layout ${owner ? "is-owner" : ""}`}>
        <div className="property-head">
          <div className="kicker">{[property.municipality, property.county ? `${property.county} County` : null].filter(Boolean).join(" · ")}</div>
          <h1>{title}</h1>
          <p className="meta-line mono">{[locality, property.sbl].filter(Boolean).join(" · ")}</p>
          {owner ? (
            <div className="owner-chip-row">
              <span className="owner-chip" data-testid="owner-chip">
                <i aria-hidden="true" />
                {viewer.role === "co_owner" ? "Co-owner maintainer" : "Owner maintainer"}
                {viewer.verifiedAt ? ` · since ${dateLabel(viewer.verifiedAt, { month: "short", year: "numeric" })}` : ""}
              </span>
              <div className="action-row compact">
                <button type="button" className="btn" onClick={() => { setImprovementFormOpen(true); scrollTo(improvementsRef); }}>Add improvement</button>
                <button type="button" className="btn secondary" onClick={() => scrollTo(documentsRef)}>Upload document</button>
              </div>
            </div>
          ) : (
            <div className="action-row">
              {viewer.openClaim ? (
                <Link className="btn secondary" to={`/property/${id}/claim/${viewer.openClaim.claim_id}`}>Claim under review</Link>
              ) : (
                <button type="button" className="btn" data-testid="claim-button" onClick={startClaim}>Claim this property</button>
              )}
            </div>
          )}
        </div>

        <div className="map-panel">
          <ParcelMap
            embedded
            selectedId={property.property_id}
            selectedGeometry={property.geojson}
            onSelect={(next) => navigate(`/property/${next}`)}
            zoom={16}
          />
        </div>

        <div className="notice property-notice">
          {property.geometryNotice ?? "Lot lines are not available for this parcel."}
          {" "}Every important fact shows its source.
          {owner && " Official facts stay official; you maintain the owner layer."}
        </div>

        <div className="dossier">
          {toast && <div className="toast" role="status">{toast}</div>}

          {viewer.invitation && !owner && (
            <div className="banner">
              <div>
                <strong>{viewer.invitation.invited_by_name ?? "A maintainer"}</strong> invited you to co-maintain this record.
              </div>
              <button type="button" className="btn" onClick={async () => {
                await api.acceptInvitation(viewer.invitation!.invitation_id);
                showToast("You are now a co-owner maintainer of this record.");
                await load();
              }}>Accept invitation</button>
            </div>
          )}

          {owner && <RecordCompleteness facts={property.facts} documents={property.documents} improvements={property.improvements} />}

          <FactSection
            title="Overview"
            description={owner ? "Anything still blank has no connected source yet. Add what you know — it is labeled owner-reported and does not replace an official fact if one arrives later." : undefined}
            facts={facts("overview")}
            owner={owner}
            propertyId={id}
            onChange={load}
            toast={showToast}
          />
          <FactSection
            title="Location & services"
            description={owner ? "Fields without a connected source can be filled in by you. They are labeled owner-reported until an official source confirms them." : undefined}
            facts={facts("location")}
            owner={owner}
            propertyId={id}
            onChange={load}
            toast={showToast}
          />
          <FactSection title="Rules & environment" facts={facts("rules")} owner={owner} propertyId={id} onChange={load} toast={showToast} />
          <FactSection title="Records" facts={facts("records")} owner={owner} propertyId={id} onChange={load} toast={showToast}>
            <div className="group coverage">
              {Object.entries(property.coverage).map(([key, value]) => (
                <div key={key}><span>{key.replace("_", " ")}</span> {value}</div>
              ))}
            </div>
          </FactSection>

          {(owner || publicOwnerFacts.length > 0) && (
            <FactSection
              title="Home systems"
              description={owner
                ? "What only you know: systems, dates, and work done. Leave anything blank until you have it."
                : "Maintained by the verified owner. Not part of the official assessment record."}
              facts={owner ? ownerFacts : publicOwnerFacts}
              owner={owner}
              propertyId={id}
              onChange={load}
              toast={showToast}
            />
          )}

          {(owner || property.improvements.length > 0) && (
            <ImprovementsSection
              ref={improvementsRef}
              propertyId={id}
              owner={owner}
              improvements={property.improvements}
              categories={meta?.improvementCategories ?? Object.keys(CATEGORY_LABEL)}
              formOpen={improvementFormOpen}
              setFormOpen={setImprovementFormOpen}
              onChange={load}
              toast={showToast}
            />
          )}

          {(owner || photos.length > 0) && (
            <PhotosSection propertyId={id} owner={owner} photos={photos} onChange={load} toast={showToast} />
          )}

          {owner && (
            <DocumentsSection
              ref={documentsRef}
              propertyId={id}
              documents={property.documents.filter((doc) => !doc.improvement_id)}
              documentTypes={meta?.documentTypes ?? Object.keys(DOCUMENT_TYPE_LABEL)}
              onChange={load}
              toast={showToast}
            />
          )}

          {owner && property.disputes.length > 0 && (
            <DisputesSection propertyId={id} disputes={property.disputes} onChange={load} toast={showToast} />
          )}

          {owner && (
            <MaintainersSection
              propertyId={id}
              maintainers={property.maintainers}
              invitations={property.invitations}
              viewer={viewer}
              currentUserId={user?.user_id ?? null}
              onChange={load}
              toast={showToast}
            />
          )}

          {owner && viewer.preferences && (
            <NotificationsSection
              propertyId={id}
              preferences={viewer.preferences}
              options={meta?.preferenceOptions ?? {}}
              toast={showToast}
            />
          )}

          {owner && <HandoffSection propertyId={id} toast={showToast} onChange={load} />}

          <section className="section">
            <h2>History</h2>
            <p className="meta-line section-note">{property.historyNote}</p>
            <div className="group">
              <ol className="timeline">
                {property.events.map((event) => (
                  <li key={event.event_id}>
                    <strong>{eventLabel(event.event_type)}</strong>
                    <small>
                      {new Date(event.effective_at ?? event.created_at).toLocaleDateString()}
                      {actorLabel(event.actor_type) ? ` · ${actorLabel(event.actor_type)}` : ""}
                    </small>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>

      {pinOpen && (
        <PinClaimModal
          propertyId={id}
          address={address}
          onClose={() => setPinOpen(false)}
          onClaimed={async () => {
            setPinOpen(false);
            await load();
            showToast("Ownership verified. This is now your owner-maintained record.");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function FactSection({
  title,
  description,
  facts,
  owner,
  propertyId,
  onChange,
  toast,
  children,
}: {
  title: string;
  description?: string;
  facts: Fact[];
  owner: boolean;
  propertyId: string;
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
  children?: React.ReactNode;
}) {
  if (facts.length === 0 && !children) return null;
  return (
    <section className="section">
      <h2>{title}</h2>
      {description && <p className="meta-line section-note">{description}</p>}
      <div className="group">
        {facts.map((fact) => (
          <FactRow key={fact.fieldKey} fact={fact} owner={owner} propertyId={propertyId} onChange={onChange} toast={toast} />
        ))}
      </div>
      {children}
    </section>
  );
}

function ownerCanWrite(fact: Fact): boolean {
  if (fact.layer === "owner") return true;
  return fact.status === "unknown" || fact.status === "owner_reported";
}

export function FactRow({
  fact,
  owner = false,
  propertyId,
  onChange,
  toast,
}: {
  fact: Fact;
  owner?: boolean;
  propertyId?: string;
  onChange?: () => Promise<void> | void;
  toast?: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const editable = owner && propertyId && ownerCanWrite(fact);
  const disputable = owner && propertyId && !ownerCanWrite(fact) && fact.status !== "unknown";
  const ownerAssertion = fact.assertions.find((assertion) => assertion.sourceType === "verified_owner");
  const showBadge = fact.status !== "available" && !(fact.status === "unknown" && editable);

  return (
    <div className={`fact ${editable ? "is-editable" : ""} ${fact.dispute ? "is-disputed" : ""}`} data-field={fact.fieldKey}>
      <div className="fact-label">{fact.label}</div>
      <div className="fact-value">
        {editable && editing && propertyId ? (
          <FieldEditor
            fact={fact}
            propertyId={propertyId}
            initial={ownerAssertion?.value ?? (fact.layer === "owner" ? fact.value : null)}
            onDone={async (message) => {
              setEditing(false);
              if (message && toast) toast(message);
              await onChange?.();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : editable && fact.status === "unknown" ? (
          <button type="button" className="add-value" data-testid={`add-${fact.fieldKey}`} onClick={() => setEditing(true)}>
            Add {fact.label.toLowerCase()}
          </button>
        ) : (
          <>
            <strong>{fact.display ?? "—"}</strong>
            {showBadge && <span className={`badge ${fact.status}`}>{STATUS_LABEL[fact.status]}</span>}
            {fact.dispute && <span className="badge disputed">disputed by owner</span>}
            {editable && (
              <button type="button" className="inline-edit" data-testid={`edit-${fact.fieldKey}`} onClick={() => setEditing(true)}>Edit</button>
            )}
          </>
        )}
        <div className="sources">
          {fact.status === "unknown" && !editable && <div>{unknownHint(fact.fieldKey, fact.layer)}</div>}
          {fact.assertions.map((assertion) => (
            <div key={assertion.assertionId}>
              {assertion.display} · {assertion.sourceType === "verified_owner" ? "Owner" : assertion.sourceName}
              {assertion.effectiveAt ? ` · ${new Date(assertion.effectiveAt).getFullYear()}` : ""}
            </div>
          ))}
          {fact.dispute && (
            <div className="dispute-note">
              You disputed this{fact.dispute.proposedValue !== null && fact.dispute.proposedValue !== "" ? <> and proposed <strong>{String(fact.dispute.proposedValue)}</strong></> : ""}.
              {fact.dispute.note ? ` “${fact.dispute.note}”` : ""} Waiting for review.
              {propertyId && (
                <button type="button" className="text-link" onClick={async () => {
                  await api.withdrawContribution(fact.dispute!.contributionId);
                  toast?.("Dispute withdrawn.");
                  await onChange?.();
                }}>Withdraw</button>
              )}
            </div>
          )}
          {disputable && !fact.dispute && !disputing && (
            <button type="button" className="text-link" onClick={() => setDisputing(true)}>Dispute this fact</button>
          )}
        </div>
        {disputable && disputing && propertyId && (
          <DisputeForm
            fact={fact}
            propertyId={propertyId}
            onDone={async () => {
              setDisputing(false);
              toast?.("Dispute recorded. It stays on the record until a reviewer resolves it.");
              await onChange?.();
            }}
            onCancel={() => setDisputing(false)}
          />
        )}
      </div>
    </div>
  );
}

function FieldEditor({
  fact,
  propertyId,
  initial,
  onDone,
  onCancel,
}: {
  fact: Fact;
  propertyId: string;
  initial: unknown;
  onDone: (message: string | null) => Promise<void> | void;
  onCancel: () => void;
}) {
  const meta = useMeta();
  const def = meta?.vocab.find((field) => field.key === fact.fieldKey);
  const valueType = def?.valueType ?? "string";
  const [value, setValue] = useState(initial === null || initial === undefined ? "" : String(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const multiline = MULTILINE_FIELDS.has(fact.fieldKey);
  const hasExisting = initial !== null && initial !== undefined && initial !== "";

  const save = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveOwnerFields(propertyId, { [fact.fieldKey]: next });
      await onDone(result.updated ? `${fact.label} saved to the owner record.` : result.removed ? `${fact.label} cleared.` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  const inputType = valueType === "date" ? "date" : valueType === "string" ? "text" : "number";
  return (
    <form className="field-editor" onSubmit={(event) => { event.preventDefault(); void save(value); }}>
      {multiline ? (
        <textarea className="field" rows={3} autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={`Describe ${fact.label.toLowerCase()}`} />
      ) : (
        <input
          className="field"
          autoFocus
          type={inputType}
          inputMode={inputType === "number" ? "decimal" : undefined}
          step={inputType === "number" ? "any" : undefined}
          value={value}
          placeholder={def?.unit ? `In ${def.unit}` : undefined}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
        />
      )}
      {error && <p className="error">{error}</p>}
      <div className="action-row compact">
        <button type="submit" className="btn small" disabled={busy || value.trim() === ""} data-testid={`save-${fact.fieldKey}`}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancel</button>
        {hasExisting && (
          <button type="button" className="text-link danger" disabled={busy} onClick={() => void save("")}>Clear</button>
        )}
      </div>
    </form>
  );
}

function DisputeForm({ fact, propertyId, onDone, onCancel }: { fact: Fact; propertyId: string; onDone: () => Promise<void> | void; onCancel: () => void }) {
  const [proposed, setProposed] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="field-editor" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await api.dispute(propertyId, { fieldKey: fact.fieldKey, proposedValue: proposed, note });
        await onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not record dispute");
        setBusy(false);
      }
    }}>
      <p className="meta-line">Official facts are never overwritten. Your dispute is recorded next to the fact and queued for review.</p>
      <input className="field" autoFocus placeholder={`What you believe the ${fact.label.toLowerCase()} is`} value={proposed} onChange={(event) => setProposed(event.target.value)} />
      <textarea className="field" rows={2} placeholder="Why, or what evidence you have" value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <p className="error">{error}</p>}
      <div className="action-row compact">
        <button type="submit" className="btn small" disabled={busy}>{busy ? "Recording…" : "Record dispute"}</button>
        <button type="button" className="btn secondary small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Completeness
// ---------------------------------------------------------------------------

function RecordCompleteness({ facts, documents, improvements }: { facts: Fact[]; documents: Doc[]; improvements: Improvement[] }) {
  const has = (key: string) => facts.some((fact) => fact.fieldKey === key && fact.status !== "unknown");
  const doc = (type: string) => documents.some((item) => item.document_type === type) || improvements.some((item) => item.documents.some((d) => d.document_type === type));
  const items: Array<[string, boolean]> = [
    ["Survey", doc("survey")],
    ["Deed", doc("deed") || has("deed.book")],
    ["Permits", doc("permit") || doc("certificate_of_occupancy")],
    ["Plans", doc("plans")],
    ["Roof", has("roof.type") || has("roof.year") || improvements.some((item) => item.category === "roof")],
    ["Heating", has("heating") || improvements.some((item) => item.category === "hvac")],
    ["Cooling", has("cooling")],
    ["Water heater", has("water_heater")],
    ["Electrical", has("electrical") || improvements.some((item) => item.category === "electrical")],
    ["Septic / well", has("septic_or_well") || improvements.some((item) => item.category === "septic_well")],
    ["Utilities", has("utility.electric") && has("utility.water") && has("utility.sewer")],
    ["Photos", documents.some(isImage) || improvements.some((item) => item.documents.some(isImage))],
  ];
  const done = items.filter(([, ok]) => ok).length;
  return (
    <section className="section completeness" data-testid="completeness">
      <h2>Record completeness</h2>
      <div className="group completeness-card">
        <div className="completeness-head">
          <strong>{done} of {items.length} documented</strong>
          <span className="meta-line">Completeness of the record, not the condition of the property.</span>
        </div>
        <div className="completeness-grid">
          {items.map(([label, ok]) => (
            <span key={label} className={ok ? "ok" : ""}><i aria-hidden="true">{ok ? "✓" : ""}</i>{label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Improvements
// ---------------------------------------------------------------------------

function ImprovementsSection({
  ref,
  propertyId,
  owner,
  improvements,
  categories,
  formOpen,
  setFormOpen,
  onChange,
  toast,
}: {
  ref: React.RefObject<HTMLElement | null>;
  propertyId: string;
  owner: boolean;
  improvements: Improvement[];
  categories: string[];
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const total = improvements.reduce((sum, item) => sum + (item.cost_cents ?? 0), 0);
  return (
    <section className="section" ref={ref} id="improvements">
      <div className="section-head">
        <h2>Improvements</h2>
        {owner && !formOpen && (
          <button type="button" className="text-btn accent" data-testid="add-improvement" onClick={() => setFormOpen(true)}>Add improvement</button>
        )}
      </div>
      <p className="meta-line section-note">
        {owner
          ? "Work done on the property, with receipts and photos attached. Receipts go with the property on handoff unless you mark them personal."
          : "Work the verified owner chose to share publicly."}
        {owner && total > 0 ? ` Recorded so far: ${money(total)}.` : ""}
      </p>
      {owner && formOpen && (
        <ImprovementForm
          propertyId={propertyId}
          categories={categories}
          onCancel={() => setFormOpen(false)}
          onSaved={async (count) => {
            setFormOpen(false);
            toast(count ? `Improvement recorded with ${count} attachment${count === 1 ? "" : "s"}.` : "Improvement recorded.");
            await onChange();
          }}
        />
      )}
      {improvements.length === 0 && !formOpen && (
        <div className="group empty-card">
          {owner ? "No improvements recorded yet. Start with the last big job: a roof, a boiler, a kitchen." : "None shared yet."}
        </div>
      )}
      <div className="improvement-list">
        {improvements.map((item) => (
          <ImprovementCard key={item.improvement_id} item={item} owner={owner} propertyId={propertyId} categories={categories} onChange={onChange} toast={toast} />
        ))}
      </div>
    </section>
  );
}

function ImprovementForm({
  propertyId,
  categories,
  onCancel,
  onSaved,
}: {
  propertyId: string;
  categories: string[];
  onCancel: () => void;
  onSaved: (attachments: number) => Promise<void> | void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("roof");
  const [performedAt, setPerformedAt] = useState("");
  const [cost, setCost] = useState("");
  const [contractor, setContractor] = useState("");
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="group form-card" data-testid="improvement-form" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const created = await api.createImprovement(propertyId, { title, category, performedAt: performedAt || null, cost: cost || null, contractor: contractor || null, notes: notes || null, visibility });
        for (const file of files) {
          await api.upload(propertyId, file, { improvementId: created.improvement.improvement_id, visibility });
        }
        await onSaved(files.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save improvement");
        setBusy(false);
      }
    }}>
      <div className="form-grid">
        <label className="stack span-2">
          <span>What was done</span>
          <input className="field" autoFocus required value={title} placeholder="New standing-seam roof" onChange={(event) => setTitle(event.target.value)} data-testid="improvement-title" />
        </label>
        <label className="stack">
          <span>Category</span>
          <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((key) => <option key={key} value={key}>{CATEGORY_LABEL[key] ?? key}</option>)}
          </select>
        </label>
        <label className="stack">
          <span>Date completed</span>
          <input className="field" type="date" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} />
        </label>
        <label className="stack">
          <span>Cost</span>
          <input className="field" inputMode="decimal" placeholder="$" value={cost} onChange={(event) => setCost(event.target.value)} />
        </label>
        <label className="stack">
          <span>Contractor</span>
          <input className="field" value={contractor} placeholder="Company or person" onChange={(event) => setContractor(event.target.value)} />
        </label>
        <label className="stack span-2">
          <span>Notes</span>
          <textarea className="field" rows={2} value={notes} placeholder="Materials, warranty, what to know later" onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label className="stack span-2">
          <span>Receipts and photos</span>
          <input className="field file" type="file" multiple accept="image/*,application/pdf,.heic" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} data-testid="improvement-files" />
          {files.length > 0 && <small className="meta-line">{files.map((file) => file.name).join(", ")}</small>}
        </label>
        <label className="stack span-2 inline-choice">
          <span>Visibility</span>
          <div className="segmented">
            <button type="button" className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>Private</button>
            <button type="button" className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>Public</button>
          </div>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="action-row compact">
        <button type="submit" className="btn" disabled={busy || !title.trim()} data-testid="improvement-save">{busy ? "Saving…" : "Save improvement"}</button>
        <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function ImprovementCard({
  item,
  owner,
  propertyId,
  categories,
  onChange,
  toast,
}: {
  item: Improvement;
  owner: boolean;
  propertyId: string;
  categories: string[];
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const images = item.documents.filter(isImage);
  const files = item.documents.filter((doc) => !isImage(doc));
  const details = [dateLabel(item.performed_at), money(item.cost_cents), item.contractor].filter(Boolean).join(" · ");

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        await api.upload(propertyId, file, { improvementId: item.improvement_id, visibility: item.visibility });
      }
      toast(`${list.length} attachment${list.length === 1 ? "" : "s"} added.`);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="group improvement-card" data-testid="improvement-card">
      <div className="improvement-head">
        <div>
          <span className="chip">{CATEGORY_LABEL[item.category] ?? item.category}</span>
          <h3>{item.title}</h3>
          {details && <p className="meta-line">{details}</p>}
        </div>
        {owner && (
          <select
            className="mini-select"
            value={item.category}
            aria-label="Category"
            onChange={async (event) => {
              await api.patchImprovement(item.improvement_id, { category: event.target.value });
              await onChange();
            }}
          >
            {categories.map((key) => <option key={key} value={key}>{CATEGORY_LABEL[key] ?? key}</option>)}
          </select>
        )}
      </div>
      {item.notes && <p className="improvement-notes">{item.notes}</p>}
      {images.length > 0 && (
        <ImprovementPhotos images={images} owner={owner} onChange={onChange} toast={toast} />
      )}
      {files.length > 0 && (
        <ul className="file-chips">
          {files.map((doc) => (
            <li key={doc.document_id}>
              <a href={fileUrl(doc)} target="_blank" rel="noreferrer">
                <i aria-hidden="true">▤</i>{doc.original_filename}
              </a>
              <small>{DOCUMENT_TYPE_LABEL[doc.document_type] ?? doc.document_type}{doc.byte_size ? ` · ${fileSize(doc.byte_size)}` : ""}</small>
              {owner && (
                <button type="button" className="text-link danger" onClick={async () => {
                  await api.deleteDocument(doc.document_id);
                  await onChange();
                }}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {owner && (
        <div className="improvement-foot">
          <label className={`btn secondary small file-btn ${busy ? "is-busy" : ""}`}>
            {busy ? "Uploading…" : "Add receipt or photo"}
            <input type="file" multiple accept="image/*,application/pdf,.heic" disabled={busy} onChange={(event) => { void attach(event.target.files); event.target.value = ""; }} />
          </label>
          <div className="segmented small">
            <button type="button" className={item.visibility === "private" ? "on" : ""} onClick={async () => { await api.patchImprovement(item.improvement_id, { visibility: "private" }); await onChange(); }}>Private</button>
            <button type="button" className={item.visibility === "public" ? "on" : ""} onClick={async () => { await api.patchImprovement(item.improvement_id, { visibility: "public" }); await onChange(); }}>Public</button>
          </div>
          {confirm ? (
            <span className="confirm-inline">
              Remove this improvement and its attachments?
              <button type="button" className="text-link danger" onClick={async () => {
                await api.deleteImprovement(item.improvement_id);
                toast("Improvement removed.");
                await onChange();
              }}>Remove</button>
              <button type="button" className="text-link" onClick={() => setConfirm(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="text-link danger" onClick={() => setConfirm(true)}>Remove</button>
          )}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

function PhotoLightbox({
  photos,
  index,
  owner,
  onIndex,
  onClose,
  onChange,
  toast,
}: {
  photos: Doc[];
  index: number;
  owner: boolean;
  onIndex: (next: number) => void;
  onClose: () => void;
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const photo = photos[index];
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const step = useCallback((delta: number) => {
    if (!photos.length) return;
    onIndex((index + delta + photos.length) % photos.length);
    setConfirm(false);
  }, [index, onIndex, photos.length]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, step]);

  if (!photo) return null;

  const replace = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.replaceDocument(photo.document_id, file);
      toast("Photo updated.");
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDocument(photo.document_id);
      toast("Photo deleted.");
      await onChange();
      if (photos.length <= 1) onClose();
      else onIndex(Math.min(index, photos.length - 2));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div
      className="modal-backdrop lightbox"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
    >
      <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
      {photos.length > 1 && <button type="button" className="lightbox-step prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>}
      <figure className="lightbox-figure">
        <img src={fileUrl(photo)} alt={photo.caption ?? photo.original_filename} />
        <figcaption>
          {photo.caption && <strong>{photo.caption}</strong>}
          {photos.length > 1 && <span className="meta-line">{index + 1} of {photos.length}</span>}
          {owner && (
            <div className="lightbox-actions">
              <label className={`btn secondary file-btn ${busy ? "is-busy" : ""}`}>
                {busy ? "Saving…" : "Change"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy}
                  data-testid="photo-replace"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void replace(file);
                  }}
                />
              </label>
              {confirm ? (
                <span className="confirm-inline lightbox-confirm">
                  Delete this photo?
                  <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>Delete</button>
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep</button>
                </span>
              ) : (
                <button type="button" className="btn danger" disabled={busy} data-testid="photo-delete" onClick={() => setConfirm(true)}>Delete</button>
              )}
            </div>
          )}
        </figcaption>
      </figure>
      {photos.length > 1 && <button type="button" className="lightbox-step next" aria-label="Next photo" onClick={() => step(1)}>›</button>}
    </div>
  );
}

function ImprovementPhotos({
  images,
  owner,
  onChange,
  toast,
}: {
  images: Doc[];
  owner: boolean;
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="photo-strip">
        {images.map((doc, index) => (
          <button
            key={doc.document_id}
            type="button"
            className="photo-thumb"
            onClick={() => setOpen(index)}
            aria-label={doc.caption ?? doc.original_filename}
          >
            <img src={fileUrl(doc)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null && images[open] && (
        <PhotoLightbox
          photos={images}
          index={open}
          owner={owner}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onChange={onChange}
          toast={toast}
        />
      )}
    </>
  );
}

function PhotosSection({ propertyId, owner, photos, onChange, toast }: { propertyId: string; owner: boolean; photos: Doc[]; onChange: () => Promise<void> | void; toast: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Photos</h2>
        {owner && (
          <label className={`text-btn accent file-btn ${busy ? "is-busy" : ""}`}>
            {busy ? "Uploading…" : "Add photos"}
            <input type="file" accept="image/*" multiple disabled={busy} data-testid="photo-input" onChange={async (event) => {
              const list = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (!list.length) return;
              setBusy(true);
              try {
                for (const file of list) await api.upload(propertyId, file, { documentType: "photo" });
                toast(`${list.length} photo${list.length === 1 ? "" : "s"} added.`);
                await onChange();
              } finally {
                setBusy(false);
              }
            }} />
          </label>
        )}
      </div>
      {photos.length === 0 ? (
        <div className="group empty-card">{owner ? "No photos yet. Exterior, roof, mechanicals, and before-and-after shots all belong here." : "None shared yet."}</div>
      ) : (
        <div className="photo-grid">
          {photos.map((doc, index) => (
            <figure key={doc.document_id} className="photo-card">
              <button
                type="button"
                className="photo-open"
                onClick={() => setOpen(index)}
                aria-label={owner ? `Open ${doc.caption ?? doc.original_filename}. Change or delete.` : (doc.caption ?? doc.original_filename)}
              >
                <img src={fileUrl(doc)} alt="" loading="lazy" />
              </button>
              {owner ? (
                <figcaption>
                  <input
                    className="caption-input"
                    defaultValue={doc.caption ?? ""}
                    placeholder="Add a caption"
                    onBlur={async (event) => {
                      const next = event.target.value.trim();
                      if (next === (doc.caption ?? "")) return;
                      await api.patchDocument(doc.document_id, { caption: next || null });
                      await onChange();
                    }}
                  />
                  <div className="photo-tools">
                    <select className="mini-select" value={doc.visibility ?? "private"} aria-label="Visibility" onChange={async (event) => {
                      await api.patchDocument(doc.document_id, { visibility: event.target.value });
                      await onChange();
                    }}>
                      <option value="private">Private</option>
                      <option value="property_transferable">Visible on transfer</option>
                      <option value="public">Public</option>
                    </select>
                  </div>
                </figcaption>
              ) : (
                doc.caption && <figcaption>{doc.caption}</figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
      {open !== null && photos[open] && (
        <PhotoLightbox
          photos={photos}
          index={open}
          owner={owner}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onChange={onChange}
          toast={toast}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentsSection({
  ref,
  propertyId,
  documents,
  documentTypes,
  onChange,
  toast,
}: {
  ref: React.RefObject<HTMLElement | null>;
  propertyId: string;
  documents: Doc[];
  documentTypes: string[];
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
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
    <section className="section" ref={ref} id="documents">
      <div className="section-head">
        <h2>Documents</h2>
      </div>
      <p className="meta-line section-note">
        Surveys, permits, plans, and manuals go with the property when it changes hands. Mortgage, insurance, and personal notes stay with you. Nothing here is public unless you say so.
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
      {files.length === 0 && <div className="group empty-card">The vault is empty. A survey or the last permit is a good first upload.</div>}
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

function DisputesSection({ propertyId, disputes, onChange, toast }: { propertyId: string; disputes: PropertyPage["disputes"]; onChange: () => Promise<void> | void; toast: (message: string) => void }) {
  void propertyId;
  return (
    <section className="section">
      <h2>Open disputes</h2>
      <p className="meta-line section-note">Official facts you have flagged. A reviewer resolves each one; the official value stays visible meanwhile.</p>
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

function MaintainersSection({
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
  onChange: () => Promise<void> | void;
  toast: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = invitations.filter((invitation) => invitation.role === "co_owner");
  return (
    <section className="section">
      <h2>Maintainers</h2>
      <p className="meta-line section-note">People who can maintain this record with you. Co-owners see everything you see. Maintainer rights end when ownership transfers.</p>
      <div className="group">
        {maintainers.map((maintainer) => (
          <div key={maintainer.maintainer_id} className="row">
            <div>
              <strong>{maintainer.display_name || maintainer.primary_email}{maintainer.user_id === currentUserId ? " (you)" : ""}</strong>
              <div className="meta-line">{maintainer.primary_email} · {maintainer.role === "co_owner" ? "co-owner" : "owner"} · since {dateLabel(maintainer.verified_at)}</div>
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

function NotificationsSection({ propertyId, preferences, options, toast }: { propertyId: string; preferences: Record<string, string>; options: Record<string, string[]>; toast: (message: string) => void }) {
  const [prefs, setPrefs] = useState(preferences);
  useEffect(() => setPrefs(preferences), [preferences]);
  const keys = useMemo(() => Object.keys(PREFERENCE_LABEL), []);
  return (
    <section className="section">
      <h2>Email notifications</h2>
      <p className="meta-line section-note">Delivered through Postmark. Ownership and security notices cannot be turned off.</p>
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

function HandoffSection({ propertyId, toast, onChange }: { propertyId: string; toast: (message: string) => void; onChange: () => Promise<void> | void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="section">
      <h2>Handoff</h2>
      <p className="meta-line section-note">
        Selling? Invite the buyer to claim this property. Once they are verified, your maintainer access ends. Documents marked “goes with the property” transfer; personal documents never do.
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
        <button type="submit" className="btn secondary" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Send handoff invitation"}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
