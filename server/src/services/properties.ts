import { ownerLabel, ownerPhoto } from "../../../shared/profile.ts";
import { geometryNotice, isGeometryQuality, QUALITY_LABEL } from "../counties.ts";
import { getSql } from "../db.ts";
import { assembleFacts, loadAssertionRows } from "./assertions.ts";

interface MaintainerRow {
  maintainer_id: string;
  user_id: string;
  role: string;
  verified_at: Date | string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  handle: string | null;
  anonymize: boolean;
  avatar_url: string | null;
  primary_email: string;
}

export function presentMaintainer(row: MaintainerRow, includePrivate: boolean) {
  const anonymize = Boolean(row.anonymize);
  const labeled = { ...row, anonymize };
  const label = ownerLabel(labeled);
  const photo_url = ownerPhoto(row);
  const publicFields = {
    maintainer_id: row.maintainer_id,
    user_id: row.user_id,
    role: row.role,
    verified_at: row.verified_at,
    handle: row.handle,
    anonymize,
    label,
    photo_url,
  };
  if (!includePrivate && anonymize) return publicFields;
  return {
    ...publicFields,
    display_name: row.display_name,
    first_name: row.first_name,
    last_name: row.last_name,
    primary_email: row.primary_email,
    avatar_url: row.avatar_url,
  };
}

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
  geometry_quality: string | null;
}

export async function loadPropertyCore(propertyId: string): Promise<PropertyCore | null> {
  const sql = getSql();
  const rows = await sql<PropertyCore[]>`
    SELECT
      p.property_id, p.state, p.county, p.municipality, p.status,
      a.formatted, i.swis, i.sbl, i.print_key,
      CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(g.geom)::json END AS geojson,
      g.quality AS geometry_quality
    FROM properties p
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    LEFT JOIN parcel_identities i ON i.property_id = p.property_id AND i.is_current
    LEFT JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    WHERE p.property_id = ${propertyId}
  `;
  return rows[0] ?? null;
}

/**
 * Everything the property page needs. Maintainers see the whole owner layer;
 * everyone else sees only the owner contributions marked public.
 */
export async function loadPropertyPage(propertyId: string, options: { viewerIsMaintainer?: boolean } = {}) {
  const core = await loadPropertyCore(propertyId);
  if (!core) return null;
  const sql = getSql();
  const facts = assembleFacts(await loadAssertionRows(propertyId, { includePrivate: options.viewerIsMaintainer ?? false }));
  const events = await sql`
    SELECT event_id, event_type, actor_type, payload_json, effective_at, created_at
    FROM property_events
    WHERE property_id = ${propertyId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  const maintainerRows = await sql<MaintainerRow[]>`
    SELECT m.maintainer_id, m.user_id, m.role, m.verified_at,
           u.display_name, u.first_name, u.last_name, u.handle, u.anonymize,
           u.avatar_url, u.primary_email
    FROM property_maintainers m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.property_id = ${propertyId} AND m.revoked_at IS NULL
    ORDER BY m.verified_at ASC
  `;
  const maintainers = maintainerRows.map((row) => presentMaintainer(row, options.viewerIsMaintainer ?? false));
  const coverage = {
    assessments: facts.some((f) => f.fieldKey.startsWith("assessment.") && f.status !== "unknown")
      ? "Connected"
      : "Not connected",
    sales: facts.some((f) => f.fieldKey.startsWith("last_sale.") && f.status !== "unknown")
      ? "Connected"
      : "Limited",
    deeds: facts.some((f) => f.fieldKey.startsWith("deed.") && f.status !== "unknown")
      ? "Connected"
      : "Limited",
    permits: "Not connected",
    historic_archive: "Limited",
    lot_lines: isGeometryQuality(core.geometry_quality) ? QUALITY_LABEL[core.geometry_quality] : "None",
  };

  const earliest = await sql<{ earliest: Date | null }[]>`
    SELECT MIN(COALESCE(effective_at, created_at)) AS earliest FROM property_events WHERE property_id = ${propertyId}
  `;

  return {
    ...core,
    facts,
    events,
    maintainers,
    coverage,
    historyNote: earliest[0]?.earliest
      ? `Known digital records currently date back to ${new Date(earliest[0].earliest).getFullYear()}.`
      : "No attributable digital events have been recorded yet.",
    geometryNotice: geometryNotice(core.county, core.geometry_quality),
    geometryQuality: core.geometry_quality,
  };
}

export async function searchProperties(query: string, limit = 12) {
  const sql = getSql();
  const q = query.trim();
  if (!q) return [];
  const contains = `%${q}%`;
  // Candidates come from trigram-indexed lookups per table; only the hits are joined and ranked.
  return sql`
    WITH hits AS (
      SELECT property_id FROM property_addresses WHERE is_current AND formatted ILIKE ${contains}
      UNION
      SELECT property_id FROM parcel_identities
      WHERE is_current AND (sbl ILIKE ${contains} OR print_key ILIKE ${contains})
      UNION
      SELECT property_id FROM properties WHERE municipality ILIKE ${contains} OR county ILIKE ${contains}
    )
    SELECT
      p.property_id, p.municipality, p.county,
      a.formatted,
      i.sbl, i.print_key,
      CASE WHEN g.geom IS NULL THEN NULL ELSE ST_AsGeoJSON(ST_Centroid(g.geom))::json END AS centroid
    FROM hits
    JOIN properties p ON p.property_id = hits.property_id
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    LEFT JOIN parcel_identities i ON i.property_id = p.property_id AND i.is_current
    LEFT JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    ORDER BY (a.formatted ILIKE ${q + "%"}) DESC, similarity(COALESCE(a.formatted, ''), ${q}) DESC, a.formatted
    LIMIT ${limit}
  `;
}

export const TILE_MIN_ZOOM = 11;
export const TILE_MAX_ZOOM = 16;
export const TILE_LAYER = "parcels";

/**
 * Mapbox Vector Tile of current parcel shapes. Geometry is clipped and quantized in
 * PostGIS, so a tile carries only what is visible instead of a GeoJSON dump of the bbox.
 * The 4326 GIST index answers the bbox filter; only the matching rows are reprojected.
 */
export async function parcelTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const sql = getSql();
  const rows = await sql<{ tile: Uint8Array | null }[]>`
    WITH bounds AS (
      SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS tile,
             ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}, margin => 64.0 / 4096), 4326) AS search
    ),
    mvt AS (
      SELECT
        ST_AsMVTGeom(ST_Transform(g.geom, 3857), bounds.tile, 4096, 64, true) AS geom,
        g.property_id,
        g.quality AS "geometryQuality",
        p.county
      FROM property_geometries g
      CROSS JOIN bounds
      JOIN properties p ON p.property_id = g.property_id
      WHERE g.is_current AND g.geom && bounds.search
    )
    SELECT ST_AsMVT(mvt, ${TILE_LAYER}, 4096, 'geom') AS tile FROM mvt WHERE geom IS NOT NULL
  `;
  const tile = rows[0]?.tile;
  return tile && tile.length > 0 ? tile : null;
}

export async function parcelsInBbox(west: number, south: number, east: number, north: number, limit = 400) {
  const sql = getSql();
  const rows = await sql<{
    property_id: string;
    formatted: string | null;
    county: string;
    quality: string;
    geojson: unknown;
  }[]>`
    SELECT
      p.property_id,
      p.county,
      a.formatted,
      g.quality,
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
        county: row.county,
        geometryQuality: row.quality,
      },
      geometry: row.geojson,
    })),
  };
}
