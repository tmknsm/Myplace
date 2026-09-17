import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, type DebugClaimResult, type Doc, type Fact, type FieldVisibility, type Improvement, type PageRefresh, type PropertyNeighbor, type PropertyPage, type Room, type Viewer } from "./api";
import { useAuth } from "./auth";
import { actorLabel, eventLabel, PageSpinner, ParcelMap, Spinner, STATUS_LABEL, unknownHint } from "./components";
import { PinClaimModal, useOwnershipChanges } from "./debug";
import { useMeta } from "./meta";
import { DisputesSection } from "./property-owner";
import { snapshotPhotoFile } from "./optimize-photo";
import { SectionNav } from "./section-nav";
import { Sheet, useLockPageScroll, useSheet } from "./sheet";
import {
  filledTopicFacts,
  linkLabel,
  normalizeLink,
  TOPIC_BY_ID,
  topicFacts,
  topicForField,
  topicsIn,
  type Topic,
  type TopicField,
  type TopicFieldKind,
} from "./property-topics";
import { ownerLabel, ownerPhoto } from "../../shared/profile";
import { fieldsForRoom, ROOM_KIND_LABEL, ROOM_KINDS, ROOM_PAID_KEY, ROOM_PAID_PUBLIC_KEY, roomPaidCents, roomPaidPublic, type RoomField } from "../../shared/rooms";
import { isTopicId } from "../../shared/topics";
import {
  CATEGORY_LABEL,
  dateLabel,
  DOCUMENT_TYPE_LABEL,
  fileSize,
  fileUrl,
  hasFile,
  isImage,
  money,
  FIELD_HINTS,
  hexFieldKey,
  MULTILINE_FIELDS,
  parseHex,
  scrollToId,
  splitSwatch,
  useToast,
  type Toast,
} from "./property-shared";

function factHex(fieldKey: string, facts: Fact[]): string | null {
  const key = hexFieldKey(fieldKey);
  if (!key) return null;
  const fact = facts.find((item) => item.fieldKey === key);
  const raw = fact?.display ?? (typeof fact?.value === "string" ? fact.value : null);
  return raw;
}

const OFFICIAL_SOURCES = new Set(["government", "platform_admin"]);

/** True only when county/state (or desk) says this lot is in a historic district. */
function isOfficialHistoricDistrict(facts: Fact[]): boolean {
  const fact = facts.find((item) => item.fieldKey === "historic.district");
  if (!fact || fact.dispute || fact.status !== "available") return false;
  const official = fact.assertions.filter((item) => OFFICIAL_SOURCES.has(item.sourceType));
  if (!official.length) return false;
  const text = String(official[0]?.display ?? official[0]?.value ?? fact.display ?? fact.value ?? "");
  if (!/historic\s+district/i.test(text)) return false;
  if (/not in a listed/i.test(text) || /not a district/i.test(text)) return false;
  return true;
}

type PageData = { property: PropertyPage; viewer: Viewer };

/** Which sheet is up. Every owner input on the page goes through one of these. */
type SheetState =
  | { kind: "topic"; id: string }
  | { kind: "field"; key: string }
  | { kind: "dispute"; key: string }
  | { kind: "about" }
  | null;

const SUMMARY_KEY = "profile.summary";

/**
 * How the vocabulary is laid out on the page. The owner's half (what only they
 * know) comes first; the county's half (official facts with their sources)
 * follows, ending with parcel identity and record bookkeeping. Any field that
 * is not named here still renders, appended to the final section, so nothing
 * in the record is ever dropped.
 */
const FACT_SECTIONS: Array<{ id: string; title: string; keys?: string[]; group?: string }> = [
  { id: "character", title: "Style & finishes", group: "character" },
  { id: "systems", title: "Systems", group: "owner" },
  {
    id: "location",
    title: "Location & utilities",
    keys: [
      "school_district", "fire_district", "ag.district",
      "utility.electric", "utility.gas", "utility.water", "utility.sewer", "utility.internet", "utility.trash",
      "geometry.kind",
    ],
  },
  { id: "rules", title: "Flood, zoning & historic", group: "rules" },
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
    title: "County record",
    keys: [
      "address", "municipality", "county", "parcel.sbl", "parcel.swis",
      "owner_name_public", "last_sale.date", "last_sale.price", "deed.book", "deed.page",
    ],
  },
];

/**
 * The strip under the hero. Character facts the owner wrote (paint, style,
 * trim color) come first when they're filled in. Public facts fill the rest
 * so an unclaimed or barely-started page still has something worth reading:
 * beds, baths, the year it last sold, the year it was built. Empty slots
 * stay empty — the Style & finishes section is where you add the rest.
 */
const STRIP_KEYS: Array<{ key: string; label: string; asYear?: boolean }> = [
  { key: "exterior.color", label: "Exterior paint" },
  { key: "style.architecture", label: "Architecture" },
  { key: "exterior.trim", label: "Trim color" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "bathrooms", label: "Baths" },
  { key: "last_sale.date", label: "Purchased", asYear: true },
  { key: "year_built", label: "Built", asYear: true },
];
const STRIP_MAX = 6;

/**
 * The character tiles an unclaimed page is missing, shown as quiet outlines so
 * a prospective owner sees what the strip becomes once it's theirs. Real facts
 * always come first; these only fill the slots left over.
 */
const GHOST_TILES: Array<{ key: string; label: string; text: string; swatch: boolean }> = [
  { key: "exterior.color", label: "Exterior paint", text: "Name & swatch", swatch: true },
  { key: "style.architecture", label: "Architecture", text: "Period & details", swatch: false },
  { key: "exterior.trim", label: "Trim color", text: "Name & swatch", swatch: true },
];

/**
 * The owner's half of the page, as it reads before anyone has claimed it. One
 * card per section a claimed page would have, each a door to the claim flow.
 * Ids match the section chips so the nav works the same on both pages.
 */
const PREVIEW_CARDS: Array<{ id: string; label: string; title: string; body: string }> = [
  { id: "photos", label: "Photos", title: "Photos", body: "A cover photo, the kitchen, the before-and-afters. Public by default; the owner picks what stays private." },
  { id: "character", label: "Style", title: "Style & finishes", body: "The paint, named, with a swatch. The style, and what's still original." },
  { id: "rooms", label: "Rooms", title: "Rooms", body: "Kitchen, baths, bedrooms: the flooring, the fixtures, the color on the walls." },
  { id: "improvements", label: "Improvements", title: "Improvements", body: "What was done, who did it, what it cost. Receipts stay private and travel with the house." },
  { id: "systems", label: "Systems", title: "Systems", body: "Roof, heat, water, wiring, septic, and the year each went in." },
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
            handle: result.user.handle,
            anonymize: result.user.anonymize,
            label: ownerLabel(result.user),
            photo_url: ownerPhoto(result.user),
          },
        ],
    },
    viewer: {
      ...data.viewer,
      maintainer: true,
      role: data.viewer.role ?? "owner",
      verifiedAt: data.viewer.verifiedAt ?? now,
      openClaim: null,
      neighbor: { status: "hidden" },
    },
  };
}

function isGalleryPhoto(doc: Doc): boolean {
  return isImage(doc) && doc.topic_id !== "paint" && doc.topic_id !== "style";
}

