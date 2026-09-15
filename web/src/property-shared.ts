import { useCallback, useRef, useState } from "react";
import type { Doc } from "./api";

export const MULTILINE_FIELDS = new Set([
  "profile.summary", "renovations", "additions", "structures", "maintenance",
  "original_details", "garden", "interior.palette",
]);

/** Example answers shown as placeholders so the owner knows what kind of thing goes in the box. */
export const FIELD_HINTS: Record<string, string> = {
  "style.architecture": "Greek Revival farmhouse, with an 1880s porch",
  "exterior.color": "Farrow & Ball Hague Blue, #30474f",
  "exterior.trim": "Benjamin Moore Simply White, #f4f2ea",
  "exterior.door": "Oxblood, original oak underneath",
  "exterior.siding": "Cedar clapboard, painted",
  "interior.floors": "Wide-plank pine upstairs, oak strip below",
  "interior.kitchen": "Soapstone counters, inset Shaker cabinets",
  "interior.palette": "Warm whites, one dark green room, unlacquered brass",
  "interior.hardware": "Unlacquered brass, mostly Rejuvenation",
  "original_details": "Pocket doors, tin ceiling in the parlor, the clawfoot",
  "garden": "Peonies out front, raised beds behind the barn",
  "built_by": "Local builder; the name is on the 1891 deed",
  "house.name": "The blue Victorian",
  "roof.type": "Standing-seam steel",
  "heating": "Oil boiler, hot-water baseboard",
  "cooling": "Mini-splits, 2021",
  "water_heater": "Indirect off the boiler",
  "electrical": "200 amp, updated 2016",
  "septic_or_well": "Drilled well, 1,000-gal septic",
  "windows": "Original double-hung with storms",
  "insulation": "Dense-pack cellulose in the walls",
};

/** Fields whose value may carry a paint color the page can render as a swatch. */
export const COLOR_FIELDS = new Set(["exterior.color", "exterior.trim", "exterior.door", "interior.palette"]);

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i;

/**
 * Pull a hex color out of an owner-written value like "Hague Blue, #30474f".
 * Returns the swatch and the text with the hex removed, so the page can show
 * the color instead of the code.
 */
export function splitSwatch(fieldKey: string, display: string | null): { text: string; swatch: string | null } {
  if (!display) return { text: "", swatch: null };
  if (!COLOR_FIELDS.has(fieldKey)) return { text: display, swatch: null };
  const match = display.match(HEX);
  if (!match) return { text: display, swatch: null };
  const text = display
    .replace(match[0], "")
    .replace(/\(\s*\)/g, "")
    .replace(/[\s,;:(–-]+$/, "")
    .replace(/^[\s,;:)–-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text: text || match[0], swatch: match[0] };
}

export const CATEGORY_LABEL: Record<string, string> = {
  roof: "Roof",
  hvac: "Heating & cooling",
  plumbing: "Plumbing",
  electrical: "Electrical",
  septic_well: "Septic & well",
  windows_doors: "Windows & doors",
  kitchen: "Kitchen",
  bath: "Bath",
  exterior: "Exterior & siding",
  landscaping: "Landscaping",
  structure: "Structure & foundation",
  appliance: "Appliance",
  energy: "Energy & solar",
  maintenance: "Maintenance",
  other: "Other",
};

export const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  survey: "Survey",
  permit: "Permit",
  certificate_of_occupancy: "Certificate of occupancy",
  deed: "Deed",
  plans: "Plans & drawings",
  inspection: "Inspection report",
  warranty: "Warranty",
  manual: "Manual",
  receipt: "Receipt / invoice",
  photo: "Photo",
  insurance: "Insurance",
  mortgage: "Mortgage",
  other: "Other",
};

export function money(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export function dateLabel(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", options);
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImage(doc: Doc): boolean {
  return Boolean(doc.mime_type?.startsWith("image/")) || doc.document_type === "photo";
}

export function hasFile(doc: Doc): boolean {
  return doc.has_file !== false;
}

export function fileUrl(doc: Doc): string {
  return `/api/documents/${doc.document_id}/file?v=${doc.byte_size ?? 0}`;
}

export type Toast = (message: string) => void;

export function useToast(): [string | null, Toast] {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((message: string) => {
    setToast(message);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  return [toast, show];
}

export function scrollToId(id: string, extra?: () => void) {
  const node = document.getElementById(id);
  node?.scrollIntoView({ behavior: "smooth", block: "start" });
  extra?.();
}
