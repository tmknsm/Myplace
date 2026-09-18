import type postgres from "postgres";
import { formatHandle, ownerLabel, ownerPhoto } from "../../../shared/profile.ts";
import { getSql } from "../db.ts";
import { id } from "../ids.ts";
import { isMaintainer } from "../auth.ts";
import { anonymizedOn, neighborHouseForPeople } from "./neighbors.ts";

export const COMMENT_MAX = 600;

export interface Engagement {
  likes: number;
  comments: number;
  shares: number;
  liked: boolean;
}

export interface PhotoPerson {
  user_id: string;
  label: string;
  handle: string | null;
  photo_url: string;
  /** The house they are neighbors with this photo's property through. */
  property_id: string | null;
}

export interface PhotoComment {
  comment_id: string;
  body: string;
  created_at: string;
  mine: boolean;
  likes: number;
  liked: boolean;
  author: PhotoPerson;
}

/** The post behind the comments: who put the photo up, what they said, when. */
export interface PhotoPost {
  document_id: string;
  caption: string | null;
  created_at: string;
  author: PhotoPerson | null;
}

interface PersonRow {
  user_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  handle: string | null;
  avatar_url: string | null;
}

interface CommentRow extends PersonRow {
  comment_id: string;
  body: string;
  created_at: string;
  likes: string | number;
  liked: boolean;
}

function presentPerson(row: PersonRow, anonymize: boolean): PhotoPerson {
  const label = ownerLabel({ ...row, anonymize });
  const handle = formatHandle(row.handle);
  return {
    user_id: row.user_id,
    label,
    // When the label already is the handle there is nothing to add under it.
    handle: handle && handle !== label ? handle : null,
    photo_url: ownerPhoto(row),
    property_id: null,
  };
}

/**
 * Comments as people. Each author is named the way the photo's house knows
 * them: their own setting there, or the setting on the house they neighbor
 * it through.
 */
async function presentComments(documentId: string, rows: CommentRow[], viewerId: string | null): Promise<PhotoComment[]> {
  const sql = getSql();
  const [doc] = await sql<{ property_id: string }[]>`
    SELECT property_id FROM documents WHERE document_id = ${documentId} AND removed_at IS NULL
  `;
  const ids = rows.map((row) => row.user_id);
  const houses = doc ? await neighborHouseForPeople(doc.property_id, ids) : new Map<string, string>();
  const hidden = doc ? await anonymizedOn(doc.property_id, ids, houses) : new Map<string, boolean>();
  return rows.map((row) => {
    const comment = presentComment(row, viewerId, hidden.get(row.user_id) ?? false);
    const propertyId = houses.get(row.user_id);
    return propertyId ? { ...comment, author: { ...comment.author, property_id: propertyId } } : comment;
  });
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

function presentComment(row: CommentRow, viewerId: string | null, anonymize: boolean): PhotoComment {
  return {
    comment_id: row.comment_id,
    body: row.body,
    created_at: row.created_at,
    mine: row.user_id === viewerId,
    likes: Number(row.likes ?? 0),
    liked: Boolean(row.liked),
    author: presentPerson(row, anonymize),
  };
}

function commentRows(where: postgres.Fragment, viewerId: string | null) {
  const sql = getSql();
  return sql<CommentRow[]>`
    SELECT c.comment_id, c.body, c.created_at, u.user_id,
           u.display_name, u.first_name, u.last_name, u.handle, u.avatar_url,
           (SELECT count(*) FROM document_comment_likes l WHERE l.comment_id = c.comment_id) AS likes,
           ${viewerId
             ? sql`EXISTS (SELECT 1 FROM document_comment_likes l WHERE l.comment_id = c.comment_id AND l.user_id = ${viewerId})`
             : sql`FALSE`} AS liked
    FROM document_comments c
    JOIN users u ON u.user_id = c.user_id
    WHERE ${where} AND c.removed_at IS NULL
    ORDER BY c.created_at ASC
  `;
}

export async function loadComments(documentId: string, viewerId: string | null): Promise<PhotoComment[]> {
  const sql = getSql();
  const rows = await commentRows(sql`c.document_id = ${documentId}`, viewerId);
  return presentComments(documentId, rows, viewerId);
}

/**
 * The photo as a post. The uploader is the author; older photos without one
 * fall back to whoever has maintained the house longest.
 */
export async function loadPhotoPost(documentId: string): Promise<PhotoPost | null> {
  const sql = getSql();
  const rows = await sql<(Partial<PersonRow> & { document_id: string; property_id: string; caption: string | null; created_at: string })[]>`
    SELECT d.document_id, d.property_id, d.caption, d.created_at,
           u.user_id, u.display_name, u.first_name, u.last_name, u.handle, u.avatar_url
    FROM documents d
    LEFT JOIN users u ON u.user_id = COALESCE(
      d.uploaded_by,
      (SELECT m.user_id FROM property_maintainers m
       WHERE m.property_id = d.property_id AND m.revoked_at IS NULL
       ORDER BY m.verified_at ASC LIMIT 1)
    )
    WHERE d.document_id = ${documentId} AND d.removed_at IS NULL
  `;
  const row = rows[0];
  if (!row) return null;
  const hidden = row.user_id ? await anonymizedOn(row.property_id, [row.user_id]) : new Map<string, boolean>();
  return {
    document_id: row.document_id,
    caption: row.caption,
    created_at: row.created_at,
    author: row.user_id
      ? presentPerson({
        user_id: row.user_id,
        display_name: row.display_name ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        handle: row.handle ?? null,
        avatar_url: row.avatar_url ?? null,
      }, hidden.get(row.user_id) ?? false)
      : null,
  };
}

/** Flip the viewer's like on a comment. 404 when the comment is gone. */
export async function toggleCommentLike(
  commentId: string,
  userId: string,
): Promise<{ liked: boolean; likes: number } | { error: string; status: 404 }> {
  const sql = getSql();
  const exists = await sql`SELECT 1 FROM document_comments WHERE comment_id = ${commentId} AND removed_at IS NULL`;
  if (exists.length === 0) return { error: "Not found", status: 404 };
  const removed = await sql`DELETE FROM document_comment_likes WHERE comment_id = ${commentId} AND user_id = ${userId}`;
  const liked = removed.count === 0;
  if (liked) {
    await sql`INSERT INTO document_comment_likes (comment_id, user_id) VALUES (${commentId}, ${userId}) ON CONFLICT DO NOTHING`;
  }
  const [row] = await sql<{ likes: string }[]>`SELECT count(*) AS likes FROM document_comment_likes WHERE comment_id = ${commentId}`;
  return { liked, likes: Number(row?.likes ?? 0) };
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
  const rows = await commentRows(sql`c.comment_id = ${commentId}`, userId);
  const row = rows[0];
  if (!row) return { error: "Couldn't save that comment." };
  const [comment] = await presentComments(documentId, [row], userId);
  return { comment: comment ?? presentComment(row, userId, false) };
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
