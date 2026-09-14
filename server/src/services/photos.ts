/**
 * Upload-time photo encode. Camera originals become a display-sized WebP so
 * the hero is sharp on a 5K display and a retina phone without shipping 12 MP.
 * Decode failures (tests, truncated files, HEIC) keep the original bytes.
 * Huge camera files skip WASM so a 48 MP iPhone original cannot OOM the Worker.
 */

import { PHOTO_MAX_EDGE, fitImageSize, tooBigForWorker } from "../../../shared/image-size.ts";
import { ensureJpegDecode, ensurePngDecode, ensureResize, ensureWebpDecode, ensureWebpEncode } from "./photos-wasm.ts";

export { PHOTO_MAX_EDGE };
export const PHOTO_WEBP_QUALITY = 80;

export interface OptimizedPhoto {
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

const SKIP_TYPES = new Set([
  "image/svg+xml",
  "image/gif",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

export function shouldOptimizePhoto(mime: string | undefined, byteLength: number): boolean {
  if (!mime?.startsWith("image/") || SKIP_TYPES.has(mime)) return false;
  if ((mime === "image/webp" || mime === "image/avif") && byteLength > 0 && byteLength <= 1_500_000) return false;
  return true;
}

function withExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "photo";
  return `${base}.${ext}`;
}

function sniffMime(bytes: Uint8Array, fallback: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return fallback || "image/heic";
  return fallback;
}

type Raster = { width: number; height: number; data: Uint8ClampedArray };

async function decodeRaster(bytes: Uint8Array, mime: string): Promise<Raster> {
  const kind = sniffMime(bytes, mime);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  if (kind === "image/jpeg") {
    await ensureJpegDecode();
    const { default: decode } = await import("@jsquash/jpeg/decode");
    return decode(buffer, { preserveOrientation: true });
  }
  if (kind === "image/png") {
    await ensurePngDecode();
    const { default: decode } = await import("@jsquash/png/decode");
    return decode(buffer);
  }
  if (kind === "image/webp") {
    await ensureWebpDecode();
    const { default: decode } = await import("@jsquash/webp/decode");
    return decode(buffer);
  }
  throw new Error(`Unsupported image type: ${kind}`);
}

export function targetSize(width: number, height: number): { width: number; height: number } {
  return fitImageSize(width, height, PHOTO_MAX_EDGE);
}

export async function optimizePhoto(input: Uint8Array, mime: string, filename: string): Promise<OptimizedPhoto> {
  const original = { bytes: input, mime: mime || "application/octet-stream", filename };
  const detected = sniffMime(input, mime);
  if (!shouldOptimizePhoto(detected, input.byteLength)) return original;
  if (tooBigForWorker(input)) return original;
  try {
    let image = await decodeRaster(input, detected);
    const next = targetSize(image.width, image.height);
    if (next.width !== image.width || next.height !== image.height) {
      await ensureResize();
      const { default: resize } = await import("@jsquash/resize");
      image = await resize(image as Parameters<typeof resize>[0], { width: next.width, height: next.height, method: "lanczos3" });
    }
    await ensureWebpEncode();
    const { default: encode } = await import("@jsquash/webp/encode");
    const encoded = new Uint8Array(await encode(image as Parameters<typeof encode>[0], { quality: PHOTO_WEBP_QUALITY }));
    if (encoded.byteLength === 0 || encoded.byteLength >= input.byteLength * 0.97) return original;
    return { bytes: encoded, mime: "image/webp", filename: withExtension(filename, "webp") };
  } catch (error) {
    console.warn("photo optimize skipped", error instanceof Error ? error.message : error);
    return original;
  }
}

export async function ingestUploadFile(file: File): Promise<OptimizedPhoto> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  return optimizePhoto(bytes, mime, file.name || "upload");
}
