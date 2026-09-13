import proj4 from "proj4";
import {
  clean,
  fetchJson,
  id,
  num,
  recordSnapshot,
  upsertAssertions,
  upsertSources,
  type Asrt,
  type SourceDef,
  type Sql,
} from "../lib.ts";

proj4.defs("EPSG:26918", "+proj=utm +zone=18 +datum=NAD83 +units=m +no_defs");

/**
 * Rules & environment overlays for every parcel that already has a shape.
 *
 *   FEMA NFHL          flood.zone          complete coverage of the two-county bbox
 *   USFWS NWI          wetlands            complete coverage of the two-county bbox
 *   NYS SHPO NR        historic.district   State / National Register polygons
 *   Town + Village of Catskill zoning      zoning.district only where official GIS exists
 *   NYSDEC remedial    env.remedial        points within ~60 m of a lot
 *   NYSDEC bulk tanks  env.bulk_storage    Open Data NY pteg-c78n, same 60 m join
 *
 * Spills are not joined at lot level: the public incidents table has no coordinates.
 *
 * New York has no statewide zoning layer. Hudson, Kinderhook, Chatham, Coxsackie,
 * Athens, Cairo, and the rest of Columbia / Greene publish codes (often as PDFs)
 * but not a public FeatureServer we can join. Those parcels stay unknown rather
 * than inventing a district.
 */

export const OVERLAY_AS_OF = "2026-09-13";
export const OVERLAY_BBOX = "-74.35,41.98,-73.32,42.55";

export const SRC_FEMA = "src_fema_nfhl";
export const SRC_NWI = "src_nwi_wetlands";
export const SRC_SHPO = "src_nys_shpo_nr";
export const SRC_CATSKILL_TOWN = "src_catskill_town_zoning";
export const SRC_CATSKILL_VILLAGE = "src_catskill_village_zoning";
export const SRC_DEC_REMEDIAL = "src_nysdec_remedial";
export const SRC_DEC_TANKS = "src_nysdec_bulk_storage";

export const OVERLAY_SOURCE_IDS = [
  SRC_FEMA,
  SRC_NWI,
  SRC_SHPO,
  SRC_CATSKILL_TOWN,
  SRC_CATSKILL_VILLAGE,
  SRC_DEC_REMEDIAL,
  SRC_DEC_TANKS,
] as const;

const FEMA_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";
const NWI_URL = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0";
const SHPO_URL =
  "https://services.arcgis.com/1xFZPtKn1wKC6POA/ArcGIS/rest/services/National_Register_Building_Listings/FeatureServer/13";
const CATSKILL_TOWN_URL =
  "https://services8.arcgis.com/MVX6tbvWftyS3KBR/ArcGIS/rest/services/Town_of_Catskill_Zoning_Layers/FeatureServer/0";
const CATSKILL_VILLAGE_URL =
  "https://services8.arcgis.com/MVX6tbvWftyS3KBR/ArcGIS/rest/services/Town_of_Catskill_Zoning_Layers/FeatureServer/1";
const DEC_REMEDIAL_URL =
  "https://services6.arcgis.com/DZHaqZm9cxOD4CWM/arcgis/rest/services/Remediation_Sites/FeatureServer/1";
const DEC_TANKS_URL = "https://data.ny.gov/resource/pteg-c78n.json";
const NEAR_METERS = 60;

