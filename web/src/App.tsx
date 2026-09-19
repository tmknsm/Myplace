import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router-dom";
import { ClaimCodeCard, NotificationsFeed, pendingHouse, ProfileCard, PropertyPicker, type PickerHouse } from "./account-profile";
import { api, type AdminClaim, type Claim, type MailMessage, type MailSummary, type MapHome } from "./api";
import { useAuth } from "./auth";
import { HeroStep, IdentityStep, PostcardStep } from "./claim-onboarding";
import { eventLabel, NeighborButton, PageSpinner, ParcelMap, SearchBox, SettingsButton, ShareButton, type MapView } from "./components";
import { DebugSheet } from "./debug";
import { FeedPage } from "./feed";
import { HomePage } from "./home";
import { type HomesDetent } from "./map-homes-detents";
import { MapHomesSheet } from "./map-homes-sheet";
import { useMeta } from "./meta";
import { loadMyClaims, loadMyProperties, pendingClaims, unseenTotal, useMyClaims, useMyProperties } from "./my-properties";
import { PropertyNeighborsPage, PropertyPageView, PropertyPhotosPage, PropertyPostsPage } from "./property";
import { NotificationsRedirect, PropertyInboxPage, PropertyManagePage } from "./property-manage";
import { shortAddress, useToast } from "./property-shared";

