import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ProfileCard } from "./account-profile";
import { api, type AdminClaim, type Claim, type Doc, type MailMessage, type MailSummary, type MaintainedProperty, type NeighborPerson } from "./api";
import { useAuth } from "./auth";
import { eventLabel, NeighborButton, NeighborHouseIcon, PageSpinner, ParcelMap, SearchBox, ShareButton } from "./components";
import { DebugSheet } from "./debug";
import { HomePage } from "./home";
import { useMeta } from "./meta";
import { PropertyNeighborsPage, PropertyPageView, PropertyPhotosPage } from "./property";
import { NotificationsRedirect, PropertyInboxPage, PropertyManagePage } from "./property-manage";

function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const meta = useMeta();
  const [debugOpen, setDebugOpen] = useState(false);
  const isHome = location.pathname === "/";
  const onAuth = /^\/(signin|signup)/.test(location.pathname);
  const searchOnThisPage = !isHome && !onAuth && !/^\/(dev|admin)/.test(location.pathname);
  // Keep the search row in the layout on auth if the page you left had one,
  // so the bar does not shrink. Hidden visually, still occupies its height.
  const searchOnArrival = useRef(false);
  if (!onAuth) searchOnArrival.current = searchOnThisPage;
  const headerSearch = onAuth ? searchOnArrival.current : searchOnThisPage;
  // Share and neighbor ride beside the search on the property page itself, in
  // every state. Keyed on the id so both slots re-open on page load, not after
  // the record arrives. The empty slot after them is where the property page
  // mounts its quick-add button once the owner's add buttons scroll away.
  const propertyId = location.pathname.match(/^\/property\/([^/]+)\/?$/)?.[1] ?? null;
  const share = propertyId ? (
    <>
      <div className="header-share" key={`share-${propertyId}`}>
        <ShareButton propertyId={propertyId} />
      </div>
      <NeighborButton key={`neighbor-${propertyId}`} propertyId={propertyId} />
      <div className="header-add-slot" />
    </>
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
    // iOS: pull-to-refresh, bfcache, and backing out of the email keyboard
    // all leave sticky chrome and --topbar-height stale unless we remasure.
    window.addEventListener("pageshow", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("pageshow", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
    };
  }, [headerSearch, user, meta?.debug, onAuth]);
  return (
    <>
      <div className="chrome-glass" aria-hidden="true" />
      <header className={`topbar${onAuth ? " is-auth" : ""}`} ref={topbarRef}>
        <div className="topbar-main">
          <Link to="/" className="brand">
            <i className="mark" aria-hidden="true" />
            <strong>Myplace</strong>
          </Link>
          {headerSearch && (
            <div className="header-search wide-only">
              <SearchBox compact />
            </div>
          )}
          {(isHome || onAuth) && !headerSearch && (
            // Same reserved search slot the landing page keeps in the bar.
            // Auth uses it so the row does not shrink when you leave home.
            <div className="header-search wide-only home-handoff" aria-hidden="true">
              <SearchBox compact />
            </div>
          )}
          <div className="topbar-end">
            <nav className="top-links">
              <Link to="/map">Map</Link>
              {user?.is_admin && <Link to="/admin" className="wide-only">Admin</Link>}
              {meta?.debug && (
                <button type="button" className="text-btn debug-link" data-testid="debug-link" onClick={() => setDebugOpen(true)}>Debug</button>
              )}
              {user ? (
                <>
                  <Link to="/account">{user.first_name || user.display_name?.split(" ")[0] || "Account"}</Link>
                  <button className="text-btn wide-only" onClick={() => signOut()}>Sign out</button>
                </>
              ) : (
                <Link to="/signup">Sign up</Link>
              )}
            </nav>
            {/* Desktop: share and quick add sit at the right edge, after the links. */}
            {share && <div className="header-actions wide-only">{share}</div>}
          </div>
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

/**
 * One email-code flow, two doors. Sign up says what the account is for and
 * frames the same steps as creating one; sign in stays brief. Each links to
 * the other and carries the return path along.
 */
function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { refresh, user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState(params.get("first") ?? "");
  const [lastName, setLastName] = useState(params.get("last") ?? "");
  const [handle, setHandle] = useState((params.get("handle") ?? "").replace(/^@+/, ""));
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get("next") || "/account";
  const signup = mode === "signup";
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);
  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);

  const otherHref = (path: string) => {
    const query = new URLSearchParams();
    if (params.get("next")) query.set("next", params.get("next")!);
    if (email) query.set("email", email);
    const search = query.toString();
    return search ? `${path}?${search}` : path;
  };

  const readyToSend = Boolean(email.trim() && (!signup || (firstName.trim() && handle.trim())));
  const sendCode = async () => {
    if (!readyToSend || busy) return;
    setBusy(true);
    try {
      await api.requestCode(email.trim());
      setSent(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (code.length < 6 || busy) return;
    if (signup && !firstName.trim()) {
      setError("Enter your first name.");
      return;
    }
    if (signup && !handle.trim()) {
      setError("Choose a handle.");
      return;
    }
    setBusy(true);
    try {
      await api.verify(email.trim(), code, signup ? { firstName: firstName.trim(), lastName: lastName.trim(), handle: handle.trim() } : undefined);
      await refresh();
      navigate(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page wizard auth-page" data-testid={signup ? "signup-page" : "signin-page"}>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void (sent ? verify() : sendCode()); }}>
        <div className="auth-body">
          <div className="kicker">{signup ? "Free account" : "Welcome back"}</div>
          <h1 className="display">{signup ? "Create your account" : "Sign in"}</h1>
          <p className="meta-line auth-lede">We'll send you a six-digit code to your email.</p>
          <p className="auth-switch">
            {signup ? (
              <>Already have an account? <Link to={otherHref("/signin")}>Sign in</Link></>
            ) : (
              <>Don't have an account? <Link to={otherHref("/signup")}>Sign up</Link></>
            )}
          </p>

          {signup && !sent && (
            <ul className="auth-perks">
              <li>
                <HouseIcon />
                <span>See what owners have added to claimed homes: paint, rooms, improvements.</span>
              </li>
              <li>
                <PinIcon />
                <span>Claim your own address and keep its record.</span>
              </li>
              <li>
                <EyeIcon />
                <span>Choose what stays private and what the neighborhood sees.</span>
              </li>
              <li>
                <VaultIcon />
                <span>Keep receipts, permits, and paperwork in a private vault.</span>
              </li>
            </ul>
          )}

          {!sent ? (
            <>
              {signup && (
                <div className="auth-names">
                  <label className="stack">
                    <span>First name</span>
                    <input
                      className="field"
                      type="text"
                      autoComplete="given-name"
                      autoCapitalize="words"
                      autoCorrect="off"
                      autoFocus
                      required
                      maxLength={80}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
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
              )}
              {signup && (
                <label className="stack">
                  <span>Handle</span>
                  <input
                    className="field"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    maxLength={24}
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 24))}
                    placeholder="@yourname"
                  />
                </label>
              )}
              <label className="stack">
                <span>Email</span>
                <input
                  className="field"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus={!signup}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <div className="auth-sent">
                <span>Code sent to <strong>{email.trim()}</strong></span>
                <button type="button" className="text-link" onClick={() => { setSent(false); setCode(""); setError(null); }}>Change</button>
              </div>
              <label className="stack">
                <span>Six-digit code</span>
                <input
                  ref={codeRef}
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
            </>
          )}
          {error && <p className="error">{error}</p>}
          {sent && (
            <button type="button" className="text-btn auth-resend" disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
          )}
        </div>
        <div className="manage-cta">
          <button type="submit" className="btn" disabled={busy || (sent ? code.length < 6 : !readyToSend)}>
            {sent
              ? (signup ? "Create account" : "Verify and continue")
              : "Continue with email"}
          </button>
        </div>
      </form>
    </div>
  );
}

