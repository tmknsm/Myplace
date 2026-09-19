import type { Doc, NeighborPerson, PageRefresh, PropertyPage, Viewer } from "./api";
import { cacheGet, cacheSet, queryKeys } from "./query-cache";

export type PageData = { property: PropertyPage; viewer: Viewer };

export type NeighborList = { incoming: NeighborPerson[]; outgoing: NeighborPerson[]; neighbors: NeighborPerson[] };

export function peekProperty(id: string | undefined): PageData | null {
  return id ? cacheGet<PageData>(queryKeys.property(id)) ?? null : null;
}

export function peekNeighbors(id: string | undefined): NeighborList | null {
  return id ? cacheGet<NeighborList>(queryKeys.neighbors(id)) ?? null : null;
}

export function rememberProperty(id: string, data: PageData): PageData {
  return cacheSet(queryKeys.property(id), data);
}

export function applyPropertyPatch(
  id: string | undefined,
  current: PageData | null,
  patch: (property: PropertyPage) => PropertyPage,
): PageData | null {
  if (!current) return current;
  const next = { ...current, property: patch(current.property) };
  if (id) rememberProperty(id, next);
  return next;
}

/** Apply a local property patch and skip the spinner-causing reload. */
export function liveRefresh(
  id: string | undefined,
  setData: (update: (current: PageData | null) => PageData | null) => void,
  load: () => Promise<void>,
): PageRefresh {
  return (patch) => {
    if (patch) {
      setData((current) => applyPropertyPatch(id, current, patch));
      return;
    }
    return load();
  };
}

export function mapDocument(page: PropertyPage, documentId: string, fields: Partial<Doc>): PropertyPage {
  return {
    ...page,
    documents: page.documents.map((doc) => (doc.document_id === documentId ? { ...doc, ...fields } : doc)),
  };
}

export function dropDocument(page: PropertyPage, documentId: string): PropertyPage {
  return { ...page, documents: page.documents.filter((doc) => doc.document_id !== documentId) };
}

export function restoreDocument(page: PropertyPage, doc: Doc): PropertyPage {
  if (page.documents.some((row) => row.document_id === doc.document_id)) return page;
  return { ...page, documents: [...page.documents, doc] };
}
