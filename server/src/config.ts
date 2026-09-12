export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-insecure-change-me",
  port: Number(process.env.PORT ?? 8787),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  isProduction: process.env.NODE_ENV === "production",
  devMailbox: (process.env.DEV_MAILBOX ?? "true") !== "false",
  documentRoot: process.env.DOCUMENT_ROOT ?? "data/documents",
};

export function isDevExperience(): boolean {
  return !config.isProduction && config.devMailbox;
}
