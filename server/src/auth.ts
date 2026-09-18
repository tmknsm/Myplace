import { createHash, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { DEFAULT_AVATAR_URL } from "../../shared/profile.ts";
import { config } from "./config.ts";
import { getSql } from "./db.ts";
import { id } from "./ids.ts";

export interface AuthedUser {
  user_id: string;
  primary_email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  handle: string | null;
  anonymize: boolean;
  avatar_url: string | null;
  avatar_key: string | null;
  is_admin: boolean;
}

function cleanName(value: string | undefined): string | null {
  const next = value?.replace(/\s+/g, " ").trim() ?? "";
  return next || null;
}

function displayFromNames(first: string | null, last: string | null, fallback: string): string {
  return [first, last].filter(Boolean).join(" ") || fallback;
}

export type AppEnv = {
  Variables: {
    user: AuthedUser | null;
  };
};

const COOKIE = "myplace_session";

export function hashCode(email: string, code: string): string {
  return createHash("sha256")
    .update(`${config.sessionSecret}:${email.toLowerCase()}:${code}`)
    .digest("hex");
}

export function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createSession(userId: string): Promise<string> {
  const sql = getSql();
  const sessionId = id("ses");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  await sql`
    INSERT INTO sessions (session_id, user_id, expires_at)
    VALUES (${sessionId}, ${userId}, ${expires})
  `;
  return sessionId;
}

export function attachSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: config.isProduction,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const sessionId = getCookie(c, COOKIE);
  if (!sessionId) {
    c.set("user", null);
    await next();
    return;
  }
  const sql = getSql();
  const rows = await sql<AuthedUser[]>`
    SELECT u.user_id, u.primary_email, u.display_name, u.first_name, u.last_name,
           u.handle, u.anonymize, u.avatar_url, u.avatar_key, u.is_admin
    FROM sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.session_id = ${sessionId} AND s.expires_at > now()
  `;
  c.set("user", rows[0] ?? null);
  await next();
}

export function requireUser(c: Context<AppEnv>): AuthedUser {
  const user = c.get("user");
  if (!user) throw Object.assign(new Error("Sign in required"), { status: 401 });
  return user;
}

export function requireAdmin(c: Context<AppEnv>): AuthedUser {
  const user = requireUser(c);
  if (!user.is_admin) throw Object.assign(new Error("Admin only"), { status: 403 });
  return user;
}

export async function loadUser(userId: string): Promise<AuthedUser | null> {
  const sql = getSql();
  const rows = await sql<AuthedUser[]>`
    SELECT user_id, primary_email, display_name, first_name, last_name,
           handle, anonymize, avatar_url, avatar_key, is_admin
    FROM users WHERE user_id = ${userId}
  `;
  return rows[0] ?? null;
}

export async function upsertUser(email: string, names?: { firstName?: string; lastName?: string; handle?: string | null }): Promise<AuthedUser> {
  const sql = getSql();
  const normalized = email.trim().toLowerCase();
  const firstName = cleanName(names?.firstName);
  const lastName = cleanName(names?.lastName);
  const handle = names?.handle ?? null;
  const existing = await sql<AuthedUser[]>`
    SELECT user_id, primary_email, display_name, first_name, last_name,
           handle, anonymize, avatar_url, avatar_key, is_admin
    FROM users WHERE primary_email = ${normalized}
  `;
  if (existing[0]) {
    const current = existing[0];
    const nextFirst = current.first_name || firstName;
    const nextLast = current.last_name || lastName;
    const nextDisplay = current.display_name || displayFromNames(nextFirst, nextLast, normalized.split("@")[0] || normalized);
    const nextHandle = current.handle || handle;
    await sql`
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, now()),
          first_name = COALESCE(first_name, ${nextFirst}),
          last_name = COALESCE(last_name, ${nextLast}),
          display_name = COALESCE(display_name, ${nextDisplay}),
          handle = COALESCE(handle, ${nextHandle}),
          avatar_url = COALESCE(avatar_url, ${DEFAULT_AVATAR_URL})
      WHERE user_id = ${current.user_id}
    `;
    return {
      ...current,
      first_name: nextFirst,
      last_name: nextLast,
      display_name: nextDisplay,
      handle: nextHandle,
      avatar_url: current.avatar_url || DEFAULT_AVATAR_URL,
    };
  }
  const userId = id("usr");
  const displayName = displayFromNames(firstName, lastName, normalized.split("@")[0] || normalized);
  await sql`
    INSERT INTO users (
      user_id, primary_email, email_verified_at, display_name, first_name, last_name,
      handle, anonymize, avatar_url
    )
    VALUES (
      ${userId}, ${normalized}, now(), ${displayName}, ${firstName}, ${lastName},
      ${handle}, false, ${DEFAULT_AVATAR_URL}
    )
  `;
  await sql`
    INSERT INTO user_emails (user_email_id, user_id, email, verified_at)
    VALUES (${id("uem")}, ${userId}, ${normalized}, now())
  `;
  return {
    user_id: userId,
    primary_email: normalized,
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    handle,
    anonymize: false,
    avatar_url: DEFAULT_AVATAR_URL,
    avatar_key: null,
    is_admin: false,
  };
}

export async function isMaintainer(userId: string, propertyId: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM property_maintainers
    WHERE user_id = ${userId} AND property_id = ${propertyId} AND revoked_at IS NULL
  `;
  return rows.length > 0;
}
