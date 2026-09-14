/**
 * Cloudflare Images binding as the photo encoder of record. It runs outside
 * the 128 MB isolate, takes inputs up to 20 MB / 100 MP including HEIC, and
 * applies EXIF rotation itself. WebP output always drops metadata.
 */

import type { ImageTransformer } from "../runtime.ts";

interface ImagesHandle {
  transform(options: Record<string, unknown>): ImagesHandle;
  output(options: Record<string, unknown>): Promise<{ response(): Response }>;
}

/** Structural subset of the Images binding, so the server compiles without Workers types. */
export interface ImagesBindingLike {
  input(stream: ReadableStream): ImagesHandle;
}

export function imagesTransformer(images: ImagesBindingLike): ImageTransformer {
  return async (bytes, target) => {
    const stream = new Blob([bytes as BlobPart]).stream();
    const result = await images
      .input(stream)
      .transform({ width: target.width, height: target.height, fit: "scale-down", metadata: "none" })
      .output({ format: "image/webp", quality: target.quality });
    const response = result.response();
    if (!response.ok) return null;
    const encoded = new Uint8Array(await response.arrayBuffer());
    if (encoded.byteLength === 0) return null;
    return { bytes: encoded, mime: response.headers.get("content-type") || "image/webp" };
  };
}
