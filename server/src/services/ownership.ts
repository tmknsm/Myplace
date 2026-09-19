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
  await applyClaimChoices(input.claimId);
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

/**
 * Choices made during onboarding wait on the claim until it is verified, then
 * take effect at once: how the owner is named and where they are placed on
 * this house, whether the house is listed at all, and the hero photo. The
 * hero was uploaded against the claim, so it was invisible until now; here it
 * becomes the public cover and, unless they said otherwise, their first post.
 */
export async function applyClaimChoices(claimId: string): Promise<void> {
  const sql = getSql();
  const rows = await sql<{
    property_id: string;
    user_id: string;
    anonymize: boolean;
    hide_street: boolean;
    hide_listing: boolean;
    hero_document_id: string | null;
    hero_caption: string | null;
    hero_as_post: boolean;
  }[]>`
    SELECT property_id, user_id, anonymize, hide_street, hide_listing, hero_document_id, hero_caption, hero_as_post
    FROM ownership_claims WHERE claim_id = ${claimId}
  `;
  const claim = rows[0];
  if (!claim) return;
  await sql`
    UPDATE property_maintainers
    SET anonymize = ${claim.anonymize}, hide_street = ${claim.hide_street}
    WHERE property_id = ${claim.property_id} AND user_id = ${claim.user_id} AND revoked_at IS NULL
  `;
  if (claim.hide_listing) {
    await sql`UPDATE properties SET removed = TRUE WHERE property_id = ${claim.property_id}`;
  }
  if (!claim.hero_document_id) return;
  const hero = await sql<{ document_id: string }[]>`
    SELECT document_id FROM documents
    WHERE document_id = ${claim.hero_document_id} AND property_id = ${claim.property_id} AND removed_at IS NULL
  `;
  if (!hero[0]) return;
  const caption = claim.hero_caption?.trim() || null;
  let postId: string | null = null;
  if (claim.hero_as_post) {
    postId = id("post");
    await sql`
      INSERT INTO property_posts (post_id, property_id, created_by, body)
      VALUES (${postId}, ${claim.property_id}, ${claim.user_id}, ${caption})
    `;
  }
  await sql`
    UPDATE documents
    SET claim_id = NULL, post_id = ${postId}, visibility = 'public', document_type = 'photo',
        transferability = 'property_transferable', caption = ${caption}
    WHERE document_id = ${claim.hero_document_id}
  `;
  await sql`UPDATE documents SET is_cover = FALSE WHERE property_id = ${claim.property_id} AND is_cover`;
  await sql`UPDATE documents SET is_cover = TRUE WHERE document_id = ${claim.hero_document_id}`;
  await emitEvent({
    propertyId: claim.property_id,
    eventType: postId ? "post.added" : "photo.added",
    actorType: "verified_owner",
    actorId: claim.user_id,
    payload: postId
      ? { post_id: postId }
      : { document_id: claim.hero_document_id, document_type: "photo", visibility: "public", transferability: "property_transferable" },
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
