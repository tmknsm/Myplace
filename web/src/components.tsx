import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type Fact, type SearchHit } from "./api";
import { useMeta } from "./meta";

export function SearchBox({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.search(q).then((data) => {
        setHits(data.results);
        setOpen(true);
      }).catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className={`search-wrap ${compact ? "is-compact" : ""}`} style={compact ? undefined : { position: "relative", maxWidth: "100%" }}>
      <input
        className="search-box"
        value={q}
        autoFocus={autoFocus}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Enter an address"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) navigate(`/property/${hits[0].property_id}`);
        }}
      />
      {open && hits.length > 0 && (
        <div className="search-results">
          {hits.map((hit) => (
            <Link key={hit.property_id} to={`/property/${hit.property_id}`} onClick={() => setOpen(false)}>
              {hit.formatted ?? "Untitled parcel"}
              <small>{hit.sbl} · {hit.municipality}, {hit.county} County</small>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const STYLE = "https://tiles.openfreemap.org/styles/positron";

function ringsOf(geometry: { type: string; coordinates: unknown }): number[][] {
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).flatMap((polygon) => polygon[0] ?? []);
  }
  return ((geometry.coordinates as number[][][])[0] ?? []) as number[][];
}

function applySelection(
  map: maplibregl.Map,
  geometry?: { type: string; coordinates: number[][][] | number[][][][] } | null,
) {
  const source = map.getSource("selected") as maplibregl.GeoJSONSource | undefined;
  if (!source || !geometry) return;
  source.setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  });
  const ring = ringsOf(geometry);
  if (!ring[0]) return;
  const lngs = ring.map((point) => point[0]!);
  const lats = ring.map((point) => point[1]!);
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 48, maxZoom: 16, duration: 0 },
  );
}

const QUALITY_COLORS: Record<string, string> = {
  official: "#1d1d1f",
  approximate: "#c47d1a",
  demonstration: "#e23b32",
};

const QUALITY_LABELS: Record<string, string> = {
  official: "Official lot lines",
  approximate: "Approximate lot lines",
  demonstration: "Demonstration sketch",
};

const QUALITY_ORDER = ["official", "approximate", "demonstration"];

const fillColor: maplibregl.DataDrivenPropertyValueSpecification<string> = [
  "match",
  ["get", "geometryQuality"],
  "official", QUALITY_COLORS.official!,
  "approximate", QUALITY_COLORS.approximate!,
  QUALITY_COLORS.demonstration!,
];

const TILES = {
  url: `${window.location.origin}/api/tiles/{z}/{x}/{y}.mvt`,
  layer: "parcels",
  minZoom: 11,
  maxZoom: 16,
};

