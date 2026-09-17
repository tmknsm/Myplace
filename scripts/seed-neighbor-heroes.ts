/**
 * Give the demo neighbor houses (134 Warren, 39 Columbia) a public Unsplash
 * hero so the profile Neighbors list can show a house photo, not a face.
 *
 *   DATABASE_URL=… npx tsx scripts/seed-neighbor-heroes.ts
 */
import { closeSql, getSql } from "../server/src/db.ts";
import { id } from "../server/src/ids.ts";
import { documentKey, putDocument } from "../server/src/services/storage.ts";

const HOUSES = [
  {
    propertyId: "prop_81446e34a781eac193621954e5",
    ownerId: "usr_01M2QJ0HQKRPRNGD682XH91HJG",
    filename: "134-warren-unsplash.jpg",
    url: "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=2000&q=80",
  },
  {
    propertyId: "prop_8ae79c43a2b364fb5a9643ffd3",
    ownerId: "usr_01M2QJ0HDBJJH5VY13Q2FKZ7D0",
    filename: "39-columbia-unsplash.jpg",
    url: "https://images.unsplash.com/photo-1759340643095-e06b6d5645bf?auto=format&fit=crop&w=2000&q=80",
  },
] as const;

async function main() {
  const sql = getSql();
  for (const house of HOUSES) {
    const existing = await sql<{ document_id: string }[]>`
      SELECT document_id FROM documents
      WHERE property_id = ${house.propertyId}
        AND removed_at IS NULL
        AND is_cover
      LIMIT 1
    `;
    if (existing[0]) {
      console.log("skip  already has a cover", house.propertyId, existing[0].document_id);
      continue;
    }

    const res = await fetch(house.url);
    if (!res.ok) throw new Error(`Unsplash fetch failed (${res.status}) for ${house.url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const documentId = id("doc");
    const key = documentKey(house.propertyId, documentId, house.filename);
    await putDocument(key, bytes);
    await sql`
      INSERT INTO documents (
        document_id, property_id, uploaded_by, storage_key, original_filename,
        mime_type, byte_size, document_type, visibility, transferability, is_cover
      ) VALUES (
        ${documentId}, ${house.propertyId}, ${house.ownerId}, ${key}, ${house.filename},
        ${mime}, ${bytes.byteLength}, 'photo', 'public', 'property_transferable', true
      )
    `;
    console.log("cover", house.propertyId, documentId, mime, bytes.byteLength, key);
  }
  await closeSql();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
