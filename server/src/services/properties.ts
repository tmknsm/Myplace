import { getSql } from "../db.ts";
import { assembleFacts, loadAssertionRows } from "./assertions.ts";

export interface PropertyCore {
  property_id: string;
  state: string;
  county: string;
  municipality: string | null;
  status: string;
  formatted: string | null;
  swis: string | null;
  sbl: string | null;
  print_key: string | null;
  geojson: unknown;
}

export async function loadPropertyCore(propertyId: string): Promise<PropertyCore | null> {
  const sql = getSql();
  const rows = await sql<PropertyCore[]>`
    SELECT
      p.property_id, p.state, p.county, p.municipality, p.status,
      a.formatted, i.swis, i.sbl, i.print_key,
      CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(g.geom)::json END AS geojson
    FROM properties p
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    LEFT JOIN parcel_identities i ON i.property_id = p.property_id AND i.is_current
    LEFT JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    WHERE p.property_id = ${propertyId}
  `;
  return rows[0] ?? null;
}

export async function loadPropertyPage(propertyId: string) {
  const core = await loadPropertyCore(propertyId);
  if (!core) return null;
  const sql = getSql();
  const facts = assembleFacts(await loadAssertionRows(propertyId));
  const events = await sql`
    SELECT event_id, event_type, actor_type, payload_json, effective_at, created_at
    FROM property_events
    WHERE property_id = ${propertyId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  const maintainers = await sql`
    SELECT m.maintainer_id, m.role, m.verified_at, u.display_name, u.primary_email
    FROM property_maintainers m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.property_id = ${propertyId} AND m.revoked_at IS NULL
  `;
  const coverage = {
    assessments: facts.some((f) => f.fieldKey.startsWith("assessment.") && f.status !== "unknown")
      ? "Connected"
      : "Not connected",
    sales: facts.some((f) => f.fieldKey.startsWith("last_sale.") && f.status !== "unknown")
      ? "Connected"
      : "Limited",
    permits: "Not connected",
    historic_archive: "Limited",
  };

  const earliest = await sql<{ effective_at: Date | null }[]>`
    SELECT MIN(effective_at) AS effective_at FROM property_events WHERE property_id = ${propertyId}
  `;

  return {
    ...core,
    facts,
    events,
    maintainers,
    coverage,
    historyNote: earliest[0]?.effective_at
      ? `Known digital records currently date back to ${new Date(earliest[0].effective_at).getFullYear()}.`
      : "No attributable digital events have been recorded yet.",
  };
}

export async function searchProperties(query: string, limit = 12) {
  const sql = getSql();
  const q = query.trim();
  if (!q) return [];
  return sql`
    SELECT
      p.property_id, p.municipality, p.county,
      a.formatted,
      i.sbl, i.print_key,
      CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(ST_Centroid(g.geom))::json END AS centroid
    FROM properties p
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    LEFT JOIN parcel_identities i ON i.property_id = p.property_id AND i.is_current
    LEFT JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    WHERE
      a.formatted ILIKE ${"%" + q + "%"}
      OR i.sbl ILIKE ${"%" + q + "%"}
      OR i.print_key ILIKE ${"%" + q + "%"}
      OR p.municipality ILIKE ${"%" + q + "%"}
    ORDER BY similarity(COALESCE(a.formatted, ''), ${q}) DESC, a.formatted
    LIMIT ${limit}
  `;
}

export async function parcelsInBbox(west: number, south: number, east: number, north: number, limit = 1500) {
  const sql = getSql();
  const rows = await sql<{ property_id: string; formatted: string | null; geojson: unknown }[]>`
    SELECT
      p.property_id,
      a.formatted,
      ST_AsGeoJSON(g.geom)::json AS geojson
    FROM property_geometries g
    JOIN properties p ON p.property_id = g.property_id
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    WHERE g.is_current
      AND g.geom && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
    LIMIT ${limit}
  `;
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      id: row.property_id,
      properties: {
        property_id: row.property_id,
        address: row.formatted,
      },
      geometry: row.geojson,
    })),
  };
}