function HouseIcon() {
  return (
    <svg className="auth-perk-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11.2 12 4l8 7.2" />
      <path d="M6.5 10.2V20h11V10.2" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="auth-perk-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" />
      <circle cx="12" cy="10.6" r="2.1" />
    </svg>
  );
}

function VaultIcon() {
  return (
    <svg className="auth-perk-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="15" rx="2.4" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 10.6v1.4l1 .8" />
      <path d="M7 19.5v1.5M17 19.5v1.5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="auth-perk-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6Z" />
      <circle cx="12" cy="12" r="2.3" />
    </svg>
  );
}

function NeighborAvatar({ photoUrl }: { photoUrl: string | null }) {
  return photoUrl ? (
    <img className="neighbor-avatar" src={photoUrl} alt="" />
  ) : (
    <span className="neighbor-avatar" aria-hidden="true">
      <NeighborHouseIcon className="neighbor-avatar-icon" />
    </span>
  );
}

function AccountPage() {
  const { user, signOut, refresh } = useAuth();
  const [properties, setProperties] = useState<MaintainedProperty[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [incoming, setIncoming] = useState<NeighborPerson[]>([]);
  const [outgoing, setOutgoing] = useState<NeighborPerson[]>([]);
  const [neighbors, setNeighbors] = useState<NeighborPerson[]>([]);
  const [neighborBusy, setNeighborBusy] = useState<string | null>(null);
  const loadNeighbors = () => api.myNeighbors().then((d) => {
    setIncoming(d.incoming);
    setOutgoing(d.outgoing);
    setNeighbors(d.neighbors);
  });
  useEffect(() => {
    if (!user) return;
    api.myProperties().then((d) => setProperties(d.properties));
    api.myClaims().then((d) => setClaims(d.claims));
    loadNeighbors();
  }, [user]);
  const decideNeighbor = async (requestId: string, decision: "accepted" | "declined") => {
    setNeighborBusy(`${requestId}:${decision}`);
    try {
      await api.reviewNeighbor(requestId, decision);
      await loadNeighbors();
    } finally {
      setNeighborBusy(null);
    }
  };
  if (!user) return <Navigate to="/signin" replace />;
  const ownedIds = new Set(properties.map((property) => property.property_id));
  const openClaims = claims.filter((claim) => (
    !ownedIds.has(claim.property_id) && claim.status !== "superseded" && claim.status !== "revoked"
  ));
  return (
    <div className="page account-page">
      <ProfileCard user={user} onUser={refresh} />
      <section className="section">
        <h2>Properties</h2>
        <div className="group">
          {properties.length === 0 && openClaims.length === 0 && (
            <div className="row"><span className="meta-line">None yet</span></div>
          )}
          {properties.map((property) => (
            <Link className="row" key={property.property_id} to={`/property/${property.property_id}`} data-testid="owned-property">
              <span className="row-label">{property.formatted}</span>
              {property.maintainers.length > 0 && (
                <span className="row-avatars">
                  {property.maintainers.map((person) => (
                    <img key={person.user_id} src={person.photo_url} alt={person.label} />
                  ))}
                </span>
              )}
            </Link>
          ))}
          {openClaims.map((claim) => (
            <Link className="row" key={claim.claim_id} to={`/property/${claim.property_id}/claim/${claim.claim_id}`}>
              <span>{claim.formatted}</span>
              <span className={`badge ${claim.status}`}>{claim.status}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="section">
        <h2>Neighbors</h2>
        <div className="group">
          {incoming.length === 0 && outgoing.length === 0 && neighbors.length === 0 && (
            <div className="row"><span className="meta-line">None yet</span></div>
          )}
          {incoming.map((person) => (
            <div className="row neighbor-row" key={person.request_id} data-testid="neighbor-incoming">
              <NeighborAvatar photoUrl={person.photo_url} />
              <div className="neighbor-copy">
                <span className="row-label">{person.label}</span>
                <span className="meta-line">Wants to be neighbors</span>
              </div>
              <div className="inbox-actions">
                <button
                  type="button"
                  className="btn small"
                  disabled={neighborBusy !== null}
                  data-testid="neighbor-approve"
                  onClick={() => void decideNeighbor(person.request_id, "accepted")}
                >
                  {neighborBusy === `${person.request_id}:accepted` ? "Saving…" : "Approve"}
                </button>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={neighborBusy !== null}
                  data-testid="neighbor-decline"
                  onClick={() => void decideNeighbor(person.request_id, "declined")}
                >
                  {neighborBusy === `${person.request_id}:declined` ? "Saving…" : "Decline"}
                </button>
              </div>
            </div>
          ))}
          {outgoing.map((person) => (
            <div className="row neighbor-row" key={person.request_id} data-testid="neighbor-outgoing">
              <NeighborAvatar photoUrl={person.photo_url} />
              {person.property_id ? (
                <Link className="row-label" to={`/property/${person.property_id}`}>{person.label}</Link>
              ) : (
                <span className="row-label">{person.label}</span>
              )}
              <span className={`badge ${person.status}`}>{person.status}</span>
            </div>
          ))}
          {neighbors.map((person) => (
            person.property_id ? (
              <Link className="row neighbor-row" key={person.request_id} to={`/property/${person.property_id}`} data-testid="neighbor-row">
                <NeighborAvatar photoUrl={person.photo_url} />
                <span className="row-label">{person.label}</span>
              </Link>
            ) : (
              <div className="row neighbor-row" key={person.request_id} data-testid="neighbor-row">
                <NeighborAvatar photoUrl={person.photo_url} />
                <span className="row-label">{person.label}</span>
              </div>
            )
          ))}
        </div>
      </section>
      <div className="action-row account-signout">
        <button className="btn secondary" onClick={() => signOut()} data-testid="account-signout">Sign out</button>
      </div>
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
        <Route path="/property/:id/neighbors" element={<PropertyNeighborsPage />} />
        <Route path="/property/:id/claim" element={<ClaimPage />} />
        <Route path="/property/:id/claim/:claimId" element={<ClaimStatusPage />} />
        <Route path="/property/:id/manage" element={<PropertyManagePage />} />
        <Route path="/property/:id/manage/inbox" element={<PropertyInboxPage />} />
        <Route path="/property/:id/manage/notifications" element={<NotificationsRedirect />} />
        <Route path="/signin" element={<AuthPage mode="signin" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/claims/:claimId" element={<AdminClaimPage />} />
        <Route path="/dev/mailbox" element={<MailboxPage />} />
      </Routes>
    </Layout>
  );
}
