import { ownerLabel, ownerPhoto } from "../../../shared/profile.ts";
import { getSql } from "../db.ts";
import { id } from "../ids.ts";

export type NeighborStatus = "hidden" | "none" | "pending" | "incoming" | "accepted";

interface NeighborUserRow {
  user_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  handle: string | null;
  anonymize: boolean;
  avatar_url: string | null;
}

export interface NeighborOwner {
  user_id: string;
  label: string;
  photo_url: string;
}

export interface NeighborPerson {
  request_id: string;
  user_id: string;
  label: string;
  photo_url: string | null;
  owners: NeighborOwner[];
  status: string;
  created_at: string;
  property_id: string | null;
}

export interface PropertyNeighbor {
  property_id: string;
  formatted: string | null;
  street_number: string | null;
  street_name: string | null;
  photo_url: string | null;
}

function housePhotoUrl(documentId: string | null, byteSize: number | null): string | null {
  return documentId ? `/api/documents/${documentId}/file?v=${byteSize ?? 0}` : null;
}

function presentPerson(row: NeighborUserRow) {
  const anonymize = Boolean(row.anonymize);
  return {
    user_id: row.user_id,
    label: ownerLabel({ ...row, anonymize }),
  };
}

function presentOwner(row: NeighborUserRow): NeighborOwner {
  const anonymize = Boolean(row.anonymize);
  return {
    user_id: row.user_id,
    label: ownerLabel({ ...row, anonymize }),
    photo_url: ownerPhoto(row),
  };
}

async function ownersOf(propertyIds: Array<string | null | undefined>): Promise<Map<string, NeighborOwner[]>> {
  const ids = [...new Set(propertyIds.filter((value): value is string => Boolean(value)))];
  const map = new Map<string, NeighborOwner[]>();
  if (ids.length === 0) return map;
  const sql = getSql();
  const rows = await sql<(NeighborUserRow & { property_id: string })[]>`
    SELECT m.property_id, u.user_id, u.display_name, u.first_name, u.last_name, u.handle, u.anonymize, u.avatar_url
    FROM property_maintainers m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.revoked_at IS NULL AND m.property_id IN ${sql(ids)}
    ORDER BY m.verified_at ASC
  `;
  for (const row of rows) {
    const list = map.get(row.property_id) ?? [];
    list.push(presentOwner(row));
    map.set(row.property_id, list);
  }
  return map;
}

export async function neighborState(
  userId: string | null,
  propertyId: string,
  maintainerIds: string[],
  viewerIsMaintainer: boolean,
): Promise<{ status: NeighborStatus }> {
  if (viewerIsMaintainer || maintainerIds.length === 0) return { status: "hidden" };
  if (!userId) return { status: "none" };

  const sql = getSql();
  const outbound = await sql<{ status: "pending" | "accepted" }[]>`
    SELECT status
    FROM neighbor_requests
    WHERE from_user_id = ${userId}
      AND property_id = ${propertyId}
      AND status IN ('pending', 'accepted')
    LIMIT 1
  `;
  if (outbound[0]?.status === "accepted") return { status: "accepted" };
  if (outbound[0]?.status === "pending") return { status: "pending" };

  const inbound = await sql<{ status: "pending" | "accepted" }[]>`
    SELECT r.status
    FROM neighbor_requests r
    WHERE r.from_property_id = ${propertyId}
      AND r.status IN ('pending', 'accepted')
      AND EXISTS (
        SELECT 1 FROM property_maintainers m
        WHERE m.property_id = r.property_id AND m.user_id = ${userId} AND m.revoked_at IS NULL
      )
    LIMIT 1
  `;
  if (inbound[0]?.status === "accepted") return { status: "accepted" };
  if (inbound[0]?.status === "pending") return { status: "pending" };
  return { status: "none" };
}

async function homesOf(userId: string) {
  const sql = getSql();
  return sql<{ property_id: string; formatted: string | null }[]>`
    SELECT p.property_id, a.formatted
    FROM property_maintainers m
    JOIN properties p ON p.property_id = m.property_id
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    WHERE m.user_id = ${userId} AND m.revoked_at IS NULL
    ORDER BY a.formatted
  `;
}

