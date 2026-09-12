import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type AdminClaim, type Claim, type Doc, type MailMessage, type MailSummary, type PropertyPage, type Viewer } from "./api";
import { useAuth } from "./auth";
import { eventLabel, FactRow, ParcelMap, SearchBox } from "./components";

function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [dev, setDev] = useState(false);
  useEffect(() => {
    api.meta().then((m) => setDev(m.devMailbox)).catch(() => undefined);
  }, []);
  return (
    <>
      {dev && (
        <div className="devbar">
          <span>Local development</span>
          <Link to="/dev/mailbox">Mailbox</Link>
          <Link to="/admin">Admin review</Link>
          <span>Owner verification is manual review — the UI is the production flow.</span>
        </div>
      )}
      <header className="topbar">
        <Link to="/" className="brand">
          <strong>Myplace</strong>
          <span>New York record</span>
        </Link>
        <SearchBox compact />
        <nav className="top-links">
          <Link to="/map">Map</Link>
          {user?.is_admin && <Link to="/admin">Admin</Link>}
          {user ? (
            <>
              <Link to="/account">{user.display_name || user.primary_email}</Link>
              <button className="btn secondary" onClick={() => signOut()}>Sign out</button>
            </>
          ) : (
            <Link className="btn" to="/signin">Sign in</Link>
          )}
        </nav>
      </header>
      {children}
    </>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    api.meta().then((m) => setCount(m.propertyCount)).catch(() => undefined);
  }, []);
  return (
    <div className="hero">
      <div className="hero-copy">
        <div className="kicker">Columbia County · demonstration V1</div>
        <h1>Every property, organized in one place.</h1>
        <p className="lede">
          Know what is official, what changed, and add what only you know.
          Unknown is allowed. Conflict is preserved.
        </p>
        <div style={{ margin: "22px 0 18px" }}>
          <SearchBox autoFocus />
        </div>
        <p className="meta-line">
          {count ?? "—"} demonstration parcels · claiming is free · verification is reviewed
        </p>
      </div>
      <div className="hero-map">
        <ParcelMap onSelect={(id) => navigate(`/property/${id}`)} />
      </div>
    </div>
  );
}

function MapPage() {
  const navigate = useNavigate();
  return (
    <div className="hero-map" style={{ minHeight: "calc(100vh - 70px)", margin: 0, border: 0 }}>
      <ParcelMap zoom={11} onSelect={(id) => navigate(`/property/${id}`)} />
    </div>
  );
}

