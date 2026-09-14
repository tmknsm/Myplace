import { deflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { imageDimensions } from "../../../shared/image-size.ts";
import { optimizePhoto, shouldOptimizePhoto } from "./photos.ts";
import { ensureWebpDecode } from "./photos-wasm.ts";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  const crcBytes = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcBytes));
  return out;
}

/** Uncompressed-looking RGB PNG large enough that WebP should win. */
function solidPng(width: number, height: number, r = 40, g = 90, b = 180): Uint8Array {
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0);
    for (let x = 0; x < width; x++) rows.push(r, g, b);
  }
  const idat = deflateSync(Uint8Array.from(rows), { level: 0 });
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

test("tiny invalid jpegs are stored as-is so existing uploads keep working", async () => {
  const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const result = await optimizePhoto(raw, "image/jpeg", "IMG_9526.jpeg");
  expect(result.bytes).toEqual(raw);
  expect(result.mime).toBe("image/jpeg");
  expect(result.filename).toBe("IMG_9526.jpeg");
});

test("pdf and gif uploads are not re-encoded", async () => {
  expect(shouldOptimizePhoto("application/pdf", 80_000)).toBe(false);
  expect(shouldOptimizePhoto("image/gif", 80_000)).toBe(false);
  expect(shouldOptimizePhoto("image/heic", 2_000_000)).toBe(false);
  expect(shouldOptimizePhoto("image/webp", 800_000)).toBe(false);
  expect(shouldOptimizePhoto("image/webp", 2_000_000)).toBe(true);
  const raw = new Uint8Array([1, 2, 3, 4]);
  const result = await optimizePhoto(raw, "application/pdf", "bill.pdf");
  expect(result.bytes).toEqual(raw);
});

test("a large png becomes a smaller webp without changing the picture size budget", async () => {
  const png = solidPng(640, 480);
  expect(png.byteLength).toBeGreaterThan(8_000);
  const result = await optimizePhoto(png, "image/png", "yard.png");
  expect(result.mime).toBe("image/webp");
  expect(result.filename).toBe("yard.webp");
  expect(result.bytes.byteLength).toBeGreaterThan(20);
  expect(result.bytes.byteLength).toBeLessThan(png.byteLength * 0.5);
}, 20_000);

test("a jpeg that would OOM the Worker is stored as-is instead of decoded", async () => {
  const huge = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x27, 0x10, 0x1f, 0x40, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
  ]);
  expect(imageDimensions(huge)).toEqual({ width: 8000, height: 10000 });
  const result = await optimizePhoto(huge, "image/jpeg", "IMG_0001.jpeg");
  expect(result.bytes).toEqual(huge);
  expect(result.mime).toBe("image/jpeg");
});

test("a photo wider than the display budget is resized before encode", async () => {
  const png = solidPng(5300, 40);
  const result = await optimizePhoto(png, "image/png", "panorama.png");
  expect(result.mime).toBe("image/webp");
  await ensureWebpDecode();
  const { default: decode } = await import("@jsquash/webp/decode");
  const buffer = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
  const image = await decode(buffer);
  expect(image.width).toBe(5120);
  expect(image.height).toBe(39);
}, 20_000);
