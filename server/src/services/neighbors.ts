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

export interface NeighborPerson {
  request_id: string;
  user_id: string;
  label: string;
  photo_url: string;
  status: string;
  created_at: string;
  property_id: string | null;
}

function presentPerson(row: NeighborUserRow) {
  const anonymize = Boolean(row.anonymize);
  return {
    user_id: row.user_id,
    label: ownerLabel({ ...row, anonymize }),
    photo_url: ownerPhoto(row),
  };
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

export async function loadMyNeighbors(userId: string): Promise<{ incoming: NeighborPerson[]; outgoing: NeighborPerson[]; neighbors: NeighborPerson[] }> {
  const sql = getSql();
  const rows = await sql<(NeighborUserRow & {
    request_id: string;
    status: string;
    created_at: string;
    from_user_id: string;
    property_id: string | null;
    formatted: string | null;
  })[]>`
    SELECT
      r.request_id, r.status, r.created_at, r.from_user_id,
      CASE WHEN r.from_user_id = ${userId} THEN r.property_id ELSE r.from_property_id END AS property_id,
      u.user_id, u.display_name, u.first_name, u.last_name, u.handle, u.anonymize, u.avatar_url,
      a.formatted
    FROM neighbor_requests r
    JOIN users u ON u.user_id = CASE WHEN r.from_user_id = ${userId} THEN r.to_user_id ELSE r.from_user_id END
    LEFT JOIN property_addresses a ON a.property_id = CASE WHEN r.from_user_id = ${userId} THEN r.property_id ELSE r.from_property_id END AND a.is_current
    WHERE r.status IN ('pending', 'accepted')
      AND (
        r.from_user_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM property_maintainers m
          WHERE m.property_id = r.property_id AND m.user_id = ${userId} AND m.revoked_at IS NULL
        )
      )
    ORDER BY r.created_at DESC
  `;

  const incoming: NeighborPerson[] = [];
  const outgoing: NeighborPerson[] = [];
  const neighbors: NeighborPerson[] = [];
  for (const row of rows) {
    const shown = presentPerson(row);
    const person = {
      request_id: row.request_id,
      ...shown,
      label: row.formatted || shown.label,
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
