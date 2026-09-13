import { importOverlays, type OverlayLayer } from "./adapters/overlays.ts";
import { connect } from "./lib.ts";

/**
 * Join public flood / wetland / historic / Catskill zoning layers onto existing parcels.
 * Does not wipe properties. Safe to re-run; each source's assertions are replaced.
 *
 *   npm run db:overlays
 *   npm run db:overlays -- --layer=flood,zoning
 */

const LAYERS: OverlayLayer[] = ["flood", "wetlands", "historic", "zoning"];

function parseLayers(): OverlayLayer[] | undefined {
  const arg = process.argv.find((item) => item.startsWith("--layer="));
  if (!arg) return undefined;
  const wanted = arg.slice("--layer=".length).split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((name) => !LAYERS.includes(name as OverlayLayer));
  if (unknown.length) throw new Error(`Unknown overlay layer: ${unknown.join(", ")}. Known: ${LAYERS.join(", ")}`);
  return wanted as OverlayLayer[];
}

async function main() {
  const sql = connect();
  const started = Date.now();
  const results = await importOverlays(sql, parseLayers());
  await sql`ANALYZE assertions`;

  const counts = await sql<{ field_key: string; n: number }[]>`
    SELECT field_key, count(*)::int AS n
    FROM assertions
    WHERE field_key IN ('flood.zone', 'wetlands', 'historic.district', 'zoning.district')
    GROUP BY field_key
    ORDER BY field_key
  `;
  console.log("");
  for (const result of results) {
    console.log(`${result.layer}: ${result.features} source polygons, ${result.assertions} facts (${result.positive} positive)`);
    for (const note of result.notes) console.log(`  · ${note}`);
  }
  console.log(`database now holds ${counts.map((row) => `${row.n} ${row.field_key}`).join(", ") || "no overlay facts"}`);
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
