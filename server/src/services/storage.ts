import { config } from "../config.ts";
import { currentRuntime } from "../runtime.ts";

export interface DocumentStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** Structural subset of Cloudflare's R2Bucket, so the server compiles without Workers types. */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head?(key: string): Promise<{ size: number } | null>;
  delete?(key: string): Promise<unknown>;
}

export function documentKey(propertyId: string, documentId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `property-documents/${propertyId}/${documentId}/${safe || "original"}`;
}

function missingFile(): Error {
  return Object.assign(new Error("Document file is missing"), { status: 404 });
}

export function r2Store(bucket: R2BucketLike): DocumentStore {
  return {
    async put(key, bytes) {
      await bucket.put(key, bytes);
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) throw missingFile();
      return new Uint8Array(await object.arrayBuffer());
    },
    async has(key) {
      if (bucket.head) return Boolean(await bucket.head(key));
      return Boolean(await bucket.get(key));
    },
    async delete(key) {
      await bucket.delete?.(key);
    },
  };
}

/** In-memory store used by tests to stand in for the R2 bucket. */
export function memoryStore(map = new Map<string, Uint8Array>()): DocumentStore {
  return {
    async put(key, bytes) {
      map.set(key, Uint8Array.from(bytes));
    },
    async get(key) {
      const bytes = map.get(key);
      if (!bytes) throw missingFile();
      return bytes;
    },
    async has(key) {
      return map.has(key);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

/** Local filesystem store that mirrors the R2 key layout. Used only when R2 is not configured. */
export function fsStore(root: string): DocumentStore {
  return {
    async put(key, bytes) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname, join } = await import("node:path");
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async get(key) {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      try {
        return await readFile(join(root, key));
      } catch {
        throw missingFile();
      }
    },
    async has(key) {
      try {
        const { access } = await import("node:fs/promises");
        const { join } = await import("node:path");
        await access(join(root, key));
        return true;
      } catch {
        return false;
      }
    },
    async delete(key) {
      const { rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await rm(join(root, key), { force: true });
    },
  };
}

function r2ObjectUrl(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/r2/buckets/${config.r2Bucket}/objects/${encoded}`;
}

function r2Headers(): Record<string, string> {
  return { Authorization: `Bearer ${config.cloudflareApiToken}` };
}

/**
 * Node / tunnel access to the same R2 bucket the Worker binds as DOCUMENTS_BUCKET.
 * Uses the account API token already required for `cf:setup`.
 */
export function r2HttpStore(): DocumentStore {
  return {
    async put(key, bytes) {
      const res = await fetch(r2ObjectUrl(key), {
        method: "PUT",
        headers: { ...r2Headers(), "content-type": "application/octet-stream" },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`R2 put failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
    },
    async get(key) {
      const res = await fetch(r2ObjectUrl(key), { headers: r2Headers() });
      if (res.status === 404) throw missingFile();
      if (!res.ok) throw new Error(`R2 get failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async has(key) {
      const res = await fetch(r2ObjectUrl(key), { headers: r2Headers() });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return false;
      }
      if (!res.ok) throw new Error(`R2 has failed (${res.status})`);
      await res.body?.cancel().catch(() => undefined);
      return true;
    },
    async delete(key) {
      const res = await fetch(r2ObjectUrl(key), { method: "DELETE", headers: r2Headers() });
      await res.body?.cancel().catch(() => undefined);
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`);
    },
  };
}

export function r2HttpConfigured(): boolean {
  if (runtimeEnvIsTest()) return false;
  return Boolean(config.cloudflareAccountId && config.cloudflareApiToken);
}

function runtimeEnvIsTest(): boolean {
  return Boolean(process.env.VITEST) || process.env.R2_DISABLED === "1";
}

/** Worker binding, then the same R2 bucket over HTTP, then local disk for offline work. */
export function activeStore(): DocumentStore {
  const runtime = currentRuntime()?.storage;
  if (runtime) return runtime;
  if (r2HttpConfigured()) return r2HttpStore();
  return fsStore(config.documentRoot);
}

export async function putDocument(key: string, bytes: Uint8Array): Promise<void> {
  await activeStore().put(key, bytes);
}

export async function getDocument(key: string): Promise<Uint8Array> {
  return activeStore().get(key);
}

export async function deleteDocumentObject(key: string): Promise<void> {
  await activeStore().delete(key);
}

/** Keys whose bytes are missing from the active store (R2, or local disk if R2 is off). */
export async function missingDocumentKeys(keys: string[]): Promise<Set<string>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Set();
  const store = activeStore();
  const missing = new Set<string>();
  await Promise.all(unique.map(async (key) => {
    if (!(await store.has(key))) missing.add(key);
  }));
  return missing;
}
