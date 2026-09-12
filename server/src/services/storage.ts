import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.ts";

export function documentKey(propertyId: string, documentId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `property-documents/${propertyId}/${documentId}/${safe || "original"}`;
}

export async function putDocument(key: string, bytes: Uint8Array): Promise<void> {
  const path = join(config.documentRoot, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function getDocument(key: string): Promise<Uint8Array> {
  return readFile(join(config.documentRoot, key));
}
