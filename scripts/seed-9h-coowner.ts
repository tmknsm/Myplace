/**
 * Demo data for 51 State Route 9H: Michael's @mtmkns handle, plus Kelsey
 * Tomkins as a co-owner with her own photo and anonymize setting.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-9h-coowner.ts
 */
import { closeSql, getSql } from "../server/src/db.ts";
import { id } from "../server/src/ids.ts";
import { addCoMaintainer } from "../server/src/services/ownership.ts";
import { upsertUser } from "../server/src/auth.ts";
import { DEFAULT_AVATAR_URL } from "../shared/profile.ts";

const PROPERTY_ID = "prop_2512f62f10a418baa7bba3148b";
const MICHAEL_EMAIL = "michaeltomkins@gmail.com";
const KELSEY_EMAIL = "kelsey.tomkins@myplace.local";
const KELSEY_AVATAR_URL =
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=128&h=128&q=80";

async function main() {
  const sql = getSql();
  const property = await sql<{ property_id: string }[]>`
    SELECT property_id FROM properties WHERE property_id = ${PROPERTY_ID}
  `;
  if (!property.length) throw new Error(`Property ${PROPERTY_ID} not found`);

  const [michael] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM users WHERE primary_email = ${MICHAEL_EMAIL}
  `;
  if (!michael) throw new Error(`No account for ${MICHAEL_EMAIL}`);

  await sql`
    UPDATE users
    SET handle = COALESCE(handle, 'mtmkns'),
        first_name = COALESCE(first_name, 'Michael'),
        last_name = COALESCE(last_name, 'Tomkins'),
        display_name = COALESCE(display_name, 'Michael Tomkins'),
        avatar_url = COALESCE(avatar_url, ${DEFAULT_AVATAR_URL})
    WHERE user_id = ${michael.user_id}
  `;
  console.log("michael  @mtmkns");

  const kelsey = await upsertUser(KELSEY_EMAIL, {
    firstName: "Kelsey",
    lastName: "Tomkins",
    handle: "ktmkns",
  });
  await sql`
    UPDATE users
    SET avatar_url = ${KELSEY_AVATAR_URL},
        anonymize = COALESCE(anonymize, false)
    WHERE user_id = ${kelsey.user_id}
  `;
  console.log("kelsey   @ktmkns");

  const already = await sql<{ maintainer_id: string }[]>`
    SELECT maintainer_id FROM property_maintainers
    WHERE property_id = ${PROPERTY_ID} AND user_id = ${kelsey.user_id} AND revoked_at IS NULL
  `;
  if (already[0]) {
    console.log("kelsey   already a maintainer");
    return;
  }

  const invitationId = id("inv");
  await sql`
    INSERT INTO handoff_invitations (invitation_id, property_id, invited_email, invited_by, role)
    VALUES (${invitationId}, ${PROPERTY_ID}, ${KELSEY_EMAIL}, ${michael.user_id}, 'co_owner')
  `;
  await addCoMaintainer({
    propertyId: PROPERTY_ID,
    userId: kelsey.user_id,
    invitationId,
    actorId: michael.user_id,
  });
  console.log("kelsey   co-owner on 51 State Route 9H");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeSql());
