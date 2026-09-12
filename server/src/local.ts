import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { config } from "./config.ts";

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Myplace API on http://localhost:${info.port}`);
});
