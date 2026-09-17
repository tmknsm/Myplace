import { expect, test } from "vitest";
import { defaultAvatarFor, ownerLabel, ownerPhoto, parseHandle, DEFAULT_AVATAR_URL } from "../../shared/profile.ts";

test("parseHandle strips @ and rejects junk", () => {
  expect(parseHandle("@Sam_Ellison")).toEqual({ handle: "sam_ellison" });
  expect(parseHandle("1bad")).toEqual({ error: expect.any(String) });
  expect(parseHandle("")).toEqual({ error: "Choose a handle." });
});

test("ownerLabel switches to the handle when anonymized; the photo stays put", () => {
  const base = {
    handle: "samellison",
    first_name: "Sam",
    last_name: "Ellison",
    display_name: "Sam Ellison",
    avatar_url: "https://example.com/face.jpg",
  };
  expect(ownerLabel({ ...base, anonymize: false })).toBe("Sam Ellison");
  expect(ownerLabel({ ...base, anonymize: true })).toBe("@samellison");
  expect(ownerPhoto(base)).toBe("https://example.com/face.jpg");
  expect(ownerPhoto({ avatar_url: null })).toBe(DEFAULT_AVATAR_URL);
});

test("ownerLabel never uses a street address as the badge", () => {
  const address = "134 Warren Street, Hudson, NY";
  expect(ownerLabel({
    anonymize: false,
    handle: "priyashah",
    first_name: null,
    last_name: null,
    display_name: address,
  })).toBe("@priyashah");
  expect(ownerLabel({
    anonymize: false,
    handle: null,
    first_name: null,
    last_name: null,
    display_name: address,
  })).toBe("Owner");
  expect(ownerLabel({
    anonymize: false,
    handle: "priyashah",
    first_name: "Priya",
    last_name: "Shah",
    display_name: address,
  })).toBe("Priya Shah");
});

test("ownerPhoto picks a stable face per person when they have not set one", () => {
  const a = ownerPhoto({ avatar_url: null, user_id: "usr_aaa" });
  const b = ownerPhoto({ avatar_url: DEFAULT_AVATAR_URL, user_id: "usr_zzz" });
  expect(a).toBe(defaultAvatarFor("usr_aaa"));
  expect(b).toBe(defaultAvatarFor("usr_zzz"));
  expect(a).not.toBe(b);
});
