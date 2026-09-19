import { ownerLabel, ownerPhoto, publicAddress } from "../../../shared/profile.ts";
import { getSql } from "../db.ts";
import { anonymizedOn } from "./neighbors.ts";
import { type PostAuthorRow, type PostRow, type PostView, type StoredDocumentRow, withFileFlags } from "./owner.ts";

export const FEED_PAGE_SIZE = 30;

export type FeedScope = "all" | "neighbors";

export function parseFeedScope(raw: string | undefined | null): FeedScope {
  return raw === "neighbors" ? "neighbors" : "all";
}

/** The house a feed post is from, named the way its owners let it be named. */
export interface FeedHouse {
  property_id: string;
  formatted: string | null;
  municipality: string | null;
  county: string;
  hide_street: boolean;
  photo_url: string | null;
}

export interface FeedPost extends PostView {
  house: FeedHouse;
  /** From one of the viewer's own houses. */
  mine: boolean;
}

export interface Feed {
  posts: FeedPost[];
  /** Pass back as `before` for the next page; null when this is the end. */
  nextBefore: string | null;
  homeCount: number;
  neighborCount: number;
}

interface HouseRow {
  property_id: string;
  mine: boolean;
  formatted: string | null;
  municipality: string | null;
  county: string;
  state: string | null;
  hide_street: boolean;
  document_id: string | null;
  byte_size: number | null;
}

/**
 * The houses whose posts a person sees: the ones they maintain, and every
 * house confirmed as a neighbor of one of those. Neighbors are house to
 * house, the same pairs the property page lists, so co-owners see the same
 * street. Houses taken off Myplace drop out along with their posts.
 */
async function feedHouses(userId: string): Promise<HouseRow[]> {
  const sql = getSql();
  return sql<HouseRow[]>`
    WITH mine AS (
      SELECT m.property_id
      FROM property_maintainers m
      JOIN properties p ON p.property_id = m.property_id
      WHERE m.user_id = ${userId} AND m.revoked_at IS NULL AND NOT p.removed
    ),
    linked AS (
      SELECT CASE WHEN r.property_id IN (SELECT property_id FROM mine) THEN r.from_property_id ELSE r.property_id END AS property_id
      FROM neighbor_requests r
      WHERE r.status = 'accepted'
        AND r.from_property_id IS NOT NULL
        AND (
          r.property_id IN (SELECT property_id FROM mine)
          OR r.from_property_id IN (SELECT property_id FROM mine)
        )
    ),
    houses AS (
      SELECT property_id, TRUE AS mine FROM mine
      UNION
      SELECT DISTINCT property_id, FALSE AS mine
      FROM linked
      WHERE property_id IS NOT NULL AND property_id NOT IN (SELECT property_id FROM mine)
    )
    SELECT
      h.property_id,
      h.mine,
      a.formatted,
      p.municipality,
      p.county,
      p.state,
      EXISTS (
        SELECT 1 FROM property_maintainers m
        WHERE m.property_id = h.property_id AND m.revoked_at IS NULL AND m.hide_street
      ) AS hide_street,
      d.document_id,
      d.byte_size
    FROM houses h
    JOIN properties p ON p.property_id = h.property_id AND NOT p.removed
    LEFT JOIN property_addresses a ON a.property_id = h.property_id AND a.is_current
    LEFT JOIN LATERAL (
      SELECT document_id, byte_size
      FROM documents
      WHERE property_id = h.property_id
        AND removed_at IS NULL
        AND visibility = 'public'
        AND (mime_type LIKE 'image/%' OR document_type = 'photo')
      ORDER BY is_cover DESC, created_at DESC
      LIMIT 1
    ) d ON TRUE
  `;
}