/** One open request per (person, their house → that house). */
export async function requestNeighborsOnProperty(
  userId: string,
  propertyId: string,
  maintainerIds: string[],
  fromPropertyId?: string | null,
) {
  const others = maintainerIds.filter((id) => id !== userId);
  if (others.length === 0) return { error: "There's no one here to neighbor.", status: 400 as const };

  const homes = await homesOf(userId);
  if (homes.length === 0) {
    return { error: "Claim a house first so they know which address this is from.", status: 400 as const };
  }
  const chosen = fromPropertyId
    ? homes.find((home) => home.property_id === fromPropertyId)
    : homes.length === 1 ? homes[0] : undefined;
  if (!chosen) {
    return {
      error: "Choose which of your houses this is from.",
      status: 409 as const,
      properties: homes,
    };
  }
  if (chosen.property_id === propertyId) {
    return { error: "This is already your page.", status: 400 as const };
  }

  const sql = getSql();
  const existing = await sql<{ request_id: string }[]>`
    SELECT request_id
    FROM neighbor_requests
    WHERE from_user_id = ${userId}
      AND property_id = ${propertyId}
      AND status IN ('pending', 'accepted')
    LIMIT 1
  `;
  if (existing[0]) {
    return { neighbor: await neighborState(userId, propertyId, maintainerIds, false) };
  }

  const requestId = id("nbr");
  const toUserId = others[0]!;
  try {
    await sql`
      INSERT INTO neighbor_requests (request_id, from_user_id, to_user_id, property_id, from_property_id, status)
      VALUES (${requestId}, ${userId}, ${toUserId}, ${propertyId}, ${chosen.property_id}, 'pending')
    `;
  } catch {
    const again = await sql<{ request_id: string }[]>`
      SELECT request_id
      FROM neighbor_requests
      WHERE from_user_id = ${userId}
        AND property_id = ${propertyId}
        AND status IN ('pending', 'accepted')
      LIMIT 1
    `;
    if (!again[0]) throw new Error("Could not send that request.");
  }
  return { neighbor: await neighborState(userId, propertyId, maintainerIds, false) };
}

export async function reviewNeighbor(userId: string, requestId: string, decision: "accepted" | "declined") {
  const sql = getSql();
  const rows = await sql<{ request_id: string; property_id: string; status: string }[]>`
    SELECT request_id, property_id, status
    FROM neighbor_requests
    WHERE request_id = ${requestId}
  `;
  const row = rows[0];
  if (!row) return { error: "Request not found.", status: 404 as const };
  if (row.status !== "pending") return { error: "That request is already decided.", status: 409 as const };

  const allowed = await sql<{ user_id: string }[]>`
    SELECT user_id FROM property_maintainers
    WHERE property_id = ${row.property_id} AND user_id = ${userId} AND revoked_at IS NULL
    LIMIT 1
  `;
  if (!allowed[0]) return { error: "Only they can approve that.", status: 403 as const };

  await sql`
    UPDATE neighbor_requests
    SET status = ${decision}, decided_at = now()
    WHERE request_id = ${requestId}
  `;
  return { ok: true as const, decision };
}

