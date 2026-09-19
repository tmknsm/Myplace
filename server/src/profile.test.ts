import { expect, test } from "vitest";
import { ABSTRACT_AVATAR_URL, defaultAvatarFor, hasOwnPhoto, ownerLabel, ownerPhoto, parseHandle, propertyHeading, publicAddress, DEFAULT_AVATAR_URL } from "../../shared/profile.ts";

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
  expect(ownerPhoto({ avatar_url: null })).toBeNull();
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

test("ownerLabel hides the real name as soon as they go private, even before a handle", () => {
  expect(ownerLabel({
    anonymize: true,
    handle: null,
    first_name: "Sam",
    last_name: "Ellison",
    display_name: "Sam Ellison",
  })).toBe("Owner");
});

test("publicAddress drops the street when asked", () => {
  expect(publicAddress({
    formatted: "51 State Route 9H, Claverack, NY",
    municipality: "Claverack",
    county: "Columbia",
    state: "NY",
    hideStreet: false,
  })).toBe("51 State Route 9H, Claverack, NY");
  expect(publicAddress({
    formatted: "51 State Route 9H, Claverack, NY",
    municipality: "Claverack",
    county: "Columbia",
    state: "NY",
    hideStreet: true,
  })).toBe("Claverack, NY");
});

test("propertyHeading uses the town when the street is hidden, including for the owner", () => {
  const property = { formatted: "51 State Route 9H, Claverack, NY", municipality: "Claverack", hide_street: true };
  expect(propertyHeading(property)).toEqual({ title: "Claverack", locality: null });
  expect(propertyHeading({ ...property, hide_street: false })).toEqual({
    title: "51 State Route 9H",
    locality: "Claverack, NY",
  });
});

test("ownerPhoto is empty until they upload their own picture", () => {
  expect(ownerPhoto({ avatar_url: null, user_id: "usr_aaa" })).toBeNull();
  expect(ownerPhoto({ avatar_url: DEFAULT_AVATAR_URL, user_id: "usr_zzz" })).toBeNull();
  expect(ownerPhoto({ avatar_url: ABSTRACT_AVATAR_URL })).toBeNull();
  expect(ownerPhoto({ avatar_url: "https://example.com/me.jpg" })).toBe("https://example.com/me.jpg");
});

test("hasOwnPhoto is false for a fresh account and the stock defaults", () => {
  expect(hasOwnPhoto({ avatar_url: null })).toBe(false);
  expect(hasOwnPhoto({ avatar_url: DEFAULT_AVATAR_URL })).toBe(false);
  expect(hasOwnPhoto({ avatar_url: defaultAvatarFor("usr_zzz") })).toBe(false);
  expect(hasOwnPhoto({ avatar_url: ABSTRACT_AVATAR_URL })).toBe(false);
  expect(hasOwnPhoto({ avatar_url: "https://example.com/me.jpg" })).toBe(true);
});
