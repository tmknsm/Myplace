import { COLUMBIA_ROLL_YEAR, COLUMBIA_SOURCES, fetchRoll } from "./adapters/columbia.ts";
import { GREENE_SOURCES, fetchCounty } from "./adapters/greene.ts";
import {
  connect,
  emptyBatch,
  id,
  pushFacts,
  recordSnapshot,
  seedVocabulary,
  upsertAssertions,
  upsertSources,
  type Sql,
} from "./lib.ts";
import { columbiaExtraFacts, greeneExtraFacts } from "./roll-fields.ts";

/**
 * Add unused assessment-roll fields onto parcels that already exist.
 *
 * Does not delete properties, geometries, or any existing assertion. Each new
 * field is upserted by assertion_id. Safe to re-run.
 *
 *   npm run db:backfill-fields
 *   npm run db:backfill-fields -- --county=Greene
 */

function parseCounties(): string[] {
  const arg = process.argv.find((item) => item.startsWith("--county="));
  if (!arg) return ["Columbia", "Greene"];
  const wanted = arg.slice("--county=".length).split(",").map((name) => name.trim()).filter(Boolean);
  const known = ["Columbia", "Greene"];
  const resolved = wanted.map((name) => known.find((item) => item.toLowerCase() === name.toLowerCase()));
  const missing = wanted.filter((_, index) => !resolved[index]);
  if (missing.length) throw new Error(`Unknown county: ${missing.join(", ")}. Known: ${known.join(", ")}`);
  return resolved as string[];
}

async function existingIds(sql: Sql, county: string): Promise<Set<string>> {
  const rows = await sql<{ property_id: string }[]>`
    SELECT property_id FROM properties WHERE county = ${county}
  `;
  return new Set(rows.map((row) => row.property_id));
}

async function backfillGreene(sql: Sql): Promise<number> {
  const known = await existingIds(sql, "Greene");
  if (known.size === 0) {
    console.log("Greene: no existing properties; nothing to backfill");
    return 0;
  }
  console.log(`Greene: fetching the NYS tax-parcel roll to add unused fields onto ${known.size} existing parcels…`);
  const features = await fetchCounty("Greene");
  const rollYears = new Set<number>();
  for (const feature of features) {
    if (feature.properties.ROLL_YR) rollYears.add(feature.properties.ROLL_YR);
  }
  const rollYear = Math.max(...rollYears, 2025);
  const effective = `${rollYear}-07-01`;

  await upsertSources(sql, GREENE_SOURCES);
  const batch = emptyBatch();
  const seen = new Set<string>();
  let matched = 0;
  for (const feature of features) {
    const a = feature.properties;
    const swis = a.SWIS?.trim();
    const printKey = a.PRINT_KEY?.trim();
    if (!swis || !printKey) continue;
    const key = `${swis}|${printKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const propertyId = id("prop", key);
    if (!known.has(propertyId)) continue;
    matched += 1;
    pushFacts(batch, key, propertyId, "src_greene_roll", effective, greeneExtraFacts(a));
  }
  await upsertAssertions(sql, batch.asrts);
  await recordSnapshot(
    sql,
    `snp_greene_roll_fields_${rollYear}`,
    "src_greene_roll",
    `Backfilled ${batch.asrts.length} unused Greene roll fields for ${matched} existing parcels`,
  );
  console.log(`  Greene: ${batch.asrts.length} field assertions for ${matched} parcels (no deletes)`);
  return batch.asrts.length;
}

async function backfillColumbia(sql: Sql): Promise<number> {
  const known = await existingIds(sql, "Columbia");
  if (known.size === 0) {
    console.log("Columbia: no existing properties; nothing to backfill");
    return 0;
  }
  console.log(`Columbia: fetching ORPTS ${COLUMBIA_ROLL_YEAR} to add unused fields onto ${known.size} existing parcels…`);
  const rows = await fetchRoll(COLUMBIA_ROLL_YEAR);
  const effective = `${COLUMBIA_ROLL_YEAR}-07-01`;
  await upsertSources(sql, COLUMBIA_SOURCES.filter((source) => source.id === "src_orpts"));
  const batch = emptyBatch();
  const seen = new Set<string>();
  let matched = 0;
  for (const row of rows) {
    if (!row.swis_code || !row.print_key_code) continue;
    const key = `${row.swis_code}|${row.print_key_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const propertyId = id("prop", key);
    if (!known.has(propertyId)) continue;
    matched += 1;
    pushFacts(batch, key, propertyId, "src_orpts", effective, columbiaExtraFacts(row));
  }
  await upsertAssertions(sql, batch.asrts);
  await recordSnapshot(
    sql,
    `snp_columbia_roll_fields_${COLUMBIA_ROLL_YEAR}`,
    "src_orpts",
    `Backfilled ${batch.asrts.length} unused Columbia roll fields for ${matched} existing parcels`,
  );
  console.log(`  Columbia: ${batch.asrts.length} field assertions for ${matched} parcels (no deletes)`);
  return batch.asrts.length;
}

async function main() {
  const sql = connect();
  const started = Date.now();
  await seedVocabulary(sql);
  const counties = parseCounties();
  let written = 0;
  if (counties.includes("Columbia")) written += await backfillColumbia(sql);
  if (counties.includes("Greene")) written += await backfillGreene(sql);
  await sql`ANALYZE assertions`;
  console.log(`backfill wrote ${written} assertions in ${((Date.now() - started) / 1000).toFixed(0)}s (existing facts left in place)`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
