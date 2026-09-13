import postgres from "postgres";
import { createHash } from "node:crypto";
import { FIELD_VOCAB } from "../server/src/vocab.ts";
import greeneFixture from "./fixtures/greene-catskill.json" with { type: "json" };

type GreeneFeature = {
  n: number;
  properties: {
    municipality: string;
    city: string;
    zip: string;
    number: string;
    street: string;
    swis: string;
    sbl: string;
    printKey?: string;
    propertyClass: string;
    land?: number | null;
    total?: number | null;
    market?: number | null;
    yearBuilt?: number | null;
    acreage?: number | null;
    buildingArea?: number | null;
    owner?: string | null;
    school?: string | null;
    sewer?: string | null;
    water?: string | null;
    utilities?: string | null;
    rollYear?: number | null;
    spatialYear?: number | null;
  };
  geometry: { type: string; coordinates: unknown };
};

const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace";
const sql = postgres(url, { max: 1 });
const secret = process.env.SESSION_SECRET ?? "dev-insecure-change-me";

function ulidish(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(26, "0")}`;
}

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${secret}:${email}:${code}`).digest("hex");
}

function polygon(lng: number, lat: number, w = 0.00028, h = 0.0002, skew = 0): number[][] {
  const ring = [
    [lng, lat],
    [lng + w, lat + skew],
    [lng + w * 0.96, lat + h],
    [lng - w * 0.08, lat + h - skew],
    [lng, lat],
  ];
  return ring;
}

type Featured = {
  n: number;
  municipality: string;
  city: string;
  zip: string;
  number: string;
  street: string;
  swis: string;
  sbl: string;
  lng: number;
  lat: number;
  w?: number;
  h?: number;
  acreage: number;
  propertyClass: string;
  yearBuilt?: number;
  yearBuiltAlt?: number;
  buildingArea?: number;
  land: number;
  total: number;
  market: number;
  taxes?: number;
  saleDate?: string;
  salePrice?: number;
  owner: string;
  school: string;
  electric?: string;
  gas?: string;
  water?: string;
  sewer?: string;
  zoning?: string;
  flood?: string;
  wetlands?: string;
  historic?: string;
};

