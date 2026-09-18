/** Long edge for a sharp 5K full-bleed hero (2× of 2560 CSS). */
export const PHOTO_MAX_EDGE = 5120;
/** Stay inside iOS canvas / Worker memory. 5120×2880 16:9 still fits. */
export const PHOTO_MAX_PIXELS = 16_000_000;
/**
 * 3000×4000 client JPEGs (12.0 MP) encode on a 128 MB Worker; a 4032×3024
 * camera original (12.19 MP, 7 MB) already OOMs (CF 1102).
 */
export const PHOTO_WORKER_PIXELS = 12_100_000;
/**
 * Progressive JPEGs decode through a whole-image coefficient buffer on top of
 * the pixel buffers, so the same 128 MB runs out around half the pixels.
 */
export const PHOTO_WORKER_PROGRESSIVE_PIXELS = 6_000_000;

export type ImageSize = { width: number; height: number };

function u16(bytes: Uint8Array, offset: number, le = false): number {
  return le ? bytes[offset]! | (bytes[offset + 1]! << 8) : (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u32(bytes: Uint8Array, offset: number, le = false): number {
  return le
    ? (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0
    : ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function swapIfRotated(size: ImageSize, orientation: number): ImageSize {
  return orientation >= 5 && orientation <= 8 ? { width: size.height, height: size.width } : size;
}

function jpegOrientation(bytes: Uint8Array): number {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    const length = u16(bytes, offset + 2);
    if (marker === 0xe1 && length >= 8 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78) {
      const tiff = offset + 10;
      if (tiff + 8 >= bytes.length) return 1;
      const le = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const ifd = tiff + u32(bytes, tiff + 4, le);
      if (ifd + 2 >= bytes.length) return 1;
      const count = u16(bytes, ifd, le);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 >= bytes.length) break;
        if (u16(bytes, entry, le) === 0x0112) return u16(bytes, entry + 8, le) || 1;
      }
      return 1;
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return 1;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_SOF_PROGRESSIVE = new Set([0xc2, 0xc6, 0xca, 0xce]);

function jpegFrame(bytes: Uint8Array): { marker: number; size: ImageSize } | null {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (JPEG_SOF.has(marker)) {
      const size = { width: u16(bytes, offset + 7), height: u16(bytes, offset + 5) };
      if (!size.width || !size.height) return null;
      return { marker, size };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + u16(bytes, offset + 2);
  }
  return null;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  const frame = jpegFrame(bytes);
  return frame ? swapIfRotated(frame.size, jpegOrientation(bytes)) : null;
}

export function isProgressiveJpeg(bytes: Uint8Array): boolean {
  if (!isJpeg(bytes)) return false;
  const frame = jpegFrame(bytes);
  return Boolean(frame && JPEG_SOF_PROGRESSIVE.has(frame.marker));
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24) return null;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  return width && height ? { width, height } : null;
}

function walkBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (type: string, payload: number, limit: number) => void,
): void {
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = u32(bytes, offset + 12);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end + 0) break;
    visit(type, offset + header, offset + size);
    offset += size;
  }
}

const HEIF_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "meta", "iprp", "ipco", "dinf", "udta"]);

