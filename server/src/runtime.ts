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
  /**
   * Keep a promise alive past the response (Cloudflare `ctx.waitUntil`). Absent
   * on Node, where callers run the work inline instead.
   */
  defer?: (task: Promise<unknown>) => void;
}

const scope = new AsyncLocalStorage<Runtime>();

export function currentRuntime(): Runtime | undefined {
  return scope.getStore();
}

export function runWithRuntime<T>(runtime: Runtime, fn: () => T): T {
  return scope.run(runtime, fn);
}

/** Schedule background work after the response when the runtime supports it. */
export function deferTask(): ((task: Promise<unknown>) => void) | undefined {
  return scope.getStore()?.defer;
}

export function runtimeEnv(): EnvSource {
  const scoped = scope.getStore()?.env;
  if (scoped) return scoped;
  return typeof process !== "undefined" && process.env ? process.env : {};
}