export const OVERLAY_SOURCES: SourceDef[] = [
  {
    id: SRC_FEMA,
    name: "FEMA National Flood Hazard Layer",
    authority: "Federal Emergency Management Agency",
    type: "government",
    jurisdiction: "United States",
    url: "https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS",
    license: "Public FEMA NFHL flood hazard zones. Not a local flood determination.",
    coverage: "Flood Hazard Zones (NFHL MapServer layer 28) for Columbia and Greene counties",
  },
  {
    id: SRC_NWI,
    name: "National Wetlands Inventory",
    authority: "U.S. Fish and Wildlife Service",
    type: "government",
    jurisdiction: "United States",
    url: "https://www.fws.gov/program/national-wetlands-inventory",
    license: "USFWS NWI wetlands. Screening layer, not a jurisdictional delineation.",
    coverage: "NWI wetland polygons intersecting Columbia and Greene counties",
  },
  {
    id: SRC_SHPO,
    name: "NYS SHPO National Register listings",
    authority: "New York State Historic Preservation Office",
    type: "government",
    jurisdiction: "New York",
    url: "https://parks.ny.gov/shpo/",
    license: "State / National Register building and district polygons from SHPO.",
    coverage: "National Register listings intersecting Columbia and Greene counties",
  },
  {
    id: SRC_CATSKILL_TOWN,
    name: "Town of Catskill official zoning (2013)",
    authority: "Town of Catskill",
    type: "government",
    jurisdiction: "Town of Catskill, Greene County, NY",
    url: CATSKILL_TOWN_URL,
    license: "Official town zoning polygons. Not a substitute for the adopted zoning map at Town Hall.",
    coverage: "Town of Catskill only. Other municipalities have no published GIS zoning layer.",
  },
  {
    id: SRC_CATSKILL_VILLAGE,
    name: "Village of Catskill zoning",
    authority: "Village of Catskill",
    type: "government",
    jurisdiction: "Village of Catskill, Greene County, NY",
    url: CATSKILL_VILLAGE_URL,
    license: "Official village zoning polygons. Village district wins over the surrounding town layer.",
    coverage: "Village of Catskill only.",
  },
  {
    id: SRC_DEC_REMEDIAL,
    name: "NYSDEC remediation sites",
    authority: "New York State Department of Environmental Conservation — Division of Environmental Remediation",
    type: "government",
    jurisdiction: "New York",
    url: "https://dec.ny.gov/environmental-protection/site-cleanup/database-search",
    license: "DEC remediation / brownfield points. Screening layer, not a cleanup determination.",
    coverage: "Remediation Sites FeatureServer points within ~60 m of a Columbia or Greene parcel",
  },
  {
    id: SRC_DEC_TANKS,
    name: "NYSDEC bulk storage facilities",
    authority: "New York State Department of Environmental Conservation",
    type: "government",
    jurisdiction: "New York",
    url: "https://data.ny.gov/d/pteg-c78n",
    license: "Open Data NY pteg-c78n. Facility-level petroleum / chemical / major oil storage, not a tank inspection.",
    coverage: "Columbia and Greene facilities joined to lots within ~60 m",
  },
];

export const NONE_FLOOD = "No FEMA flood hazard zone mapped on this lot";
export const NONE_WETLANDS = "No NWI-mapped wetland on this lot";
export const NONE_HISTORIC = "Not in a listed State or National Register district";
export const NONE_REMEDIAL = "No NYSDEC remedial or brownfield site mapped on or immediately next to this lot";
export const NONE_TANKS = "No NYSDEC bulk storage facility mapped on or immediately next to this lot";

export type OverlayLayer = "flood" | "wetlands" | "historic" | "zoning" | "remedial" | "tanks";

export interface OverlayStats {
  layer: OverlayLayer;
  features: number;
  assertions: number;
  positive: number;
  notes: string[];
}

interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
}

interface GeoJsonPage {
  type?: string;
  features?: GeoJsonFeature[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
  error?: { message?: string; code?: number };
}

interface EsriFeature {
  attributes?: Record<string, unknown>;
  geometry?: { rings?: number[][][]; x?: number; y?: number };
}

interface EsriPage {
  features?: EsriFeature[];
  error?: { message?: string; code?: number };
}

export interface FloodHit {
  zone: string;
  subtype: string | null;
  sfha: string | null;
}

export interface HistoricHit {
  name: string;
  typeId: number | null;
}

export interface ZoningHit {
  code: string;
  place: string;
  priority: number;
}

export function floodZoneRank(zone: string, subtype?: string | null): number {
  const z = zone.trim().toUpperCase();
  const sub = (subtype ?? "").toUpperCase();
  if (/^V/.test(z)) return 100;
  if (z.startsWith("A")) return 80;
  if (z === "D") return 40;
  if (z === "X" || z === "B" || z === "C") {
    if (/0\.2|500|SHADED/.test(sub)) return 25;
    return 10;
  }
  if (/OPEN WATER|AREA NOT INCLUDED/.test(z)) return 5;
  return 30;
}

export function formatFloodZone(zone: string, subtype?: string | null): string {
  const z = zone.trim().toUpperCase();
  const sub = (subtype ?? "").trim();
  if (z === "X" && /0\.2|500|SHADED/i.test(sub)) return "X — 0.2% annual-chance (500-year)";
  const meaning: Record<string, string> = {
    VE: "coastal high hazard (1% annual-chance wave action)",
    V: "coastal high hazard (1% annual-chance wave action)",
    AE: "1% annual-chance floodplain",
    A: "1% annual-chance floodplain",
    AH: "1% annual-chance shallow flooding",
    AO: "1% annual-chance sheet flow",
    AR: "1% annual-chance floodplain (restored levee)",
    A99: "1% annual-chance floodplain (federal flood-control system)",
    D: "undetermined flood hazard",
    X: "minimal flood hazard",
    C: "minimal flood hazard",
    B: "moderate flood hazard",
  };
  if (meaning[z]) return `${z} — ${meaning[z]}`;
  return sub ? `${z} — ${sub}` : z;
}

export function pickFloodLabel(hits: FloodHit[]): string {
  if (!hits.length) return NONE_FLOOD;
  const best = [...hits].sort((a, b) => floodZoneRank(b.zone, b.subtype) - floodZoneRank(a.zone, a.subtype))[0]!;
  return formatFloodZone(best.zone, best.subtype);
}

export function formatWetlands(types: string[]): string {
  const unique = [...new Set(types.map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!unique.length) return NONE_WETLANDS;
  return `NWI: ${unique.join("; ")}`;
}

function asInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isHistoricDistrict(hit: HistoricHit): boolean {
  return asInt(hit.typeId) === 3 || /historic\s+district/i.test(hit.name);
}

export function formatHistoric(hits: HistoricHit[]): string {
  const districts = [...new Set(hits.filter(isHistoricDistrict).map((hit) => hit.name.trim()).filter(Boolean))];
  const listed = [...new Set(hits.filter((hit) => !isHistoricDistrict(hit)).map((hit) => hit.name.trim()).filter(Boolean))];
  const parts: string[] = [];
  for (const name of districts) parts.push(`Historic district: ${name}`);
  if (!districts.length) {
    for (const name of listed) {
      parts.push(`Listed: ${name} (individual National Register listing, not a district)`);
    }
  }
  return parts.length ? parts.join("; ") : NONE_HISTORIC;
}

export function formatZoning(hits: ZoningHit[]): string | null {
  if (!hits.length) return null;
  const seen = new Set<string>();
  const ordered = [...hits].sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code));
  const parts: string[] = [];
  for (const hit of ordered) {
    const key = `${hit.place}|${hit.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${hit.code} (${hit.place})`);
  }
  return parts.length ? parts.join("; ") : null;
}

