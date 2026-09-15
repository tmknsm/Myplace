import { getSql } from "../db.ts";
import { id } from "../ids.ts";
import { FIELD_BY_KEY, formatFieldValue, ownerWritable } from "../vocab.ts";
import { insertAssertion } from "./assertions.ts";
import { emitEvent } from "./events.ts";
import { missingDocumentKeys } from "./storage.ts";

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
  cost_visibility: string;
  contractor: string | null;
  notes: string | null;
  visibility: string;
  transferability: string;
  created_at: string;
}

export interface RoomRow {
  room_id: string;
  property_id: string;
  created_by: string | null;
  kind: string;
  title: string | null;
  description: string | null;
  details: Record<string, string> | null;
  visibility: string;
  created_at: string;
}

export interface DocumentRow {
  document_id: string;
  property_id: string;
  improvement_id: string | null;
  room_id?: string | null;
  topic_id?: string | null;
  original_filename: string | null;
  document_type: string | null;
  mime_type: string | null;
  byte_size: number | null;
  visibility: string;
  transferability: string;
  caption: string | null;
  is_cover: boolean;
  created_at: string;
  uploaded_by: string | null;
  has_file: boolean;
}

type StoredDocumentRow = Omit<DocumentRow, "has_file"> & { storage_key: string };

async function withFileFlags(rows: StoredDocumentRow[]): Promise<DocumentRow[]> {
  const missing = await missingDocumentKeys(rows.map((row) => row.storage_key));
  return rows.map((row) => {
    const { storage_key, ...rest } = row;
    return { ...rest, has_file: !missing.has(storage_key) };
  });
}

/**
 * Improvements plus their attachments. Maintainers see everything; the public
 * sees only improvements and attachments marked public.
 */
export async function loadImprovements(propertyId: string, viewerIsMaintainer: boolean) {
  const sql = getSql();
  const improvements = await sql<ImprovementRow[]>`
    SELECT improvement_id, property_id, created_by, title, category, performed_at::text AS performed_at, cost_cents,
           cost_visibility, contractor, notes, visibility, transferability, created_at
    FROM property_improvements
    WHERE property_id = ${propertyId} AND removed_at IS NULL
      AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
    ORDER BY performed_at DESC NULLS LAST, created_at DESC
  `;
  const documents = improvements.length
    ? await withFileFlags(await sql<StoredDocumentRow[]>`
        SELECT document_id, property_id, improvement_id, original_filename, document_type, mime_type,
               byte_size, visibility, transferability, caption, is_cover, created_at, uploaded_by, storage_key
        FROM documents
        WHERE property_id = ${propertyId} AND removed_at IS NULL AND improvement_id IS NOT NULL
          AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
        ORDER BY created_at
      `)
    : [];
  const visible = viewerIsMaintainer ? documents : documents.filter((doc) => doc.has_file);
  return improvements.map((row) => {
    const showCost = viewerIsMaintainer || row.cost_visibility === "public";
    return {
      ...row,
      cost_cents: showCost && row.cost_cents !== null ? Number(row.cost_cents) : null,
      cost_visibility: row.cost_visibility === "public" ? "public" : "private",
      documents: visible.filter((doc) => doc.improvement_id === row.improvement_id),
    };
  });
}

export async function loadDocuments(propertyId: string, viewerIsMaintainer: boolean) {
  const sql = getSql();
  const documents = await withFileFlags(await sql<StoredDocumentRow[]>`
    SELECT document_id, property_id, improvement_id, room_id, topic_id, original_filename, document_type, mime_type,
           byte_size, visibility, transferability, caption, is_cover, created_at, uploaded_by, storage_key
    FROM documents
    WHERE property_id = ${propertyId} AND claim_id IS NULL AND removed_at IS NULL
      AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
    ORDER BY is_cover DESC, created_at DESC
  `);
  return viewerIsMaintainer ? documents : documents.filter((doc) => doc.has_file);
}

/**
 * Rooms plus their photos. Maintainers see everything; the public sees only
 * rooms and attachments marked public.
 */
