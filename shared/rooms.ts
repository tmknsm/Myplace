export type RoomFieldKind = "text" | "multiline" | "year" | "link" | "hex";

export interface RoomKind {
  id: string;
  label: string;
}

export interface RoomField {
  key: string;
  label: string;
  kind?: RoomFieldKind;
  hint?: string;
  half?: boolean;
}

export const ROOM_KINDS: RoomKind[] = [
  { id: "kitchen", label: "Kitchen" },
  { id: "pantry", label: "Pantry" },
  { id: "dining_room", label: "Dining room" },
  { id: "living_room", label: "Living room" },
  { id: "family_room", label: "Family room" },
  { id: "primary_bedroom", label: "Primary bedroom" },
  { id: "guest_bedroom", label: "Guest bedroom" },
  { id: "nursery", label: "Nursery" },
  { id: "office", label: "Office / study" },
  { id: "primary_bathroom", label: "Primary bathroom" },
  { id: "guest_bathroom", label: "Guest bathroom" },
  { id: "powder_room", label: "Powder room" },
  { id: "laundry", label: "Laundry" },
  { id: "mudroom", label: "Mudroom" },
  { id: "hallway", label: "Hallway" },
  { id: "basement", label: "Basement" },
  { id: "attic", label: "Attic" },
  { id: "other", label: "Other room" },
];

export const ROOM_KIND_IDS = ROOM_KINDS.map((kind) => kind.id);
export const ROOM_KIND_LABEL: Record<string, string> = Object.fromEntries(ROOM_KINDS.map((kind) => [kind.id, kind.label]));

const paint: RoomField = { key: "paint", label: "Paint", hint: "Farrow & Ball Shaded White", half: true };
const swatch: RoomField = { key: "paint_hex", label: "Swatch", kind: "hex", hint: "#e7e0d0", half: true };
const flooring: RoomField = { key: "flooring", label: "Flooring", hint: "Wide-plank oak" };
const lighting: RoomField = { key: "lighting", label: "Lighting", hint: "Schoolhouse pendants" };
const fixtures: RoomField = { key: "fixtures", label: "Fixtures & hardware", hint: "Unlacquered brass" };
const year: RoomField = { key: "year", label: "Last updated", kind: "year", hint: "2019", half: true };
const link: RoomField = { key: "link", label: "Link", kind: "link", hint: "The designer, the tile, the source list", half: true };
const notes: RoomField = { key: "notes", label: "Notes", kind: "multiline", hint: "What a new owner should know" };

const COMMON_FINISH: RoomField[] = [flooring, paint, swatch, lighting, fixtures];
const COMMON_META: RoomField[] = [year, link, notes];

