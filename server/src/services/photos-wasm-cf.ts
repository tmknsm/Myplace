/**
 * Cloudflare-only. Static .wasm imports are how Wrangler ships CompiledWasm
 * modules. Keep this file off the Node/vitest graph — those resolve WASM from disk.
 */
import JPEG_DEC from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
// Rust packages ship instance typings next to the .wasm; Wrangler gives a Module.
// @ts-expect-error CompiledWasm default export
import PNG_DEC from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import WEBP_DEC from "@jsquash/webp/codec/dec/webp_dec.wasm";
import WEBP_ENC from "@jsquash/webp/codec/enc/webp_enc.wasm";
import WEBP_ENC_SIMD from "@jsquash/webp/codec/enc/webp_enc_simd.wasm";
// @ts-expect-error CompiledWasm default export
import RESIZE from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm";
import { initPhotoCodecs, setPhotoCodecLoader } from "./photos-wasm.ts";

export function registerCloudflarePhotoCodecs(): void {
  setPhotoCodecLoader(async () => {
    const { simd } = await import("wasm-feature-detect");
    const useSimd = await simd();
    await initPhotoCodecs({
      jpegDec: JPEG_DEC,
      pngDec: PNG_DEC,
      webpDec: WEBP_DEC,
      webpEnc: useSimd ? WEBP_ENC_SIMD : WEBP_ENC,
      resize: RESIZE,
    });
  });
}
