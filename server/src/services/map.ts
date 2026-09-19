import { ownerLabel, ownerPhoto } from "../../../shared/profile.ts";
import { getSql } from "../db.ts";
import { FIELD_BY_KEY, formatFieldValue } from "../vocab.ts";

export interface MapHomeOwner {
  user_id: string;
  label: string;
  photo_url: string;
}

export interface MapHomeFact {
  key: string;
  label: string;
  display: string;
}

export interface MapHome {
  property_id: string;
  formatted: string | null;
  street_number: string | null;
  street_name: string | null;
  municipality: string | null;
  county: string;
  geometry_quality: string | null;
  centroid: [number, number] | null;
  geojson: unknown;
  photo_url: string | null;
  photo_count: number;
  owners: MapHomeOwner[];
  facts: MapHomeFact[];
}

/** The roll facts worth a line on a card, in the order they are shown. */
const CARD_FACT_KEYS = ["year_built", "acreage", "assessment.total"] as const;

export const MAP_HOMES_LIMIT = 60;

interface HomeRow {
  property_id: string;
  formatted: string | null;
  street_number: string | null;
  street_name: string | null;
  municipality: string | null;
  county: string;
  quality: string | null;
  centroid: { type: string; coordinates: [number, number] } | null;
  geojson: unknown;
  document_id: string | null;
  byte_size: number | null;
  photo_count: number | string;
}

/** Public photos that count toward a home's gallery: what the property page's hero shows. */
const GALLERY_PHOTO = `
  removed_at IS NULL
  AND claim_id IS NULL
  AND visibility = 'public'
  AND (mime_type LIKE 'image/%' OR document_type = 'photo')
  AND topic_id IS DISTINCT FROM 'paint'
  AND topic_id IS DISTINCT FROM 'style'
`;

interface OwnerRow {
  property_id: string;
  user_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  handle: string | null;
  anonymize: boolean;
  hide_street: boolean;
  avatar_url: string | null;
}

interface FactRow {
  property_id: string;
  field_key: string;
  value_json: unknown;
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) return (value as { value: unknown }).value;
  return value;
}

/**
 * Everything the map's bottom sheet needs for one viewport: how many homes
 * the box touches, and cards for the first few. Claimed houses with a public
 * photo lead, then other claimed houses, then whatever is nearest the middle
 * of the view, so the preview card is the most interesting home on screen.
 */