export interface RemedialHit {
  name: string;
  program: string | null;
  siteClass: string | null;
  siteCode: string | null;
}

export interface TankHit {
  name: string;
  programType: string | null;
  status: string | null;
  locality: string | null;
  programNumber: string | null;
}

const TANK_PROGRAM: Record<string, string> = {
  CBS: "chemical bulk storage",
  PBS: "petroleum bulk storage",
  MOSF: "major oil storage",
};

function capLabels(parts: string[], extra: number): string {
  if (extra > 0) parts.push(`${extra} more`);
  return parts.join("; ");
}

export function formatRemedial(hits: RemedialHit[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const name = hit.name.trim();
    if (!name) continue;
    const key = (hit.siteCode ?? name).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const bits = [clean(hit.program), hit.siteClass ? `class ${hit.siteClass}` : null].filter(Boolean);
    parts.push(bits.length ? `${name} (${bits.join(", ")})` : name);
  }
  if (!parts.length) return NONE_REMEDIAL;
  return capLabels(parts.slice(0, 3), Math.max(0, parts.length - 3));
}

export function formatBulkStorage(hits: TankHit[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const name = hit.name.trim();
    if (!name) continue;
    const key = (hit.programNumber ?? name).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = TANK_PROGRAM[hit.programType?.toUpperCase() ?? ""] ?? clean(hit.programType);
    const status = clean(hit.status);
    const locality = clean(hit.locality);
    const detail = [kind, status].filter(Boolean).join(", ");
    const place = locality ? ` (${locality})` : "";
    parts.push(detail ? `${name} — ${detail}${place}` : `${name}${place}`);
  }
  if (!parts.length) return NONE_TANKS;
  return capLabels(parts.slice(0, 3), Math.max(0, parts.length - 3));
}

interface IdPage {
  objectIdFieldName?: string;
  objectIds?: number[];
}

/** Read a field from GeoJSON or qualified ArcGIS join aliases (`Wetlands.WETLAND_TYPE`). */
export function attr(props: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (props[name] != null && props[name] !== "") return props[name];
    const suffix = name.includes(".") ? name.split(".").pop()! : name;
    for (const [key, value] of Object.entries(props)) {
      if ((key === suffix || key.endsWith(`.${suffix}`)) && value != null && value !== "") return value;
    }
  }
  return undefined;
}

function bboxTiles(bbox: string, step = 0.25): string[] {
  const parts = bbox.split(",").map(Number);
  const west = parts[0];
  const south = parts[1];
  const east = parts[2];
  const north = parts[3];
  if (
    west === undefined || south === undefined || east === undefined || north === undefined
    || [west, south, east, north].some((n) => Number.isNaN(n))
  ) {
    return [bbox];
  }
  const tiles: string[] = [];
  for (let x = west; x < east - 1e-9; x += step) {
    for (let y = south; y < north - 1e-9; y += step) {
      tiles.push([x, y, Math.min(x + step, east), Math.min(y + step, north)].join(","));
    }
  }
  return tiles.length ? tiles : [bbox];
}

async function fetchObjectIds(endpoint: string, bbox: string): Promise<number[]> {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: bbox,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnIdsOnly: "true",
  });
  const page = await fetchJson<IdPage>(`${endpoint}?${params}`, undefined, 3, 90_000);
  return page.objectIds ?? [];
}

