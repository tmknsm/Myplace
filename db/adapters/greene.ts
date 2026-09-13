import {
  clean,
  emptyBatch,
  expandStreet,
  fetchJson,
  id,
  insertRows,
  num,
  pushFacts,
  recordSnapshot,
  upsertSources,
  writeBatch,
  type Batch,
  type Sql,
} from "../lib.ts";
import type { ImportStats } from "./columbia.ts";

/**
 * Greene County authorizes NYS ITS Geospatial Services to redistribute its tax-map
 * polygons, so the NYS Tax Parcels Public feature service carries both the official
 * lot lines and the joined assessment-roll attributes for every parcel in the county.
 */

const FEATURE_SERVER =
  "https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query";
const PAGE = 1000;
const CONCURRENCY = 4;

const OUT_FIELDS = [
  "OBJECTID", "MUNI_NAME", "SWIS", "PARCEL_ADDR", "PRINT_KEY", "SBL", "LOC_ST_NBR", "LOC_STREET", "LOC_UNIT",
  "LOC_ZIP", "PROP_CLASS", "LAND_AV", "TOTAL_AV", "FULL_MARKET_VAL", "YR_BLT", "ACRES", "CALC_ACRES", "SCHOOL_NAME",
  "SEWER_DESC", "WATER_DESC", "UTILITIES_DESC", "SQFT_LIVING", "PRIMARY_OWNER", "MAIL_CITY", "MAIL_STATE", "MAIL_ZIP",
  "ROLL_YR", "SPATIAL_YR",
];

interface Attributes {
  OBJECTID: number;
  MUNI_NAME: string | null;
  SWIS: string | null;
  PARCEL_ADDR: string | null;
  PRINT_KEY: string | null;
  SBL: string | null;
  LOC_ST_NBR: string | null;
  LOC_STREET: string | null;
  LOC_UNIT: string | null;
  LOC_ZIP: string | null;
  PROP_CLASS: string | null;
  LAND_AV: number | null;
  TOTAL_AV: number | null;
  FULL_MARKET_VAL: number | null;
  YR_BLT: number | null;
  ACRES: number | null;
  CALC_ACRES: number | null;
  SCHOOL_NAME: string | null;
  SEWER_DESC: string | null;
  WATER_DESC: string | null;
  UTILITIES_DESC: string | null;
  SQFT_LIVING: number | null;
  PRIMARY_OWNER: string | null;
  MAIL_CITY: string | null;
  MAIL_STATE: string | null;
  MAIL_ZIP: string | null;
  ROLL_YR: number | null;
  SPATIAL_YR: number | null;
}

interface Feature {
  type: "Feature";
  properties: Attributes;
  geometry: { type: string; coordinates: unknown } | null;
}

interface Page {
  features: Feature[];
  properties?: { exceededTransferLimit?: boolean };
  error?: { message?: string };
}

