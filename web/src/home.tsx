import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ParcelMap, SearchBox } from "./components";
import { useMeta } from "./meta";
import { SectionNav } from "./section-nav";

// ---------------------------------------------------------------------------
// Photography (Unsplash, free to use under the Unsplash License)
// ---------------------------------------------------------------------------

const unsplash = (id: string, width: number) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=78`;

const PHOTOS = {
  /** Farmhouse kitchen — Clay Banks */
  kitchen: "1769745241584-be9b8227e126",
  /** Kitchen detail, kettle on the range — Taylor Friehl */
  kitchenDetail: "1778088442657-eb0b0491b48c",
  /** Kitchen, white cabinets and wood counters — Alex Tyson */
  kitchenCounter: "1722649934574-49bbddd3b5ae",
  /** White farmhouse with a metal roof — Linus Belanger */
  farmhouse: "1756219833872-c91af1a43b92",
  /** Townhouse with a blue door and a checkered path */
  blueDoor: "1745808930196-e03bf5fe6c02",
  /** Blue Victorian with white trim — Nadia Valko */
  victorian: "1759340643095-e06b6d5645bf",
  /** Farm in autumn woods, Hudson Valley — Clay Banks */
  valley: "1602524682848-a58eb73eaeb9",
};

// ---------------------------------------------------------------------------
// Chapters: one record, read four ways
// ---------------------------------------------------------------------------

type ChapterId = "owners" | "buyers" | "sellers" | "curious";

interface Chapter {
  id: ChapterId;
  audience: string;
  title: string;
  body: string;
  points: string[];
}

const CHAPTERS: Chapter[] = [
  {
    id: "curious",
    audience: "For the curious",
    title: "Every house has a story. Some owners tell it.",
    body:
      "Wander the map. See the paint color a neighbor chose, the year a porch was enclosed, the garden in July. Owners decide what to share, and anyone can look.",
    points: [
      "Browse what owners share: photos, colors, materials",
      "Read the public history: sales, assessments, changes",
      "Open the map and click any lot",
    ],
  },
  {
    id: "owners",
    audience: "For homeowners",
    title: "A journal for the house.",
    body:
      "Keep the deed, the survey, the boiler manual and the roof warranty in one vault. Log every renovation with the contractor, the cost and the photos. Years from now, when someone asks what is behind that wall, you will know.",
    points: [
      "Every document in one place, private by default",
      "Each improvement: who did it, when, what it cost, and the pictures",
      "The official record of your property, with its sources",
    ],
  },
  {
    id: "buyers",
    audience: "For buyers and movers",
    title: "Know the house before you make an offer.",
    body:
      "Type in the address from any listing. See the county's record beside whatever the owner has chosen to share: flood zone, lot lines, historic status, the story of the renovations. When you close, the record comes with the keys.",
    points: [
      "Flood, wetland, historic and zoning layers on one page",
      "Official and owner-reported facts, always labeled as such",
      "Receive the previous owner's package at closing",
    ],
  },
  {
    id: "sellers",
    audience: "For sellers",
    title: "Hand over the house, not a shoebox.",
    body:
      "Decide, field by field, what travels with the sale. The warranties and the permits, yes. The insurance claims, no. Then pass the record to the new owner with a single invitation. Your private documents stay yours.",
    points: [
      "Choose what transfers and what stays with you",
      "One invitation moves the record to the new owner",
      "Nothing marked private ever leaves your account",
    ],
  },
];

/** Chip labels for the section bar, one per chapter, in reading order. */
const CHAPTER_CHIP: Record<ChapterId, string> = {
  curious: "Curious",
  owners: "Homeowners",
  buyers: "Buyers",
  sellers: "Sellers",
};

const SECTION_NAV = CHAPTERS.map((chapter) => ({
  id: `chapter-${chapter.id}`,
  label: CHAPTER_CHIP[chapter.id],
  // Curious is the first chapter; its chip returns to the moment the bar docks.
  ...(chapter.id === "curious" ? { href: "home-story" } : {}),
}));

// ---------------------------------------------------------------------------
// Scenes: the product, staged over a photograph
// ---------------------------------------------------------------------------

function Photo({ id, width, alt, className }: { id: string; width: number; alt: string; className?: string }) {
  return <img className={className} src={unsplash(id, width)} alt={alt} loading="lazy" decoding="async" draggable={false} />;
}

function Toggle({ on }: { on: boolean }) {
  return <i className={`home-toggle ${on ? "on" : ""}`} aria-hidden="true" />;
}

function OwnersScene() {
  return (
    <div className="home-scene-inner home-scene-owners">
      <Photo id={PHOTOS.kitchen} width={1400} alt="A farmhouse kitchen with white cabinets and wooden counters" className="home-scene-photo" />
      <div className="home-float home-float-improvement">
        <span className="chip">Kitchen</span>
        <h4>Kitchen renovation</h4>
        <ul className="improvement-meta">
          <li>Oct 2023</li>
          <li className="cost">$48,500</li>
          <li>Hudson Valley Cabinetry</li>
        </ul>
        <div className="home-strip">
          <Photo id={PHOTOS.kitchenDetail} width={320} alt="" />
          <Photo id={PHOTOS.kitchenCounter} width={320} alt="" />
          <Photo id={PHOTOS.kitchen} width={320} alt="" />
        </div>
      </div>
      <div className="home-float home-float-vault">
        <span className="home-float-title">Documents</span>
        <ul className="home-doc-list">
          <li><span>Deed</span><small>2019</small></li>
          <li><span>Survey</span><small>PDF</small></li>
          <li><span>Boiler manual</span><small>PDF</small></li>
          <li><span>Roof warranty</span><small>to 2041</small></li>
        </ul>
        <span className="vis-chip is-private"><i aria-hidden="true" />Only you</span>
      </div>
    </div>
  );
}

function BuyersScene() {
  return (
    <div className="home-scene-inner home-scene-buyers">
      <Photo id={PHOTOS.farmhouse} width={1400} alt="A white farmhouse with a metal roof under a blue sky" className="home-scene-photo" />
      <div className="home-float home-float-facts">
        <div className="home-float-head">
          <div>
            <div className="kicker">Catskill · Greene County</div>
            <h4>12 Maple Lane</h4>
          </div>
          <span className="owner-chip"><i aria-hidden="true" />Owner-maintained</span>
        </div>
        <dl className="home-facts">
          <div><dt>Flood zone</dt><dd>Zone X · minimal <span className="badge">FEMA</span></dd></div>
          <div><dt>Historic district</dt><dd>Not in a listed district</dd></div>
          <div><dt>Lot lines</dt><dd>Official <span className="badge">Greene County</span></dd></div>
          <div><dt>Assessed</dt><dd>$412,000 <span className="badge">2025 roll</span></dd></div>
          <div><dt>Roof</dt><dd>Standing-seam metal, 2021 <span className="badge owner_reported">owner-reported</span></dd></div>
        </dl>
      </div>
      <div className="home-float home-float-package">
        <span className="home-float-title">Handoff received</span>
        <strong>14 documents · 6 improvements · 31 photos</strong>
        <small className="meta-line">From the previous owner, at closing</small>
      </div>
    </div>
  );
}

function SellersScene() {
  return (
    <div className="home-scene-inner home-scene-sellers">
      <Photo id={PHOTOS.blueDoor} width={1400} alt="A townhouse with a bright blue front door and a checkered garden path" className="home-scene-photo" />
      <div className="home-float home-float-handoff">
        <div className="kicker">Handoff</div>
        <h4>What travels with the sale</h4>
        <ul className="home-transfer-list">
          <li><span>Deed and survey</span><em>Transfers</em><Toggle on /></li>
          <li><span>Roof warranty</span><em>Transfers</em><Toggle on /></li>
          <li><span>Contractor contacts</span><em>Transfers</em><Toggle on /></li>
          <li><span>Insurance claims</span><em>Stays with you</em><Toggle on={false} /></li>
        </ul>
        <span className="btn home-static-btn" aria-hidden="true">Invite the new owner</span>
      </div>
    </div>
  );
}

function CuriousScene() {
  return (
    <div className="home-scene-inner">
      <Photo id={PHOTOS.victorian} width={1400} alt="A blue Victorian house with white trim and a stair to the front door" className="home-scene-photo" />
      <span className="hero-pill home-float-caption">Exterior · Farrow &amp; Ball, Hague Blue</span>
      <div className="home-float home-float-history">
        <span className="home-float-title">History</span>
        <ul className="timeline home-timeline">
          <li><strong>Owner joined the record</strong><small>2024</small></li>
          <li><strong>Repainted, trim in Wimborne White</strong><small>2019</small></li>
          <li><strong>Porch enclosed</strong><small>1974</small></li>
          <li><strong>Built</strong><small>1889</small></li>
        </ul>
      </div>
    </div>
  );
}

const SCENES: Record<ChapterId, () => React.JSX.Element> = {
  owners: OwnersScene,
  buyers: BuyersScene,
  sellers: SellersScene,
  curious: CuriousScene,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const SCROLL_DRIVEN = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");

/**
 * Hands the hero search off to the header. With scroll-driven animations the
 * header search fades in as the hero search slides under the chrome, purely in
 * CSS. Elsewhere, flip a class the moment the hero search is fully covered.
 */
function useSearchHandoff(anchor: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const node = anchor.current;
    const root = document.documentElement;
    if (!node || SCROLL_DRIVEN) return;
    let observer: IntersectionObserver | null = null;
    const connect = () => {
      observer?.disconnect();
      const header = Number.parseFloat(getComputedStyle(root).getPropertyValue("--topbar-height")) || 84;
      observer = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        root.classList.toggle("home-search-docked", !entry.isIntersecting && entry.boundingClientRect.bottom <= header);
      }, { rootMargin: `-${Math.ceil(header)}px 0px 0px 0px`, threshold: 0 });
      observer.observe(node);
    };
    // --topbar-height is written by the layout's effect, which runs after this one.
    const frame = requestAnimationFrame(connect);
    window.addEventListener("resize", connect);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", connect);
      observer?.disconnect();
      root.classList.remove("home-search-docked");
    };
  }, [anchor]);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function HomePage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const [focus, setFocus] = useState<string>("all");
  const searchAnchor = useRef<HTMLDivElement | null>(null);
  useSearchHandoff(searchAnchor);

  const count = meta?.propertyCount ?? null;
  const counties = meta?.counties ?? [];
  const selected = counties.find((county) => county.id === focus);
  const countLabel = count === null ? null : `${count.toLocaleString()} parcels`;

  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <div className="kicker">Columbia &amp; Greene counties, New York</div>
          <h1 id="home-title">A living record for every home.</h1>
          <p className="home-lede">
            The official facts, the history of what changed, and what only you know.
            For every property in two Hudson Valley counties, and soon the rest of New York.
          </p>
          <div className="home-search-anchor" ref={searchAnchor}>
            <div className="home-search">
              <SearchBox />
            </div>
          </div>
          <p className="meta-line home-hero-meta">
            {countLabel ? `Search ${countLabel}` : "Search"} by address or tax map number.
          </p>
        </div>

        <div className="home-map">
          <ParcelMap
            embedded
            legend
            focusKey={focus}
            focusCenter={selected?.center}
            focusZoom={selected?.zoom}
            onSelect={(id) => navigate(`/property/${id}`)}
          />
          <div className="home-map-controls">
            <div className="segmented home-county-switch" role="group" aria-label="Focus the map">
              <button type="button" className={focus === "all" ? "on" : ""} onClick={() => setFocus("all")}>Both</button>
              {counties.map((county) => (
                <button
                  key={county.id}
                  type="button"
                  className={focus === county.id ? "on" : ""}
                  onClick={() => setFocus(county.id)}
                >
                  {county.id}
                </button>
              ))}
            </div>
            <Link to="/map" className="hero-pill home-map-open">Open the full map</Link>
          </div>
        </div>
        <p className="meta-line home-map-caption">
          {selected
            ? `${selected.id} County: ${selected.parcelCount.toLocaleString()} parcels. ${selected.short}`
            : "Greene publishes its official lot lines. Columbia does not, so its shapes are approximate and labeled that way."}
        </p>
      </section>

      <section className="home-story" id="home-story" aria-labelledby="home-story-title">
        {/* No view timeline here, so docking always runs through the class-based path. */}
        <SectionNav items={SECTION_NAV} className="home-nav" dockClass="home-nav-docked" scrollDriven={false} />
        <div className="home-chapters">
          {CHAPTERS.map((chapter) => {
            const Scene = SCENES[chapter.id];
            return (
              <article key={chapter.id} id={`chapter-${chapter.id}`} className="home-chapter">
                <header className="home-section-head">
                  <div className="kicker">{chapter.audience}</div>
                  <h2 id={chapter.id === "curious" ? "home-story-title" : undefined}>{chapter.title}</h2>
                </header>
                <div className="home-scene home-scene-inline is-on">
                  <Scene />
                </div>
                <div className="home-chapter-copy">
                  <p>{chapter.body}</p>
                  <ul className="home-points">
                    {chapter.points.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-pillars" aria-labelledby="home-pillars-title">
        <header className="home-section-head">
          <div className="kicker">How it is built</div>
          <h2 id="home-pillars-title">Official. Changed. Yours.</h2>
          <p className="home-section-lede">What is official, what changed, and what only you know, each kept apart and labeled.</p>
        </header>
        <div className="home-pillar-grid">
          <article className="home-pillar">
            <div className="home-pillar-art">
              <div className="home-pillar-fact"><span>Lot size</span><strong>2.4 acres <em className="badge">NYS ORPTS</em></strong></div>
              <div className="home-pillar-fact"><span>Flood zone</span><strong>Zone X <em className="badge">FEMA</em></strong></div>
              <div className="home-pillar-fact"><span>Zoning</span><strong className="is-unknown">Unknown <em className="badge unknown">no source yet</em></strong></div>
            </div>
            <h3>Official</h3>
            <p>Every fact from the county or the state carries its source. Where a record does not exist, the page says unknown instead of guessing.</p>
          </article>
          <article className="home-pillar">
            <div className="home-pillar-art">
              <ul className="timeline home-timeline">
                <li><strong>Assessment updated</strong><small>2025 roll</small></li>
                <li><strong>Recorded sale</strong><small>Aug 2019</small></li>
                <li><strong>Parcel record imported</strong><small>NYS Tax Parcels</small></li>
              </ul>
            </div>
            <h3>Changed</h3>
            <p>Sales, assessments, claims and edits, oldest to newest. The history of a property is written once and never rewritten.</p>
          </article>
          <article className="home-pillar">
            <div className="home-pillar-art home-pillar-vis">
              <span className="vis-chip"><i aria-hidden="true" />Photos · Public</span>
              <span className="vis-chip is-private"><i aria-hidden="true" />Insurance · Only you</span>
              <span className="vis-chip"><i aria-hidden="true" />Boiler manual · Transfers</span>
            </div>
            <h3>Yours</h3>
            <p>Photos, improvements, systems and documents. Public where it helps, private where it matters, and yours to hand to the next owner.</p>
          </article>
        </div>
      </section>

      <section className="home-coverage" aria-labelledby="home-coverage-title">
        <div className="home-coverage-copy">
          <div className="kicker">Coverage</div>
          <h2 id="home-coverage-title">Two counties. Every lot.</h2>
          <p>
            Columbia and Greene today, imported from public New York sources and refreshed as the counties publish.
            Adding a county means adding one adapter, so the rest of the state can follow.
          </p>
          <dl className="home-coverage-stats">
            <div>
              <dt>Parcels</dt>
              <dd>{count === null ? "—" : count.toLocaleString()}<small>Every lot in both counties</small></dd>
            </div>
            {counties.map((county) => (
              <div key={county.id}>
                <dt>{county.id} County</dt>
                <dd>
                  {county.parcelCount.toLocaleString()}
                  <small>{county.geometryQuality === "official" ? "Official lot lines" : county.geometryQuality === "approximate" ? "Approximate lot lines" : county.geometryQuality === "demonstration" ? "Demonstration sketches" : "Assessment roll"}</small>
                </dd>
              </div>
            ))}
            <div>
              <dt>Public layers</dt>
              <dd>4<small>FEMA flood · Wetlands · Historic · Zoning</small></dd>
            </div>
          </dl>
        </div>
        <div className="home-coverage-photo">
          <Photo id={PHOTOS.valley} width={1400} alt="A red farm among autumn trees in the Hudson Valley" />
        </div>
      </section>

      <section className="home-cta" aria-labelledby="home-cta-title">
        <h2 id="home-cta-title">Start with your address.</h2>
        <p>
          Look up any property in Columbia or Greene. If it is yours, claim it and add what only you know.
          Verification takes a day or two.
        </p>
        <div className="home-search">
          <SearchBox />
        </div>
        <p className="meta-line">
          or <Link to="/map">browse the map</Link>
        </p>
      </section>

      <footer className="home-foot">
        <div className="brand">
          <i className="mark" aria-hidden="true" />
          <strong>Myplace</strong>
        </div>
        <nav className="home-foot-links" aria-label="Footer">
          <Link to="/map">Map</Link>
          <Link to="/signin">Sign in</Link>
        </nav>
        <p className="meta-line">
          Public records from NYS ORPTS, the NYS GIS Program Office, FEMA, USFWS and NYS SHPO.
          Photographs by Clay Banks, Linus Belanger, Nadia Valko, Taylor Friehl, Alex Tyson and others, via Unsplash.
        </p>
      </footer>
    </div>
  );
}
