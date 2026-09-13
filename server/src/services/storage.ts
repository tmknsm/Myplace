import { config } from "../config.ts";
import { getSql } from "../db.ts";
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

function missingFile(): Error {
  return Object.assign(new Error("Document file is missing"), { status: 404 });
}

/** Bytes live in Postgres so every machine that shares DATABASE_URL can serve them. */
export function postgresStore(): DocumentStore {
  return {
    async put(key, bytes) {
      const sql = getSql();
      const payload = Buffer.from(bytes);
      await sql`
        INSERT INTO document_blobs (storage_key, bytes, byte_size)
        VALUES (${key}, ${payload}, ${payload.byteLength})
        ON CONFLICT (storage_key) DO UPDATE SET bytes = EXCLUDED.bytes, byte_size = EXCLUDED.byte_size
      `;
    },
    async get(key) {
      const sql = getSql();
      const rows = await sql<{ bytes: Uint8Array }[]>`
        SELECT bytes FROM document_blobs WHERE storage_key = ${key}
      `;
      if (!rows[0]) throw missingFile();
      return rows[0].bytes instanceof Uint8Array ? rows[0].bytes : new Uint8Array(rows[0].bytes);
    },
  };
}

async function tryGet(store: DocumentStore, key: string): Promise<Uint8Array | null> {
  try {
    return await store.get(key);
  } catch {
    return null;
  }
}

export async function putDocument(key: string, bytes: Uint8Array): Promise<void> {
  const runtime = currentRuntime()?.storage;
  await Promise.all([
    postgresStore().put(key, bytes),
    runtime ? runtime.put(key, bytes) : fsStore(config.documentRoot).put(key, bytes),
  ]);
}

export async function getDocument(key: string): Promise<Uint8Array> {
  const runtime = currentRuntime()?.storage;
  if (runtime) {
    const fromRuntime = await tryGet(runtime, key);
    if (fromRuntime) return fromRuntime;
  }
  const fromDb = await tryGet(postgresStore(), key);
  if (fromDb) return fromDb;
  const fromDisk = await tryGet(fsStore(config.documentRoot), key);
  if (fromDisk) {
    await postgresStore().put(key, fromDisk).catch(() => undefined);
    return fromDisk;
  }
  throw missingFile();
}
