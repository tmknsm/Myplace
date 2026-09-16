/**
 * Fill the remaining owner-layer fields on 441 Warren Street, the live
 * demonstration page. Chip names (paint, style, trim) are always rewritten
 * so they stay short. Other keys skip if they already have an owner value.
 *
 *   DATABASE_URL=… npx tsx scripts/fill-warren-demo.ts
 */
import { closeSql, getSql } from "../server/src/db.ts";
import { insertAssertion } from "../server/src/services/assertions.ts";
import { DEFAULT_ANONYMOUS_AVATAR_URL, DEFAULT_AVATAR_URL } from "../shared/profile.ts";
import { normalizeRoomDetails } from "../shared/rooms.ts";

const PROPERTY_ID = "prop_76045741fc817ccf3afcfc4c40";

/**
 * Names that sit in the strip under the hero. Keep them short, like 51 State
 * Route 9H (Italianate / OC-131 White Down) — a color or a style, not a sentence.
 * Always rewritten on re-run so a long earlier fill can be shortened.
 */
const CHIP_FIELDS: Record<string, unknown> = {
  "exterior.color": "Hudson brick",
  "exterior.trim": "OC-17 White Dove",
  "exterior.door": "Black",
  "style.architecture": "Federal",
  "paint.notes": "The brick is the body, never painted. Paint is the wood: White Dove on the cornice and sash (2021 restoration), black four-panel stoop door with the original box lock (2023).",
};

/** Missing character fields, plus year/link/notes the topic sheets added. */
const FIELDS: Record<string, unknown> = {
  "exterior.color.hex": "#8a4a32",
  "exterior.trim.hex": "#efeae1",
  "exterior.door.hex": "#1b1b1b",
  "paint.year": 2023,
  "paint.link": "https://www.benjaminmoore.com/en-us/color-overview/find-your-color/color/oc-17/white-dove",

  "house.name": "The Warren Street row",
  "built_by": "Unknown. The 1854 date is from the building file, not a builder's name on the deed.",
  "original_details": "6-over-6 sash on Warren Street, the parlor mantel, the stair newel, the cellar fireplace, wide-board floors on the third floor",
  "style.link": "https://en.wikipedia.org/wiki/Hudson_Historic_District_(New_York)",

  "interior.floors": "Heart pine in the parlor, painted pine on three, tile in the kitchen addition",
  "interior.kitchen": "Soapstone counters, inset painted cabinets, induction range facing the garden",
  "interior.hardware": "Unlacquered brass; restored box lock on the stoop door",
  "interior.palette": "Warm plaster whites, one dark green parlor, natural brick where it was never plastered",
  "interior.year": 2023,

  "garden": "Brick-walled garden off the kitchen. Peonies along the wall, a fig that barely makes it through winter, gravel to the alley.",
  "exterior.siding": "Hudson brick, common wall, painted wood cornice",
  "roof.link": "https://en.wikipedia.org/wiki/Standing_seam_roof",
  "interior.link": "https://www.rejuvenation.com/",

  "cooling.year": 2021,
  "electrical.year": 2019,
  "envelope.year": 2021,
  "water.link": "https://www.navieninc.com/products/npe-240s2",
  "hvac.link": "https://www.weil-mclain.com/",
};

