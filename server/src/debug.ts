import { isDevExperience } from "./config.ts";

/**
 * Local-development shortcuts. Claim/PIN helpers stay gated on
 * `isDevExperience()`, which is false in production. The tester sign-in
 * below is the exception: Postmark is not configured on the Worker, so
 * that one account can still get in with a fixed code.
 */

/** Hardcoded PIN that stands in for ownership verification while testing. */
export const DEBUG_CLAIM_PIN = "0516";

/** Account that receives a debug claim when nobody is signed in. */
export const DEBUG_OWNER_EMAIL = "debug-owner@myplace.local";

/** Fixed production tester logins. Do not expire or get consumed. */
export const TEST_PROD_EMAIL = "michaeltomkins@gmail.com";
export const TEST_PROD_EMAILS = [TEST_PROD_EMAIL, "6point1five@pm.me"];
export const TEST_PROD_CODE = "000000";

export function debugEnabled(): boolean {
  return isDevExperience();
}

export function isFixedSignin(email: string, code: string): boolean {
  if (debugEnabled() && code === "000000") return true;
  return TEST_PROD_EMAILS.includes(email.toLowerCase()) && code === TEST_PROD_CODE;
}

export function pinMatches(candidate: unknown): boolean {
  return typeof candidate === "string" && candidate.replace(/\D/g, "") === DEBUG_CLAIM_PIN;
}
