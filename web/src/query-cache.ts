import { useSyncExternalStore } from "react";

/** In-memory stale-while-revalidate store, keyed by a stable resource id. */
const store = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

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
  listeners.get(key)?.forEach((notify) => notify());
  return value;
}

export function cachePatch<T>(key: string, patch: (current: T) => T): T | undefined {
  const current = cacheGet<T>(key);
  if (current === undefined) return undefined;
  return cacheSet(key, patch(current));
}

export function cacheClear(): void {
  const keys = [...store.keys()];
  store.clear();
  for (const key of keys) listeners.get(key)?.forEach((notify) => notify());
}

export function cacheSubscribe(key: string, notify: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(notify);
  listeners.set(key, set);
  return () => {
    set.delete(notify);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Read one cached resource and re-render when anything writes it. */
export function useCached<T>(key: string): T | undefined {
  return useSyncExternalStore(
    (notify) => cacheSubscribe(key, notify),
    () => cacheGet<T>(key),
    () => cacheGet<T>(key),
  );
}