export async function loadRooms(propertyId: string, viewerIsMaintainer: boolean) {
  const sql = getSql();
  const rooms = await sql<RoomRow[]>`
    SELECT room_id, property_id, created_by, kind, title, description, details, visibility, created_at
    FROM property_rooms
    WHERE property_id = ${propertyId} AND removed_at IS NULL
      AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
    ORDER BY created_at
  `;
  const documents = rooms.length
    ? await withFileFlags(await sql<StoredDocumentRow[]>`
        SELECT document_id, property_id, improvement_id, room_id, original_filename, document_type, mime_type,
               byte_size, visibility, transferability, caption, is_cover, created_at, uploaded_by, storage_key
        FROM documents
        WHERE property_id = ${propertyId} AND removed_at IS NULL AND room_id IS NOT NULL
          AND ${viewerIsMaintainer ? sql`TRUE` : sql`visibility = 'public'`}
        ORDER BY created_at
      `)
    : [];
  const visible = viewerIsMaintainer ? documents : documents.filter((doc) => doc.has_file);
  return rooms.map((row) => {
    const details = row.details && typeof row.details === "object" ? { ...row.details } : {};
    if (!viewerIsMaintainer && details.paid_public !== "1") {
      delete details.paid;
      delete details.paid_public;
    }
    return {
      ...row,
      details,
      documents: visible.filter((doc) => doc.room_id === row.room_id),
    };
  });
}

/** Make one photo the profile cover, or clear the cover when `documentId` is null. */
export async function setCoverPhoto(propertyId: string, documentId: string | null): Promise<void> {
  const sql = getSql();
  await sql`UPDATE documents SET is_cover = FALSE WHERE property_id = ${propertyId} AND is_cover`;
  if (documentId) {
    await sql`
      UPDATE documents SET is_cover = TRUE
      WHERE document_id = ${documentId} AND property_id = ${propertyId} AND removed_at IS NULL
    `;
  }
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

export type InboxAction = "accept" | "decline" | "withdraw" | "view";
export type InboxKind = "contribution_request" | "dispute" | "notice";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  createdAt: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  proposedValue: unknown;
  note: string | null;
  contributionId: string | null;
  actions: InboxAction[];
}

function formatProposed(fieldKey: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const field = FIELD_BY_KEY.get(fieldKey);
  if (!field) return String(value);
  return formatFieldValue(field, value) ?? String(value);
}

/**
 * Messages a maintainer may need to act on: third-party change requests they
 * can accept or decline, their own disputes waiting on the records desk, and
 * official-record notices.
 */