/** NYS ORPTS property type classification codes (the common ones; others show the bare code). */
const CLASS_NAMES: Record<string, string> = {
  "105": "Agricultural vacant land (productive)",
  "112": "Dairy farm",
  "113": "Cattle farm",
  "120": "Field crops",
  "170": "Nursery / greenhouse",
  "210": "One family residence",
  "215": "One family with accessory apartment",
  "220": "Two family residence",
  "230": "Three family residence",
  "240": "Rural residence with acreage",
  "241": "Rural residence with agriculture",
  "242": "Rural recreational residence",
  "250": "Estate",
  "260": "Seasonal residence",
  "270": "Mobile home",
  "271": "Multiple mobile homes",
  "280": "Multiple residences",
  "281": "Multiple residences (one lot)",
  "283": "Residence with commercial use",
  "311": "Vacant residential land",
  "312": "Residential land with small improvement",
  "314": "Rural vacant land under 10 acres",
  "320": "Rural vacant land",
  "321": "Abandoned agricultural land",
  "322": "Rural vacant land over 10 acres",
  "323": "Other rural vacant land",
  "330": "Vacant commercial land",
  "331": "Commercial land with small improvement",
  "340": "Vacant industrial land",
  "411": "Apartments",
  "414": "Hotel",
  "415": "Motel",
  "416": "Mobile home park",
  "417": "Camps / cottages / bungalows",
  "418": "Inn / lodge / boarding house",
  "421": "Restaurant",
  "422": "Diner / luncheonette",
  "423": "Snack bar / drive-in",
  "425": "Bar",
  "426": "Fast food",
  "431": "Auto dealer",
  "432": "Gas station",
  "433": "Auto body / repair",
  "438": "Parking lot",
  "440": "Storage / warehouse / distribution",
  "441": "Fuel storage",
  "442": "Mini warehouse",
  "444": "Lumber yard",
  "446": "Cold storage",
  "447": "Trucking terminal",
  "449": "Other storage / warehouse",
  "450": "Retail services",
  "451": "Regional shopping center",
  "452": "Neighborhood shopping center",
  "453": "Large retail outlet",
  "454": "Supermarket",
  "455": "Dealership / sales outlet",
  "460": "Bank / office building",
  "461": "Bank",
  "462": "Branch bank",
  "464": "Office building",
  "465": "Professional building",
  "471": "Funeral home",
  "472": "Kennel / veterinary clinic",
  "473": "Greenhouse",
  "474": "Billboard",
  "475": "Junkyard",
  "480": "Multiple use / multi-purpose",
  "481": "Downtown row (attached, with common wall)",
  "482": "Downtown row (detached)",
  "483": "Converted residence",
  "484": "One-story small structure",
  "485": "One-story small structure (multi-occupant)",
  "486": "Mini-mart",
  "510": "Entertainment assembly",
  "512": "Movie theater",
  "530": "Amusement facility",
  "531": "Fairground",
  "532": "Camp / campground",
  "534": "Social organization",
  "541": "Bowling center",
  "551": "Ski center",
  "552": "Public golf course",
  "553": "Private golf course",
  "557": "Outdoor sports",
  "560": "Improved beach",
  "570": "Marina",
  "581": "Chalet / camp",
  "582": "Camping facility",
  "583": "Resort complex",
  "590": "Park",
  "592": "Athletic field",
  "593": "Picnic grounds",
  "610": "Education",
  "612": "School",
  "615": "Other educational facility",
  "620": "Religious",
  "630": "Welfare",
  "632": "Benevolent / moral association",
  "633": "Aged home",
  "640": "Health",
  "641": "Hospital",
  "642": "All other health facilities",
  "650": "Government",
  "651": "Highway garage",
  "652": "Government office building",
  "653": "Parking garage",
  "660": "Protection",
  "661": "Army / Navy / Air Force / Marine",
  "662": "Police / fire protection",
  "670": "Correctional",
  "680": "Cultural and recreational",
  "681": "Cultural facility",
  "682": "Recreational facility",
  "690": "Miscellaneous community service",
  "692": "Roads / streets / highways",
  "693": "Indian reservation",
  "695": "Cemetery",
  "710": "Manufacturing and processing",
  "714": "Light industrial manufacturing",
  "720": "Mining and quarrying",
  "800": "Public services",
  "820": "Water",
  "822": "Water supply",
  "826": "Water treatment",
  "830": "Communication",
  "831": "Telephone",
  "833": "Radio",
  "834": "Television",
  "837": "Cell tower",
  "840": "Transportation",
  "842": "Ceiling railroad",
  "843": "Non-ceiling railroad",
  "853": "Sewage treatment / water pollution control",
  "860": "Special franchise property",
  "861": "Electric and gas",
  "866": "Telephone",
  "870": "Electric and gas",
  "871": "Electric and gas facilities",
  "872": "Electric substation",
  "873": "Gas measuring station",
  "874": "Electric power generation (hydro)",
  "877": "Electric power generation (other)",
  "882": "Electric transmission improvement",
  "883": "Gas transmission improvement",
  "884": "Electric distribution (outside plant)",
  "885": "Gas distribution (outside plant)",
  "910": "Private wild and forested land",
  "911": "Forest land under Section 480",
  "912": "Forest land under Section 480-a",
  "920": "Private hunting and fishing club",
  "930": "State-owned forest land",
  "931": "State-owned forest preserve",
  "932": "State-owned land (other)",
  "940": "Reforested land / other related conservation",
  "941": "State-owned reforested land",
  "942": "County-owned reforested land",
  "960": "Public parks",
  "961": "State-owned public park",
  "962": "County-owned public park",
  "963": "City / town / village public park",
  "970": "Other wild or conservation land",
  "971": "Wetlands (conservation easement)",
  "972": "Underwater land",
  "980": "Taxable state-owned conservation easement",
  "990": "Other taxable state land assessments",
  "993": "Transition assessments for taxable state-owned land",
};

