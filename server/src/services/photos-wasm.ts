/**
 * jSquash codecs fetch their .wasm over HTTP unless we pass a compiled module.
 * Load only the codec this file needs — initializing every WASM heap at once
 * is enough to OOM a 128 MB Worker when the photo is a 12 MP iPhone JPEG.
 */

type WasmInit = (module: WebAssembly.Module) => Promise<unknown> | unknown;

export type PhotoWasmSource = {
  jpegDec: () => Promise<WebAssembly.Module>;
  pngDec: () => Promise<WebAssembly.Module>;
  webpDec: () => Promise<WebAssembly.Module>;
  webpEnc: () => Promise<WebAssembly.Module>;
  resize: () => Promise<WebAssembly.Module>;
};

const ready = new Map<string, Promise<void>>();
let source: PhotoWasmSource = nodeSource();

export function setPhotoCodecSource(next: PhotoWasmSource): void {
  source = next;
  ready.clear();
}

function once(key: string, start: () => Promise<void>): Promise<void> {
  const pending = ready.get(key);
  if (pending) return pending;
  const next = start();
  ready.set(key, next);
  return next;
}

export function ensureJpegDecode(): Promise<void> {
  return once("jpegDec", async () => {
    const jpeg = await import("@jsquash/jpeg/decode");
    await (jpeg.init as unknown as WasmInit)(await source.jpegDec());
  });
}

export function ensurePngDecode(): Promise<void> {
  return once("pngDec", async () => {
    const png = await import("@jsquash/png/decode");
    await png.init(await source.pngDec());
  });
}

export function ensureWebpDecode(): Promise<void> {
  return once("webpDec", async () => {
    const webp = await import("@jsquash/webp/decode");
    await (webp.init as unknown as WasmInit)(await source.webpDec());
  });
}

export function ensureWebpEncode(): Promise<void> {
  return once("webpEnc", async () => {
    const webp = await import("@jsquash/webp/encode");
    await (webp.init as unknown as WasmInit)(await source.webpEnc());
  });
}

export function ensureResize(): Promise<void> {
  return once("resize", async () => {
    const resize = await import("@jsquash/resize");
    await resize.initResize(await source.resize());
  });
}

function nodeSource(): PhotoWasmSource {
  const compile = async (id: string) => {
    const { createRequire } = await import("node:module");
    const { readFile } = await import("node:fs/promises");
    const require = createRequire(import.meta.url);
    return WebAssembly.compile(await readFile(require.resolve(id)));
  };
  return {
    jpegDec: () => compile("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"),
    pngDec: () => compile("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"),
    webpDec: () => compile("@jsquash/webp/codec/dec/webp_dec.wasm"),
    webpEnc: async () => {
      const { simd } = await import("wasm-feature-detect");
      return compile(
        (await simd()) ? "@jsquash/webp/codec/enc/webp_enc_simd.wasm" : "@jsquash/webp/codec/enc/webp_enc.wasm",
      );
    },
    resize: () => compile("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm"),
  };
}
