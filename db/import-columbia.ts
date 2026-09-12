import { createHash } from "node:crypto";
import postgres from "postgres";
import proj4 from "proj4";
import { FIELD_VOCAB } from "../server/src/vocab.ts";

const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace";
const sql = postgres(url, { max: 1 });
const secret = process.env.SESSION_SECRET ?? "dev-insecure-change-me";

const ORPTS = "https://data.ny.gov/resource/7vem-aaz7.json";
const ROLL_YEAR = "2025";
const PRIOR_YEAR = "2024";
const PAGE = 5000;
const COLUMBIA = { west: -73.95, south: 41.98, east: -73.32, north: 42.55 };

// NAD83 / New York East (ftUS), Transverse Mercator — EPSG:2260
proj4.defs(
  "EPSG:2260",
  "+proj=tmerc +lat_0=38.8333333333333 +lon_0=-74.5 +k=0.9999 +x_0=492125.9842519685 +y_0=0 +datum=NAD83 +units=us-ft +no_defs",
);

type RollRow = Record<string, string | undefined>;

function id(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 26)}`;
}

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${secret}:${email}:${code}`).digest("hex");
}

function num(value?: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clean(value?: string): string | null {
  const text = value?.trim();
  return text ? text : null;
}

const SUFFIX: Record<string, string> = {
  st: "Street",
  ave: "Avenue",
  av: "Avenue",
  rd: "Road",
  ln: "Lane",
  dr: "Drive",
  pl: "Place",
  ct: "Court",
  blvd: "Boulevard",
  hwy: "Highway",
  pkwy: "Parkway",
  cir: "Circle",
  ter: "Terrace",
  trl: "Trail",
  expy: "Expressway",
  sq: "Square",
};

function expandSuffix(suff?: string): string {
  const raw = clean(suff);
  if (!raw) return "";
  const key = raw.replace(/\./g, "").toLowerCase();
  return SUFFIX[key] ?? raw;
}

function streetName(row: RollRow): string {
  return [clean(row.parcel_address_street), expandSuffix(row.parcel_address_suff)].filter(Boolean).join(" ");
}

function streetLine(row: RollRow): string {
  return [clean(row.parcel_address_number), streetName(row)].filter(Boolean).join(" ");
}

function formattedAddress(row: RollRow): string {
  const line = streetLine(row);
  const city = clean(row.municipality_name) ?? "Columbia County";
  const zip = mailingZip(row);
  return [line || "Unnamed parcel", `${city}, NY${zip ? ` ${zip}` : ""}`].join(", ");
}

function mailingZip(row: RollRow): string | null {
  return clean(row.mailing_address_zip);
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
  return lng >= COLUMBIA.west && lng <= COLUMBIA.east && lat >= COLUMBIA.south && lat <= COLUMBIA.north;
}

function squareAround(lng: number, lat: number, feet = 40): number[][] {
  const [x, y] = proj4("WGS84", "EPSG:2260", [lng, lat]) as [number, number];
  const half = feet / 2;
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
    [x - half, y - half],
  ].map(([fx, fy]) => proj4("EPSG:2260", "WGS84", [fx, fy]) as [number, number]);
}

