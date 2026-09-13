import { AsyncLocalStorage } from "node:async_hooks";
import type postgres from "postgres";
import type { DocumentStore } from "./services/storage.ts";

export type EnvSource = Record<string, string | undefined>;

/**
 * Per-request runtime state. On Node the process is the runtime, so the
 * defaults below are used. On Cloudflare Workers, one isolate serves many
 * concurrent requests and bindings arrive per request, so the Worker entry
 * wraps each request in `runWithRuntime` instead of mutating module state.
 */
export interface Runtime {
  env: EnvSource;
  sql?: postgres.Sql;
  storage?: DocumentStore;
}

const scope = new AsyncLocalStorage<Runtime>();

export function currentRuntime(): Runtime | undefined {
  return scope.getStore();
}

export function runWithRuntime<T>(runtime: Runtime, fn: () => T): T {
  return scope.run(runtime, fn);
}

export function runtimeEnv(): EnvSource {
  const scoped = scope.getStore()?.env;
  if (scoped) return scoped;
  return typeof process !== "undefined" && process.env ? process.env : {};
}
