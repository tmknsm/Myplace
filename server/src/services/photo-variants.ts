/**
 * Display-sized copies of stored photos. The upload stays the archive; the
 * page asks for `?w=` and gets a WebP whose long edge fits one of
 * PHOTO_VARIANT_WIDTHS. Each variant is rendered once, on first request,
 * and written back beside the original so later reads are a plain R2 get.
 */

import { PHOTO_VARIANT_WIDTHS, imageDimensions, type PhotoVariantWidth } from "../../../shared/image-size.ts";
import { deferTask } from "../runtime.ts";
import { resizePhoto } from "./photos.ts";
import { activeStore } from "./storage.ts";

const NO_VARIANT_TYPES = new Set(["image/svg+xml", "image/gif"]);

export interface PhotoBytes {
  bytes: Uint8Array;
  mime: string;
}

export function variantKey(storageKey: string, width: PhotoVariantWidth): string {
  const slash = storageKey.lastIndexOf("/");
  const dir = storageKey.slice(0, slash + 1);
  const file = storageKey.slice(slash + 1) || "original";
  return `${dir}variants/${file}.w${width}.webp`;
}

export function canServeVariant(mime: string | null | undefined): boolean {
  return Boolean(mime?.startsWith("image/")) && !NO_VARIANT_TYPES.has(mime!);
}

/**
 * Bytes to serve for `storageKey` at `width`. Falls back to the original
 * when it is already small enough or the encoder declines. Throws the
 * store's missing-file error when the original itself is gone.
 */
export async function photoVariant(storageKey: string, mime: string, width: PhotoVariantWidth): Promise<PhotoBytes> {
  const store = activeStore();
  const key = variantKey(storageKey, width);
  try {
    return { bytes: await store.get(key), mime: "image/webp" };
  } catch {
    // Not rendered yet.
  }
  const original = await store.get(storageKey);
  const size = imageDimensions(original);
  if (size && Math.max(size.width, size.height) <= width) return { bytes: original, mime };
  const defer = deferTask();
  const resized = await resizePhoto(original, mime, width, { wasm: !defer });
  if (!resized) return { bytes: original, mime };
  const save = () => store.put(key, resized.bytes).catch((error) => {
    console.warn("photo variant save failed", error instanceof Error ? error.message : error);
  });
  if (defer) defer(save);
  else await save();
  return resized;
}

/** Drop every rendered size for a key; called when the original is replaced. */
export async function deletePhotoVariants(storageKey: string): Promise<void> {
  const store = activeStore();
  await Promise.all(PHOTO_VARIANT_WIDTHS.map((width) => store.delete(variantKey(storageKey, width)).catch(() => undefined)));
}
