import { AsyncLocalStorage } from "node:async_hooks";
import type postgres from "postgres";
import type { DocumentStore } from "./services/storage.ts";

export type EnvSource = Record<string, string | undefined>;

/**
 * Off-isolate image encode (Cloudflare Images binding). Resizes into the box
 * and returns WebP; resolves null when the service declines (quota, format).
 */
export type ImageTransformer = (
  bytes: Uint8Array,
  target: { width: number; height: number; quality: number },
) => Promise<{ bytes: Uint8Array; mime: string } | null>;

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
  images?: ImageTransformer;
  /**
   * Run work after the response has gone out (Cloudflare `ctx.waitUntil`).
   * The task must not start earlier: a CPU-bound encode that begins while the
   * handler is still awaiting would block, or OOM, the pending response.
   * Absent on Node, where callers run the work inline instead.
   */
  defer?: (task: () => Promise<unknown>) => void;
}

const scope = new AsyncLocalStorage<Runtime>();

export function currentRuntime(): Runtime | undefined {
  return scope.getStore();
}

export function runWithRuntime<T>(runtime: Runtime, fn: () => T): T {
  return scope.run(runtime, fn);
}

export function imageTransformer(): ImageTransformer | undefined {
  return scope.getStore()?.images;
}

/** Schedule background work after the response when the runtime supports it. */
export function deferTask(): ((task: () => Promise<unknown>) => void) | undefined {
  return scope.getStore()?.defer;
}

export function runtimeEnv(): EnvSource {
  const scoped = scope.getStore()?.env;
  if (scoped) return scoped;
  return typeof process !== "undefined" && process.env ? process.env : {};
}