export async function loadInbox(propertyId: string): Promise<InboxItem[]> {
  const sql = getSql();
  const contributions = await sql<{
    contribution_id: string;
    contributor_user_id: string | null;
    contributor_type: string;
    summary: string | null;
    created_at: string;
    field_key: string;
    value_json: { value?: unknown; note?: string | null } | null;
    display_name: string | null;
    primary_email: string | null;
  }[]>`
    SELECT c.contribution_id, c.contributor_user_id, c.contributor_type, c.summary, c.created_at,
           ca.field_key, ca.value_json, u.display_name, u.primary_email
    FROM contributions c
    JOIN contribution_assertions ca ON ca.contribution_id = c.contribution_id
    LEFT JOIN users u ON u.user_id = c.contributor_user_id
    WHERE c.property_id = ${propertyId} AND c.status = 'needs_review'
    ORDER BY c.created_at DESC
  `;

  const items: InboxItem[] = contributions.map((row) => {
    const field = FIELD_BY_KEY.get(row.field_key);
    const label = field?.label ?? row.field_key;
    const proposed = row.value_json?.value ?? null;
    const note = row.value_json?.note ?? null;
    const proposedLabel = formatProposed(row.field_key, proposed);
    const who = row.display_name || row.primary_email || "Someone";
    const ownerDispute = row.contributor_type === "verified_owner";
    const parts = [
      ownerDispute
        ? `You flagged ${label.toLowerCase()} for review.`
        : `${who} proposed a change to ${label.toLowerCase()}.`,
      proposedLabel ? `Suggested value: ${proposedLabel}.` : null,
      note ? `“${note}”` : null,
    ].filter(Boolean);
    return {
      id: `con:${row.contribution_id}:${row.field_key}`,
      kind: ownerDispute ? "dispute" : "contribution_request",
      title: ownerDispute ? `Dispute of ${label}` : `Change requested: ${label}`,
      body: parts.join(" "),
      createdAt: row.created_at,
      fieldKey: row.field_key,
      fieldLabel: label,
      proposedValue: proposed,
      note,
      contributionId: row.contribution_id,
      actions: ownerDispute ? ["withdraw", "view"] : ["accept", "decline", "view"],
    };
  });

  const notices = await sql<{ event_id: string; event_type: string; created_at: string }[]>`
    SELECT event_id, event_type, created_at
    FROM property_events
    WHERE property_id = ${propertyId}
      AND event_type IN ('assessment.updated', 'sale.recorded', 'parcel.geometry_updated')
    ORDER BY created_at DESC
    LIMIT 12
  `;
  const noticeTitle: Record<string, string> = {
    "assessment.updated": "Assessment updated",
    "sale.recorded": "Sale recorded",
    "parcel.geometry_updated": "Lot lines refreshed",
  };
  const noticeBody: Record<string, string> = {
    "assessment.updated": "An official source updated the assessment on this record.",
    "sale.recorded": "A recorded sale was added to this property.",
    "parcel.geometry_updated": "The parcel geometry was refreshed from a source.",
  };
  for (const row of notices) {
    items.push({
      id: `evt:${row.event_id}`,
      kind: "notice",
      title: noticeTitle[row.event_type] ?? row.event_type,
      body: noticeBody[row.event_type] ?? "Something changed on this record.",
      createdAt: row.created_at,
      fieldKey: null,
      fieldLabel: null,
      proposedValue: null,
      note: null,
      contributionId: null,
      actions: ["view"],
    });
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return items;
}

export async function reviewContribution(input: {
  contributionId: string;
  reviewerId: string;
  decision: "accepted" | "rejected";
}): Promise<{ propertyId: string }> {
  const sql = getSql();
  const rows = await sql<{
    contribution_id: string;
    property_id: string;
    contributor_type: string;
    status: string;
  }[]>`
    SELECT contribution_id, property_id, contributor_type, status
    FROM contributions WHERE contribution_id = ${input.contributionId}
  `;
  const contribution = rows[0];
  if (!contribution) throw Object.assign(new Error("Not found"), { status: 404 });
  if (contribution.status !== "needs_review") {
    throw Object.assign(new Error("This request is already resolved."), { status: 400 });
  }
  if (contribution.contributor_type === "verified_owner") {
    throw Object.assign(new Error("Owner disputes are reviewed by the records desk. You can withdraw yours instead."), { status: 400 });
  }

  if (input.decision === "accepted") {
    const assertions = await sql<{ field_key: string; value_json: { value?: unknown } | null }[]>`
      SELECT field_key, value_json FROM contribution_assertions WHERE contribution_id = ${contribution.contribution_id}
    `;
    for (const assertion of assertions) {
      const field = FIELD_BY_KEY.get(assertion.field_key);
      if (!ownerWritable(field)) continue;
      const value = assertion.value_json?.value;
      if (value === null || value === undefined || value === "") continue;
      await insertAssertion({
        propertyId: contribution.property_id,
        fieldKey: assertion.field_key,
        value,
        sourceType: "verified_owner",
        actorType: "verified_owner",
        actorId: input.reviewerId,
        eventType: "owner_assertion.added",
      });
    }
  }

  await sql`
    UPDATE contributions
    SET status = ${input.decision}, resolved_at = now(), resolved_by = ${input.reviewerId}
    WHERE contribution_id = ${contribution.contribution_id}
  `;
  await emitEvent({
    propertyId: contribution.property_id,
    eventType: input.decision === "accepted" ? "contribution.accepted" : "contribution.rejected",
    actorType: "verified_owner",
    actorId: input.reviewerId,
    payload: { contribution_id: contribution.contribution_id, decision: input.decision },
  });
  return { propertyId: contribution.property_id };
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
