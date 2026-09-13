import proj4 from "proj4";
import {
  clean,
  emptyBatch,
  expandSuffix,
  fetchJson,
  id,
  num,
  pushFacts,
  recordSnapshot,
  upsertSources,
  writeBatch,
  type Batch,
  type Sql,
} from "../lib.ts";

/**
 * Columbia County does not authorize NYS to redistribute its tax-map polygons, so this
 * adapter joins the statewide ORPTS assessment roll (Open Data NY) with approximate
 * shapes: an OpenStreetMap building footprint when an address matches, otherwise a
 * rectangle placed from the roll's NY East grid coordinates. Both are labeled
 * "approximate" and are never presented as the county tax map.
 */

const ORPTS = "https://data.ny.gov/resource/7vem-aaz7.json";
export const COLUMBIA_ROLL_YEAR = "2025";
const PRIOR_YEAR = "2024";
const PAGE = 5000;
const BOUNDS = { west: -73.95, south: 41.98, east: -73.32, north: 42.55 };

// NAD83 / New York East (ftUS), Transverse Mercator — EPSG:2260
proj4.defs(
  "EPSG:2260",
  "+proj=tmerc +lat_0=38.8333333333333 +lon_0=-74.5 +k=0.9999 +x_0=492125.9842519685 +y_0=0 +datum=NAD83 +units=us-ft +no_defs",
);

type RollRow = Record<string, string | undefined>;

function streetName(row: RollRow): string {
  return [clean(row.parcel_address_street), expandSuffix(row.parcel_address_suff)].filter(Boolean).join(" ");
}

/**
 * The roll only carries the owner's mailing ZIP. Use it for the parcel when the owner
 * is mailed at the parcel itself (same house number and street, NY), otherwise leave
 * the ZIP blank rather than attach an out-of-town mailing code to the lot.
 */
function parcelZip(row: RollRow): string | null {
  const zip = clean(row.mailing_address_zip)?.slice(0, 5);
  if (!zip || clean(row.mailing_address_state) !== "NY") return null;
  const number = clean(row.parcel_address_number)?.toLowerCase();
  const mailNumber = clean(row.mailing_address_number)?.toLowerCase();
  if (!number || number !== mailNumber) return null;
  const street = normalizeStreet(streetName(row));
  const mailStreet = normalizeStreet(
    [clean(row.mailing_address_street), expandSuffix(row.mailing_address_suff)].filter(Boolean).join(" "),
  );
  return street && street === mailStreet ? zip : null;
}

function formattedAddress(row: RollRow): string {
  const line = [clean(row.parcel_address_number), streetName(row)].filter(Boolean).join(" ");
  const city = clean(row.municipality_name) ?? "Columbia County";
  const zip = parcelZip(row);
  return [line || "Unnamed parcel", `${city}, NY${zip ? ` ${zip}` : ""}`].join(", ");
}

function ownerName(row: RollRow): string | null {
  const parts = [
    row.primary_owner_first_name,
    row.primary_owner_mi,
    row.primary_owner_last_name,
    row.primary_owner_suffix,
  ].map((part) => clean(part)).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function propertyClass(row: RollRow): string | null {
  const code = clean(row.property_class);
  const desc = clean(row.property_class_description);
  if (code && desc) return `${code} ${desc}`;
  return desc ?? code;
}

function parcelKey(row: RollRow): string {
  return `${row.swis_code ?? ""}|${row.print_key_code ?? ""}`;
}

function inCounty(lng: number, lat: number): boolean {
  return lng >= BOUNDS.west && lng <= BOUNDS.east && lat >= BOUNDS.south && lat <= BOUNDS.north;
}

function squareAround(lng: number, lat: number, feet: number): number[][] {
  const [x, y] = proj4("WGS84", "EPSG:2260", [lng, lat]) as [number, number];
  const half = feet / 2;
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
    [x - half, y - half],
  ].map(([fx, fy]) => proj4("EPSG:2260", "WGS84", [fx!, fy!]) as [number, number]);
}

function ringFromGrid(
  east: number,
  north: number,
  front: number | null,
  depth: number | null,
  shiftE: number,
  shiftN: number,
): number[][] | null {
  const x = east + shiftE;
  const y = north + shiftN;
  const w = Math.max(front && front > 10 ? front : 40, 36);
  const h = Math.max(depth && depth > 10 ? depth : 40, 36);
  const ring = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ].map(([fx, fy]) => proj4("EPSG:2260", "WGS84", [fx!, fy!]) as [number, number]);
  if (!ring.every(([lng, lat]) => inCounty(lng!, lat!))) return null;
  return ring;
}

