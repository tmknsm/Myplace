import { config } from "../config.ts";
import { currentRuntime } from "../runtime.ts";

export interface DocumentStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

/** Structural subset of Cloudflare's R2Bucket, so the server compiles without Workers types. */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export function documentKey(propertyId: string, documentId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `property-documents/${propertyId}/${documentId}/${safe || "original"}`;
}

export function r2Store(bucket: R2BucketLike): DocumentStore {
  return {
    async put(key, bytes) {
      await bucket.put(key, bytes);
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) throw Object.assign(new Error("Document file is missing"), { status: 404 });
      return new Uint8Array(await object.arrayBuffer());
    },
  };
}

/** Local filesystem store that mirrors the R2 key layout. Loaded lazily so the Worker bundle never touches node:fs. */
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
      return readFile(join(root, key));
    },
  };
}

function store(): DocumentStore {
  return currentRuntime()?.storage ?? fsStore(config.documentRoot);
}

export function putDocument(key: string, bytes: Uint8Array): Promise<void> {
  return store().put(key, bytes);
}

export function getDocument(key: string): Promise<Uint8Array> {
  return store().get(key);
}
