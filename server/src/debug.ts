import { isDevExperience } from "./config.ts";

/**
 * Local-development shortcuts. Every route that imports from here is gated on
 * `isDevExperience()`, which is false whenever NODE_ENV=production (the Worker
 * default) or DEV_MAILBOX=false, so none of this is reachable in production.
 */

/** Hardcoded PIN that stands in for ownership verification while testing. */
export const DEBUG_CLAIM_PIN = "0516";

/** Account that receives a debug claim when nobody is signed in. */
export const DEBUG_OWNER_EMAIL = "debug-owner@myplace.local";

export function debugEnabled(): boolean {
  return isDevExperience();
}

export function pinMatches(candidate: unknown): boolean {
  return typeof candidate === "string" && candidate.replace(/\D/g, "") === DEBUG_CLAIM_PIN;
}
