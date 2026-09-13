import { getSql } from "../db.ts";
import { id } from "../ids.ts";
import { FIELD_BY_KEY } from "../vocab.ts";
import { emitEvent } from "./events.ts";

export const IMPROVEMENT_CATEGORIES = [
  "roof",
  "hvac",
  "plumbing",
  "electrical",
  "septic_well",
  "windows_doors",
  "kitchen",
  "bath",
  "exterior",
  "landscaping",
  "structure",
  "appliance",
  "energy",
  "maintenance",
  "other",
] as const;

export type ImprovementCategory = (typeof IMPROVEMENT_CATEGORIES)[number];

export const DOCUMENT_TYPES = [
  "survey",
  "permit",
  "certificate_of_occupancy",
  "deed",
  "plans",
  "inspection",
  "warranty",
  "manual",
  "receipt",
  "photo",
  "insurance",
  "mortgage",
  "other",
] as const;

/** Document types the next owner normally inherits; everything else defaults to personal. */
export const TRANSFERABLE_TYPES = new Set<string>([
  "survey", "permit", "certificate_of_occupancy", "plans", "inspection", "warranty", "manual", "receipt", "photo",
]);

export interface ImprovementRow {
  improvement_id: string;
  property_id: string;
  created_by: string | null;
  title: string;
  category: string;
  performed_at: string | null;
  cost_cents: string | number | null;
  contractor: string | null;
  notes: string | null;
  visibility: string;
  transferability: string;
  created_at: string;
}

export interface DocumentRow {
  document_id: string;
  property_id: string;
  improvement_id: string | null;
  original_filename: string | null;
  document_type: string | null;
  mime_type: string | null;
  byte_size: number | null;
  visibility: string;
  transferability: string;
  caption: string | null;
  created_at: string;
  uploaded_by: string | null;
}

/**
 * Improvements plus their attachments. Maintainers see everything; the public
 * sees only improvements and attachments marked public.
 */
export async function loadImprovements(propertyId: string, viewerIsMaintainer: boolean) {
  const sql = getSql();
  const improvements = await sql<ImprovementRow[]>`
    SELECT improvement_id, property_id, created_by, title, category, performed_at, cost_cents,
           contractor, notes, visibility, transferability, created_at
    FROM property_improvements
    WHERE property_id = ${propertyId} AND removed_at IS NULL
      AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
    ORDER BY performed_at DESC NULLS LAST, created_at DESC
  `;
  const documents = improvements.length
    ? await sql<DocumentRow[]>`
        SELECT document_id, property_id, improvement_id, original_filename, document_type, mime_type,
               byte_size, visibility, transferability, caption, created_at, uploaded_by
        FROM documents
        WHERE property_id = ${propertyId} AND removed_at IS NULL AND improvement_id IS NOT NULL
          AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
        ORDER BY created_at
      `
    : [];
  return improvements.map((row) => ({
    ...row,
    cost_cents: row.cost_cents === null ? null : Number(row.cost_cents),
    documents: documents.filter((doc) => doc.improvement_id === row.improvement_id),
  }));
}

export async function loadDocuments(propertyId: string, viewerIsMaintainer: boolean) {
  const sql = getSql();
  return sql<DocumentRow[]>`
    SELECT document_id, property_id, improvement_id, original_filename, document_type, mime_type,
           byte_size, visibility, transferability, caption, created_at, uploaded_by
    FROM documents
    WHERE property_id = ${propertyId} AND claim_id IS NULL AND removed_at IS NULL
      AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
    ORDER BY created_at DESC
  `;
}

export interface DisputeView {
  contributionId: string;
  fieldKey: string;
  label: string;
  proposedValue: unknown;
  note: string | null;
  createdAt: string;
  contributorUserId: string | null;
}

/** Owner disputes that are still waiting on review. */
export async function loadOpenDisputes(propertyId: string): Promise<DisputeView[]> {
  const sql = getSql();
  const rows = await sql<{
    contribution_id: string;
    contributor_user_id: string | null;
    created_at: string;
    field_key: string;
    value_json: { value?: unknown; note?: string | null } | null;
  }[]>`
    SELECT c.contribution_id, c.contributor_user_id, c.created_at, ca.field_key, ca.value_json
    FROM contributions c
    JOIN contribution_assertions ca ON ca.contribution_id = c.contribution_id
    WHERE c.property_id = ${propertyId} AND c.status = 'needs_review'
    ORDER BY c.created_at DESC
  `;
  return rows.map((row) => ({
    contributionId: row.contribution_id,
    fieldKey: row.field_key,
    label: FIELD_BY_KEY.get(row.field_key)?.label ?? row.field_key,
    proposedValue: row.value_json?.value ?? null,
    note: row.value_json?.note ?? null,
    createdAt: row.created_at,
    contributorUserId: row.contributor_user_id,
  }));
}

