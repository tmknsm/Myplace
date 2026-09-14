import { deflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { imageDimensions, isProgressiveJpeg, tooBigForWorker } from "../../../shared/image-size.ts";
import { runWithRuntime } from "../runtime.ts";
import { optimizePhoto, shouldOptimizePhoto, storeUpload } from "./photos.ts";
import { ensureWebpDecode } from "./photos-wasm.ts";
import { memoryStore } from "./storage.ts";

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
  // HEIC is compressible through the Images binding, so it is not skipped
  // outright; without that binding the in-isolate path leaves it alone.
  expect(shouldOptimizePhoto("image/heic", 2_000_000)).toBe(true);
  const heic = new Uint8Array(64);
  heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  const kept = await optimizePhoto(heic, "image/heic", "IMG_0001.heic");
  expect(kept.bytes).toBe(heic);
  expect(shouldOptimizePhoto("image/webp", 800_000)).toBe(false);
  expect(shouldOptimizePhoto("image/webp", 2_000_000)).toBe(false);
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

test("16 MP iPhone stills skip Worker WASM so the isolate does not OOM", () => {
  const still = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x12, 0x0b, 0x0d, 0x88, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
  ]);
  expect(imageDimensions(still)).toEqual({ width: 3464, height: 4619 });
  expect(tooBigForWorker(still)).toBe(true);
});

test("progressive jpegs get half the Worker pixel budget", () => {
  // SOF2 (0xffc2) frame, 3000×4000: fine as baseline, too big as progressive.
  const progressive = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x0b, 0xb8, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
  ]);
  const baseline = Uint8Array.from(progressive);
  baseline[3] = 0xc0;
  expect(imageDimensions(progressive)).toEqual({ width: 3000, height: 4000 });
  expect(isProgressiveJpeg(progressive)).toBe(true);
  expect(isProgressiveJpeg(baseline)).toBe(false);
  expect(tooBigForWorker(progressive)).toBe(true);
  expect(tooBigForWorker(baseline)).toBe(false);
});

test("on the Worker the original is stored first and the encode lands after the response", async () => {
  const store = memoryStore();
  const deferred: Array<() => Promise<unknown>> = [];
  const png = solidPng(640, 480);
  const file = new File([png.buffer as ArrayBuffer], "yard.png", { type: "image/png" });
  const applied: Array<{ mime: string; key: string }> = [];
  const runtime = { env: process.env, storage: store, defer: (task: () => Promise<unknown>) => { deferred.push(task); } };
  const upload = await runWithRuntime(runtime, async () => {
    const result = await storeUpload("prop_test", "doc_test", file);
    result.commit(async (stored, key) => { applied.push({ mime: stored.mime, key }); });
    return result;
  });
  expect(upload.stored.mime).toBe("image/png");
  expect(upload.key).toBe("property-documents/prop_test/doc_test/yard.png");
  expect(await store.has(upload.key)).toBe(true);
  expect(applied).toEqual([]);
  expect(deferred).toHaveLength(1);
  // Nothing was encoded yet: the Worker starts these only after the response.
  expect(await store.has("property-documents/prop_test/doc_test/yard.webp")).toBe(false);
  await Promise.all(deferred.map((task) => runWithRuntime(runtime, task)));
  expect(applied).toEqual([{ mime: "image/webp", key: "property-documents/prop_test/doc_test/yard.webp" }]);
  expect(await store.has("property-documents/prop_test/doc_test/yard.webp")).toBe(true);
  expect(await store.has(upload.key)).toBe(false);
}, 20_000);

test("with the Images binding the encode is inline even on the Worker, so no deferral is needed", async () => {
  const store = memoryStore();
  const deferred: Array<() => Promise<unknown>> = [];
  const calls: Array<{ bytes: number; width: number; height: number; quality: number }> = [];
  const heic = new Uint8Array(3_000_000);
  heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  const file = new File([heic.buffer as ArrayBuffer], "IMG_0001.HEIC", { type: "image/heic" });
  const runtime = {
    env: process.env,
    storage: store,
    defer: (task: () => Promise<unknown>) => { deferred.push(task); },
    images: async (bytes: Uint8Array, target: { width: number; height: number; quality: number }) => {
      calls.push({ bytes: bytes.byteLength, ...target });
      return { bytes: new Uint8Array(200_000), mime: "image/webp" };
    },
  };
  const upload = await runWithRuntime(runtime, () => storeUpload("prop_test", "doc_heic", file));
  expect(calls).toEqual([{ bytes: 3_000_000, width: 5120, height: 5120, quality: 80 }]);
  expect(upload.stored.mime).toBe("image/webp");
  expect(upload.stored.filename).toBe("IMG_0001.webp");
  expect(upload.key).toBe("property-documents/prop_test/doc_heic/IMG_0001.webp");
  expect(await store.has(upload.key)).toBe(true);
  expect(await store.has("property-documents/prop_test/doc_heic/IMG_0001.HEIC")).toBe(false);
  upload.commit(async () => { throw new Error("nothing to apply"); });
  expect(deferred).toEqual([]);
});

test("when Images declines, the Worker stores the original and defers the WASM fallback", async () => {
  const store = memoryStore();
  const deferred: Array<() => Promise<unknown>> = [];
  const png = solidPng(640, 480);
  const file = new File([png.buffer as ArrayBuffer], "yard.png", { type: "image/png" });
  const runtime = {
    env: process.env,
    storage: store,
    defer: (task: () => Promise<unknown>) => { deferred.push(task); },
    images: async () => { throw new Error("error code: 9422"); },
  };
  const applied: string[] = [];
  const upload = await runWithRuntime(runtime, async () => {
    const result = await storeUpload("prop_test", "doc_quota", file);
    result.commit(async (stored) => { applied.push(stored.mime); });
    return result;
  });
  expect(upload.stored.mime).toBe("image/png");
  expect(deferred).toHaveLength(1);
  await Promise.all(deferred.map((task) => runWithRuntime(runtime, task)));
  expect(applied).toEqual(["image/webp"]);
  expect(await store.has("property-documents/prop_test/doc_quota/yard.webp")).toBe(true);
}, 20_000);

test("without a deferral hook the encode runs inline and only the result is stored", async () => {
  const store = memoryStore();
  const png = solidPng(640, 480);
  const file = new File([png.buffer as ArrayBuffer], "yard.png", { type: "image/png" });
  const upload = await runWithRuntime({ env: process.env, storage: store }, () => storeUpload("prop_test", "doc_inline", file));
  expect(upload.stored.mime).toBe("image/webp");
  expect(upload.key).toBe("property-documents/prop_test/doc_inline/yard.webp");
  expect(await store.has(upload.key)).toBe(true);
  expect(await store.has("property-documents/prop_test/doc_inline/yard.png")).toBe(false);
}, 20_000);

test("large files with unknown dimensions skip Worker WASM", async () => {
  const mystery = new Uint8Array(1_500_001);
  expect(imageDimensions(mystery)).toBeNull();
  expect(tooBigForWorker(mystery)).toBe(true);
  const result = await optimizePhoto(mystery, "image/jpeg", "unknown.jpeg");
  expect(result.bytes).toBe(mystery);
});

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
