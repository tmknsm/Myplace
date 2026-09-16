import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { SearchBox } from "./components";
import { useMeta } from "./meta";

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
  /** White farmhouse with a wraparound porch */
  porchFarmhouse: "1570129477492-45c003edd2be",
  /** White cottage with red trim and a picket fence */
  cottage: "1480074568708-e7b720bb3f09",
  /** Brick cottage in the woods at dusk */
  brickCottage: "1449844908441-8829872d2607",
  /** Red cabin in a meadow */
  redCabin: "1518780664697-55e3ad937233",
  /** Living room with houseplants */
  livingRoom: "1502672260266-1c1ef2d93688",
  /** Dining room, white table */
  diningRoom: "1519710164239-da123dc03ef4",
  /** Living room, leather sofa */
  sittingRoom: "1554995207-c18c203602cb",
  /** White kitchen with pendant lights */
  kitchenIsland: "1507089947368-19c1da9775ae",
};

// ---------------------------------------------------------------------------
// Featured pages: five claimed houses, owner-reported details
// ---------------------------------------------------------------------------

interface FeaturedHome {
  address: string;
  place: string;
  photos: [string, string, string];
  photoCount: number;
  facts: { label: string; value: string }[];
}

const FEATURED: FeaturedHome[] = [
  {
    address: "27 Union Street",
    place: "Hudson · Columbia County",
    photos: [PHOTOS.victorian, PHOTOS.livingRoom, PHOTOS.kitchenIsland],
    photoCount: 22,
    facts: [
      { label: "Exterior", value: "Farrow & Ball, Hague Blue" },
      { label: "Roof", value: "Slate, repaired 2018" },
    ],
  },
  {
    address: "112 County Route 27",
    place: "Claverack · Columbia County",
    photos: [PHOTOS.porchFarmhouse, PHOTOS.kitchen, PHOTOS.diningRoom],
    photoCount: 31,
    facts: [
      { label: "Porch", value: "Rebuilt 2021, mahogany decking" },
      { label: "Heat", value: "Buderus oil boiler, 2016" },
    ],
  },
  {
    address: "8 Church Street",
    place: "Catskill · Greene County",
    photos: [PHOTOS.cottage, PHOTOS.kitchenCounter, PHOTOS.sittingRoom],
    photoCount: 14,
    facts: [
      { label: "Trim", value: "Benjamin Moore, Caliente" },
      { label: "Windows", value: "Marvin, replaced 2019" },
    ],
  },
  {
    address: "340 Route 66",
    place: "Chatham · Columbia County",
    photos: [PHOTOS.brickCottage, PHOTOS.kitchenDetail, PHOTOS.livingRoom],
    photoCount: 18,
    facts: [
      { label: "Brick", value: "Repointed 2020" },
      { label: "Septic", value: "Pumped May 2024" },
    ],
  },
  {
    address: "19 Mitchell Hollow Road",
    place: "Windham · Greene County",
    photos: [PHOTOS.redCabin, PHOTOS.sittingRoom, PHOTOS.diningRoom],
    photoCount: 9,
    facts: [
      { label: "Siding", value: "Board and batten, 2022" },
      { label: "Solar", value: "6.4 kW rooftop, 2023" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Chapters: one narrative, from looking to claiming to handing over
// ---------------------------------------------------------------------------

type ChapterId = "browse" | "claim" | "private" | "handoff" | "offer";

interface Chapter {
  id: ChapterId;
  eyebrow: string;
  title: string;
  body: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: "browse",
    eyebrow: "Start nosy",
    title: "Look up your neighbors. Everyone does.",
    body:
      "A blue Victorian on Warren Street. Built 1889, porch enclosed sometime in the seventies, exterior in Hague Blue because the owner said so. Most pages are still just the county record. The good ones have been claimed.",
  },
  {
    id: "claim",
    eyebrow: "Claim your address",
    title: "The paint color, the millwork, the guy who did the stairs.",
    body:
      "You answer these questions in DMs anyway. Put them on the page once, with finishes, sources and before-and-afters, and send one link instead. Credit the contractors while you're at it; they'll send people back.",
  },
  {
    id: "private",
    eyebrow: "The private half",
    title: "And the boiler manual nobody wants to see.",
    body:
      "Deed, survey, permits, warranties, the furnace receipt. Private by default, on the same page as the pretty stuff. Ten years from now, when someone asks what's behind that wall, you'll actually know.",
  },
  {
    id: "handoff",
    eyebrow: "At closing",
    title: "Sell the house. Send the record.",
    body:
      "Pick, field by field, what travels. One invitation moves it to the new owner, and anything you keep, you keep. The buyer gets a house with its own history instead of a shoebox of receipts and a seller who's already in Florida.",
  },
  {
    id: "offer",
    eyebrow: "Before you make an offer",
    title: "Two kinds of fact, never mixed.",
    body:
      "Type the address off any listing. What the county knows and what the owner claims sit side by side, each one labeled, so you can tell the difference without calling anybody.",
  },
];

// ---------------------------------------------------------------------------
// Scenes: the product, staged over a photograph
// ---------------------------------------------------------------------------

function Photo({ id, width, alt, className }: { id: string; width: number; alt: string; className?: string }) {
  return <img className={className} src={unsplash(id, width)} alt={alt} loading="lazy" decoding="async" draggable={false} />;
}

function Toggle({ on }: { on: boolean }) {
  return <i className={`home-toggle ${on ? "on" : ""}`} aria-hidden="true" />;
}

function BrowseScene() {
  return (
    <div className="home-scene-inner">
      <Photo id={PHOTOS.victorian} width={1400} alt="A blue Victorian house with white trim and a stair to the front door" className="home-scene-photo" />
      <span className="hero-pill home-float-caption">Exterior · Farrow &amp; Ball, Hague Blue</span>
      <div className="home-float home-float-history">
        <span className="home-float-title">History</span>
        <ul className="timeline home-timeline">
          <li><strong>Repainted, trim in Wimborne White</strong><small>2019</small></li>
          <li><strong>Porch enclosed</strong><small>1974</small></li>
          <li><strong>Built</strong><small>1889</small></li>
        </ul>
      </div>
    </div>
  );
}

function ClaimScene() {
  return (
    <div className="home-scene-inner home-scene-claim">
      <Photo id={PHOTOS.kitchen} width={1400} alt="A farmhouse kitchen with white cabinets and wooden counters" className="home-scene-photo" />
      <div className="home-float home-float-claim">
        <div className="home-float-head">
          <div>
            <div className="kicker">12 Maple Lane</div>
            <h4>Kitchen renovation</h4>
          </div>
          <span className="owner-chip">Claimed</span>
        </div>
        <dl className="home-facts">
          <div><dt>Cabinetry</dt><dd>Hudson Valley Cabinetry</dd></div>
          <div><dt>Wall color</dt><dd>Farrow &amp; Ball, Shaded White</dd></div>
        </dl>
        <div className="home-strip">
          <Photo id={PHOTOS.kitchenDetail} width={320} alt="" />
          <Photo id={PHOTOS.kitchenCounter} width={320} alt="" />
          <Photo id={PHOTOS.kitchen} width={320} alt="" />
        </div>
      </div>
    </div>
  );
}

function PrivateScene() {
  return (
    <div className="home-scene-inner home-scene-private">
      <Photo id={PHOTOS.kitchenDetail} width={1400} alt="A kettle on the range in a farmhouse kitchen" className="home-scene-photo" />
      <div className="home-float home-float-docs">
        <span className="home-float-title">Documents</span>
        <ul className="home-doc-list">
          <li><span>Deed</span><small>2019</small></li>
          <li><span>Survey</span><small>PDF</small></li>
          <li><span>Boiler manual</span><small>PDF</small></li>
        </ul>
        <span className="vis-chip is-private">Only you</span>
      </div>
    </div>
  );
}

function HandoffScene() {
  return (
    <div className="home-scene-inner home-scene-handoff">
      <Photo id={PHOTOS.blueDoor} width={1400} alt="A townhouse with a bright blue front door and a checkered garden path" className="home-scene-photo" />
      <div className="home-float home-float-handoff">
        <div className="kicker">Handoff</div>
        <h4>What travels with the sale</h4>
        <ul className="home-transfer-list">
          <li><span>Deed and survey</span><em>Transfers</em><Toggle on /></li>
          <li><span>Roof warranty</span><em>Transfers</em><Toggle on /></li>
          <li><span>Insurance claims</span><em>Stays with you</em><Toggle on={false} /></li>
        </ul>
      </div>
    </div>
  );
}

function OfferScene() {
  return (
    <div className="home-scene-inner home-scene-offer">
      <Photo id={PHOTOS.farmhouse} width={1400} alt="A white farmhouse with a metal roof under a blue sky" className="home-scene-photo" />
      <div className="home-float home-float-facts">
        <div className="kicker">Catskill · Greene County</div>
        <h4>12 Maple Lane</h4>
        <dl className="home-facts">
          <div><dt>Flood zone</dt><dd>Zone X · minimal <span className="badge">FEMA</span></dd></div>
          <div><dt>Assessed</dt><dd>$412,000 <span className="badge">2025 roll</span></dd></div>
          <div><dt>Roof</dt><dd>Standing-seam metal, 2021 <span className="badge owner_reported">owner-reported</span></dd></div>
        </dl>
      </div>
    </div>
  );
}

const SCENES: Record<ChapterId, () => React.JSX.Element> = {
  browse: BrowseScene,
  claim: ClaimScene,
  private: PrivateScene,
  handoff: HandoffScene,
  offer: OfferScene,
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
  const meta = useMeta();
  const searchAnchor = useRef<HTMLDivElement | null>(null);
  useSearchHandoff(searchAnchor);

  const count = meta?.propertyCount ?? null;
  const counties = meta?.counties ?? [];
  const countLabel = count === null ? null : `${count.toLocaleString()} parcels`;

  return (
    <div className="home">
      <section className="home-hero" aria-labelledby="home-title">
        <figure className="home-hero-band">
          <img className="home-hero-photo" src="/home-hero.webp" alt="White mansion on a hill, seen through autumn trees and tall grass" width={2400} height={1600} decoding="async" />
        </figure>
        <div className="home-hero-copy">
          <div className="kicker">Hudson Valley, New York</div>
          <h1 id="home-title">Claim your house and tell us about it.</h1>
          <p className="home-lede">
            Every parcel already has a page. Add the details only you know—then hand that story off when the house moves on to its next chapter.
          </p>
          <div className="home-search-anchor" ref={searchAnchor}>
            <div className="home-search">
              <SearchBox />
            </div>
          </div>
          <p className="meta-line home-hero-meta">
            {countLabel ? `Search ${countLabel}` : "Search"} by address or tax map number, or <Link to="/map">wander the map</Link>.
          </p>
        </div>
      </section>

      <section className="home-featured" aria-labelledby="home-featured-title">
        <header className="home-section-head">
          <div className="kicker">Featured homes</div>
          <h2 id="home-featured-title">Recently claimed by their owners.</h2>
        </header>
        <ul className="home-featured-track">
          {FEATURED.map((home) => (
            <li key={home.address} className="home-featured-card">
              <figure className="home-featured-hero">
                <Photo id={home.photos[0]} width={720} alt={`${home.address}, exterior`} />
                <figcaption className="home-featured-overlay">
                  <span className="hero-pill quiet">{home.photoCount} photos</span>
                </figcaption>
              </figure>
              <div className="home-featured-body">
                <div className="kicker">{home.place}</div>
                <h3>{home.address}</h3>
                <dl className="home-facts">
                  {home.facts.map((fact) => (
                    <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="home-chapters">
        {CHAPTERS.map((chapter) => {
          const Scene = SCENES[chapter.id];
          return (
            <section key={chapter.id} id={`chapter-${chapter.id}`} className="home-chapter" aria-labelledby={`chapter-${chapter.id}-title`}>
              <header className="home-section-head">
                <div className="kicker">{chapter.eyebrow}</div>
                <h2 id={`chapter-${chapter.id}-title`}>{chapter.title}</h2>
              </header>
              <div className="home-scene is-on">
                <Scene />
              </div>
              <div className="home-chapter-copy">
                <p>{chapter.body}</p>
              </div>
            </section>
          );
        })}
      </div>

      <section className="home-pillars" aria-labelledby="home-pillars-title">
        <header className="home-section-head">
          <div className="kicker">How it's built</div>
          <h2 id="home-pillars-title">Official. Changed. Yours.</h2>
          <p className="home-section-lede">Three kinds of information, kept apart and labeled.</p>
        </header>
        <div className="home-pillar-grid">
          <article className="home-pillar">
            <div className="home-pillar-art">
              <div className="home-pillar-fact"><span>Lot size</span><strong>2.4 acres <em className="badge">NYS ORPTS</em></strong></div>
              <div className="home-pillar-fact"><span>Flood zone</span><strong>Zone X <em className="badge">FEMA</em></strong></div>
              <div className="home-pillar-fact"><span>Zoning</span><strong className="is-unknown">Unknown <em className="badge unknown">no source yet</em></strong></div>
            </div>
            <h3>Official</h3>
            <p>Every fact carries its source. Where the record doesn't exist, the page says unknown instead of guessing.</p>
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
            <p>Sales, assessments and edits, oldest to newest. Written once, never rewritten.</p>
          </article>
          <article className="home-pillar">
            <div className="home-pillar-art home-pillar-vis">
              <span className="vis-chip">Photos · Public</span>
              <span className="vis-chip is-private">Insurance · Only you</span>
              <span className="vis-chip">Boiler manual · Transfers</span>
            </div>
            <h3>Yours</h3>
            <p>Photos, improvements, systems, documents. You set each one public, private, or transfers.</p>
          </article>
        </div>
      </section>

      <section className="home-agents" aria-labelledby="home-agents-title">
        <div className="home-agents-head">
          <div className="kicker">For agents</div>
          <h2 id="home-agents-title">Walk into the listing appointment already knowing the house.</h2>
        </div>
        <p>
          Flood, lot lines, historic status and the current assessment on one page before you knock.
          If the seller has claimed it, the documents are there too.
        </p>
      </section>

      <section className="home-coverage" aria-labelledby="home-coverage-title">
        <div className="home-coverage-copy">
          <div className="kicker">Coverage</div>
          <h2 id="home-coverage-title">Two counties. Every lot.</h2>
          <p>
            Columbia and Greene today, pulled from public New York sources and refreshed as the counties publish.
            Each new county is one adapter, so the rest of the state can follow.
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
          Look it up. If it's yours, claim it. Verification takes a day or two.
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
