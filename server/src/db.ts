import postgres from "postgres";
import { config } from "./config.ts";
import { currentRuntime } from "./runtime.ts";

export type Sql = postgres.Sql;

let shared: Sql | null = null;

export function getSql(url = config.databaseUrl): Sql {
  const scoped = currentRuntime()?.sql;
  if (scoped) return scoped;
  if (shared) return shared;
  shared = postgres(url, { max: 10 });
  return shared;
}

export function setSql(sql: Sql | null): void {
  shared = sql;
}

export async function closeSql(): Promise<void> {
  if (shared) {
    await shared.end();
    shared = null;
  }
}
