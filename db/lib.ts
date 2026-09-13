import { createHash } from "node:crypto";
import postgres from "postgres";
import { FIELD_VOCAB } from "../server/src/vocab.ts";

export type Sql = postgres.Sql;

const secret = process.env.SESSION_SECRET ?? "dev-insecure-change-me";

export function connect(): Sql {
  const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace";
  return postgres(url, { max: 4 });
}

/** Deterministic id: the same parcel key always maps to the same property id. */
export function id(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 26)}`;
}

export function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${secret}:${email}:${code}`).digest("hex");
}

export function num(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function chunk<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const SUFFIX: Record<string, string> = {
  st: "Street",
  ave: "Avenue",
  av: "Avenue",
  rd: "Road",
  ln: "Lane",
  dr: "Drive",
  pl: "Place",
  ct: "Court",
  blvd: "Boulevard",
  hwy: "Highway",
  pkwy: "Parkway",
  cir: "Circle",
  ter: "Terrace",
  trl: "Trail",
  expy: "Expressway",
  sq: "Square",
  tpke: "Turnpike",
  ext: "Extension",
  pt: "Point",
  hts: "Heights",
};

export function expandSuffix(suffix: unknown): string {
  const raw = clean(suffix);
  if (!raw) return "";
  return SUFFIX[raw.replace(/\./g, "").toLowerCase()] ?? raw;
}

/** Expand a trailing abbreviation in a street name like "Main St" or "Spring St Ext". */
export function expandStreet(street: string): string {
  return street
    .split(" ")
    .map((word, index, words) => (index >= words.length - 2 ? expandSuffix(word) || word : word))
    .join(" ");
}

export interface SourceDef {
  id: string;
  name: string;
  authority: string;
  type: string;
  jurisdiction: string;
  license: string;
  coverage: string;
  url?: string;
}

export async function upsertSources(sql: Sql, sources: SourceDef[]): Promise<void> {
  for (const source of sources) {
    await sql`
      INSERT INTO sources (
        source_id, name, authority, source_type, jurisdiction, url, license_notes, coverage,
        last_checked_at, last_success_at, health_status, schema_version
      ) VALUES (
        ${source.id}, ${source.name}, ${source.authority}, ${source.type}, ${source.jurisdiction},
        ${source.url ?? null}, ${source.license}, ${source.coverage}, now(), now(), 'healthy', 'v1'
      )
      ON CONFLICT (source_id) DO UPDATE SET
        name = EXCLUDED.name,
        authority = EXCLUDED.authority,
        source_type = EXCLUDED.source_type,
        jurisdiction = EXCLUDED.jurisdiction,
        url = EXCLUDED.url,
        license_notes = EXCLUDED.license_notes,
        coverage = EXCLUDED.coverage,
        last_checked_at = now(),
        last_success_at = now(),
        health_status = 'healthy'
    `;
  }
}

export async function recordSnapshot(sql: Sql, snapshotId: string, sourceId: string, notes: string): Promise<void> {
  await sql`
    INSERT INTO source_snapshots (snapshot_id, source_id, notes)
    VALUES (${snapshotId}, ${sourceId}, ${notes})
    ON CONFLICT (snapshot_id) DO UPDATE SET notes = EXCLUDED.notes, created_at = now()
  `;
}

/** Remove every property-derived row plus users. Used by full imports and the offline seed. */
export async function wipePropertyTables(sql: Sql): Promise<void> {
  await sql`DELETE FROM emails`;
  await sql`DELETE FROM handoff_invitations`;
  await sql`DELETE FROM contribution_assertions`;
  await sql`DELETE FROM contributions`;
  await sql`DELETE FROM documents`;
  await sql`DELETE FROM property_maintainers`;
  await sql`DELETE FROM ownership_claims`;
  await sql`DELETE FROM property_events`;
  await sql`DELETE FROM assertions`;
  await sql`DELETE FROM property_addresses`;
  await sql`DELETE FROM property_geometries`;
  await sql`DELETE FROM parcel_identities`;
  await sql`DELETE FROM source_snapshots`;
  await sql`DELETE FROM properties`;
  await sql`DELETE FROM field_vocabulary`;
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM auth_codes`;
  await sql`DELETE FROM sessions`;
  await sql`DELETE FROM user_emails`;
  await sql`DELETE FROM users`;
}

/** Drop one county's parcels (cascades through identities, geometry, assertions, events, claims). */
export async function deleteCounty(sql: Sql, county: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    WITH gone AS (DELETE FROM properties WHERE county = ${county} RETURNING 1)
    SELECT count(*)::int AS n FROM gone
  `;
  return rows[0]?.n ?? 0;
}

export async function seedVocabulary(sql: Sql): Promise<void> {
  for (const [index, field] of FIELD_VOCAB.entries()) {
    await sql`
      INSERT INTO field_vocabulary (field_key, label, group_key, value_type, layer, sort_order)
      VALUES (${field.key}, ${field.label}, ${field.group}, ${field.valueType}, ${field.layer}, ${index})
      ON CONFLICT (field_key) DO UPDATE SET
        label = EXCLUDED.label, group_key = EXCLUDED.group_key, value_type = EXCLUDED.value_type,
        layer = EXCLUDED.layer, sort_order = EXCLUDED.sort_order
    `;
  }
}

/** Stable local admin with a fixed sign-in code for tests and first-run convenience. */
export async function seedAdmin(sql: Sql): Promise<void> {
  const adminId = "usr_admin_local_000000000000";
  await sql`
    INSERT INTO users (user_id, primary_email, email_verified_at, display_name, is_admin)
    VALUES (${adminId}, 'admin@myplace.local', now(), 'Records desk', true)
    ON CONFLICT (user_id) DO NOTHING
  `;
  await sql`
    INSERT INTO user_emails (user_email_id, user_id, email, verified_at)
    VALUES ('uem_admin_local_000000000000', ${adminId}, 'admin@myplace.local', now())
    ON CONFLICT (user_email_id) DO NOTHING
  `;
  await sql`
    INSERT INTO auth_codes (code_id, email, code_hash, purpose, expires_at)
    VALUES ('code_admin_seed', 'admin@myplace.local', ${hashCode("admin@myplace.local", "000000")}, 'signin', now() + interval '365 days')
    ON CONFLICT (code_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, consumed_at = NULL
  `;
}

export async function insertRows<T extends object>(
  sql: Sql,
  table: string,
  rows: T[],
  columns: Array<keyof T & string>,
  size = 500,
): Promise<void> {
  for (const part of chunk(rows, size)) {
    const values = sql(part as Record<string, unknown>[], ...(columns as string[]));
    await sql`INSERT INTO ${sql(table)} ${values}`;
  }
}

/** Insert or replace assertions by primary key so overlay re-runs stay idempotent. */
export async function upsertAssertions(sql: Sql, rows: Asrt[], size = 400): Promise<void> {
  const columns: Array<keyof Asrt & string> = [
    "assertion_id",
    "property_id",
    "field_key",
    "value_json",
    "source_id",
    "source_type",
    "effective_at",
    "observed_at",
    "confidence",
    "status",
  ];
  for (const part of chunk(rows, size)) {
    const values = sql(part as unknown as Record<string, unknown>[], ...columns);
    await sql`
      INSERT INTO assertions ${values}
      ON CONFLICT (assertion_id) DO UPDATE SET
        value_json = EXCLUDED.value_json,
        source_id = EXCLUDED.source_id,
        source_type = EXCLUDED.source_type,
        effective_at = EXCLUDED.effective_at,
        observed_at = EXCLUDED.observed_at,
        confidence = EXCLUDED.confidence,
        status = EXCLUDED.status
    `;
  }
}

export interface GeometryRow {
  geometry_id: string;
  property_id: string;
  geojson: string;
  source_id: string;
  quality: "official" | "approximate" | "demonstration";
  effective_at: string;
}

/**
 * Bulk-insert polygons. Invalid rings are repaired with ST_MakeValid and reduced to
 * their polygonal part; anything that collapses to nothing is dropped. Returns the
 * number of rows that could not be stored.
 */
export async function insertGeometries(sql: Sql, rows: GeometryRow[], size = 500): Promise<number> {
  let rejected = 0;
  const insertBatch = (batch: GeometryRow[]) => sql`
    WITH input AS (
      SELECT *
      FROM unnest(
        ${batch.map((r) => r.geometry_id)}::text[],
        ${batch.map((r) => r.property_id)}::text[],
        ${batch.map((r) => r.geojson)}::text[],
        ${batch.map((r) => r.source_id)}::text[],
        ${batch.map((r) => r.quality)}::text[],
        ${batch.map((r) => r.effective_at)}::date[]
      ) AS t(geometry_id, property_id, geojson, source_id, quality, effective_at)
    ),
    shaped AS (
      SELECT geometry_id, property_id, source_id, quality, effective_at,
             ST_SetSRID(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(geojson)), 3), 4326) AS geom
      FROM input
    )
    INSERT INTO property_geometries (geometry_id, property_id, geom, source_id, quality, is_current, effective_at)
    SELECT geometry_id, property_id, geom, source_id, quality, true, effective_at
    FROM shaped
    WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
  `;
  for (const batch of chunk(rows, size)) {
    try {
      const result = await insertBatch(batch);
      rejected += batch.length - result.count;
    } catch {
      for (const row of batch) {
        try {
          const result = await insertBatch([row]);
          rejected += 1 - result.count;
        } catch {
          rejected += 1;
        }
      }
    }
  }
  return rejected;
}

export interface Prop { property_id: string; state: string; county: string; municipality: string | null }
export interface Ident { parcel_identity_id: string; property_id: string; swis: string; sbl: string; print_key: string; is_current: boolean; effective_at: string }
export interface Addr { address_id: string; property_id: string; street_number: string | null; street_name: string | null; city: string | null; state: string; postal_code: string | null; formatted: string; is_current: boolean; source_id: string }
export interface Asrt { assertion_id: string; property_id: string; field_key: string; value_json: { value: unknown }; source_id: string; source_type: string; effective_at: string; observed_at: string; confidence: number; status: string }
export interface Evt { event_id: string; property_id: string; event_type: string; actor_type: string; source_id: string; payload_json: Record<string, unknown>; effective_at: string }

export interface Batch {
  props: Prop[];
  idents: Ident[];
  addrs: Addr[];
  geoms: GeometryRow[];
  asrts: Asrt[];
  evts: Evt[];
}

export function emptyBatch(): Batch {
  return { props: [], idents: [], addrs: [], geoms: [], asrts: [], evts: [] };
}

export function pushFacts(
  batch: Batch,
  key: string,
  propertyId: string,
  sourceId: string,
  effective: string,
  facts: Array<[string, unknown]>,
  confidence = 0.95,
): void {
  for (const [fieldKey, value] of facts) {
    if (value === null || value === undefined || value === "") continue;
    batch.asrts.push({
      assertion_id: id("ast", `${key}|${fieldKey}|${sourceId}|${effective}`),
      property_id: propertyId,
      field_key: fieldKey,
      value_json: { value },
      source_id: sourceId,
      source_type: "government",
      effective_at: effective,
      observed_at: effective,
      confidence,
      status: "accepted",
    });
  }
}

export async function writeBatch(sql: Sql, batch: Batch, label: string): Promise<{ rejectedGeometries: number }> {
  console.log(`  ${label}: writing ${batch.props.length} properties, ${batch.asrts.length} assertions, ${batch.geoms.length} shapes…`);
  await insertRows(sql, "properties", batch.props, ["property_id", "state", "county", "municipality"]);
  await insertRows(sql, "parcel_identities", batch.idents, ["parcel_identity_id", "property_id", "swis", "sbl", "print_key", "is_current", "effective_at"]);
  await insertRows(sql, "property_addresses", batch.addrs, ["address_id", "property_id", "street_number", "street_name", "city", "state", "postal_code", "formatted", "is_current", "source_id"]);
  const rejectedGeometries = await insertGeometries(sql, batch.geoms);
  await insertRows(sql, "assertions", batch.asrts, ["assertion_id", "property_id", "field_key", "value_json", "source_id", "source_type", "effective_at", "observed_at", "confidence", "status"], 400);
  await insertRows(sql, "property_events", batch.evts, ["event_id", "property_id", "event_type", "actor_type", "source_id", "payload_json", "effective_at"]);
  return { rejectedGeometries };
}

// Keep this a bare product token: overpass-api.de answers 406 to user agents with parentheses.
export const USER_AGENT = "Myplace/0.1";

export async function fetchJson<T>(url: string, init?: RequestInit, attempts = 4, timeoutMs = 240_000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
