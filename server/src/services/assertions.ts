import { FIELD_BY_KEY, FIELD_VOCAB, formatFieldValue, type FieldDef } from "../vocab.ts";
import { getSql } from "../db.ts";
import { id } from "../ids.ts";
import { emitEvent } from "./events.ts";

export type FactStatus = "available" | "unknown" | "conflicting" | "inferred" | "owner_reported";

export interface AssertionRow {
  assertion_id: string;
  property_id: string;
  field_key: string;
  value_json: unknown;
  source_id: string | null;
  source_type: string;
  effective_at: Date | string | null;
  observed_at: Date | string | null;
  confidence: string | number | null;
  status: string;
  created_at: Date | string;
  visibility?: string | null;
  source_name?: string | null;
  source_authority?: string | null;
}

export type AssertionVisibility = "public" | "private";

export interface FactView {
  fieldKey: string;
  label: string;
  group: FieldDef["group"];
  layer: FieldDef["layer"];
  status: FactStatus;
  value: unknown;
  display: string | null;
  /** Visibility of the owner's current value for this field; null when the owner has not written one. */
  visibility: AssertionVisibility | null;
  assertions: Array<{
    assertionId: string;
    value: unknown;
    display: string | null;
    sourceId: string | null;
    sourceType: string;
    sourceName: string | null;
    effectiveAt: string | null;
    confidence: number | null;
  }>;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(unwrap(a)) === JSON.stringify(unwrap(b));
}

export function assembleFacts(rows: AssertionRow[]): FactView[] {
  const byField = new Map<string, AssertionRow[]>();
  for (const row of rows) {
    if (row.status !== "accepted") continue;
    const list = byField.get(row.field_key) ?? [];
    list.push(row);
    byField.set(row.field_key, list);
  }

  return FIELD_VOCAB.map((field) => {
    const accepted = byField.get(field.key) ?? [];
    const official = accepted.filter((row) => row.source_type === "government" || row.source_type === "platform_admin");
    const inferred = accepted.filter((row) => row.source_type === "platform_inference");
    const owner = accepted.filter((row) => row.source_type === "verified_owner");
    const primaryPool = field.layer === "owner"
      ? owner
      : official.length
        ? official
        : inferred.length
          ? inferred
          : owner;

    let status: FactStatus = "unknown";
    let chosen: AssertionRow | undefined;

    if (primaryPool.length === 0) {
      status = "unknown";
    } else if (field.layer !== "owner" && official.length === 0 && inferred.length > 0) {
      status = "inferred";
      chosen = inferred[0];
    } else if (field.layer !== "owner" && official.length === 0 && owner.length > 0) {
      status = "owner_reported";
      chosen = owner[0];
    } else {
      const distinct = primaryPool.filter((row, index, all) =>
        all.findIndex((other) => valuesEqual(other.value_json, row.value_json)) === index,
      );
      if (distinct.length > 1) {
        status = "conflicting";
        chosen = official[0] ?? primaryPool[0];
      } else {
        status = "available";
        chosen = primaryPool[0];
      }
    }

    const value = chosen ? unwrap(chosen.value_json) : null;
    const ownerCurrent = owner[0];
    return {
      fieldKey: field.key,
      label: field.label,
      group: field.group,
      layer: field.layer,
      status,
      value,
      display: chosen ? formatFieldValue(field, value) : null,
      visibility: ownerCurrent ? (ownerCurrent.visibility === "private" ? "private" : "public") : null,
      assertions: accepted.map((row) => {
        const raw = unwrap(row.value_json);
        return {
          assertionId: row.assertion_id,
          value: raw,
          display: formatFieldValue(field, raw),
          sourceId: row.source_id,
          sourceType: row.source_type,
          sourceName: row.source_name ?? row.source_authority ?? row.source_type,
          effectiveAt: asIso(row.effective_at),
          confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
        };
      }),
    };
  });
}

/**
 * Every assertion on a property. Owner contributions marked private are left
 * out unless the viewer is a maintainer, so the public profile never sees them.
 */
export async function loadAssertionRows(propertyId: string, options: { includePrivate?: boolean } = {}): Promise<AssertionRow[]> {
  const sql = getSql();
  const includePrivate = options.includePrivate ?? true;
  return sql<AssertionRow[]>`
    SELECT
      a.assertion_id, a.property_id, a.field_key, a.value_json, a.source_id, a.source_type,
      a.effective_at, a.observed_at, a.confidence, a.status, a.created_at, a.visibility,
      s.name AS source_name, s.authority AS source_authority
    FROM assertions a
    LEFT JOIN sources s ON s.source_id = a.source_id
    WHERE a.property_id = ${propertyId}
      AND ${includePrivate ? sql`TRUE` : sql`(a.visibility = 'public' OR a.source_type <> 'verified_owner')`}
    ORDER BY a.effective_at DESC NULLS LAST, a.created_at DESC
  `;
}

