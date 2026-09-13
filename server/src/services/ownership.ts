import { getSql } from "../db.ts";
import { id } from "../ids.ts";
import { emitEvent } from "./events.ts";

/**
 * Make `userId` the verified owner maintainer of a property. Anyone else holding
 * a maintainer role is revoked, earlier verified claims are superseded, and the
 * change lands in the event history. Used by the admin review desk and, in local
 * development only, by the debug PIN claim.
 */
export async function grantOwnership(input: {
  propertyId: string;
  userId: string;
  claimId: string;
  actorType: string;
  actorId: string | null;
  reviewerNote?: string | null;
}): Promise<void> {
  const sql = getSql();
  const displaced = await sql<{ user_id: string }[]>`
    UPDATE property_maintainers
    SET revoked_at = now()
    WHERE property_id = ${input.propertyId} AND revoked_at IS NULL AND user_id <> ${input.userId}
    RETURNING user_id
  `;
  await sql`
    INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
    VALUES (${id("mnt")}, ${input.propertyId}, ${input.userId}, 'owner')
    ON CONFLICT (property_id, user_id) WHERE revoked_at IS NULL DO UPDATE SET role = 'owner'
  `;
  await sql`
    UPDATE ownership_claims
    SET status = 'verified', verified_at = now(), reviewed_by = ${input.actorId},
        reviewer_note = ${input.reviewerNote ?? null}
    WHERE claim_id = ${input.claimId}
  `;
  await sql`
    UPDATE ownership_claims
    SET status = 'superseded'
    WHERE property_id = ${input.propertyId}
      AND claim_id <> ${input.claimId}
      AND status = 'verified'
  `;
  for (const row of displaced) {
    await emitEvent({
      propertyId: input.propertyId,
      eventType: "ownership.revoked",
      actorType: input.actorType,
      actorId: input.actorId,
      payload: { user_id: row.user_id, reason: "superseded_by_new_owner" },
    });
  }
  await emitEvent({
    propertyId: input.propertyId,
    eventType: "ownership.claimed",
    actorType: input.actorType,
    actorId: input.actorId,
    payload: { claim_id: input.claimId, user_id: input.userId },
  });
}

/** End one user's maintainer role on a property and close out their verified claims. */
export async function revokeOwnership(input: {
  propertyId: string;
  userId: string;
  actorType: string;
  actorId: string | null;
  reason: string;
}): Promise<boolean> {
  const sql = getSql();
  const revoked = await sql<{ maintainer_id: string; role: string }[]>`
    UPDATE property_maintainers
    SET revoked_at = now()
    WHERE property_id = ${input.propertyId} AND user_id = ${input.userId} AND revoked_at IS NULL
    RETURNING maintainer_id, role
  `;
  if (revoked.length === 0) return false;
  await sql`
    UPDATE ownership_claims
    SET status = 'revoked', revoked_at = now()
    WHERE property_id = ${input.propertyId} AND user_id = ${input.userId} AND status = 'verified'
  `;
  await emitEvent({
    propertyId: input.propertyId,
    eventType: "ownership.revoked",
    actorType: input.actorType,
    actorId: input.actorId,
    payload: { user_id: input.userId, role: revoked[0]?.role ?? "owner", reason: input.reason },
  });
  return true;
}

export async function addCoMaintainer(input: {
  propertyId: string;
  userId: string;
  invitationId: string;
  actorId: string | null;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
    VALUES (${id("mnt")}, ${input.propertyId}, ${input.userId}, 'co_owner')
    ON CONFLICT (property_id, user_id) WHERE revoked_at IS NULL DO NOTHING
  `;
  await sql`
    UPDATE handoff_invitations
    SET status = 'accepted', accepted_at = now(), accepted_by = ${input.userId}
    WHERE invitation_id = ${input.invitationId}
  `;
  await emitEvent({
    propertyId: input.propertyId,
    eventType: "ownership.co_maintainer_added",
    actorType: "user",
    actorId: input.actorId,
    payload: { user_id: input.userId, invitation_id: input.invitationId },
  });
}
