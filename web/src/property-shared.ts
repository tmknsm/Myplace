import { useCallback, useRef, useState } from "react";
import type { Doc } from "./api";

export const MULTILINE_FIELDS = new Set(["profile.summary", "renovations", "additions", "structures", "maintenance"]);

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
