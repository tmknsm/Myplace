/**
 * Shrink a camera original in the browser before upload so the network trip
 * is already small. Matches the server: 5120px long edge, WebP ~q80.
 * iPhone HEIC/48 MP files are sized from headers first so Safari never
 * materializes a 200 MB bitmap.
 */

import { PHOTO_MAX_EDGE, fitImageSize, imageDimensions } from "../../shared/image-size.ts";

export { PHOTO_MAX_EDGE };
export const PHOTO_WEBP_QUALITY = 0.8;

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

export async function optimizePhotoFile(file: File): Promise<File> {
  if (SKIP.has(file.type)) return file;
  if ((file.type === "image/webp" || file.type === "image/avif") && file.size <= 1_500_000) return file;
  const looksImage = file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!looksImage) return file;
  try {
    const header = new Uint8Array(await file.arrayBuffer());
    const native = imageDimensions(header);
    if (!native) return file;
    const next = fitImageSize(native.width, native.height);
    const bitmap = await bitmapFromFile(file, next.width, next.height);
    const width = Math.max(1, Math.min(bitmap.width, next.width));
    const height = Math.max(1, Math.min(bitmap.height, next.height));
    const surface = canvas(width, height);
    const ctx = surface.getContext("2d");
    if (!ctx || !("drawImage" in ctx)) {
      bitmap.close();
      return file;
    }
    const draw = ctx as CanvasRenderingContext2D;
    draw.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in draw) draw.imageSmoothingQuality = "high";
    draw.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const webp = await canvasToBlob(surface, "image/webp", PHOTO_WEBP_QUALITY);
    const blob = webp && webp.size > 0 && webp.size < file.size * 0.97
      ? webp
      : await canvasToBlob(surface, "image/jpeg", 0.85);
    if (!blob || blob.size >= file.size * 0.97) return file;
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], withExtension(file.name, ext), { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}