/** Cover first, then the rest in the order they arrived. */
function orderGalleryPhotos(photos: Doc[], cover: Doc | null): Doc[] {
  if (!cover) return photos;
  return [cover, ...photos.filter((doc) => doc.document_id !== cover.document_id)];
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
  const { user, ready } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const [data, setData] = useState<PageData | null>(null);
  // Signed-out visitors on a claimed page see only what is above the fold.
  const gated = ready && !user && Boolean(data?.property.maintainers.length);
  const [gateMetrics, setGateMetrics] = useState<{ heroTop: number; heroLeft: number; heroWidth: number; heroHeight: number; heroMid: number; labels: number; solid: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [toast, showToast] = useToast();
  const [improvementFormOpen, setImprovementFormOpen] = useState(false);
  const [roomFormOpen, setRoomFormOpen] = useState(false);
  // The header's plus button: shown once the owner's Add photos / Add
  // improvement row has scrolled fully behind the top bar.
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [quickAddOn, setQuickAddOn] = useState(false);
  const [quickAddSlots, setQuickAddSlots] = useState<HTMLElement[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [sheetSeq, setSheetSeq] = useState(0);
  // Keep the last sheet's content mounted while it animates out.
  const lastSheet = useRef<SheetState>(null);
  if (sheet) lastSheet.current = sheet;
  // The lightbox pages through whichever set the tapped photo came from.
  const [lightbox, setLightbox] = useState<{ source: "hero" | "gallery"; index: number } | null>(null);
  const setLightboxIndex = useCallback((index: number) => {
    setLightbox((current) => (current && current.index !== index ? { ...current, index } : current));
  }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const [heroIndex, setHeroIndex] = useState(0);
  const [photoUploads, setPhotoUploads] = useState(0);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { allowDowngrade?: boolean }) => {
    if (!id) return;
    let last: Error | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const next = await api.property(id);
        setData((current) => {
          // A follow-up fetch that raced the session cookie must not wipe the
          // owner profile we just flipped into after a verified PIN claim.
          // Property fields still come from `next` so a save is never discarded.
          if (!current || current.property.property_id !== next.property.property_id) return next;
          if (next.viewer.openClaim) return next;
          if (!opts?.allowDowngrade && current.viewer.maintainer && !next.viewer.maintainer) {
            return { ...next, viewer: { ...next.viewer, maintainer: true, role: current.viewer.role, verifiedAt: current.viewer.verifiedAt } };
          }
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

  const refresh = useCallback<PageRefresh>(async (patch) => {
    if (patch) {
      setData((current) => current ? { ...current, property: patch(current.property) } : current);
    }
    await load();
  }, [load]);

  useEffect(() => { setData(null); }, [id]);
  useEffect(() => { void load({ allowDowngrade: !user }); }, [load, user?.user_id]);
  useOwnershipChanges(id, () => { void load({ allowDowngrade: true }); });

  // Clip the gated page to the viewport without position:fixed, so a pull
  // at the top can still refresh. Snap back if anything scrolls down.
  useEffect(() => {
    if (!gated) return;
    const html = document.documentElement;
    html.classList.add("peek-gated");
    window.scrollTo(0, 0);
    const pin = () => {
      if (window.scrollY > 0) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", pin, { passive: true });
    return () => {
      html.classList.remove("peek-gated");
      window.removeEventListener("scroll", pin);
    };
  }, [gated]);
  useEffect(() => {
    if (!gated) {
      setGateMetrics(null);
      return;
    }
    const measure = () => {
      const header = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) || 0;
      const rel = (top: number) => Math.max(0, top - header);
      const hero = document.querySelector<HTMLElement>(".property-page .profile-hero");
      const heroBox = hero?.getBoundingClientRect();
      const label = document.querySelector<HTMLElement>('[data-testid="stat-strip"] .stat span');
      const value = document.querySelector<HTMLElement>('[data-testid="stat-strip"] .stat strong');
      const strip = document.querySelector<HTMLElement>('[data-testid="stat-strip"]');
      const head = document.querySelector<HTMLElement>(".property-page .profile-head");
      const heroTop = heroBox ? rel(heroBox.top) : 0;
      const heroHeight = heroBox?.height ?? window.innerHeight * 0.42;
      const heroMid = heroBox ? rel(heroBox.top + heroBox.height / 2) : window.innerHeight * 0.28;
      const labels = rel((label ?? strip)?.getBoundingClientRect().top ?? head?.getBoundingClientRect().bottom ?? window.innerHeight * 0.55);
      const solid = rel((value ?? strip)?.getBoundingClientRect().top ?? labels + 28);
      setGateMetrics({
        heroTop,
        heroLeft: heroBox?.left ?? 0,
        heroWidth: heroBox?.width ?? window.innerWidth,
        heroHeight,
        heroMid,
        labels,
        solid: Math.max(solid, labels + 12),
      });
    };
    measure();
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [gated, data]);

  const title = data?.property.formatted?.split(",")[0] ?? "Untitled parcel";
  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `${title} · Myplace`;
    return () => { document.title = previous; };
  }, [data, title]);

  const sections = useMemo(() => organizeFacts(data?.property.facts ?? []), [data]);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Both header search rows (wide and narrow) carry a slot; only one is
  // displayed at a time, so the button is portaled into each.
  const canQuickAdd = Boolean(data?.viewer.maintainer && !data?.viewer.openClaim);
  useEffect(() => {
    if (!canQuickAdd) return;
    setQuickAddSlots(Array.from(document.querySelectorAll<HTMLElement>(".header-add-slot")));
    return () => setQuickAddSlots([]);
  }, [canQuickAdd]);
  useEffect(() => {
    const node = actionsRef.current;
    if (!canQuickAdd || !node) return;
    let observer: IntersectionObserver | null = null;
    const watch = () => {
      observer?.disconnect();
      const header = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-height")) || 0;
      observer = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        // Off screen above the header, not below the fold.
        const edge = entry.rootBounds?.top ?? header;
        setQuickAddOn(!entry.isIntersecting && entry.boundingClientRect.bottom <= edge + 0.5);
      }, { rootMargin: `-${Math.ceil(header)}px 0px 0px 0px`, threshold: 0 });
      observer.observe(node);
    };
    watch();
    // --topbar-height is written by the layout's effect, which runs after this one.
    const frame = requestAnimationFrame(watch);
    window.addEventListener("resize", watch);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", watch);
      observer?.disconnect();
      setQuickAddOn(false);
    };
  }, [canQuickAdd]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data || !id || !ready) return <PageSpinner label="Loading record" />;

  const { property, viewer } = data;
  const owner = Boolean(viewer.maintainer && !viewer.openClaim);
  const locality = property.formatted?.includes(",")
    ? property.formatted.slice(property.formatted.indexOf(",") + 1).trim()
    : null;
  const address = property.formatted ?? "this property";
  const photos = property.documents.filter(isImage);
  // Paint and style attachments live on those cards, not in the hero or Photos gallery.
  const galleryPhotos = photos.filter(isGalleryPhoto);
  const available = galleryPhotos.filter(hasFile);
  const cover = available.find((doc) => doc.is_cover) ?? available[0] ?? null;
  const gallery = orderGalleryPhotos(galleryPhotos, cover);
  const photoSlides = cover ? [cover, ...available.filter((doc) => doc !== cover)] : [];
  const lightboxPhotos = lightbox?.source === "hero" ? photoSlides : gallery;
  const mapSlideIndex = photoSlides.length;
  const heroSlideCount = mapSlideIndex + 1;
  const heroSlide = Math.min(heroIndex, Math.max(0, heroSlideCount - 1));
  const onMapSlide = heroSlide === mapSlideIndex;
  const activePhoto = !onMapSlide ? photoSlides[heroSlide] ?? null : null;
  const summary = property.facts.find((fact) => fact.fieldKey === SUMMARY_KEY) ?? null;
  const hasSummary = Boolean(summary?.display);
  const maintained = property.maintainers.length > 0;
  const pagePeople = [...property.maintainers].sort((a, b) => {
    if (a.role === b.role) return 0;
    return a.role === "owner" ? -1 : 1;
  });
  const historicDistrict = isOfficialHistoricDistrict(property.facts);
  // Visitors only see topics with something public in them; the owner sees every card.
  const topicHasPhotos = (topic: Topic) => property.documents.some((doc) => doc.topic_id === topic.id && isImage(doc) && hasFile(doc));
  const visibleTopics = (list: Topic[]) => owner
    ? list
    : list.filter((topic) => filledTopicFacts(topic, property.facts).length > 0 || topicHasPhotos(topic));
  const characterTopics = visibleTopics(topicsIn("character"));
  const systemsTopics = visibleTopics(topicsIn("systems"));

  const openSheet = (next: NonNullable<SheetState>) => {
    setSheetSeq((n) => n + 1);
    setSheet(next);
  };
  /** Open whichever sheet edits this field: its topic, or a one-field sheet. */
  const openField = (key: string) => {
    const topic = topicForField(key);
    openSheet(topic ? { kind: "topic", id: topic.id } : { kind: "field", key });
  };

  const startClaim = () => {
    if (meta?.debug) {
      setPinOpen(true);
      return;
    }
    navigate(user ? `/property/${id}/claim` : `/signin?next=/property/${id}/claim`);
  };
  /** Where the preview's doors lead: into the claim flow, or to the claim already under review. */
  const goClaim = () => {
    if (viewer.openClaim) {
      navigate(`/property/${id}/claim/${viewer.openClaim.claim_id}`);
      return;
    }
    startClaim();
  };

  const uploadPhotos = async (files: File[], options: { cover?: boolean } = {}) => {
    if (!files.length) return;
    setPhotoError(null);
    setPhotoUploads((count) => count + files.length);
    try {
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
      await refresh();
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Photo could not be added. Try again.";
      setPhotoError(message);
      showToast(message);
    } finally {
      setPhotoUploads((count) => Math.max(0, count - files.length));
    }
  };

  const uploading = photoUploads > 0;
  const reportPhotoError = (message: string) => {
    setPhotoError(message);
    showToast(message);
  };

  const showAbout = owner || hasSummary;
  const showPhotos = owner || gallery.some(hasFile);
  const showImprovements = owner || property.improvements.length > 0;
  const showSystems = systemsTopics.length > 0;
  const rooms = property.rooms ?? [];
  const showRooms = owner || rooms.length > 0;
  const showCharacter = characterTopics.length > 0;
  const vaultCount = property.documents.filter((doc) => !isImage(doc) && !doc.improvement_id && !doc.room_id && !doc.topic_id).length;

  // Nobody has claimed this page yet: show the owner's half as outlines so a
  // prospective owner can see what it becomes. Pages someone else maintains
  // stay as they are; a visitor there isn't the one who'd fill them in.
  const prospect = !owner && !maintained;
  const shown: Record<string, boolean> = { photos: showPhotos, character: showCharacter, rooms: showRooms, improvements: showImprovements, systems: showSystems };
  const previewCards = prospect ? PREVIEW_CARDS.filter((card) => !shown[card.id]) : [];
  const previews = (sectionId: string) => previewCards.some((card) => card.id === sectionId);

  const nav: Array<{ id: string; label: string }> = [
    ...(showPhotos || previews("photos") ? [{ id: "photos", label: "Photos" }] : []),
    ...(showAbout ? [{ id: "about", label: "About" }] : []),
    ...((property.neighbors ?? []).length > 0 ? [{ id: "neighbors", label: "Neighbors" }] : []),
    ...(showCharacter || previews("character") ? [{ id: "character", label: "Style" }] : []),
    ...(showRooms || previews("rooms") ? [{ id: "rooms", label: "Rooms" }] : []),
    ...(showImprovements || previews("improvements") ? [{ id: "improvements", label: "Improvements" }] : []),
    ...(showSystems || previews("systems") ? [{ id: "systems", label: "Systems" }] : []),
    ...(owner ? [{ id: "vault", label: "Vault" }] : []),
    { id: "location", label: "Location" },
    { id: "rules", label: "Flood & zoning" },
    { id: "assessment", label: "Assessment & taxes" },
    { id: "building", label: "Building & lot" },
    { id: "records", label: "County record" },
    { id: "history", label: "History" },
  ];

  const sectionProps = { owner, propertyId: id, onChange: refresh, toast: showToast };
  const factSheetProps = {
    onEdit: (fact: Fact) => openField(fact.fieldKey),
    onDispute: (fact: Fact) => openSheet({ kind: "dispute", key: fact.fieldKey }),
  };

  const heroMap = (
    <ParcelMap
      embedded
      visible={onMapSlide}
      selectedId={property.property_id}
      selectedGeometry={property.geojson}
      onSelect={(next) => navigate(`/property/${next}`)}
      zoom={16}
    />
  );

  const hero = (
    <figure className={`profile-hero ${photoSlides.length ? "has-photo" : "is-map"}`} data-testid="profile-hero">
      <HeroCarousel
        photos={photoSlides}
        title={title}
        index={heroSlide}
        onIndex={setHeroIndex}
        onOpen={(doc) => setLightbox({ source: "hero", index: photoSlides.indexOf(doc) })}
        map={heroMap}
      />
      <figcaption className="hero-overlay">
        <div className="hero-side">
          {activePhoto && owner && activePhoto.visibility !== "public" && (
            <button type="button" className="hero-pill warn" onClick={async () => {
              await api.patchDocument(activePhoto.document_id, { visibility: "public" });
              showToast(activePhoto.is_cover ? "Cover photo is now public." : "Photo is now public.");
              await load();
            }}>Only you can see this {activePhoto.is_cover ? "cover" : "photo"} · Make public</button>
          )}
          {photoSlides.length === 0 && owner && (
            <PhotoFileButton className="btn hero-cta" busy={uploading} testId="cover-input" labelTestId="cover-input-label" onPick={(files) => uploadPhotos(files, { cover: true })} onError={reportPhotoError}>
              Add a cover photo
            </PhotoFileButton>
          )}
          {onMapSlide && !owner && property.geometryQuality && (
            <span className="hero-pill quiet">{property.geometryQuality === "official" ? "Official lot lines" : property.geometryQuality === "approximate" ? "Approximate lot lines" : "Demonstration sketch"}</span>
          )}
        </div>
      </figcaption>
    </figure>
  );

  return (
    <div className={`page wide profile property-page${gated ? " is-gated" : ""}`} data-testid="property-profile">
      <div className="profile-hero-band">{hero}</div>

      <header className="profile-head group">
        <div className="profile-title">
          {user && pagePeople.length > 0 && (
            <div className="owner-bylines">
              {pagePeople.map((person) => (
                <div
                  key={person.maintainer_id}
                  className="owner-byline"
                  data-testid={person.role === "co_owner" ? "co-owner-byline" : "owner-byline"}
                >
                  <img src={person.photo_url} alt="" width={16} height={16} />
                  <span>{person.label}</span>
                </div>
              ))}
            </div>
          )}
          {((maintained && !owner) || historicDistrict) && (
            <div className="profile-chips">
              {maintained && !owner && (
                <span className="owner-chip" data-testid="owner-chip">Claimed</span>
              )}
              {historicDistrict && (
                <span className="owner-chip" data-testid="historic-chip">Historic district</span>
              )}
            </div>
          )}
          {!maintained && (
            <div className="kicker">{[property.municipality, property.county ? `${property.county} County` : null].filter(Boolean).join(" · ")}</div>
          )}
          <h1>{title}</h1>
          <p className="profile-meta mono">{
            maintained
              ? [locality, property.county ? `${property.county} County` : null].filter(Boolean).join(" · ")
              : [locality, property.sbl ? `SBL ${property.sbl}` : null].filter(Boolean).join(" · ")
          }</p>
        </div>
        {(owner || (!maintained || viewer.openClaim || viewer.invitation?.role === "owner")) && (
          <div className="profile-actions">
            {owner ? (
              <div className="action-row compact" ref={actionsRef}>
                <PhotoFileButton className="btn" busy={uploading} multiple testId="head-photo-input" onPick={(files) => uploadPhotos(files)} onError={reportPhotoError}>
                  Add photos
                </PhotoFileButton>
                <button type="button" className="btn secondary" onClick={() => { setImprovementFormOpen(true); scrollToId("improvements"); }}>Add improvement</button>
              </div>
            ) : (
              <>
                {(!maintained || viewer.openClaim || viewer.invitation?.role === "owner") && (
                  <div className="action-row compact">
                    {viewer.openClaim ? (
                      <Link className="btn secondary" to={`/property/${id}/claim/${viewer.openClaim.claim_id}`}>Claim under review</Link>
                    ) : (
                      <button type="button" className="btn" data-testid="claim-button" onClick={startClaim}>
                        {viewer.invitation?.role === "owner" ? "Continue handoff" : "Claim this address"}
                      </button>
                    )}
                  </div>
                )}
                {!maintained && !viewer.openClaim && (
                  <p className="meta-line profile-nudge">Still just the county record. If it's yours, claim it and add what the county doesn't know.</p>
                )}
              </>
            )}
          </div>
        )}
      </header>

      {owner && quickAddSlots.map((slot, index) => createPortal(
        <QuickAdd
          on={quickAddOn}
          uploading={uploading}
          onPhotos={(files) => uploadPhotos(files)}
          onPhotoError={reportPhotoError}
          onImprovement={() => { setImprovementFormOpen(true); scrollToId("improvements"); }}
          onRoom={() => { setRoomFormOpen(true); scrollToId("rooms"); }}
        />,
        slot,
        `quick-add-${index}`,
      ))}

      <StatStrip facts={property.facts} onClaim={prospect ? goClaim : undefined} />

      {gated && (
        <div
          className="peek-gate"
          style={{
            "--gate-hero-top": gateMetrics ? `${gateMetrics.heroTop}px` : "0px",
            "--gate-hero-left": gateMetrics ? `${gateMetrics.heroLeft}px` : "0px",
            "--gate-hero-width": gateMetrics ? `${gateMetrics.heroWidth}px` : "100%",
            "--gate-hero-height": gateMetrics ? `${gateMetrics.heroHeight}px` : "42%",
            "--gate-hero-mid": gateMetrics ? `${gateMetrics.heroMid}px` : "28%",
            "--gate-labels": gateMetrics ? `${gateMetrics.labels}px` : "55%",
            "--gate-solid": gateMetrics ? `${gateMetrics.solid}px` : "62%",
          } as React.CSSProperties}
          data-testid="peek-gate"
        >
          <div className="peek-gate-scrim" aria-hidden="true" />
          <div className="peek-gate-lockup">
            <h2>Join Myplace to see<br />claimed properties</h2>
            <Link className="btn" to={`/signup?next=/property/${id}`} data-testid="peek-gate-signup">Sign up</Link>
          </div>
          <p className="peek-gate-note">The owner keeps this page. Create a free account to see everything they've added.</p>
        </div>
      )}

      {!gated && (
      <div className="profile-grid">
        <SectionNav items={nav} />

        <div className="profile-main">
          {toast && <div className="toast" role="status">{toast}</div>}

          {viewer.invitation && !owner && viewer.invitation.role === "co_owner" && (
            <div className="banner">
              <div>
                <strong>{viewer.invitation.invited_by_name ?? "The owner"}</strong> invited you to help keep this page.
              </div>
              <button type="button" className="btn" onClick={async () => {
                await api.acceptInvitation(viewer.invitation!.invitation_id);
                showToast("You're a co-owner on this page now.");
                await load();
              }}>Accept invitation</button>
            </div>
          )}

          {viewer.invitation && !owner && viewer.invitation.role === "owner" && !viewer.openClaim && (
            <div className="banner">
              <div>
                <strong>{viewer.invitation.invited_by_name ?? "The current owner"}</strong> is handing this page to you.
              </div>
              <button type="button" className="btn" onClick={startClaim}>Continue handoff</button>
            </div>
          )}

          {owner && (
            <ProfileChecklist
              facts={property.facts}
              documents={property.documents}
              improvements={property.improvements}
              rooms={rooms}
              cover={cover}
              onGo={(target) => {
                // The vault lives on the owner tools page now.
                if (target === "documents") {
                  navigate(`/property/${id}/manage`);
                  return;
                }
                if (target === "about") {
                  openSheet({ kind: "about" });
                  return;
                }
                if (target === "improvements") {
                  setImprovementFormOpen(true);
                  return;
                }
                if (target.startsWith("field:")) {
                  openField(target.slice("field:".length));
                  return;
                }
                scrollToId(target);
              }}
            />
          )}

          {showPhotos && (
            <PhotosSection
              photos={gallery}
              cover={cover}
              pendingCount={photoUploads}
              uploading={uploading}
              uploadError={photoError}
              onUpload={(files) => uploadPhotos(files)}
              onUploadError={reportPhotoError}
              onOpen={(index) => setLightbox({ source: "gallery", index })}
              {...sectionProps}
            />
          )}

          {showAbout && summary && (
            <AboutSection
              fact={summary}
              owner={owner}
              propertyId={id}
              onEdit={() => openSheet({ kind: "about" })}
              onChange={refresh}
            />
          )}

          {(property.neighbors ?? []).length > 0 && (
            <NeighborsSection propertyId={id} neighbors={property.neighbors} />
          )}

          {showCharacter && (
            <TopicSection
              id="character"
              title="Style & finishes"
              description={owner
                ? "What people actually ask about when they slow down out front: the paint, the style. Public unless you mark it private."
                : "How the owner describes the place. Their words, not the county's."}
              topics={characterTopics}
              facts={property.facts}
              documents={property.documents}
              owner={owner}
              onOpen={(topic) => openSheet({ kind: "topic", id: topic.id })}
              propertyId={id}
              onChange={refresh}
              toast={showToast}
            />
          )}

          {showRooms && (
            <RoomsSection
              rooms={rooms}
              owner={owner}
              propertyId={id}
              formOpen={roomFormOpen}
              setFormOpen={setRoomFormOpen}
              onChange={refresh}
              toast={showToast}
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
            <TopicSection
              id="systems"
              title="Systems"
              description={owner
                ? "Roof, heat, water, wiring, septic: what's in the walls and when it went in. Public unless you mark it private."
                : "Reported by the owner. Not part of the county record."}
              topics={systemsTopics}
              facts={property.facts}
              documents={property.documents}
              owner={owner}
              onOpen={(topic) => openSheet({ kind: "topic", id: topic.id })}
              propertyId={id}
              onChange={refresh}
              toast={showToast}
            />
          )}

          {owner && <VaultCard propertyId={id} count={vaultCount} maintainers={property.maintainers.length} />}

          {previewCards.length > 0 && (
            <ClaimPreview
              cards={previewCards}
              openClaim={viewer.openClaim ? `/property/${id}/claim/${viewer.openClaim.claim_id}` : null}
              onClaim={goClaim}
            />
          )}

          <FactSection
            id="location"
            title="Location & utilities"
            facts={sections.get("location") ?? []}
            before={(
              <div className="notice property-notice">
                {property.geometryNotice ?? "Lot lines aren't available for this parcel."}
              </div>
            )}
            {...sectionProps}
            {...factSheetProps}
          />

          <FactSection id="rules" title="Flood, zoning & historic" facts={sections.get("rules") ?? []} {...sectionProps} {...factSheetProps} />
          <FactSection id="assessment" title="Assessment & taxes" facts={sections.get("assessment") ?? []} {...sectionProps} {...factSheetProps} />
          <FactSection id="building" title="Building & lot" facts={sections.get("building") ?? []} {...sectionProps} {...factSheetProps} />
          <FactSection id="records" title="County record" facts={sections.get("records") ?? []} {...sectionProps} {...factSheetProps}>
            <div className="group coverage">
              {Object.entries(property.coverage).map(([key, value]) => (
                <div key={key}><span>{key.replace("_", " ")}</span> {value}</div>
              ))}
            </div>
          </FactSection>

          <section className="section" id="history">
            <h2>History</h2>
            <p className="meta-line section-note">{property.historyNote} Written once, never rewritten.</p>
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

          {owner && property.disputes.length > 0 && (
            <DisputesSection disputes={property.disputes} onChange={refresh} toast={showToast} />
          )}
        </div>
      </div>
      )}

      {owner && (
        <OwnerSheet
          state={sheet ?? lastSheet.current}
          open={sheet !== null}
          seq={sheetSeq}
          facts={property.facts}
          documents={property.documents}
          propertyId={id}
          onClose={closeSheet}
          onChange={refresh}
          toast={showToast}
        />
      )}

      {lightbox && lightboxPhotos[lightbox.index] && (
        <PhotoLightbox photos={lightboxPhotos} index={lightbox.index} owner={owner} onIndex={setLightboxIndex} onClose={closeLightbox} onChange={refresh} toast={showToast} />
      )}

      {pinOpen && (
        <PinClaimModal
          propertyId={id}
          address={address}
          onClose={() => setPinOpen(false)}
          onClaimed={(result: DebugClaimResult) => {
            setPinOpen(false);
            setData((current) => current ? applyClaimedOwner(current, result) : current);
            showToast("Verified. The page is yours now.");
            void load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The owner's pointer to the vault
// ---------------------------------------------------------------------------

/** The private half lives on the owner tools page; this is the door to it. */
function VaultCard({ propertyId, count, maintainers }: { propertyId: string; count: number; maintainers: number }) {
  const docs = count === 0 ? "Nothing in the vault yet" : `${count} document${count === 1 ? "" : "s"} in the vault`;
  const people = maintainers > 1 ? `${maintainers} people can edit this page` : "Only you can edit this page";
  return (
    <section className="section" id="vault" data-testid="vault-card">
      <h2>The private half</h2>
      <p className="meta-line section-note">Deed, survey, permits, warranties, the boiler manual. Private by default, and you pick what travels with the house at closing.</p>
      <div className="group vault-card">
        <div>
          <strong>{docs}</strong>
          <div className="meta-line">{people}. Handoff and notifications live here too.</div>
        </div>
        <Link className="btn secondary" to={`/property/${propertyId}/manage`} data-testid="open-owner-tools">{count === 0 ? "Open the vault" : "Owner tools"}</Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The owner's half, before anyone has claimed it
// ---------------------------------------------------------------------------

/**
 * Outlines of the sections a claimed page carries. Each card is a door into
 * the claim flow, and the section ends on the claim button again so a reader
 * who scrolled past the header doesn't have to go back up for it.
 */
function ClaimPreview({
  cards,
  openClaim,
  onClaim,
}: {
  cards: typeof PREVIEW_CARDS;
  /** Link to the claim under review, when the viewer already has one open. */
  openClaim: string | null;
  onClaim: () => void;
}) {
  return (
    <section className="section claim-preview" data-testid="claim-preview">
      <h2>The owner's half</h2>
      <p className="meta-line section-note">
        Empty until someone claims the page. This is what they'd fill in; the county record picks up at Location.
      </p>
      <div className="topic-list">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            id={card.id}
            className="group topic-card topic-empty preview-card"
            onClick={onClaim}
            data-testid={`preview-${card.id}`}
          >
            <span className="preview-card-title">{card.title}</span>
            <span className="meta-line">{card.body}</span>
            <span className="preview-card-cta">{openClaim ? "Claim under review" : "Claim to add"}</span>
          </button>
        ))}
      </div>
      <div className="claim-preview-foot">
        {openClaim ? (
          <Link className="btn secondary" to={openClaim}>Claim under review</Link>
        ) : (
          <button type="button" className="btn" data-testid="claim-preview-button" onClick={onClaim}>Claim this address</button>
        )}
        <span className="meta-line">Verification takes a day or two. There's a private vault too, for the deed, the survey, the manuals.</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hero support: stat strip, in-page nav, lightbox
// ---------------------------------------------------------------------------

/** Year-only display for dates and year-built numbers ("2019", "1889"). */
function factYear(fact: Fact): string | null {
  if (typeof fact.value === "number" && Number.isFinite(fact.value)) {
    const year = Math.trunc(fact.value);
    return year > 1000 ? String(year) : null;
  }
  if (typeof fact.value === "string") {
    const parsed = new Date(fact.value);
    if (!Number.isNaN(parsed.getTime())) return String(parsed.getFullYear());
    const match = fact.value.match(/\b(1[6-9]\d{2}|20\d{2})\b/);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * The tiles under the hero. Only facts that already have a value. Character
 * first (paint, style, trim color), then the public ones that are actually
 * worth glancing at (beds, baths, the year it last sold, the year it was built).
 * With `onClaim`, the character slots still empty are drawn as outlines that
 * lead into the claim flow.
 */
function StatStrip({ facts, onClaim }: { facts: Fact[]; onClaim?: () => void }) {
  const tiles = STRIP_KEYS.flatMap((tile) => {
    const fact = facts.find((item) => item.fieldKey === tile.key);
    if (!fact || fact.status === "unknown") return [];
    if (tile.asYear) {
      const year = factYear(fact);
      if (!year) return [];
      return [{ key: tile.key, label: tile.label, text: year, swatch: null as string | null, isPrivate: fact.visibility === "private" }];
    }
    if (!fact.display) return [];
    const { text, swatch } = splitSwatch(tile.key, fact.display, factHex(tile.key, facts));
    return [{ key: tile.key, label: tile.label, text, swatch, isPrivate: fact.visibility === "private" }];
  }).slice(0, STRIP_MAX);
  const ghosts = onClaim
    ? GHOST_TILES.filter((ghost) => !tiles.some((tile) => tile.key === ghost.key)).slice(0, Math.max(0, STRIP_MAX - tiles.length))
    : [];
  const count = tiles.length + ghosts.length;
  if (count === 0) return null;
  return (
    <div className={`stat-strip${count % 2 ? " odd" : ""}`} data-testid="stat-strip">
      {tiles.map((tile) => (
        <div key={tile.key} className={`stat${tile.isPrivate ? " is-private" : ""}`} data-field={tile.key}>
          <span>{tile.label}{tile.isPrivate ? " · private" : ""}</span>
          <strong>
            {tile.swatch && <i className="swatch" style={{ background: tile.swatch }} aria-hidden="true" />}
            {tile.text}
          </strong>
        </div>
      ))}
      {ghosts.map((ghost) => (
        <button
          key={ghost.key}
          type="button"
          className="stat stat-ghost"
          data-field={ghost.key}
          data-testid={`stat-ghost-${ghost.key}`}
          aria-label={`${ghost.label}: the owner adds this after claiming`}
          onClick={onClaim}
        >
          <span>{ghost.label}</span>
          <strong>
            {ghost.swatch && <i className="swatch swatch-empty" aria-hidden="true" />}
            {ghost.text}
          </strong>
        </button>
      ))}
    </div>
  );
}

const HERO_DOT = 6;
const HERO_DOT_GAP = 6;
const HERO_DOT_STEP = HERO_DOT + HERO_DOT_GAP;

/** Stretch the active thumb from one dot into the next as the track scrolls. */
function placeHeroThumb(el: HTMLElement | null, progress: number, count: number) {
  if (!el || count < 2) return;
  const max = count - 1;
  const p = Math.max(0, Math.min(max, progress));
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    el.style.width = `${HERO_DOT}px`;
    el.style.transform = `translate3d(${p * HERO_DOT_STEP}px,0,0)`;
    return;
  }
  const i = Math.floor(p);
  const t = p - i;
  if (t === 0 || i >= max) {
    el.style.width = `${HERO_DOT}px`;
    el.style.transform = `translate3d(${i * HERO_DOT_STEP}px,0,0)`;
    return;
  }
  if (t <= 0.5) {
    el.style.width = `${HERO_DOT + t * 2 * HERO_DOT_STEP}px`;
    el.style.transform = `translate3d(${i * HERO_DOT_STEP}px,0,0)`;
    return;
  }
  el.style.width = `${HERO_DOT + (1 - t) * 2 * HERO_DOT_STEP}px`;
  el.style.transform = `translate3d(${i * HERO_DOT_STEP + (t * 2 - 1) * HERO_DOT_STEP}px,0,0)`;
}

/**
 * Drives a native scroll-snap track: keeps the track on `current` when the
 * index or slide count changes from outside, reports the settled slide back
 * through `onIndex` as the user swipes, and morphs the dot thumb in between.
 * Returns a `goTo` for dot taps and keyboard steps.
 */
function useSnapTrack({
  trackRef,
  thumbRef,
  count,
  current,
  onIndex,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  thumbRef: React.RefObject<HTMLSpanElement | null>;
  count: number;
  current: number;
  onIndex: (index: number) => void;
}) {
  // Runs before the scroll reader below so an initial non-zero `current`
  // (opening the lightbox on the third photo) isn't read back as slide 0.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const width = track.clientWidth;
    const settled = Math.max(0, Math.min(current, count - 1));
    if (width && Math.round(track.scrollLeft / width) !== settled) {
      track.scrollTo({ left: settled * width, behavior: "auto" });
    }
  }, [count, current, trackRef]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const read = () => {
      const width = track.clientWidth || 1;
      const progress = Math.max(0, Math.min(count - 1, track.scrollLeft / width));
      placeHeroThumb(thumbRef.current, progress, count);
      onIndex(Math.round(progress));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    read();
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
    };
  }, [count, onIndex, thumbRef, trackRef]);

  return useCallback((next: number) => {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(count - 1, next));
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: target * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }, [count, trackRef]);
}

/**
 * Swipeable hero. A native scroll-snap track does the gesture work; we only
 * read which slide has settled so the dots can follow.
 */
function HeroCarousel({
  photos,
  title,
  index,
  onIndex,
  onOpen,
  map,
}: {
  photos: Doc[];
  title: string;
  index: number;
  onIndex: (index: number) => void;
  onOpen: (doc: Doc) => void;
  map: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const mapIndex = photos.length;
  const count = mapIndex + 1;
  const current = Math.min(index, Math.max(0, count - 1));
  const [dotsOn, setDotsOn] = useState(true);
  const hideTimer = useRef(0);
  const armed = useRef(false);
  const swiping = useRef(false);
  const startX = useRef(0);

  // A shorter list (photo removed) can leave the index past the last slide.
  useEffect(() => {
    if (index > count - 1) onIndex(count - 1);
  }, [count, index, onIndex]);

  const goTo = useSnapTrack({ trackRef, thumbRef, count, current, onIndex });

  useEffect(() => {
    const show = () => {
      setDotsOn(true);
      window.clearTimeout(hideTimer.current);
    };
    const hideSoon = () => {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setDotsOn(false), 1000);
    };
    // Stay visible until the first swipe. After that, hide on the post-swipe
    // delay and only come back when the user swipes again.
    const track = trackRef.current;
    if (!track) return;

    const begin = (event: PointerEvent | TouchEvent) => {
      armed.current = true;
      swiping.current = false;
      const x = "clientX" in event ? event.clientX : event.touches[0]?.clientX ?? 0;
      startX.current = x;
    };
    const move = (event: PointerEvent | TouchEvent) => {
      if (!armed.current || swiping.current) return;
      const x = "clientX" in event ? event.clientX : event.touches[0]?.clientX ?? startX.current;
      if (Math.abs(x - startX.current) < 6) return;
      swiping.current = true;
      show();
    };
    const end = () => {
      if (!armed.current && !swiping.current) return;
      const didSwipe = swiping.current;
      armed.current = false;
      swiping.current = false;
      if (didSwipe) hideSoon();
    };
    const onScroll = () => {
      // Only an in-progress swipe counts. Snap, momentum, and goTo() must
      // not bring the dots back after they've hidden.
      if (!armed.current) return;
      swiping.current = true;
      show();
    };

    // Capture: the slides are buttons, and a native swipe cancels the pointer
    // before scroll. Touch + capture keep the gesture even after that.
    track.addEventListener("pointerdown", begin, { capture: true });
    track.addEventListener("touchstart", begin, { capture: true, passive: true });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("pointerup", end);
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(hideTimer.current);
      track.removeEventListener("pointerdown", begin, { capture: true });
      track.removeEventListener("touchstart", begin, { capture: true });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      track.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <div ref={trackRef} className="hero-track" data-testid="hero-track">
        {photos.map((doc, i) => (
          <button
            key={doc.document_id}
            type="button"
            className="hero-image hero-slide"
            onClick={() => onOpen(doc)}
            aria-label={`Open photo ${i + 1} of ${photos.length}`}
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
        <div className="hero-slide hero-map-slide" aria-label="Parcel map" data-testid="hero-map-slide">
          {map}
        </div>
      </div>
      {count > 1 && (
        <div className={`hero-dots${dotsOn ? " is-on" : ""}`} role="tablist" aria-label="Hero">
          <div className="hero-dots-inner">
            <span ref={thumbRef} className="hero-dot-thumb" aria-hidden="true" />
            {photos.map((doc, i) => (
              <button
                key={doc.document_id}
                type="button"
                role="tab"
                aria-selected={i === current}
                aria-label={`Photo ${i + 1}`}
                className={i === current ? "on" : ""}
                tabIndex={dotsOn ? 0 : -1}
                onClick={() => goTo(i)}
              />
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={current === mapIndex}
              aria-label="Map"
              className={current === mapIndex ? "on" : ""}
              tabIndex={dotsOn ? 0 : -1}
              onClick={() => goTo(mapIndex)}
            />
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

function EyeOpen() {
  return (
    <svg className="vis-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.2 12s3.5-6.4 9.8-6.4S21.8 12 21.8 12s-3.5 6.4-9.8 6.4S2.2 12 2.2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function EyeClosed() {
  return (
    <svg className="vis-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.2 9.4C5.7 12.6 8.7 14.2 12 14.2s6.3-1.6 8.8-4.8" />
      <path d="M4.1 15.4 6.2 12.9" />
      <path d="M19.9 15.4 17.8 12.9" />
      <path d="M9.1 17.6 9.7 14.5" />
      <path d="M14.9 17.6 14.3 14.5" />
    </svg>
  );
}

/** Open eye = public, closed eye = private. No chip, no frame. */
function VisibilityToggle({
  value,
  onChange,
  busy = false,
  labeled = false,
  labelFirst = false,
  testId,
}: {
  value: FieldVisibility | "public" | "private";
  onChange: (next: FieldVisibility) => void;
  busy?: boolean;
  labeled?: boolean;
  /** Put the word to the left of the eye, as in the amount-paid field. */
  labelFirst?: boolean;
  testId?: string;
}) {
  const isPrivate = value === "private";
  const word = isPrivate ? "private" : "public";
  return (
    <button
      type="button"
      className={`vis-toggle${isPrivate ? " is-private" : ""}${labeled ? " is-labeled" : ""}${labelFirst ? " is-label-first" : ""}`}
      disabled={busy}
      aria-pressed={!isPrivate}
      title={isPrivate ? "Private. Click to show on the public profile." : "Public. Click to keep it private."}
      data-testid={testId}
      onClick={() => onChange(isPrivate ? "public" : "private")}
    >
      {labeled && labelFirst && <span className="vis-word">{word}</span>}
      {isPrivate ? <EyeClosed /> : <EyeOpen />}
      {labeled && !labelFirst && <span className="vis-word">{word}</span>}
    </button>
  );
}

function VisibilityChip({ visibility, onToggle, busy = false }: { visibility: FieldVisibility; onToggle: () => void; busy?: boolean }) {
  return <VisibilityToggle value={visibility} busy={busy} onChange={() => onToggle()} />;
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

function AboutSection({
  fact,
  owner,
  propertyId,
  onEdit,
  onChange,
}: {
  fact: Fact;
  owner: boolean;
  propertyId: string;
  onEdit: () => void;
  onChange: PageRefresh;
}) {
  const text = typeof fact.value === "string" ? fact.value : "";
  return (
    <section className="section about" id="about">
      <div className="section-head">
        <h2>About</h2>
      </div>
      {text ? (
        <div className={`group about-card${fact.visibility === "private" ? " is-private" : ""}`}>
          <p className="about-text">{text}</p>
          {owner && (
            <CardFoot
              visibility={fact.visibility ?? "public"}
              onVisibility={async (next) => {
                if (fact.visibility === next) return;
                await api.setFieldVisibility(propertyId, SUMMARY_KEY, next);
                await onChange((page) => ({
                  ...page,
                  facts: page.facts.map((row) => row.fieldKey === SUMMARY_KEY ? { ...row, visibility: next } : row),
                }));
              }}
              onEdit={onEdit}
              editTestId="about-edit"
            />
          )}
        </div>
      ) : (
        <div className="group empty-card about-empty">
          <p>Every house has a story. This is where you tell it: when it was built, what's been done, the thing a neighbor would point out.</p>
          {owner && (
            <button type="button" className="btn secondary small" onClick={onEdit} data-testid="about-start">Tell the story</button>
          )}
        </div>
      )}
    </section>
  );
}

const NEIGHBOR_PREVIEW_LIMIT = 8;

function neighborTileLabel(neighbor: PropertyNeighbor): string {
  const street = [neighbor.street_number, neighbor.street_name].filter(Boolean).join(" ");
  return street || neighbor.formatted || "Neighbor";
}

function NeighborsGrid({ neighbors }: { neighbors: PropertyNeighbor[] }) {
  return (
    <div className="neighbor-grid" data-testid="neighbor-grid">
      {neighbors.map((neighbor) => {
        const label = neighborTileLabel(neighbor);
        return (
          <Link
            key={neighbor.property_id}
            className="neighbor-card"
            to={`/property/${neighbor.property_id}`}
            data-testid="neighbor-tile"
            aria-label={neighbor.formatted || label}
          >
            <span className="neighbor-tile">
              {neighbor.photo_url ? (
                <img src={neighbor.photo_url} alt="" />
              ) : (
                <span className="neighbor-tile-fallback">{neighbor.street_number || label}</span>
              )}
            </span>
            <span className="neighbor-card-label">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function NeighborsSection({ propertyId, neighbors }: { propertyId: string; neighbors: PropertyNeighbor[] }) {
  const allHref = `/property/${propertyId}/neighbors`;
  return (
    <section className="section" id="neighbors" data-testid="neighbors-section">
      <div className="section-head">
        <h2>Neighbors</h2>
        {neighbors.length > NEIGHBOR_PREVIEW_LIMIT && (
          <div className="section-head-actions">
            <Link className="text-btn accent" to={allHref} data-testid="neighbors-view-all">View all</Link>
          </div>
        )}
      </div>
      <NeighborsGrid neighbors={neighbors.slice(0, NEIGHBOR_PREVIEW_LIMIT)} />
    </section>
  );
}

export function PropertyNeighborsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.property(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load property");
    }
  }, [id]);

  useEffect(() => { setData(null); }, [id]);
  useEffect(() => { void load(); }, [load, user?.user_id]);

  const title = data?.property.formatted?.split(",")[0] ?? "Untitled parcel";
  const neighbors = data?.property.neighbors ?? [];
  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `Neighbors · ${title} · Myplace`;
    return () => { document.title = previous; };
  }, [data, title]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data || !id) return <PageSpinner label="Loading record" />;
  if (neighbors.length === 0) return <Navigate to={`/property/${id}`} replace />;

  return (
    <div className="page property-page neighbors-page">
      <Link className="back-link" to={`/property/${id}`}>‹ {title}</Link>
      <div className="section-head">
        <h1>Neighbors</h1>
      </div>
      <NeighborsGrid neighbors={neighbors} />
    </div>
  );
}

/** The story, written in a sheet. */
function AboutForm({ fact, propertyId, onSaved, onCancel }: { fact: Fact; propertyId: string; onSaved: (message: string) => Promise<void> | void; onCancel: () => void }) {
  const text = typeof fact.value === "string" ? fact.value : "";
  const [draft, setDraft] = useState(text);
  const [visibility, setVisibility] = useState<FieldVisibility>(fact.visibility ?? "public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveOwnerFields(propertyId, { [SUMMARY_KEY]: next }, visibility);
      await onSaved(result.updated ? "About this place saved." : "About this place cleared.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <form className="sheet-form about-editor" onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
      <textarea
        className="field"
        rows={9}
        autoFocus
        value={draft}
        placeholder="When it was built and by whom, what's changed, the thing a neighbor would point out. Written for whoever cares about this place next."
        onChange={(event) => setDraft(event.target.value)}
        data-testid="about-input"
      />
      <VisibilityChoice value={visibility} onChange={setVisibility} />
      {error && <p className="error">{error}</p>}
      {text && (
        <div className="form-danger">
          <button type="button" className="text-link danger" disabled={busy} onClick={() => void save("")}>Clear the story</button>
        </div>
      )}
      <div className="action-row compact sheet-actions">
        <button type="submit" className="btn" disabled={busy || !draft.trim()} data-testid="about-save">{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function VisibilityChoice({ value, onChange }: { value: FieldVisibility; onChange: (next: FieldVisibility) => void }) {
  return (
    <label className="stack inline-choice">
      <span>Visibility</span>
      <div className="segmented">
        <button type="button" className={value === "public" ? "on" : ""} onClick={() => onChange("public")}>Public</button>
        <button type="button" className={value === "private" ? "on" : ""} onClick={() => onChange("private")}>Private</button>
      </div>
    </label>
  );
}

/** Visibility on the left, Edit on the right — same bar on about, rooms, topics, and improvements. */
function CardFoot({
  visibility,
  onVisibility,
  onEdit,
  editTestId,
}: {
  visibility: string;
  onVisibility: (next: "public" | "private") => void | Promise<void>;
  onEdit: () => void;
  editTestId?: string;
}) {
  return (
    <div className="improvement-foot">
      <VisibilityToggle
        value={visibility === "private" ? "private" : "public"}
        labeled
        onChange={(next) => void onVisibility(next)}
      />
      <button type="button" className="text-link" data-testid={editTestId} onClick={onEdit}>Edit</button>
    </div>
  );
}

/** Amount paid, plus an independent toggle for showing it on the public page. Off = private. */
function PriceField({
  cost,
  onCost,
  showPublic,
  onShowPublic,
}: {
  cost: string;
  onCost: (next: string) => void;
  showPublic: boolean;
  onShowPublic: (next: boolean) => void;
}) {
  return (
    <div className="stack span-2 price-field">
      <span>Amount paid</span>
      <div className="price-wrap">
        <input className="field" inputMode="decimal" placeholder="$" value={cost} onChange={(event) => onCost(event.target.value)} data-testid="price-input" />
        <VisibilityToggle
          value={showPublic ? "public" : "private"}
          labeled
          labelFirst
          onChange={(next) => onShowPublic(next === "public")}
          testId="price-public"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topics: the owner's half, one card and one sheet per subject
// ---------------------------------------------------------------------------

function topicImages(documents: Doc[], topicId: string): Doc[] {
  return documents.filter((doc) => doc.topic_id === topicId && isImage(doc));
}

function TopicSection({
  id,
  title,
  description,
  topics,
  facts,
  documents,
  owner,
  onOpen,
  propertyId,
  onChange,
  toast,
}: {
  id: string;
  title: string;
  description: string;
  topics: Topic[];
  facts: Fact[];
  documents: Doc[];
  owner: boolean;
  onOpen: (topic: Topic) => void;
  propertyId: string;
  onChange: PageRefresh;
  toast: Toast;
}) {
  if (topics.length === 0) return null;
  return (
    <section className="section" id={id}>
      <h2>{title}</h2>
      <p className="meta-line section-note">{description}</p>
      <div className="topic-list">
        {topics.map((topic) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            facts={facts}
            images={topicImages(documents, topic.id)}
            owner={owner}
            onOpen={() => onOpen(topic)}
            propertyId={propertyId}
            onChange={onChange}
            toast={toast}
          />
        ))}
      </div>
    </section>
  );
}

function TopicCard({
  topic,
  facts,
  images,
  owner,
  onOpen,
  propertyId,
  onChange,
  toast,
}: {
  topic: Topic;
  facts: Fact[];
  images: Doc[];
  owner: boolean;
  onOpen: () => void;
  propertyId: string;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const filled = filledTopicFacts(topic, facts);
  const allPrivate = filled.length > 0 && filled.every(({ fact }) => fact.visibility === "private");
  const [busy, setBusy] = useState(false);
  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        await api.upload(propertyId, file, { topicId: topic.id, visibility: allPrivate ? "private" : "public" });
      }
      toast(`${list.length} photo${list.length === 1 ? "" : "s"} added.`);
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  if (filled.length === 0 && images.length === 0) {
    if (!owner) return null;
    return (
      <button type="button" className="group topic-card topic-empty" onClick={onOpen} data-testid={`topic-${topic.id}`}>
        <span className="topic-empty-title">{topic.cta}</span>
        <span className="meta-line">{topic.lede}</span>
      </button>
    );
  }
  return (
    <article className={`group topic-card${allPrivate ? " is-private" : ""}`} data-testid={`topic-${topic.id}`}>
      <header className="topic-head">
        <h3>{topic.title}</h3>
      </header>
      {filled.length > 0 && (
        <dl className="topic-rows">
          {filled.map(({ field, fact }) => (
            <div key={fact.fieldKey} className="topic-row" data-field={fact.fieldKey}>
              <dt>{field.label ?? fact.label}</dt>
              <dd><TopicValue field={field} fact={fact} facts={facts} /></dd>
            </div>
          ))}
        </dl>
      )}
      {(images.length > 0 || owner) && (
        <ImprovementPhotos
          images={images}
          owner={owner}
          onChange={onChange}
          toast={toast}
          trailing={owner ? (
            <label className={`photo-thumb photo-add file-btn ${busy ? "is-busy" : ""}`}>
              <span className="photo-add-plus" aria-hidden="true">+</span>
              <span className="photo-add-label">{busy ? "Uploading…" : "Add photos"}</span>
              <input
                type="file"
                multiple
                accept="image/*,.heic"
                disabled={busy}
                aria-label={`Add photos to ${topic.title}`}
                onChange={(event) => { void attach(event.target.files); event.target.value = ""; }}
              />
            </label>
          ) : null}
        />
      )}
      {owner && (
        <CardFoot
          visibility={allPrivate ? "private" : "public"}
          onVisibility={async (next) => {
            const keys = filled
              .filter(({ fact }) => ownerCanWrite(fact) && fact.visibility !== next)
              .map(({ fact }) => fact.fieldKey);
            if (keys.length === 0) return;
            for (const key of keys) await api.setFieldVisibility(propertyId, key, next);
            await onChange((page) => ({
              ...page,
              facts: page.facts.map((fact) => keys.includes(fact.fieldKey) ? { ...fact, visibility: next } : fact),
            }));
          }}
          onEdit={onOpen}
          editTestId={`edit-topic-${topic.id}`}
        />
      )}
    </article>
  );
}

function TopicValue({ field, fact, facts }: { field: TopicField; fact: Fact; facts: Fact[] }) {
  if (field.kind === "link" && typeof fact.value === "string") {
    return <a href={fact.value} target="_blank" rel="noopener noreferrer" className="topic-link">{linkLabel(fact.value)}</a>;
  }
  if (field.kind === "date" && typeof fact.value === "string") {
    return <>{dateLabel(fact.value) ?? fact.display}</>;
  }
  const { text, swatch } = splitSwatch(fact.fieldKey, fact.display, factHex(fact.fieldKey, facts));
  return (
    <>
      {swatch && <i className="swatch" style={{ background: swatch }} aria-hidden="true" />}
      {text}
    </>
  );
}

function roomTitle(room: Room): string {
  return ROOM_KIND_LABEL[room.kind] || "Room";
}

function roomDisplayRows(room: Room): Array<{ field: RoomField; value: string; swatch: string | null }> {
  const details = room.details ?? {};
  return fieldsForRoom(room.kind).flatMap((field) => {
    if (field.kind === "hex") return [];
    const swatch = field.key === "paint" ? parseHex(details.paint_hex) : null;
    // A swatch with no color name still earns a row; the hex stands in for the name.
    const value = details[field.key]?.trim() || (swatch ?? "");
    if (!value) return [];
    return [{ field, value, swatch }];
  });
}

function RoomsSection({
  rooms,
  owner,
  propertyId,
  formOpen,
  setFormOpen,
  onChange,
  toast,
}: {
  rooms: Room[];
  owner: boolean;
  propertyId: string;
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
  onChange: PageRefresh;
  toast: Toast;
}) {
  // A fresh form each time the sheet opens; the sheet itself stays mounted to animate out.
  const [formSeq, setFormSeq] = useState(0);
  useEffect(() => { if (formOpen) setFormSeq((n) => n + 1); }, [formOpen]);
  const closeForm = useCallback(() => setFormOpen(false), [setFormOpen]);
  return (
    <section className="section" id="rooms">
      <div className="section-head">
        <h2>Rooms</h2>
        {owner && (
          <button type="button" className="text-btn accent" data-testid="add-room" onClick={() => setFormOpen(true)}>Add room</button>
        )}
      </div>
      <p className="meta-line section-note">
        {owner
          ? "Kitchen, baths, bedrooms. Pick a room and fill in the finishes. Public unless you mark it private."
          : "Rooms the owner has described, with the finishes people ask about."}
      </p>
      {owner && (
        <Sheet
          open={formOpen}
          title="Add a room"
          lede="Choose the room first. The fields below follow from that."
          onClose={closeForm}
          testId="room-sheet"
        >
          <RoomForm
            key={formSeq}
            propertyId={propertyId}
            onCancel={closeForm}
            onSaved={async (count, room) => {
              setFormOpen(false);
              toast(count ? `Room added with ${count} photo${count === 1 ? "" : "s"}.` : "Room added.");
              await onChange(room ? (page) => ({
                ...page,
                rooms: [...(page.rooms ?? []).filter((row) => row.room_id !== room.room_id), room],
              }) : undefined);
            }}
          />
        </Sheet>
      )}
      {rooms.length === 0 && (
        <div className="group empty-card">
          {owner ? "Nothing listed yet. Start with the kitchen, a bath, the room people ask about." : "The owner hasn't shared any rooms yet."}
        </div>
      )}
      <div className="topic-list">
        {rooms.map((room) => (
          <RoomCard key={room.room_id} room={room} owner={owner} propertyId={propertyId} onChange={onChange} toast={toast} />
        ))}
      </div>
    </section>
  );
}

function RoomCard({
  room,
  owner,
  propertyId,
  onChange,
  toast,
}: {
  room: Room;
  owner: boolean;
  propertyId: string;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const editor = useSheet();
  const [busy, setBusy] = useState(false);
  const rows = roomDisplayRows(room);
  const paidCents = roomPaidCents(room.details);
  const paidLabel = paidCents !== null && (owner || roomPaidPublic(room.details)) ? money(paidCents) : null;
  const images = room.documents.filter(isImage);
  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        await api.upload(propertyId, file, { roomId: room.room_id, visibility: room.visibility === "private" ? "private" : "public" });
      }
      toast(`${list.length} photo${list.length === 1 ? "" : "s"} added.`);
      await onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`group topic-card${room.visibility === "private" ? " is-private" : ""}`} data-testid={`room-${room.room_id}`}>
      {owner && (
        <Sheet
          open={editor.open}
          title={roomTitle(room)}
          lede="Change the room and the fields follow. Photos stay with it."
          onClose={editor.hide}
          testId="room-sheet"
        >
          <RoomForm
            key={editor.seq}
            propertyId={propertyId}
            item={room}
            onCancel={editor.hide}
            onSaved={async (count, saved) => {
              editor.hide();
              toast(count ? `Room updated with ${count} new photo${count === 1 ? "" : "s"}.` : "Room updated.");
              await onChange(saved ? (page) => ({
                ...page,
                rooms: (page.rooms ?? []).map((row) => row.room_id === saved.room_id ? saved : row),
              }) : undefined);
            }}
            onDeleted={async () => {
              editor.hide();
              toast("Room removed.");
              await onChange((page) => ({
                ...page,
                rooms: (page.rooms ?? []).filter((row) => row.room_id !== room.room_id),
              }));
            }}
          />
        </Sheet>
      )}
      <header className="topic-head">
        <h3>{roomTitle(room)}</h3>
      </header>
      {room.description?.trim() && <p className="topic-card-lede">{room.description.trim()}</p>}
      {(rows.length > 0 || paidLabel) && (
        <dl className="topic-rows">
          {rows.map(({ field, value, swatch }) => (
            <div key={field.key} className="topic-row">
              <dt>{field.label}</dt>
              <dd>
                {field.kind === "link" ? (
                  <a href={value} target="_blank" rel="noopener noreferrer" className="topic-link">{linkLabel(value)}</a>
                ) : (
                  <>
                    {swatch && <i className="swatch" style={{ background: swatch }} aria-hidden="true" />}
                    {value}
                  </>
                )}
              </dd>
            </div>
          ))}
          {paidLabel && (
            <div className="topic-row">
              <dt>Amount paid</dt>
              <dd>{paidLabel}{owner && !roomPaidPublic(room.details) ? <em className="badge private">private</em> : null}</dd>
            </div>
          )}
        </dl>
      )}
      {(images.length > 0 || owner) && (
        <ImprovementPhotos
          images={images}
          owner={owner}
          onChange={onChange}
          toast={toast}
          trailing={owner ? (
            <label className={`photo-thumb photo-add file-btn ${busy ? "is-busy" : ""}`}>
              <span className="photo-add-plus" aria-hidden="true">+</span>
              <span className="photo-add-label">{busy ? "Uploading…" : "Add photos"}</span>
              <input
                type="file"
                multiple
                accept="image/*,.heic"
                disabled={busy}
                aria-label="Add room photos"
                onChange={(event) => { void attach(event.target.files); event.target.value = ""; }}
              />
            </label>
          ) : null}
        />
      )}
      {owner && (
        <CardFoot
          visibility={room.visibility}
          onVisibility={async (next) => {
            if (room.visibility === next) return;
            await api.patchRoom(room.room_id, { visibility: next });
            await onChange((page) => ({
              ...page,
              rooms: (page.rooms ?? []).map((row) => row.room_id === room.room_id ? { ...row, visibility: next } : row),
            }));
          }}
          onEdit={editor.show}
          editTestId={`edit-room-${room.room_id}`}
        />
      )}
    </article>
  );
}

function RoomForm({
  propertyId,
  item,
  onCancel,
  onSaved,
  onDeleted,
}: {
  propertyId: string;
  item?: Room;
  onCancel: () => void;
  onSaved: (attachments: number, room?: Room) => Promise<void> | void;
  onDeleted?: () => Promise<void> | void;
}) {
  const [kind, setKind] = useState(item?.kind ?? "kitchen");
  const [description, setDescription] = useState(item?.description ?? "");
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(item?.details ?? {}) }));
  const [visibility, setVisibility] = useState(item?.visibility ?? "public");
  const [cost, setCost] = useState(costInputValue(roomPaidCents(item?.details)));
  const [costPublic, setCostPublic] = useState(roomPaidPublic(item?.details));
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fields = fieldsForRoom(kind);
  const editing = Boolean(item);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const details: Record<string, string> = {};
      for (const field of fields) {
        const raw = (values[field.key] ?? "").trim();
        if (!raw) continue;
        if (field.kind === "link") {
          const url = normalizeLink(raw);
          if (!url) throw new Error(`${field.label} needs to be a web address.`);
          details[field.key] = url;
          continue;
        }
        if (field.kind === "year") {
          const year = Number(raw);
          if (!/^\d{4}$/.test(raw) || year < 1600 || year > new Date().getFullYear() + 1) {
            throw new Error(`${field.label} should be a four-digit year.`);
          }
          details[field.key] = raw;
          continue;
        }
        if (field.kind === "hex") {
          const hex = parseHex(raw);
          if (!hex) throw new Error(`${field.label} should be a hex color, like #30474f.`);
          details[field.key] = hex;
          continue;
        }
        details[field.key] = raw;
      }
      if (cost.trim()) {
        const cents = parseFormCostCents(cost);
        if (cents === null) throw new Error("Amount paid should be a number.");
        details[ROOM_PAID_KEY] = String(cents);
        if (costPublic) details[ROOM_PAID_PUBLIC_KEY] = "1";
      }
      const payload = { kind, description: description.trim() || null, details, visibility };
      const saved = item
        ? (await api.patchRoom(item.room_id, payload)).room
        : (await api.createRoom(propertyId, payload)).room;
      for (const file of files) {
        await api.upload(propertyId, file, { roomId: saved.room_id, visibility: visibility === "private" ? "private" : "public" });
      }
      await onSaved(files.length, saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save room");
      setBusy(false);
    }
  };

  return (
    <form className="sheet-form" data-testid="room-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="form-grid">
        <label className="stack span-2">
          <span>Room</span>
          <select className="field" value={kind} onChange={(event) => setKind(event.target.value)} data-testid="room-kind">
            {ROOM_KINDS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label className="stack span-2">
          <span>Description <i>(optional)</i></span>
          <textarea
            className="field"
            rows={3}
            value={description}
            placeholder="The kitchen sits in the later addition off the garden."
            onChange={(event) => setDescription(event.target.value)}
            data-testid="room-description"
          />
        </label>
        {fields.map((field) => {
          const half = Boolean(field.half && field.kind !== "multiline");
          const value = values[field.key] ?? "";
          return (
            <label key={field.key} className={`stack${half ? "" : " span-2"}`}>
              <span>{field.label}</span>
              {field.kind === "multiline" ? (
                <textarea className="field" rows={3} value={value} placeholder={field.hint} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
              ) : (
                <input
                  className="field"
                  type="text"
                  inputMode={field.kind === "year" ? "decimal" : field.kind === "link" ? "url" : undefined}
                  autoComplete={field.kind === "link" ? "url" : "off"}
                  autoCapitalize={field.kind === "link" || field.kind === "hex" ? "off" : undefined}
                  spellCheck={field.kind === "hex" ? false : undefined}
                  value={value}
                  placeholder={field.hint}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              )}
            </label>
          );
        })}
        <label className="stack span-2">
          <span>Photos</span>
          <input className="field file" type="file" multiple accept="image/*,.heic" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} data-testid="room-files" />
          {editing && item && item.documents.length > 0 && (
            <small className="meta-line">{item.documents.length} already attached. New files are added to those.</small>
          )}
          {files.length > 0 && <small className="meta-line">{files.map((file) => file.name).join(", ")}</small>}
        </label>
        <PriceField cost={cost} onCost={setCost} showPublic={costPublic} onShowPublic={setCostPublic} />
      </div>
      <VisibilityChoice value={visibility as FieldVisibility} onChange={(next) => setVisibility(next)} />
      {error && <p className="error">{error}</p>}
      {editing && item && onDeleted && (
        <div className="form-danger">
          {confirmDelete ? (
            <span className="confirm-inline">
              Delete this room and its photos?
              <button
                type="button"
                className="text-link danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.deleteRoom(item.room_id);
                    await onDeleted();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not delete room");
                    setBusy(false);
                  }
                }}
              >Delete</button>
              <button type="button" className="text-link" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="text-link danger" disabled={busy} data-testid="room-delete" onClick={() => setConfirmDelete(true)}>Delete room</button>
          )}
        </div>
      )}
      <div className="action-row compact sheet-actions">
        <button type="submit" className="btn" disabled={busy} data-testid="room-save">{busy ? "Saving…" : editing ? "Save changes" : "Save room"}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Whichever sheet the page has asked for, with the form for it. */
function OwnerSheet({
  state,
  open,
  seq,
  facts,
  documents,
  propertyId,
  onClose,
  onChange,
  toast,
}: {
  state: SheetState;
  open: boolean;
  seq: number;
  facts: Fact[];
  documents: Doc[];
  propertyId: string;
  onClose: () => void;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const byKey = useMemo(() => new Map(facts.map((fact) => [fact.fieldKey, fact])), [facts]);
  const done = async (message: string | null) => {
    onClose();
    if (message) toast(message);
    await onChange();
  };
  if (!state) return null;

  if (state.kind === "about") {
    const fact = byKey.get(SUMMARY_KEY);
    return (
      <Sheet open={open} title="About this place" lede="The story of the house, in your words. Public unless you keep it private." onClose={onClose} testId="about-sheet">
        {fact && <AboutForm key={seq} fact={fact} propertyId={propertyId} onSaved={done} onCancel={onClose} />}
      </Sheet>
    );
  }

  if (state.kind === "dispute") {
    const fact = byKey.get(state.key);
    return (
      <Sheet open={open} title={`Dispute ${fact?.label.toLowerCase() ?? "this fact"}`} lede="The county's value stays put. Your dispute sits next to it and goes to review." onClose={onClose} testId="dispute-sheet">
        {fact && (
          <DisputeForm
            key={seq}
            fact={fact}
            propertyId={propertyId}
            onDone={() => done("Dispute recorded. It stays on the record until a reviewer resolves it.")}
            onCancel={onClose}
          />
        )}
      </Sheet>
    );
  }

  const topic = state.kind === "topic" ? TOPIC_BY_ID.get(state.id) : singleFieldTopic(byKey.get(state.key));
  if (!topic) return null;
  const filled = filledTopicFacts(topic, facts).length;
  return (
    <Sheet open={open} title={topic.title} lede={topic.lede} onClose={onClose} testId={`topic-sheet-${topic.id}`}>
      <TopicForm
        key={`${topic.id}:${seq}`}
        topic={topic}
        facts={facts}
        images={topicImages(documents, topic.id)}
        propertyId={propertyId}
        onSaved={(changed) => done(changed ? `${topic.title} saved.` : null)}
        onCancel={onClose}
        submitLabel={filled ? "Save changes" : "Save"}
      />
    </Sheet>
  );
}

/** A one-field sheet for anything outside a topic: filling a blank the county left. */
function singleFieldTopic(fact: Fact | undefined): Topic | null {
  if (!fact) return null;
  // Leave kind open for county fields so the vocabulary's value type decides the input.
  const kind: TopicFieldKind | undefined = fact.fieldKey === "year_built"
    ? "year"
    : MULTILINE_FIELDS.has(fact.fieldKey)
      ? "multiline"
      : undefined;
  const official = fact.layer !== "owner";
  return {
    id: `field-${fact.fieldKey}`,
    section: "location",
    title: fact.label,
    lede: official
      ? "The county has no value here. Yours is labeled owner-reported until an official source shows up."
      : "Public unless you mark it private.",
    cta: `Add ${fact.label.toLowerCase()}`,
    fields: [{ key: fact.fieldKey, kind, hint: FIELD_HINTS[fact.fieldKey] }],
  };
}

function inputKind(field: TopicField, valueType: string | undefined): TopicFieldKind {
  if (field.kind) return field.kind;
  if (valueType === "date") return "date";
  if (valueType === "number" || valueType === "money" || valueType === "acres" || valueType === "area") return "number";
  return "text";
}

function initialInput(fact: Fact, kind: TopicFieldKind): string {
  const ownerAssertion = fact.assertions.find((assertion) => assertion.sourceType === "verified_owner");
  const raw = ownerAssertion?.value ?? (fact.layer === "owner" || fact.status === "owner_reported" ? fact.value : null);
  if (raw === null || raw === undefined) return "";
  if (kind === "date") return dateInputValue(String(raw));
  return String(raw);
}

/**
 * The form inside a topic sheet: every field in the topic, saved together.
 * Only fields that changed are written, so untouched values keep their
 * history; the visibility choice applies to the whole topic.
 */
function TopicForm({
  topic,
  facts,
  images,
  propertyId,
  onSaved,
  onCancel,
  submitLabel = "Save",
}: {
  topic: Topic;
  facts: Fact[];
  images: Doc[];
  propertyId: string;
  onSaved: (changed: boolean) => Promise<void> | void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const meta = useMeta();
  const rows = useMemo(() => topicFacts(topic, facts).map(({ field, fact }) => {
    const def = meta?.vocab.find((entry) => entry.key === fact.fieldKey);
    const kind = inputKind(field, def?.valueType);
    return { field, fact, kind, writable: ownerCanWrite(fact), initial: initialInput(fact, kind), unit: def?.unit };
  }), [topic, facts, meta]);
  const filledRows = rows.filter(({ fact }) => fact.status !== "unknown" && fact.display);
  const initialVisibility: FieldVisibility = filledRows.length > 0 && filledRows.every(({ fact }) => fact.visibility === "private") ? "private" : "public";

  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((row) => [row.fact.fieldKey, row.initial])));
  const [visibility, setVisibility] = useState<FieldVisibility>(initialVisibility);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstWritable = rows.find((row) => row.writable)?.fact.fieldKey;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const row of rows) {
        if (!row.writable) continue;
        const next = (values[row.fact.fieldKey] ?? "").trim();
        if (next === row.initial.trim()) continue;
        if (!next) {
          payload[row.fact.fieldKey] = "";
          continue;
        }
        if (row.kind === "link") {
          const url = normalizeLink(next);
          if (!url) throw new Error(`${row.field.label ?? row.fact.label} needs to be a web address, like hudsonpaint.com.`);
          payload[row.fact.fieldKey] = url;
          continue;
        }
        if (row.kind === "year") {
          const year = Number(next);
          if (!/^\d{4}$/.test(next) || year < 1600 || year > new Date().getFullYear() + 1) {
            throw new Error(`${row.field.label ?? row.fact.label} should be a four-digit year.`);
          }
          payload[row.fact.fieldKey] = year;
          continue;
        }
        if (row.kind === "hex") {
          const hex = parseHex(next);
          if (!hex) throw new Error(`${row.field.label ?? row.fact.label} should be a hex color, like #30474f.`);
          payload[row.fact.fieldKey] = hex;
          continue;
        }
        payload[row.fact.fieldKey] = next;
      }
      const changedKeys = Object.keys(payload);
      const visibilityChanged = visibility !== initialVisibility;
      if (changedKeys.length) await api.saveOwnerFields(propertyId, payload, visibility);
      if (visibilityChanged) {
        for (const row of filledRows) {
          if (!row.writable || changedKeys.includes(row.fact.fieldKey)) continue;
          await api.setFieldVisibility(propertyId, row.fact.fieldKey, visibility);
        }
      }
      if (isTopicId(topic.id)) {
        for (const file of files) {
          await api.upload(propertyId, file, { topicId: topic.id, visibility });
        }
      }
      await onSaved(changedKeys.length > 0 || visibilityChanged || files.length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <form className="sheet-form" data-testid="topic-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="form-grid">
        {rows.map(({ field, fact, kind, writable, unit }) => {
          const label = field.label ?? fact.label;
          const half = field.half && kind !== "multiline";
          if (!writable) {
            return (
              <div key={fact.fieldKey} className={`stack topic-readonly${half ? "" : " span-2"}`}>
                <span>{label}</span>
                <strong>{fact.display ?? "—"}</strong>
                <small className="meta-line">County record. Dispute it from the page if it's wrong.</small>
              </div>
            );
          }
          const value = values[fact.fieldKey] ?? "";
          const set = (next: string) => setValues((current) => ({ ...current, [fact.fieldKey]: next }));
          const placeholder = field.hint ?? FIELD_HINTS[fact.fieldKey] ?? (unit ? `In ${unit}` : undefined);
          return (
            <label key={fact.fieldKey} className={`stack${half ? "" : " span-2"}`}>
              <span>{label}</span>
              {kind === "multiline" ? (
                <textarea className="field" rows={3} value={value} placeholder={placeholder} autoFocus={fact.fieldKey === firstWritable} onChange={(event) => set(event.target.value)} data-testid={`input-${fact.fieldKey}`} />
              ) : (
                <input
                  className="field"
                  type={kind === "date" ? "date" : "text"}
                  inputMode={kind === "year" || kind === "number" ? "decimal" : kind === "link" ? "url" : undefined}
                  autoComplete={kind === "link" ? "url" : "off"}
                  autoCapitalize={kind === "link" || kind === "hex" ? "off" : undefined}
                  spellCheck={kind === "hex" ? false : undefined}
                  value={value}
                  placeholder={placeholder}
                  autoFocus={fact.fieldKey === firstWritable}
                  onChange={(event) => set(event.target.value)}
                  data-testid={`input-${fact.fieldKey}`}
                />
              )}
            </label>
          );
        })}
        {isTopicId(topic.id) && (
          <label className="stack span-2">
            <span>Photos</span>
            <input className="field file" type="file" multiple accept="image/*,.heic" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} data-testid="topic-files" />
            {images.length > 0 && (
              <small className="meta-line">{images.length} already attached. New files are added to those.</small>
            )}
            {files.length > 0 && <small className="meta-line">{files.map((file) => file.name).join(", ")}</small>}
          </label>
        )}
      </div>
      <VisibilityChoice value={visibility} onChange={setVisibility} />
      {error && <p className="error">{error}</p>}
      <div className="action-row compact sheet-actions">
        <button type="submit" className="btn" disabled={busy} data-testid="topic-save">{busy ? "Saving…" : submitLabel}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
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
  onEdit,
  onDispute,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  facts: Fact[];
  owner: boolean;
  propertyId: string;
  onChange: PageRefresh;
  toast: Toast;
  before?: React.ReactNode;
  onEdit?: (fact: Fact) => void;
  onDispute?: (fact: Fact) => void;
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
            <FactRow
              key={fact.fieldKey}
              fact={fact}
              owner={owner}
              propertyId={propertyId}
              onChange={onChange}
              toast={toast}
              onEdit={onEdit ? () => onEdit(fact) : undefined}
              onDispute={onDispute ? () => onDispute(fact) : undefined}
            />
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
  onEdit,
  onDispute,
}: {
  fact: Fact;
  owner?: boolean;
  propertyId?: string;
  onChange?: () => Promise<void> | void;
  toast?: Toast;
  /** Opens the sheet that edits this fact. Without it the row is read-only. */
  onEdit?: () => void;
  /** Opens the dispute sheet for an official value. */
  onDispute?: () => void;
}) {
  const [visBusy, setVisBusy] = useState(false);
  const editable = Boolean(owner && propertyId && onEdit && ownerCanWrite(fact));
  const disputable = Boolean(owner && propertyId && onDispute && !ownerCanWrite(fact) && fact.status !== "unknown");
  const ownerAssertion = fact.assertions.find((assertion) => assertion.sourceType === "verified_owner");
  const showBadge = fact.status !== "available" && !(fact.status === "unknown" && editable);
  const canToggle = editable && ownerAssertion && fact.visibility;
  const { text, swatch } = splitSwatch(fact.fieldKey, fact.display);

  return (
    <div className={`fact ${editable ? "is-editable" : ""} ${fact.dispute ? "is-disputed" : ""} ${fact.visibility === "private" ? "is-private" : ""}`} data-field={fact.fieldKey}>
      <div className="fact-label">{fact.label}</div>
      <div className="fact-value">
        {editable && fact.status === "unknown" ? (
          <button type="button" className="add-value" data-testid={`add-${fact.fieldKey}`} onClick={onEdit}>
            Add {fact.label.toLowerCase()}
          </button>
        ) : (
          <>
            <strong>
              {swatch && <i className="swatch" style={{ background: swatch }} aria-hidden="true" />}
              {fact.display ? text : "—"}
            </strong>
            {showBadge && <span className={`badge ${fact.status}`}>{STATUS_LABEL[fact.status]}</span>}
            {fact.dispute && <span className="badge disputed">disputed by owner</span>}
            {editable && (
              <button type="button" className="inline-edit" data-testid={`edit-${fact.fieldKey}`} onClick={onEdit}>Edit</button>
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
          {disputable && !fact.dispute && (
            <button type="button" className="text-link" onClick={onDispute}>Dispute this fact</button>
          )}
        </div>
      </div>
    </div>
  );
}

function DisputeForm({ fact, propertyId, onDone, onCancel }: { fact: Fact; propertyId: string; onDone: () => Promise<void> | void; onCancel: () => void }) {
  const [proposed, setProposed] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const source = fact.assertions.find((assertion) => assertion.sourceType !== "verified_owner");
  return (
    <form className="sheet-form" data-testid="dispute-form" onSubmit={async (event) => {
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
      <div className="stack topic-readonly span-2">
        <span>County says</span>
        <strong>{fact.display ?? "—"}</strong>
        {source && <small className="meta-line">{source.sourceName}{source.effectiveAt ? ` · ${new Date(source.effectiveAt).getFullYear()}` : ""}</small>}
      </div>
      <label className="stack">
        <span>What you believe it is</span>
        <input className="field" autoFocus placeholder={fact.display ? `Instead of ${fact.display}` : undefined} value={proposed} onChange={(event) => setProposed(event.target.value)} data-testid="dispute-value" />
      </label>
      <label className="stack">
        <span>Why, or what you have to show for it</span>
        <textarea className="field" rows={3} placeholder="The lintel says 1850. The survey in the vault shows 2.1 acres." value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="action-row compact sheet-actions">
        <button type="submit" className="btn" disabled={busy || (!proposed.trim() && !note.trim())} data-testid="dispute-save">{busy ? "Recording…" : "Record dispute"}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
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
  rooms = [],
  cover,
  onGo,
}: {
  facts: Fact[];
  documents: Doc[];
  improvements: Improvement[];
  rooms?: Room[];
  cover: Doc | null;
  onGo: (target: string) => void;
}) {
  const has = (key: string) => facts.some((fact) => fact.fieldKey === key && fact.status !== "unknown");
  const doc = (type: string) => documents.some((item) => item.document_type === type) || improvements.some((item) => item.documents.some((d) => d.document_type === type));
  const items: Array<{ label: string; ok: boolean; target: string; cta?: string }> = [
    { label: "Cover photo", ok: Boolean(cover), target: "photos" },
    { label: "Exterior paint", ok: has("exterior.color"), target: "field:exterior.color", cta: "Name the paint" },
    { label: "Style", ok: has("style.architecture"), target: "field:style.architecture", cta: "Name the style" },
    { label: "Trim color", ok: has("exterior.trim"), target: "field:exterior.trim", cta: "Name the trim" },
    { label: "The story", ok: has(SUMMARY_KEY), target: "about", cta: "Tell the story" },
    { label: "Photos", ok: documents.some(isImage), target: "photos" },
    { label: "A room", ok: rooms.length > 0, target: "rooms", cta: "Add a room" },
    { label: "Still original", ok: has("original_details"), target: "field:original_details", cta: "List what's original" },
    { label: "Work done", ok: improvements.length > 0, target: "improvements", cta: "Log the last big job" },
    { label: "Roof", ok: has("roof.type") || has("roof.year") || improvements.some((item) => item.category === "roof"), target: "field:roof.type" },
    { label: "Heating", ok: has("heating") || improvements.some((item) => item.category === "hvac"), target: "field:heating" },
    { label: "Cooling", ok: has("cooling"), target: "field:cooling" },
    { label: "Water heater", ok: has("water_heater"), target: "field:water_heater" },
    { label: "Electrical", ok: has("electrical") || improvements.some((item) => item.category === "electrical"), target: "field:electrical" },
    { label: "Septic / well", ok: has("septic_or_well") || improvements.some((item) => item.category === "septic_well"), target: "field:septic_or_well" },
    { label: "Utilities", ok: has("utility.electric") && has("utility.water") && has("utility.sewer"), target: "field:utility.electric" },
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
            <div className="kicker">{complete ? "Page complete" : "Your page so far"}</div>
            <strong>{done} of {items.length} filled in</strong>
          </div>
          {next && (
            <button type="button" className="btn small" onClick={() => onGo(next.target)}>
              {next.cta ?? `Add ${next.label.toLowerCase()}`}
            </button>
          )}
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
          <i style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
        <p className="meta-line">How much of the page is filled in, not the condition of the house. Paint, photos, work and systems are public unless you mark them private; the vault is private by default.</p>
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
  onChange: PageRefresh;
  toast: Toast;
}) {
  const total = improvements.reduce((sum, item) => sum + (item.cost_cents ?? 0), 0);
  // A fresh form each time the sheet opens; the sheet itself stays mounted to animate out.
  const [formSeq, setFormSeq] = useState(0);
  useEffect(() => { if (formOpen) setFormSeq((n) => n + 1); }, [formOpen]);
  const closeForm = useCallback(() => setFormOpen(false), [setFormOpen]);
  return (
    <section className="section" id="improvements">
      <div className="section-head">
        <h2>Improvements</h2>
        {owner && (
          <button type="button" className="text-btn accent" data-testid="add-improvement" onClick={() => setFormOpen(true)}>Add improvement</button>
        )}
      </div>
      <p className="meta-line section-note">
        {owner
          ? "What was done, who did it, what it cost, and what it looks like now. Photos follow the improvement's visibility; receipts stay private and travel with the house at closing unless you keep them."
          : "Work the owner has chosen to share, with the people who did it."}
        {owner && total > 0 ? ` Logged so far: ${money(total)}.` : ""}
      </p>
      {owner && (
        <Sheet
          open={formOpen}
          title="Add improvement"
          lede="What was done, who did it, what it cost. Photos and receipts can ride along."
          onClose={closeForm}
          testId="improvement-dialog"
        >
          <ImprovementForm
            key={formSeq}
            propertyId={propertyId}
            categories={categories}
            onCancel={closeForm}
            onSaved={async (count, improvement) => {
              setFormOpen(false);
              toast(count ? `Improvement recorded with ${count} attachment${count === 1 ? "" : "s"}.` : "Improvement recorded.");
              await onChange(improvement ? (page) => ({
                ...page,
                improvements: [improvement, ...page.improvements.filter((row) => row.improvement_id !== improvement.improvement_id)],
              }) : undefined);
            }}
          />
        </Sheet>
      )}
      {improvements.length === 0 && (
        <div className="group empty-card">
          {owner ? "Nothing logged yet. Start with the last big job: the roof, the kitchen, the guy who did the stairs." : "The owner hasn't shared any work yet."}
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

function dateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function costInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return String(cents / 100);
}

function parseFormCostCents(value: string): number | null {
  const text = value.replace(/[$,\s]/g, "");
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function ImprovementForm({
  propertyId,
  categories,
  item,
  onCancel,
  onSaved,
  onDeleted,
}: {
  propertyId: string;
  categories: string[];
  item?: Improvement;
  onCancel: () => void;
  onSaved: (attachments: number, improvement?: Improvement) => Promise<void> | void;
  onDeleted?: () => Promise<void> | void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(item?.category ?? "roof");
  const [performedAt, setPerformedAt] = useState(dateInputValue(item?.performed_at));
  const [cost, setCost] = useState(costInputValue(item?.cost_cents));
  const [costPublic, setCostPublic] = useState(item?.cost_visibility === "public");
  const [contractor, setContractor] = useState(item?.contractor ?? "");
  const [scope, setScope] = useState(item?.scope ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [visibility, setVisibility] = useState(item?.visibility ?? "public");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = Boolean(item);

  return (
    <form className="improvement-form" data-testid="improvement-form" onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const payload = { title, category, performedAt: performedAt || null, cost: cost || null, costVisibility: costPublic ? "public" : "private", contractor: contractor || null, scope: scope || null, notes: notes || null, visibility };
        const saved = item
          ? (await api.patchImprovement(item.improvement_id, payload)).improvement
          : (await api.createImprovement(propertyId, payload)).improvement;
        for (const file of files) {
          await api.upload(propertyId, file, { improvementId: saved.improvement_id, visibility: attachmentVisibility(file, visibility) });
        }
        await onSaved(files.length, saved);
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
        <label className="stack span-2">
          <span>Who did it</span>
          <input className="field" value={contractor} placeholder="Contractor, company, or you" onChange={(event) => setContractor(event.target.value)} />
        </label>
        <label className="stack span-2">
          <span>Scope of work</span>
          <textarea className="field" rows={2} value={scope} placeholder="Full tear-off, ice-and-water, standing seam from ridge to gutter" onChange={(event) => setScope(event.target.value)} />
        </label>
        <label className="stack span-2">
          <span>Materials & finishes</span>
          <textarea className="field" rows={2} value={notes} placeholder="Paint colors, materials, where they came from, the warranty" onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label className="stack span-2">
          <span>Photos and receipts</span>
          <input className="field file" type="file" multiple accept="image/*,application/pdf,.heic" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} data-testid="improvement-files" />
          {editing && item && item.documents.length > 0 && (
            <small className="meta-line">{item.documents.length} already attached. New files are added to those.</small>
          )}
          {files.length > 0 && <small className="meta-line">{files.map((file) => file.name).join(", ")}</small>}
        </label>
        <PriceField cost={cost} onCost={setCost} showPublic={costPublic} onShowPublic={setCostPublic} />
        <div className="span-2">
          <VisibilityChoice value={visibility as FieldVisibility} onChange={(next) => setVisibility(next)} />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {editing && item && onDeleted && (
        <div className="form-danger">
          {confirmDelete ? (
            <span className="confirm-inline">
              Delete this improvement and its attachments?
              <button
                type="button"
                className="text-link danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.deleteImprovement(item.improvement_id);
                    await onDeleted();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not delete improvement");
                    setBusy(false);
                  }
                }}
              >Delete</button>
              <button type="button" className="text-link" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="text-link danger" disabled={busy} data-testid="improvement-delete" onClick={() => setConfirmDelete(true)}>Delete improvement</button>
          )}
        </div>
      )}
      <div className="action-row compact sheet-actions">
        <button type="submit" className="btn" disabled={busy || !title.trim()} data-testid="improvement-save">{busy ? "Saving…" : editing ? "Save changes" : "Save improvement"}</button>
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
  onChange: PageRefresh;
  toast: Toast;
}) {
  const [busy, setBusy] = useState(false);
  const editor = useSheet();
  const images = item.documents.filter(isImage);
  const files = item.documents.filter((doc) => !isImage(doc));
  const costLabel = (owner || item.cost_visibility === "public") ? money(item.cost_cents) : null;
  const meta = [
    { key: "date", value: dateLabel(item.performed_at) },
    { key: "cost", value: costLabel, private: Boolean(owner && costLabel && item.cost_visibility !== "public") },
    { key: "contractor", value: item.contractor },
  ].filter((entry): entry is { key: string; value: string; private?: boolean } => Boolean(entry.value));

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
      {owner && (
        <Sheet open={editor.open} title="Edit improvement" onClose={editor.hide} testId="improvement-dialog">
          <ImprovementForm
            key={editor.seq}
            propertyId={propertyId}
            categories={categories}
            item={item}
            onCancel={editor.hide}
            onSaved={async (count, improvement) => {
              editor.hide();
              toast(count ? `Improvement updated with ${count} new attachment${count === 1 ? "" : "s"}.` : "Improvement updated.");
              await onChange(improvement ? (page) => ({
                ...page,
                improvements: page.improvements.map((row) => row.improvement_id === improvement.improvement_id ? { ...row, ...improvement } : row),
              }) : undefined);
            }}
            onDeleted={async () => {
              editor.hide();
              toast("Improvement removed.");
              await onChange();
            }}
          />
        </Sheet>
      )}
      <header className="improvement-head">
        <span className="chip">{CATEGORY_LABEL[item.category] ?? item.category}</span>
        <h3>{item.title}</h3>
        {meta.length > 0 && (
          <ul className="improvement-meta">
            {meta.map((entry) => (
              <li key={entry.key} className={entry.key}>
                {entry.value}
                {entry.private ? <em className="badge private">private</em> : null}
              </li>
            ))}
          </ul>
        )}
      </header>
      {item.scope && <p className="improvement-notes">{item.scope}</p>}
      {item.notes && <p className="improvement-notes">{item.notes}</p>}
      {(images.length > 0 || owner) && (
        <ImprovementPhotos
          images={images}
          owner={owner}
          onChange={onChange}
          toast={toast}
          trailing={owner ? (
            <label className={`photo-thumb photo-add file-btn ${busy ? "is-busy" : ""}`} data-testid="improvement-add">
              <span className="photo-add-plus" aria-hidden="true">+</span>
              <span className="photo-add-label">{busy ? "Uploading…" : "Receipt or photo"}</span>
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,.heic"
                disabled={busy}
                aria-label="Add receipt or photo"
                onChange={(event) => { void attach(event.target.files); event.target.value = ""; }}
              />
            </label>
          ) : null}
        />
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
        <CardFoot
          visibility={item.visibility}
          onVisibility={async (next) => {
            if (item.visibility === next) return;
            await api.patchImprovement(item.improvement_id, { visibility: next });
            await onChange((page) => ({
              ...page,
              improvements: page.improvements.map((row) => row.improvement_id === item.improvement_id ? { ...row, visibility: next } : row),
            }));
          }}
          onEdit={editor.show}
          editTestId="improvement-edit"
        />
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
          if (!file) {
            event.target.value = "";
            return;
          }
          const copy = snapshotPhotoFile(file);
          event.target.value = "";
          void copy.then(onPick).catch((error) => {
            console.warn("photo restore failed", error);
          });
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
  onChange: PageRefresh;
  toast: (message: string) => void;
}) {
  const count = photos.length;
  const current = Math.max(0, Math.min(index, count - 1));
  const photo = photos[current];
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);

  // Swiping to another photo drops any pending delete confirmation.
  const settle = useCallback((next: number) => {
    onIndex(next);
    setConfirm(false);
  }, [onIndex]);

  const goTo = useSnapTrack({ trackRef, thumbRef, count, current, onIndex: settle });

  useLockPageScroll(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") goTo(current + 1);
      if (event.key === "ArrowLeft") goTo(current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, goTo, onClose]);

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
      if (count <= 1) onClose();
      else onIndex(Math.min(current, count - 2));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className="modal-backdrop lightbox" role="dialog" aria-modal="true" aria-label="Photo">
      <header className="lightbox-head">
        <div className="lightbox-tools">
          {owner && (confirm ? (
            <span className="lightbox-confirm">
              Delete this photo?
              <button type="button" className="text-link danger" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete"}</button>
              <button type="button" className="text-link" disabled={busy} onClick={() => setConfirm(false)}>Keep</button>
            </span>
          ) : (
            <>
              <label className={`text-link file-btn ${busy ? "is-busy" : ""}`}>
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
              <button type="button" className="text-link danger" disabled={busy} data-testid="photo-delete" onClick={() => setConfirm(true)}>Delete</button>
            </>
          ))}
        </div>
        <button type="button" className="lightbox-close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div ref={trackRef} className="lightbox-track" data-testid="lightbox-track">
        {photos.map((doc, i) => (
          <div
            key={doc.document_id}
            className="lightbox-slide"
            aria-hidden={i !== current}
            onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
          >
            {hasFile(doc) ? (
              <img
                src={fileUrl(doc)}
                alt={doc.caption ?? doc.original_filename}
                loading={Math.abs(i - current) <= 1 ? "eager" : "lazy"}
                draggable={false}
              />
            ) : (
              <RestorePhoto doc={doc} busy={busy && i === current} onPick={(file) => void replace(file)} />
            )}
          </div>
        ))}
      </div>
      <div className="lightbox-bar">
        <p className="lightbox-caption">{photo.caption ?? ""}</p>
        {count > 1 && (
          <div className="hero-dots lightbox-dots" role="tablist" aria-label="Photos">
            <span ref={thumbRef} className="hero-dot-thumb" aria-hidden="true" />
            {photos.map((doc, i) => (
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
      </div>
    </div>
  );
}

function ImprovementPhotos({
  images,
  owner,
  onChange,
  toast,
  trailing,
}: {
  images: Doc[];
  owner: boolean;
  onChange: PageRefresh;
  toast: (message: string) => void;
  trailing?: React.ReactNode;
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
        {trailing}
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

/**
 * The red plus beside the header's share button. Its slot opens from zero
 * width like the share slot did, so the search field contracts to make room,
 * and the button pops in once the space is there. Tapping it opens a native
 * select — the same picker the rest of the page uses — with photos, an
 * improvement, or a room. Lives in the header search row, so it tucks away
 * with the field when the section bar docks.
 */
function QuickAdd({
  on,
  uploading,
  onPhotos,
  onPhotoError,
  onImprovement,
  onRoom,
}: {
  on: boolean;
  uploading: boolean;
  onPhotos: (files: File[]) => void | Promise<void>;
  onPhotoError: (message: string) => void;
  onImprovement: () => void;
  onRoom: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`header-add${on ? " is-on" : ""}`}>
      <span className="btn header-add-btn" aria-hidden="true">
        <svg className="header-add-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </span>
      <select
        className="header-add-select"
        aria-label="Add to this page"
        data-testid="quick-add"
        tabIndex={on ? 0 : -1}
        disabled={!on}
        value=""
        onChange={(event) => {
          const value = event.target.value;
          event.target.value = "";
          if (value === "photos") fileRef.current?.click();
          else if (value === "improvement") onImprovement();
          else if (value === "room") onRoom();
        }}
      >
        <option value="" disabled hidden>Add</option>
        <option value="photos">Add photos</option>
        <option value="improvement">Add improvement</option>
        <option value="room">Add room</option>
      </select>
      <PhotoFileButton
        className="visually-hidden"
        busy={uploading}
        multiple
        testId="quick-add-photos"
        inputRef={fileRef}
        onPick={onPhotos}
        onError={onPhotoError}
      >
        Add photos
      </PhotoFileButton>
    </div>
  );
}

function PhotoFileButton({
  className,
  busy,
  multiple,
  testId,
  labelTestId,
  inputRef,
  onPick,
  onError,
  children,
}: {
  className: string;
  busy: boolean;
  multiple?: boolean;
  testId: string;
  labelTestId?: string;
  inputRef?: Ref<HTMLInputElement>;
  onPick: (files: File[]) => void | Promise<void>;
  onError?: (message: string) => void;
  children: ReactNode;
}) {
  const locked = useRef(false);
  const block = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <label
      className={`${className} file-btn ${busy ? "is-busy" : ""}`}
      data-testid={labelTestId}
      aria-busy={busy}
      onClick={(event) => {
        if (busy || locked.current) block(event);
      }}
    >
      {busy && <Spinner />}
      {children}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        tabIndex={busy || inputRef ? -1 : 0}
        data-testid={testId}
        onClick={(event) => {
          if (busy || locked.current) block(event);
        }}
        onChange={(event) => {
          if (busy || locked.current) {
            event.target.value = "";
            return;
          }
          const picked = Array.from(event.target.files ?? []);
          // Start the byte copy before this handler returns so iOS cannot
          // revoke the photo-library File after the picker closes.
          const copies = picked.map(snapshotPhotoFile);
          event.target.value = "";
          if (!picked.length) return;
          locked.current = true;
          void Promise.all(copies)
            .then(onPick)
            .catch((error) => {
              onError?.(error instanceof Error ? error.message : "That photo could not be read. Try again.");
            })
            .finally(() => {
              locked.current = false;
            });
        }}
      />
    </label>
  );
}

function PhotoImage({ src, alt }: { src: string; alt: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setReady(true);
      return;
    }
    setReady(false);
  }, [src]);

  return (
    <>
      {!ready && (
        <span
          className="photo-wait"
          aria-hidden="true"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Spinner />
        </span>
      )}
      <img ref={imgRef} src={src} alt={alt} onLoad={() => setReady(true)} onError={() => setReady(true)} />
    </>
  );
}

const PHOTO_PREVIEW_LIMIT = 4;

function photosPagePath(propertyId: string): string {
  return `/property/${propertyId}/photos`;
}

function PhotosSection({
  owner,
  propertyId,
  photos,
  cover,
  pendingCount = 0,
  uploading = false,
  uploadError = null,
  onUpload,
  onUploadError,
  onOpen,
  onChange,
  toast,
}: {
  owner: boolean;
  propertyId: string;
  photos: Doc[];
  cover: Doc | null;
  pendingCount?: number;
  uploading?: boolean;
  uploadError?: string | null;
  onUpload: (files: File[]) => Promise<void>;
  onUploadError?: (message: string) => void;
  onOpen: (index: number) => void;
  onChange: PageRefresh;
  toast: Toast;
}) {
  const preview = photos.slice(0, PHOTO_PREVIEW_LIMIT);
  const extra = Math.max(0, photos.length - PHOTO_PREVIEW_LIMIT);
  const pendingSlots = Math.min(pendingCount, Math.max(0, PHOTO_PREVIEW_LIMIT - preview.length));
  const allHref = photosPagePath(propertyId);

  return (
    <section className="section" id="photos">
      <div className="section-head">
        <h2>Photos</h2>
        <div className="section-head-actions">
          {photos.length > 0 && (
            <Link className="text-btn accent" to={allHref} data-testid="photos-view-all">View all</Link>
          )}
          {owner && (
            <PhotoFileButton className="text-btn accent" busy={uploading} multiple testId="photo-input" onPick={(files) => onUpload(files)} onError={onUploadError}>
              Add photos
            </PhotoFileButton>
          )}
        </div>
      </div>
      {owner && <p className="meta-line section-note">Public unless you say otherwise. The cover is what a neighbor sees first.{photos.some((doc) => !hasFile(doc)) ? " Cards marked “file missing” need the original photo reattached; after that they stay in Cloudflare." : ""}</p>}
      {uploadError && <p className="error" role="alert">{uploadError}</p>}
      {photos.length === 0 && pendingCount === 0 ? (
        <div className="group empty-card">{owner ? "No photos yet. Start with the exterior and the room you'd show off. Before-and-afters earn their keep later." : "The owner hasn't shared photos yet."}</div>
      ) : (
        <div className="photo-grid is-preview is-public">
          {preview.map((doc, index) => {
            const overflow = extra > 0 && index === PHOTO_PREVIEW_LIMIT - 1;
            return (
              <figure key={doc.document_id} className={`photo-card ${index === 0 ? "is-cover" : ""} ${doc.visibility === "private" ? "is-private" : ""} ${hasFile(doc) ? "" : "is-missing"}`}>
                {owner && !hasFile(doc) ? (
                  <RestorePhoto
                    doc={doc}
                    onPick={async (file) => {
                      await api.replaceDocument(doc.document_id, file);
                      toast("Photo restored.");
                      await onChange();
                    }}
                  />
                ) : overflow ? (
                  <Link className="photo-open photo-more-link" to={allHref} aria-label={`View all photos, ${extra} more`} data-testid="photos-more">
                    <PhotoImage src={fileUrl(doc)} alt="" />
                    <span className="photo-more">+{extra}</span>
                  </Link>
                ) : (
                  <button type="button" className="photo-open" onClick={() => onOpen(index)} aria-label={doc.caption ? `Open photo: ${doc.caption}` : "Open photo"}>
                    <PhotoImage src={fileUrl(doc)} alt={doc.caption ?? doc.original_filename} />
                    {owner && cover?.document_id === doc.document_id && <span className="photo-flag">Cover</span>}
                    {owner && doc.visibility === "private" && <span className="photo-flag private">Private</span>}
                  </button>
                )}
              </figure>
            );
          })}
          {Array.from({ length: pendingSlots }, (_, index) => (
            <figure key={`pending-${index}`} className="photo-card is-pending">
              <div className="photo-open" aria-label="Uploading photo">
                <span className="photo-wait">
                  <Spinner />
                </span>
              </div>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoCard({
  doc,
  cover,
  owner,
  onOpen,
  onChange,
  toast,
}: {
  doc: Doc;
  cover: Doc | null;
  owner: boolean;
  onOpen: () => void;
  onChange: PageRefresh;
  toast: Toast;
}) {
  return (
    <figure className={`photo-card ${doc.visibility === "private" ? "is-private" : ""} ${hasFile(doc) ? "" : "is-missing"}`}>
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
        <button type="button" className="photo-open" onClick={onOpen} aria-label={doc.caption ? `Open photo: ${doc.caption}` : "Open photo"}>
          <PhotoImage src={fileUrl(doc)} alt={doc.caption ?? doc.original_filename} />
          {owner && cover?.document_id === doc.document_id && <span className="photo-flag">Cover</span>}
          {owner && doc.visibility === "private" && <span className="photo-flag private">Private</span>}
        </button>
      )}
      {owner && (
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
                  await onChange((page) => ({
                    ...page,
                    documents: page.documents.map((item) => ({ ...item, is_cover: item.document_id === doc.document_id })),
                  }));
                }}>Set as cover</button>
              )}
              <button type="button" className="text-link danger" onClick={async () => {
                await api.deleteDocument(doc.document_id);
                await onChange();
              }}>Remove</button>
            </span>
          </div>
        </figcaption>
      )}
    </figure>
  );
}

export function PropertyPhotosPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [photoUploads, setPhotoUploads] = useState(0);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.property(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load property");
    }
  }, [id]);

  const refresh = useCallback<PageRefresh>(async (patch) => {
    if (patch) {
      setData((current) => current ? { ...current, property: patch(current.property) } : current);
    }
    await load();
  }, [load]);

  useEffect(() => { setData(null); }, [id]);
  useEffect(() => { void load(); }, [load, user?.user_id]);

  const title = data?.property.formatted?.split(",")[0] ?? "Untitled parcel";
  useEffect(() => {
    if (!data) return;
    const previous = document.title;
    document.title = `Photos · ${title} · Myplace`;
    return () => { document.title = previous; };
  }, [data, title]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data || !id) return <PageSpinner label="Loading record" />;

  const { property, viewer } = data;
  const owner = Boolean(viewer.maintainer && !viewer.openClaim);
  const galleryPhotos = property.documents.filter(isGalleryPhoto);
  const available = galleryPhotos.filter(hasFile);
  const cover = available.find((doc) => doc.is_cover) ?? available[0] ?? null;
  const gallery = orderGalleryPhotos(galleryPhotos, cover);
  const uploading = photoUploads > 0;

  const uploadPhotos = async (files: File[]) => {
    if (!files.length) return;
    setPhotoError(null);
    setPhotoUploads((count) => count + files.length);
    try {
      for (const file of files) {
        await api.upload(id, file, { documentType: "photo", visibility: "public" });
      }
      showToast(`${files.length} photo${files.length === 1 ? "" : "s"} added.`);
      await refresh();
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Photo could not be added. Try again.";
      setPhotoError(message);
      showToast(message);
    } finally {
      setPhotoUploads((count) => Math.max(0, count - files.length));
    }
  };

  return (
    <div className="page property-page photos-page">
      <Link className="back-link" to={`/property/${id}`}>‹ {title}</Link>
      <div className="section-head">
        <h1>Photos</h1>
        {owner && (
          <PhotoFileButton className="text-btn accent" busy={uploading} multiple testId="photo-input" onPick={(files) => void uploadPhotos(files)} onError={(message) => { setPhotoError(message); showToast(message); }}>
            Add photos
          </PhotoFileButton>
        )}
      </div>
      {owner && <p className="meta-line section-note">Public unless you say otherwise. The cover is what a neighbor sees first.{gallery.some((doc) => !hasFile(doc)) ? " Cards marked “file missing” need the original photo reattached; after that they stay in Cloudflare." : ""}</p>}
      {photoError && <p className="error" role="alert">{photoError}</p>}
      {toast && <div className="toast" role="status">{toast}</div>}
      {gallery.length === 0 && photoUploads === 0 ? (
        <div className="group empty-card">{owner ? "No photos yet. Start with the exterior and the room you'd show off. Before-and-afters earn their keep later." : "The owner hasn't shared photos yet."}</div>
      ) : (
        <div className={`photo-grid is-catalog featured ${owner ? "" : "is-public"}`}>
          {gallery.map((doc, index) => (
            <PhotoCard
              key={doc.document_id}
              doc={doc}
              cover={cover}
              owner={owner}
              onOpen={() => setLightbox(index)}
              onChange={refresh}
              toast={showToast}
            />
          ))}
          {Array.from({ length: photoUploads }, (_, index) => (
            <figure key={`pending-${index}`} className="photo-card is-pending">
              <div className="photo-open" aria-label="Uploading photo">
                <span className="photo-wait">
                  <Spinner />
                </span>
              </div>
            </figure>
          ))}
        </div>
      )}
      {lightbox !== null && gallery[lightbox] && (
        <PhotoLightbox
          photos={gallery}
          index={lightbox}
          owner={owner}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onChange={refresh}
          toast={showToast}
        />
      )}
    </div>
  );
}
