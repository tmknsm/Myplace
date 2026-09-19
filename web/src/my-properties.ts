import { useCallback, useEffect } from "react";
import { api, type Claim, type MaintainedProperty } from "./api";
import { useAuth } from "./auth";
import { cachePatch, queryKeys, useCached } from "./query-cache";

/**
 * The houses on the account, shared between the nav badge, the picker on the
 * account page, and the settings page for one house. One cached list; every
 * reader re-renders when any writer patches it. Claims waiting on a postcard
 * ride alongside as houses-in-waiting: they get a chip and a notice too.
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

let claimsFetchedAt = 0;
let claimsInflight: Promise<void> | null = null;

export async function loadMyClaims(force = false): Promise<void> {
  if (!force && Date.now() - claimsFetchedAt < FRESH_MS) return;
  if (!claimsInflight) {
    claimsInflight = api.myClaims().then(() => {
      claimsFetchedAt = Date.now();
    }).finally(() => {
      claimsInflight = null;
    });
  }
  await claimsInflight;
}

export function patchMyProperty(patch: Pick<MaintainedProperty, "property_id"> & Partial<MaintainedProperty>): void {
  cachePatch<MaintainedProperty[]>(queryKeys.meProperties(), (list) => (
    list.map((home) => (home.property_id === patch.property_id ? { ...home, ...patch } : home))
  ));
}

/** Claims still waiting on the code from the postcard. */
export function pendingClaims(claims: Claim[] | undefined): Claim[] {
  return (claims ?? []).filter((claim) => claim.status === "pending");
}

export function unseenTotal(homes: MaintainedProperty[] | undefined, claims?: Claim[] | undefined): number {
  const houses = (homes ?? []).reduce((sum, home) => sum + (home.unseen ?? 0), 0);
  const waiting = pendingClaims(claims).reduce((sum, claim) => sum + (claim.unseen ?? 0), 0);
  return houses + waiting;
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

/** Cached claims (everything but drafts), on the same terms as the houses. */
export function useMyClaims(key?: string): { claims: Claim[] | undefined; reload: () => Promise<void> } {
  const { user } = useAuth();
  const claims = useCached<Claim[]>(queryKeys.meClaims());
  const reload = useCallback(() => loadMyClaims(true), []);
  const missing = claims === undefined;
  useEffect(() => {
    if (!user) return;
    void loadMyClaims(missing).catch(() => {});
  }, [user?.user_id, key]);
  return { claims: user ? claims : undefined, reload };
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

/** The pending chip is gone the moment they cancel, before the server answers. */
export function dropMyClaim(claimId: string): void {
  cachePatch<Claim[]>(queryKeys.meClaims(), (list) => list.filter((claim) => claim.claim_id !== claimId));
}

/** Same, for the notice under a house that is still waiting on its postcard. */
export function markClaimNoticeSeen(claimId: string): void {
  cachePatch<Claim[]>(queryKeys.meClaims(), (list) => (
    list.map((claim) => (claim.claim_id === claimId ? { ...claim, unseen: 0 } : claim))
  ));
  void api.markClaimSeen(claimId).catch(() => {});
}