const EXTRA: Record<string, RoomField[]> = {
  kitchen: [
    { key: "cabinetry", label: "Cabinetry", hint: "Hudson Valley Cabinetry, inset Shaker, Hague Blue" },
    { key: "counters", label: "Counters", hint: "Honed Vermont soapstone" },
    { key: "backsplash", label: "Backsplash", hint: "Zellige, glazed white" },
    { key: "appliances", label: "Appliances", hint: "Induction range, drawer dishwasher" },
    { key: "sink", label: "Sink & faucet", hint: "White farmhouse sink, unlacquered brass" },
    { key: "island", label: "Island", hint: "Walnut top, seating for three" },
  ],
  pantry: [
    { key: "storage", label: "Storage", hint: "Open shelves, one cold closet" },
    { key: "counters", label: "Counters", hint: "Butcher block" },
  ],
  dining_room: [
    { key: "built_ins", label: "Built-ins", hint: "China closet, original" },
    { key: "fireplace", label: "Fireplace", hint: "Marble surround, working" },
  ],
  living_room: [
    { key: "fireplace", label: "Fireplace", hint: "Brick, wood-burning" },
    { key: "built_ins", label: "Built-ins", hint: "Bookcases either side of the chimney" },
    { key: "windows", label: "Windows", hint: "South bay, original sash" },
  ],
  family_room: [
    { key: "fireplace", label: "Fireplace", hint: "Wood stove insert" },
    { key: "built_ins", label: "Built-ins", hint: "TV cabinet, toy drawers" },
  ],
  primary_bedroom: [
    { key: "closet", label: "Closet", hint: "Walk-in, cedar-lined" },
    { key: "windows", label: "Windows", hint: "East light, linen shades" },
  ],
  guest_bedroom: [
    { key: "closet", label: "Closet", hint: "Reach-in, original hardware" },
    { key: "windows", label: "Windows", hint: "North, blackout shade" },
  ],
  nursery: [
    { key: "closet", label: "Closet", hint: "Reach-in, extra shelves" },
    { key: "windows", label: "Windows", hint: "West, blackout and a sheer" },
  ],
  office: [
    { key: "built_ins", label: "Built-ins", hint: "Desk nook, filing drawers" },
    { key: "windows", label: "Windows", hint: "Garden view" },
  ],
  primary_bathroom: [
    { key: "tub_shower", label: "Tub / shower", hint: "Cast-iron tub, separate walk-in" },
    { key: "vanity", label: "Vanity", hint: "Double walnut, marble top" },
    { key: "tile", label: "Tile", hint: "Hex mosaic floor, subway walls" },
    { key: "toilet", label: "Toilet", hint: "Wall-hung, 2021" },
  ],
  guest_bathroom: [
    { key: "tub_shower", label: "Tub / shower", hint: "Tub/shower combo" },
    { key: "vanity", label: "Vanity", hint: "Single, painted pine" },
    { key: "tile", label: "Tile", hint: "Penny tile floor" },
    { key: "toilet", label: "Toilet", hint: "Standard, 2018" },
  ],
  powder_room: [
    { key: "vanity", label: "Sink / vanity", hint: "Pedestal sink" },
    { key: "tile", label: "Tile", hint: "Checkerboard marble" },
    { key: "toilet", label: "Toilet", hint: "Compact, 2020" },
  ],
  laundry: [
    { key: "machines", label: "Machines", hint: "Front-load, stacked" },
    { key: "sink", label: "Sink", hint: "Utility sink" },
    { key: "storage", label: "Storage", hint: "Open shelves, hanging rod" },
  ],
  mudroom: [
    { key: "storage", label: "Storage", hint: "Cubbies, boot tray, hooks" },
    { key: "sink", label: "Sink", hint: "None; hose bib outside" },
  ],
  hallway: [
    { key: "built_ins", label: "Built-ins", hint: "Linen closet" },
  ],
  basement: [
    { key: "finish", label: "Finish", hint: "Partly finished, one guest room" },
    { key: "storage", label: "Storage", hint: "Bulkhead, cedar closet" },
  ],
  attic: [
    { key: "finish", label: "Finish", hint: "Unfinished, floored for storage" },
    { key: "storage", label: "Storage", hint: "Knee walls, pull-down stair" },
  ],
  other: [
    { key: "used_as", label: "Used as", hint: "Music room, gym, sewing" },
  ],
};

export function isRoomKind(value: string): boolean {
  return ROOM_KIND_IDS.includes(value);
}

export function fieldsForRoom(kind: string): RoomField[] {
  return [...(EXTRA[kind] ?? EXTRA.other ?? []), ...COMMON_FINISH, ...COMMON_META];
}

const HEX_ONLY = /^#?(?:[0-9a-f]{6}|[0-9a-f]{3})$/i;

/** "#30474f", "30474f", or "#abc" → "#30474f"; anything else → null. */
export function normalizeRoomHex(raw: string): string | null {
  const text = raw.trim();
  if (!HEX_ONLY.test(text)) return null;
  return (text.startsWith("#") ? text : `#${text}`).toLowerCase();
}

/** Accept "hudsonpaint.com" as well as a full URL; only http(s) survives. */
export function normalizeRoomLink(raw: string): string | null {
  const text = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeRoomYear(raw: string): string | null {
  const text = raw.trim();
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  if (year < 1600 || year > new Date().getFullYear() + 1) return null;
  return text;
}

export class RoomDetailsError extends Error {
  status = 400;
}

/** Optional card blurb. Empty → null; over 2,000 characters → 400. */
export function normalizeRoomDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (!text) return null;
  if (text.length > 2000) throw new RoomDetailsError("Description is too long.");
  return text;
}

/**
 * Keep only known keys for this room type, drop empties, and check the typed
 * fields. Throws a 400-flavoured error when a link, swatch, or year is malformed.
 */
export function normalizeRoomDetails(kind: string, raw: unknown): Record<string, string> {
  const fields = new Map(fieldsForRoom(kind).map((field) => [field.key, field]));
  const details: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return details;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = fields.get(key);
    if (!field) continue;
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    if (!text) continue;
    if (text.length > 2000) throw new RoomDetailsError(`${field.label} is too long.`);
    if (field.kind === "link") {
      const url = normalizeRoomLink(text);
      if (!url) throw new RoomDetailsError(`${field.label} needs to be a web address.`);
      details[key] = url;
    } else if (field.kind === "hex") {
      const hex = normalizeRoomHex(text);
      if (!hex) throw new RoomDetailsError(`${field.label} should be a hex color, like #30474f.`);
      details[key] = hex;
    } else if (field.kind === "year") {
      const year = normalizeRoomYear(text);
      if (!year) throw new RoomDetailsError(`${field.label} should be a four-digit year.`);
      details[key] = year;
    } else {
      details[key] = text;
    }
  }
  return details;
}