async function fetchArcGisFeatures(
  layerUrl: string,
  outFields: string,
  pageSize = 80,
): Promise<GeoJsonFeature[]> {
  const endpoint = `${layerUrl.replace(/\/$/, "")}/query`;
  const objectIds = new Set<number>();
  for (const tile of bboxTiles(OVERLAY_BBOX)) {
    try {
      const ids = await fetchObjectIds(endpoint, tile);
      for (const objectId of ids) objectIds.add(objectId);
    } catch (error) {
      console.warn(`    id query failed for ${tile}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const idList = [...objectIds];
  if (idList.length === 0) {
    console.log("    0 features");
    return [];
  }
  console.log(`    ${idList.length} object ids`);
  const features: GeoJsonFeature[] = [];
  const fetchBatch = async (ids: number[]): Promise<GeoJsonFeature[]> => {
    const shared = {
      objectIds: ids.join(","),
      outFields,
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "5",
      maxAllowableOffset: "0.00015",
    };
    try {
      const geo = await fetchJson<GeoJsonPage>(`${endpoint}?${new URLSearchParams({ f: "geojson", ...shared })}`, undefined, 2, 120_000);
      if (geo.error) throw new Error(geo.error.message ?? `ArcGIS error ${geo.error.code}`);
      const fromGeo = (geo.features ?? []).filter((feature) => feature.geometry);
      if (fromGeo.length) return fromGeo;
      const esri = await fetchJson<EsriPage>(`${endpoint}?${new URLSearchParams({ f: "json", ...shared })}`, undefined, 2, 120_000);
      if (esri.error) throw new Error(esri.error.message ?? `ArcGIS error ${esri.error.code}`);
      return (esri.features ?? []).flatMap((feature): GeoJsonFeature[] => {
        const rings = feature.geometry?.rings;
        if (rings?.length) {
          return [{
            type: "Feature",
            properties: feature.attributes ?? {},
            geometry: { type: "Polygon", coordinates: rings },
          }];
        }
        const x = feature.geometry?.x;
        const y = feature.geometry?.y;
        if (typeof x === "number" && typeof y === "number") {
          return [{
            type: "Feature",
            properties: feature.attributes ?? {},
            geometry: { type: "Point", coordinates: [x, y] },
          }];
        }
        return [];
      });
    } catch (error) {
      if (ids.length === 1) {
        console.warn(`    skipped object ${ids[0]}: ${error instanceof Error ? error.message : error}`);
        return [];
      }
      const mid = Math.ceil(ids.length / 2);
      return [...await fetchBatch(ids.slice(0, mid)), ...await fetchBatch(ids.slice(mid))];
    }
  };
  for (let i = 0; i < idList.length; i += pageSize) {
    features.push(...await fetchBatch(idList.slice(i, i + pageSize)));
    console.log(`    ${features.length}/${idList.length} features`);
  }
  return features;
}

async function loadOverlayTable(
  sql: Sql,
  table: string,
  rows: Array<{ label: string; extra: Record<string, unknown>; geojson: string }>,
  mode: "polygon" | "any" = "polygon",
): Promise<number> {
  // UNLOGGED (not TEMP): the importer uses a connection pool, so a temp table
  // created on one client is invisible to the next query.
  await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
  await sql.unsafe(`
    CREATE UNLOGGED TABLE ${table} (
      label text NOT NULL,
      extra jsonb NOT NULL DEFAULT '{}'::jsonb,
      geom geometry(Geometry, 4326) NOT NULL
    )
  `);
  let stored = 0;
  const size = 250;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    const result = await sql`
      WITH input AS (
        SELECT *
        FROM unnest(
          ${batch.map((row) => row.label)}::text[],
          ${batch.map((row) => JSON.stringify(row.extra))}::jsonb[],
          ${batch.map((row) => row.geojson)}::text[]
        ) AS t(label, extra, geojson)
      ),
      shaped AS (
        SELECT label, extra,
               ST_SetSRID(
                 ${mode === "polygon"
                   ? sql.unsafe("ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(geojson)), 3)")
                   : sql.unsafe("ST_MakeValid(ST_GeomFromGeoJSON(geojson))")},
                 4326
               ) AS geom
        FROM input
      )
      INSERT INTO ${sql(table)} (label, extra, geom)
      SELECT label, extra, geom
      FROM shaped
      WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
    `;
    stored += result.count;
  }
  await sql.unsafe(`CREATE INDEX ${table}_gix ON ${table} USING GIST (geom)`);
  return stored;
}

async function dropOverlayTable(sql: Sql, table: string): Promise<void> {
  await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
}

interface JoinHit {
  property_id: string;
  hits: unknown;
}

async function intersectProperties(sql: Sql, table: string): Promise<JoinHit[]> {
  return sql<JoinHit[]>`
    SELECT pg.property_id,
           COALESCE(
             json_agg(json_build_object('label', o.label, 'extra', o.extra))
               FILTER (WHERE o.label IS NOT NULL),
             '[]'::json
           ) AS hits
    FROM property_geometries pg
    LEFT JOIN ${sql(table)} o ON ST_Intersects(pg.geom, o.geom)
    WHERE pg.is_current
    GROUP BY pg.property_id
  `;
}

async function nearProperties(sql: Sql, table: string, meters = NEAR_METERS): Promise<JoinHit[]> {
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS ${table}_geog ON ${table} USING GIST (geography(geom))`);
  return sql<JoinHit[]>`
    SELECT pg.property_id,
           COALESCE(
             json_agg(json_build_object('label', o.label, 'extra', o.extra))
               FILTER (WHERE o.label IS NOT NULL),
             '[]'::json
           ) AS hits
    FROM property_geometries pg
    LEFT JOIN ${sql(table)} o ON ST_DWithin(pg.geom::geography, o.geom::geography, ${meters})
    WHERE pg.is_current
    GROUP BY pg.property_id
  `;
}

function parseHits(raw: unknown): Array<{ label: string; extra: Record<string, unknown> }> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { label?: unknown; extra?: unknown };
    const label = clean(row.label);
    if (!label) return [];
    const extra = row.extra && typeof row.extra === "object" && !Array.isArray(row.extra)
      ? (row.extra as Record<string, unknown>)
      : {};
    return [{ label, extra }];
  });
}