const featured: Featured[] = [
  {
    n: 1, municipality: "Hudson", city: "Hudson", zip: "12534",
    number: "441", street: "Warren Street", swis: "103600", sbl: "109.44-1-17",
    lng: -73.7899, lat: 42.2518, acreage: 0.12, propertyClass: "482 Downtown row",
    yearBuilt: 1852, yearBuiltAlt: 1904, buildingArea: 4280, land: 42000, total: 485000,
    market: 612000, taxes: 11240, saleDate: "2019-06-18", salePrice: 540000,
    owner: "Warren Street Holdings LLC", school: "Hudson City School District",
    electric: "National Grid", gas: "NYSEG", water: "City of Hudson", sewer: "Public sewer",
    zoning: "R-C Residential Commercial", flood: "X", historic: "Warren Street Historic District",
  },
  {
    n: 2, municipality: "Hudson", city: "Hudson", zip: "12534",
    number: "12", street: "Park Place", swis: "103600", sbl: "109.52-2-8",
    lng: -73.7871, lat: 42.2546, acreage: 0.21, propertyClass: "210 One family",
    yearBuilt: 1888, buildingArea: 2140, land: 38000, total: 312000, market: 398000,
    taxes: 7860, saleDate: "2021-09-03", salePrice: 365000,
    owner: "Elena Voss", school: "Hudson City School District",
    electric: "National Grid", gas: "NYSEG", water: "City of Hudson", sewer: "Public sewer",
    zoning: "R-2", flood: "X", historic: "Not in a listed district",
  },
  {
    n: 3, municipality: "Hudson", city: "Hudson", zip: "12534",
    number: "348", street: "Union Street", swis: "103600", sbl: "109.43-3-21",
    lng: -73.7924, lat: 42.2502, acreage: 0.09, propertyClass: "220 Two family",
    yearBuilt: 1901, buildingArea: 1860, land: 24000, total: 198000, market: 255000,
    taxes: 4980, owner: "James K. Moretti", school: "Hudson City School District",
    electric: "National Grid", water: "City of Hudson", sewer: "Public sewer", zoning: "R-2", flood: "X",
  },
  {
    n: 4, municipality: "Hudson", city: "Hudson", zip: "12534",
    number: "88", street: "Green Street", swis: "103600", sbl: "110.53-1-4",
    lng: -73.7848, lat: 42.2491, acreage: 0.16, propertyClass: "210 One family",
    yearBuilt: 1926, buildingArea: 1540, land: 28000, total: 241000, market: 305000,
    taxes: 6120, saleDate: "2016-04-22", salePrice: 189000,
    owner: "Priya Shah", school: "Hudson City School District",
    electric: "National Grid", gas: "NYSEG", water: "City of Hudson", sewer: "Public sewer", zoning: "R-1",
  },
  {
    n: 5, municipality: "Greenport", city: "Hudson", zip: "12534",
    number: "210", street: "Route 9", swis: "103689", sbl: "110.1-2-18.1",
    lng: -73.7702, lat: 42.2364, w: 0.0011, h: 0.0008, acreage: 12.4, propertyClass: "240 Rural residence",
    yearBuilt: 1948, buildingArea: 1760, land: 148000, total: 392000, market: 510000,
    taxes: 8340, owner: "Hearthstone Farm Trust", school: "Hudson City School District",
    electric: "National Grid", water: "Private well", sewer: "Septic", zoning: "RA Rural Agricultural",
    wetlands: "Mapped wetland on western edge",
  },
  {
    n: 6, municipality: "Greenport", city: "Hudson", zip: "12534",
    number: "44", street: "Spook Rock Road", swis: "103689", sbl: "111.2-1-9",
    lng: -73.7518, lat: 42.2412, w: 0.0007, h: 0.0005, acreage: 4.8, propertyClass: "210 One family",
    yearBuilt: 1978, buildingArea: 2088, land: 86000, total: 334000, market: 428000,
    taxes: 7210, saleDate: "2024-11-12", salePrice: 415000,
    owner: "Daniel and Mara Ellison", school: "Hudson City School District",
    electric: "National Grid", gas: "None listed", water: "Private well", sewer: "Septic", zoning: "R-2",
  },
  {
    n: 7, municipality: "Kinderhook", city: "Kinderhook", zip: "12106",
    number: "15", street: "Church Street", swis: "104601", sbl: "43.20-2-12",
    lng: -73.6989, lat: 42.3948, acreage: 0.28, propertyClass: "210 One family",
    yearBuilt: 1810, buildingArea: 2620, land: 52000, total: 428000, market: 575000,
    taxes: 9680, owner: "Margaret H. Van Alstyne", school: "Kinderhook Central School District",
    electric: "National Grid", water: "Village of Kinderhook", sewer: "Public sewer",
    zoning: "R-1", historic: "Kinderhook Village Historic District",
  },
  {
    n: 8, municipality: "Kinderhook", city: "Kinderhook", zip: "12106",
    number: "4", street: "Albany Avenue", swis: "104601", sbl: "43.20-1-3",
    lng: -73.7006, lat: 42.3964, acreage: 0.19, propertyClass: "483 Converted residence",
    yearBuilt: 1845, buildingArea: 1980, land: 41000, total: 276000, market: 349000,
    taxes: 6540, owner: "North Square Properties Inc", school: "Kinderhook Central School District",
    electric: "National Grid", water: "Village of Kinderhook", sewer: "Public sewer", zoning: "MU Mixed Use",
  },
  {
    n: 9, municipality: "Chatham", city: "Chatham", zip: "12037",
    number: "102", street: "Main Street", swis: "102605", sbl: "66.13-1-19",
    lng: -73.5991, lat: 42.3642, acreage: 0.11, propertyClass: "482 Downtown row",
    yearBuilt: 1894, buildingArea: 3120, land: 33000, total: 268000, market: 340000,
    taxes: 7010, saleDate: "2018-08-09", salePrice: 225000,
    owner: "Main & Park LLC", school: "Chatham Central School District",
    electric: "NYSEG", water: "Village of Chatham", sewer: "Public sewer", zoning: "C-1",
  },
  {
    n: 10, municipality: "Chatham", city: "Chatham", zip: "12037",
    number: "19", street: "Hudson Avenue", swis: "102605", sbl: "66.9-2-7",
    lng: -73.5968, lat: 42.3661, acreage: 0.24, propertyClass: "210 One family",
    yearBuilt: 1912, buildingArea: 1688, land: 29000, total: 219000, market: 286000,
    taxes: 5430, owner: "Owen Blake", school: "Chatham Central School District",
    electric: "NYSEG", water: "Village of Chatham", sewer: "Public sewer", zoning: "R-1", flood: "X",
  },
  {
    n: 11, municipality: "Claverack", city: "Claverack", zip: "12513",
    number: "128", street: "Route 66", swis: "102600", sbl: "113.-1-22",
    lng: -73.7215, lat: 42.2248, w: 0.0009, h: 0.0007, acreage: 6.2, propertyClass: "311 Vacant residential",
    land: 72000, total: 72000, market: 98000, taxes: 1840,
    owner: "Open Acreage Partners", school: "Hudson City School District",
    electric: "National Grid", water: "Unknown", sewer: "Unknown", zoning: "RA",
    wetlands: "Unknown",
  },
  {
    n: 12, municipality: "Kinderhook", city: "Kinderhook", zip: "12106",
    number: "6", street: "Broad Street", swis: "104601", sbl: "43.16-1-11",
    lng: -73.6972, lat: 42.3931, acreage: 0.17, propertyClass: "210 One family",
    yearBuilt: 1798, buildingArea: 2410, land: 48000, total: 401000, market: 535000,
    taxes: 9120, saleDate: "2003-05-14", salePrice: 215000,
    owner: "The Broad Street Irrevocable Trust", school: "Kinderhook Central School District",
    electric: "National Grid", water: "Village of Kinderhook", sewer: "Public sewer",
    historic: "Kinderhook Village Historic District",
  },
];

