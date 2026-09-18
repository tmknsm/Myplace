/**
 * Six more confirmed neighbors on 51 State Route 9H. Each dummy owner gets a
 * first + last name, a unique Unsplash face (not a stock default), and their
 * house gets a public Unsplash hero.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-more-neighbors.ts
 */
import { closeSql, getSql } from "../server/src/db.ts";
import { id } from "../server/src/ids.ts";
import { documentKey, putDocument } from "../server/src/services/storage.ts";

const MICHAEL_ID = "usr_01m2fr0mn9k8yvdcy4ckm9dbds";
const HOUSE_51 = "prop_2512f62f10a418baa7bba3148b";

const NEIGHBORS = [
  {
    email: "elena.voss@myplace.local",
    first: "Elena",
    last: "Voss",
    handle: "elenavoss",
    propertyId: "prop_8b3b6c9ff840fef446a4018dae",
    avatar: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=256&h=256&q=80",
    hero: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=2000&q=80",
    filename: "10-warren-unsplash.jpg",
  },
  {
    email: "marcus.hale@myplace.local",
    first: "Marcus",
    last: "Hale",
    handle: "marcushale",
    propertyId: "prop_eac491f3ffe141e1ca3f63ab34",
    avatar: "https://images.unsplash.com/photo-1506277886164-e25aa3f4dd71?auto=format&fit=crop&w=256&h=256&q=80",
    hero: "https://images.unsplash.com/photo-1480074568708-e7b720bb3f09?auto=format&fit=crop&w=2000&q=80",
    filename: "8-union-unsplash.jpg",
  },
  {
    email: "naomi.brooks@myplace.local",
    first: "Naomi",
    last: "Brooks",
    handle: "naomibrooks",
    propertyId: "prop_01c352b9d9db045b5ac515a86f",
    avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=256&h=256&q=80",
    hero: "https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=2000&q=80",
    filename: "5-columbia-unsplash.jpg",
  },
  {
    email: "theo.alvarez@myplace.local",
    first: "Theo",
    last: "Alvarez",
    handle: "theoalvarez",
    propertyId: "prop_489565ce77f9f22a81041da4cc",
    avatar: "https://images.unsplash.com/photo-1463453091185-61582044d556?auto=format&fit=crop&w=256&h=256&q=80",
    hero: "https://images.unsplash.com/photo-1756219833872-c91af1a43b92?auto=format&fit=crop&w=2000&q=80",
    filename: "9-partition-unsplash.jpg",
  },
  {
    email: "iris.chen@myplace.local",
    first: "Iris",
    last: "Chen",
    handle: "irischen",
    propertyId: "prop_883c1f76145bf88ee7d26aed43",
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=256&h=256&q=80",
    hero: "https://images.unsplash.com/photo-1745808930196-e03bf5fe6c02?auto=format&fit=crop&w=2000&q=80",
    filename: "17-allen-unsplash.jpg",
  },
  {
    email: "caleb.morse@myplace.local",
    first: "Caleb",
    last: "Morse",
    handle: "calebmorse",
    propertyId: "prop_1a3e54115c1b03a06e8f2eb9e1",
    avatar: "https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=256&h=256&q=80",
    hero: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=2000&q=80",
    filename: "12-state-unsplash.jpg",
  },
] as const;

