import { describe, expect, test } from "vitest";
import { imageDimensions, snapVariantWidth } from "../../../shared/image-size.ts";
import { canServeVariant, variantKey } from "./photo-variants.ts";

function webpVp8(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  bytes[16] = 10; // chunk size
  bytes.set([0x9d, 0x01, 0x2a], 23); // start code
  bytes[26] = width & 0xff;
  bytes[27] = (width >> 8) & 0x3f;
  bytes[28] = height & 0xff;
  bytes[29] = (height >> 8) & 0x3f;
  return bytes;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  bytes[16] = 10;
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

describe("snapVariantWidth", () => {
  test("rounds a request up to the next stored size", () => {
    expect(snapVariantWidth("390")).toBe(480);
    expect(snapVariantWidth(481)).toBe(1280);
    expect(snapVariantWidth("1280")).toBe(1280);
    expect(snapVariantWidth(2000)).toBe(2560);
  });

  test("caps at the largest variant", () => {
    expect(snapVariantWidth(9000)).toBe(2560);
  });

  test("nothing asked, nothing snapped", () => {
    expect(snapVariantWidth(undefined)).toBeNull();
    expect(snapVariantWidth("")).toBeNull();
    expect(snapVariantWidth("abc")).toBeNull();
    expect(snapVariantWidth(0)).toBeNull();
  });
});

describe("imageDimensions for WebP", () => {
  test("reads a lossy VP8 header", () => {
    expect(imageDimensions(webpVp8(3000, 4000))).toEqual({ width: 3000, height: 4000 });
  });

  test("reads an extended VP8X header", () => {
    expect(imageDimensions(webpVp8x(1170, 780))).toEqual({ width: 1170, height: 780 });
  });
});

describe("variantKey", () => {
  test("sits beside the original under variants/", () => {
    expect(variantKey("property-documents/prop_1/doc_1/IMG_8651.webp", 1280))
      .toBe("property-documents/prop_1/doc_1/variants/IMG_8651.webp.w1280.webp");
    expect(variantKey("user-avatars/u1/abc-me.jpg", 480)).toBe("user-avatars/u1/variants/abc-me.jpg.w480.webp");
  });
});

describe("canServeVariant", () => {
  test("photos yes, vector and animated no", () => {
    expect(canServeVariant("image/webp")).toBe(true);
    expect(canServeVariant("image/jpeg")).toBe(true);
    expect(canServeVariant("image/gif")).toBe(false);
    expect(canServeVariant("image/svg+xml")).toBe(false);
    expect(canServeVariant("application/pdf")).toBe(false);
    expect(canServeVariant(null)).toBe(false);
  });
});