export async function loadMyNeighbors(userId: string, propertyId?: string): Promise<{ incoming: NeighborPerson[]; outgoing: NeighborPerson[]; neighbors: NeighborPerson[] }> {
  const sql = getSql();
  const scoped = propertyId
    ? sql`AND (r.property_id = ${propertyId} OR r.from_property_id = ${propertyId})`
    : sql``;
  const rows = await sql<(NeighborUserRow & {
    request_id: string;
    status: string;
    created_at: string;
    from_user_id: string;
    property_id: string | null;
    formatted: string | null;
    document_id: string | null;
    byte_size: number | null;
  })[]>`
    SELECT
      r.request_id, r.status, r.created_at, r.from_user_id,
      CASE WHEN r.from_user_id = ${userId} THEN r.property_id ELSE r.from_property_id END AS property_id,
      u.user_id, u.display_name, u.first_name, u.last_name, u.handle, u.anonymize, u.avatar_url,
      a.formatted,
      d.document_id,
      d.byte_size
    FROM neighbor_requests r
    JOIN users u ON u.user_id = CASE WHEN r.from_user_id = ${userId} THEN r.to_user_id ELSE r.from_user_id END
    LEFT JOIN property_addresses a ON a.property_id = CASE WHEN r.from_user_id = ${userId} THEN r.property_id ELSE r.from_property_id END AND a.is_current
    LEFT JOIN LATERAL (
      SELECT document_id, byte_size
      FROM documents
      WHERE property_id = CASE WHEN r.from_user_id = ${userId} THEN r.property_id ELSE r.from_property_id END
        AND removed_at IS NULL
        AND visibility = 'public'
        AND (mime_type LIKE 'image/%' OR document_type = 'photo')
      ORDER BY is_cover DESC, created_at DESC
      LIMIT 1
    ) d ON TRUE
    WHERE r.status IN ('pending', 'accepted')
      AND (
        r.from_user_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM property_maintainers m
          WHERE m.property_id = r.property_id AND m.user_id = ${userId} AND m.revoked_at IS NULL
        )
      )
      ${scoped}
    ORDER BY r.created_at DESC
  `;

  const owners = await ownersOf(rows.map((row) => row.property_id));
  const incoming: NeighborPerson[] = [];
  const outgoing: NeighborPerson[] = [];
  const neighbors: NeighborPerson[] = [];
  for (const row of rows) {
    const shown = presentPerson(row);
    const person = {
      request_id: row.request_id,
      ...shown,
      label: row.formatted || shown.label,
      photo_url: housePhotoUrl(row.document_id, row.byte_size),
      owners: row.property_id ? owners.get(row.property_id) ?? [] : [],
      property_id: row.property_id,
      status: row.status,
      created_at: row.created_at,
    };
    if (row.status === "accepted") neighbors.push(person);
    else if (row.status === "pending" && row.from_user_id !== userId) incoming.push(person);
    else if (row.status === "pending") outgoing.push(person);
  }
  return { incoming, outgoing, neighbors };
}

/** Confirmed house-to-house neighbors of one address. Public on the property page. */
export async function loadPropertyNeighbors(propertyId: string): Promise<PropertyNeighbor[]> {
  const sql = getSql();
  const rows = await sql<{
    property_id: string;
    formatted: string | null;
    street_number: string | null;
    street_name: string | null;
    document_id: string | null;
    byte_size: number | null;
  }[]>`
    WITH linked AS (
      SELECT
        CASE WHEN r.property_id = ${propertyId} THEN r.from_property_id ELSE r.property_id END AS property_id,
        COALESCE(r.decided_at, r.created_at) AS decided_at
      FROM neighbor_requests r
      WHERE r.status = 'accepted'
        AND r.from_property_id IS NOT NULL
        AND (r.property_id = ${propertyId} OR r.from_property_id = ${propertyId})
    ),
    unique_linked AS (
      SELECT DISTINCT ON (property_id) property_id, decided_at
      FROM linked
      ORDER BY property_id, decided_at DESC
    )
    SELECT
      u.property_id,
      a.formatted,
      a.street_number,
      a.street_name,
      d.document_id,
      d.byte_size
    FROM unique_linked u
    LEFT JOIN property_addresses a ON a.property_id = u.property_id AND a.is_current
    LEFT JOIN LATERAL (
      SELECT document_id, byte_size
      FROM documents
      WHERE property_id = u.property_id
        AND removed_at IS NULL
        AND visibility = 'public'
        AND (mime_type LIKE 'image/%' OR document_type = 'photo')
      ORDER BY is_cover DESC, created_at DESC
      LIMIT 1
    ) d ON TRUE
    ORDER BY u.decided_at DESC
  `;
  return rows.map((row) => ({
    property_id: row.property_id,
    formatted: row.formatted,
    street_number: row.street_number,
    street_name: row.street_name,
    photo_url: housePhotoUrl(row.document_id, row.byte_size),
  }));
}
