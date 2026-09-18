/**
 * Three public posts for Sam Ellison on 441 Warren Street, with Unsplash
 * photos. Idempotent: a matching caption is left alone on re-run.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-sam-posts.ts
 */
import { closeSql, getSql } from "../server/src/db.ts";
import { id } from "../server/src/ids.ts";
import { emitEvent } from "../server/src/services/events.ts";
import { documentKey, putDocument } from "../server/src/services/storage.ts";

const PROPERTY_ID = "prop_76045741fc817ccf3afcfc4c40";
const OWNER_ID = "usr_01M2MV15X74K4A9DVK5GQ1ZERN";

const POSTS = [
  {
    body: "First real leaf-fall on the street. The brick holds the weather better than we do. We painted the stoop door black last year and left everything else.",
    daysAgo: 3,
    photos: [
      {
        filename: "warren-brick.jpg",
        url: "https://images.unsplash.com/photo-1608845920884-3c88800feebc?auto=format&fit=crop&w=2000&q=80",
      },
    ],
  },
  {
    body: "The 2023 kitchen. Painted cabinets, a counter we can actually work on, the range facing the garden. Still getting used to how quiet the cooktop is.",
    daysAgo: 18,
    photos: [
      {
        filename: "kitchen-island.jpg",
        url: "https://images.unsplash.com/photo-1556912173-46c336c7fd55?auto=format&fit=crop&w=2000&q=80",
      },
      {
        filename: "kitchen-range.jpg",
        url: "https://images.unsplash.com/photo-1556912172-45b7abe8b7e1?auto=format&fit=crop&w=2000&q=80",
      },
    ],
  },
  {
    body: "The fig made it through another winter. Chard in the bed against the wall, a table we actually sit at from May to October. This is the room we live in.",
    daysAgo: 41,
    photos: [
      {
        filename: "garden-table.jpg",
        url: "https://images.unsplash.com/photo-1762461838534-ca26dfa134a8?auto=format&fit=crop&w=2000&q=80",
      },
      {
        filename: "garden-bed.jpg",
        url: "https://images.unsplash.com/photo-1584479898061-15742e14f50d?auto=format&fit=crop&w=2000&q=80",
      },
    ],
  },
] as const;

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
    SELECT property_id FROM properties WHERE property_id = ${PROPERTY_ID}
  `;
  if (!property) throw new Error(`Property ${PROPERTY_ID} not found`);

  for (const post of POSTS) {
    const already = await sql<{ post_id: string }[]>`
      SELECT post_id FROM property_posts
      WHERE property_id = ${PROPERTY_ID} AND removed_at IS NULL AND body = ${post.body}
      LIMIT 1
    `;
    if (already[0]) {
      console.log("skip ", already[0].post_id);
      continue;
    }

    const createdAt = new Date(Date.now() - post.daysAgo * 24 * 60 * 60 * 1000);
    const postId = id("post");
    await sql`
      INSERT INTO property_posts (post_id, property_id, created_by, body, created_at)
      VALUES (${postId}, ${PROPERTY_ID}, ${OWNER_ID}, ${post.body}, ${createdAt})
    `;

    for (const [index, photo] of post.photos.entries()) {
      const { bytes, mime } = await fetchPhoto(photo.url);
      const documentId = id("doc");
      const key = documentKey(PROPERTY_ID, documentId, photo.filename);
      await putDocument(key, bytes);
      const takenAt = new Date(createdAt.getTime() + (index + 1) * 1000);
      await sql`
        INSERT INTO documents (
          document_id, property_id, post_id, uploaded_by, storage_key, original_filename,
          mime_type, byte_size, document_type, visibility, transferability, created_at
        ) VALUES (
          ${documentId}, ${PROPERTY_ID}, ${postId}, ${OWNER_ID}, ${key}, ${photo.filename},
          ${mime}, ${bytes.byteLength}, 'photo', 'public', 'property_transferable', ${takenAt}
        )
      `;
      console.log("photo", documentId, photo.filename, mime, bytes.byteLength);
    }

    await emitEvent({
      propertyId: PROPERTY_ID,
      eventType: "post.added",
      actorType: "verified_owner",
      actorId: OWNER_ID,
      payload: { post_id: postId },
      effectiveAt: createdAt,
    });
    console.log("post ", postId, `${post.photos.length} photos`, createdAt.toISOString());
  }

  await closeSql();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