function fact(
  propertyId: string,
  fieldKey: string,
  value: string,
  sourceId: string,
  effective: string,
  confidence: number,
): Asrt {
  return {
    assertion_id: id("ast", `${propertyId}|${fieldKey}|${sourceId}|${effective}`),
    property_id: propertyId,
    field_key: fieldKey,
    value_json: { value },
    source_id: sourceId,
    source_type: "government",
    effective_at: effective,
    observed_at: OVERLAY_AS_OF,
    confidence,
    status: "accepted",
  };
}

async function replaceSourceFacts(sql: Sql, sourceId: string, rows: Asrt[]): Promise<void> {
  await sql`DELETE FROM assertions WHERE source_id = ${sourceId}`;
  await upsertAssertions(sql, rows);
}

function featureRows(
  features: GeoJsonFeature[],
  pick: (props: Record<string, unknown>) => { label: string; extra: Record<string, unknown> } | null,
): Array<{ label: string; extra: Record<string, unknown>; geojson: string }> {
  const rows: Array<{ label: string; extra: Record<string, unknown>; geojson: string }> = [];
  for (const feature of features) {
    if (!feature.geometry) continue;
    const picked = pick(feature.properties ?? {});
    if (!picked) continue;
    rows.push({ ...picked, geojson: JSON.stringify(feature.geometry) });
  }
  return rows;
}

export async function importFlood(sql: Sql): Promise<OverlayStats> {
  console.log("Overlays: FEMA NFHL flood hazard zones…");
  const features = await fetchArcGisFeatures(FEMA_URL, "FLD_ZONE,ZONE_SUBTY,SFHA_TF", 40);
  const stored = await loadOverlayTable(
    sql,
    "overlay_flood",
    featureRows(features, (props) => {
      const zone = clean(attr(props, "FLD_ZONE"));
      if (!zone) return null;
      return {
        label: zone,
        extra: { subtype: clean(attr(props, "ZONE_SUBTY")), sfha: clean(attr(props, "SFHA_TF")) },
      };
    }),
  );
  const joined = await intersectProperties(sql, "overlay_flood");
  const rows: Asrt[] = [];
  let positive = 0;
  for (const row of joined) {
    const hits: FloodHit[] = parseHits(row.hits).map((hit) => ({
      zone: hit.label,
      subtype: clean(hit.extra.subtype),
      sfha: clean(hit.extra.sfha),
    }));
    const value = pickFloodLabel(hits);
    if (value !== NONE_FLOOD) positive += 1;
    rows.push(fact(row.property_id, "flood.zone", value, SRC_FEMA, OVERLAY_AS_OF, hits.length ? 0.92 : 0.88));
  }
  await replaceSourceFacts(sql, SRC_FEMA, rows);
  await dropOverlayTable(sql, "overlay_flood");
  await recordSnapshot(sql, "snp_fema_nfhl", SRC_FEMA, `${stored} flood polygons → ${rows.length} parcel facts`);
  return {
    layer: "flood",
    features: stored,
    assertions: rows.length,
    positive,
    notes: [`${positive} parcels in a mapped FEMA zone; ${rows.length - positive} with no intersecting NFHL polygon`],
  };
}