function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const meta = useMeta();
  const [debugOpen, setDebugOpen] = useState(false);
  // Signed in, "/" is the feed and behaves like any other page in the app.
  // Signed out it is the landing page, which hands its own search to the bar.
  const isLanding = location.pathname === "/" && !user;
  const onAuth = /^\/(signin|signup)/.test(location.pathname);
  // Claiming is a focused flow (identity, photo, proof, review): no search bar.
  const onboarding = /^\/property\/[^/]+\/claim(\/|$)/.test(location.pathname);
  const headerSearch = !isLanding && !onAuth && !onboarding && !/^\/(dev|admin)/.test(location.pathname);
  // Notifications waiting on any house light a count on the name. Re-checked
  // as you move around the app, not more than every half minute.
  const { homes } = useMyProperties(location.pathname);
  const { claims } = useMyClaims(location.pathname);
  const unseen = unseenTotal(homes, claims);
  // A new page opens from the top. Back and forward keep the browser's own
  // restored position; a query-only change (feed tabs) is the same page.
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);
  // Share, then settings (your houses) or neighbor (everyone else's), ride
  // beside the search on the property page itself. Keyed on the id so the
  // slots re-open on page load, not after the record arrives. The empty slot
  // after them is where the property page mounts its quick-add button once
  // the owner's add buttons scroll away.
  const propertyId = location.pathname.match(/^\/property\/([^/]+)\/?$/)?.[1] ?? null;
  const share = propertyId ? (
    <>
      <div className="header-share" key={`share-${propertyId}`}>
        <ShareButton propertyId={propertyId} />
      </div>
      <SettingsButton key={`settings-${propertyId}`} propertyId={propertyId} />
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
          {(isLanding || onAuth) && !headerSearch && (
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
                  <Link to="/account" className="account-link" aria-label={unseen ? `Account, ${unseen} new notification${unseen === 1 ? "" : "s"}` : undefined}>
                    {user.first_name || user.display_name?.split(" ")[0] || "Account"}
                    {unseen > 0 && <span className="nav-badge" data-testid="nav-unseen">{unseen > 9 ? "9+" : unseen}</span>}
                  </Link>
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

/** Signed in, the front door is the neighbors' feed; signed out, the landing page. */
function RootPage() {
  const { user, ready } = useAuth();
  if (!ready) return <PageSpinner />;
  return user ? <FeedPage /> : <HomePage />;
}

/** Debounced count and cards for whatever the map is showing; stale replies are dropped. */
function useHomesInView(view: MapView | null) {
  const [state, setState] = useState<{ count: number | null; homes: MapHome[]; pending: boolean }>({
    count: null,
    homes: [],
    pending: true,
  });
  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    const controller = new AbortController();
    setState((current) => ({ ...current, pending: true }));
    const timer = window.setTimeout(() => {
      api.mapHomes(view.bbox, { signal: controller.signal }).then((data) => {
        if (!cancelled) setState({ count: data.count, homes: data.homes, pending: false });
      }).catch(() => {
        if (!cancelled) setState((current) => ({ ...current, pending: false }));
      });
    }, 160);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [view]);
  return state;
}

function MapPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<MapView | null>(null);
  const [detent, setDetent] = useState<HomesDetent>("peek");
  const [inset, setInset] = useState(0);
  const homes = useHomesInView(view);
  return (
    <div className="map-page has-homes-sheet" style={{ "--map-sheet-inset": `${inset}px` } as CSSProperties}>
      <ParcelMap
        legend
        zoom={11.6}
        onSelect={(id) => navigate(`/property/${id}`)}
        viewInset={inset}
        onViewChange={setView}
      />
      <MapHomesSheet
        count={homes.count}
        homes={homes.homes}
        pending={homes.pending}
        detent={detent}
        onDetent={setDetent}
        onInset={setInset}
      />
    </div>
  );
}

/**
 * Claiming is the front door of the account, so it doubles as onboarding:
 * how you appear, a photo of the house, then the postcard that carries the
 * code. A draft claim opens as soon as you arrive so the first two steps have
 * somewhere to live; mailing the card turns that same draft in and lands on
 * the account, where the house waits, pending, for the code.
 */
function ClaimPage() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"identity" | "photo" | "verify">("identity");
  const [claim, setClaim] = useState<Claim | null>(null);
  // Every step is the same route, so the router never resets scroll between
  // them. Each one opens from the top, before its entrance paints.
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [phase]);
  const [place, setPlace] = useState<{ formatted: string | null; municipality: string | null; county: string } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const userId = user?.user_id ?? null;
  useEffect(() => {
    if (!id || !userId) return;
    let cancelled = false;
    void Promise.all([api.property(id), api.startClaim(id)]).then(([d, started]) => {
      if (cancelled) return;
      setPlace({ formatted: d.property.formatted, municipality: d.property.municipality, county: d.property.county });
      if (started.claim.status === "pending") {
        // The card is already in the mail; the code goes in on the account.
        navigate(`/account?house=${id}`, { replace: true });
        return;
      }
      setClaim(started.claim);
    }).catch((err) => {
      if (cancelled) return;
      setBlocked(err instanceof Error ? err.message : "Could not start a claim.");
    });
    return () => { cancelled = true; };
  }, [id, userId, navigate]);

  if (!user) return <Navigate to={`/signup?next=/property/${id}/claim`} replace />;

  const address = place?.formatted ?? "this property";

  const submit = async () => {
    if (!id) return;
    await api.createClaim(id, { attestationAccepted: true });
    await Promise.all([loadMyClaims(true), loadMyProperties(true)]).catch(() => {});
    navigate(`/account?house=${id}`, { replace: true });
  };

  if (blocked) {
    return (
      <div className="page wizard">
        <div className="kicker">Claim</div>
        <h1 className="display">Claim this property</h1>
        <p className="meta-line">{address}</p>
        <p>{blocked}</p>
        <p><Link className="btn secondary" to={`/property/${id}`}>Back to the property</Link></p>
      </div>
    );
  }
  if (!claim || !place) return <PageSpinner label="Starting your claim" />;

  if (phase === "identity") {
    return (
      <div className="page wizard auth-page onboard-page" data-testid="onboard-identity">
        <IdentityStep
          key={claim.claim_id}
          user={user}
          claim={claim}
          property={place}
          onUser={refresh}
          onDone={(saved) => { setClaim(saved); setPhase("photo"); }}
        />
      </div>
    );
  }
  if (phase === "photo") {
    return (
      <div className="page wizard auth-page onboard-page" data-testid="onboard-photo">
        <HeroStep
          key={claim.claim_id}
          claim={claim}
          onBack={() => setPhase("identity")}
          onDone={(saved) => { setClaim(saved); setPhase("verify"); }}
        />
      </div>
    );
  }

  return (
    <div className="page wizard auth-page onboard-page" data-testid="onboard-verify">
      <PostcardStep
        key={claim.claim_id}
        address={address}
        onBack={() => setPhase("photo")}
        onDone={submit}
      />
    </div>
  );
}

/**
 * Where a finished claim ended up. A claim still waiting on its code lives on
 * the account page instead, so that is where a pending one sends you.
 */
