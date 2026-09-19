/** Stock faces for accounts that have not set a photo. First is the original default. */
export const DEFAULT_AVATAR_URLS = [
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=128&h=128&q=80",
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=128&h=128&q=80",
] as const;

/** Default face for an account that has not set a photo. Joseph Gonzalez / Unsplash. */
export const DEFAULT_AVATAR_URL = DEFAULT_AVATAR_URLS[0];

/** Faceless preset offered under Change photo. Paint pour / Unsplash. */
export const ABSTRACT_AVATAR_URL =
  "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=128&h=128&q=80";

export const AVATAR_PRESETS = {
  default: DEFAULT_AVATAR_URL,
  abstract: ABSTRACT_AVATAR_URL,
} as const;

function hashUserId(userId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable stock face for an account. Different people land on different photos. */
export function defaultAvatarFor(userId?: string | null): string {
  if (!userId) return DEFAULT_AVATAR_URL;
  return DEFAULT_AVATAR_URLS[hashUserId(userId) % DEFAULT_AVATAR_URLS.length]!;
}

export type AvatarPreset = keyof typeof AVATAR_PRESETS;

export function isAvatarPreset(value: unknown): value is AvatarPreset {
  return typeof value === "string" && value in AVATAR_PRESETS;
}

export const HANDLE_MIN = 2;
export const HANDLE_MAX = 24;
const HANDLE_RE = /^[a-z][a-z0-9_]{1,23}$/;

export function normalizeHandle(raw: string | undefined | null): string | null {
  const next = (raw ?? "").trim().replace(/^@+/, "").toLowerCase();
  return next || null;
}

export function parseHandle(raw: string | undefined | null): { handle: string } | { error: string } {
  const handle = normalizeHandle(raw);
  if (!handle) return { error: "Choose a handle." };
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX || !HANDLE_RE.test(handle)) {
    return { error: "Handles start with a letter and can use letters, numbers, and underscores." };
  }
  return { handle };
}

export function formatHandle(handle: string | null | undefined): string | null {
  return handle ? `@${handle}` : null;
}

const STREET_WORD = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|place|pl|way|route|hwy|highway|court|ct)\b/i;

function looksLikeAddress(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/^\d/.test(text)) return true;
  if (/,/.test(text) && STREET_WORD.test(text)) return true;
  return STREET_WORD.test(text) && /\d/.test(text);
}

function personName(input: {
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}): string | null {
  const fromParts = [input.first_name, input.last_name].filter(Boolean).join(" ").trim();
  const candidate = fromParts || (input.display_name ?? "").trim();
  if (!candidate || looksLikeAddress(candidate)) return null;
  return candidate;
}

export function ownerLabel(input: {
  anonymize: boolean;
  handle: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}): string {
  if (input.anonymize) return input.handle ? `@${input.handle}` : "Owner";
  const name = personName(input);
  if (name) return name;
  if (input.handle) return `@${input.handle}`;
  return "Owner";
}

/**
 * Address on the property page. When the street is hidden, drop everything
 * before the first comma so "51 State Route 9H, Claverack, NY" becomes
 * "Claverack, NY" — including on the owner's own view.
 */
export function publicAddress(input: {
  formatted: string | null;
  municipality: string | null;
  county: string;
  state?: string | null;
  hideStreet: boolean;
}): string | null {
  if (!input.hideStreet) return input.formatted;
  if (input.formatted) {
    const comma = input.formatted.indexOf(",");
    if (comma >= 0) return input.formatted.slice(comma + 1).trim() || null;
  }
  const bits = [input.municipality, input.state].filter(Boolean);
  return bits.length ? bits.join(", ") : input.county || null;
}

/** Heading and locality line for the property page. Same for owner and visitor so a hidden street stays hidden. */
export function propertyHeading(
  property: { formatted: string | null; municipality: string | null; hide_street?: boolean },
): { title: string; locality: string | null } {
  if (property.hide_street) {
    return { title: property.municipality || "Home", locality: null };
  }
  const formatted = property.formatted;
  return {
    title: formatted?.split(",")[0] ?? "Untitled parcel",
    locality: formatted?.includes(",") ? formatted.slice(formatted.indexOf(",") + 1).trim() : null,
  };
}

/**
 * True when the account has a photo stored. New real accounts start with
 * `avatar_url` null (gray empty). Demo neighbors are seeded with a face, and
 * that counts — it is their photo for the purpose of the page, even if the
 * file is an Unsplash stand-in.
 */
export function hasOwnPhoto(input: { avatar_url: string | null | undefined }): boolean {
  return Boolean(input.avatar_url);
}

/** The stored photo, or null. Never invents a stock face for an empty account. */
export function ownerPhoto(input: { avatar_url: string | null; user_id?: string | null }): string | null {
  return input.avatar_url || null;
}