export async function homesInView(
  west: number,
  south: number,
  east: number,
  north: number,
  limit = MAP_HOMES_LIMIT,
): Promise<{ count: number; homes: MapHome[] }> {
  const sql = getSql();
  const size = Math.max(1, Math.min(limit, MAP_HOMES_LIMIT));
  const envelope = sql`ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)`;
  const gallery = sql.unsafe(GALLERY_PHOTO);

  const counted = await sql<{ count: number | string }[]>`
    SELECT count(*) AS count
    FROM property_geometries g
    JOIN properties p ON p.property_id = g.property_id AND NOT p.removed
    WHERE g.is_current AND g.geom && ${envelope}
  `;
  const count = Number(counted[0]?.count ?? 0);
  if (count === 0) return { count: 0, homes: [] };

  // Claimed and pictured homes are a small set; rank them by hand, then fill
  // the rest from the middle of the view outward. The second query has no
  // tie-breaker so the GIST index can serve rows in distance order.
  const featured = await sql<{ property_id: string }[]>`
    WITH claimed AS (
      SELECT DISTINCT property_id FROM property_maintainers WHERE revoked_at IS NULL
    ),
    pictured AS (
      SELECT DISTINCT property_id FROM documents WHERE ${gallery}
    ),
    interesting AS (
      SELECT property_id FROM claimed UNION SELECT property_id FROM pictured
    )
    SELECT g.property_id
    FROM interesting i
    JOIN property_geometries g ON g.property_id = i.property_id AND g.is_current
    JOIN properties p ON p.property_id = g.property_id AND NOT p.removed
    LEFT JOIN pictured ph ON ph.property_id = g.property_id
    WHERE g.geom && ${envelope}
    ORDER BY
      (ph.property_id IS NOT NULL) DESC,
      g.geom <-> ST_Centroid(${envelope}),
      g.property_id
    LIMIT ${size}
  `;
  const ids = featured.map((row) => row.property_id);
  if (ids.length < size) {
    const filler = await sql<{ property_id: string }[]>`
      SELECT g.property_id
      FROM property_geometries g
      JOIN properties p ON p.property_id = g.property_id AND NOT p.removed
      WHERE g.is_current
        AND g.geom && ${envelope}
        ${ids.length ? sql`AND g.property_id NOT IN ${sql(ids)}` : sql``}
      ORDER BY g.geom <-> ST_Centroid(${envelope})
      LIMIT ${size - ids.length}
    `;
    for (const row of filler) ids.push(row.property_id);
  }
  if (ids.length === 0) return { count, homes: [] };

  const detailRows = await sql<HomeRow[]>`
    SELECT
      p.property_id,
      a.formatted, a.street_number, a.street_name,
      p.municipality, p.county,
      g.quality,
      ST_AsGeoJSON(ST_Centroid(g.geom))::json AS centroid,
      ST_AsGeoJSON(g.geom)::json AS geojson,
      d.document_id, d.byte_size,
      COALESCE(n.photo_count, 0) AS photo_count
    FROM properties p
    JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    LEFT JOIN LATERAL (
      SELECT document_id, byte_size
      FROM documents
      WHERE property_id = p.property_id AND ${gallery}
      ORDER BY is_cover DESC, created_at DESC
      LIMIT 1
    ) d ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS photo_count
      FROM documents
      WHERE property_id = p.property_id AND ${gallery}
    ) n ON TRUE
    WHERE p.property_id IN ${sql(ids)}
  `;
  const byId = new Map(detailRows.map((row) => [row.property_id, row]));
  const rows = ids.map((id) => byId.get(id)).filter((row): row is HomeRow => Boolean(row));
  const [ownerRows, factRows] = await Promise.all([
    sql<OwnerRow[]>`
      SELECT m.property_id, u.user_id, u.display_name, u.first_name, u.last_name, u.handle,
             m.anonymize, m.hide_street, u.avatar_url
      FROM property_maintainers m
      JOIN users u ON u.user_id = m.user_id
      WHERE m.revoked_at IS NULL AND m.property_id IN ${sql(ids)}
      ORDER BY m.verified_at ASC
    `,
    sql<FactRow[]>`
      SELECT DISTINCT ON (property_id, field_key) property_id, field_key, value_json
      FROM assertions
      WHERE property_id IN ${sql(ids)}
        AND status = 'accepted'
        AND source_type IN ('government', 'platform_admin')
        AND field_key IN ${sql([...CARD_FACT_KEYS])}
      ORDER BY property_id, field_key, COALESCE(effective_at, created_at) DESC, created_at DESC
    `,
  ]);

  const owners = new Map<string, MapHomeOwner[]>();
  const hideStreet = new Set<string>();
  for (const row of ownerRows) {
    const list = owners.get(row.property_id) ?? [];
    const anonymize = Boolean(row.anonymize);
    list.push({
      user_id: row.user_id,
      label: ownerLabel({ ...row, anonymize }),
      photo_url: ownerPhoto(row),
    });
    owners.set(row.property_id, list);
    if (row.hide_street) hideStreet.add(row.property_id);
  }

  const facts = new Map<string, Map<string, unknown>>();
  for (const row of factRows) {
    const list = facts.get(row.property_id) ?? new Map<string, unknown>();
    list.set(row.field_key, unwrap(row.value_json));
    facts.set(row.property_id, list);
  }

  const homes = rows.map((row): MapHome => {
    const hidden = hideStreet.has(row.property_id);
    const own = facts.get(row.property_id);
    const cardFacts: MapHomeFact[] = [];
    for (const key of CARD_FACT_KEYS) {
      const field = FIELD_BY_KEY.get(key);
      const display = field && own?.has(key) ? formatFieldValue(field, own.get(key)) : null;
      if (field && display) cardFacts.push({ key, label: field.label, display });
    }
    return {
      property_id: row.property_id,
      // An owner who hid the street shows up as their town, on the map too.
      formatted: hidden ? (row.municipality ? `${row.municipality}, NY` : null) : row.formatted,
      street_number: hidden ? null : row.street_number,
      street_name: hidden ? null : row.street_name,
      municipality: row.municipality,
      county: row.county,
      geometry_quality: row.quality,
      centroid: row.centroid?.coordinates ?? null,
      geojson: row.geojson,
      photo_url: row.document_id ? `/api/documents/${row.document_id}/file?v=${row.byte_size ?? 0}` : null,
      photo_count: Number(row.photo_count ?? 0),
      owners: owners.get(row.property_id) ?? [],
      facts: cardFacts,
    };
  });

  return { count, homes };
}
