/**
 * jSquash codecs fetch their .wasm over HTTP unless we pass a compiled module.
 * That fetch fails in Node/vitest and in the Worker, so every environment
 * supplies the bytes itself: files on disk locally, CompiledWasm imports on CF.
 */

type WasmInit = (module: WebAssembly.Module) => Promise<unknown> | unknown;

export type PhotoWasmModules = {
  jpegDec: WebAssembly.Module;
  pngDec: WebAssembly.Module;
  webpDec: WebAssembly.Module;
  webpEnc: WebAssembly.Module;
  resize: WebAssembly.Module;
};

let loader: () => Promise<void> = initFromNodeModules;
let ready: Promise<void> | null = null;

export function setPhotoCodecLoader(next: () => Promise<void>): void {
  loader = next;
  ready = null;
}

export function ensurePhotoCodecs(): Promise<void> {
  ready ??= loader();
  return ready;
}

export async function initPhotoCodecs(modules: PhotoWasmModules): Promise<void> {
  const jpeg = await import("@jsquash/jpeg/decode");
  const png = await import("@jsquash/png/decode");
  const webpDec = await import("@jsquash/webp/decode");
  const webpEnc = await import("@jsquash/webp/encode");
  const resize = await import("@jsquash/resize");
  await (jpeg.init as unknown as WasmInit)(modules.jpegDec);
  await png.init(modules.pngDec);
  await (webpDec.init as unknown as WasmInit)(modules.webpDec);
  await (webpEnc.init as unknown as WasmInit)(modules.webpEnc);
  await resize.initResize(modules.resize);
}

async function initFromNodeModules(): Promise<void> {
  const { createRequire } = await import("node:module");
  const { readFile } = await import("node:fs/promises");
  const { simd } = await import("wasm-feature-detect");
  const require = createRequire(import.meta.url);
  const compile = async (id: string) => WebAssembly.compile(await readFile(require.resolve(id)));
  const useSimd = await simd();
  await initPhotoCodecs({
    jpegDec: await compile("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"),
    pngDec: await compile("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"),
    webpDec: await compile("@jsquash/webp/codec/dec/webp_dec.wasm"),
    webpEnc: await compile(
      useSimd ? "@jsquash/webp/codec/enc/webp_enc_simd.wasm" : "@jsquash/webp/codec/enc/webp_enc.wasm",
    ),
    resize: await compile("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm"),
  });
}