const hudsonStreets = [
  "Warren Street", "Union Street", "Columbia Street", "Allen Street", "State Street",
  "Partition Street", "Third Street", "Second Street", "Worth Avenue", "Promenade Hill",
];

function generated(): Featured[] {
  const out: Featured[] = [];
  let n = 100;
  for (let i = 0; i < 80; i += 1) {
    const street = hudsonStreets[i % hudsonStreets.length]!;
    const block = 100 + (i % 9) * 20 + (i % 17);
    const col = i % 10;
    const row = Math.floor(i / 10);
    const lng = -73.7935 + col * 0.00095 + (i % 3) * 0.00008;
    const lat = 42.2482 + row * 0.00072;
    const yearBuilt = 1860 + (i * 7) % 140;
    const total = 165000 + (i * 13700) % 320000;
    out.push({
      n,
      municipality: "Hudson",
      city: "Hudson",
      zip: "12534",
      number: String(block),
      street,
      swis: "103600",
      sbl: `109.${44 + (i % 6)}-${1 + (i % 4)}-${10 + (i % 40)}`,
      lng,
      lat,
      acreage: Number((0.08 + (i % 9) * 0.03).toFixed(2)),
      propertyClass: i % 11 === 0 ? "311 Vacant residential" : "210 One family",
      yearBuilt: i % 11 === 0 ? undefined : yearBuilt,
      buildingArea: i % 11 === 0 ? undefined : 1100 + (i * 40) % 1600,
      land: 18000 + (i * 900) % 40000,
      total: i % 11 === 0 ? 28000 + (i * 800) % 20000 : total,
      market: i % 11 === 0 ? 36000 : Math.round(total * 1.28),
      taxes: i % 11 === 0 ? 640 : Math.round(total * 0.023),
      owner: ["River Ward LLC", "A. J. Keene", "Lydia Cho", "Estate of H. Brooks", "North Bay Realty"][i % 5]!,
      school: "Hudson City School District",
      electric: "National Grid",
      water: "City of Hudson",
      sewer: i % 13 === 0 ? undefined : "Public sewer",
      zoning: "R-2",
      flood: i % 19 === 0 ? undefined : "X",
    });
    n += 1;
  }
  return out;
}