function normalizeStreet(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave|av)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(place|pl)\b/g, "pl")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rollStreetKey(row: RollRow): string | null {
  const number = clean(row.parcel_address_number);
  const street = streetName(row);
  if (!number || !street) return null;
  return `${number.toLowerCase()}|${normalizeStreet(street)}`;
}

async function fetchRoll(year: string): Promise<RollRow[]> {
  const rows: RollRow[] = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      $where: `county_name='Columbia' AND roll_year='${year}'`,
      $limit: String(PAGE),
      $offset: String(offset),
      $order: "swis_code,print_key_code",
    });
    const batch = await fetchJson<RollRow[]>(`${ORPTS}?${params.toString()}`);
    rows.push(...batch);
    process.stdout.write(`  ORPTS ${year}: ${rows.length} rows\r`);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`  ORPTS ${year}: ${rows.length} rows`);
  return rows;
}

type OsmHit = { key: string; city: string; ring: number[][]; lng: number; lat: number };

async function fetchOsmHits(): Promise<OsmHit[]> {
  const query = `
    [out:json][timeout:180];
    (
      node["addr:housenumber"]["addr:street"](42.00,-73.93,42.52,-73.35);
      way["building"]["addr:housenumber"]["addr:street"](42.00,-73.93,42.52,-73.35);
    );
    out geom;
  `;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson<{
        elements?: Array<{
          type: string;
          lat?: number;
          lon?: number;
          tags?: Record<string, string>;
          geometry?: Array<{ lon: number; lat: number }>;
        }>;
      }>(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
      }, 3);
      const hits: OsmHit[] = [];
      for (const el of data.elements ?? []) {
        const number = el.tags?.["addr:housenumber"];
        const street = el.tags?.["addr:street"];
        if (!number || !street) continue;
        const city = (el.tags?.["addr:city"] ?? "").trim().toLowerCase();
        const key = `${number.trim().toLowerCase()}|${normalizeStreet(street)}`;
        if (el.type === "node" && el.lon !== undefined && el.lat !== undefined) {
          if (!inCounty(el.lon, el.lat)) continue;
          hits.push({ key, city, ring: squareAround(el.lon, el.lat, 32), lng: el.lon, lat: el.lat });
          continue;
        }
        const coords = el.geometry ?? [];
        if (coords.length < 4) continue;
        const ring = coords.map((c) => [c.lon, c.lat]);
        if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) ring.push(ring[0]!);
        const lng = ring.reduce((s, p) => s + p[0]!, 0) / ring.length;
        const lat = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
        if (!inCounty(lng, lat)) continue;
        hits.push({ key, city, ring, lng, lat });
      }
      console.log(`  OSM: ${hits.length} addressed features from ${endpoint}`);
      return hits;
    } catch (error) {
      console.log(`  OSM: ${endpoint} failed (${error instanceof Error ? error.message : error})`);
    }
  }
  console.log("  OSM: skipped (Overpass unavailable); every shape will come from roll grid coordinates");
  return [];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function matchOsm(row: RollRow, byKey: Map<string, OsmHit[]>): OsmHit | null {
  const key = rollStreetKey(row);
  if (!key) return null;
  const hits = byKey.get(key);
  if (!hits?.length) return null;
  const city = (clean(row.municipality_name) ?? "").toLowerCase();
  return hits.find((h) => h.city && city && (h.city === city || h.city.includes(city) || city.includes(h.city)))
    ?? hits[0]
    ?? null;
}

function calibrateShift(rows: RollRow[], byKey: Map<string, OsmHit[]>): { e: number; n: number; samples: number } {
  const de: number[] = [];
  const dn: number[] = [];
  for (const row of rows) {
    const hit = matchOsm(row, byKey);
    const east = num(row.grid_coordinates_east);
    const north = num(row.grid_coordinates_north);
    if (!hit || east === null || north === null || east < 200000) continue;
    const [x, y] = proj4("WGS84", "EPSG:2260", [hit.lng, hit.lat]) as [number, number];
    de.push(x - east);
    dn.push(y - north);
  }
  return { e: median(de), n: median(dn), samples: de.length };
}