function heifSize(bytes: Uint8Array): ImageSize | null {
  let bestWidth = 0;
  let bestHeight = 0;
  let rotation = 0;
  const visit = (type: string, payload: number, limit: number) => {
    if (type === "ispe" && payload + 12 <= limit) {
      const width = u32(bytes, payload + 4);
      const height = u32(bytes, payload + 8);
      if (width && height && width * height > bestWidth * bestHeight) {
        bestWidth = width;
        bestHeight = height;
      }
    }
    if (type === "irot" && payload < limit) rotation = bytes[payload]! & 3;
    if (!HEIF_CONTAINERS.has(type)) return;
    walkBoxes(bytes, type === "meta" ? payload + 4 : payload, limit, visit);
  };
  walkBoxes(bytes, 0, bytes.length, visit);
  if (!bestWidth || !bestHeight) return null;
  return rotation % 2 === 1 ? { width: bestHeight, height: bestWidth } : { width: bestWidth, height: bestHeight };
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

/** Walk RIFF chunks for the first bitstream header: VP8 (lossy), VP8L (lossless), or VP8X (extended). */
function webpSize(bytes: Uint8Array): ImageSize | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const tag = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = u32(bytes, offset + 4, true);
    const payload = offset + 8;
    if (tag === "VP8X" && payload + 10 <= bytes.length) {
      const width = 1 + (bytes[payload + 4]! | (bytes[payload + 5]! << 8) | (bytes[payload + 6]! << 16));
      const height = 1 + (bytes[payload + 7]! | (bytes[payload + 8]! << 8) | (bytes[payload + 9]! << 16));
      return { width, height };
    }
    if (tag === "VP8 " && payload + 10 <= bytes.length) {
      const width = u16(bytes, payload + 6, true) & 0x3fff;
      const height = u16(bytes, payload + 8, true) & 0x3fff;
      return width && height ? { width, height } : null;
    }
    if (tag === "VP8L" && payload + 5 <= bytes.length) {
      const b0 = bytes[payload + 1]!;
      const b1 = bytes[payload + 2]!;
      const b2 = bytes[payload + 3]!;
      const b3 = bytes[payload + 4]!;
      const width = 1 + (b0 | ((b1 & 0x3f) << 8));
      const height = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
      return { width, height };
    }
    offset = payload + size + (size & 1);
  }
  return null;
}

export function imageDimensions(bytes: Uint8Array): ImageSize | null {
  if (isJpeg(bytes)) return jpegSize(bytes);
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return pngSize(bytes);
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return heifSize(bytes);
  if (isWebp(bytes)) return webpSize(bytes);
  return null;
}

/**
 * Long edges we serve photos at. The stored file is the archive; the page
 * asks for the smallest of these that covers the slot it is drawing into.
 * 480 covers thumbnails and avatars, 1280 a phone-width hero at 3×, 2560 a
 * desktop hero or lightbox at 2×.
 */
export const PHOTO_VARIANT_WIDTHS = [480, 1280, 2560] as const;
export type PhotoVariantWidth = (typeof PHOTO_VARIANT_WIDTHS)[number];

/** Round a requested width up to the variant we keep; null means "the original". */
export function snapVariantWidth(raw: string | number | null | undefined): PhotoVariantWidth | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const wanted = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(wanted) || wanted <= 0) return null;
  for (const width of PHOTO_VARIANT_WIDTHS) {
    if (wanted <= width) return width;
  }
  return PHOTO_VARIANT_WIDTHS[PHOTO_VARIANT_WIDTHS.length - 1]!;
}

export function fitImageSize(width: number, height: number, maxEdge = PHOTO_MAX_EDGE, maxPixels = PHOTO_MAX_PIXELS): ImageSize {
  let nextWidth = width;
  let nextHeight = height;
  const edge = Math.max(nextWidth, nextHeight);
  if (edge > maxEdge) {
    const scale = maxEdge / edge;
    nextWidth = Math.max(1, Math.round(nextWidth * scale));
    nextHeight = Math.max(1, Math.round(nextHeight * scale));
  }
  const pixels = nextWidth * nextHeight;
  if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels);
    nextWidth = Math.max(1, Math.round(nextWidth * scale));
    nextHeight = Math.max(1, Math.round(nextHeight * scale));
  }
  return { width: nextWidth, height: nextHeight };
}

/** Large payloads with no parseable SOF/IHDR — do not risk a WASM decode. */
const UNKNOWN_DIMENSIONS_SKIP_BYTES = 1_500_000;

export function tooBigForWorker(bytes: Uint8Array): boolean {
  const size = imageDimensions(bytes);
  if (!size) return bytes.byteLength > UNKNOWN_DIMENSIONS_SKIP_BYTES;
  const budget = isProgressiveJpeg(bytes) ? PHOTO_WORKER_PROGRESSIVE_PIXELS : PHOTO_WORKER_PIXELS;
  return size.width * size.height > budget;
}
