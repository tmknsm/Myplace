import { describe, expect, test } from "vitest";
import { cacheClear, cacheGet, cachePatch, cacheSet, cacheSubscribe, queryKeys } from "./query-cache";

describe("query cache", () => {
  test("remembers a value until it is patched or cleared", () => {
    cacheClear();
    cacheSet(queryKeys.feed("all"), { posts: [1] });
    expect(cacheGet<{ posts: number[] }>(queryKeys.feed("all"))).toEqual({ posts: [1] });
    cachePatch<{ posts: number[] }>(queryKeys.feed("all"), (current) => ({ posts: [...current.posts, 2] }));
    expect(cacheGet<{ posts: number[] }>(queryKeys.feed("all"))).toEqual({ posts: [1, 2] });
    cacheClear();
    expect(cacheGet(queryKeys.feed("all"))).toBeUndefined();
  });

  test("patching a missing key is a no-op", () => {
    cacheClear();
    expect(cachePatch(queryKeys.property("missing"), (current: { n: number }) => current)).toBeUndefined();
  });

  test("subscribers hear writes to their key, and the clear, until they unsubscribe", () => {
    cacheClear();
    let heard = 0;
    const stop = cacheSubscribe(queryKeys.meProperties(), () => { heard += 1; });
    cacheSet(queryKeys.meProperties(), [{ property_id: "p1", unseen: 2 }]);
    expect(heard).toBe(1);
    cacheSet(queryKeys.feed("all"), { posts: [] });
    expect(heard).toBe(1);
    cachePatch<Array<{ property_id: string; unseen: number }>>(queryKeys.meProperties(), (list) => list.map((home) => ({ ...home, unseen: 0 })));
    expect(heard).toBe(2);
    expect(cacheGet(queryKeys.meProperties())).toEqual([{ property_id: "p1", unseen: 0 }]);
    cacheClear();
    expect(heard).toBe(3);
    stop();
    cacheSet(queryKeys.meProperties(), []);
    expect(heard).toBe(3);
  });
});
