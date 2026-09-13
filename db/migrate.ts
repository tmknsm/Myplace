import postgres from "postgres";
import { assertSafeToWipe } from "./safety.ts";
import { applyMigrations, dropSql } from "./schema.ts";

const reset = process.argv.includes("--reset");
const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace";

const sql = postgres(url, { max: 1 });

async function main() {
  if (reset) {
    assertSafeToWipe(url);
    await sql.unsafe(dropSql);
  }
  await applyMigrations(sql);
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
