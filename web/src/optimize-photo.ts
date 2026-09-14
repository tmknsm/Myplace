/**
 * Shrink a camera original in the browser before upload so the network trip
 * is already small. Matches the server: 5120px long edge, WebP ~q80.
 * iPhone HEIC/48 MP files are sized from headers first so Safari never
 * materializes a 200 MB bitmap.
 */

import { PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS, fitImageSize, imageDimensions } from "../../shared/image-size.ts";

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

async function bitmapFromFile(file: File, width: number, height: number): Promise<ImageBitmap> {
  const sized = { resizeWidth: width, resizeHeight: height, resizeQuality: "high" as const };
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image", ...sized });
  } catch {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: width, resizeHeight: height });
    } catch {
      try {
        return await createImageBitmap(file, sized);
      } catch {
        return createImageBitmap(file);
      }
    }
  }
}

async function encodeAt(file: File, width: number, height: number): Promise<Blob | null> {
  const bitmap = await bitmapFromFile(file, width, height);
  const nextWidth = Math.max(1, Math.min(bitmap.width, width));
  const nextHeight = Math.max(1, Math.min(bitmap.height, height));
  const surface = canvas(nextWidth, nextHeight);
  const ctx = surface.getContext("2d");
  if (!ctx || !("drawImage" in ctx)) {
    bitmap.close();
    return null;
  }
  const draw = ctx as CanvasRenderingContext2D;
  draw.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in draw) draw.imageSmoothingQuality = "high";
  draw.drawImage(bitmap, 0, 0, nextWidth, nextHeight);
  bitmap.close();
  const webp = await canvasToBlob(surface, "image/webp", PHOTO_WEBP_QUALITY);
  if (webp && webp.size > 0 && webp.size < file.size * 0.97) return webp;
  const jpeg = await canvasToBlob(surface, "image/jpeg", 0.85);
  if (jpeg && jpeg.size > 0 && jpeg.size < file.size * 0.97) return jpeg;
  return null;
}

export async function optimizePhotoFile(file: File): Promise<File> {
  if (SKIP.has(file.type)) return file;
  if ((file.type === "image/webp" || file.type === "image/avif") && file.size <= 1_500_000) return file;
  const looksImage = file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!looksImage) return file;
  try {
    const header = new Uint8Array(await file.arrayBuffer());
    const native = imageDimensions(header);
    if (!native) return file;
    const maxPixels = isiOS() ? IOS_MAX_PIXELS : PHOTO_MAX_PIXELS;
    const next = fitImageSize(native.width, native.height, PHOTO_MAX_EDGE, maxPixels);
    const fallback = fitImageSize(native.width, native.height, 2560, 6_000_000);
    const blob = await encodeAt(file, next.width, next.height)
      ?? (Math.max(next.width, next.height) > 2560 ? await encodeAt(file, fallback.width, fallback.height) : null);
    if (!blob) return file;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], withExtension(file.name, ext), { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}
