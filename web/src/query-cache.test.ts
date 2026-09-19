import { describe, expect, test } from "vitest";
import { cacheClear, cacheGet, cachePatch, cacheSet, queryKeys } from "./query-cache";

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
});
