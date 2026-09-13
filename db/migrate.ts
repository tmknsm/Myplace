import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { assertSafeToWipe } from "./safety.ts";

const here = dirname(fileURLToPath(import.meta.url));
const reset = process.argv.includes("--reset");
const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace";

const sql = postgres(url, { max: 1 });

const dropSql = `
DROP TABLE IF EXISTS
  field_vocabulary,
  handoff_invitations,
  emails,
  property_relationships,
  contribution_assertions,
  contributions,
  documents,
  property_maintainers,
  ownership_claims,
  property_events,
  assertions,
  property_addresses,
  property_geometries,
  parcel_identities,
  source_snapshots,
  properties,
  sources,
  auth_codes,
  sessions,
  user_emails,
  users
CASCADE;
`;

async function main() {
  if (reset) {
    assertSafeToWipe(url);
    await sql.unsafe(dropSql);
  }

  const dir = join(here, "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    await sql.unsafe(body);
    console.log(`applied ${file}`);
  }

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
