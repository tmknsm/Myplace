import postgres from "postgres";
import { config } from "./config.ts";
import { currentRuntime } from "./runtime.ts";

export type Sql = postgres.Sql;

let shared: Sql | null = null;

export function getSql(url = config.databaseUrl): Sql {
  const scoped = currentRuntime()?.sql;
  if (scoped) return scoped;
  if (shared) return shared;
  shared = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 15,
  });
  return shared;
}

export function setSql(sql: Sql | null): void {
  shared = sql;
}

/**
 * Run `fn` inside a transaction. Hyperdrive never caches transactional reads,
 * so this is the way to load a row you just wrote.
 */
export async function withoutQueryCache<T>(fn: () => Promise<T>): Promise<T> {
  const sql = getSql();
  await sql`begin`;
  try {
    const result = await fn();
    await sql`commit`;
    return result;
  } catch (error) {
    await sql`rollback`.catch(() => undefined);
    throw error;
  }
}

export async function closeSql(): Promise<void> {
  if (shared) {
    await shared.end();
    shared = null;
  }
}
