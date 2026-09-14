import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, type DebugClaimResult, type Doc, type Fact, type FieldVisibility, type Improvement, type PropertyPage, type Viewer } from "./api";
import { useAuth } from "./auth";
import { actorLabel, eventLabel, ParcelMap, STATUS_LABEL, unknownHint } from "./components";
import { PinClaimModal, useOwnershipChanges } from "./debug";
import { useMeta } from "./meta";
import { DisputesSection, DocumentsSection, HandoffSection, MaintainersSection, NotificationsSection } from "./property-owner";
import {
  CATEGORY_LABEL,
  dateLabel,
  DOCUMENT_TYPE_LABEL,
  fileSize,
  fileUrl,
  hasFile,
  isImage,
  money,
  MULTILINE_FIELDS,
  scrollToId,
  useToast,
  type Toast,
} from "./property-shared";

type PageData = { property: PropertyPage; viewer: Viewer };

const SUMMARY_KEY = "profile.summary";

/**
 * How the vocabulary is laid out on the profile. What a visitor most wants to
 * know comes first; the official parcel identity and record bookkeeping come
 * last. Any field that is not named here still renders, appended to the final
 * section, so nothing in the record is ever dropped.
 */
const FACT_SECTIONS: Array<{ id: string; title: string; keys?: string[]; group?: string }> = [
  { id: "systems", title: "Home systems", group: "owner" },
  {
    id: "location",
    title: "Location & services",
    keys: [
      "school_district", "fire_district", "ag.district",
      "utility.electric", "utility.gas", "utility.water", "utility.sewer", "utility.internet", "utility.trash",
      "geometry.kind",
    ],
  },
  { id: "rules", title: "Rules & environment", group: "rules" },
  {
    id: "assessment",
    title: "Assessment & taxes",
    keys: [
      "assessment.total", "assessment.land", "market_value_estimate",
      "assessment.county_taxable", "assessment.town_taxable", "assessment.school_taxable",
      "exemptions.summary", "taxes.county_town",
    ],
  },
  {
    id: "building",
    title: "Building & lot",
    keys: [
      "property_class", "year_built", "building.style", "building_area", "bedrooms", "bathrooms", "kitchens",
      "building.heat", "building.fuel", "acreage", "lot.frontage", "lot.depth",
    ],
  },
  {
    id: "records",
    title: "Parcel & records",
    keys: [
      "address", "municipality", "county", "parcel.sbl", "parcel.swis",
      "owner_name_public", "last_sale.date", "last_sale.price", "deed.book", "deed.page",
    ],
  },
];

const STAT_KEYS: Array<{ key: string; label: string; subKey?: string }> = [
  { key: "year_built", label: "Built" },
  { key: "building_area", label: "Building" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "bathrooms", label: "Baths" },
  { key: "acreage", label: "Lot" },
  { key: "property_class", label: "Class" },
  { key: "assessment.total", label: "Assessed" },
  { key: "market_value_estimate", label: "Full market value" },
  { key: "last_sale.price", label: "Last sold", subKey: "last_sale.date" },
];

function organizeFacts(facts: Fact[]): Map<string, Fact[]> {
  const placed = new Set<string>([SUMMARY_KEY]);
  const sections = new Map<string, Fact[]>();
  for (const section of FACT_SECTIONS) {
    const list: Fact[] = [];
    if (section.keys) {
      for (const key of section.keys) {
        const fact = facts.find((item) => item.fieldKey === key);
        if (fact && !placed.has(key)) {
          list.push(fact);
          placed.add(key);
        }
      }
    }
    if (section.group) {
      for (const fact of facts) {
        if (fact.group === section.group && !placed.has(fact.fieldKey)) {
          list.push(fact);
          placed.add(fact.fieldKey);
        }
      }
    }
    sections.set(section.id, list);
  }
  const leftovers = facts.filter((fact) => !placed.has(fact.fieldKey));
  if (leftovers.length) {
    const last = FACT_SECTIONS[FACT_SECTIONS.length - 1]!.id;
    sections.set(last, [...(sections.get(last) ?? []), ...leftovers]);
  }
  return sections;
}

function applyClaimedOwner(data: PageData, result: DebugClaimResult): PageData {
  const now = new Date().toISOString();
  const already = data.property.maintainers.some((row) => row.user_id === result.user.user_id);
  return {
    property: {
      ...data.property,
      maintainers: already
        ? data.property.maintainers
        : [
          ...data.property.maintainers,
          {
            maintainer_id: "pending",
            user_id: result.user.user_id,
            role: "owner",
            verified_at: now,
            display_name: result.user.display_name,
            primary_email: result.user.primary_email,
          },
        ],
    },
    viewer: {
      ...data.viewer,
      maintainer: true,
      role: data.viewer.role ?? "owner",
      verifiedAt: data.viewer.verifiedAt ?? now,
      openClaim: null,
    },
  };
}

