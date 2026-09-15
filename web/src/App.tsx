import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type AdminClaim, type Claim, type Doc, type MailMessage, type MailSummary } from "./api";
import { useAuth } from "./auth";
import { eventLabel, PageSpinner, ParcelMap, SearchBox, ShareButton } from "./components";
import { DebugSheet } from "./debug";
import { HomePage } from "./home";
import { useMeta } from "./meta";
import { PropertyPageView, PropertyPhotosPage } from "./property";
import { NotificationsRedirect, PropertyInboxPage, PropertyManagePage } from "./property-manage";

function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const meta = useMeta();
  const [debugOpen, setDebugOpen] = useState(false);
  const isHome = location.pathname === "/";
  const headerSearch = !isHome && !/^\/(signin|dev|admin)/.test(location.pathname);
  // The share button rides beside the search on the property page itself, in
  // every state. Keyed on the id so the slot re-opens for each page load.
  const propertyId = location.pathname.match(/^\/property\/([^/]+)\/?$/)?.[1] ?? null;
  const share = propertyId ? (
    <div className="header-share" key={propertyId}>
      <ShareButton propertyId={propertyId} />
    </div>
  ) : null;
  const topbarRef = useRef<HTMLElement | null>(null);
  useEffect(() => setDebugOpen(false), [location.pathname]);
  useEffect(() => {
    const node = topbarRef.current;
    if (!node) return;
    const sync = () => {
      // Keep the fraction: rounding either way opens a hairline gap or tucks
      // whatever docks beneath the header under its edge.
      const rect = node.getBoundingClientRect();
      const main = node.querySelector(".topbar-main")?.getBoundingClientRect();
      document.documentElement.style.setProperty("--topbar-height", `${rect.height}px`);
      // Bottom of the brand row; on narrow screens the search row sits below it.
      document.documentElement.style.setProperty("--topbar-main-height", `${main ? main.bottom - rect.top : rect.height}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [headerSearch, user, meta?.debug]);
  return (
    <>
      <div className="chrome-glass" aria-hidden="true" />
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-main">
          <Link to="/" className="brand">
            <i className="mark" aria-hidden="true" />
            <strong>Myplace</strong>
          </Link>
          {headerSearch && (
            <div className="header-search wide-only">
              <SearchBox compact />
              {share}
            </div>
          )}
          {isHome && (
            // Hidden until the landing page's hero search scrolls under the header.
            <div className="header-search wide-only home-handoff">
              <SearchBox compact />
            </div>
          )}
          <nav className="top-links">
            <Link to="/map">Map</Link>
            {user?.is_admin && <Link to="/admin" className="wide-only">Admin</Link>}
            {meta?.debug && (
              <button type="button" className="text-btn debug-link" data-testid="debug-link" onClick={() => setDebugOpen(true)}>Debug</button>
            )}
            {user ? (
              <>
                <Link to="/account">{user.display_name ? user.display_name.split(" ")[0] : "Account"}</Link>
                <button className="text-btn wide-only" onClick={() => signOut()}>Sign out</button>
              </>
            ) : (
              <Link to="/signin">Sign in</Link>
            )}
          </nav>
        </div>
        {headerSearch && (
          <div className="header-search narrow-only">
            <SearchBox />
            {share}
          </div>
        )}
      </header>
      {children}
      {meta?.debug && debugOpen && <DebugSheet onClose={() => setDebugOpen(false)} />}
    </>
  );
}

function MapPage() {
  const navigate = useNavigate();
  return (
    <div className="map-page">
      <ParcelMap legend zoom={11.6} onSelect={(id) => navigate(`/property/${id}`)} />
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
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.property(id).then((d) => {
      setAddress(d.property.formatted ?? "this property");
      const alreadyOwned = d.property.maintainers.length > 0;
      const invited = d.viewer.invitation?.role === "owner";
      if (alreadyOwned && !invited && !d.viewer.maintainer) {
        setBlocked("This property already has a verified owner. A transfer starts when they invite you from the handoff section.");
      }
    });
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
      <div className="kicker">Claim</div>
      <h1 className="display">Claim this property</h1>
      <p className="meta-line">{address}</p>
      {!blocked && (
        <div className="steps">
          {["Property", "Method", "Evidence", "Attest"].map((label, i) => (
            <span key={label} className={step === i + 1 ? "on" : ""}>{i + 1}. {label}</span>
          ))}
        </div>
      )}

      {blocked && (
        <>
          <p>{blocked}</p>
          <p><Link className="btn secondary" to={`/property/${id}`}>Back to the property</Link></p>
        </>
      )}

      {!blocked && step === 1 && (
        <>
          <p>You are asking to become the owner maintainer of this record. Official government facts stay public. You will control the owner-maintained layer and documents.</p>
          <button type="button" className="btn" data-testid="claim-confirm" onClick={() => setStep(2)}>This is my property</button>
        </>
      )}
      {!blocked && step === 2 && (
        <>
          <div className="method-grid">
            {METHODS.map((item) => (
              <button key={item.id} className={`choice ${method === item.id ? "selected" : ""}`} onClick={() => setMethod(item.id)}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </button>
            ))}
          </div>
          <div className="action-row">
            <button className="btn secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn" onClick={() => setStep(3)}>Continue</button>
          </div>
        </>
      )}
      {!blocked && step === 3 && (
        <>
          <p>Upload clear copies. These stay private and are used only for review.</p>
          <label className="stack">
            <span>Documents</span>
            <input className="field" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          {files.map((file) => <div key={file.name} className="meta-line">{file.name}</div>)}
          <div className="action-row">
            <button className="btn secondary" onClick={() => setStep(2)}>Back</button>
            <button className="btn" onClick={() => setStep(4)}>Continue</button>
          </div>
        </>
      )}
      {!blocked && step === 4 && (
        <>
          <label className="stack">
            <span>Anything the reviewer should know</span>
            <textarea className="field" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="attest">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            <span>I attest that I am a current owner or authorized representative of {address}, and that the documents I uploaded are genuine.</span>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="action-row">
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
  if (!claim) return <PageSpinner label="Loading claim" />;

  const status = claim.status;
  return (
    <div className="page wizard">
      <div className="kicker">Claim status</div>
      <h1 className="display">{claim.formatted ?? "Property claim"}</h1>
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
        <p><Link className="btn" to={`/property/${id}`}>Open the owner record</Link></p>
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
      <div className="kicker">Welcome</div>
      <h1 className="display">Sign in</h1>
      <p className="meta-line">A six-digit code. No password.</p>
      <label className="stack">
        <span>Email</span>
        <input
          className="field"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {sent && (
        <label className="stack">
          <span>Code</span>
          <input
            className="field otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
          />
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
  const { user, signOut } = useAuth();
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
      <h1 className="display">{user.display_name || user.primary_email}</h1>
      <p className="meta-line">{user.primary_email}</p>
      <div className="action-row narrow-only">
        <button className="btn secondary" onClick={() => signOut()}>Sign out</button>
      </div>
      <section className="section">
        <h2>Properties</h2>
        <div className="group">
          {properties.length === 0 && <div className="row"><span className="meta-line">None yet</span></div>}
          {properties.map((p) => (
            <Link className="row" key={p.property_id} to={`/property/${p.property_id}/manage`} data-testid="owned-property">{p.formatted}</Link>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Claims</h2>
        <div className="group">
          {claims.map((claim) => (
            <a className="row" key={claim.claim_id} href={`/property/${claim.property_id}/claim/${claim.claim_id}`}>
              <span>{claim.formatted}</span>
              <span className={`badge ${claim.status}`}>{claim.status}</span>
            </a>
          ))}
        </div>
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
      <h1 className="display">Ownership claims</h1>
      <p className="meta-line">V1 verification is a human review of submitted evidence. Automated identity proofing is not enabled.</p>
      <div className="table-scroll">
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
      </div>
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

  if (!ready) return <PageSpinner />;
  if (!user?.is_admin) return <Navigate to="/signin?next=/admin" replace />;
  if (!claim) return <PageSpinner label="Loading claim" />;
  return (
    <div className="page wizard">
      <div className="kicker">Review claim</div>
      <h1 className="display">{claim.formatted}</h1>
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
      <div className="action-row">
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
    <div className={`mailbox ${current ? "has-mail" : ""}`}>
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
        {current && (
          <button type="button" className="mail-back narrow-only" onClick={() => setCurrent(null)}>Inbox</button>
        )}
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
        <Route path="/property/:id/photos" element={<PropertyPhotosPage />} />
        <Route path="/property/:id/claim" element={<ClaimPage />} />
        <Route path="/property/:id/claim/:claimId" element={<ClaimStatusPage />} />
        <Route path="/property/:id/manage" element={<PropertyManagePage />} />
        <Route path="/property/:id/manage/inbox" element={<PropertyInboxPage />} />
        <Route path="/property/:id/manage/notifications" element={<NotificationsRedirect />} />
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/claims/:claimId" element={<AdminClaimPage />} />
        <Route path="/dev/mailbox" element={<MailboxPage />} />
      </Routes>
    </Layout>
  );
}