export async function openDispute(input: {
  propertyId: string;
  userId: string;
  fieldKey: string;
  proposedValue: unknown;
  note: string | null;
}): Promise<string> {
  const field = FIELD_BY_KEY.get(input.fieldKey);
  if (!field) throw Object.assign(new Error("Unknown field"), { status: 400 });
  const sql = getSql();
  await sql`
    UPDATE contributions SET status = 'superseded'
    WHERE contribution_id IN (
      SELECT c.contribution_id FROM contributions c
      JOIN contribution_assertions ca ON ca.contribution_id = c.contribution_id
      WHERE c.property_id = ${input.propertyId} AND c.status = 'needs_review'
        AND c.contributor_user_id = ${input.userId} AND ca.field_key = ${input.fieldKey}
    )
  `;
  const contributionId = id("con");
  await sql`
    INSERT INTO contributions (contribution_id, property_id, contributor_user_id, contributor_type, status, summary)
    VALUES (${contributionId}, ${input.propertyId}, ${input.userId}, 'verified_owner', 'needs_review',
            ${`Owner disputes ${field.label}`})
  `;
  await sql`
    INSERT INTO contribution_assertions (contribution_assertion_id, contribution_id, field_key, value_json)
    VALUES (${id("cas")}, ${contributionId}, ${input.fieldKey},
            ${sql.json({ value: input.proposedValue ?? null, note: input.note } as never)})
  `;
  await emitEvent({
    propertyId: input.propertyId,
    eventType: "assertion.disputed",
    actorType: "verified_owner",
    actorId: input.userId,
    payload: { contribution_id: contributionId, field_key: input.fieldKey },
  });
  return contributionId;
}

export const PREFERENCE_DEFAULTS: Record<string, string> = {
  contribution_requests: "immediate",
  ownership_security: "immediate",
  official_changes: "immediate",
  property_digest: "monthly",
};

export const PREFERENCE_OPTIONS: Record<string, string[]> = {
  contribution_requests: ["immediate", "daily", "off"],
  ownership_security: ["immediate"],
  official_changes: ["immediate", "weekly", "off"],
  property_digest: ["monthly", "off"],
};

export async function loadPreferences(userId: string, propertyId: string): Promise<Record<string, string>> {
  const sql = getSql();
  const rows = await sql<{ pref_key: string; value: string }[]>`
    SELECT pref_key, value FROM notification_preferences
    WHERE user_id = ${userId} AND property_id = ${propertyId}
  `;
  const merged = { ...PREFERENCE_DEFAULTS };
  for (const row of rows) merged[row.pref_key] = row.value;
  return merged;
}

export async function savePreferences(userId: string, propertyId: string, prefs: Record<string, unknown>): Promise<Record<string, string>> {
  const sql = getSql();
  for (const [key, value] of Object.entries(prefs)) {
    const allowed = PREFERENCE_OPTIONS[key];
    if (!allowed || typeof value !== "string" || !allowed.includes(value)) continue;
    await sql`
      INSERT INTO notification_preferences (preference_id, user_id, property_id, pref_key, value)
      VALUES (${id("prf")}, ${userId}, ${propertyId}, ${key}, ${value})
      ON CONFLICT (user_id, property_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  }
  return loadPreferences(userId, propertyId);
}

export async function loadPendingInvitations(propertyId: string) {
  const sql = getSql();
  return sql<{ invitation_id: string; invited_email: string; role: string; created_at: string; invited_by: string }[]>`
    SELECT invitation_id, invited_email, role, created_at, invited_by
    FROM handoff_invitations
    WHERE property_id = ${propertyId} AND status = 'sent'
    ORDER BY created_at DESC
  `;
}

export async function pendingInvitationFor(propertyId: string, email: string) {
  const sql = getSql();
  const rows = await sql<{ invitation_id: string; role: string; invited_by_name: string | null }[]>`
    SELECT i.invitation_id, i.role, COALESCE(u.display_name, u.primary_email) AS invited_by_name
    FROM handoff_invitations i
    JOIN users u ON u.user_id = i.invited_by
    WHERE i.property_id = ${propertyId} AND i.status = 'sent' AND i.invited_email = ${email}
    ORDER BY i.created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export function parseCostCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/[$,\s]/g, "");
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
