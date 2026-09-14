import postgres from "postgres";
import { app } from "./app.ts";
import { runWithRuntime, type EnvSource } from "./runtime.ts";
import { r2Store, type R2BucketLike } from "./services/storage.ts";
import { imagesTransformer, type ImagesBindingLike } from "./services/photos-images.ts";
import { registerCloudflarePhotoCodecs } from "./services/photos-wasm-cf.ts";

registerCloudflarePhotoCodecs();

/** Bindings declared in wrangler.toml plus secrets set with `wrangler secret put`. */
export interface WorkerEnv {
  HYPERDRIVE?: { connectionString: string };
  DOCUMENTS_BUCKET?: R2BucketLike;
  IMAGES?: ImagesBindingLike;
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  APP_ORIGIN?: string;
  DEV_MAILBOX?: string;
  NODE_ENV?: string;
  POSTMARK_SERVER_TOKEN?: string;
  MAIL_FROM?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

function envFor(request: Request, env: WorkerEnv): EnvSource {
  const strings: EnvSource = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") strings[key] = value;
  }
  return {
    ...strings,
    NODE_ENV: env.NODE_ENV ?? "production",
    DEV_MAILBOX: env.DEV_MAILBOX ?? "false",
    APP_ORIGIN: env.APP_ORIGIN || new URL(request.url).origin,
    DATABASE_URL: env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL,
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContextLike): Promise<Response> {
    const runtimeEnv = envFor(request, env);
    if (!runtimeEnv.DATABASE_URL) {
      return Response.json({ error: "Database is not configured. Bind HYPERDRIVE or set DATABASE_URL." }, { status: 503 });
    }
    // Hyperdrive owns the real pool; a client per request is the recommended pattern.
    const sql = postgres(runtimeEnv.DATABASE_URL, { max: 5, fetch_types: false, prepare: true });
    const storage = env.DOCUMENTS_BUCKET ? r2Store(env.DOCUMENTS_BUCKET) : undefined;
    const images = env.IMAGES ? imagesTransformer(env.IMAGES) : undefined;
    // Work deferred past the response (photo encodes) starts only once the
    // handler has returned, and still needs this client.
    const deferred: Array<() => Promise<unknown>> = [];
    const runtime = { env: runtimeEnv, sql, storage, images, defer: (task: () => Promise<unknown>) => { deferred.push(task); } };
    try {
      return await runWithRuntime(runtime, () => app.fetch(request));
    } finally {
      ctx.waitUntil((async () => {
        if (deferred.length) {
          // Let the response leave the isolate before a WASM encode monopolizes it.
          await new Promise((resolve) => setTimeout(resolve, 250));
          await Promise.allSettled(deferred.map((task) => runWithRuntime(runtime, task)));
        }
        await sql.end({ timeout: 5 });
      })());
    }
  },
};