function ringFromGrid(east: number, north: number, front: number | null, depth: number | null, shiftE: number, shiftN: number): number[][] | null {
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
    const res = await fetch(`${ORPTS}?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "Myplace/0.1 (Columbia County property record)" },
    });
    if (!res.ok) throw new Error(`ORPTS ${year} offset ${offset}: HTTP ${res.status}`);
    const batch = (await res.json()) as RollRow[];
    rows.push(...batch);
    process.stdout.write(`  ${year}: ${rows.length} rows\r`);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`  ${year}: ${rows.length} rows`);
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
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Myplace/0.1" },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        elements?: Array<{
          type: string;
          lat?: number;
          lon?: number;
          tags?: Record<string, string>;
          geometry?: Array<{ lon: number; lat: number }>;
        }>;
      };
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
  console.log("  OSM: skipped (Overpass unavailable)");
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

async function wipePropertyTables() {
  await sql`DELETE FROM emails`;
  await sql`DELETE FROM handoff_invitations`;
  await sql`DELETE FROM contribution_assertions`;
  await sql`DELETE FROM contributions`;
  await sql`DELETE FROM documents`;
  await sql`DELETE FROM property_maintainers`;
  await sql`DELETE FROM ownership_claims`;
  await sql`DELETE FROM property_events`;
  await sql`DELETE FROM assertions`;
  await sql`DELETE FROM property_addresses`;
  await sql`DELETE FROM property_geometries`;
  await sql`DELETE FROM parcel_identities`;
  await sql`DELETE FROM source_snapshots`;
  await sql`DELETE FROM properties`;
  await sql`DELETE FROM field_vocabulary`;
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM auth_codes`;
  await sql`DELETE FROM sessions`;
  await sql`DELETE FROM user_emails`;
  await sql`DELETE FROM users`;
}

async function main() {
  console.log("Fetching NYS ORPTS local assessment rolls for Columbia County…");
  const [current, prior, osm] = await Promise.all([
    fetchRoll(ROLL_YEAR),
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

  console.log("Writing database…");
  await wipePropertyTables();

  for (const [index, field] of FIELD_VOCAB.entries()) {
    await sql`
      INSERT INTO field_vocabulary (field_key, label, group_key, value_type, layer, sort_order)
      VALUES (${field.key}, ${field.label}, ${field.group}, ${field.valueType}, ${field.layer}, ${index})
    `;
  }

  const sources = [
    {
      id: "src_orpts",
      name: `NYS ORPTS local assessment roll ${ROLL_YEAR}`,
      authority: "NYS Department of Taxation and Finance — Office of Real Property Tax Services",
      type: "government",
      coverage: "Columbia County parcels on the statewide final assessment roll",
      license: "Open Data NY dataset 7vem-aaz7. Not a county tax-map extract.",
    },
    {
      id: "src_orpts_prior",
      name: `NYS ORPTS local assessment roll ${PRIOR_YEAR}`,
      authority: "NYS Department of Taxation and Finance — Office of Real Property Tax Services",
      type: "government",
      coverage: "Prior-year roll used only for superseded values and change events",
      license: "Open Data NY. Prior-year assertions are superseded by the current roll.",
    },
    {
      id: "src_osm",
      name: "OpenStreetMap addressed buildings",
      authority: "OpenStreetMap contributors",
      type: "platform_inference",
      coverage: "Address-matched footprints and address points in Columbia County",
      license: "ODbL. Not an official tax parcel boundary.",
    },
    {
      id: "src_nysp",
      name: "ORPTS grid location (approximate)",
      authority: "NYS ORPTS + OSM-calibrated NY East shift",
      type: "platform_inference",
      coverage: "Approximate lot rectangle from assessment-roll grid coordinates",
      license: "Derived. Official county GIS polygons are not redistributed.",
    },
  ];
  for (const source of sources) {
    await sql`
      INSERT INTO sources (
        source_id, name, authority, source_type, jurisdiction, license_notes, coverage,
        last_checked_at, last_success_at, health_status, schema_version
      ) VALUES (
        ${source.id}, ${source.name}, ${source.authority}, ${source.type}, 'Columbia County, NY',
        ${source.license}, ${source.coverage}, now(), now(), 'healthy', 'v1'
      )
    `;
  }
  await sql`
    INSERT INTO source_snapshots (snapshot_id, source_id, notes)
    VALUES ('snp_orpts_2025', 'src_orpts', ${`Imported ${current.length} Columbia parcels from Open Data NY 7vem-aaz7`})
  `;

  const adminId = "usr_admin_local_000000000000";
  await sql`
    INSERT INTO users (user_id, primary_email, email_verified_at, display_name, is_admin)
    VALUES (${adminId}, 'admin@myplace.local', now(), 'Records desk', true)
  `;
  await sql`
    INSERT INTO user_emails (user_email_id, user_id, email, verified_at)
    VALUES ('uem_admin_local_000000000000', ${adminId}, 'admin@myplace.local', now())
  `;
  await sql`
    INSERT INTO auth_codes (code_id, email, code_hash, purpose, expires_at)
    VALUES ('code_admin_seed', 'admin@myplace.local', ${hashCode("admin@myplace.local", "000000")}, 'signin', now() + interval '365 days')
  `;

  const effective = `${ROLL_YEAR}-07-01`;
  const priorEffective = `${PRIOR_YEAR}-07-01`;
  let withOsm = 0;
  let withGrid = 0;
  let skipped = 0;

  type Prop = { property_id: string; state: string; county: string; municipality: string | null };
  type Ident = { parcel_identity_id: string; property_id: string; swis: string; sbl: string; print_key: string; is_current: boolean; effective_at: string };
  type Addr = { address_id: string; property_id: string; street_number: string | null; street_name: string | null; city: string | null; state: string; postal_code: string | null; formatted: string; is_current: boolean; source_id: string };
  type Geom = { geometry_id: string; property_id: string; wkt: string; source_id: string; is_current: boolean; effective_at: string };
  type Asrt = { assertion_id: string; property_id: string; field_key: string; value_json: { value: unknown }; source_id: string; source_type: string; effective_at: string; observed_at: string; confidence: number; status: string };
  type Evt = { event_id: string; property_id: string; event_type: string; actor_type: string; source_id: string; payload_json: Record<string, unknown>; effective_at: string };

  const props: Prop[] = [];
  const idents: Ident[] = [];
  const addrs: Addr[] = [];
  const geoms: Geom[] = [];
  const asrts: Asrt[] = [];
  const evts: Evt[] = [];

  for (const row of current) {
    const key = parcelKey(row);
    if (!row.swis_code || !row.print_key_code) {
      skipped += 1;
      continue;
    }
    const propertyId = id("prop", key);
    const formatted = formattedAddress(row);
    const owner = ownerName(row);
    const klass = propertyClass(row);
    const school = clean(row.school_district_name);
    const osmHit = matchOsm(row, osmByKey);
    const east = num(row.grid_coordinates_east);
    const north = num(row.grid_coordinates_north);
    let ring: number[][] | null = null;
    let geomSource: string | null = null;
    if (osmHit) {
      ring = osmHit.ring;
      geomSource = "src_osm";
      withOsm += 1;
    } else if (east !== null && north !== null) {
      ring = ringFromGrid(east, north, num(row.front), num(row.depth), shift.e, shift.n);
      if (ring) {
        geomSource = "src_nysp";
        withGrid += 1;
      }
    }

    props.push({ property_id: propertyId, state: "NY", county: "Columbia", municipality: clean(row.municipality_name) });
    idents.push({
      parcel_identity_id: id("pid", key),
      property_id: propertyId,
      swis: row.swis_code,
      sbl: row.print_key_code,
      print_key: row.print_key_code,
      is_current: true,
      effective_at: effective,
    });
    addrs.push({
      address_id: id("adr", key),
      property_id: propertyId,
      street_number: clean(row.parcel_address_number),
      street_name: streetName(row) || null,
      city: clean(row.municipality_name),
      state: "NY",
      postal_code: mailingZip(row),
      formatted,
      is_current: true,
      source_id: "src_orpts",
    });
    if (ring && geomSource) {
      geoms.push({
        geometry_id: id("geo", key),
        property_id: propertyId,
        wkt: `POLYGON((${ring.map((p) => `${p[0]} ${p[1]}`).join(", ")}))`,
        source_id: geomSource,
        is_current: true,
        effective_at: effective,
      });
    }

    const facts: Array<[string, unknown]> = [
      ["address", formatted],
      ["municipality", clean(row.municipality_name)],
      ["county", "Columbia"],
      ["parcel.sbl", row.print_key_code],
      ["parcel.swis", row.swis_code],
      ["property_class", klass],
      ["assessment.land", num(row.assessment_land)],
      ["assessment.total", num(row.assessment_total)],
      ["market_value_estimate", num(row.full_market_value)],
      ["owner_name_public", owner],
      ["school_district", school ? `${school} School District` : null],
    ];
    for (const [fieldKey, value] of facts) {
      if (value === null || value === undefined || value === "") continue;
      asrts.push({
        assertion_id: id("ast", `${key}|${fieldKey}|${ROLL_YEAR}`),
        property_id: propertyId,
        field_key: fieldKey,
        value_json: { value },
        source_id: "src_orpts",
        source_type: "government",
        effective_at: effective,
        observed_at: effective,
        confidence: 0.95,
        status: "accepted",
      });
    }

    const old = priorByKey.get(key);
    const oldTotal = num(old?.assessment_total);
    const newTotal = num(row.assessment_total);
    if (old && oldTotal !== null && newTotal !== null && oldTotal !== newTotal) {
      asrts.push({
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
      evts.push({
        event_id: id("evt", `${key}|assessment`),
        property_id: propertyId,
        event_type: "assessment.updated",
        actor_type: "source",
        source_id: "src_orpts",
        payload_json: { from: oldTotal, to: newTotal, roll_year: ROLL_YEAR },
        effective_at: effective,
      });
    }
    const oldOwner = old ? ownerName(old) : null;
    if (oldOwner && owner && oldOwner !== owner) {
      evts.push({
        event_id: id("evt", `${key}|owner`),
        property_id: propertyId,
        event_type: "assertion.updated",
        actor_type: "source",
        source_id: "src_orpts",
        payload_json: { field: "owner_name_public", from: oldOwner, to: owner },
        effective_at: effective,
      });
    }
    evts.push({
      event_id: id("evt", `${key}|import`),
      property_id: propertyId,
      event_type: "parcel.imported",
      actor_type: "source",
      source_id: "src_orpts",
      payload_json: { adapter: "orpts_open_data", roll_year: ROLL_YEAR, print_key: row.print_key_code },
      effective_at: effective,
    });
  }

  const chunk = <T,>(items: T[], size = 400): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  };

  console.log(`  inserting ${props.length} properties…`);
  for (const part of chunk(props)) {
    await sql`INSERT INTO properties ${sql(part, "property_id", "state", "county", "municipality")}`;
  }
  for (const part of chunk(idents)) {
    await sql`INSERT INTO parcel_identities ${sql(part, "parcel_identity_id", "property_id", "swis", "sbl", "print_key", "is_current", "effective_at")}`;
  }
  for (const part of chunk(addrs)) {
    await sql`INSERT INTO property_addresses ${sql(part, "address_id", "property_id", "street_number", "street_name", "city", "state", "postal_code", "formatted", "is_current", "source_id")}`;
  }
  for (const geom of geoms) {
    try {
      await sql`
        INSERT INTO property_geometries (geometry_id, property_id, geom, source_id, is_current, effective_at)
        VALUES (
          ${geom.geometry_id}, ${geom.property_id},
          ST_SetSRID(ST_GeometryN(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(${geom.wkt})), 3), 1), 4326),
          ${geom.source_id}, true, ${geom.effective_at}
        )
      `;
    } catch {
      // skip unusable rings
    }
  }
  for (const part of chunk(asrts, 300)) {
    await sql`INSERT INTO assertions ${sql(part, "assertion_id", "property_id", "field_key", "value_json", "source_id", "source_type", "effective_at", "observed_at", "confidence", "status")}`;
  }
  for (const part of chunk(evts)) {
    await sql`INSERT INTO property_events ${sql(part, "event_id", "property_id", "event_type", "actor_type", "source_id", "payload_json", "effective_at")}`;
  }

  const count = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM properties`;
  console.log(`imported ${count[0]?.n ?? 0} Columbia County properties`);
  console.log(`geometry: ${withOsm} OSM, ${withGrid} calibrated grid, ${skipped} skipped keys, ${props.length - withOsm - withGrid} without map shape`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
