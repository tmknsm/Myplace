import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type Fact, type ParcelCollection, type SearchHit } from "./api";

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
        placeholder="Find a property"
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

function applySelection(
  map: maplibregl.Map,
  geometry?: { type: string; coordinates: number[][][] } | null,
) {
  const source = map.getSource("selected") as maplibregl.GeoJSONSource | undefined;
  if (!source || !geometry) return;
  source.setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  });
  const ring = geometry.coordinates[0];
  if (!ring?.[0]) return;
  const lngs = ring.map((point) => point[0]!);
  const lats = ring.map((point) => point[1]!);
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 48, maxZoom: 16, duration: 0 },
  );
}

export function ParcelMap({
  selectedId,
  selectedGeometry,
  onSelect,
  center = [-73.77, 42.29],
  zoom = 10.2,
  embedded = false,
}: {
  selectedId?: string;
  selectedGeometry?: { type: string; coordinates: number[][][] } | null;
  onSelect?: (id: string) => void;
  center?: [number, number];
  zoom?: number;
  embedded?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const geometryRef = useRef(selectedGeometry);
  onSelectRef.current = onSelect;
  geometryRef.current = selectedGeometry;

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
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    const loadParcels = async () => {
      if (!map.getSource("parcels") || map.getZoom() < 13) {
        const source = map.getSource("parcels") as maplibregl.GeoJSONSource | undefined;
        source?.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const bounds = map.getBounds();
      const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(",");
      const data = await api.parcels(bbox);
      const source = map.getSource("parcels") as maplibregl.GeoJSONSource | undefined;
      source?.setData(data as unknown as ParcelCollection);
    };
    map.on("load", () => {
      map.resize();
      map.addSource("parcels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcels",
        paint: { "fill-color": "#e23b32", "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcels",
        paint: { "line-color": "#e23b32", "line-width": 1 },
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
      void loadParcels();
    });
    map.on("moveend", () => { void loadParcels(); });
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

  return <div ref={ref} className="map-shell" />;
}

export function FactRow({ fact }: { fact: Fact }) {
  return (
    <div className="fact">
      <div className="fact-label">{fact.label}</div>
      <div className="fact-value">
        <strong>{fact.display ?? "—"}</strong>
        {fact.status !== "available" && (
          <span className={`badge ${fact.status}`}>{fact.status}</span>
        )}
        <div className="sources">
          {fact.status === "unknown" && <div>No connected source yet.</div>}
          {fact.assertions.map((assertion) => (
            <div key={assertion.assertionId}>
              {assertion.display} · {assertion.sourceName}
              {assertion.effectiveAt ? ` · ${new Date(assertion.effectiveAt).getFullYear()}` : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    "parcel.imported": "Parcel record imported",
    "assessment.updated": "Assessment updated",
    "sale.recorded": "Recorded sale",
    "ownership.claim_submitted": "Ownership claim submitted",
    "ownership.claimed": "Owner maintainer verified",
    "ownership.claim_rejected": "Ownership claim rejected",
    "ownership.handoff_invited": "Handoff invitation sent",
    "owner_assertion.added": "Owner record updated",
    "document.added": "Document added",
    "assertion.updated": "Assertion updated",
  };
  return labels[type] ?? type;
}
