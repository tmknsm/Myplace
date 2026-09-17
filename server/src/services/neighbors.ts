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

interface OpenPair {
  request_id: string;
  from_user_id: string;
  to_user_id: string;
  status: "pending" | "accepted";
}

export interface NeighborPerson {
  request_id: string;
  user_id: string;
  label: string;
  photo_url: string;
  status: string;
  created_at: string;
}

function presentPerson(row: NeighborUserRow) {
  const anonymize = Boolean(row.anonymize);
  return {
    user_id: row.user_id,
    label: ownerLabel({ ...row, anonymize }),
    photo_url: ownerPhoto(row),
  };
}

async function loadUser(userId: string): Promise<NeighborUserRow | null> {
  const sql = getSql();
  const rows = await sql<NeighborUserRow[]>`
    SELECT user_id, display_name, first_name, last_name, handle, anonymize, avatar_url
    FROM users
    WHERE user_id = ${userId}
  `;
  return rows[0] ?? null;
}

async function loadOpenBetween(userId: string, otherIds: string[]): Promise<OpenPair[]> {
  if (otherIds.length === 0) return [];
  const sql = getSql();
  return sql<OpenPair[]>`
    SELECT request_id, from_user_id, to_user_id, status
    FROM neighbor_requests
    WHERE status IN ('pending', 'accepted')
      AND (
        (from_user_id = ${userId} AND to_user_id IN ${sql(otherIds)})
        OR (to_user_id = ${userId} AND from_user_id IN ${sql(otherIds)})
      )
  `;
}

export async function neighborState(
  userId: string | null,
  maintainerIds: string[],
  viewerIsMaintainer: boolean,
): Promise<{ status: NeighborStatus }> {
  const others = maintainerIds.filter((id) => id !== userId);
  if (viewerIsMaintainer || others.length === 0) return { status: "hidden" };
  if (!userId) return { status: "none" };

  const rows = await loadOpenBetween(userId, others);
  const incoming = rows.filter((row) => row.status === "pending" && row.to_user_id === userId);
  const outgoing = rows.filter((row) => row.status === "pending" && row.from_user_id === userId);
  const accepted = rows.filter((row) => row.status === "accepted");
  const covered = new Set(
    rows.map((row) => (row.from_user_id === userId ? row.to_user_id : row.from_user_id)),
  );
  const missing = others.filter((id) => !covered.has(id));

  if (accepted.length === others.length) return { status: "accepted" };
  if (incoming.length > 0) return { status: "incoming" };
  if (missing.length > 0) return { status: "none" };
  if (outgoing.length > 0) return { status: "pending" };
  return { status: "none" };
}

export async function requestNeighbor(fromUserId: string, toUserId: string, propertyId: string | null) {
  if (fromUserId === toUserId) return { error: "You can't neighbor yourself.", status: 400 as const };
  const other = await loadUser(toUserId);
  if (!other) return { error: "That person isn't on Myplace.", status: 404 as const };

  const sql = getSql();
  const existing = await sql<OpenPair[]>`
    SELECT request_id, from_user_id, to_user_id, status
    FROM neighbor_requests
    WHERE status IN ('pending', 'accepted')
      AND LEAST(from_user_id, to_user_id) = LEAST(${fromUserId}::text, ${toUserId}::text)
      AND GREATEST(from_user_id, to_user_id) = GREATEST(${fromUserId}::text, ${toUserId}::text)
    LIMIT 1
  `;
  const open = existing[0];
  if (open && open.status === "accepted") return { request: open };
  if (open && open.status === "pending" && open.from_user_id === fromUserId) return { request: open };
  if (open && open.status === "pending" && open.to_user_id === fromUserId) {
    await sql`
      UPDATE neighbor_requests
      SET status = 'accepted', decided_at = now()
      WHERE request_id = ${open.request_id}
    `;
    return { request: { ...open, status: "accepted" as const } };
  }

  const requestId = id("nbr");
  try {
    await sql`
      INSERT INTO neighbor_requests (request_id, from_user_id, to_user_id, property_id, status)
      VALUES (${requestId}, ${fromUserId}, ${toUserId}, ${propertyId}, 'pending')
    `;
  } catch (error) {
    const again = await sql<OpenPair[]>`
      SELECT request_id, from_user_id, to_user_id, status
      FROM neighbor_requests
      WHERE status IN ('pending', 'accepted')
        AND LEAST(from_user_id, to_user_id) = LEAST(${fromUserId}::text, ${toUserId}::text)
        AND GREATEST(from_user_id, to_user_id) = GREATEST(${fromUserId}::text, ${toUserId}::text)
      LIMIT 1
    `;
    if (again[0]) return { request: again[0] };
    throw error;
  }
  return { request: { request_id: requestId, from_user_id: fromUserId, to_user_id: toUserId, status: "pending" as const } };
}

export async function requestNeighborsOnProperty(userId: string, propertyId: string, maintainerIds: string[]) {
  const others = maintainerIds.filter((id) => id !== userId);
  if (others.length === 0) return { error: "There's no one here to neighbor.", status: 400 as const };
  for (const toUserId of others) {
    const result = await requestNeighbor(userId, toUserId, propertyId);
    if ("error" in result) return result;
  }
  return { neighbor: await neighborState(userId, maintainerIds, false) };
}

export async function reviewNeighbor(userId: string, requestId: string, decision: "accepted" | "declined") {
  const sql = getSql();
  const rows = await sql<{ request_id: string; to_user_id: string; status: string }[]>`
    SELECT request_id, to_user_id, status
    FROM neighbor_requests
    WHERE request_id = ${requestId}
  `;
  const row = rows[0];
  if (!row) return { error: "Request not found.", status: 404 as const };
  if (row.to_user_id !== userId) return { error: "Only they can approve that.", status: 403 as const };
  if (row.status !== "pending") return { error: "That request is already decided.", status: 409 as const };
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
  })[]>`
    SELECT
      r.request_id, r.status, r.created_at, r.from_user_id,
      u.user_id, u.display_name, u.first_name, u.last_name, u.handle, u.anonymize, u.avatar_url
    FROM neighbor_requests r
    JOIN users u ON u.user_id = CASE WHEN r.from_user_id = ${userId} THEN r.to_user_id ELSE r.from_user_id END
    WHERE r.status IN ('pending', 'accepted')
      AND (r.from_user_id = ${userId} OR r.to_user_id = ${userId})
    ORDER BY r.created_at DESC
  `;

  const incoming: NeighborPerson[] = [];
  const outgoing: NeighborPerson[] = [];
  const neighbors: NeighborPerson[] = [];
  for (const row of rows) {
    const person = {
      request_id: row.request_id,
      ...presentPerson(row),
      status: row.status,
      created_at: row.created_at,
    };
    if (row.status === "accepted") neighbors.push(person);
    else if (row.status === "pending" && row.from_user_id !== userId) incoming.push(person);
    else if (row.status === "pending") outgoing.push(person);
  }
  return { incoming, outgoing, neighbors };
}
