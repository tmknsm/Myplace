import { useCallback, useEffect } from "react";
import { api, type MaintainedProperty } from "./api";
import { useAuth } from "./auth";
import { cachePatch, queryKeys, useCached } from "./query-cache";

/**
 * The houses on the account, shared between the nav badge, the picker on the
 * account page, and the settings page for one house. One cached list; every
 * reader re-renders when any writer patches it.
 */

const FRESH_MS = 30_000;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

export async function loadMyProperties(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < FRESH_MS) return;
  if (!inflight) {
    inflight = api.myProperties().then(() => {
      fetchedAt = Date.now();
    }).finally(() => {
      inflight = null;
    });
  }
  await inflight;
}

export function patchMyProperty(patch: Pick<MaintainedProperty, "property_id"> & Partial<MaintainedProperty>): void {
  cachePatch<MaintainedProperty[]>(queryKeys.meProperties(), (list) => (
    list.map((home) => (home.property_id === patch.property_id ? { ...home, ...patch } : home))
  ));
}

export function unseenTotal(homes: MaintainedProperty[] | undefined): number {
  return (homes ?? []).reduce((sum, home) => sum + (home.unseen ?? 0), 0);
}

/** Cached houses, refreshed when the viewer changes and again when `key` changes (stale after 30s). */
export function useMyProperties(key?: string): { homes: MaintainedProperty[] | undefined; reload: () => Promise<void> } {
  const { user } = useAuth();
  const homes = useCached<MaintainedProperty[]>(queryKeys.meProperties());
  const reload = useCallback(() => loadMyProperties(true), []);
  const missing = homes === undefined;
  useEffect(() => {
    if (!user) return;
    void loadMyProperties(missing).catch(() => {});
  }, [user?.user_id, key]);
  return { homes: user ? homes : undefined, reload };
}

/** The viewer's own record of one house, or null while loading or when it is not theirs. */
export function useMyHome(propertyId: string | undefined): MaintainedProperty | null {
  const { homes } = useMyProperties();
  return homes?.find((home) => home.property_id === propertyId) ?? null;
}

/** The viewer has looked at this house's notifications: clear it locally, then tell the server. */
export function markNotificationsSeen(propertyId: string): void {
  patchMyProperty({ property_id: propertyId, unseen: 0 });
  void api.markInboxSeen(propertyId).catch(() => {});
}