export function ParcelMap({
  selectedId,
  selectedGeometry,
  onSelect,
  center = [-73.828, 42.234],
  zoom = 11.6,
  embedded = false,
  visible = true,
  focusKey,
  focusCenter,
  focusZoom,
  legend = false,
}: {
  selectedId?: string;
  selectedGeometry?: { type: string; coordinates: number[][][] | number[][][][] } | null;
  onSelect?: (id: string) => void;
  center?: [number, number];
  zoom?: number;
  embedded?: boolean;
  /** Resize when a hidden carousel slide becomes visible. */
  visible?: boolean;
  focusKey?: string;
  focusCenter?: [number, number];
  focusZoom?: number;
  legend?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const geometryRef = useRef(selectedGeometry);
  const [qualities, setQualities] = useState<string[]>([]);
  const meta = useMeta();
  onSelectRef.current = onSelect;
  geometryRef.current = selectedGeometry;

  useEffect(() => {
    if (!legend || !meta) return;
    const present = new Set<string>(
      meta.counties.filter((county) => county.shapeCount > 0 && county.geometryQuality).map((county) => county.geometryQuality!),
    );
    setQualities(QUALITY_ORDER.filter((quality) => present.has(quality)));
  }, [legend, meta]);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center,
      zoom,
      attributionControl: { compact: true },
      cooperativeGestures: embedded,
      touchPitch: false,
      transformRequest: (url, type) => {
        if (type === "Tile") return { url, headers: { "Accept-Encoding": "identity" } };
        return { url };
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    map.on("load", () => {
      map.resize();
      map.addSource("parcels", {
        type: "vector",
        tiles: [TILES.url],
        minzoom: TILES.minZoom,
        maxzoom: TILES.maxZoom,
        promoteId: "property_id",
      });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcels",
        "source-layer": TILES.layer,
        paint: { "fill-color": fillColor, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.16, 14, 0.28] },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcels",
        "source-layer": TILES.layer,
        paint: {
          "line-color": fillColor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 14, 1.2, 17, 2],
        },
      });
      map.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "selected-fill",
        type: "fill",
        source: "selected",
        paint: { "fill-color": "#e23b32", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "selected-line",
        type: "line",
        source: "selected",
        paint: { "line-color": "#1d1d1f", "line-width": 1.8 },
      });
      map.on("click", "parcel-fill", (event) => {
        const id = event.features?.[0]?.properties?.property_id;
        if (id) onSelectRef.current?.(String(id));
      });
      map.on("mouseenter", "parcel-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "parcel-fill", () => { map.getCanvas().style.cursor = ""; });
      applySelection(map, geometryRef.current);
    });
    const onResize = () => map.resize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    mapRef.current = map;
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      map.remove();
      mapRef.current = null;
    };
    // Initialize once for this mount. Camera updates come from applySelection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    applySelection(map, selectedGeometry);
  }, [selectedId, selectedGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusCenter) return;
    map.flyTo({ center: focusCenter, zoom: focusZoom ?? 15, essential: true, duration: 800 });
  }, [focusKey, focusCenter, focusZoom]);

  useEffect(() => {
    if (!visible) return;
    const map = mapRef.current;
    if (!map) return;
    const resize = () => map.resize();
    const frame = requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return (
    <div className="map-shell">
      <div ref={ref} className="map-canvas" />
      {legend && qualities.length > 0 && (
        <div className="map-legend">
          {qualities.map((quality) => (
            <span key={quality}>
              <i className="swatch" style={{ background: QUALITY_COLORS[quality] }} /> {QUALITY_LABELS[quality]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function unknownHint(fieldKey: string, layer: Fact["layer"]): string {
  if (fieldKey === "zoning.district") return "No published GIS zoning layer for this municipality yet.";
  if (fieldKey === "env.remedial") return "No DEC remedial join for this lot yet.";
  if (fieldKey === "env.bulk_storage") return "No DEC bulk-storage join for this lot yet.";
  if (layer === "owner") return "The owner hasn't filled this in yet.";
  return "No official source yet. The owner can fill this in.";
}

export const STATUS_LABEL: Record<Fact["status"], string> = {
  available: "available",
  unknown: "unknown",
  conflicting: "conflicting",
  inferred: "inferred",
  owner_reported: "owner-reported",
};

export function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    "parcel.imported": "Parcel record imported",
    "parcel.geometry_updated": "Parcel geometry refreshed",
    "assessment.updated": "Assessment updated",
    "sale.recorded": "Recorded sale",
    "ownership.claim_submitted": "Ownership claim submitted",
    "ownership.claimed": "Owner maintainer verified",
    "ownership.claim_rejected": "Ownership claim rejected",
    "ownership.revoked": "Maintainer access ended",
    "ownership.handoff_invited": "Handoff invitation sent",
    "ownership.co_maintainer_invited": "Co-owner invited",
    "ownership.co_maintainer_added": "Co-owner joined the record",
    "owner_assertion.added": "Owner record updated",
    "owner_assertion.removed": "Owner record entry cleared",
    "owner_assertion.visibility_changed": "Owner changed what is shared publicly",
    "assertion.disputed": "Owner disputed an official fact",
    "contribution.withdrawn": "Dispute withdrawn",
    "contribution.accepted": "Contribution accepted",
    "contribution.rejected": "Contribution declined",
    "improvement.added": "Improvement recorded",
    "improvement.updated": "Improvement updated",
    "improvement.removed": "Improvement removed",
    "document.added": "Document added",
    "document.replaced": "Document replaced",
    "document.removed": "Document removed",
    "photo.added": "Photo added",
    "photo.replaced": "Photo replaced",
    "assertion.updated": "Assertion updated",
  };
  return labels[type] ?? type.replace(/[._]/g, " ");
}

export function actorLabel(actorType: string | null | undefined): string | null {
  const labels: Record<string, string> = {
    source: "Official source",
    government: "Official source",
    verified_owner: "Owner",
    platform_admin: "Records desk",
    platform_inference: "Platform inference",
    user: "User",
    debug: "Debug",
  };
  if (!actorType) return null;
  return labels[actorType] ?? actorType;
}
