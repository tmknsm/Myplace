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
    <div className="top-search" style={compact ? undefined : { position: "relative", maxWidth: "100%" }}>
      <input
        className="search-box"
        value={q}
        autoFocus={autoFocus}
        placeholder="Search address, SBL, or municipality"
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

export function ParcelMap({
  selectedId,
  selectedGeometry,
  onSelect,
  center = [-73.77, 42.29],
  zoom = 10.2,
}: {
  selectedId?: string;
  selectedGeometry?: { type: string; coordinates: number[][][] } | null;
  onSelect?: (id: string) => void;
  center?: [number, number];
  zoom?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center,
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("parcels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "parcel-fill",
        type: "fill",
        source: "parcels",
        paint: { "fill-color": "#b4532a", "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: "parcel-line",
        type: "line",
        source: "parcels",
        paint: { "line-color": "#8a3b1c", "line-width": 1.1 },
      });
      map.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "selected-fill",
        type: "fill",
        source: "selected",
        paint: { "fill-color": "#b4532a", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "selected-line",
        type: "line",
        source: "selected",
        paint: { "line-color": "#1b1814", "line-width": 2.2 },
      });
      map.on("click", "parcel-fill", (event) => {
        const id = event.features?.[0]?.properties?.property_id;
        if (id && onSelect) onSelect(String(id));
      });
      map.on("mouseenter", "parcel-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "parcel-fill", () => { map.getCanvas().style.cursor = ""; });
    });
    const loadParcels = async () => {
      if (map.getZoom() < 13) {
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
    map.on("moveend", loadParcels);
    map.on("load", loadParcels);
    mapRef.current = map;
    map.once("load", () => {
      if (selectedGeometry) {
        const source = map.getSource("selected") as maplibregl.GeoJSONSource | undefined;
        source?.setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: selectedGeometry }],
        });
      }
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("selected")) return;
    const source = map.getSource("selected") as maplibregl.GeoJSONSource;
    if (selectedGeometry) {
      source.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: selectedGeometry }],
      });
      const [ring] = selectedGeometry.coordinates;
      if (ring?.[0]) {
        const lngs = ring.map((p) => p[0]!);
        const lats = ring.map((p) => p[1]!);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, maxZoom: 17, duration: 600 },
        );
      }
    }
  }, [selectedId, selectedGeometry]);

  return <div ref={ref} className="maplibre-map" />;
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
