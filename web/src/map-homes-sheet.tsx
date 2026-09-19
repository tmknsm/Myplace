import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { MapHome } from "./api";
import { NeighborHouseIcon, QUALITY_COLORS } from "./components";
import { DISMISS_MS, bindPressDrag, sampleVelocity, scrollChainAtTop } from "./dismiss-gesture";
import {
  detentHeights,
  dragVisibleHeight,
  homesDragMode,
  homesTitle,
  mapInsetFor,
  settleDetent,
  SHEET_TOP_RADIUS,
  sheetTopRadius,
  toggleDetent,
  type DetentHeights,
  type HomesDetent,
} from "./map-homes-detents";

type DragMode = "pending" | "sheet" | "scroll";

/**
 * The bottom sheet on the map page: how many homes the map is showing, and a
 * card for each. It rests at three heights — see `HomesDetent` — and moves
 * one stop per swipe. Dragging the header always moves the sheet; dragging
 * the list moves it too until the sheet is full, when the list scrolls and
 * only a pull from the top brings the sheet back down.
 */
export function MapHomesSheet({
  count,
  homes,
  pending,
  detent,
  onDetent,
  onInset,
}: {
  count: number | null;
  homes: MapHome[];
  pending: boolean;
  detent: HomesDetent;
  onDetent: (next: HomesDetent) => void;
  /** Height of map the settled sheet covers, for the legend and the in-view count. */
  onInset?: (px: number) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstCardRef = useRef<HTMLElement | null>(null);
  const [heights, setHeights] = useState<DetentHeights | null>(null);
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const detentRef = useRef(detent);
  detentRef.current = detent;
  const onDetentRef = useRef(onDetent);
  onDetentRef.current = onDetent;
  const onInsetRef = useRef(onInset);
  onInsetRef.current = onInset;
  const dragged = useRef(false);
  const firstId = homes[0]?.property_id ?? null;

  // The three resting heights follow the sheet, its header and the first card.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const head = headRef.current;
    if (!panel || !head) return;
    const measure = () => {
      const card = firstCardRef.current;
      const next = detentHeights({
        sheetHeight: panel.offsetHeight,
        headHeight: head.offsetHeight,
        cardHeight: card ? card.offsetHeight : null,
      });
      setHeights((current) => (
        current
        && current.collapsed === next.collapsed
        && current.peek === next.peek
        && current.full === next.full
          ? current
          : next
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(head);
    if (firstCardRef.current) observer.observe(firstCardRef.current);
    return () => observer.disconnect();
  }, [firstId, count === 0]);

  useEffect(() => {
    if (heights) onInsetRef.current?.(mapInsetFor(detent, heights));
  }, [detent, heights]);

  // Leaving the full detent: the list goes back to the top once the sheet has settled.
  useEffect(() => {
    if (detent === "full") return;
    const timer = window.setTimeout(() => bodyRef.current?.scrollTo({ top: 0 }), DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [detent]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let mode: DragMode = "pending";
    let startTarget: EventTarget | null = null;
    let baseVisible = 0;

    const beginDrag = () => {
      mode = "sheet";
      panel.classList.add("is-dragging");
    };
    const endDrag = () => {
      panel.classList.remove("is-dragging");
      // The click that follows this pointerup is swallowed; anything later is real.
      window.setTimeout(() => { dragged.current = false; }, 0);
    };
    const setVisible = (px: number) => {
      panel.style.setProperty("--map-sheet-visible", `${px}px`);
      const full = heightsRef.current?.full;
      if (full != null) panel.style.setProperty("--map-sheet-radius", `${sheetTopRadius(px, full)}px`);
    };
    const listAtTop = () => scrollChainAtTop(startTarget, bodyRef.current);

    return bindPressDrag(panel, {
      onStart: (point, target) => {
        const heights = heightsRef.current;
        if (!heights) return false;
        dragged.current = false;
        startTarget = target;
        startY = point.y;
        lastY = point.y;
        lastT = performance.now();
        velocity = 0;
        baseVisible = heights[detentRef.current];
        const fromHead = Boolean((target as Element | null)?.closest?.(".map-homes-head"));
        mode = fromHead ? "sheet" : "pending";
        if (fromHead) beginDrag();
        return true;
      },
      onMove: (point, event) => {
        const heights = heightsRef.current;
        if (!heights) return;
        const sample = sampleVelocity(lastY, lastT, point.y, performance.now());
        velocity = sample.velocity;
        lastY = sample.lastY;
        lastT = sample.lastT;
        const dy = point.y - startY;
        if (mode === "pending") {
          const next = homesDragMode(dy, detentRef.current, listAtTop());
          if (next === "pending") return;
          if (next === "scroll") {
            mode = "scroll";
            return;
          }
          beginDrag();
        }
        if (mode !== "sheet") return;
        if (event.cancelable) event.preventDefault();
        dragged.current = true;
        setVisible(dragVisibleHeight(baseVisible, dy, heights));
      },
      onEnd: (point) => {
        const heights = heightsRef.current;
        const dy = point.y - startY;
        if (mode === "pending") mode = homesDragMode(dy, detentRef.current, listAtTop());
        endDrag();
        if (mode !== "sheet" || !heights) return;
        const next = settleDetent(detentRef.current, dy, velocity, heights);
        // Snap here so a drag that settles on the same detent still animates back.
        setVisible(heights[next]);
        if (next !== detentRef.current) onDetentRef.current(next);
      },
      onCancel: () => {
        const heights = heightsRef.current;
        endDrag();
        if (mode === "sheet" && heights) setVisible(heights[detentRef.current]);
      },
    });
  }, []);

  const visible = heights ? heights[detent] : 0;
  const style = {
    "--map-sheet-visible": `${visible}px`,
    "--map-sheet-radius": `${heights ? sheetTopRadius(visible, heights.full) : SHEET_TOP_RADIUS}px`,
    visibility: heights ? undefined : "hidden",
  } as CSSProperties;
  const title = homesTitle(count);

  return (
    <div
      ref={panelRef}
      className={`map-homes-sheet is-${detent}${pending ? " is-pending" : ""}`}
      style={style}
      data-testid="map-homes-sheet"
      data-detent={detent}
      onClickCapture={(event) => {
        // A drag that ended on a card should not also open that card.
        if (!dragged.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        ref={headRef}
        type="button"
        className="map-homes-head"
        aria-expanded={detent === "full"}
        aria-controls="map-homes-list"
        data-testid="map-homes-head"
        onClick={() => onDetent(toggleDetent(detent))}
      >
        <i className="map-homes-grabber" aria-hidden="true" />
        <span className="map-homes-title" data-testid="map-homes-title">{title}</span>
      </button>
      <div ref={bodyRef} id="map-homes-list" className="map-homes-body">
        {count === 0 ? (
          <p ref={(node) => { firstCardRef.current = node; }} className="map-homes-empty meta-line">
            Pan or zoom the map to a neighborhood to see the homes there.
          </p>
        ) : (
          <ul className="map-homes-list">
            {homes.map((home, index) => (
              <li key={home.property_id} ref={index === 0 ? (node) => { firstCardRef.current = node; } : undefined}>
                <HomeCard home={home} />
              </li>
            ))}
          </ul>
        )}
        {count !== null && count > homes.length && (
          <p className="map-homes-more meta-line">
            Showing {homes.length} of {count.toLocaleString("en-US")}. Zoom in to see the rest.
          </p>
        )}
      </div>
    </div>
  );
}

function streetLine(home: MapHome): string {
  const street = [home.street_number, home.street_name].filter(Boolean).join(" ");
  if (street) return street;
  return home.formatted?.split(",")[0]?.trim() || "Untitled parcel";
}

function localityLine(home: MapHome): string {
  return [home.municipality, `${home.county} County`].filter(Boolean).join(" · ");
}

function HomeCard({ home }: { home: MapHome }) {
  return (
    <Link className="map-home-card" to={`/property/${home.property_id}`} data-testid="map-home-card">
      <figure className={`map-home-media${home.photo_url ? " has-photo" : " is-map"}`}>
        {home.photo_url ? (
          <img src={home.photo_url} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <ParcelSketch geometry={home.geojson} quality={home.geometry_quality} />
        )}
        {home.photo_count > 0 && (
          <figcaption className="map-home-overlay">
            <span className="hero-pill quiet">{home.photo_count} {home.photo_count === 1 ? "photo" : "photos"}</span>
          </figcaption>
        )}
      </figure>
      <div className="map-home-body">
        <div className="kicker">{localityLine(home)}</div>
        <h3>{streetLine(home)}</h3>
        {home.owners.length > 0 && (
          <div className="owner-bylines">
            {home.owners.map((person) => (
              <span key={person.user_id} className="owner-byline">
                <img src={person.photo_url} alt="" width={16} height={16} />
                <span>{person.label}</span>
              </span>
            ))}
          </div>
        )}
        {home.facts.length > 0 && (
          <dl className="home-facts map-home-facts">
            {home.facts.map((fact) => (
              <div key={fact.key}><dt>{fact.label}</dt><dd>{fact.display}</dd></div>
            ))}
          </dl>
        )}
      </div>
    </Link>
  );
}

/**
 * The lot, drawn as it is on the map, for a home with no photo yet. Rings are
 * projected with the latitude squeeze so the shape reads the same as the
 * tiles, and fitted with a little air around them.
 */
function ParcelSketch({
  geometry,
  quality,
}: {
  geometry: MapHome["geojson"];
  quality: string | null;
}) {
  const rings = ringsOf(geometry);
  const points = rings.flat();
  if (points.length < 3) {
    return (
      <span className="map-home-sketch is-empty" aria-hidden="true">
        <NeighborHouseIcon className="map-home-sketch-icon" />
      </span>
    );
  }
  const lats = points.map((point) => point[1]!);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const squeeze = Math.cos((midLat * Math.PI) / 180);
  const project = ([lng, lat]: number[]): [number, number] => [lng! * squeeze, -lat!];
  const projected = rings.map((ring) => ring.map(project));
  const xs = projected.flat().map((point) => point[0]);
  const ys = projected.flat().map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1e-9;
  const height = Math.max(...ys) - minY || 1e-9;
  const scale = 100 / Math.max(width, height);
  const offsetX = (100 - width * scale) / 2;
  const offsetY = (100 - height * scale) / 2;
  const path = projected
    .map((ring) => ring
      .map(([x, y], index) => `${index === 0 ? "M" : "L"}${((x - minX) * scale + offsetX).toFixed(2)} ${((y - minY) * scale + offsetY).toFixed(2)}`)
      .join(" ") + " Z")
    .join(" ");
  const color = QUALITY_COLORS[quality ?? ""] ?? QUALITY_COLORS.official!;
  return (
    <svg className="map-home-sketch" viewBox="-12 -12 124 124" aria-hidden="true">
      <path d={path} fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ringsOf(geometry: MapHome["geojson"]): number[][][] {
  if (!geometry) return [];
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).map((polygon) => polygon[0] ?? []).filter((ring) => ring.length > 0);
  }
  if (geometry.type === "Polygon") {
    const outer = (geometry.coordinates as number[][][])[0];
    return outer ? [outer] : [];
  }
  return [];
}
