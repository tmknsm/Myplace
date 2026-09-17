import { ownerLabel, ownerPhoto } from "../../../shared/profile.ts";
import { getSql } from "../db.ts";
import { id } from "../ids.ts";
import { isMaintainer } from "../auth.ts";

export const COMMENT_MAX = 600;

export interface Engagement {
  likes: number;
  comments: number;
  shares: number;
  liked: boolean;
}

export interface PhotoComment {
  comment_id: string;
  body: string;
  created_at: string;
  mine: boolean;
  author: { user_id: string; label: string; photo_url: string };
}

interface CommentRow {
  comment_id: string;
  body: string;
  created_at: string;
  user_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  handle: string | null;
  anonymize: boolean;
  avatar_url: string | null;
}

/**
 * A photo can be read by whoever can see it on the property page: everyone
 * for public photos, maintainers (and the uploader / admins) otherwise.
 */
export async function canSeeDocument(
  documentId: string,
  viewer: { user_id: string; is_admin?: boolean } | null,
): Promise<{ property_id: string } | null> {
  const sql = getSql();
  const rows = await sql<{ property_id: string; claim_id: string | null; uploaded_by: string | null; visibility: string }[]>`
    SELECT property_id, claim_id, uploaded_by, visibility
    FROM documents WHERE document_id = ${documentId} AND removed_at IS NULL
  `;
  const doc = rows[0];
  if (!doc) return null;
  if (doc.visibility === "public" && !doc.claim_id) return { property_id: doc.property_id };
  if (!viewer) return null;
  const allowed = viewer.is_admin || doc.uploaded_by === viewer.user_id || await isMaintainer(viewer.user_id, doc.property_id);
  return allowed ? { property_id: doc.property_id } : null;
}

export async function loadEngagement(documentId: string, viewerId: string | null): Promise<Engagement> {
  const sql = getSql();
  const rows = await sql<{ likes: string; comments: string; shares: number; liked: boolean }[]>`
    SELECT
      (SELECT count(*) FROM document_likes WHERE document_id = d.document_id) AS likes,
      (SELECT count(*) FROM document_comments WHERE document_id = d.document_id AND removed_at IS NULL) AS comments,
      d.share_count AS shares,
      ${viewerId
        ? sql`EXISTS (SELECT 1 FROM document_likes WHERE document_id = d.document_id AND user_id = ${viewerId})`
        : sql`FALSE`} AS liked
    FROM documents d WHERE d.document_id = ${documentId}
  `;
  const row = rows[0];
  return {
    likes: Number(row?.likes ?? 0),
    comments: Number(row?.comments ?? 0),
    shares: Number(row?.shares ?? 0),
    liked: Boolean(row?.liked),
  };
}

/** Flip the viewer's like on a photo. Returns the new state and tally. */
export async function toggleLike(documentId: string, userId: string): Promise<{ liked: boolean; likes: number }> {
  const sql = getSql();
  const removed = await sql`DELETE FROM document_likes WHERE document_id = ${documentId} AND user_id = ${userId}`;
  const liked = removed.count === 0;
  if (liked) {
    await sql`INSERT INTO document_likes (document_id, user_id) VALUES (${documentId}, ${userId}) ON CONFLICT DO NOTHING`;
  }
  const [row] = await sql<{ likes: string }[]>`SELECT count(*) AS likes FROM document_likes WHERE document_id = ${documentId}`;
  return { liked, likes: Number(row?.likes ?? 0) };
}

export async function recordShare(documentId: string): Promise<{ shares: number }> {
  const sql = getSql();
  const [row] = await sql<{ share_count: number }[]>`
    UPDATE documents SET share_count = share_count + 1 WHERE document_id = ${documentId} RETURNING share_count
  `;
  return { shares: Number(row?.share_count ?? 0) };
}

function presentComment(row: CommentRow, viewerId: string | null): PhotoComment {
  const anonymize = Boolean(row.anonymize);
  return {
    comment_id: row.comment_id,
    body: row.body,
    created_at: row.created_at,
    mine: row.user_id === viewerId,
    author: {
      user_id: row.user_id,
      label: ownerLabel({ ...row, anonymize }),
      photo_url: ownerPhoto(row),
    },
  };
}

export async function loadComments(documentId: string, viewerId: string | null): Promise<PhotoComment[]> {
  const sql = getSql();
  const rows = await sql<CommentRow[]>`
    SELECT c.comment_id, c.body, c.created_at, u.user_id,
           u.display_name, u.first_name, u.last_name, u.handle, u.anonymize, u.avatar_url
    FROM document_comments c
    JOIN users u ON u.user_id = c.user_id
    WHERE c.document_id = ${documentId} AND c.removed_at IS NULL
    ORDER BY c.created_at ASC
  `;
  return rows.map((row) => presentComment(row, viewerId));
}

export async function addComment(
  documentId: string,
  userId: string,
  rawBody: string,
): Promise<{ comment: PhotoComment } | { error: string }> {
  const body = rawBody.replace(/\s+/g, " ").trim();
  if (!body) return { error: "Write something first." };
  if (body.length > COMMENT_MAX) return { error: `Keep it under ${COMMENT_MAX} characters.` };
  const sql = getSql();
  const commentId = id("cmt");
  await sql`
    INSERT INTO document_comments (comment_id, document_id, user_id, body)
    VALUES (${commentId}, ${documentId}, ${userId}, ${body})
  `;
  const rows = await sql<CommentRow[]>`
    SELECT c.comment_id, c.body, c.created_at, u.user_id,
           u.display_name, u.first_name, u.last_name, u.handle, u.anonymize, u.avatar_url
    FROM document_comments c JOIN users u ON u.user_id = c.user_id
    WHERE c.comment_id = ${commentId}
  `;
  const row = rows[0];
  if (!row) return { error: "Couldn't save that comment." };
  return { comment: presentComment(row, userId) };
}

/** The author or a maintainer of the property can take a comment down. */
export async function removeComment(
  commentId: string,
  user: { user_id: string; is_admin?: boolean },
): Promise<{ ok: true } | { error: string; status: 403 | 404 }> {
  const sql = getSql();
  const rows = await sql<{ user_id: string; property_id: string }[]>`
    SELECT c.user_id, d.property_id
    FROM document_comments c JOIN documents d ON d.document_id = c.document_id
    WHERE c.comment_id = ${commentId} AND c.removed_at IS NULL
  `;
  const row = rows[0];
  if (!row) return { error: "Not found", status: 404 };
  const allowed = user.is_admin || row.user_id === user.user_id || await isMaintainer(user.user_id, row.property_id);
  if (!allowed) return { error: "Forbidden", status: 403 };
  await sql`UPDATE document_comments SET removed_at = now() WHERE comment_id = ${commentId}`;
  return { ok: true };
}