export async function importWetlands(sql: Sql): Promise<OverlayStats> {
  console.log("Overlays: USFWS National Wetlands Inventory…");
  const features = await fetchArcGisFeatures(NWI_URL, "Wetlands.WETLAND_TYPE", 80);
  const stored = await loadOverlayTable(
    sql,
    "overlay_wetlands",
    featureRows(features, (props) => {
      const type = clean(attr(props, "Wetlands.WETLAND_TYPE", "WETLAND_TYPE")) ?? "Wetland";
      return { label: type, extra: {} };
    }),
  );
  if (stored === 0) {
    await dropOverlayTable(sql, "overlay_wetlands");
    return {
      layer: "wetlands",
      features: 0,
      assertions: 0,
      positive: 0,
      notes: ["NWI returned no usable polygons; left wetlands unchanged rather than writing false negatives"],
    };
  }
  const joined = await intersectProperties(sql, "overlay_wetlands");
  const rows: Asrt[] = [];
  let positive = 0;
  for (const row of joined) {
    const types = parseHits(row.hits).map((hit) => hit.label);
    const value = formatWetlands(types);
    if (value !== NONE_WETLANDS) positive += 1;
    rows.push(fact(row.property_id, "wetlands", value, SRC_NWI, OVERLAY_AS_OF, types.length ? 0.9 : 0.86));
  }
  await replaceSourceFacts(sql, SRC_NWI, rows);
  await dropOverlayTable(sql, "overlay_wetlands");
  await recordSnapshot(sql, "snp_nwi_wetlands", SRC_NWI, `${stored} wetland polygons → ${rows.length} parcel facts`);
  return {
    layer: "wetlands",
    features: stored,
    assertions: rows.length,
    positive,
    notes: [`${positive} parcels intersect an NWI wetland`],
  };
}

export async function importHistoric(sql: Sql): Promise<OverlayStats> {
  console.log("Overlays: NYS SHPO National Register listings…");
  const features = await fetchArcGisFeatures(SHPO_URL, "HistoricName,NominationTypeId,CountyName,CityTown");
  const stored = await loadOverlayTable(
    sql,
    "overlay_historic",
    featureRows(features, (props) => {
      const county = clean(attr(props, "CountyName"))?.toLowerCase();
      if (county && county !== "columbia" && county !== "greene") return null;
      const name = clean(attr(props, "HistoricName"));
      if (!name) return null;
      const typeId = Number(attr(props, "NominationTypeId"));
      return {
        label: name,
        extra: { typeId: Number.isFinite(typeId) ? typeId : null },
      };
    }),
  );
  const joined = await intersectProperties(sql, "overlay_historic");
  const rows: Asrt[] = [];
  let positive = 0;
  for (const row of joined) {
    const hits: HistoricHit[] = parseHits(row.hits).map((hit) => ({
      name: hit.label,
      typeId: asInt(hit.extra.typeId),
    }));
    const value = formatHistoric(hits);
    if (value !== NONE_HISTORIC) positive += 1;
    rows.push(fact(row.property_id, "historic.district", value, SRC_SHPO, OVERLAY_AS_OF, hits.length ? 0.9 : 0.86));
  }
  await replaceSourceFacts(sql, SRC_SHPO, rows);
  await dropOverlayTable(sql, "overlay_historic");
  await recordSnapshot(sql, "snp_nys_shpo_nr", SRC_SHPO, `${stored} register polygons → ${rows.length} parcel facts`);
  return {
    layer: "historic",
    features: stored,
    assertions: rows.length,
    positive,
    notes: [`${positive} parcels intersect a State or National Register listing or district`],
  };
}

