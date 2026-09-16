/** Default face for an account that has not set a photo. Joseph Gonzalez / Unsplash. */
export const DEFAULT_AVATAR_URL =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=128&h=128&q=80";

/** Faceless preset offered under Change photo. Paint pour / Unsplash. */
export const ABSTRACT_AVATAR_URL =
  "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=128&h=128&q=80";

export const AVATAR_PRESETS = {
  default: DEFAULT_AVATAR_URL,
  abstract: ABSTRACT_AVATAR_URL,
} as const;

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

export function ownerLabel(input: {
  anonymize: boolean;
  handle: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}): string {
  if (input.anonymize && input.handle) return `@${input.handle}`;
  const name = [input.first_name, input.last_name].filter(Boolean).join(" ") || input.display_name;
  if (name) return name;
  if (input.handle) return `@${input.handle}`;
  return "Owner";
}

/** The one photo on the account. Anonymize does not change it. */
export function ownerPhoto(input: { avatar_url: string | null }): string {
  return input.avatar_url || DEFAULT_AVATAR_URL;
}