/** House rows for a page of posts: address, cover, hide-street, and whether it is the viewer's. */
async function housesFor(userId: string, propertyIds: string[]): Promise<HouseRow[]> {
  const ids = [...new Set(propertyIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const sql = getSql();
  return sql<HouseRow[]>`
    SELECT
      p.property_id,
      EXISTS (
        SELECT 1 FROM property_maintainers m
        WHERE m.property_id = p.property_id AND m.user_id = ${userId} AND m.revoked_at IS NULL
      ) AS mine,
      a.formatted,
      p.municipality,
      p.county,
      p.state,
      EXISTS (
        SELECT 1 FROM property_maintainers m
        WHERE m.property_id = p.property_id AND m.revoked_at IS NULL AND m.hide_street
      ) AS hide_street,
      d.document_id,
      d.byte_size
    FROM properties p
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    LEFT JOIN LATERAL (
      SELECT document_id, byte_size
      FROM documents
      WHERE property_id = p.property_id
        AND removed_at IS NULL
        AND visibility = 'public'
        AND (mime_type LIKE 'image/%' OR document_type = 'photo')
      ORDER BY is_cover DESC, created_at DESC
      LIMIT 1
    ) d ON TRUE
    WHERE p.property_id IN ${sql(ids)} AND NOT p.removed
  `;
}

function presentHouse(row: HouseRow): FeedHouse {
  const hideStreet = Boolean(row.hide_street);
  return {
    property_id: row.property_id,
    formatted: publicAddress({
      formatted: row.formatted,
      municipality: row.municipality,
      county: row.county,
      state: row.state,
      hideStreet,
    }),
    municipality: row.municipality,
    county: row.county,
    hide_street: hideStreet,
    photo_url: row.document_id ? `/api/documents/${row.document_id}/file?v=${row.byte_size ?? 0}` : null,
  };
}

/**
 * Posts newest first. `all` is everyone on the network; `neighbors` is the
 * houses next to yours (and your own). Posts are public, so the only thing
 * left out is a photo whose file is gone. Each author is named the way that
 * house knows them.
 */
export async function loadFeed(
  userId: string,
  options: { scope?: FeedScope; before?: Date | null; limit?: number } = {},
): Promise<Feed> {
  const scope = options.scope ?? "all";
  const limit = Math.max(1, Math.min(options.limit ?? FEED_PAGE_SIZE, 100));
  const street = await feedHouses(userId);
  const homeCount = street.filter((row) => row.mine).length;
  const neighborCount = street.length - homeCount;
  if (scope === "neighbors" && street.length === 0) {
    return { posts: [], nextBefore: null, homeCount, neighborCount };
  }

  const sql = getSql();
  const houseIds = street.map((row) => row.property_id);
  const rows = await sql<(PostRow & Partial<PostAuthorRow>)[]>`
    SELECT p.post_id, p.property_id, p.created_by, p.body, p.created_at,
           u.user_id, u.display_name, u.first_name, u.last_name, u.handle, u.avatar_url
    FROM property_posts p
    JOIN properties prop ON prop.property_id = p.property_id AND NOT prop.removed
    LEFT JOIN users u ON u.user_id = p.created_by
    WHERE p.removed_at IS NULL
      AND ${scope === "neighbors" ? sql`p.property_id IN ${sql(houseIds)}` : sql`TRUE`}
      AND ${options.before ? sql`p.created_at < ${options.before}` : sql`TRUE`}
    ORDER BY p.created_at DESC, p.post_id DESC
    LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (page.length === 0) return { posts: [], nextBefore: null, homeCount, neighborCount };

  const postIds = page.map((row) => row.post_id);
  const documents = (await withFileFlags(await sql<StoredDocumentRow[]>`
    SELECT document_id, property_id, improvement_id, room_id, topic_id, post_id, original_filename, document_type, mime_type,
           byte_size, visibility, transferability, caption, is_cover, created_at, uploaded_by, storage_key
    FROM documents
    WHERE post_id IN ${sql(postIds)} AND removed_at IS NULL
    ORDER BY created_at
  `)).filter((doc) => doc.has_file);

  // Names follow the house: the same person can be "Sam Ellison" on one
  // page and "@samwrites" on another.
  const authorsByHouse = new Map<string, string[]>();
  for (const row of page) {
    if (!row.user_id) continue;
    const list = authorsByHouse.get(row.property_id) ?? [];
    list.push(row.user_id);
    authorsByHouse.set(row.property_id, list);
  }
  const hiddenByHouse = new Map<string, Map<string, boolean>>();
  await Promise.all([...authorsByHouse].map(async ([propertyId, authors]) => {
    hiddenByHouse.set(propertyId, await anonymizedOn(propertyId, authors));
  }));

  const houses = scope === "neighbors"
    ? street
    : await housesFor(userId, page.map((row) => row.property_id));
  const houseById = new Map(houses.map((row) => [row.property_id, row]));
  const posts: FeedPost[] = [];
  for (const { user_id, display_name, first_name, last_name, handle, avatar_url, ...row } of page) {
    const house = houseById.get(row.property_id);
    if (!house) continue;
    posts.push({
      ...row,
      author: user_id
        ? {
            user_id,
            label: ownerLabel({
              display_name: display_name ?? null,
              first_name: first_name ?? null,
              last_name: last_name ?? null,
              handle: handle ?? null,
              anonymize: hiddenByHouse.get(row.property_id)?.get(user_id) ?? false,
            }),
            photo_url: ownerPhoto({ avatar_url: avatar_url ?? null, user_id }),
          }
        : null,
      documents: documents.filter((doc) => doc.post_id === row.post_id),
      house: presentHouse(house),
      mine: Boolean(house.mine),
    });
  }

  const last = posts[posts.length - 1];
  return {
    posts,
    nextBefore: hasMore && last ? new Date(last.created_at).toISOString() : null,
    homeCount,
    neighborCount,
  };
}