async function main() {
  const sql = getSql();
  const property = await sql<{ property_id: string }[]>`
    SELECT property_id FROM properties WHERE property_id = ${PROPERTY_ID}
  `;
  if (!property.length) throw new Error(`Property ${PROPERTY_ID} not found`);

  const [owner] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM property_maintainers
    WHERE property_id = ${PROPERTY_ID} AND role IN ('owner', 'co_owner') AND revoked_at IS NULL
    ORDER BY verified_at ASC NULLS LAST
    LIMIT 1
  `;
  if (!owner) throw new Error(`No owner on ${PROPERTY_ID}`);

  await sql`
    UPDATE users
    SET handle = COALESCE(handle, 'samellison'),
        avatar_url = COALESCE(avatar_url, ${DEFAULT_AVATAR_URL}),
        anonymous_avatar_url = COALESCE(anonymous_avatar_url, ${DEFAULT_ANONYMOUS_AVATAR_URL})
    WHERE user_id = ${owner.user_id}
  `;
  console.log("owner profile  handle + avatars");

  const existing = await sql<{ field_key: string }[]>`
    SELECT field_key FROM assertions
    WHERE property_id = ${PROPERTY_ID}
      AND source_type = 'verified_owner'
      AND status = 'accepted'
  `;
  const have = new Set(existing.map((row) => row.field_key));

  let written = 0;
  for (const [fieldKey, value] of Object.entries(CHIP_FIELDS)) {
    await insertAssertion({
      propertyId: PROPERTY_ID,
      fieldKey,
      value,
      sourceType: "verified_owner",
      visibility: "public",
      actorType: "verified_owner",
      actorId: owner.user_id,
      eventType: "owner_assertion.added",
    });
    written += 1;
    console.log(`chip  ${fieldKey}`);
  }
  for (const [fieldKey, value] of Object.entries(FIELDS)) {
    if (have.has(fieldKey)) {
      console.log(`skip  ${fieldKey}`);
      continue;
    }
    await insertAssertion({
      propertyId: PROPERTY_ID,
      fieldKey,
      value,
      sourceType: "verified_owner",
      visibility: "public",
      actorType: "verified_owner",
      actorId: owner.user_id,
      eventType: "owner_assertion.added",
    });
    written += 1;
    console.log(`write ${fieldKey}`);
  }
  console.log(`done. wrote ${written}, skipped ${Object.keys(FIELDS).length - written}`);

  const existingRooms = await sql<{ room_id: string }[]>`
    SELECT room_id FROM property_rooms
    WHERE property_id = ${PROPERTY_ID} AND removed_at IS NULL
  `;
  const DESCRIPTIONS: Record<string, string> = {
    room_warren_kitchen: "The kitchen sits in the later addition off the brick-walled garden.",
    room_warren_parlor: "Heart pine, one dark green parlor, natural brick where it was never plastered.",
  };
  if (existingRooms.length) {
    for (const [roomId, description] of Object.entries(DESCRIPTIONS)) {
      const updated = await sql`
        UPDATE property_rooms
        SET description = COALESCE(NULLIF(description, ''), ${description}), title = NULL
        WHERE room_id = ${roomId} AND property_id = ${PROPERTY_ID} AND removed_at IS NULL
      `;
      console.log(`room  ${roomId} ${updated.count ? "updated" : "skip"}`);
    }
  } else {
    const rooms: Array<{ room_id: string; kind: string; description: string | null; details: Record<string, string> }> = [
      {
        room_id: "room_warren_kitchen",
        kind: "kitchen",
        description: "The kitchen sits in the later addition off the brick-walled garden.",
        details: normalizeRoomDetails("kitchen", {
          cabinetry: "Inset painted cabinets, garden-facing",
          counters: "Soapstone",
          appliances: "Induction range facing the garden",
          flooring: "Tile in the kitchen addition",
          fixtures: "Unlacquered brass",
          paint: "Warm plaster whites",
        }),
      },
      {
        room_id: "room_warren_parlor",
        kind: "living_room",
        description: "Heart pine, one dark green parlor, natural brick where it was never plastered.",
        details: normalizeRoomDetails("living_room", {
          flooring: "Heart pine",
          paint: "One dark green parlor",
          fireplace: "Original parlor mantel, working",
        }),
      },
    ];
    for (const room of rooms) {
      await sql`
        INSERT INTO property_rooms (room_id, property_id, created_by, kind, description, details, visibility)
        VALUES (
          ${room.room_id}, ${PROPERTY_ID}, ${owner.user_id}, ${room.kind}, ${room.description},
          ${sql.json(room.details)}, 'public'
        )
        ON CONFLICT (room_id) DO NOTHING
      `;
      console.log(`room  ${room.kind}`);
    }
  }

  await closeSql();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
