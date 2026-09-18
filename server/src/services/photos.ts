/**
 * Upload-time photo encode. Camera originals become a display-sized WebP so
 * the hero is sharp on a 5K display and a retina phone without shipping 12 MP.
 *
 * Encoder of record is the Cloudflare Images binding (any size, HEIC too, no
 * isolate memory involved). In-isolate WASM is the fallback for local dev and
 * for when Images declines; it is budgeted so a big JPEG cannot OOM the Worker,
 * and decode failures (tests, truncated files) keep the original bytes.
 */

import { PHOTO_MAX_EDGE, fitImageSize, imageDimensions, isProgressiveJpeg, tooBigForWorker } from "../../../shared/image-size.ts";
import { deferTask, imageTransformer } from "../runtime.ts";
import { ensureJpegDecode, ensurePngDecode, ensureResize, ensureWebpDecode, ensureWebpEncode } from "./photos-wasm.ts";
import { deleteDocumentObject, documentKey, putDocument } from "./storage.ts";

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
]);

/** Formats the in-isolate codecs can read. HEIC needs the Images binding. */
const WASM_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function shouldOptimizePhoto(mime: string | undefined, byteLength: number): boolean {
  if (!mime?.startsWith("image/") || SKIP_TYPES.has(mime)) return false;
  if (mime === "image/webp" || mime === "image/avif") return false;
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

function keepIfSmaller(original: OptimizedPhoto, encoded: Uint8Array, mime: string): OptimizedPhoto {
  if (encoded.byteLength === 0 || encoded.byteLength >= original.bytes.byteLength * 0.97) return original;
  return { bytes: encoded, mime, filename: withExtension(original.filename, "webp") };
}

/** Encode through the Images binding when the runtime has one. Null means "not handled". */
async function optimizeHosted(original: OptimizedPhoto, detected: string): Promise<OptimizedPhoto | null> {
  const transform = imageTransformer();
  if (!transform) return null;
  const size = imageDimensions(original.bytes);
  // Unknown dimensions: cap the long edge only; scale-down keeps the aspect ratio.
  const target = size ? fitImageSize(size.width, size.height) : { width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE };
  try {
    const result = await transform(original.bytes, { ...target, quality: PHOTO_WEBP_QUALITY });
    if (!result) return null;
    console.info("photo optimize (images)", { mime: detected, bytes: original.bytes.byteLength, out: result.bytes.byteLength, ...size });
    return keepIfSmaller(original, result.bytes, result.mime);
  } catch (error) {
    console.warn("photo optimize (images) failed", error instanceof Error ? error.message : error);
    return null;
  }
}

export interface OptimizeOptions {
  /** Try the Images binding first (default true). */
  hosted?: boolean;
  /** Fall back to in-isolate WASM (default true). Off on the Worker while a response is pending. */
  wasm?: boolean;
}

export async function optimizePhoto(input: Uint8Array, mime: string, filename: string, options: OptimizeOptions = {}): Promise<OptimizedPhoto> {
  const original = { bytes: input, mime: mime || "application/octet-stream", filename };
  const detected = sniffMime(input, mime);
  if (!shouldOptimizePhoto(detected, input.byteLength)) return original;
  if (options.hosted !== false) {
    const hosted = await optimizeHosted(original, detected);
    if (hosted) return hosted;
  }
  if (options.wasm === false) return original;
  if (!WASM_TYPES.has(detected)) return original;
  if (tooBigForWorker(input)) return original;
  try {
    const size = imageDimensions(input);
    console.info("photo optimize (wasm)", {
      mime: detected,
      bytes: input.byteLength,
      width: size?.width,
      height: size?.height,
      progressive: isProgressiveJpeg(input),
    });
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
    return keepIfSmaller(original, encoded, "image/webp");
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

export interface StoredUpload {
  stored: OptimizedPhoto;
  key: string;
  /**
   * Call once the document row references `key`. On the Worker this kicks off
   * the encode after the response; on Node it is a no-op because the encode
   * already ran inline.
   */
  commit: (apply: (stored: OptimizedPhoto, key: string) => Promise<void>) => void;
}

/**
 * Store an upload so the request can succeed no matter what the encoder does.
 *
 * Order of preference:
 * 1. Images binding, inline — off-isolate, so it is safe before the response,
 *    and the page's first render already gets the WebP.
 * 2. Node without a deferral hook — in-process WASM inline (dev, tests).
 * 3. Worker without Images (or Images declined) — write and record the
 *    original first, respond, then try WASM after the response. A 128 MB
 *    isolate can still die on an unlucky JPEG; that must not take the upload
 *    with it (it used to be an HTTP 503).
 */
export async function storeUpload(propertyId: string, documentId: string, file: File): Promise<StoredUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const original: OptimizedPhoto = { bytes, mime: file.type || "application/octet-stream", filename: file.name || "upload" };
  const encode = async (options: OptimizeOptions): Promise<{ stored: OptimizedPhoto; key: string } | null> => {
    const stored = await optimizePhoto(original.bytes, original.mime, original.filename, options);
    if (stored.bytes === original.bytes) return null;
    const key = documentKey(propertyId, documentId, stored.filename);
    await putDocument(key, stored.bytes);
    return { stored, key };
  };
  const defer = deferTask();
  const inline = await encode(defer ? { wasm: false } : {});
  if (inline) return { ...inline, commit: () => undefined };
  const originalKey = documentKey(propertyId, documentId, original.filename);
  await putDocument(originalKey, original.bytes);
  return {
    stored: original,
    key: originalKey,
    commit(apply) {
      if (!defer) return;
      defer(() =>
        encode({ hosted: false })
          .then(async (optimized) => {
            if (!optimized) return;
            await apply(optimized.stored, optimized.key);
            if (optimized.key !== originalKey) await deleteDocumentObject(originalKey);
          })
          .catch((error) => {
            console.warn("photo optimize after upload failed", error instanceof Error ? error.message : error);
          }),
      );
    },
  };
}
