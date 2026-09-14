/**
 * Shrink a camera original in the browser before upload so the network trip
 * is already small. Matches the server: 5120px long edge, WebP ~q80.
 * iPhone HEIC/48 MP files are sized from headers first so Safari never
 * materializes a 200 MB bitmap.
 *
 * iOS revokes photo-library File objects after the input `change` handler
 * returns. Call snapshotPhotoFile during that handler (before any await) and
 * only pass the copy downstream.
 */

import { PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS, fitImageSize, imageDimensions, tooBigForWorker } from "../../shared/image-size.ts";

export { PHOTO_MAX_EDGE };
export const PHOTO_WEBP_QUALITY = 0.8;
const IOS_MAX_PIXELS = 12_000_000;

const SKIP = new Set(["image/svg+xml", "image/gif", "image/tiff"]);

function withExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.${ext}`;
}

function isiOS(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Copy picker bytes into a File that iOS cannot revoke when the input resets. */
export function snapshotPhotoFile(file: File): Promise<File> {
  return file.arrayBuffer().then((buffer) => {
    if (buffer.byteLength === 0) throw new Error("That photo was empty. Try again from Photos.");
    return new File([buffer], file.name || "photo", {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified,
    });
  });
}

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (!isiOS() && typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const node = document.createElement("canvas");
  node.width = width;
  node.height = height;
  return node;
}

async function canvasToBlob(surface: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in surface && !isiOS()) {
    try {
      return await surface.convertToBlob({ type, quality });
    } catch {
      return null;
    }
  }
  if (!("toBlob" in surface)) return null;
  return new Promise((resolve) => {
    (surface as HTMLCanvasElement).toBlob((blob) => resolve(blob), type, quality);
  });
}

async function bitmapFromBlob(source: Blob, width: number, height: number): Promise<ImageBitmap> {
  const sized = { resizeWidth: width, resizeHeight: height, resizeQuality: "high" as const };
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image", ...sized });
  } catch {
    try {
      return await createImageBitmap(source, { imageOrientation: "from-image", resizeWidth: width, resizeHeight: height });
    } catch {
      try {
        return await createImageBitmap(source, sized);
      } catch {
        return createImageBitmap(source);
      }
    }
  }
}

async function imageFromBlob(source: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function drawToCanvas(
  drawImage: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  width: number,
  height: number,
): Promise<OffscreenCanvas | HTMLCanvasElement | null> {
  const surface = canvas(width, height);
  const ctx = surface.getContext("2d");
  if (!ctx || !("drawImage" in ctx)) return null;
  const draw = ctx as CanvasRenderingContext2D;
  draw.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in draw) draw.imageSmoothingQuality = "high";
  drawImage(draw, width, height);
  return surface;
}

async function encodeSurface(surface: OffscreenCanvas | HTMLCanvasElement, sizeLimit: number): Promise<Blob | null> {
  const webp = await canvasToBlob(surface, "image/webp", PHOTO_WEBP_QUALITY);
  if (webp && webp.size > 0 && webp.size < sizeLimit) return webp;
  const jpeg = await canvasToBlob(surface, "image/jpeg", 0.85);
  if (jpeg && jpeg.size > 0 && jpeg.size < sizeLimit) return jpeg;
  return null;
}

async function encodeAt(source: Blob, width: number, height: number, sizeLimit: number): Promise<Blob | null> {
  try {
    const bitmap = await bitmapFromBlob(source, width, height);
    const nextWidth = Math.max(1, Math.min(bitmap.width, width));
    const nextHeight = Math.max(1, Math.min(bitmap.height, height));
    const surface = await drawToCanvas((ctx, w, h) => {
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
    }, nextWidth, nextHeight);
    if (!surface) {
      bitmap.close();
      return null;
    }
    return encodeSurface(surface, sizeLimit);
  } catch {
    try {
      const image = await imageFromBlob(source);
      const nextWidth = Math.max(1, Math.min(image.naturalWidth || width, width));
      const nextHeight = Math.max(1, Math.min(image.naturalHeight || height, height));
      const surface = await drawToCanvas((ctx, w, h) => ctx.drawImage(image, 0, 0, w, h), nextWidth, nextHeight);
      return surface ? encodeSurface(surface, sizeLimit) : null;
    } catch {
      return null;
    }
  }
}

export async function optimizePhotoFile(file: File): Promise<File> {
  let stable: File;
  try {
    stable = await snapshotPhotoFile(file);
  } catch (error) {
    throw error instanceof Error ? error : new Error("That photo could not be read. Try again.");
  }
  if (SKIP.has(stable.type)) return stable;
  if ((stable.type === "image/webp" || stable.type === "image/avif") && stable.size <= 1_500_000) return stable;
  const looksImage = stable.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(stable.name);
  if (!looksImage) return stable;
  try {
    const header = new Uint8Array(await stable.arrayBuffer());
    let native = imageDimensions(header);
    if (!native) {
      try {
        const preview = await imageFromBlob(stable);
        if (preview.naturalWidth && preview.naturalHeight) {
          native = { width: preview.naturalWidth, height: preview.naturalHeight };
        }
      } catch {
        return stable;
      }
    }
    if (!native) return stable;
    const maxPixels = isiOS() ? IOS_MAX_PIXELS : PHOTO_MAX_PIXELS;
    const next = fitImageSize(native.width, native.height, PHOTO_MAX_EDGE, maxPixels);
    const fallback = fitImageSize(native.width, native.height, 2560, 6_000_000);
    // A re-encode normally has to win on bytes. When the original is one the
    // Worker cannot finish (over its pixel budget, or a big progressive JPEG),
    // a slightly larger but Worker-sized JPEG still ends up as the smaller WebP.
    const sizeLimit = stable.size * (tooBigForWorker(header) ? 1.15 : 0.97);
    const blob = await encodeAt(stable, next.width, next.height, sizeLimit)
      ?? (Math.max(next.width, next.height) > 2560 ? await encodeAt(stable, fallback.width, fallback.height, sizeLimit) : null);
    if (!blob) return stable;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], withExtension(stable.name, ext), { type: blob.type, lastModified: stable.lastModified });
  } catch {
    return stable;
  }
}