function propertyClass(code: string | null): string | null {
  const key = clean(code);
  if (!key) return null;
  const name = CLASS_NAMES[key];
  return name ? `${key} ${name}` : key;
}

/** "Catskill, Village" → { municipality: "Catskill", kind: "Village" } */
function splitMuni(name: string | null): { municipality: string | null; kind: string | null } {
  const raw = clean(name);
  if (!raw) return { municipality: null, kind: null };
  const match = raw.match(/^(.*?),\s*(Village|City|Town)$/i);
  if (!match) return { municipality: raw, kind: null };
  return { municipality: match[1]!.trim(), kind: match[2]! };
}

function postalCode(a: Attributes, municipality: string | null): string | null {
  const loc = clean(a.LOC_ZIP);
  if (loc) return loc.slice(0, 5);
  const mailCity = clean(a.MAIL_CITY)?.toLowerCase();
  const mailZip = clean(a.MAIL_ZIP);
  if (mailZip && mailCity && municipality && a.MAIL_STATE === "NY" && mailCity === municipality.toLowerCase()) {
    return mailZip.slice(0, 5);
  }
  return null;
}

function utilities(desc: string | null): { electric: string | null; gas: string | null } {
  const text = clean(desc)?.toLowerCase() ?? "";
  return {
    electric: text.includes("electric") ? "Electric service" : null,
    gas: text.includes("gas") ? "Natural gas" : null,
  };
}

function schoolDistrict(name: string | null): string | null {
  const school = clean(name);
  if (!school) return null;
  return /school/i.test(school) ? school : `${school} Central School District`;
}

async function fetchCount(where: string): Promise<number> {
  const params = new URLSearchParams({ where, returnCountOnly: "true", f: "json" });
  const data = await fetchJson<{ count: number }>(`${FEATURE_SERVER}?${params.toString()}`);
  return data.count;
}

async function fetchPage(where: string, offset: number): Promise<Feature[]> {
  const params = new URLSearchParams({
    where,
    outFields: OUT_FIELDS.join(","),
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    outSR: "4326",
    geometryPrecision: "6",
    returnGeometry: "true",
    f: "geojson",
  });
  const page = await fetchJson<Page>(`${FEATURE_SERVER}?${params.toString()}`);
  if (page.error) throw new Error(page.error.message ?? "FeatureServer error");
  return page.features ?? [];
}

