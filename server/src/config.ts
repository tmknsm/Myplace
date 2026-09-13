import { runtimeEnv } from "./runtime.ts";

export const config = {
  get databaseUrl(): string {
    return runtimeEnv().DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace";
  },
  get sessionSecret(): string {
    return runtimeEnv().SESSION_SECRET ?? "dev-insecure-change-me";
  },
  get port(): number {
    return Number(runtimeEnv().PORT ?? 8787);
  },
  get appOrigin(): string {
    return runtimeEnv().APP_ORIGIN ?? "http://localhost:5173";
  },
  get isProduction(): boolean {
    return runtimeEnv().NODE_ENV === "production";
  },
  get devMailbox(): boolean {
    return (runtimeEnv().DEV_MAILBOX ?? "true") !== "false";
  },
  get documentRoot(): string {
    return runtimeEnv().DOCUMENT_ROOT ?? "data/documents";
  },
  get postmarkServerToken(): string | undefined {
    return runtimeEnv().POSTMARK_SERVER_TOKEN || undefined;
  },
  get mailFrom(): string | undefined {
    return runtimeEnv().MAIL_FROM || undefined;
  },
};

export function isDevExperience(): boolean {
  return !config.isProduction && config.devMailbox;
}