function ownerCanWrite(fact: Fact): boolean {
  if (fact.layer === "owner") return true;
  return fact.status === "unknown" || fact.status === "owner_reported";
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
  const [aboutEditing, setAboutEditing] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  const load = useCallback(async (opts?: { allowDowngrade?: boolean }) => {
    if (!id) return;
    let last: Error | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const next = await api.property(id);
        setData((current) => {
          // A follow-up fetch that raced the session cookie must not wipe the
          // owner profile we just flipped into after a verified PIN claim.
          // A pending claim, or a different parcel, is never owner access.
          if (current?.property.property_id !== next.property.property_id) return next;
          if (next.viewer.openClaim) return next;
          if (!opts?.allowDowngrade && current?.viewer.maintainer && !next.viewer.maintainer) return current;
          return next;
        });
        setError(null);
        return;
      } catch (err) {
        last = err instanceof Error ? err : new Error("Could not load property");
        if (err instanceof ApiError && (err.status === 404 || err.status === 401 || err.status === 403)) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    if (last) setError(last.message);
  }, [id]);

  useEffect(() => { setData(null); }, [id]);
  useEffect(() => { void load({ allowDowngrade: !user }); }, [load, user?.user_id]);
  useOwnershipChanges(id, () => { void load({ allowDowngrade: true }); });

  const title = data?.property.formatted?.split(",")[0] ?? "Untitled parcel";
  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `${title} · Myplace`;
    return () => { document.title = previous; };
  }, [data, title]);

  const sections = useMemo(() => organizeFacts(data?.property.facts ?? []), [data]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data || !id) return <div className="page">Loading record…</div>;

  const { property, viewer } = data;
  const owner = Boolean(viewer.maintainer && !viewer.openClaim);
  const locality = property.formatted?.includes(",")
    ? property.formatted.slice(property.formatted.indexOf(",") + 1).trim()
    : null;
  const address = property.formatted ?? "this property";
  const photos = property.documents.filter(isImage);
  const available = photos.filter(hasFile);
  const cover = available.find((doc) => doc.is_cover) ?? available[0] ?? null;
  const slides = cover ? [cover, ...available.filter((doc) => doc !== cover)] : [];
  const slide = slides[Math.min(heroIndex, Math.max(0, slides.length - 1))] ?? null;
  const summary = property.facts.find((fact) => fact.fieldKey === SUMMARY_KEY) ?? null;
  const hasSummary = Boolean(summary?.display);
  const systemsFacts = sections.get("systems") ?? [];
  const publicSystems = systemsFacts.filter((fact) => fact.status !== "unknown");
  const maintained = property.maintainers.length > 0;

  const startClaim = () => {
    if (meta?.debug) {
      setPinOpen(true);
      return;
    }
    navigate(user ? `/property/${id}/claim` : `/signin?next=/property/${id}/claim`);
  };

  const uploadPhotos = async (list: FileList | null, options: { cover?: boolean } = {}) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    let first = true;
    for (const file of files) {
      await api.upload(id, file, {
        documentType: "photo",
        visibility: "public",
        ...(options.cover && first ? { cover: "true" } : {}),
      });
      first = false;
    }
    showToast(options.cover ? "Cover photo set." : `${files.length} photo${files.length === 1 ? "" : "s"} added.`);
    await load();
  };

  const showAbout = owner || hasSummary;
  const showPhotos = owner || available.length > 0;
  const showImprovements = owner || property.improvements.length > 0;
  const showSystems = owner || publicSystems.length > 0;

  const nav: Array<{ id: string; label: string }> = [
    ...(showAbout ? [{ id: "about", label: "About" }] : []),
    ...(showPhotos ? [{ id: "photos", label: "Photos" }] : []),
    ...(showImprovements ? [{ id: "improvements", label: "Improvements" }] : []),
    ...(showSystems ? [{ id: "systems", label: "Home systems" }] : []),
    { id: "location", label: "Location" },
    { id: "rules", label: "Rules & environment" },
    { id: "assessment", label: "Assessment & taxes" },
    { id: "building", label: "Building & lot" },
    { id: "records", label: "Parcel & records" },
    { id: "history", label: "History" },
    ...(owner
      ? [
        { id: "documents", label: "Documents" },
        { id: "maintainers", label: "Maintainers" },
        { id: "notifications", label: "Notifications" },
        { id: "handoff", label: "Handoff" },
      ]
      : []),
  ];

  const sectionProps = { owner, propertyId: id, onChange: load, toast: showToast };

  const hero = (
    <figure className={`profile-hero ${cover ? "has-photo" : "is-map"}`} data-testid="profile-hero">
      {cover ? (
        <HeroCarousel
          slides={slides}
          title={title}
          index={heroIndex}
          onIndex={setHeroIndex}
          onOpen={(doc) => setLightbox(photos.indexOf(doc))}
        />
      ) : (
        <ParcelMap
          embedded
          selectedId={property.property_id}
          selectedGeometry={property.geojson}
          onSelect={(next) => navigate(`/property/${next}`)}
          zoom={16}
        />
      )}
      <figcaption className="hero-overlay">
        <div className="hero-side">
          {slide?.caption && <span className="hero-caption">{slide.caption}</span>}
          {slide && owner && slide.visibility !== "public" && (
            <button type="button" className="hero-pill warn" onClick={async () => {
              await api.patchDocument(slide.document_id, { visibility: "public" });
              showToast(slide.is_cover ? "Cover photo is now public." : "Photo is now public.");
              await load();
            }}>Only you can see this {slide.is_cover ? "cover" : "photo"} · Make public</button>
          )}
          {!cover && owner && (
            <label className="btn file-btn hero-cta" data-testid="cover-input-label">
              Add a cover photo
              <input type="file" accept="image/*" data-testid="cover-input" onChange={(event) => { void uploadPhotos(event.target.files, { cover: true }); event.target.value = ""; }} />
            </label>
          )}
          {!cover && !owner && property.geometryQuality && (
            <span className="hero-pill quiet">{property.geometryQuality === "official" ? "Official lot lines" : property.geometryQuality === "approximate" ? "Approximate lot lines" : "Demonstration sketch"}</span>
          )}
        </div>
        {cover && (
          <div className="hero-side">
            <button
              type="button"
              className="hero-pill hero-count"
              aria-label={`Photo ${Math.min(heroIndex, slides.length - 1) + 1} of ${slides.length}. Go to photos`}
              onClick={() => scrollToId("photos")}
            >
              {Math.min(heroIndex, slides.length - 1) + 1} / {slides.length}
            </button>
            {owner && (
              <label className="hero-pill file-btn">
                Change cover
                <input type="file" accept="image/*" onChange={(event) => { void uploadPhotos(event.target.files, { cover: true }); event.target.value = ""; }} />
              </label>
            )}
          </div>
        )}
      </figcaption>
    </figure>
  );

  return (
    <div className="page wide profile property-page" data-testid="property-profile">
      <div className="profile-hero-band">{hero}</div>

      <header className="profile-head group">
        <div className="profile-title">
          <div className="kicker">{[property.municipality, property.county ? `${property.county} County` : null].filter(Boolean).join(" · ")}</div>
          <h1>{title}</h1>
          <p className="profile-meta mono">{[locality, property.sbl ? `SBL ${property.sbl}` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="profile-actions">
          {owner ? (
            <>
              <span className="owner-chip" data-testid="owner-chip">
                <i aria-hidden="true" />
                {viewer.role === "co_owner" ? "Co-owner maintainer" : "Owner maintainer"}
                {viewer.verifiedAt ? ` · since ${dateLabel(viewer.verifiedAt, { month: "short", year: "numeric" })}` : ""}
              </span>
              <div className="action-row compact">
                <label className="btn file-btn">
                  Add photos
                  <input type="file" accept="image/*" multiple data-testid="head-photo-input" onChange={(event) => { void uploadPhotos(event.target.files); event.target.value = ""; }} />
                </label>
                <button type="button" className="btn secondary" onClick={() => { setImprovementFormOpen(true); scrollToId("improvements"); }}>Add improvement</button>
              </div>
            </>
          ) : (
            <>
              {maintained && (
                <span className="owner-chip">
                  <i aria-hidden="true" />
                  Owner-maintained record
                </span>
              )}
              {(!maintained || viewer.openClaim || viewer.invitation?.role === "owner") && (
                <div className="action-row compact">
                  {viewer.openClaim ? (
                    <Link className="btn secondary" to={`/property/${id}/claim/${viewer.openClaim.claim_id}`}>Claim under review</Link>
                  ) : (
                    <button type="button" className="btn" data-testid="claim-button" onClick={startClaim}>
                      {viewer.invitation?.role === "owner" ? "Continue handoff" : "Claim this property"}
                    </button>
                  )}
                </div>
              )}
              {!maintained && !viewer.openClaim && (
                <p className="meta-line profile-nudge">No verified owner yet. Claiming unlocks photos, systems, and the story of this place.</p>
              )}
            </>
          )}
        </div>
      </header>

      <StatStrip facts={property.facts} />

      <div className="profile-grid">
        <ProfileNav items={nav} />

        <div className="profile-main">
          {toast && <div className="toast" role="status">{toast}</div>}

          {viewer.invitation && !owner && viewer.invitation.role === "co_owner" && (
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

          {viewer.invitation && !owner && viewer.invitation.role === "owner" && !viewer.openClaim && (
            <div className="banner">
              <div>
                <strong>{viewer.invitation.invited_by_name ?? "The current owner"}</strong> invited you to take over this record.
              </div>
              <button type="button" className="btn" onClick={startClaim}>Continue handoff</button>
            </div>
          )}

          {owner && (
            <ProfileChecklist
              facts={property.facts}
              documents={property.documents}
              improvements={property.improvements}
              cover={cover}
              onGo={(target) => {
                if (target === "about") setAboutEditing(true);
                if (target === "improvements") setImprovementFormOpen(true);
                scrollToId(target);
              }}
            />
          )}

          {showAbout && summary && (
            <AboutSection
              fact={summary}
              editing={aboutEditing}
              setEditing={setAboutEditing}
              {...sectionProps}
            />
          )}

          {showPhotos && (
            <PhotosSection
              photos={photos}
              cover={cover}
              onUpload={(list) => uploadPhotos(list)}
              onOpen={(index) => setLightbox(index)}
              {...sectionProps}
            />
          )}

          {showImprovements && (
            <ImprovementsSection
              improvements={property.improvements}
              categories={meta?.improvementCategories ?? Object.keys(CATEGORY_LABEL)}
              formOpen={improvementFormOpen}
              setFormOpen={setImprovementFormOpen}
              {...sectionProps}
            />
          )}

          {showSystems && (
            <FactSection
              id="systems"
              title="Home systems"
              description={owner
                ? "What only you know: systems, dates, and work done. Everything here is public unless you mark it private."
                : "Maintained by the verified owner. Not part of the official assessment record."}
              facts={owner ? systemsFacts : publicSystems}
              {...sectionProps}
            />
          )}

          <FactSection
            id="location"
            title="Location & services"
            description={owner ? "Fields without a connected source can be filled in by you. They are labeled owner-reported until an official source confirms them." : undefined}
            facts={sections.get("location") ?? []}
            before={(
              <>
                {cover && (
                  <div className="map-card">
                    <ParcelMap
                      embedded
                      selectedId={property.property_id}
                      selectedGeometry={property.geojson}
                      onSelect={(next) => navigate(`/property/${next}`)}
                      zoom={16}
                    />
                  </div>
                )}
                <div className="notice property-notice">
                  {property.geometryNotice ?? "Lot lines are not available for this parcel."}
                  {" "}Every important fact shows its source.
                  {owner && " Official facts stay official; you maintain the owner layer."}
                </div>
              </>
            )}
            {...sectionProps}
          />

          <FactSection id="rules" title="Rules & environment" facts={sections.get("rules") ?? []} {...sectionProps} />
          <FactSection id="assessment" title="Assessment & taxes" facts={sections.get("assessment") ?? []} {...sectionProps} />
          <FactSection id="building" title="Building & lot" facts={sections.get("building") ?? []} {...sectionProps} />
          <FactSection id="records" title="Parcel & records" facts={sections.get("records") ?? []} {...sectionProps}>
            <h3 className="subhead">Record coverage</h3>
            <div className="group coverage">
              {Object.entries(property.coverage).map(([key, value]) => (
                <div key={key}><span>{key.replace("_", " ")}</span> {value}</div>
              ))}
            </div>
          </FactSection>

          <section className="section" id="history">
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

          {owner && (
            <>
              <div className="owner-tools-head" id="owner-tools">
                <div className="kicker">Owner tools</div>
                <h2>Only maintainers see this part of the page</h2>
                <p className="meta-line">Your vault, the people who maintain this record with you, and what happens when it changes hands.</p>
              </div>
              <DocumentsSection
                propertyId={id}
                documents={property.documents.filter((doc) => !doc.improvement_id)}
                documentTypes={meta?.documentTypes ?? Object.keys(DOCUMENT_TYPE_LABEL)}
                onChange={load}
                toast={showToast}
              />
              {property.disputes.length > 0 && (
                <DisputesSection disputes={property.disputes} onChange={load} toast={showToast} />
              )}
              <MaintainersSection
                propertyId={id}
                maintainers={property.maintainers}
                invitations={property.invitations}
                viewer={viewer}
                currentUserId={user?.user_id ?? null}
                onChange={load}
                toast={showToast}
              />
              {viewer.preferences && (
                <NotificationsSection
                  propertyId={id}
                  preferences={viewer.preferences}
                  options={meta?.preferenceOptions ?? {}}
                  toast={showToast}
                />
              )}
              <HandoffSection propertyId={id} toast={showToast} onChange={load} />
            </>
          )}
        </div>
      </div>

      {lightbox !== null && photos[lightbox] && (
        <PhotoLightbox photos={photos} index={lightbox} owner={owner} onIndex={setLightbox} onClose={() => setLightbox(null)} onChange={load} toast={showToast} />
      )}

      {pinOpen && (
        <PinClaimModal
          propertyId={id}
          address={address}
          onClose={() => setPinOpen(false)}
          onClaimed={(result: DebugClaimResult) => {
            setPinOpen(false);
            setData((current) => current ? applyClaimedOwner(current, result) : current);
            showToast("Ownership verified. This is now your profile to build out.");
            void load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero support: stat strip, in-page nav, lightbox
// ---------------------------------------------------------------------------

function StatStrip({ facts }: { facts: Fact[] }) {
  const stats = STAT_KEYS.flatMap((stat) => {
    const fact = facts.find((item) => item.fieldKey === stat.key);
    if (!fact || fact.status === "unknown" || !fact.display) return [];
    const sub = stat.subKey ? facts.find((item) => item.fieldKey === stat.subKey) : null;
    return [{
      key: stat.key,
      label: stat.label,
      value: fact.display,
      sub: sub && sub.status !== "unknown" && typeof sub.value === "string" ? dateLabel(sub.value, { month: "short", year: "numeric" }) : null,
      status: fact.status,
    }];
  }).slice(0, 6);
  if (stats.length === 0) return null;
  return (
    <div className="stat-strip" data-testid="stat-strip">
      {stats.map((stat) => (
        <div key={stat.key} className="stat">
          <span>{stat.label}</span>
          <strong>
            {stat.value}
            {stat.sub && <small> · {stat.sub}</small>}
          </strong>
          {stat.status !== "available" && <em className={`badge ${stat.status}`}>{STATUS_LABEL[stat.status]}</em>}
        </div>
      ))}
    </div>
  );
}

const SCROLL_DRIVEN = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");

/**
 * Swipeable hero. A native scroll-snap track does the gesture work; we only
 * read which slide has settled so the caption, badge, and dots can follow.
 */
function HeroCarousel({
  slides,
  title,
  index,
  onIndex,
  onOpen,
}: {
  slides: Doc[];
  title: string;
  index: number;
  onIndex: (index: number) => void;
  onOpen: (doc: Doc) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const count = slides.length;
  const current = Math.min(index, Math.max(0, count - 1));

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const read = () => {
      const width = track.clientWidth || 1;
      const next = Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / width)));
      onIndex(next);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
    };
  }, [count, onIndex]);

  // A shorter list (photo removed) can leave the track past its last slide.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const width = track.clientWidth;
    if (width && Math.round(track.scrollLeft / width) !== current) {
      track.scrollTo({ left: current * width, behavior: "auto" });
    }
  }, [count, current]);

  const goTo = (next: number) => {
    const track = trackRef.current;
    if (!track) return;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: next * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <>
      <div ref={trackRef} className="hero-track" data-testid="hero-track">
        {slides.map((doc, i) => (
          <button
            key={doc.document_id}
            type="button"
            className="hero-image hero-slide"
            onClick={() => onOpen(doc)}
            aria-label={`Open photo ${i + 1} of ${count}`}
            tabIndex={i === current ? 0 : -1}
          >
            <img
              src={fileUrl(doc)}
              alt={doc.caption ?? title}
              loading={i === 0 ? "eager" : "lazy"}
              draggable={false}
            />
          </button>
        ))}
      </div>
      {count > 1 && (
        <div className="hero-dots" role="tablist" aria-label="Photos">
          {slides.map((doc, i) => (
            <button
              key={doc.document_id}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-label={`Photo ${i + 1}`}
              className={i === current ? "on" : ""}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Scroll the chip bar just enough that the selected chip sits at the visible end. */
function scrollChipIntoBar(scroller: HTMLElement, chip: HTMLElement) {
  if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
  const scrollerBox = scroller.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  const styles = getComputedStyle(scroller);
  const padLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const padRight = Number.parseFloat(styles.paddingRight) || 0;
  const visibleLeft = scrollerBox.left + padLeft;
  const visibleRight = scrollerBox.right - padRight;
  let delta = 0;
  if (chipBox.right > visibleRight) delta = chipBox.right - visibleRight;
  else if (chipBox.left < visibleLeft) delta = chipBox.left - visibleLeft;
  else return;
  const next = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, scroller.scrollLeft + delta));
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollTo({ left: next, behavior: reduce ? "auto" : "smooth" });
}

function ProfileNav({ items }: { items: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pinRef = useRef<string | null>(null);
  const pinTimer = useRef(0);
  const ids = items.map((item) => item.id).join("|");
  const releasePin = () => {
    pinRef.current = null;
    window.clearTimeout(pinTimer.current);
  };
  const selectChip = (id: string) => {
    pinRef.current = id;
    setActive(id);
    window.clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(releasePin, 1600);
    scrollToId(id);
  };
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    const sync = () => {
      document.documentElement.style.setProperty("--profile-nav-height", `${Math.round(node.getBoundingClientRect().height)}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--profile-nav-height");
    };
  }, [ids]);
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    // With scroll-driven animations the docking hand-off is pure CSS, driven by
    // the compositor. Nothing here needs to run per frame.
    if (SCROLL_DRIVEN) return;
    const root = document.documentElement;
    let stickyTop = 0;
    const measure = () => { stickyTop = Number.parseFloat(getComputedStyle(node).top) || 0; };
    const check = () => {
      // A stuck sticky element sits exactly at its `top`; inline it is further down.
      root.classList.toggle("nav-docked", node.getBoundingClientRect().top <= stickyTop + 0.5);
    };
    const remeasure = () => { measure(); check(); };
    remeasure();
    // --topbar-height is written by the layout's effect, which runs after this one.
    const frame = requestAnimationFrame(remeasure);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", remeasure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", remeasure);
      root.classList.remove("nav-docked");
    };
  }, []);
  useEffect(() => {
    const nodes = ids.split("|").map((id) => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return;
    const visible = new Map<string, number>();
    const styles = getComputedStyle(document.documentElement);
    // With the hand-off, the docked chrome ends at brand row + tabs (the search
    // row has slid away); without it, the tabs sit under the whole header.
    const header = Number.parseFloat(styles.getPropertyValue("--topbar-height")) || 84;
    const topbar = (SCROLL_DRIVEN && Number.parseFloat(styles.getPropertyValue("--topbar-main-height"))) || header;
    const nav = Number.parseFloat(styles.getPropertyValue("--profile-nav-height")) || 68;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
        else visible.delete(entry.target.id);
      }
      const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
      // A tap pins the chip until page scroll settles. Ignore the sections we
      // fly past so they do not flash selected on the way.
      if (pinRef.current) return;
      if (top) setActive(top[0]);
    }, { rootMargin: `-${topbar + nav}px 0px -55% 0px`, threshold: 0 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids]);
  useEffect(() => {
    const onScrollEnd = (event: Event) => {
      const target = event.target;
      if (target === scrollerRef.current) return;
      if (target !== document && target !== document.documentElement && target !== document.body && target !== document.scrollingElement) return;
      releasePin();
    };
    window.addEventListener("scrollend", onScrollEnd);
    return () => {
      window.removeEventListener("scrollend", onScrollEnd);
      window.clearTimeout(pinTimer.current);
    };
  }, []);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !active) return;
    const chip = scroller.querySelector<HTMLElement>(`a[href="#${CSS.escape(active)}"]`);
    if (!chip) return;
    const frame = requestAnimationFrame(() => scrollChipIntoBar(scroller, chip));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return (
    <div ref={navRef} className="profile-nav-wrap">
      <nav ref={scrollerRef} className="side-nav profile-nav" aria-label="On this page">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={active === item.id ? "on" : ""}
            onClick={(event) => { event.preventDefault(); selectChip(item.id); }}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

function VisibilityChip({ visibility, onToggle, busy = false }: { visibility: FieldVisibility; onToggle: () => void; busy?: boolean }) {
  const isPrivate = visibility === "private";
  return (
    <button
      type="button"
      className={`vis-chip ${isPrivate ? "is-private" : ""}`}
      disabled={busy}
      title={isPrivate ? "Only maintainers can see this. Click to share it on the public profile." : "Shown on the public profile. Click to keep it private."}
      onClick={onToggle}
    >
      <i aria-hidden="true" />
      {isPrivate ? "Private" : "Public"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function AboutSection({
  fact,
  owner,
  propertyId,
  editing,
  setEditing,
  onChange,
  toast,
}: {
  fact: Fact;
  owner: boolean;
  propertyId: string;
  editing: boolean;
  setEditing: (open: boolean) => void;
  onChange: () => Promise<void> | void;
  toast: Toast;
}) {
  const text = typeof fact.value === "string" ? fact.value : "";
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editing) setDraft(text); }, [text, editing]);

  const save = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveOwnerFields(propertyId, { [SUMMARY_KEY]: next });
      toast(result.updated ? "About this place saved." : "About this place cleared.");
      setEditing(false);
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section about" id="about">
      <div className="section-head">
        <h2>About this place</h2>
        {owner && fact.visibility && !editing && (
          <VisibilityChip visibility={fact.visibility} onToggle={async () => {
            const next = fact.visibility === "private" ? "public" : "private";
            await api.setFieldVisibility(propertyId, SUMMARY_KEY, next);
            toast(next === "private" ? "About this place is now private." : "About this place is now public.");
            await onChange();
          }} />
        )}
      </div>
      {owner && editing ? (
        <form className="group form-card about-editor" onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
          <textarea
            className="field"
            rows={6}
            autoFocus
            value={draft}
            placeholder="When it was built and by whom, what has changed, what a neighbor would tell you. Written for whoever cares about this place next."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setEditing(false); }}
            data-testid="about-input"
          />
          {error && <p className="error">{error}</p>}
          <div className="action-row compact">
            <button type="submit" className="btn small" disabled={busy || !draft.trim()} data-testid="about-save">{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="btn secondary small" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            {text && <button type="button" className="text-link danger" disabled={busy} onClick={() => void save("")}>Clear</button>}
          </div>
        </form>
      ) : text ? (
        <div className="group about-card">
          <p className="about-text">{text}</p>
          {owner && (
            <div className="about-foot">
              <button type="button" className="text-link" onClick={() => setEditing(true)} data-testid="about-edit">Edit</button>
            </div>
          )}
        </div>
      ) : (
        <div className="group empty-card about-empty">
          <p>Every property has a story. Say what makes this one itself: when it was built, what has been done, what a neighbor would tell you.</p>
          {owner && (
            <button type="button" className="btn secondary small" onClick={() => setEditing(true)} data-testid="about-start">Write about this place</button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function FactSection({
  id,
  title,
  description,
  facts,
  owner,
  propertyId,
  onChange,
  toast,
  before,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  facts: Fact[];
  owner: boolean;
  propertyId: string;
  onChange: () => Promise<void> | void;
  toast: Toast;
  before?: React.ReactNode;
  children?: React.ReactNode;
}) {
  if (facts.length === 0 && !children && !before) return null;
  return (
    <section className="section" id={id}>
      <h2>{title}</h2>
      {description && <p className="meta-line section-note">{description}</p>}
      {before}
      {facts.length > 0 && (
        <div className="group">
          {facts.map((fact) => (
            <FactRow key={fact.fieldKey} fact={fact} owner={owner} propertyId={propertyId} onChange={onChange} toast={toast} />
          ))}
        </div>
      )}
      {children}
    </section>
  );
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
  toast?: Toast;
}) {
  const [editing, setEditing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [visBusy, setVisBusy] = useState(false);
  const editable = owner && propertyId && ownerCanWrite(fact);
  const disputable = owner && propertyId && !ownerCanWrite(fact) && fact.status !== "unknown";
  const ownerAssertion = fact.assertions.find((assertion) => assertion.sourceType === "verified_owner");
  const showBadge = fact.status !== "available" && !(fact.status === "unknown" && editable);
  const canToggle = editable && ownerAssertion && fact.visibility;

  return (
    <div className={`fact ${editable ? "is-editable" : ""} ${fact.dispute ? "is-disputed" : ""} ${fact.visibility === "private" ? "is-private" : ""}`} data-field={fact.fieldKey}>
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
            {canToggle && propertyId && (
              <VisibilityChip
                visibility={fact.visibility!}
                busy={visBusy}
                onToggle={async () => {
                  setVisBusy(true);
                  try {
                    const next = fact.visibility === "private" ? "public" : "private";
                    await api.setFieldVisibility(propertyId, fact.fieldKey, next);
                    toast?.(next === "private" ? `${fact.label} is now private.` : `${fact.label} is now public.`);
                    await onChange?.();
                  } finally {
                    setVisBusy(false);
                  }
                }}
              />
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
// Checklist
// ---------------------------------------------------------------------------

function ProfileChecklist({
  facts,
  documents,
  improvements,
  cover,
  onGo,
}: {
  facts: Fact[];
  documents: Doc[];
  improvements: Improvement[];
  cover: Doc | null;
  onGo: (target: string) => void;
}) {
  const has = (key: string) => facts.some((fact) => fact.fieldKey === key && fact.status !== "unknown");
  const doc = (type: string) => documents.some((item) => item.document_type === type) || improvements.some((item) => item.documents.some((d) => d.document_type === type));
  const items: Array<{ label: string; ok: boolean; target: string }> = [
    { label: "Cover photo", ok: Boolean(cover), target: "photos" },
    { label: "About this place", ok: has(SUMMARY_KEY), target: "about" },
    { label: "Photos", ok: documents.some(isImage), target: "photos" },
    { label: "An improvement", ok: improvements.length > 0, target: "improvements" },
    { label: "Roof", ok: has("roof.type") || has("roof.year") || improvements.some((item) => item.category === "roof"), target: "systems" },
    { label: "Heating", ok: has("heating") || improvements.some((item) => item.category === "hvac"), target: "systems" },
    { label: "Cooling", ok: has("cooling"), target: "systems" },
    { label: "Water heater", ok: has("water_heater"), target: "systems" },
    { label: "Electrical", ok: has("electrical") || improvements.some((item) => item.category === "electrical"), target: "systems" },
    { label: "Septic / well", ok: has("septic_or_well") || improvements.some((item) => item.category === "septic_well"), target: "systems" },
    { label: "Utilities", ok: has("utility.electric") && has("utility.water") && has("utility.sewer"), target: "location" },
    { label: "Survey", ok: doc("survey"), target: "documents" },
    { label: "Deed", ok: doc("deed") || has("deed.book"), target: "documents" },
    { label: "Permits", ok: doc("permit") || doc("certificate_of_occupancy"), target: "documents" },
    { label: "Plans", ok: doc("plans"), target: "documents" },
  ];
  const done = items.filter((item) => item.ok).length;
  const next = items.find((item) => !item.ok);
  const complete = done === items.length;
  return (
    <section className="section checklist" data-testid="completeness">
      <div className="group checklist-card">
        <div className="checklist-head">
          <div>
            <div className="kicker">{complete ? "Profile complete" : "Build out this profile"}</div>
            <strong>{done} of {items.length} documented</strong>
          </div>
          {next && (
            <button type="button" className="btn small" onClick={() => onGo(next.target)}>
              {next.label === "About this place" ? "Write about this place" : next.label === "An improvement" ? "Record an improvement" : `Add ${next.label.toLowerCase()}`}
            </button>
          )}
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
          <i style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        <p className="meta-line">Completeness of the record, not the condition of the property. Everything you add is public unless you mark it private.</p>
        <div className="completeness-grid">
          {items.map((item) => item.ok ? (
            <span key={item.label} className="ok"><i aria-hidden="true">✓</i>{item.label}</span>
          ) : (
            <button key={item.label} type="button" onClick={() => onGo(item.target)}><i aria-hidden="true" />{item.label}</button>
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
  propertyId,
  owner,
  improvements,
  categories,
  formOpen,
  setFormOpen,
  onChange,
  toast,
}: {
  propertyId: string;
  owner: boolean;
  improvements: Improvement[];
  categories: string[];
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
  onChange: () => Promise<void> | void;
  toast: Toast;
}) {
  const total = improvements.reduce((sum, item) => sum + (item.cost_cents ?? 0), 0);
  return (
    <section className="section" id="improvements">
      <div className="section-head">
        <h2>Improvements</h2>
        {owner && !formOpen && (
          <button type="button" className="text-btn accent" data-testid="add-improvement" onClick={() => setFormOpen(true)}>Add improvement</button>
        )}
      </div>
      <p className="meta-line section-note">
        {owner
          ? "Work done on the property, with receipts and photos attached. Photos follow the improvement’s visibility; receipts always stay private and go with the property on handoff unless you mark them personal."
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

/** Photos take the improvement's visibility; receipts and other files never go public from here. */
function attachmentVisibility(file: File, improvementVisibility: string): string {
  return file.type.startsWith("image/") ? improvementVisibility : "private";
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
  const [visibility, setVisibility] = useState("public");
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
          await api.upload(propertyId, file, { improvementId: created.improvement.improvement_id, visibility: attachmentVisibility(file, visibility) });
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
            <button type="button" className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>Public</button>
            <button type="button" className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>Private</button>
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
  toast: Toast;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const images = item.documents.filter(isImage);
  const files = item.documents.filter((doc) => !isImage(doc));
  const meta = [
    { key: "date", value: dateLabel(item.performed_at) },
    { key: "cost", value: money(item.cost_cents) },
    { key: "contractor", value: item.contractor },
  ].filter((entry): entry is { key: string; value: string } => Boolean(entry.value));

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        await api.upload(propertyId, file, { improvementId: item.improvement_id, visibility: attachmentVisibility(file, item.visibility) });
      }
      toast(`${list.length} attachment${list.length === 1 ? "" : "s"} added.`);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`group improvement-card ${item.visibility === "private" ? "is-private" : ""}`} data-testid="improvement-card">
      <header className="improvement-head">
        {owner ? (
          <select
            className="chip chip-select"
            value={item.category}
            aria-label="Category"
            onChange={async (event) => {
              await api.patchImprovement(item.improvement_id, { category: event.target.value });
              await onChange();
            }}
          >
            {categories.map((key) => <option key={key} value={key}>{CATEGORY_LABEL[key] ?? key}</option>)}
          </select>
        ) : (
          <span className="chip">{CATEGORY_LABEL[item.category] ?? item.category}</span>
        )}
        <h3>{item.title}</h3>
        {meta.length > 0 && (
          <ul className="improvement-meta">
            {meta.map((entry) => <li key={entry.key} className={entry.key}>{entry.value}</li>)}
          </ul>
        )}
      </header>
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
            <button type="button" className={item.visibility === "public" ? "on" : ""} onClick={async () => { await api.patchImprovement(item.improvement_id, { visibility: "public" }); await onChange(); }}>Public</button>
            <button type="button" className={item.visibility === "private" ? "on" : ""} onClick={async () => { await api.patchImprovement(item.improvement_id, { visibility: "private" }); await onChange(); }}>Private</button>
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

function RestorePhoto({
  doc,
  busy,
  onPick,
}: {
  doc: Doc;
  busy?: boolean;
  onPick: (file: File) => void | Promise<void>;
}) {
  return (
    <label className={`photo-open photo-missing ${busy ? "is-busy" : ""}`} data-testid={`restore-${doc.document_id}`}>
      <span className="photo-missing-copy">
        <strong>File missing</strong>
        <span>Tap to restore {doc.original_filename}</span>
      </span>
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        aria-label={`Restore ${doc.original_filename}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onPick(file);
        }}
      />
    </label>
  );
}

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
  const missing = !hasFile(photo);

  const replace = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.replaceDocument(photo.document_id, file);
      toast(missing ? "Photo restored." : "Photo updated.");
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
        {missing ? (
          <RestorePhoto doc={photo} busy={busy} onPick={(file) => void replace(file)} />
        ) : (
          <img src={fileUrl(photo)} alt={photo.caption ?? photo.original_filename} />
        )}
        <figcaption>
          {photo.caption && <strong>{photo.caption}</strong>}
          <span className="meta-line">{photos.length > 1 ? `${index + 1} of ${photos.length}` : ""}{photo.created_at ? `${photos.length > 1 ? " · " : ""}${dateLabel(photo.created_at)}` : ""}</span>
          {owner && (
            <div className="lightbox-actions">
              <label className={`btn secondary file-btn ${busy ? "is-busy" : ""}`}>
                {busy ? "Saving…" : missing ? "Restore" : "Change"}
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
            {hasFile(doc) ? <img src={fileUrl(doc)} alt="" loading="lazy" /> : <span className="photo-missing-label">Missing</span>}
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

function PhotosSection({
  owner,
  photos,
  cover,
  onUpload,
  onOpen,
  onChange,
  toast,
}: {
  owner: boolean;
  propertyId: string;
  photos: Doc[];
  cover: Doc | null;
  onUpload: (list: FileList | null) => Promise<void>;
  onOpen: (index: number) => void;
  onChange: () => Promise<void> | void;
  toast: Toast;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="section" id="photos">
      <div className="section-head">
        <h2>Photos</h2>
        {owner && (
          <label className={`text-btn accent file-btn ${busy ? "is-busy" : ""}`}>
            {busy ? "Uploading…" : "Add photos"}
            <input type="file" accept="image/*" multiple disabled={busy} data-testid="photo-input" onChange={async (event) => {
              const list = event.target.files;
              setBusy(true);
              try {
                await onUpload(list);
              } finally {
                setBusy(false);
                event.target.value = "";
              }
            }} />
          </label>
        )}
      </div>
      {owner && <p className="meta-line section-note">Photos are public unless you make them private. The cover is the first thing a visitor sees.{photos.some((doc) => !hasFile(doc)) ? " Cards marked “file missing” need the original photo reattached; after that they stay in Cloudflare." : ""}</p>}
      {photos.length === 0 ? (
        <div className="group empty-card">{owner ? "No photos yet. Exterior, roof, mechanicals, and before-and-after shots all belong here." : "None shared yet."}</div>
      ) : (
        <div className={`photo-grid ${photos.length > 2 ? "featured" : ""}`}>
          {photos.map((doc, index) => (
            <figure key={doc.document_id} className={`photo-card ${doc.visibility === "private" ? "is-private" : ""} ${hasFile(doc) ? "" : "is-missing"}`}>
              {owner && !hasFile(doc) ? (
                <RestorePhoto
                  doc={doc}
                  onPick={async (file) => {
                    await api.replaceDocument(doc.document_id, file);
                    toast("Photo restored.");
                    await onChange();
                  }}
                />
              ) : (
                <button type="button" className="photo-open" onClick={() => onOpen(index)} aria-label={doc.caption ? `Open photo: ${doc.caption}` : "Open photo"}>
                  <img src={fileUrl(doc)} alt={doc.caption ?? doc.original_filename} loading="lazy" />
                  {cover?.document_id === doc.document_id && <span className="photo-flag">Cover</span>}
                  {owner && doc.visibility === "private" && <span className="photo-flag private">Private</span>}
                </button>
              )}
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
                      <option value="public">Public</option>
                      <option value="property_transferable">Visible on transfer</option>
                      <option value="private">Private</option>
                    </select>
                    <span className="photo-tool-links">
                      {!doc.is_cover && (
                        <button type="button" className="text-link" data-testid={`cover-${doc.document_id}`} onClick={async () => {
                          await api.patchDocument(doc.document_id, { cover: true });
                          toast("Cover photo updated.");
                          await onChange();
                        }}>Set as cover</button>
                      )}
                      <button type="button" className="text-link danger" onClick={async () => {
                        await api.deleteDocument(doc.document_id);
                        await onChange();
                      }}>Remove</button>
                    </span>
                  </div>
                </figcaption>
              ) : (
                doc.caption && <figcaption>{doc.caption}</figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
