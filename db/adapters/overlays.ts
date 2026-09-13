import {
  clean,
  fetchJson,
  id,
  recordSnapshot,
  upsertAssertions,
  upsertSources,
  type Asrt,
  type SourceDef,
  type Sql,
} from "../lib.ts";

/**
 * Rules & environment overlays for every parcel that already has a shape.
 *
 *   FEMA NFHL          flood.zone          complete coverage of the two-county bbox
 *   USFWS NWI          wetlands            complete coverage of the two-county bbox
 *   NYS SHPO NR        historic.district   State / National Register polygons
 *   Town + Village of Catskill zoning      zoning.district only where official GIS exists
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

export const OVERLAY_SOURCE_IDS = [
  SRC_FEMA,
  SRC_NWI,
  SRC_SHPO,
  SRC_CATSKILL_TOWN,
  SRC_CATSKILL_VILLAGE,
] as const;

const FEMA_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";
const NWI_URL = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0";
const SHPO_URL =
  "https://services.arcgis.com/1xFZPtKn1wKC6POA/ArcGIS/rest/services/National_Register_Building_Listings/FeatureServer/13";
const CATSKILL_TOWN_URL =
  "https://services8.arcgis.com/MVX6tbvWftyS3KBR/ArcGIS/rest/services/Town_of_Catskill_Zoning_Layers/FeatureServer/0";
const CATSKILL_VILLAGE_URL =
  "https://services8.arcgis.com/MVX6tbvWftyS3KBR/ArcGIS/rest/services/Town_of_Catskill_Zoning_Layers/FeatureServer/1";

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
];

export const NONE_FLOOD = "No FEMA flood hazard zone mapped on this lot";
export const NONE_WETLANDS = "No NWI-mapped wetland on this lot";
export const NONE_HISTORIC = "Not in a listed State or National Register district";

export type OverlayLayer = "flood" | "wetlands" | "historic" | "zoning";

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

export function formatHistoric(hits: HistoricHit[]): string {
  const districts = [...new Set(hits.filter((hit) => hit.typeId === 3).map((hit) => hit.name.trim()).filter(Boolean))];
  const listed = [...new Set(hits.filter((hit) => hit.typeId !== 3).map((hit) => hit.name.trim()).filter(Boolean))];
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

interface IdPage {
  objectIdFieldName?: string;
  objectIds?: number[];
}

function bboxTiles(bbox: string, step = 0.25): string[] {
  const [west, south, east, north] = bbox.split(",").map(Number);
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
    const params = new URLSearchParams({
      f: "geojson",
      objectIds: ids.join(","),
      outFields,
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "5",
      maxAllowableOffset: "0.00015",
    });
    try {
      const page = await fetchJson<GeoJsonPage>(`${endpoint}?${params}`, undefined, 2, 120_000);
      return (page.features ?? []).filter((feature) => feature.geometry);
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
): Promise<number> {
  await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
  await sql.unsafe(`
    CREATE TEMP TABLE ${table} (
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
               ST_SetSRID(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(geojson)), 3), 4326) AS geom
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
      const zone = clean(props.FLD_ZONE);
      if (!zone) return null;
      return {
        label: zone,
        extra: { subtype: clean(props.ZONE_SUBTY), sfha: clean(props.SFHA_TF) },
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
  const features = await fetchArcGisFeatures(NWI_URL, "WETLAND_TYPE", 100);
  const stored = await loadOverlayTable(
    sql,
    "overlay_wetlands",
    featureRows(features, (props) => {
      const type = clean(props.WETLAND_TYPE) ?? "Wetland";
      return { label: type, extra: {} };
    }),
  );
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
      const county = clean(props.CountyName)?.toLowerCase();
      if (county && county !== "columbia" && county !== "greene") return null;
      const name = clean(props.HistoricName);
      if (!name) return null;
      const typeId = Number(props.NominationTypeId);
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
      typeId: typeof hit.extra.typeId === "number" ? hit.extra.typeId : null,
    }));
    const value = formatHistoric(hits);
    if (value !== NONE_HISTORIC) positive += 1;
    rows.push(fact(row.property_id, "historic.district", value, SRC_SHPO, OVERLAY_AS_OF, hits.length ? 0.9 : 0.86));
  }
  await replaceSourceFacts(sql, SRC_SHPO, rows);
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
    const code = clean(props.Zone);
    if (!code) return null;
    return { label: code, extra: { place: "Town of Catskill, 2013 official zoning", priority: 1 } };
  });
  const villageRows = featureRows(villageFeatures, (props) => {
    const code = clean(props.ZONING_DIS);
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

  const rows: Asrt[] = [];
  for (const [propertyId, hits] of hitsByProperty) {
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
      `${rows.length} Catskill parcels received an official zoning district`,
      "Other municipalities stay unknown — no published GIS zoning layer was found",
    ],
  };
}

const LAYERS: Record<OverlayLayer, (sql: Sql) => Promise<OverlayStats>> = {
  flood: importFlood,
  wetlands: importWetlands,
  historic: importHistoric,
  zoning: importZoning,
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