function PropertyPageView() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<{ property: PropertyPage; viewer: Viewer } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.property(id).then(setData).catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page">Loading record…</div>;
  const { property, viewer } = data;
  const facts = (group: string) => property.facts.filter((f) => f.group === group);
  return (
    <div className="page wide">
      <div className="property-layout">
        <div className="dossier">
          <div className="kicker">{property.municipality}, {property.county} County</div>
          <h1>{property.formatted ?? "Untitled parcel"}</h1>
          <p className="meta-line mono">{property.sbl} · SWIS {property.swis}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            {viewer.maintainer ? (
              <a className="btn" href={`/property/${property.property_id}/manage`}>Maintain owner record</a>
            ) : (
              <a className="btn" href={user ? `/property/${property.property_id}/claim` : `/signin?next=/property/${property.property_id}/claim`}>
                Claim this property
              </a>
            )}
          </div>
          <div className="notice" style={{ marginTop: 18 }}>
            Demonstration records for Columbia County. Not an official assessor extract.
            Every important fact shows its source.
          </div>

          <section className="section">
            <h2>Overview</h2>
            {facts("overview").map((fact) => <FactRow key={fact.fieldKey} fact={fact} />)}
          </section>
          <section className="section">
            <h2>Location & services</h2>
            {facts("location").map((fact) => <FactRow key={fact.fieldKey} fact={fact} />)}
          </section>
          <section className="section">
            <h2>Rules & environment</h2>
            {facts("rules").map((fact) => <FactRow key={fact.fieldKey} fact={fact} />)}
          </section>
          <section className="section">
            <h2>Records</h2>
            <div className="coverage">
              {Object.entries(property.coverage).map(([key, value]) => (
                <div key={key}><span>{key.replace("_", " ")}</span> {value}</div>
              ))}
            </div>
          </section>
          <section className="section">
            <h2>Record history</h2>
            <p className="meta-line">{property.historyNote} This is known attributable events, not a complete house history.</p>
            <ol className="timeline">
              {property.events.map((event) => (
                <li key={event.event_id}>
                  <strong>{eventLabel(event.event_type)}</strong>
                  <small>{new Date(event.effective_at ?? event.created_at).toLocaleDateString()}</small>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div>
          <div className="map-panel">
            <ParcelMap
              selectedId={property.property_id}
              selectedGeometry={property.geojson}
              onSelect={(next) => { window.location.href = `/property/${next}`; }}
              zoom={16}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const METHODS = [
  { id: "tax_bill", title: "County tax bill", body: "A recent county or town tax bill showing your name and this parcel." },
  { id: "deed", title: "Recorded deed", body: "The recorded deed or property transfer document for this parcel." },
  { id: "utility_and_id", title: "Utility bill and ID", body: "A utility bill at this address plus a government photo ID." },
];

function ClaimPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState("tax_bill");
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("this property");

  useEffect(() => {
    if (!id) return;
    api.property(id).then((d) => setAddress(d.property.formatted ?? "this property"));
  }, [id]);

  if (!user) return <Navigate to={`/signin?next=/property/${id}/claim`} replace />;

  const submit = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createClaim(id, { method, notes, attestationAccepted: attested });
      for (const file of files) {
        await api.upload(id, file, { claimId: created.claimId, documentType: method, visibility: "private", transferability: "personal" });
      }
      navigate(`/property/${id}/claim/${created.claimId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit claim");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page wizard">
      <div className="kicker">Ownership verification</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460, fontSize: 42 }}>Claim {address}</h1>
      <div className="steps">
        {["Property", "Method", "Evidence", "Attest"].map((label, i) => (
          <span key={label} className={step === i + 1 ? "on" : ""}>{i + 1}. {label}</span>
        ))}
      </div>

      {step === 1 && (
        <>
          <p>You are asking to become the owner maintainer of this record. Official government facts stay public. You will control the owner-maintained layer and documents.</p>
          <button type="button" className="btn" data-testid="claim-confirm" onClick={() => setStep(2)}>This is my property</button>
        </>
      )}
      {step === 2 && (
        <>
          <div className="method-grid">
            {METHODS.map((item) => (
              <button key={item.id} className={`choice ${method === item.id ? "selected" : ""}`} onClick={() => setMethod(item.id)}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn" onClick={() => setStep(3)}>Continue</button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <p>Upload clear copies. These stay private and are used only for review.</p>
          <label className="stack">
            <span>Documents</span>
            <input className="field" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          {files.map((file) => <div key={file.name} className="meta-line">{file.name}</div>)}
          <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => setStep(2)}>Back</button>
            <button className="btn" onClick={() => setStep(4)}>Continue</button>
          </div>
        </>
      )}
      {step === 4 && (
        <>
          <label className="stack">
            <span>Anything the reviewer should know</span>
            <textarea className="field" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>I attest that I am a current owner or authorized representative of {address}, and that the documents I uploaded are genuine.</span>
          </label>
          {error && <p className="error">{error}</p>}
          <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
            <button className="btn secondary" onClick={() => setStep(3)}>Back</button>
            <button type="button" className="btn" data-testid="claim-submit" disabled={!attested || busy} onClick={submit}>
              {busy ? "Submitting…" : "Submit for review"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ClaimStatusPage() {
  const { id, claimId } = useParams();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    api.claim(claimId).then((d) => {
      setClaim(d.claim);
      setDocs(d.documents);
    }).catch((err) => setError(err.message));
  }, [claimId]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!claim) return <div className="page">Loading claim…</div>;

  const status = claim.status;
  return (
    <div className="page wizard">
      <div className="kicker">Claim status</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460, fontSize: 40 }}>{claim.formatted ?? "Property claim"}</h1>
      <p className="meta-line">Reference {claim.claim_id} · {METHODS.find((m) => m.id === claim.method)?.title}</p>
      <div className="status-rail">
        <div className="done">Submitted {claim.submitted_at ? new Date(claim.submitted_at).toLocaleString() : ""}</div>
        <div className={status === "pending" ? "current" : status === "verified" || status === "rejected" ? "done" : ""}>
          Under review
        </div>
        <div className={status === "verified" ? "done" : status === "rejected" ? "current" : ""}>
          {status === "rejected" ? "Not verified" : "Verified owner maintainer"}
        </div>
      </div>
      {status === "pending" && (
        <div className="notice">Most reviews complete within one to two business days. We will email you when a reviewer finishes.</div>
      )}
      {status === "verified" && (
        <p><a className="btn" href={`/property/${id}/manage`}>Open the owner record</a></p>
      )}
      {status === "rejected" && claim.reviewer_note && <p>{claim.reviewer_note}</p>}
      <section className="section">
        <h2>Evidence on file</h2>
        {docs.length === 0 && <p className="meta-line">No documents uploaded.</p>}
        {docs.map((doc) => (
          <div key={doc.document_id}>{doc.original_filename}</div>
        ))}
      </section>
    </div>
  );
}

function ManagePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState("record");
  const [data, setData] = useState<{ property: PropertyPage; viewer: Viewer } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [handoffEmail, setHandoffEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    api.property(id).then((d) => {
      setData(d);
      const next: Record<string, string> = {};
      for (const fact of d.property.facts.filter((f) => f.layer === "owner")) {
        next[fact.fieldKey] = fact.value === null || fact.value === undefined ? "" : String(fact.value);
      }
      setFields(next);
    });
    api.documents(id).then((d) => setDocs(d.documents)).catch(() => setDocs([]));
  };

  useEffect(load, [id]);
  if (!user) return <Navigate to={`/signin?next=/property/${id}/manage`} replace />;
  if (!data) return <div className="page">Loading owner record…</div>;
  if (!data.viewer.maintainer && !data.viewer.admin) {
    return <div className="page">You are not a current maintainer of this property.</div>;
  }

  const ownerFacts = data.property.facts.filter((f) => f.layer === "owner");
  return (
    <div className="page wide">
      <div className="kicker">Owner maintainer</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460 }}>{data.property.formatted}</h1>
      <div className="manage-grid">
        <div className="side-nav">
          {([["record", "Property record"], ["documents", "Documents"], ["history", "Record history"], ["handoff", "Handoff"]] as const).map(([key, label]) => (
            <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div>
          {message && <div className="notice" style={{ marginBottom: 16 }}>{message}</div>}
          {tab === "record" && (
            <>
              <p>These fields live on the owner-maintained layer. They do not replace official assessments or parcel identity.</p>
              {ownerFacts.map((fact) => (
                <label className="stack" key={fact.fieldKey}>
                  <span>{fact.label}</span>
                  <input className="field" value={fields[fact.fieldKey] ?? ""} onChange={(e) => setFields({ ...fields, [fact.fieldKey]: e.target.value })} />
                </label>
              ))}
              <button className="btn" onClick={async () => {
                if (!id) return;
                await api.saveOwnerFields(id, fields);
                setMessage("Owner record updated. The change is now part of the property event history.");
                load();
              }}>Save owner record</button>
            </>
          )}
          {tab === "documents" && (
            <>
              <p>Mark a document as property-transferable if the next owner should inherit it. Mortgage, insurance, and personal notes stay private.</p>
              <input type="file" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !id) return;
                await api.upload(id, file, { documentType: "owner_record", visibility: "private", transferability: "property_transferable" });
                load();
              }} />
              <table>
                <thead><tr><th>File</th><th>Visibility</th><th>Transfer</th></tr></thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.document_id}>
                      <td><a href={`/api/documents/${doc.document_id}/file`} target="_blank" rel="noreferrer">{doc.original_filename}</a></td>
                      <td>
                        <select value={doc.visibility} onChange={(e) => api.patchDocument(doc.document_id, { visibility: e.target.value }).then(load)}>
                          <option value="private">Private</option>
                          <option value="property_transferable">Visible on transfer</option>
                          <option value="public">Public</option>
                        </select>
                      </td>
                      <td>
                        <select value={doc.transferability} onChange={(e) => api.patchDocument(doc.document_id, { transferability: e.target.value }).then(load)}>
                          <option value="personal">Personal</option>
                          <option value="property_transferable">Goes with the property</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {tab === "history" && (
            <ol className="timeline">
              {data.property.events.map((event) => (
                <li key={event.event_id}>
                  <strong>{eventLabel(event.event_type)}</strong>
                  <small>{new Date(event.effective_at ?? event.created_at).toLocaleString()}</small>
                </li>
              ))}
            </ol>
          )}
          {tab === "handoff" && (
            <>
              <p>Invite the buyer to claim this property. After they are verified, your maintainer access ends. Personal documents do not transfer.</p>
              <label className="stack">
                <span>Buyer email</span>
                <input className="field" value={handoffEmail} onChange={(e) => setHandoffEmail(e.target.value)} />
              </label>
              <button className="btn" onClick={async () => {
                if (!id) return;
                await api.handoff(id, handoffEmail);
                setMessage(`Invitation sent to ${handoffEmail}.`);
              }}>Send handoff invitation</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SignInPage() {
  const { refresh, user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get("next") || "/account";

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  return (
    <div className="page wizard">
      <div className="kicker">Sign in</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460, fontSize: 42 }}>Enter your email</h1>
      <p>We’ll send a six-digit code. No password.</p>
      <label className="stack">
        <span>Email</span>
        <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {sent && (
        <label className="stack">
          <span>Code</span>
          <input className="field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      {!sent ? (
        <button className="btn" onClick={async () => {
          try {
            await api.requestCode(email);
            setSent(true);
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not send code");
          }
        }}>Send code</button>
      ) : (
        <button className="btn" onClick={async () => {
          try {
            await api.verify(email, code);
            await refresh();
            navigate(next);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not verify");
          }
        }}>Verify and continue</button>
      )}
    </div>
  );
}

function AccountPage() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<{ property_id: string; formatted: string | null }[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  useEffect(() => {
    if (!user) return;
    api.myProperties().then((d) => setProperties(d.properties));
    api.myClaims().then((d) => setClaims(d.claims));
  }, [user]);
  if (!user) return <Navigate to="/signin" replace />;
  return (
    <div className="page">
      <div className="kicker">Account</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460 }}>{user.display_name || user.primary_email}</h1>
      <section className="section">
        <h2>Properties you maintain</h2>
        {properties.length === 0 && <p className="meta-line">None yet. Claim a property from its public page.</p>}
        {properties.map((p) => (
          <div key={p.property_id}><a href={`/property/${p.property_id}/manage`}>{p.formatted}</a></div>
        ))}
      </section>
      <section className="section">
        <h2>Claims</h2>
        {claims.map((claim) => (
          <div key={claim.claim_id}>
            <a href={`/property/${claim.property_id}/claim/${claim.claim_id}`}>{claim.formatted}</a>
            <span className={`badge ${claim.status}`}>{claim.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function AdminPage() {
  const { user } = useAuth();
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  useEffect(() => {
    api.adminClaims("pending").then((d) => setClaims(d.claims)).catch(() => setClaims([]));
  }, []);
  if (!user) return <Navigate to="/signin?next=/admin" replace />;
  if (!user.is_admin) return <div className="page">Admin only.</div>;
  return (
    <div className="page">
      <div className="kicker">Records desk</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460 }}>Ownership claims</h1>
      <p className="meta-line">V1 verification is a human review of submitted evidence. Automated identity proofing is not enabled.</p>
      <table>
        <thead><tr><th>Property</th><th>Claimant</th><th>Method</th><th></th></tr></thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.claim_id}>
              <td>{claim.formatted}</td>
              <td>{claim.primary_email}</td>
              <td>{claim.method}</td>
              <td><Link to={`/admin/claims/${claim.claim_id}`}>Review</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {claims.length === 0 && <p>No pending claims.</p>}
    </div>
  );
}

function AdminClaimPage() {
  const { claimId } = useParams();
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!claimId || !user?.is_admin) return;
    api.claim(claimId).then((d) => {
      setClaim(d.claim);
      setDocs(d.documents);
    });
  }, [claimId, user]);

  if (!ready) return <div className="page">Loading…</div>;
  if (!user?.is_admin) return <Navigate to="/signin?next=/admin" replace />;
  if (!claim) return <div className="page">Loading…</div>;
  return (
    <div className="page wizard">
      <div className="kicker">Review claim</div>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 460 }}>{claim.formatted}</h1>
      <p>Method: {claim.method} · Status: {claim.status}</p>
      <section className="section">
        <h2>Evidence</h2>
        {docs.map((doc) => (
          <div key={doc.document_id}>
            <a href={`/api/documents/${doc.document_id}/file`} target="_blank" rel="noreferrer">{doc.original_filename}</a>
          </div>
        ))}
      </section>
      <label className="stack">
        <span>Reviewer note</span>
        <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="btn" data-testid="verify-owner" onClick={async () => {
          await api.reviewClaim(claim.claim_id, "verified", note);
          navigate("/admin");
        }}>Verify owner</button>
        <button className="btn danger" onClick={async () => {
          await api.reviewClaim(claim.claim_id, "rejected", note);
          navigate("/admin");
        }}>Reject</button>
      </div>
    </div>
  );
}

function MailboxPage() {
  const [emails, setEmails] = useState<MailSummary[]>([]);
  const [current, setCurrent] = useState<MailMessage | null>(null);
  const load = () => api.mailbox().then((d) => setEmails(d.emails));
  useEffect(() => { load().catch(() => undefined); }, []);
  return (
    <div className="mailbox">
      <div className="mail-list">
        {emails.map((email) => (
          <button
            key={email.email_id}
            className={email.read_at ? "" : "unread"}
            onClick={async () => {
              const data = await api.mailboxEmail(email.email_id);
              setCurrent(data.email);
              load();
            }}
          >
            {email.subject}
            <small>{email.to_email} · {new Date(email.sent_at).toLocaleString()}</small>
          </button>
        ))}
      </div>
      <div className="mail-body">
        {current ? (
          <iframe className="mail-frame" title={current.subject} srcDoc={current.html} />
        ) : (
          <p>Local mailbox. Production will send these through Postmark using the same templates.</p>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/property/:id" element={<PropertyPageView />} />
        <Route path="/property/:id/claim" element={<ClaimPage />} />
        <Route path="/property/:id/claim/:claimId" element={<ClaimStatusPage />} />
        <Route path="/property/:id/manage" element={<ManagePage />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/claims/:claimId" element={<AdminClaimPage />} />
        <Route path="/dev/mailbox" element={<MailboxPage />} />
      </Routes>
    </Layout>
  );
}
