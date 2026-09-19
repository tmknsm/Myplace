/** In-memory stale-while-revalidate store, keyed by a stable resource id. */
const store = new Map<string, unknown>();

export const queryKeys = {
  feed: (scope: string) => `feed:${scope}`,
  property: (id: string) => `property:${id}`,
  neighbors: (id: string) => `neighbors:${id}`,
  meProperties: () => "me:properties",
};

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet<T>(key: string, value: T): T {
  store.set(key, value);
  return value;
}

export function cachePatch<T>(key: string, patch: (current: T) => T): T | undefined {
  const current = cacheGet<T>(key);
  if (current === undefined) return undefined;
  return cacheSet(key, patch(current));
}

export function cacheClear(): void {
  store.clear();
}