export async function importZoning(sql: Sql): Promise<OverlayStats> {
  console.log("Overlays: Town and Village of Catskill official zoning…");
  const [townFeatures, villageFeatures] = await Promise.all([
    fetchArcGisFeatures(CATSKILL_TOWN_URL, "Zone"),
    fetchArcGisFeatures(CATSKILL_VILLAGE_URL, "ZONING_DIS"),
  ]);
  const townRows = featureRows(townFeatures, (props) => {
    const code = clean(attr(props, "Zone"));
    if (!code) return null;
    return { label: code, extra: { place: "Town of Catskill, 2013 official zoning", priority: 1 } };
  });
  const villageRows = featureRows(villageFeatures, (props) => {
    const code = clean(attr(props, "ZONING_DIS"));
    if (!code) return null;
    return { label: code, extra: { place: "Village of Catskill zoning", priority: 2 } };
  });
  const storedTown = await loadOverlayTable(sql, "overlay_zoning_town", townRows);
  const storedVillage = await loadOverlayTable(sql, "overlay_zoning_village", villageRows);
  const [townJoin, villageJoin] = await Promise.all([
    intersectProperties(sql, "overlay_zoning_town"),
    intersectProperties(sql, "overlay_zoning_village"),
  ]);
  const hitsByProperty = new Map<string, ZoningHit[]>();
  const addHits = (joined: JoinHit[], fallbackPlace: string, fallbackPriority: number) => {
    for (const row of joined) {
      const list = hitsByProperty.get(row.property_id) ?? [];
      for (const hit of parseHits(row.hits)) {
        list.push({
          code: hit.label,
          place: clean(hit.extra.place) ?? fallbackPlace,
          priority: typeof hit.extra.priority === "number" ? hit.extra.priority : fallbackPriority,
        });
      }
      if (list.length) hitsByProperty.set(row.property_id, list);
    }
  };
  addHits(townJoin, "Town of Catskill, 2013 official zoning", 1);
  addHits(villageJoin, "Village of Catskill zoning", 2);

  const allowed = new Set(
    (await sql<{ property_id: string }[]>`
      SELECT property_id FROM properties
      WHERE county = 'Greene' AND municipality = 'Catskill'
    `).map((row) => row.property_id),
  );
  const rows: Asrt[] = [];
  for (const [propertyId, hits] of hitsByProperty) {
    if (!allowed.has(propertyId)) continue;
    const value = formatZoning(hits);
    if (!value) continue;
    const village = hits.some((hit) => hit.priority >= 2);
    rows.push(
      fact(
        propertyId,
        "zoning.district",
        value,
        village ? SRC_CATSKILL_VILLAGE : SRC_CATSKILL_TOWN,
        "2013-01-01",
        0.93,
      ),
    );
  }
  await replaceSourceFacts(sql, SRC_CATSKILL_TOWN, rows.filter((row) => row.source_id === SRC_CATSKILL_TOWN));
  await replaceSourceFacts(sql, SRC_CATSKILL_VILLAGE, rows.filter((row) => row.source_id === SRC_CATSKILL_VILLAGE));
  await dropOverlayTable(sql, "overlay_zoning_town");
  await dropOverlayTable(sql, "overlay_zoning_village");
  await recordSnapshot(
    sql,
    "snp_catskill_town_zoning",
    SRC_CATSKILL_TOWN,
    `${storedTown} town polygons → ${rows.filter((row) => row.source_id === SRC_CATSKILL_TOWN).length} facts`,
  );
  await recordSnapshot(
    sql,
    "snp_catskill_village_zoning",
    SRC_CATSKILL_VILLAGE,
    `${storedVillage} village polygons → ${rows.filter((row) => row.source_id === SRC_CATSKILL_VILLAGE).length} facts`,
  );
  return {
    layer: "zoning",
    features: storedTown + storedVillage,
    assertions: rows.length,
    positive: rows.length,
    notes: [
      `${rows.length} Town/Village of Catskill parcels received an official zoning district`,
      "Other municipalities stay unknown — no published GIS zoning layer was found",
    ],
  };
}

export async function importRemedial(sql: Sql): Promise<OverlayStats> {
  console.log("Overlays: NYSDEC remediation sites…");
  const features = await fetchArcGisFeatures(DEC_REMEDIAL_URL, "SITENAME,PROGRAM,SITECLASS,SITECODE,COUNTY,DETAIL_URL", 80);
  const stored = await loadOverlayTable(
    sql,
    "overlay_remedial",
    featureRows(features, (props) => {
      const name = clean(attr(props, "SITENAME"));
      if (!name) return null;
      return {
        label: name,
        extra: {
          program: clean(attr(props, "PROGRAM")),
          siteClass: clean(attr(props, "SITECLASS")),
          siteCode: clean(attr(props, "SITECODE")),
        },
      };
    }),
    "any",
  );
  const joined = await nearProperties(sql, "overlay_remedial");
  const rows: Asrt[] = [];
  let positive = 0;
  for (const row of joined) {
    const hits: RemedialHit[] = parseHits(row.hits).map((hit) => ({
      name: hit.label,
      program: clean(hit.extra.program),
      siteClass: clean(hit.extra.siteClass),
      siteCode: clean(hit.extra.siteCode),
    }));
    const value = formatRemedial(hits);
    if (value !== NONE_REMEDIAL) positive += 1;
    rows.push(fact(row.property_id, "env.remedial", value, SRC_DEC_REMEDIAL, OVERLAY_AS_OF, hits.length ? 0.88 : 0.82));
  }
  await replaceSourceFacts(sql, SRC_DEC_REMEDIAL, rows);
  await dropOverlayTable(sql, "overlay_remedial");
  await recordSnapshot(sql, "snp_nysdec_remedial", SRC_DEC_REMEDIAL, `${stored} DEC sites → ${rows.length} parcel facts`);
  return {
    layer: "remedial",
    features: stored,
    assertions: rows.length,
    positive,
    notes: [`${positive} parcels within ${NEAR_METERS} m of a NYSDEC remedial or brownfield site`],
  };
}