function ClaimStatusPage() {
  const { id, claimId } = useParams();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    api.claim(claimId).then((d) => setClaim(d.claim)).catch((err) => setError(err.message));
  }, [claimId]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!claim) return <PageSpinner label="Loading claim" />;
  if (claim.status === "pending" || claim.status === "draft") return <Navigate to={`/account?house=${claim.property_id}`} replace />;

  const status = claim.status;
  return (
    <div className="page wizard">
      <div className="kicker">Claim</div>
      <h1 className="display">{claim.formatted ?? "Property claim"}</h1>
      <p className="meta-line">Reference {claim.claim_id}</p>
      <div className="status-rail">
        <div className="done">Submitted {claim.submitted_at ? new Date(claim.submitted_at).toLocaleString() : ""}</div>
        <div className="done">Code mailed to the house</div>
        <div className={status === "verified" ? "done" : "current"}>
          {status === "verified" ? "Verified owner" : status === "rejected" ? "Not verified" : "Closed"}
        </div>
      </div>
      {status === "verified" && (
        <p><Link className="btn" to={`/property/${id}`}>Open the owner record</Link></p>
      )}
      {status === "rejected" && (
        <>
          {claim.reviewer_note && <p>{claim.reviewer_note}</p>}
          <p><Link className="btn" to={`/property/${id}/claim`}>Start again</Link></p>
        </>
      )}
      {status === "superseded" && <p>Someone else verified this property first.</p>}
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
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get("next") || "/account";
  const signup = mode === "signup";
  // Arriving from a Claim button: the account is the first step of claiming,
  // so say so, and let the claim page carry on with identity and photo.
  const claiming = /^\/property\/[^/]+\/claim\/?$/.test(next);
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

  const readyToSend = Boolean(email.trim());
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
    setBusy(true);
    try {
      await api.verify(email.trim(), code);
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
          <div className="kicker">{signup ? (claiming ? "Claim your home" : "Free account") : "Welcome back"}</div>
          <h1 className="display">{signup ? (claiming ? "Start with your email" : "Create your account") : "Sign in"}</h1>
          <p className="meta-line auth-lede">
            {claiming && signup
              ? "We'll send a six-digit code. Then you'll choose how you appear and add a photo of your home."
              : "We'll send you a six-digit code to your email."}
          </p>
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
            <label className="stack">
              <span>Email</span>
              <input
                className="field"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
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
              ? (signup ? (claiming ? "Continue" : "Create account") : "Verify and continue")
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

function AccountPage() {
  const { user, signOut, refresh } = useAuth();
  const { homes: properties, reload } = useMyProperties();
  const { claims, reload: reloadClaims } = useMyClaims();
  // Arriving from the claim flow (or the email) lands on that house.
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(params.get("house"));
  const [toast, showToast] = useToast();
  useEffect(() => {
    if (!user) return;
    // The house list arrives fresh on every visit: the feed and badges depend on it.
    void reload().catch(() => {});
    void reloadClaims().catch(() => {});
  }, [user?.user_id, reload, reloadClaims]);
  if (!user) return <Navigate to="/signin" replace />;
  const homes = properties ?? [];
  const ownedIds = new Set(homes.map((property) => property.property_id));
  // Verified claims are houses we already show as chips. They stay in /api/me/claims,
  // so without this they flash as rows on refresh, before the house list arrives
  // and ownedIds can hide them. Wait for that list too — an empty ownedIds is
  // "still loading", not "owns nothing".
  const loaded = properties !== undefined && claims !== undefined;
  const waiting = loaded ? pendingClaims(claims).filter((claim) => !ownedIds.has(claim.property_id)) : [];
  // Houses first, then the ones whose postcard is in the mail, at the end of the row.
  const houses: PickerHouse[] = [...homes, ...waiting.map(pendingHouse)];
  // The first house is selected until they pick another; a stale pick falls back.
  const selected = houses.find((house) => house.property_id === selectedId) ?? houses[0] ?? null;
  const rejected = loaded ? (claims ?? []).filter((claim) => claim.status === "rejected" && !ownedIds.has(claim.property_id)) : [];
  return (
    <div className={`page account-page${selected ? " has-go" : ""}`}>
      <div className="account-body">
        <ProfileCard user={user} onUser={refresh} showToast={showToast} />
        <section className="section" data-testid="properties-section">
          <h2>Properties</h2>
          <PropertyPicker properties={houses} selectedId={selected?.property_id ?? null} onSelect={setSelectedId} />
          {loaded && houses.length === 0 && rejected.length === 0 && (
            <div className="group"><div className="row"><span className="meta-line">None yet</span></div></div>
          )}
          {selected?.claim_id && (
            <ClaimCodeCard
              key={selected.claim_id}
              house={selected}
              onVerified={setSelectedId}
              showToast={showToast}
            />
          )}
          {rejected.length > 0 && (
            <div className="group property-claims">
              {rejected.map((claim) => (
                <Link className="row" key={claim.claim_id} to={`/property/${claim.property_id}/claim/${claim.claim_id}`}>
                  <span>{claim.formatted}</span>
                  <span className={`badge ${claim.status}`}>{claim.status}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        {loaded && <NotificationsFeed property={selected} showToast={showToast} />}
        <div className="action-row account-signout">
          <button className="btn secondary" onClick={() => signOut()} data-testid="account-signout">Sign out</button>
        </div>
      </div>
      {selected && (
        <div className="manage-cta">
          {selected.removed ? (
            // Off Myplace: the page is gone, but its settings (and the way back) are not.
            <Link
              className="btn"
              to={`/property/${selected.property_id}/manage`}
              data-testid="go-to-property"
              aria-label={`${shortAddress(selected)} is off Myplace. Open its settings`}
            >
              Property settings
            </Link>
          ) : (
            <Link
              className="btn"
              to={`/property/${selected.property_id}`}
              data-testid="go-to-property"
              aria-label={`Go to ${shortAddress(selected)}`}
            >
              Go to property
            </Link>
          )}
        </div>
      )}
      {toast && (
        <div className="page-toast" role="status" data-testid="account-toast">{toast}</div>
      )}
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
      <p className="meta-line">Each claim mails a six-digit code to the house. The code is shown here so the desk can help a caller, or verify by hand.</p>
      <div className="table-scroll">
      <table>
        <thead><tr><th>Property</th><th>Claimant</th><th>Code</th><th>Tries</th><th></th></tr></thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.claim_id}>
              <td>{claim.formatted}</td>
              <td>{claim.primary_email}</td>
              <td><code data-testid="admin-postcard-code">{claim.postcard_code ?? "—"}</code></td>
              <td>{claim.code_attempts ?? 0}</td>
              <td><Link to={`/admin/claims/${claim.claim_id}`}>Open</Link></td>
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
  const [claim, setClaim] = useState<AdminClaim | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!claimId || !user?.is_admin) return;
    api.claim(claimId).then((d) => setClaim(d.claim as AdminClaim));
  }, [claimId, user]);

  if (!ready) return <PageSpinner />;
  if (!user?.is_admin) return <Navigate to="/signin?next=/admin" replace />;
  if (!claim) return <PageSpinner label="Loading claim" />;
  return (
    <div className="page wizard">
      <div className="kicker">Claim</div>
      <h1 className="display">{claim.formatted}</h1>
      <p>Status: {claim.status}{claim.postcard_sent_at ? ` · Card mailed ${new Date(claim.postcard_sent_at).toLocaleDateString()}` : ""}</p>
      {claim.postcard_code && (
        <section className="section">
          <h2>Postcard code</h2>
          <p className="admin-code"><code>{claim.postcard_code}</code> <span className="meta-line">{claim.code_attempts ?? 0} wrong tries so far</span></p>
        </section>
      )}
      <label className="stack">
        <span>Note</span>
        <textarea className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="action-row">
        <button type="button" className="btn" data-testid="verify-owner" onClick={async () => {
          await api.reviewClaim(claim.claim_id, "verified", note);
          navigate("/admin");
        }}>Verify by hand</button>
        <button className="btn danger" onClick={async () => {
          await api.reviewClaim(claim.claim_id, "rejected", note);
          navigate("/admin");
        }}>Close claim</button>
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
        <Route path="/" element={<RootPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/property/:id" element={<PropertyPageView />} />
        <Route path="/property/:id/photos" element={<PropertyPhotosPage />} />
        <Route path="/property/:id/posts" element={<PropertyPostsPage />} />
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
