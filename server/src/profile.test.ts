import { expect, test } from "vitest";
import { ownerLabel, ownerPhoto, parseHandle, DEFAULT_ANONYMOUS_AVATAR_URL, DEFAULT_AVATAR_URL } from "../../shared/profile.ts";

test("parseHandle strips @ and rejects junk", () => {
  expect(parseHandle("@Sam_Ellison")).toEqual({ handle: "sam_ellison" });
  expect(parseHandle("1bad")).toEqual({ error: expect.any(String) });
  expect(parseHandle("")).toEqual({ error: "Choose a handle." });
});

test("ownerLabel switches to the handle when anonymized", () => {
  const base = {
    handle: "samellison",
    first_name: "Sam",
    last_name: "Ellison",
    display_name: "Sam Ellison",
    avatar_url: "https://example.com/face.jpg",
    anonymous_avatar_url: "https://example.com/mark.jpg",
  };
  expect(ownerLabel({ ...base, anonymize: false })).toBe("Sam Ellison");
  expect(ownerLabel({ ...base, anonymize: true })).toBe("@samellison");
  expect(ownerPhoto({ ...base, anonymize: false })).toBe("https://example.com/face.jpg");
  expect(ownerPhoto({ ...base, anonymize: true })).toBe("https://example.com/mark.jpg");
  expect(ownerPhoto({ anonymize: false, avatar_url: null, anonymous_avatar_url: null })).toBe(DEFAULT_AVATAR_URL);
  expect(ownerPhoto({ anonymize: true, avatar_url: null, anonymous_avatar_url: null })).toBe(DEFAULT_ANONYMOUS_AVATAR_URL);
});