interface TankRow {
  program_number?: string;
  program_type?: string;
  program_facility_name?: string;
  site_status_name?: string;
  locality?: string;
  county?: string;
  utmx?: string;
  utmy?: string;
  georeference?: { type?: string; coordinates?: number[] };
}

function tankCoord(row: TankRow): [number, number] | null {
  const coords = row.georeference?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  const east = num(row.utmx);
  const north = num(row.utmy);
  if (east === null || north === null) return null;
  const [lng, lat] = proj4("EPSG:26918", "WGS84", [east, north]) as [number, number];
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

async function fetchTankRows(): Promise<TankRow[]> {
  const rows: TankRow[] = [];
  const page = 5000;
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      $where: "county in ('Columbia','Greene')",
      $limit: String(page),
      $offset: String(offset),
      $order: "program_number",
    });
    const batch = await fetchJson<TankRow[]>(`${DEC_TANKS_URL}?${params}`);
    rows.push(...batch);
    process.stdout.write(`    bulk storage rows: ${rows.length}\r`);
    if (batch.length < page) break;
    offset += page;
  }
  console.log(`    bulk storage rows: ${rows.length}`);
  return rows;
}

export async function importTanks(sql: Sql): Promise<OverlayStats> {
  console.log("Overlays: NYSDEC bulk storage facilities…");
  const raw = await fetchTankRows();
  const grouped = new Map<string, TankRow[]>();
  for (const row of raw) {
    const programNumber = clean(row.program_number);
    if (!programNumber) continue;
    const list = grouped.get(programNumber) ?? [];
    list.push(row);
    grouped.set(programNumber, list);
  }
  const sites: Array<{ label: string; extra: Record<string, unknown>; geojson: string }> = [];
  for (const [programNumber, list] of grouped) {
    const located = list.find((row) => tankCoord(row));
    const coord = located ? tankCoord(located) : null;
    if (!coord) continue;
    const active = list.find((row) => /active/i.test(clean(row.site_status_name) ?? ""));
    const pick = active ?? located!;
    const name = clean(pick.program_facility_name) ?? programNumber;
    sites.push({
      label: name,
      extra: {
        programType: clean(pick.program_type),
        status: clean(pick.site_status_name),
        locality: clean(pick.locality),
        programNumber,
      },
      geojson: JSON.stringify({ type: "Point", coordinates: coord }),
    });
  }
  const stored = await loadOverlayTable(sql, "overlay_tanks", sites, "any");
  const joined = await nearProperties(sql, "overlay_tanks");
  const rows: Asrt[] = [];
  let positive = 0;
  for (const row of joined) {
    const hits: TankHit[] = parseHits(row.hits).map((hit) => ({
      name: hit.label,
      programType: clean(hit.extra.programType),
      status: clean(hit.extra.status),
      locality: clean(hit.extra.locality),
      programNumber: clean(hit.extra.programNumber),
    }));
    const value = formatBulkStorage(hits);
    if (value !== NONE_TANKS) positive += 1;
    rows.push(fact(row.property_id, "env.bulk_storage", value, SRC_DEC_TANKS, OVERLAY_AS_OF, hits.length ? 0.88 : 0.82));
  }
  await replaceSourceFacts(sql, SRC_DEC_TANKS, rows);
  await dropOverlayTable(sql, "overlay_tanks");
  await recordSnapshot(sql, "snp_nysdec_bulk_storage", SRC_DEC_TANKS, `${stored} facilities → ${rows.length} parcel facts`);
  return {
    layer: "tanks",
    features: stored,
    assertions: rows.length,
    positive,
    notes: [`${positive} parcels within ${NEAR_METERS} m of a NYSDEC bulk storage facility`],
  };
}

const LAYERS: Record<OverlayLayer, (sql: Sql) => Promise<OverlayStats>> = {
  flood: importFlood,
  wetlands: importWetlands,
  historic: importHistoric,
  zoning: importZoning,
  remedial: importRemedial,
  tanks: importTanks,
};

export async function importOverlays(sql: Sql, only?: OverlayLayer[]): Promise<OverlayStats[]> {
  await upsertSources(sql, OVERLAY_SOURCES);
  const wanted = only?.length ? only : (Object.keys(LAYERS) as OverlayLayer[]);
  const results: OverlayStats[] = [];
  for (const layer of wanted) {
    try {
      results.push(await LAYERS[layer](sql));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${layer} failed: ${message}`);
      results.push({
        layer,
        features: 0,
        assertions: 0,
        positive: 0,
        notes: [`failed: ${message}`],
      });
    }
  }
  return results;
}
