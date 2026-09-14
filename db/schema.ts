import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));

/** Every table the migrations create, children first so a plain DROP order works. */
export const ALL_TABLES = [
  "schema_migrations",
  "document_blobs", // dropped by 005; kept here so --reset still wipes leftover DBs
  "notification_preferences",
  "property_improvements",
  "field_vocabulary",
  "handoff_invitations",
  "emails",
  "property_relationships",
  "contribution_assertions",
  "contributions",
  "documents",
  "property_maintainers",
  "ownership_claims",
  "property_events",
  "assertions",
  "property_addresses",
  "property_geometries",
  "parcel_identities",
  "source_snapshots",
  "properties",
  "sources",
  "auth_codes",
  "sessions",
  "user_emails",
  "users",
];

export const dropSql = `DROP TABLE IF EXISTS ${ALL_TABLES.join(", ")} CASCADE;`;

/**
 * Apply every migration in db/migrations that has not been recorded yet.
 * Databases created before migration tracking existed have 001 marked as
 * applied when the users table is already present, so later migrations can
 * land on a live database without a wipe.
 */
export async function applyMigrations(db: postgres.Sql, log: (line: string) => void = console.log): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const legacy = await db<{ exists: boolean }[]>`
    SELECT to_regclass('public.users') IS NOT NULL AS exists
  `;
  const applied = new Set((await db<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name));
  if (legacy[0]?.exists && applied.size === 0) {
    await db`INSERT INTO schema_migrations (name) VALUES ('001_init.sql') ON CONFLICT DO NOTHING`;
    applied.add("001_init.sql");
  }

  const files = readdirSync(join(here, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(join(here, "migrations", file), "utf8");
    await db.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    log(`applied ${file}`);
  }
}