let assertionSeq = 1;

async function assertField(
  propertyId: string,
  sourceId: string,
  sourceType: string,
  fieldKey: string,
  value: unknown,
  effectiveAt: string,
) {
  if (value === undefined || value === null || value === "") return;
  assertionSeq += 1;
  await sql`
    INSERT INTO assertions (
      assertion_id, property_id, field_key, value_json, source_id, source_type,
      effective_at, observed_at, confidence, status
    ) VALUES (
      ${ulidish("ast", assertionSeq)},
      ${propertyId}, ${fieldKey}, ${sql.json({ value } as never)}, ${sourceId}, ${sourceType},
      ${effectiveAt}, ${effectiveAt}, 0.92, 'accepted'
    )
  `;
}

async function main() {
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

  for (const [index, field] of FIELD_VOCAB.entries()) {
    await sql`
      INSERT INTO field_vocabulary (field_key, label, group_key, value_type, layer, sort_order)
      VALUES (${field.key}, ${field.label}, ${field.group}, ${field.valueType}, ${field.layer}, ${index})
    `;
  }

  const sources = [
    {
      id: "src_county_roll",
      name: "Columbia County assessment roll (demonstration)",
      authority: "Columbia County Real Property",
      type: "government",
      jurisdiction: "Columbia County, NY",
      license: "Demonstration seed. Not an official county redistribution.",
      coverage: "Countywide assessments and owner of record",
    },
    {
      id: "src_county_gis",
      name: "Demonstration parcel geometry",
      authority: "Myplace seed adapter",
      type: "government",
      jurisdiction: "Columbia County, NY",
      license: "Demonstration seed. Columbia does not authorize public tax-map redistribution.",
      coverage: "Synthetic parcels along public streets in Columbia County",
    },
    {
      id: "src_hudson_building",
      name: "City of Hudson building file (demonstration)",
      authority: "City of Hudson",
      type: "government",
      jurisdiction: "Columbia County, NY",
      license: "Demonstration seed. Not an official county redistribution.",
      coverage: "Selected Hudson year-built notes",
    },
    {
      id: "src_fema",
      name: "FEMA NFHL extract (demonstration)",
      authority: "FEMA",
      type: "government",
      jurisdiction: "New York",
      license: "Demonstration seed.",
      coverage: "Partial flood zone tags",
    },
    {
      id: "src_inference",
      name: "Platform inference",
      authority: "Myplace",
      type: "platform_inference",
      jurisdiction: "New York",
      license: "Platform-generated. Never presented as official.",
      coverage: "Low-confidence fills, never presented as official",
    },
    {
      id: "src_greene_roll",
      name: "NYS Tax Parcels Public — Greene attributes",
      authority: "Greene County / NYS ORPTS",
      type: "government",
      jurisdiction: "Greene County, NY",
      license: "Public redistribution authorized by Greene County via NYS ITS Geospatial Services.",
      coverage: "2025 assessment attributes joined to official county polygons",
    },
    {
      id: "src_greene_gis",
      name: "NYS Tax Parcels Public — Greene lot lines",
      authority: "Greene County Real Property / NYS ITS",
      type: "government",
      jurisdiction: "Greene County, NY",
      license: "Official tax-map polygons. Greene County authorized public redistribution.",
      coverage: "Village of Catskill sample from the 2025 NYS Tax Parcels Public dataset",
    },
  ];

  for (const source of sources) {
    await sql`
      INSERT INTO sources (
        source_id, name, authority, source_type, jurisdiction, license_notes, coverage,
        last_checked_at, last_success_at, health_status, schema_version
      ) VALUES (
        ${source.id}, ${source.name}, ${source.authority}, ${source.type}, ${source.jurisdiction},
        ${source.license}, ${source.coverage},
        now(), now(), 'healthy', 'v1'
      )
    `;
  }

  await sql`
    INSERT INTO source_snapshots (snapshot_id, source_id, notes)
    VALUES ('snp_seed_2026', 'src_county_gis', 'Local V1 seed generated 2026-09-12')
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

  const parcels = [...featured, ...generated()];
  for (const parcel of parcels) {
    const propertyId = ulidish("prop", parcel.n);
    const formatted = `${parcel.number} ${parcel.street}, ${parcel.city}, NY ${parcel.zip}`;
    await sql`
      INSERT INTO properties (property_id, state, county, municipality)
      VALUES (${propertyId}, 'NY', 'Columbia', ${parcel.municipality})
    `;
    await sql`
      INSERT INTO parcel_identities (parcel_identity_id, property_id, swis, sbl, print_key, is_current, effective_at)
      VALUES (${ulidish("pid", parcel.n)}, ${propertyId}, ${parcel.swis}, ${parcel.sbl}, ${parcel.sbl}, true, '2026-07-01')
    `;
    const ring = polygon(parcel.lng, parcel.lat, parcel.w, parcel.h, parcel.n % 2 === 0 ? 0.00003 : 0);
    const wkt = `POLYGON((${ring.map((p) => `${p[0]} ${p[1]}`).join(", ")}))`;
    await sql`
      INSERT INTO property_geometries (geometry_id, property_id, geom, source_id, quality, is_current, effective_at)
      VALUES (
        ${ulidish("geo", parcel.n)}, ${propertyId},
        ST_SetSRID(ST_GeomFromText(${wkt}), 4326),
        'src_county_gis', 'demonstration', true, '2026-07-01'
      )
    `;
    await sql`
      INSERT INTO property_addresses (
        address_id, property_id, street_number, street_name, city, state, postal_code, formatted, source_id
      ) VALUES (
        ${ulidish("adr", parcel.n)}, ${propertyId}, ${parcel.number}, ${parcel.street},
        ${parcel.city}, 'NY', ${parcel.zip}, ${formatted}, 'src_county_roll'
      )
    `;

    const official: Array<[string, unknown]> = [
      ["address", formatted],
      ["municipality", parcel.municipality],
      ["county", "Columbia"],
      ["parcel.sbl", parcel.sbl],
      ["parcel.swis", parcel.swis],
      ["acreage", parcel.acreage],
      ["property_class", parcel.propertyClass],
      ["year_built", parcel.yearBuilt],
      ["building_area", parcel.buildingArea],
      ["assessment.land", parcel.land],
      ["assessment.total", parcel.total],
      ["market_value_estimate", parcel.market],
      ["taxes.county_town", parcel.taxes],
      ["last_sale.date", parcel.saleDate],
      ["last_sale.price", parcel.salePrice],
      ["owner_name_public", parcel.owner],
      ["school_district", parcel.school],
      ["utility.electric", parcel.electric],
      ["utility.gas", parcel.gas],
      ["utility.water", parcel.water],
      ["utility.sewer", parcel.sewer],
      ["zoning.district", parcel.zoning],
      ["geometry.kind", "Demonstration sketch"],
      ["flood.zone", parcel.flood],
      ["wetlands", parcel.wetlands],
      ["historic.district", parcel.historic],
    ];

    for (const [key, value] of official) {
      await assertField(propertyId, "src_county_roll", "government", key, value, "2026-07-01");
    }
    if (parcel.yearBuiltAlt) {
      await assertField(
        propertyId,
        "src_hudson_building",
        "government",
        "year_built",
        parcel.yearBuiltAlt,
        "2020-01-15",
      );
    }
    if (parcel.n === 11) {
      await assertField(propertyId, "src_inference", "platform_inference", "utility.water", "Likely private well", "2026-09-01");
    }

    await sql`
      INSERT INTO property_events (event_id, property_id, event_type, actor_type, source_id, payload_json, effective_at)
      VALUES (
        ${ulidish("evt", parcel.n)}, ${propertyId}, 'parcel.imported', 'source', 'src_county_gis',
        ${sql.json({ adapter: "columbia_demo" })}, '2026-07-01'
      )
    `;
    if (parcel.saleDate) {
      await sql`
        INSERT INTO property_events (event_id, property_id, event_type, actor_type, source_id, payload_json, effective_at)
        VALUES (
          ${ulidish("evt", parcel.n + 9000)}, ${propertyId}, 'sale.recorded', 'source', 'src_county_roll',
          ${sql.json({ price: parcel.salePrice ?? null })}, ${parcel.saleDate}
        )
      `;
    }
    await sql`
      INSERT INTO property_events (event_id, property_id, event_type, actor_type, source_id, payload_json, effective_at)
      VALUES (
        ${ulidish("evt", parcel.n + 8000)}, ${propertyId}, 'assessment.updated', 'source', 'src_county_roll',
        ${sql.json({ total: parcel.total })}, '2026-07-01'
      )
    `;
  }

  // Stable local admin sign-in code for tests and first-run convenience.
  await sql`
    INSERT INTO auth_codes (code_id, email, code_hash, purpose, expires_at)
    VALUES ('code_admin_seed', 'admin@myplace.local', ${hashCode("admin@myplace.local", "000000")}, 'signin', now() + interval '365 days')
  `;

  await seedGreene();

  const count = await sql<{ n: number; county: string }[]>`
    SELECT county, count(*)::int AS n FROM properties GROUP BY county ORDER BY county
  `;
  console.log(`seeded ${count.map((row) => `${row.n} ${row.county}`).join(", ")} properties`);
  await sql.end();
}

const CLASS_NAMES: Record<string, string> = {
  "210": "210 One family",
  "220": "220 Two family",
  "230": "230 Three family",
  "311": "311 Vacant residential",
  "411": "411 Apartments",
  "421": "421 Restaurant",
  "438": "438 Parking lot",
  "449": "449 Other storage / warehouse",
  "464": "464 Office building",
  "465": "465 Professional building",
  "481": "481 Downtown row vacant",
  "482": "482 Downtown row",
  "620": "620 Religious",
  "652": "652 Government office",
  "653": "653 Parking garage",
  "681": "681 Cultural / civic",
};

function geojsonToWkt(geometry: { type: string; coordinates: unknown }): string {
  const path = (coords: unknown): string => {
    if (!Array.isArray(coords)) return "";
    if (typeof coords[0] === "number") return `${coords[0]} ${coords[1]}`;
    return `(${coords.map(path).join(", ")})`;
  };
  if (geometry.type === "Polygon") return `POLYGON${path(geometry.coordinates)}`;
  if (geometry.type === "MultiPolygon") return `MULTIPOLYGON${path(geometry.coordinates)}`;
  throw new Error(`Unsupported geometry ${geometry.type}`);
}

async function seedGreene() {
  await sql`
    INSERT INTO source_snapshots (snapshot_id, source_id, notes)
    VALUES (
      'snp_greene_2025',
      'src_greene_gis',
      'Village of Catskill sample from NYS Tax Parcels Public (May 2026 publication, 2025 spatial year)'
    )
  `;

  for (const feature of greeneFixture.features as GreeneFeature[]) {
    const parcel = feature.properties;
    const n = feature.n;
    const propertyId = ulidish("prop", n);
    const street = parcel.street.replace(/\bSt\b/, "Street").replace(/\bAve\b/, "Avenue");
    const formatted = `${parcel.number} ${street}, ${parcel.city}, NY ${parcel.zip}`;
    const className = CLASS_NAMES[parcel.propertyClass] ?? parcel.propertyClass;
    const acreage = typeof parcel.acreage === "number" ? Number(parcel.acreage.toFixed(2)) : undefined;
    await sql`
      INSERT INTO properties (property_id, state, county, municipality)
      VALUES (${propertyId}, 'NY', 'Greene', ${parcel.municipality})
    `;
    await sql`
      INSERT INTO parcel_identities (parcel_identity_id, property_id, swis, sbl, print_key, is_current, effective_at)
      VALUES (
        ${ulidish("pid", n)}, ${propertyId}, ${parcel.swis}, ${parcel.sbl},
        ${parcel.printKey ?? parcel.sbl}, true, '2025-07-01'
      )
    `;
    const wkt = geojsonToWkt(feature.geometry);
    await sql`
      INSERT INTO property_geometries (geometry_id, property_id, geom, source_id, quality, is_current, effective_at)
      VALUES (
        ${ulidish("geo", n)}, ${propertyId},
        ST_SetSRID(ST_GeomFromText(${wkt}), 4326),
        'src_greene_gis', 'official', true, '2025-07-01'
      )
    `;
    await sql`
      INSERT INTO property_addresses (
        address_id, property_id, street_number, street_name, city, state, postal_code, formatted, source_id
      ) VALUES (
        ${ulidish("adr", n)}, ${propertyId}, ${parcel.number}, ${street},
        ${parcel.city}, 'NY', ${parcel.zip}, ${formatted}, 'src_greene_roll'
      )
    `;

    const official: Array<[string, unknown]> = [
      ["address", formatted],
      ["municipality", parcel.municipality],
      ["county", "Greene"],
      ["parcel.sbl", parcel.sbl],
      ["parcel.swis", parcel.swis],
      ["acreage", acreage],
      ["property_class", className],
      ["year_built", parcel.yearBuilt],
      ["building_area", parcel.buildingArea],
      ["assessment.land", parcel.land],
      ["assessment.total", parcel.total],
      ["market_value_estimate", parcel.market],
      ["owner_name_public", parcel.owner],
      ["school_district", parcel.school ? `${parcel.school} Central School District` : undefined],
      ["utility.electric", parcel.utilities?.toLowerCase().includes("electric") ? "Central Hudson" : undefined],
      ["utility.gas", parcel.utilities?.toLowerCase().includes("gas") ? "Natural gas" : undefined],
      ["utility.water", parcel.water],
      ["utility.sewer", parcel.sewer],
      ["geometry.kind", "Official tax-map polygons"],
    ];
    for (const [key, value] of official) {
      await assertField(propertyId, "src_greene_roll", "government", key, value, "2025-07-01");
    }
    await assertField(
      propertyId,
      "src_greene_gis",
      "government",
      "geometry.kind",
      "Official tax-map polygons",
      "2025-07-01",
    );

    await sql`
      INSERT INTO property_events (event_id, property_id, event_type, actor_type, source_id, payload_json, effective_at)
      VALUES (
        ${ulidish("evt", n)}, ${propertyId}, 'parcel.imported', 'source', 'src_greene_gis',
        ${sql.json({ adapter: "nys_tax_parcels_public", county: "Greene", spatial_year: parcel.spatialYear ?? 2025 })},
        '2025-07-01'
      )
    `;
    await sql`
      INSERT INTO property_events (event_id, property_id, event_type, actor_type, source_id, payload_json, effective_at)
      VALUES (
        ${ulidish("evt", n + 8000)}, ${propertyId}, 'assessment.updated', 'source', 'src_greene_roll',
        ${sql.json({ total: parcel.total, roll_year: parcel.rollYear ?? 2025 })}, '2025-07-01'
      )
    `;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
