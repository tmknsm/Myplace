import { importColumbia, type ImportStats } from "./adapters/columbia.ts";
import { importGreene } from "./adapters/greene.ts";
import { connect, deleteCounty, seedAdmin, seedVocabulary, wipePropertyTables } from "./lib.ts";

/**
 * Load real county-scale data from public New York sources.
 *
 *   tsx db/import.ts                  full import: wipes property tables and reloads every county
 *   tsx db/import.ts --county=Greene  reload one county in place (users, claims on other counties survive)
 */

const ADAPTERS: Record<string, (sql: ReturnType<typeof connect>) => Promise<ImportStats>> = {
  Columbia: importColumbia,
  Greene: importGreene,
};

function parseCounties(): string[] | null {
  const arg = process.argv.find((item) => item.startsWith("--county="));
  if (!arg) return null;
  const wanted = arg.slice("--county=".length).split(",").map((name) => name.trim()).filter(Boolean);
  const known = Object.keys(ADAPTERS);
  const resolved = wanted.map((name) => known.find((k) => k.toLowerCase() === name.toLowerCase()));
  const missing = wanted.filter((_, i) => !resolved[i]);
  if (missing.length) throw new Error(`Unknown county: ${missing.join(", ")}. Known: ${known.join(", ")}`);
  return resolved as string[];
}

async function main() {
  const only = parseCounties();
  const sql = connect();
  const started = Date.now();

  if (only) {
    for (const county of only) {
      const removed = await deleteCounty(sql, county);
      if (removed) console.log(`removed ${removed} existing ${county} properties`);
    }
  } else {
    console.log("Full import: clearing property tables…");
    await wipePropertyTables(sql);
  }
  await seedVocabulary(sql);
  await seedAdmin(sql);

  const results: ImportStats[] = [];
  for (const county of only ?? Object.keys(ADAPTERS)) {
    results.push(await ADAPTERS[county]!(sql));
  }

  const totals = await sql<{ county: string; n: number; shapes: number }[]>`
    SELECT p.county, count(*)::int AS n, count(g.geometry_id)::int AS shapes
    FROM properties p
    LEFT JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    GROUP BY p.county ORDER BY p.county
  `;
  await sql`ANALYZE properties, parcel_identities, property_addresses, property_geometries, assertions, property_events`;

  console.log("");
  for (const result of results) {
    console.log(`${result.county}: ${result.properties} properties, ${result.shapes} shapes`);
    for (const note of result.notes) console.log(`  · ${note}`);
  }
  console.log(`database now holds ${totals.map((row) => `${row.n} ${row.county} (${row.shapes} shapes)`).join(", ")}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