async function main() {
  const sql = getSql();
  const [michael] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM users WHERE user_id = ${MICHAEL_ID}
  `;
  if (!michael) throw new Error("Michael is missing");

  for (const neighbor of NEIGHBORS) {
    const [existingUser] = await sql<{ user_id: string }[]>`
      SELECT user_id FROM users WHERE primary_email = ${neighbor.email}
    `;
    const userId = existingUser?.user_id ?? id("usr");
    if (!existingUser) {
      await sql`
        INSERT INTO users (
          user_id, primary_email, email_verified_at, display_name, first_name, last_name,
          handle, avatar_url
        ) VALUES (
          ${userId}, ${neighbor.email}, now(), ${`${neighbor.first} ${neighbor.last}`},
          ${neighbor.first}, ${neighbor.last}, ${neighbor.handle}, ${neighbor.avatar}
        )
      `;
      await sql`
        INSERT INTO user_emails (user_email_id, user_id, email, verified_at)
        VALUES (${id("uem")}, ${userId}, ${neighbor.email}, now())
      `;
      console.log("user", neighbor.handle, userId);
    } else {
      await sql`
        UPDATE users
        SET first_name = ${neighbor.first},
            last_name = ${neighbor.last},
            display_name = ${`${neighbor.first} ${neighbor.last}`},
            handle = COALESCE(handle, ${neighbor.handle}),
            avatar_url = ${neighbor.avatar}
        WHERE user_id = ${userId}
      `;
      console.log("user update", neighbor.handle, userId);
    }

    const [claimed] = await sql<{ user_id: string }[]>`
      SELECT user_id FROM property_maintainers
      WHERE property_id = ${neighbor.propertyId} AND revoked_at IS NULL
      LIMIT 1
    `;
    if (!claimed) {
      await sql`
        INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
        VALUES (${id("mnt")}, ${neighbor.propertyId}, ${userId}, 'owner')
      `;
      console.log("claimed", neighbor.propertyId);
    } else if (claimed.user_id !== userId) {
      throw new Error(`${neighbor.propertyId} is already claimed by ${claimed.user_id}`);
    }

    const [cover] = await sql<{ document_id: string }[]>`
      SELECT document_id FROM documents
      WHERE property_id = ${neighbor.propertyId} AND removed_at IS NULL AND is_cover
      LIMIT 1
    `;
    if (!cover) {
      const res = await fetch(neighbor.hero);
      if (!res.ok) throw new Error(`Unsplash fetch failed (${res.status}) for ${neighbor.hero}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      const documentId = id("doc");
      const key = documentKey(neighbor.propertyId, documentId, neighbor.filename);
      await putDocument(key, bytes);
      await sql`
        INSERT INTO documents (
          document_id, property_id, uploaded_by, storage_key, original_filename,
          mime_type, byte_size, document_type, visibility, transferability, is_cover
        ) VALUES (
          ${documentId}, ${neighbor.propertyId}, ${userId}, ${key}, ${neighbor.filename},
          ${mime}, ${bytes.byteLength}, 'photo', 'public', 'property_transferable', true
        )
      `;
      console.log("cover", neighbor.propertyId, documentId, bytes.byteLength);
    } else {
      console.log("cover exists", neighbor.propertyId, cover.document_id);
    }

    const [open] = await sql<{ request_id: string }[]>`
      SELECT request_id FROM neighbor_requests
      WHERE from_user_id = ${userId}
        AND property_id = ${HOUSE_51}
        AND status IN ('pending', 'accepted')
      LIMIT 1
    `;
    if (!open) {
      await sql`
        INSERT INTO neighbor_requests (
          request_id, from_user_id, to_user_id, property_id, from_property_id, status, decided_at
        ) VALUES (
          ${id("nbr")}, ${userId}, ${MICHAEL_ID}, ${HOUSE_51}, ${neighbor.propertyId}, 'accepted', now()
        )
      `;
      console.log("neighbor", neighbor.handle, "→ 51");
    } else {
      await sql`
        UPDATE neighbor_requests
        SET status = 'accepted',
            decided_at = COALESCE(decided_at, now()),
            from_property_id = ${neighbor.propertyId}
        WHERE request_id = ${open.request_id}
      `;
      console.log("neighbor exists", neighbor.handle, open.request_id);
    }
  }

  const rows = await sql`
    SELECT a.formatted, u.display_name, u.handle
    FROM neighbor_requests r
    JOIN users u ON u.user_id = CASE WHEN r.from_user_id = ${MICHAEL_ID} THEN r.to_user_id ELSE r.from_user_id END
    LEFT JOIN property_addresses a ON a.property_id = CASE WHEN r.from_user_id = ${MICHAEL_ID} THEN r.property_id ELSE r.from_property_id END AND a.is_current
    WHERE r.status = 'accepted'
      AND (r.property_id = ${HOUSE_51} OR r.from_property_id = ${HOUSE_51})
    ORDER BY a.formatted
  `;
  console.log("51 neighbors", rows.length, JSON.stringify(rows, null, 2));
  await closeSql();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