/** Visibility of the owner's current value for a field, or null when there is none. */
export async function ownerAssertionVisibility(propertyId: string, fieldKey: string): Promise<AssertionVisibility | null> {
  const sql = getSql();
  const rows = await sql<{ visibility: string }[]>`
    SELECT visibility FROM assertions
    WHERE property_id = ${propertyId} AND field_key = ${fieldKey}
      AND source_type = 'verified_owner' AND status = 'accepted'
    ORDER BY created_at DESC LIMIT 1
  `;
  const value = rows[0]?.visibility;
  return value === "private" || value === "public" ? value : null;
}

/** Show or hide the owner's current value for a field on the public profile. */
export async function setOwnerAssertionVisibility(input: {
  propertyId: string;
  fieldKey: string;
  visibility: AssertionVisibility;
  actorId: string | null;
}): Promise<number> {
  if (!FIELD_BY_KEY.has(input.fieldKey)) throw new Error(`Unknown field ${input.fieldKey}`);
  const sql = getSql();
  const rows = await sql<{ assertion_id: string }[]>`
    UPDATE assertions
    SET visibility = ${input.visibility}
    WHERE property_id = ${input.propertyId} AND field_key = ${input.fieldKey}
      AND source_type = 'verified_owner' AND status = 'accepted' AND visibility <> ${input.visibility}
    RETURNING assertion_id
  `;
  if (rows.length) {
    await emitEvent({
      propertyId: input.propertyId,
      eventType: "owner_assertion.visibility_changed",
      actorType: "verified_owner",
      actorId: input.actorId,
      payload: { field_key: input.fieldKey, visibility: input.visibility },
    });
  }
  return rows.length;
}

/** Withdraw the owner's current value for a field without touching any other layer. */
export async function retractOwnerAssertion(propertyId: string, fieldKey: string, actorId: string | null): Promise<number> {
  if (!FIELD_BY_KEY.has(fieldKey)) throw new Error(`Unknown field ${fieldKey}`);
  const sql = getSql();
  const rows = await sql<{ assertion_id: string }[]>`
    UPDATE assertions
    SET status = 'retracted'
    WHERE property_id = ${propertyId} AND field_key = ${fieldKey}
      AND source_type = 'verified_owner' AND status = 'accepted'
    RETURNING assertion_id
  `;
  if (rows.length) {
    await emitEvent({
      propertyId,
      eventType: "owner_assertion.removed",
      actorType: "verified_owner",
      actorId,
      payload: { field_key: fieldKey, assertion_ids: rows.map((row) => row.assertion_id) },
    });
  }
  return rows.length;
}

export async function insertAssertion(input: {
  propertyId: string;
  fieldKey: string;
  value: unknown;
  sourceId?: string | null;
  sourceType: string;
  status?: string;
  effectiveAt?: Date | string | null;
  confidence?: number | null;
  visibility?: AssertionVisibility | null;
  actorType?: string;
  actorId?: string | null;
  eventType?: string;
}): Promise<string> {
  if (!FIELD_BY_KEY.has(input.fieldKey)) {
    throw new Error(`Unknown field ${input.fieldKey}`);
  }
  const sql = getSql();
  const assertionId = id("ast");
  await sql`
    UPDATE assertions
    SET status = 'superseded', superseded_by = ${assertionId}
    WHERE property_id = ${input.propertyId}
      AND field_key = ${input.fieldKey}
      AND source_type = ${input.sourceType}
      AND status = 'accepted'
  `;
  await sql`
    INSERT INTO assertions (
      assertion_id, property_id, field_key, value_json, source_id, source_type,
      effective_at, observed_at, confidence, status, visibility
    ) VALUES (
      ${assertionId}, ${input.propertyId}, ${input.fieldKey}, ${sql.json({ value: input.value } as never)},
      ${input.sourceId ?? null}, ${input.sourceType}, ${input.effectiveAt ?? new Date()},
      ${new Date()}, ${input.confidence ?? 1}, ${input.status ?? "accepted"}, ${input.visibility ?? "public"}
    )
  `;
  await emitEvent({
    propertyId: input.propertyId,
    eventType: input.eventType ?? (input.sourceType === "verified_owner" ? "owner_assertion.added" : "assertion.updated"),
    actorType: input.actorType ?? input.sourceType,
    actorId: input.actorId ?? null,
    sourceId: input.sourceId ?? null,
    payload: { field_key: input.fieldKey, assertion_id: assertionId },
    effectiveAt: input.effectiveAt ?? new Date(),
  });
  return assertionId;
}
