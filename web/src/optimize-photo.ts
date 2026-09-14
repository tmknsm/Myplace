/**
 * Shrink a camera original in the browser before upload so the network trip
 * is already small. Matches the server: 5120px long edge, WebP ~q80.
 */

export const PHOTO_MAX_EDGE = 5120;
export const PHOTO_WEBP_QUALITY = 0.8;

const SKIP = new Set(["image/svg+xml", "image/gif", "image/tiff"]);

async function bitmapFromFile(file: File): Promise<ImageBitmap> {
  const probe = await createImageBitmap(file, { imageOrientation: "from-image" });
  const edge = Math.max(probe.width, probe.height);
  if (edge <= PHOTO_MAX_EDGE) return probe;
  const scale = PHOTO_MAX_EDGE / edge;
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  probe.close();
  return createImageBitmap(file, {
    imageOrientation: "from-image",
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });
}

function withExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.${ext}`;
}

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const node = document.createElement("canvas");
  node.width = width;
  node.height = height;
  return node;
}

async function canvasToBlob(surface: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in surface) {
    try {
      return await surface.convertToBlob({ type, quality });
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    (surface as HTMLCanvasElement).toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function optimizePhotoFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || SKIP.has(file.type)) return file;
  if ((file.type === "image/webp" || file.type === "image/avif") && file.size <= 1_500_000) return file;
  try {
    const bitmap = await bitmapFromFile(file);
    const surface = canvas(bitmap.width, bitmap.height);
    const ctx = surface.getContext("2d");
    if (!ctx || !("drawImage" in ctx)) {
      bitmap.close();
      return file;
    }
    const draw = ctx as CanvasRenderingContext2D;
    draw.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in draw) draw.imageSmoothingQuality = "high";
    draw.drawImage(bitmap, 0, 0);
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