async function fetchCounty(county: string): Promise<Feature[]> {
  const where = `COUNTY_NAME='${county}'`;
  const total = await fetchCount(where);
  const offsets: number[] = [];
  for (let offset = 0; offset < total; offset += PAGE) offsets.push(offset);
  const pages: Feature[][] = new Array(offsets.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= offsets.length) return;
      pages[index] = await fetchPage(where, offsets[index]!);
      done += 1;
      process.stdout.write(`  NYS Tax Parcels: ${done}/${offsets.length} pages\r`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const features = pages.flat();
  console.log(`  NYS Tax Parcels: ${features.length} of ${total} ${county} features`);
  return features;
}

export const GREENE_SOURCES = [
  {
    id: "src_greene_roll",
    name: "NYS Tax Parcels Public — Greene County assessment attributes",
    authority: "Greene County Real Property Tax Service / NYS ORPTS via NYS ITS Geospatial Services",
    type: "government",
    jurisdiction: "Greene County, NY",
    url: "https://data.gis.ny.gov/datasets/nys-tax-parcels-public",
    license: "Public redistribution authorized by Greene County. Assessment roll attributes joined to the county tax map.",
    coverage: "Every Greene County parcel in the current NYS Tax Parcels Public publication",
  },
  {
    id: "src_greene_gis",
    name: "NYS Tax Parcels Public — Greene County lot lines",
    authority: "Greene County Real Property Tax Service / NYS ITS Geospatial Services",
    type: "government",
    jurisdiction: "Greene County, NY",
    url: "https://data.gis.ny.gov/datasets/nys-tax-parcels-public",
    license: "Official county tax-map polygons. Greene County authorized public redistribution through NYS.",
    coverage: "Every Greene County parcel polygon in the current NYS Tax Parcels Public publication",
  },
];

export async function importGreene(sql: Sql): Promise<ImportStats> {
  console.log("Greene: fetching official tax-map polygons from the NYS Tax Parcels Public service…");
  const features = await fetchCounty("Greene");
  const rollYears = new Set<number>();
  const spatialYears = new Set<number>();
  for (const feature of features) {
    if (feature.properties.ROLL_YR) rollYears.add(feature.properties.ROLL_YR);
    if (feature.properties.SPATIAL_YR) spatialYears.add(feature.properties.SPATIAL_YR);
  }
  const rollYear = Math.max(...rollYears, 2025);
  const spatialYear = Math.max(...spatialYears, rollYear);
  const effective = `${rollYear}-07-01`;

  await upsertSources(sql, GREENE_SOURCES);
  await recordSnapshot(
    sql,
    `snp_nys_tax_parcels_${spatialYear}_greene`,
    "src_greene_gis",
    `Imported ${features.length} Greene parcels from NYS Tax Parcels Public (roll ${rollYear}, spatial year ${spatialYear})`,
  );

  const batch: Batch = emptyBatch();
  const seen = new Set<string>();
  let skipped = 0;
  let withoutShape = 0;

  for (const feature of features) {
    const a = feature.properties;
    const swis = clean(a.SWIS);
    const printKey = clean(a.PRINT_KEY);
    if (!swis || !printKey) {
      skipped += 1;
      continue;
    }
    const key = `${swis}|${printKey}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);

    const propertyId = id("prop", key);
    const { municipality, kind } = splitMuni(a.MUNI_NAME);
    const streetNumber = clean(a.LOC_ST_NBR);
    const street = clean(a.LOC_STREET) ? expandStreet(clean(a.LOC_STREET)!) : null;
    const unit = clean(a.LOC_UNIT);
    const line = [streetNumber, street, unit ? `Unit ${unit}` : null].filter(Boolean).join(" ")
      || clean(a.PARCEL_ADDR)
      || "Unnamed parcel";
    const zip = postalCode(a, municipality);
    const formatted = `${line}, ${municipality ?? "Greene County"}, NY${zip ? ` ${zip}` : ""}`;
    const acreage = num(a.ACRES) && num(a.ACRES)! > 0 ? num(a.ACRES) : num(a.CALC_ACRES);
    const util = utilities(a.UTILITIES_DESC);

    batch.props.push({ property_id: propertyId, state: "NY", county: "Greene", municipality });
    batch.idents.push({
      parcel_identity_id: id("pid", key),
      property_id: propertyId,
      swis,
      sbl: clean(a.SBL) ?? printKey,
      print_key: printKey,
      is_current: true,
      effective_at: effective,
    });
    batch.addrs.push({
      address_id: id("adr", key),
      property_id: propertyId,
      street_number: streetNumber,
      street_name: street,
      city: municipality,
      state: "NY",
      postal_code: zip,
      formatted,
      is_current: true,
      source_id: "src_greene_roll",
    });
    if (feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")) {
      batch.geoms.push({
        geometry_id: id("geo", key),
        property_id: propertyId,
        geojson: JSON.stringify(feature.geometry),
        source_id: "src_greene_gis",
        quality: "official",
        effective_at: effective,
      });
      pushFacts(batch, key, propertyId, "src_greene_gis", effective, [
        ["geometry.kind", `Official tax-map polygon (${a.SPATIAL_YR ?? spatialYear} county tax map)`],
      ], 0.98);
    } else {
      withoutShape += 1;
    }

    pushFacts(batch, key, propertyId, "src_greene_roll", effective, [
      ["address", formatted],
      ["municipality", kind ? `${municipality} (${kind})` : municipality],
      ["county", "Greene"],
      ["parcel.sbl", printKey],
      ["parcel.swis", swis],
      ["acreage", acreage !== null ? Number(acreage.toFixed(2)) : null],
      ["property_class", propertyClass(a.PROP_CLASS)],
      ["year_built", num(a.YR_BLT) && num(a.YR_BLT)! > 1600 ? num(a.YR_BLT) : null],
      ["building_area", num(a.SQFT_LIVING) && num(a.SQFT_LIVING)! > 0 ? num(a.SQFT_LIVING) : null],
      ["assessment.land", num(a.LAND_AV)],
      ["assessment.total", num(a.TOTAL_AV)],
      ["market_value_estimate", num(a.FULL_MARKET_VAL)],
      ["owner_name_public", clean(a.PRIMARY_OWNER)],
      ["school_district", schoolDistrict(a.SCHOOL_NAME)],
      ["utility.electric", util.electric],
      ["utility.gas", util.gas],
      ["utility.water", clean(a.WATER_DESC)],
      ["utility.sewer", clean(a.SEWER_DESC)],
    ]);

    batch.evts.push({
      event_id: id("evt", `${key}|import`),
      property_id: propertyId,
      event_type: "parcel.imported",
      actor_type: "source",
      source_id: "src_greene_gis",
      payload_json: {
        adapter: "nys_tax_parcels_public",
        county: "Greene",
        roll_year: a.ROLL_YR ?? rollYear,
        spatial_year: a.SPATIAL_YR ?? spatialYear,
        print_key: printKey,
      },
      effective_at: effective,
    });
    if (num(a.TOTAL_AV) !== null) {
      batch.evts.push({
        event_id: id("evt", `${key}|assessment`),
        property_id: propertyId,
        event_type: "assessment.updated",
        actor_type: "source",
        source_id: "src_greene_roll",
        payload_json: { total: num(a.TOTAL_AV), roll_year: a.ROLL_YR ?? rollYear },
        effective_at: effective,
      });
    }
  }

  const { rejectedGeometries } = await writeBatch(sql, batch, "Greene");
  return {
    county: "Greene",
    properties: batch.props.length,
    shapes: batch.geoms.length - rejectedGeometries,
    notes: [
      `${batch.geoms.length - rejectedGeometries} official polygons, ${rejectedGeometries} unusable shapes, ${withoutShape} features without geometry`,
      `${skipped} features skipped (missing or duplicate SWIS/print key)`,
      `roll year ${rollYear}, spatial year ${spatialYear}`,
    ],
  };
}

/** Finish assertions/events after a size-limit interrupt. Properties and shapes stay put. */
export async function resumeMissingGreeneFacts(sql: Sql): Promise<{ properties: number; assertions: number; events: number }> {
  const missingRows = await sql<{ property_id: string }[]>`
    SELECT p.property_id FROM properties p
    WHERE p.county = ${"Greene"}
      AND NOT EXISTS (SELECT 1 FROM assertions a WHERE a.property_id = p.property_id)
  `;
  const missing = new Set(missingRows.map((row) => row.property_id));
  if (missing.size === 0) return { properties: 0, assertions: 0, events: 0 };

  console.log(`Greene resume: ${missing.size} properties still need facts; refetching the county roll…`);
  const features = await fetchCounty("Greene");
  const rollYears = new Set<number>();
  for (const feature of features) {
    if (feature.properties.ROLL_YR) rollYears.add(feature.properties.ROLL_YR);
  }
  const rollYear = Math.max(...rollYears, 2025);
  const effective = `${rollYear}-07-01`;

  const batch: Batch = emptyBatch();
  const seen = new Set<string>();
  for (const feature of features) {
    const a = feature.properties;
    const swis = clean(a.SWIS);
    const printKey = clean(a.PRINT_KEY);
    if (!swis || !printKey) continue;
    const key = `${swis}|${printKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const propertyId = id("prop", key);
    if (!missing.has(propertyId)) continue;

    const { municipality, kind } = splitMuni(a.MUNI_NAME);
    const streetNumber = clean(a.LOC_ST_NBR);
    const street = clean(a.LOC_STREET) ? expandStreet(clean(a.LOC_STREET)!) : null;
    const unit = clean(a.LOC_UNIT);
    const line = [streetNumber, street, unit ? `Unit ${unit}` : null].filter(Boolean).join(" ")
      || clean(a.PARCEL_ADDR)
      || "Unnamed parcel";
    const zip = postalCode(a, municipality);
    const formatted = `${line}, ${municipality ?? "Greene County"}, NY${zip ? ` ${zip}` : ""}`;
    const acreage = num(a.ACRES) && num(a.ACRES)! > 0 ? num(a.ACRES) : num(a.CALC_ACRES);
    const util = utilities(a.UTILITIES_DESC);

    if (feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")) {
      pushFacts(batch, key, propertyId, "src_greene_gis", effective, [
        ["geometry.kind", `Official tax-map polygon (${a.SPATIAL_YR ?? rollYear} county tax map)`],
      ], 0.98);
    }
    pushFacts(batch, key, propertyId, "src_greene_roll", effective, [
      ["address", formatted],
      ["municipality", kind ? `${municipality} (${kind})` : municipality],
      ["county", "Greene"],
      ["parcel.sbl", printKey],
      ["parcel.swis", swis],
      ["acreage", acreage !== null ? Number(acreage.toFixed(2)) : null],
      ["property_class", propertyClass(a.PROP_CLASS)],
      ["year_built", num(a.YR_BLT) && num(a.YR_BLT)! > 1600 ? num(a.YR_BLT) : null],
      ["building_area", num(a.SQFT_LIVING) && num(a.SQFT_LIVING)! > 0 ? num(a.SQFT_LIVING) : null],
      ["assessment.land", num(a.LAND_AV)],
      ["assessment.total", num(a.TOTAL_AV)],
      ["market_value_estimate", num(a.FULL_MARKET_VAL)],
      ["owner_name_public", clean(a.PRIMARY_OWNER)],
      ["school_district", schoolDistrict(a.SCHOOL_NAME)],
      ["utility.electric", util.electric],
      ["utility.gas", util.gas],
      ["utility.water", clean(a.WATER_DESC)],
      ["utility.sewer", clean(a.SEWER_DESC)],
    ]);
    batch.evts.push({
      event_id: id("evt", `${key}|import`),
      property_id: propertyId,
      event_type: "parcel.imported",
      actor_type: "source",
      source_id: "src_greene_gis",
      payload_json: {
        adapter: "nys_tax_parcels_public",
        county: "Greene",
        roll_year: a.ROLL_YR ?? rollYear,
        print_key: printKey,
      },
      effective_at: effective,
    });
  }

  console.log(`  Greene resume: writing ${batch.asrts.length} assertions and ${batch.evts.length} events for ${missing.size} properties…`);
  await insertRows(sql, "assertions", batch.asrts, ["assertion_id", "property_id", "field_key", "value_json", "source_id", "source_type", "effective_at", "observed_at", "confidence", "status"], 400);
  await insertRows(sql, "property_events", batch.evts, ["event_id", "property_id", "event_type", "actor_type", "source_id", "payload_json", "effective_at"]);
  return { properties: missing.size, assertions: batch.asrts.length, events: batch.evts.length };
}
