/**
 * One claimed house that is nobody's neighbor, with a named owner and a
 * public post, so the All feed has someone off your street.
 *
 * Idempotent on email / caption.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-network-post.ts
 */
import { closeSql, getSql } from "../server/src/db.ts";
import { id } from "../server/src/ids.ts";
import { emitEvent } from "../server/src/services/events.ts";
import { documentKey, putDocument } from "../server/src/services/storage.ts";

const PROPERTY_ID = "prop_fbac21f413a1d295c4e087f161"; // 101 Warren Street, Hudson
const EMAIL = "lila.quinn@myplace.local";
const FIRST = "Lila";
const LAST = "Quinn";
const HANDLE = "lilaquinn";
const AVATAR = "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=256&h=256&q=80";
const HERO = {
  filename: "101-warren-unsplash.jpg",
  url: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=2000&q=80",
};
const POST = {
  body: "Sunday on the stoop. The whole street smells like someone is roasting something they won't share.",
  daysAgo: 1,
  photos: [
    {
      filename: "stoop.jpg",
      url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=2000&q=80",
    },
  ],
};

async function fetchPhoto(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url, { headers: { "user-agent": "Myplace/1.0 (demo seed)" } });
  if (!res.ok) throw new Error(`Unsplash fetch failed (${res.status}) for ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 8_000) throw new Error(`Unsplash photo too small (${bytes.byteLength}) for ${url}`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { bytes, mime };
}

async function main() {
  const sql = getSql();
  const [property] = await sql<{ property_id: string }[]>`
    SELECT property_id FROM properties WHERE property_id = ${PROPERTY_ID} AND NOT removed
  `;
  if (!property) throw new Error(`Property ${PROPERTY_ID} not found`);

  const [existingUser] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM users WHERE primary_email = ${EMAIL}
  `;
  const userId = existingUser?.user_id ?? id("usr");
  if (!existingUser) {
    await sql`
      INSERT INTO users (
        user_id, primary_email, email_verified_at, display_name, first_name, last_name, handle, avatar_url
      ) VALUES (
        ${userId}, ${EMAIL}, now(), ${`${FIRST} ${LAST}`}, ${FIRST}, ${LAST}, ${HANDLE}, ${AVATAR}
      )
    `;
    await sql`
      INSERT INTO user_emails (user_email_id, user_id, email, verified_at)
      VALUES (${id("uem")}, ${userId}, ${EMAIL}, now())
    `;
    console.log("user", HANDLE, userId);
  } else {
    await sql`
      UPDATE users
      SET first_name = ${FIRST}, last_name = ${LAST}, display_name = ${`${FIRST} ${LAST}`},
          handle = COALESCE(handle, ${HANDLE}), avatar_url = ${AVATAR}
      WHERE user_id = ${userId}
    `;
    console.log("user update", HANDLE, userId);
  }

  const [claimed] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM property_maintainers
    WHERE property_id = ${PROPERTY_ID} AND revoked_at IS NULL
    LIMIT 1
  `;
  if (!claimed) {
    await sql`
      INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
      VALUES (${id("mnt")}, ${PROPERTY_ID}, ${userId}, 'owner')
    `;
    console.log("claimed", PROPERTY_ID);
  } else if (claimed.user_id !== userId) {
    throw new Error(`${PROPERTY_ID} is already claimed by ${claimed.user_id}`);
  }

  const [linked] = await sql<{ request_id: string }[]>`
    SELECT request_id FROM neighbor_requests
    WHERE status IN ('pending', 'accepted')
      AND (property_id = ${PROPERTY_ID} OR from_property_id = ${PROPERTY_ID})
    LIMIT 1
  `;
  if (linked) throw new Error(`${PROPERTY_ID} is already in a neighbor pair (${linked.request_id})`);

  const [cover] = await sql<{ document_id: string }[]>`
    SELECT document_id FROM documents
    WHERE property_id = ${PROPERTY_ID} AND removed_at IS NULL AND is_cover
    LIMIT 1
  `;
  if (!cover) {
    const { bytes, mime } = await fetchPhoto(HERO.url);
    const documentId = id("doc");
    const key = documentKey(PROPERTY_ID, documentId, HERO.filename);
    await putDocument(key, bytes);
    await sql`
      INSERT INTO documents (
        document_id, property_id, uploaded_by, storage_key, original_filename,
        mime_type, byte_size, document_type, visibility, transferability, is_cover
      ) VALUES (
        ${documentId}, ${PROPERTY_ID}, ${userId}, ${key}, ${HERO.filename},
        ${mime}, ${bytes.byteLength}, 'photo', 'public', 'property_transferable', true
      )
    `;
    console.log("cover", documentId, bytes.byteLength);
  }

  const [already] = await sql<{ post_id: string }[]>`
    SELECT post_id FROM property_posts
    WHERE property_id = ${PROPERTY_ID} AND removed_at IS NULL AND body = ${POST.body}
    LIMIT 1
  `;
  if (already) {
    console.log("skip post", already.post_id);
  } else {
    const createdAt = new Date(Date.now() - POST.daysAgo * 24 * 60 * 60 * 1000);
    const postId = id("post");
    await sql`
      INSERT INTO property_posts (post_id, property_id, created_by, body, created_at)
      VALUES (${postId}, ${PROPERTY_ID}, ${userId}, ${POST.body}, ${createdAt})
    `;
    for (const [index, photo] of POST.photos.entries()) {
      const { bytes, mime } = await fetchPhoto(photo.url);
      const documentId = id("doc");
      const key = documentKey(PROPERTY_ID, documentId, photo.filename);
      await putDocument(key, bytes);
      await sql`
        INSERT INTO documents (
          document_id, property_id, post_id, uploaded_by, storage_key, original_filename,
          mime_type, byte_size, document_type, visibility, transferability, created_at
        ) VALUES (
          ${documentId}, ${PROPERTY_ID}, ${postId}, ${userId}, ${key}, ${photo.filename},
          ${mime}, ${bytes.byteLength}, 'photo', 'public', 'property_transferable',
          ${new Date(createdAt.getTime() + (index + 1) * 1000)}
        )
      `;
      console.log("photo", documentId, photo.filename, bytes.byteLength);
    }
    await emitEvent({
      propertyId: PROPERTY_ID,
      eventType: "post.added",
      actorType: "verified_owner",
      actorId: userId,
      payload: { post_id: postId },
      effectiveAt: createdAt,
    });
    console.log("post", postId, createdAt.toISOString());
  }

  await closeSql();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