function polygonJson(ring: number[][]): string {
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

export const COLUMBIA_SOURCES = [
  {
    id: "src_orpts",
    name: `NYS ORPTS local assessment roll ${COLUMBIA_ROLL_YEAR}`,
    authority: "NYS Department of Taxation and Finance — Office of Real Property Tax Services",
    type: "government",
    jurisdiction: "Columbia County, NY",
    url: "https://data.ny.gov/d/7vem-aaz7",
    license: "Open Data NY dataset 7vem-aaz7. Not a county tax-map extract.",
    coverage: "Every Columbia County parcel on the statewide final assessment roll",
  },
  {
    id: "src_orpts_prior",
    name: `NYS ORPTS local assessment roll ${PRIOR_YEAR}`,
    authority: "NYS Department of Taxation and Finance — Office of Real Property Tax Services",
    type: "government",
    jurisdiction: "Columbia County, NY",
    url: "https://data.ny.gov/d/7vem-aaz7",
    license: "Open Data NY. Prior-year assertions are superseded by the current roll.",
    coverage: "Prior-year roll used only for superseded values and change events",
  },
  {
    id: "src_osm",
    name: "OpenStreetMap addressed buildings",
    authority: "OpenStreetMap contributors",
    type: "platform_inference",
    jurisdiction: "Columbia County, NY",
    url: "https://www.openstreetmap.org/copyright",
    license: "ODbL. Approximate footprint, not an official tax parcel boundary.",
    coverage: "Address-matched building footprints and address points in Columbia County",
  },
  {
    id: "src_nysp",
    name: "ORPTS grid location (approximate)",
    authority: "NYS ORPTS + OSM-calibrated NY East shift",
    type: "platform_inference",
    jurisdiction: "Columbia County, NY",
    license: "Derived rectangle. Columbia County does not redistribute official GIS polygons.",
    coverage: "Approximate lot rectangle from assessment-roll grid coordinates",
  },
];

export interface ImportStats {
  county: string;
  properties: number;
  shapes: number;
  notes: string[];
}

export async function importColumbia(sql: Sql): Promise<ImportStats> {
  console.log("Columbia: fetching NYS ORPTS assessment rolls and OpenStreetMap footprints…");
  const [current, prior, osm] = await Promise.all([
    fetchRoll(COLUMBIA_ROLL_YEAR),
    fetchRoll(PRIOR_YEAR),
    fetchOsmHits(),
  ]);
  const priorByKey = new Map(prior.map((row) => [parcelKey(row), row]));
  const osmByKey = new Map<string, OsmHit[]>();
  for (const hit of osm) {
    const list = osmByKey.get(hit.key) ?? [];
    list.push(hit);
    osmByKey.set(hit.key, list);
  }
  let shift = calibrateShift(current, osmByKey);
  if (shift.samples < 20) {
    // NY East northings already match ORPTS; eastings are stored with a local origin.
    shift = { e: 1_121_787, n: 0, samples: shift.samples };
  }
  console.log(`  grid shift from ${shift.samples} OSM control points: east ${shift.e.toFixed(1)} ft, north ${shift.n.toFixed(1)} ft`);

  await upsertSources(sql, COLUMBIA_SOURCES);
  await recordSnapshot(
    sql,
    `snp_orpts_${COLUMBIA_ROLL_YEAR}_columbia`,
    "src_orpts",
    `Imported ${current.length} Columbia parcels from Open Data NY 7vem-aaz7 (${COLUMBIA_ROLL_YEAR} roll)`,
  );

  const effective = `${COLUMBIA_ROLL_YEAR}-07-01`;
  const priorEffective = `${PRIOR_YEAR}-07-01`;
  const batch: Batch = emptyBatch();
  const seen = new Set<string>();
  let withOsm = 0;
  let withGrid = 0;
  let skipped = 0;

  for (const row of current) {
    const key = parcelKey(row);
    if (!row.swis_code || !row.print_key_code || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    const propertyId = id("prop", key);
    const formatted = formattedAddress(row);
    const owner = ownerName(row);
    const school = clean(row.school_district_name);
    const osmHit = matchOsm(row, osmByKey);
    const east = num(row.grid_coordinates_east);
    const north = num(row.grid_coordinates_north);

    let ring: number[][] | null = null;
    let geomSource: string | null = null;
    let geomKind: string | null = null;
    if (osmHit) {
      ring = osmHit.ring;
      geomSource = "src_osm";
      geomKind = "Approximate (OpenStreetMap footprint)";
      withOsm += 1;
    } else if (east !== null && north !== null) {
      ring = ringFromGrid(east, north, num(row.front), num(row.depth), shift.e, shift.n);
      if (ring) {
        geomSource = "src_nysp";
        geomKind = "Approximate (assessment-roll grid rectangle)";
        withGrid += 1;
      }
    }

    batch.props.push({ property_id: propertyId, state: "NY", county: "Columbia", municipality: clean(row.municipality_name) });
    batch.idents.push({
      parcel_identity_id: id("pid", key),
      property_id: propertyId,
      swis: row.swis_code,
      sbl: row.print_key_code,
      print_key: row.print_key_code,
      is_current: true,
      effective_at: effective,
    });
    batch.addrs.push({
      address_id: id("adr", key),
      property_id: propertyId,
      street_number: clean(row.parcel_address_number),
      street_name: streetName(row) || null,
      city: clean(row.municipality_name),
      state: "NY",
      postal_code: parcelZip(row),
      formatted,
      is_current: true,
      source_id: "src_orpts",
    });
    if (ring && geomSource) {
      batch.geoms.push({
        geometry_id: id("geo", key),
        property_id: propertyId,
        geojson: polygonJson(ring),
        source_id: geomSource,
        quality: "approximate",
        effective_at: effective,
      });
      pushFacts(batch, key, propertyId, geomSource, effective, [["geometry.kind", geomKind]], 0.6);
    }

    pushFacts(batch, key, propertyId, "src_orpts", effective, [
      ["address", formatted],
      ["municipality", clean(row.municipality_name)],
      ["county", "Columbia"],
      ["parcel.sbl", row.print_key_code],
      ["parcel.swis", row.swis_code],
      ["property_class", propertyClass(row)],
      ["assessment.land", num(row.assessment_land)],
      ["assessment.total", num(row.assessment_total)],
      ["market_value_estimate", num(row.full_market_value)],
      ["owner_name_public", owner],
      ["school_district", school ? `${school} School District` : null],
    ]);

    const old = priorByKey.get(key);
    const oldTotal = num(old?.assessment_total);
    const newTotal = num(row.assessment_total);
    if (old && oldTotal !== null && newTotal !== null && oldTotal !== newTotal) {
      batch.asrts.push({
        assertion_id: id("ast", `${key}|assessment.total|${PRIOR_YEAR}`),
        property_id: propertyId,
        field_key: "assessment.total",
        value_json: { value: oldTotal },
        source_id: "src_orpts_prior",
        source_type: "government",
        effective_at: priorEffective,
        observed_at: priorEffective,
        confidence: 0.95,
        status: "superseded",
      });
      batch.evts.push({
        event_id: id("evt", `${key}|assessment`),
        property_id: propertyId,
        event_type: "assessment.updated",
        actor_type: "source",
        source_id: "src_orpts",
        payload_json: { from: oldTotal, to: newTotal, roll_year: COLUMBIA_ROLL_YEAR },
        effective_at: effective,
      });
    }
    const oldOwner = old ? ownerName(old) : null;
    if (oldOwner && owner && oldOwner !== owner) {
      batch.evts.push({
        event_id: id("evt", `${key}|owner`),
        property_id: propertyId,
        event_type: "assertion.updated",
        actor_type: "source",
        source_id: "src_orpts",
        payload_json: { field: "owner_name_public", from: oldOwner, to: owner },
        effective_at: effective,
      });
    }
    batch.evts.push({
      event_id: id("evt", `${key}|import`),
      property_id: propertyId,
      event_type: "parcel.imported",
      actor_type: "source",
      source_id: "src_orpts",
      payload_json: {
        adapter: "orpts_open_data",
        roll_year: COLUMBIA_ROLL_YEAR,
        first_seen_roll_year: old ? PRIOR_YEAR : COLUMBIA_ROLL_YEAR,
        print_key: row.print_key_code,
      },
      effective_at: old ? priorEffective : effective,
    });
  }

  const { rejectedGeometries } = await writeBatch(sql, batch, "Columbia");
  const notes = [
    `${withOsm} OpenStreetMap footprints, ${withGrid} grid rectangles, ${rejectedGeometries} unusable shapes`,
    `${skipped} roll rows skipped (missing or duplicate SWIS/print key)`,
    `${batch.props.length - withOsm - withGrid} parcels without any map shape`,
  ];
  return { county: "Columbia", properties: batch.props.length, shapes: batch.geoms.length - rejectedGeometries, notes };
}
