import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import postgres from "postgres";
import { isHostedDatabase } from "../../db/safety.ts";
import { applyMigrations, dropSql } from "../../db/schema.ts";
import { app } from "./app.ts";
import { closeSql, setSql } from "./db.ts";
import { runWithRuntime } from "./runtime.ts";
import { assembleFacts, type AssertionRow } from "./services/assertions.ts";
import { memoryStore, type DocumentStore } from "./services/storage.ts";
import { DEBUG_CLAIM_PIN, TEST_PROD_CODE, TEST_PROD_EMAIL } from "./debug.ts";
import { ABSTRACT_AVATAR_URL } from "../../shared/profile.ts";

const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace_test";
if (isHostedDatabase(url) && !process.env.ALLOW_HOSTED_DB_TESTS) {
  throw new Error(
    "Refusing to run app tests against a hosted database. Use `npm test` (myplace_test), not `npx vitest`.",
  );
}

async function resetDb() {
  const sql = postgres(url, { max: 1 });
  setSql(sql);
  await sql.unsafe(dropSql);
  await applyMigrations(sql, () => undefined);
  return sql;
}

let sql: postgres.Sql;

beforeAll(async () => {
  sql = await resetDb();
});

afterAll(async () => {
  await closeSql();
});

beforeEach(async () => {
  await sql`DELETE FROM emails`;
  await sql`DELETE FROM neighbor_requests`;
  await sql`DELETE FROM notification_preferences`;
  await sql`DELETE FROM handoff_invitations`;
  await sql`DELETE FROM contribution_assertions`;
  await sql`DELETE FROM contributions`;
  await sql`DELETE FROM documents`;
  await sql`DELETE FROM property_improvements`;
  await sql`DELETE FROM property_rooms`;
  await sql`DELETE FROM property_maintainers`;
  await sql`DELETE FROM ownership_claims`;
  await sql`DELETE FROM property_events`;
  await sql`DELETE FROM assertions`;
  await sql`DELETE FROM property_addresses`;
  await sql`DELETE FROM property_geometries`;
  await sql`DELETE FROM parcel_identities`;
  await sql`DELETE FROM properties`;
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM auth_codes`;
  await sql`DELETE FROM sessions`;
  await sql`DELETE FROM user_emails`;
  await sql`DELETE FROM users`;
});

async function seedProperty() {
  await sql`
    INSERT INTO sources (source_id, name, source_type, health_status)
    VALUES ('src_gov', 'County roll', 'government', 'healthy')
  `;
  await sql`
    INSERT INTO sources (source_id, name, source_type, health_status)
    VALUES ('src_bldg', 'Building file', 'government', 'healthy')
  `;
  await sql`INSERT INTO properties (property_id, state, county, municipality) VALUES ('prop_test', 'NY', 'Columbia', 'Hudson')`;
  await sql`
    INSERT INTO parcel_identities (parcel_identity_id, property_id, swis, sbl, print_key)
    VALUES ('pid_test', 'prop_test', '103600', '109.44-1-17', '109.44-1-17')
  `;
  await sql`
    INSERT INTO property_addresses (address_id, property_id, formatted, street_number, street_name, city)
    VALUES ('adr_test', 'prop_test', '441 Warren Street, Hudson, NY 12534', '441', 'Warren Street', 'Hudson')
  `;
  await sql`
    INSERT INTO property_geometries (geometry_id, property_id, geom, is_current)
    VALUES ('geo_test', 'prop_test', ST_SetSRID(ST_GeomFromText('POLYGON((-73.79 42.25,-73.789 42.25,-73.789 42.251,-73.79 42.251,-73.79 42.25))'), 4326), true)
  `;
  await sql`
    INSERT INTO assertions (assertion_id, property_id, field_key, value_json, source_id, source_type, status)
    VALUES
      ('ast_1', 'prop_test', 'assessment.total', '{"value":485000}', 'src_gov', 'government', 'accepted'),
      ('ast_2', 'prop_test', 'year_built', '{"value":1852}', 'src_gov', 'government', 'accepted'),
      ('ast_3', 'prop_test', 'year_built', '{"value":1904}', 'src_bldg', 'government', 'accepted')
  `;
}

async function giveHome(userId: string, propertyId: string, formatted: string) {
  const n = propertyId.replace(/\W/g, "").slice(-8);
  await sql`INSERT INTO properties (property_id, state, county, municipality) VALUES (${propertyId}, 'NY', 'Columbia', 'Hudson')`;
  await sql`
    INSERT INTO property_addresses (address_id, property_id, formatted, street_number, street_name, city)
    VALUES (${`adr_${n}`}, ${propertyId}, ${formatted}, '12', 'State Street', 'Hudson')
  `;
  await sql`
    INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
    VALUES (${`mnt_${n}`}, ${propertyId}, ${userId}, 'owner')
  `;
}

async function giveCover(propertyId: string, documentId: string) {
  await sql`
    INSERT INTO documents (
      document_id, property_id, storage_key, original_filename,
      mime_type, byte_size, document_type, visibility, is_cover
    ) VALUES (
      ${documentId}, ${propertyId}, ${`property-documents/${propertyId}/${documentId}/front.webp`},
      'front.webp', 'image/webp', 12000, 'photo', 'public', true
    )
  `;
}

async function signIn(email: string, admin = false) {
  if (admin) {
    await sql`
      INSERT INTO users (user_id, primary_email, email_verified_at, is_admin, display_name)
      VALUES ('usr_admin', ${email}, now(), true, 'Admin')
      ON CONFLICT (primary_email) DO UPDATE SET is_admin = true
    `;
  }
  let res = await app.request("http://localhost/api/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  const mail = await sql<{ text_body: string }[]>`
    SELECT text_body FROM emails WHERE to_email = ${email} ORDER BY sent_at DESC LIMIT 1
  `;
  const code = mail[0]?.text_body.match(/is (\d{6})/)?.[1];
  expect(code).toBeTruthy();
  res = await app.request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

test("unknown and conflicting facts stay visible", () => {
  const facts = assembleFacts([
    {
      assertion_id: "1",
      property_id: "p",
      field_key: "year_built",
      value_json: { value: 1852 },
      source_id: "a",
      source_type: "government",
      effective_at: "2020-01-01",
      observed_at: null,
      confidence: 1,
      status: "accepted",
      created_at: "2020-01-01",
      source_name: "Roll",
    },
    {
      assertion_id: "2",
      property_id: "p",
      field_key: "year_built",
      value_json: { value: 1904 },
      source_id: "b",
      source_type: "government",
      effective_at: "2021-01-01",
      observed_at: null,
      confidence: 1,
      status: "accepted",
      created_at: "2021-01-01",
      source_name: "Building file",
    },
  ] satisfies AssertionRow[]);
  const year = facts.find((f) => f.fieldKey === "year_built");
  const flood = facts.find((f) => f.fieldKey === "flood.zone");
  expect(year?.status).toBe("conflicting");
  expect(year?.assertions).toHaveLength(2);
  expect(flood?.status).toBe("unknown");
});

test("owner fill of a blank official field is owner-reported and does not beat government", () => {
  const facts = assembleFacts([
    {
      assertion_id: "1",
      property_id: "p",
      field_key: "bedrooms",
      value_json: { value: 3 },
      source_id: null,
      source_type: "verified_owner",
      effective_at: "2026-09-13",
      observed_at: null,
      confidence: 1,
      status: "accepted",
      created_at: "2026-09-13",
      source_name: "Owner",
    },
    {
      assertion_id: "2",
      property_id: "p",
      field_key: "year_built",
      value_json: { value: 1852 },
      source_id: "a",
      source_type: "government",
      effective_at: "2020-01-01",
      observed_at: null,
      confidence: 1,
      status: "accepted",
      created_at: "2020-01-01",
      source_name: "Roll",
    },
    {
      assertion_id: "3",
      property_id: "p",
      field_key: "year_built",
      value_json: { value: 1810 },
      source_id: null,
      source_type: "verified_owner",
      effective_at: "2026-09-13",
      observed_at: null,
      confidence: 1,
      status: "accepted",
      created_at: "2026-09-13",
      source_name: "Owner",
    },
  ] satisfies AssertionRow[]);
  const bedrooms = facts.find((f) => f.fieldKey === "bedrooms");
  const year = facts.find((f) => f.fieldKey === "year_built");
  expect(bedrooms?.status).toBe("owner_reported");
  expect(bedrooms?.value).toBe(3);
  expect(year?.status).toBe("available");
  expect(year?.value).toBe(1852);
});

test("search, property page, and claim review", async () => {
  await seedProperty();
  const found = await app.request("http://localhost/api/search?q=Warren");
  const foundBody = await found.json();
  expect(foundBody.results[0].property_id).toBe("prop_test");

  const page = await app.request("http://localhost/api/properties/prop_test");
  const pageBody = await page.json();
  expect(pageBody.property.facts.find((f: { fieldKey: string }) => f.fieldKey === "year_built").status).toBe("conflicting");
  expect(pageBody.property.facts.find((f: { fieldKey: string }) => f.fieldKey === "assessment.total").display).toContain("485,000");

  const ownerCookie = await signIn("owner@example.com");
  const claim = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ method: "tax_bill", attestationAccepted: true }),
  });
  expect(claim.status).toBe(201);
  const { claimId } = await claim.json();

  const pendingPage = await app.request("http://localhost/api/properties/prop_test", {
    headers: { cookie: ownerCookie },
  });
  const pendingBody = await pendingPage.json();
  expect(pendingBody.viewer.maintainer).toBe(false);
  expect(pendingBody.viewer.openClaim?.claim_id).toBe(claimId);

  const prematureWrite = await app.request("http://localhost/api/properties/prop_test/owner-fields", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fields: { "roof.year": 2018 } }),
  });
  expect(prematureWrite.status).toBe(403);

  const adminCookie = await signIn("admin@example.com", true);
  const review = await app.request(`http://localhost/api/admin/claims/${claimId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ decision: "verified" }),
  });
  expect(review.status).toBe(200);

  const mine = await app.request("http://localhost/api/me/properties", {
    headers: { cookie: ownerCookie },
  });
  const mineBody = await mine.json();
  expect(mineBody.properties[0].property_id).toBe("prop_test");
  expect(mineBody.properties[0].maintainers).toEqual([
    expect.objectContaining({ role: "owner", photo_url: expect.any(String) }),
  ]);

  const update = await app.request("http://localhost/api/properties/prop_test/owner-fields", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fields: { "roof.year": 2018, heating: "Oil boiler" } }),
  });
  expect(update.status).toBe(200);

  const after = await app.request("http://localhost/api/properties/prop_test");
  const afterBody = await after.json();
  const roof = afterBody.property.facts.find((f: { fieldKey: string }) => f.fieldKey === "roof.year");
  expect(roof.status).toBe("available");
  expect(roof.value).toBe(2018);

  const rooms = await app.request("http://localhost/api/properties/prop_test/owner-fields", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fields: { bedrooms: 4, bathrooms: 2 } }),
  });
  expect(rooms.status).toBe(200);
  const filled = await (await app.request("http://localhost/api/properties/prop_test")).json();
  const bedrooms = filled.property.facts.find((f: { fieldKey: string }) => f.fieldKey === "bedrooms");
  expect(bedrooms.status).toBe("owner_reported");
  expect(bedrooms.value).toBe(4);
  expect(afterBody.property.events.some((e: { event_type: string }) => e.event_type === "ownership.claimed")).toBe(true);
  expect(afterBody.property.events.some((e: { event_type: string }) => e.event_type === "owner_assertion.added")).toBe(true);
});

async function verifiedOwner(email: string, adminEmail = "desk@example.com") {
  const cookie = await signIn(email);
  const claim = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ method: "tax_bill", attestationAccepted: true }),
  });
  const { claimId } = await claim.json();
  const adminCookie = await signIn(adminEmail, true);
  const review = await app.request(`http://localhost/api/admin/claims/${claimId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ decision: "verified" }),
  });
  expect(review.status).toBe(200);
  return cookie;
}

test("owner contributions are public on the profile until the owner makes them private", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");

  const save = await app.request("http://localhost/api/properties/prop_test/owner-fields", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fields: { "profile.summary": "Brick row house on the main street.", heating: "Oil boiler", "utility.water": "City of Hudson" } }),
  });
  expect(save.status).toBe(200);

  type FactBody = { fieldKey: string; status: string; value: unknown; visibility: string | null; assertions: unknown[] };
  const factOf = (body: { property: { facts: FactBody[] } }, key: string) =>
    body.property.facts.find((f) => f.fieldKey === key)!;

  let publicBody = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(factOf(publicBody, "profile.summary").status).toBe("available");
  expect(factOf(publicBody, "heating").value).toBe("Oil boiler");
  expect(factOf(publicBody, "utility.water").status).toBe("owner_reported");

  const hide = await app.request("http://localhost/api/properties/prop_test/owner-fields/visibility", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fieldKey: "heating", visibility: "private" }),
  });
  expect(hide.status).toBe(200);
  expect((await hide.json()).changed).toBe(1);

  publicBody = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(factOf(publicBody, "heating").status).toBe("unknown");
  expect(factOf(publicBody, "heating").assertions).toHaveLength(0);
  expect(factOf(publicBody, "profile.summary").status).toBe("available");

  const ownerBody = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json();
  expect(factOf(ownerBody, "heating").status).toBe("available");
  expect(factOf(ownerBody, "heating").visibility).toBe("private");
  expect(factOf(ownerBody, "profile.summary").visibility).toBe("public");

  // Editing a private value keeps it private.
  await app.request("http://localhost/api/properties/prop_test/owner-fields", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fields: { heating: "Gas boiler" } }),
  });
  publicBody = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(factOf(publicBody, "heating").status).toBe("unknown");
  const ownerAgain = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json();
  expect(factOf(ownerAgain, "heating").value).toBe("Gas boiler");
  expect(factOf(ownerAgain, "heating").visibility).toBe("private");

  // Official values can never be hidden: the toggle only reaches owner assertions,
  // so on a field with no owner fill it changes nothing.
  const before = factOf(publicBody, "assessment.total");
  const official = await app.request("http://localhost/api/properties/prop_test/owner-fields/visibility", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fieldKey: "assessment.total", visibility: "private" }),
  });
  expect(official.status).toBe(200);
  expect((await official.json()).changed).toBe(0);
  publicBody = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(factOf(publicBody, "assessment.total").status).toBe(before.status);
  expect(factOf(publicBody, "assessment.total").value).toEqual(before.value);
});

test("cover photo is served publicly while private photos stay behind sign-in", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  const uploadPhoto = async (name: string, fields: Record<string, string>) => {
    const form = new FormData();
    form.append("file", new File([png], name, { type: "image/png" }));
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const res = await app.request("http://localhost/api/properties/prop_test/documents", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()).documentId as string;
  };

  const coverId = await uploadPhoto("front.png", { documentType: "photo", visibility: "public", cover: "true" });
  const privateId = await uploadPhoto("boiler.png", { documentType: "photo", visibility: "private" });

  const publicPage = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(publicPage.property.documents.map((d: { document_id: string }) => d.document_id)).toEqual([coverId]);
  expect(publicPage.property.documents[0].is_cover).toBe(true);

  const ownerPage = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json();
  expect(ownerPage.property.documents).toHaveLength(2);
  expect(ownerPage.property.documents[0].document_id).toBe(coverId);

  const anonymousCover = await app.request(`http://localhost/api/documents/${coverId}/file`);
  expect(anonymousCover.status).toBe(200);
  expect(anonymousCover.headers.get("content-type")).toBe("image/png");
  const anonymousPrivate = await app.request(`http://localhost/api/documents/${privateId}/file`);
  expect(anonymousPrivate.status).toBe(401);
  const ownerPrivate = await app.request(`http://localhost/api/documents/${privateId}/file`, { headers: { cookie: ownerCookie } });
  expect(ownerPrivate.status).toBe(200);

  // Choosing a different cover moves the flag.
  const swap = await app.request(`http://localhost/api/documents/${privateId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ cover: true }),
  });
  expect(swap.status).toBe(200);
  const afterSwap = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json();
  const covers = afterSwap.property.documents.filter((d: { is_cover: boolean }) => d.is_cover);
  expect(covers.map((d: { document_id: string }) => d.document_id)).toEqual([privateId]);
});

test("photo likes, comments and shares tally per photo and respect visibility", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const visitorCookie = await signIn("visitor@example.com");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const uploadPhoto = async (name: string, visibility: string) => {
    const form = new FormData();
    form.append("file", new File([png], name, { type: "image/png" }));
    form.append("documentType", "photo");
    form.append("visibility", visibility);
    const res = await app.request("http://localhost/api/properties/prop_test/documents", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()).documentId as string;
  };
  const publicId = await uploadPhoto("front.png", "public");
  const privateId = await uploadPhoto("boiler.png", "private");
  const json = { "content-type": "application/json" };

  // Everyone can read a public photo's tallies; they start empty.
  const fresh = await (await app.request(`http://localhost/api/documents/${publicId}/engagement`)).json();
  expect(fresh.engagement).toEqual({ likes: 0, comments: 0, shares: 0, liked: false });

  // A private photo stays private, even to a signed-in stranger.
  expect((await app.request(`http://localhost/api/documents/${privateId}/engagement`)).status).toBe(404);
  expect((await app.request(`http://localhost/api/documents/${privateId}/engagement`, { headers: { cookie: visitorCookie } })).status).toBe(404);
  expect((await app.request(`http://localhost/api/documents/${privateId}/engagement`, { headers: { cookie: ownerCookie } })).status).toBe(200);

  // Liking needs a session and toggles.
  expect((await app.request(`http://localhost/api/documents/${publicId}/like`, { method: "POST" })).status).toBe(401);
  const liked = await (await app.request(`http://localhost/api/documents/${publicId}/like`, { method: "POST", headers: { cookie: visitorCookie } })).json();
  expect(liked).toEqual({ liked: true, likes: 1 });
  await app.request(`http://localhost/api/documents/${publicId}/like`, { method: "POST", headers: { cookie: ownerCookie } });
  const visitorView = await (await app.request(`http://localhost/api/documents/${publicId}/engagement`, { headers: { cookie: visitorCookie } })).json();
  expect(visitorView.engagement.likes).toBe(2);
  expect(visitorView.engagement.liked).toBe(true);
  const unliked = await (await app.request(`http://localhost/api/documents/${publicId}/like`, { method: "POST", headers: { cookie: visitorCookie } })).json();
  expect(unliked).toEqual({ liked: false, likes: 1 });

  // Shares are a plain tally anyone can bump.
  expect((await (await app.request(`http://localhost/api/documents/${publicId}/share`, { method: "POST" })).json()).shares).toBe(1);
  expect((await (await app.request(`http://localhost/api/documents/${publicId}/share`, { method: "POST" })).json()).shares).toBe(2);

  // Comments: sign in to post, empty bodies bounce, the author's name comes along.
  expect((await app.request(`http://localhost/api/documents/${publicId}/comments`, { method: "POST", headers: json, body: JSON.stringify({ body: "hi" }) })).status).toBe(401);
  const blank = await app.request(`http://localhost/api/documents/${publicId}/comments`, {
    method: "POST",
    headers: { ...json, cookie: visitorCookie },
    body: JSON.stringify({ body: "   " }),
  });
  expect(blank.status).toBe(400);
  const posted = await app.request(`http://localhost/api/documents/${publicId}/comments`, {
    method: "POST",
    headers: { ...json, cookie: visitorCookie },
    body: JSON.stringify({ body: "  Love the  porch. " }),
  });
  expect(posted.status).toBe(201);
  const { comment } = await posted.json();
  expect(comment.body).toBe("Love the porch.");
  expect(comment.mine).toBe(true);
  expect(typeof comment.author.label).toBe("string");

  const listed = await (await app.request(`http://localhost/api/documents/${publicId}/comments`)).json();
  expect(listed.comments.map((c: { comment_id: string }) => c.comment_id)).toEqual([comment.comment_id]);
  expect(listed.comments[0].mine).toBe(false);
  expect(listed.comments[0].likes).toBe(0);
  expect(listed.comments[0].author.property_id).toBeNull();
  // The post header: the uploader is the author, with the caption and date.
  expect(listed.post.document_id).toBe(publicId);
  expect(listed.post.author.label).toBe("owner");
  expect(listed.post.caption).toBeNull();
  expect(typeof listed.post.created_at).toBe("string");

  // Comment likes toggle too, and need a session.
  expect((await app.request(`http://localhost/api/comments/${comment.comment_id}/like`, { method: "POST" })).status).toBe(401);
  const commentLiked = await (await app.request(`http://localhost/api/comments/${comment.comment_id}/like`, { method: "POST", headers: { cookie: ownerCookie } })).json();
  expect(commentLiked).toEqual({ liked: true, likes: 1 });
  const ownerList = await (await app.request(`http://localhost/api/documents/${publicId}/comments`, { headers: { cookie: ownerCookie } })).json();
  expect(ownerList.comments[0]).toMatchObject({ likes: 1, liked: true, mine: false });
  const commentUnliked = await (await app.request(`http://localhost/api/comments/${comment.comment_id}/like`, { method: "POST", headers: { cookie: ownerCookie } })).json();
  expect(commentUnliked).toEqual({ liked: false, likes: 0 });
  expect((await app.request(`http://localhost/api/comments/cmt_missing/like`, { method: "POST", headers: { cookie: ownerCookie } })).status).toBe(404);
  const tallied = await (await app.request(`http://localhost/api/documents/${publicId}/engagement`)).json();
  expect(tallied.engagement).toEqual({ likes: 1, comments: 1, shares: 2, liked: false });

  // Only the author or a maintainer can take a comment down.
  const stranger = await signIn("stranger@example.com");
  expect((await app.request(`http://localhost/api/comments/${comment.comment_id}`, { method: "DELETE", headers: { cookie: stranger } })).status).toBe(403);
  expect((await app.request(`http://localhost/api/comments/${comment.comment_id}`, { method: "DELETE", headers: { cookie: ownerCookie } })).status).toBe(200);
  const afterRemove = await (await app.request(`http://localhost/api/documents/${publicId}/engagement`)).json();
  expect(afterRemove.engagement.comments).toBe(0);
});

test("a commenter's name opens the house they neighbored with, not their other one", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("bob@example.com");
  const aliceCookie = await signIn("alice@example.com");
  const [bob] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'bob@example.com'`;
  const [alice] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'alice@example.com'`;
  if (!bob || !alice) throw new Error("expected Bob and Alice");
  await giveHome(alice.user_id, "prop_alice_a", "10 First Street, Hudson, NY 12534");
  await giveHome(alice.user_id, "prop_alice_b", "20 Second Street, Hudson, NY 12534");
  await sql`
    INSERT INTO neighbor_requests (request_id, from_user_id, to_user_id, property_id, from_property_id, status, decided_at)
    VALUES ('nbr_alice_a', ${alice.user_id}, ${bob.user_id}, 'prop_test', 'prop_alice_a', 'accepted', now())
  `;

  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const form = new FormData();
  form.append("file", new File([png], "front.png", { type: "image/png" }));
  form.append("documentType", "photo");
  form.append("visibility", "public");
  const uploaded = await app.request("http://localhost/api/properties/prop_test/documents", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: form,
  });
  expect(uploaded.status).toBe(201);
  const { documentId } = await uploaded.json();

  const posted = await app.request(`http://localhost/api/documents/${documentId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ body: "Nice stoop." }),
  });
  expect(posted.status).toBe(201);
  expect((await posted.json()).comment.author.property_id).toBe("prop_alice_a");

  const listed = await (await app.request(`http://localhost/api/documents/${documentId}/comments`)).json();
  expect(listed.comments[0].author.property_id).toBe("prop_alice_a");
});

test("former owner loses maintainer access after a handoff claim is verified", async () => {
  await seedProperty();
  const firstCookie = await signIn("seller@example.com");
  const firstClaim = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: firstCookie },
    body: JSON.stringify({ method: "deed", attestationAccepted: true }),
  });
  const { claimId: firstId } = await firstClaim.json();
  const adminCookie = await signIn("desk@example.com", true);
  await app.request(`http://localhost/api/admin/claims/${firstId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ decision: "verified" }),
  });

  const unsolicited = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await signIn("stranger@example.com") },
    body: JSON.stringify({ method: "tax_bill", attestationAccepted: true }),
  });
  expect(unsolicited.status).toBe(409);

  const buyerCookie = await signIn("buyer@example.com");
  const handoff = await app.request("http://localhost/api/properties/prop_test/handoff", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: firstCookie },
    body: JSON.stringify({ email: "buyer@example.com" }),
  });
  expect(handoff.status).toBe(201);
  const secondClaim = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: buyerCookie },
    body: JSON.stringify({ method: "tax_bill", attestationAccepted: true }),
  });
  const { claimId: secondId } = await secondClaim.json();
  await app.request(`http://localhost/api/admin/claims/${secondId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ decision: "verified" }),
  });

  const sellerNow = await app.request("http://localhost/api/me/properties", {
    headers: { cookie: firstCookie },
  });
  expect((await sellerNow.json()).properties).toHaveLength(0);
  const buyerNow = await app.request("http://localhost/api/me/properties", {
    headers: { cookie: buyerCookie },
  });
  expect((await buyerNow.json()).properties).toHaveLength(1);
});

function withStore<T>(store: DocumentStore, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(runWithRuntime({ env: process.env, storage: store }, fn));
}

test("public photos are served to visitors; private ones stay gated", async () => {
  const cloud = memoryStore();
  await seedProperty();
  const ownerCookie = await withStore(cloud, () => signIn("owner@example.com"));
  const claim = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ method: "tax_bill", attestationAccepted: true }),
  });
  const { claimId } = await claim.json();
  const adminCookie = await signIn("admin@example.com", true);
  await app.request(`http://localhost/api/admin/claims/${claimId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ decision: "verified" }),
  });

  const upload = async (name: string, visibility: string) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], name, { type: "image/jpeg" }));
    form.append("documentType", "photo");
    form.append("visibility", visibility);
    const res = await withStore(cloud, () => app.request("http://localhost/api/properties/prop_test/documents", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: form,
    }));
    expect(res.status).toBe(201);
    return (await res.json()).documentId as string;
  };
  const publicId = await upload("IMG_9526.jpeg", "public");
  const privateId = await upload("IMG_6526.jpeg", "private");
  const form = new FormData();
  form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6])], "yard.jpeg", { type: "image/jpeg" }));
  form.append("documentType", "photo");
  const defaulted = await withStore(cloud, () => app.request("http://localhost/api/properties/prop_test/documents", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: form,
  }));
  expect(defaulted.status).toBe(201);
  const defaultId = (await defaulted.json()).documentId as string;

  // A visitor (no session) sees the public photo on the page and can load its file.
  const page = await (await withStore(cloud, () => app.request("http://localhost/api/properties/prop_test"))).json();
  expect(page.property.documents.map((d: { document_id: string; visibility?: string }) => [d.document_id, d.visibility])).toEqual([
    [defaultId, "public"],
    [publicId, "public"],
  ]);
  const anonymousPublic = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`));
  expect(anonymousPublic.status).toBe(200);
  expect(anonymousPublic.headers.get("content-type")).toBe("image/jpeg");
  expect((await anonymousPublic.arrayBuffer()).byteLength).toBe(7);

  const anonymousPrivate = await withStore(cloud, () => app.request(`http://localhost/api/documents/${privateId}/file`));
  expect(anonymousPrivate.status).toBe(401);
  const strangerCookie = await withStore(cloud, () => signIn("stranger@example.com"));
  const strangerPrivate = await withStore(cloud, () => app.request(`http://localhost/api/documents/${privateId}/file`, { headers: { cookie: strangerCookie } }));
  expect(strangerPrivate.status).toBe(403);
  const ownerPrivate = await withStore(cloud, () => app.request(`http://localhost/api/documents/${privateId}/file`, { headers: { cookie: ownerCookie } }));
  expect(ownerPrivate.status).toBe(200);

  // Bytes are in the shared store (R2 in production), so another machine can serve them
  // even if this process has no local disk files.
  process.env.DOCUMENT_ROOT = mkdtempSync(join(tmpdir(), "myplace-empty-"));
  const fromCloud = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`));
  expect(fromCloud.status).toBe(200);
  expect((await fromCloud.arrayBuffer()).byteLength).toBe(7);

  const replaceForm = new FormData();
  replaceForm.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5])], "yard.jpeg", { type: "image/jpeg" }));
  const anonymousReplace = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`, { method: "POST", body: replaceForm }));
  expect(anonymousReplace.status).toBe(401);
  const strangerReplace = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`, { method: "POST", headers: { cookie: strangerCookie }, body: replaceForm }));
  expect(strangerReplace.status).toBe(403);
  const ownerReplace = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`, { method: "POST", headers: { cookie: ownerCookie }, body: replaceForm }));
  expect(ownerReplace.status).toBe(200);
  const replaced = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`));
  expect(replaced.status).toBe(200);
  expect((await replaced.arrayBuffer()).byteLength).toBe(9);

  // Removing a public photo takes its file out of public reach as well.
  await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}`, { method: "DELETE", headers: { cookie: ownerCookie } }));
  const removed = await withStore(cloud, () => app.request(`http://localhost/api/documents/${publicId}/file`));
  expect(removed.status).toBe(401);
});

test("photos whose bytes are gone stay off the public page and can be restored", async () => {
  const gone = memoryStore();
  await seedProperty();
  const ownerCookie = await withStore(gone, () => verifiedOwner("owner@example.com"));
  const form = new FormData();
  form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "IMG_9526.jpeg", { type: "image/jpeg" }));
  form.append("documentType", "photo");
  form.append("visibility", "public");
  form.append("cover", "true");
  const uploaded = await withStore(gone, () => app.request("http://localhost/api/properties/prop_test/documents", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: form,
  }));
  expect(uploaded.status).toBe(201);
  const photoId = (await uploaded.json()).documentId as string;

  const empty = memoryStore();
  const visitor = await (await withStore(empty, () => app.request("http://localhost/api/properties/prop_test"))).json();
  expect(visitor.property.documents).toEqual([]);
  const ownerPage = await (await withStore(empty, () => app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } }))).json();
  expect(ownerPage.property.documents).toEqual([
    expect.objectContaining({ document_id: photoId, has_file: false, original_filename: "IMG_9526.jpeg" }),
  ]);
  const missing = await withStore(empty, () => app.request(`http://localhost/api/documents/${photoId}/file`));
  expect(missing.status).toBe(404);

  const replaceForm = new FormData();
  replaceForm.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7])], "IMG_9526.jpeg", { type: "image/jpeg" }));
  const restored = await withStore(empty, () => app.request(`http://localhost/api/documents/${photoId}/file`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: replaceForm,
  }));
  expect(restored.status).toBe(200);
  const visitorAgain = await (await withStore(empty, () => app.request("http://localhost/api/properties/prop_test"))).json();
  expect(visitorAgain.property.documents).toEqual([
    expect.objectContaining({ document_id: photoId, has_file: true }),
  ]);
  const file = await withStore(empty, () => app.request(`http://localhost/api/documents/${photoId}/file`));
  expect(file.status).toBe(200);
  expect((await file.arrayBuffer()).byteLength).toBe(7);
});

test("Greene official lot lines and Columbia sketches stay distinct", async () => {
  await sql`
    INSERT INTO sources (source_id, name, source_type, health_status, jurisdiction)
    VALUES
      ('src_county_gis', 'Demonstration parcel geometry', 'government', 'healthy', 'Columbia County, NY'),
      ('src_greene_gis', 'NYS Tax Parcels Public — Greene lot lines', 'government', 'healthy', 'Greene County, NY')
  `;
  await sql`INSERT INTO properties (property_id, state, county, municipality) VALUES ('prop_col', 'NY', 'Columbia', 'Hudson')`;
  await sql`INSERT INTO properties (property_id, state, county, municipality) VALUES ('prop_grn', 'NY', 'Greene', 'Catskill')`;
  await sql`
    INSERT INTO property_addresses (address_id, property_id, formatted, street_number, street_name, city)
    VALUES
      ('adr_col', 'prop_col', '441 Warren Street, Hudson, NY 12534', '441', 'Warren Street', 'Hudson'),
      ('adr_grn', 'prop_grn', '1 Main Street, Catskill, NY 12414', '1', 'Main Street', 'Catskill')
  `;
  await sql`
    INSERT INTO property_geometries (geometry_id, property_id, geom, source_id, quality, is_current)
    VALUES
      ('geo_col', 'prop_col', ST_SetSRID(ST_GeomFromText('POLYGON((-73.79 42.25,-73.789 42.25,-73.789 42.251,-73.79 42.251,-73.79 42.25))'), 4326), 'src_county_gis', 'demonstration', true),
      ('geo_grn', 'prop_grn', ST_SetSRID(ST_GeomFromText('POLYGON((-73.867 42.217,-73.866 42.217,-73.866 42.218,-73.867 42.218,-73.867 42.217))'), 4326), 'src_greene_gis', 'official', true)
  `;

  const meta = await (await app.request("http://localhost/api/meta")).json();
  expect(meta.coverage).toMatch(/Greene/);
  expect(meta.counties.map((c: { id: string }) => c.id)).toEqual(["Columbia", "Greene"]);
  const greeneMeta = meta.counties.find((c: { id: string }) => c.id === "Greene");
  const columbiaMeta = meta.counties.find((c: { id: string }) => c.id === "Columbia");
  expect(greeneMeta.geometryPolicy).toBe("public");
  expect(greeneMeta.geometryQuality).toBe("official");
  expect(columbiaMeta.geometryPolicy).toBe("restricted");
  expect(columbiaMeta.geometryQuality).toBe("demonstration");
  expect(meta.demonstration).toBe(true);
  expect(meta.map.tiles).toBe("/api/tiles/{z}/{x}/{y}.mvt");

  const greene = await (await app.request("http://localhost/api/search?q=1%20Main")).json();
  expect(greene.results[0].property_id).toBe("prop_grn");
  expect(greene.results[0].county).toBe("Greene");

  const page = await (await app.request("http://localhost/api/properties/prop_grn")).json();
  expect(page.property.geometryQuality).toBe("official");
  expect(page.property.geometryNotice).toMatch(/authorized NYS/);
  expect(page.property.geometryNotice).toMatch(/county tax map as published/);
  expect(page.property.coverage.lot_lines).toBe("Official");

  const columbia = await (await app.request("http://localhost/api/properties/prop_col")).json();
  expect(columbia.property.geometryNotice).toMatch(/does not authorize/);
  expect(columbia.property.geometryNotice).toMatch(/demonstration sketch/);
  expect(columbia.property.coverage.lot_lines).toBe("Demonstration");

  const parcels = await (await app.request("http://localhost/api/parcels?bbox=-74,42,-73,43")).json();
  const qualities = Object.fromEntries(
    parcels.features.map((f: { id: string; properties: { geometryQuality: string } }) => [f.id, f.properties.geometryQuality]),
  );
  expect(qualities.prop_col).toBe("demonstration");
  expect(qualities.prop_grn).toBe("official");
});

function tileFor(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

test("parcel vector tiles carry shapes only where parcels exist", async () => {
  await seedProperty();
  const hit = tileFor(-73.7895, 42.2505, 14);
  const tile = await app.request(`http://localhost/api/tiles/14/${hit.x}/${hit.y}.mvt`);
  expect(tile.status).toBe(200);
  expect(tile.headers.get("content-type")).toBe("application/vnd.mapbox-vector-tile");
  const bytes = new Uint8Array(await tile.arrayBuffer());
  expect(bytes.length).toBeGreaterThan(20);
  // Layer name and attribute keys are stored as plain strings inside the protobuf.
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text).toContain("parcels");
  expect(text).toContain("property_id");
  expect(text).toContain("prop_test");

  const miss = tileFor(-73.5, 42.4, 14);
  const empty = await app.request(`http://localhost/api/tiles/14/${miss.x}/${miss.y}.mvt`);
  expect(empty.status).toBe(204);

  const shallow = await app.request(`http://localhost/api/tiles/8/75/94.mvt`);
  expect(shallow.status).toBe(204);

  const bad = await app.request(`http://localhost/api/tiles/14/-1/2.mvt`);
  expect(bad.status).toBe(400);
});

test("debug PIN claim grants ownership and a follow-up page load sees the owner", async () => {
  await seedProperty();
  const claim = await app.request("http://localhost/api/dev/debug/claim/prop_test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: DEBUG_CLAIM_PIN }),
  });
  expect(claim.status).toBe(201);
  const body = await claim.json();
  expect(body.ok).toBe(true);
  expect(body.user.primary_email).toBe("debug-owner@myplace.local");
  const cookie = claim.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/myplace_session=/);

  const page = await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } });
  const pageBody = await page.json();
  expect(pageBody.viewer.maintainer).toBe(true);
  expect(pageBody.viewer.role).toBe("owner");
  expect(pageBody.property.maintainers).toHaveLength(1);
});

test("debug PIN claim refuses to displace a verified owner", async () => {
  await seedProperty();
  await verifiedOwner("owner@example.com");
  const claim = await app.request("http://localhost/api/dev/debug/claim/prop_test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: DEBUG_CLAIM_PIN }),
  });
  expect(claim.status).toBe(409);
  const page = await app.request("http://localhost/api/properties/prop_test");
  const body = await page.json();
  expect(body.property.maintainers).toEqual([
    expect.objectContaining({ primary_email: "owner@example.com" }),
  ]);
});

test("sign-up stores first and last name without a handle", async () => {
  const email = "nohandle@example.com";
  let res = await app.request("http://localhost/api/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  const mail = await sql<{ text_body: string }[]>`
    SELECT text_body FROM emails WHERE to_email = ${email} ORDER BY sent_at DESC LIMIT 1
  `;
  const code = mail[0]?.text_body.match(/is (\d{6})/)?.[1];
  expect(code).toBeTruthy();
  res = await app.request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, firstName: "Ada", lastName: "Lovelace" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.first_name).toBe("Ada");
  expect(body.user.handle).toBeNull();
  expect(body.user.anonymize).toBe(false);
  expect(body.user.hide_street).toBe(false);
});

test("sign-up stores first and last name", async () => {
  const email = "ada@example.com";
  let res = await app.request("http://localhost/api/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  const mail = await sql<{ text_body: string }[]>`
    SELECT text_body FROM emails WHERE to_email = ${email} ORDER BY sent_at DESC LIMIT 1
  `;
  const code = mail[0]?.text_body.match(/is (\d{6})/)?.[1];
  expect(code).toBeTruthy();
  res = await app.request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, firstName: "Ada", lastName: "Lovelace", handle: "adalovelace" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.first_name).toBe("Ada");
  expect(body.user.last_name).toBe("Lovelace");
  expect(body.user.display_name).toBe("Ada Lovelace");
  expect(body.user.handle).toBe("adalovelace");
  const rows = await sql<{ first_name: string; last_name: string; display_name: string; handle: string }[]>`
    SELECT first_name, last_name, display_name, handle FROM users WHERE primary_email = ${email}
  `;
  expect(rows[0]).toEqual({ first_name: "Ada", last_name: "Lovelace", display_name: "Ada Lovelace", handle: "adalovelace" });
});

test("anonymize shows the handle on the public property page", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("owner@example.com");
  await sql`UPDATE users SET handle = 'hudsonowner', first_name = 'Sam', last_name = 'Ellison', display_name = 'Sam Ellison' WHERE primary_email = 'owner@example.com'`;

  const named = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(named.property.maintainers[0].label).toBe("Sam Ellison");
  expect(named.property.maintainers[0].anonymize).toBe(false);

  const hide = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ anonymize: true }),
  });
  expect(hide.status).toBe(200);
  expect((await hide.json()).user.anonymize).toBe(true);

  const hidden = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(hidden.property.maintainers[0].label).toBe("@hudsonowner");
  expect(hidden.property.maintainers[0].anonymize).toBe(true);
  expect(hidden.property.maintainers[0].primary_email).toBeUndefined();
  expect(hidden.property.maintainers[0].display_name).toBeUndefined();
});

test("private works before a handle; visitors see Owner", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("owner@example.com");
  await sql`UPDATE users SET handle = NULL, first_name = 'Sam', last_name = 'Ellison', display_name = 'Sam Ellison' WHERE primary_email = 'owner@example.com'`;

  const hide = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ anonymize: true }),
  });
  expect(hide.status).toBe(200);
  expect((await hide.json()).user.anonymize).toBe(true);

  const hidden = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(hidden.property.maintainers[0].label).toBe("Owner");
  expect(hidden.property.maintainers[0].display_name).toBeUndefined();
});

test("hiding the street redacts it for visitors and keeps it for the owner", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("owner@example.com");
  await sql`UPDATE users SET anonymize = true, handle = 'hudsonowner' WHERE primary_email = 'owner@example.com'`;

  const hide = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ hide_street: true }),
  });
  expect(hide.status).toBe(200);
  expect((await hide.json()).user.hide_street).toBe(true);

  const visitor = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(visitor.property.hide_street).toBe(true);
  expect(visitor.property.formatted).toBe("Hudson, NY 12534");
  expect(visitor.property.formatted).not.toMatch(/441/);

  const owner = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } })).json();
  expect(owner.property.formatted).toBe("441 Warren Street, Hudson, NY 12534");

  const off = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ anonymize: false }),
  });
  expect((await off.json()).user.hide_street).toBe(false);
  const shown = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(shown.property.hide_street).toBe(false);
  expect(shown.property.formatted).toBe("441 Warren Street, Hudson, NY 12534");
});

test("owner badge never shows a street address", async () => {
  await seedProperty();
  await verifiedOwner("owner@example.com");
  await sql`
    UPDATE users
    SET first_name = NULL, last_name = NULL, handle = 'priyashah',
        display_name = '134 Warren Street, Hudson, NY'
    WHERE primary_email = 'owner@example.com'
  `;
  const page = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(page.property.maintainers[0].label).toBe("@priyashah");
});

test("anonymize swaps the name, never the photo; the photo is its own change", async () => {
  const cloud = memoryStore();
  await seedProperty();
  const cookie = await withStore(cloud, () => verifiedOwner("owner@example.com"));
  await sql`UPDATE users SET handle = 'hudsonowner', first_name = 'Sam', last_name = 'Ellison', display_name = 'Sam Ellison' WHERE primary_email = 'owner@example.com'`;

  const before = await (await app.request("http://localhost/api/properties/prop_test")).json();
  const facePhoto = before.property.maintainers[0].photo_url as string;
  expect(facePhoto).toMatch(/^https:\/\/images\.unsplash\.com\//);

  const hide = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ anonymize: true }),
  });
  expect(hide.status).toBe(200);
  const hidden = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(hidden.property.maintainers[0].label).toBe("@hudsonowner");
  expect(hidden.property.maintainers[0].photo_url).toBe(facePhoto);

  const abstract = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ avatar: "abstract" }),
  });
  expect(abstract.status).toBe(200);
  expect((await abstract.json()).user.avatar_url).toBe(ABSTRACT_AVATAR_URL);
  const marked = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(marked.property.maintainers[0].photo_url).toBe(ABSTRACT_AVATAR_URL);

  const bogus = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ avatar: "https://evil.example/x.png" }),
  });
  expect(bogus.status).toBe(400);

  const form = new FormData();
  form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "me.jpeg", { type: "image/jpeg" }));
  const upload = await withStore(cloud, () => app.request("http://localhost/api/me/avatar", {
    method: "POST",
    headers: { cookie },
    body: form,
  }));
  expect(upload.status).toBe(201);
  const uploaded = (await upload.json()).user as { user_id: string; avatar_url: string; avatar_key: string };
  expect(uploaded.avatar_url).toMatch(new RegExp(`^/api/users/${uploaded.user_id}/avatar\\?v=`));
  expect(uploaded.avatar_key).toMatch(/^user-avatars\//);

  const file = await withStore(cloud, () => app.request(`http://localhost/api/users/${uploaded.user_id}/avatar`));
  expect(file.status).toBe(200);
  expect(file.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));

  const page = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(page.property.maintainers[0].photo_url).toBe(uploaded.avatar_url);
  expect(page.property.maintainers[0].label).toBe("@hudsonowner");

  const notImage = new FormData();
  notImage.append("file", new File([new Uint8Array([1, 2, 3])], "deed.pdf", { type: "application/pdf" }));
  const rejected = await withStore(cloud, () => app.request("http://localhost/api/me/avatar", {
    method: "POST",
    headers: { cookie },
    body: notImage,
  }));
  expect(rejected.status).toBe(400);

  // Going back to a preset drops the upload from storage.
  const reset = await withStore(cloud, () => app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ avatar: "default" }),
  }));
  expect(reset.status).toBe(200);
  expect(await cloud.has(uploaded.avatar_key)).toBe(false);
  const gone = await withStore(cloud, () => app.request(`http://localhost/api/users/${uploaded.user_id}/avatar`));
  expect(gone.status).toBe(404);
});

test("handles are unique and the availability check knows your own", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  await sql`UPDATE users SET handle = 'hudsonowner' WHERE primary_email = 'owner@example.com'`;
  const otherCookie = await signIn("kelsey@example.com");
  await sql`UPDATE users SET handle = 'ktmkns' WHERE primary_email = 'kelsey@example.com'`;

  const own = await app.request("http://localhost/api/handles/hudsonowner", { headers: { cookie: ownerCookie } });
  expect(own.status).toBe(200);
  expect((await own.json()).available).toBe(true);

  const taken = await app.request("http://localhost/api/handles/ktmkns", { headers: { cookie: ownerCookie } });
  expect(taken.status).toBe(200);
  expect((await taken.json()).available).toBe(false);

  const free = await app.request("http://localhost/api/handles/newhandle");
  expect(free.status).toBe(200);
  expect((await free.json()).available).toBe(true);

  const junk = await app.request("http://localhost/api/handles/1bad");
  expect(junk.status).toBe(400);

  const steal = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ handle: "ktmkns" }),
  });
  expect(steal.status).toBe(409);

  const rename = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: otherCookie },
    body: JSON.stringify({ handle: "kelseyt" }),
  });
  expect(rename.status).toBe(200);
  expect((await rename.json()).user.handle).toBe("kelseyt");
});

test("each maintainer anonymizes independently", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  await sql`UPDATE users SET handle = 'hudsonowner', first_name = 'Sam', last_name = 'Ellison', display_name = 'Sam Ellison' WHERE primary_email = 'owner@example.com'`;

  const coCookie = await signIn("kelsey@example.com");
  await sql`UPDATE users SET handle = 'ktmkns', first_name = 'Kelsey', last_name = 'Tomkins', display_name = 'Kelsey Tomkins' WHERE primary_email = 'kelsey@example.com'`;
  const [co] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'kelsey@example.com'`;
  if (!co) throw new Error("expected kelsey@example.com");
  await sql`
    INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
    VALUES ('mnt_co', 'prop_test', ${co.user_id}, 'co_owner')
  `;

  const hideOwner = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ anonymize: true }),
  });
  expect(hideOwner.status).toBe(200);

  const afterOwner = await (await app.request("http://localhost/api/properties/prop_test")).json();
  const people = afterOwner.property.maintainers as Array<{ role: string; label: string }>;
  expect(people.find((row) => row.role === "owner")?.label).toBe("@hudsonowner");
  expect(people.find((row) => row.role === "co_owner")?.label).toBe("Kelsey Tomkins");

  const mine = await (await app.request("http://localhost/api/me/properties", { headers: { cookie: ownerCookie } })).json();
  expect(mine.properties[0].maintainers.map((row: { role: string }) => row.role)).toEqual(["owner", "co_owner"]);
  expect(mine.properties[0].maintainers.every((row: { photo_url: string }) => row.photo_url)).toBe(true);

  const hideCo = await app.request("http://localhost/api/me", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: coCookie },
    body: JSON.stringify({ anonymize: true }),
  });
  expect(hideCo.status).toBe(200);

  const afterBoth = await (await app.request("http://localhost/api/properties/prop_test")).json();
  const next = afterBoth.property.maintainers as Array<{ role: string; label: string }>;
  expect(next.find((row) => row.role === "owner")?.label).toBe("@hudsonowner");
  expect(next.find((row) => row.role === "co_owner")?.label).toBe("@ktmkns");
});

test("debug sign-in accepts the 000000 shortcut", async () => {
  const res = await app.request("http://localhost/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@myplace.local", code: "000000" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.primary_email).toBe("admin@myplace.local");
  expect(res.headers.get("set-cookie") ?? "").toMatch(/myplace_session=/);
});

test("a pending claim does not let an admin manage the property", async () => {
  await seedProperty();
  const cookie = await signIn("michaeltomkins@gmail.com", true);
  const claim = await app.request("http://localhost/api/properties/prop_test/claims", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ method: "utility_and_id", attestationAccepted: true }),
  });
  expect(claim.status).toBe(201);

  const page = await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } });
  const body = await page.json();
  expect(body.viewer.admin).toBe(true);
  expect(body.viewer.maintainer).toBe(false);
  expect(body.viewer.openClaim).toBeTruthy();

  const write = await app.request("http://localhost/api/properties/prop_test/owner-fields", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ fields: { "roof.year": 2018 } }),
  });
  expect(write.status).toBe(403);

  const docs = await app.request("http://localhost/api/properties/prop_test/documents", { headers: { cookie } });
  expect(docs.status).toBe(403);
});

test("owner inbox lists disputes and lets the owner accept or decline change requests", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");

  const empty = await app.request("http://localhost/api/properties/prop_test/inbox", {
    headers: { cookie: ownerCookie },
  });
  expect(empty.status).toBe(200);
  expect((await empty.json()).items).toEqual([]);

  const stranger = await app.request("http://localhost/api/properties/prop_test/inbox");
  expect(stranger.status).toBe(401);

  const dispute = await app.request("http://localhost/api/properties/prop_test/disputes", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fieldKey: "year_built", proposedValue: "1850", note: "The lintel says 1850." }),
  });
  expect(dispute.status).toBe(201);
  const { contributionId: disputeId } = await dispute.json();

  const neighbor = await signIn("neighbor@example.com");
  const neighborUser = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'neighbor@example.com'`;
  await sql`
    INSERT INTO contributions (contribution_id, property_id, contributor_user_id, contributor_type, status, summary)
    VALUES ('con_req', 'prop_test', ${neighborUser[0]!.user_id}, 'neighbor', 'needs_review', 'Neighbor proposed heating')
  `;
  await sql`
    INSERT INTO contribution_assertions (contribution_assertion_id, contribution_id, field_key, value_json)
    VALUES ('cas_req', 'con_req', 'heating', ${sql.json({ value: "Heat pump", note: "Installed last fall" } as never)})
  `;

  const listed = await app.request("http://localhost/api/properties/prop_test/inbox", {
    headers: { cookie: ownerCookie },
  });
  const listedBody = await listed.json() as { items: Array<{ kind: string; contributionId: string; actions: string[] }> };
  expect(listedBody.items.map((item) => item.kind)).toEqual(["contribution_request", "dispute"]);
  const request = listedBody.items.find((item) => item.kind === "contribution_request")!;
  const ownDispute = listedBody.items.find((item) => item.kind === "dispute")!;
  expect(request.actions).toEqual(["accept", "decline", "view"]);
  expect(ownDispute.actions).toEqual(["withdraw", "view"]);
  expect(ownDispute.contributionId).toBe(disputeId);

  const page = await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } });
  expect((await page.json()).viewer.inboxCount).toBe(2);

  const refuseOwn = await app.request(`http://localhost/api/contributions/${disputeId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ decision: "accepted" }),
  });
  expect(refuseOwn.status).toBe(400);

  const accept = await app.request("http://localhost/api/contributions/con_req/review", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ decision: "accepted" }),
  });
  expect(accept.status).toBe(200);

  const after = await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } });
  const afterBody = await after.json();
  const heating = afterBody.property.facts.find((fact: { fieldKey: string }) => fact.fieldKey === "heating");
  expect(heating.value).toBe("Heat pump");
  expect(afterBody.viewer.inboxCount).toBe(1);

  const leftover = await app.request("http://localhost/api/properties/prop_test/inbox", {
    headers: { cookie: ownerCookie },
  });
  expect((await leftover.json()).items).toHaveLength(1);
});

test("production tester login accepts 000000 without a mailed code", async () => {
  const res = await runWithRuntime(
    { env: { ...process.env, NODE_ENV: "production", DEV_MAILBOX: "false" } },
    () => app.request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_PROD_EMAIL, code: TEST_PROD_CODE }),
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.user.primary_email).toBe(TEST_PROD_EMAIL);
  expect(body.user.is_admin).toBe(false);
  expect(res.headers.get("set-cookie") ?? "").toMatch(/myplace_session=/);

  const denied = await runWithRuntime(
    { env: { ...process.env, NODE_ENV: "production", DEV_MAILBOX: "false" } },
    () => app.request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "someone-else@example.com", code: TEST_PROD_CODE }),
    }),
  );
  expect(denied.status).toBe(400);
});

test("owner can add, edit, and delete a room", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("rooms@example.com", "rooms-desk@example.com");

  const created = await app.request("http://localhost/api/properties/prop_test/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      kind: "kitchen",
      details: {
        cabinetry: "Hudson Valley Cabinetry",
        cabinetry_color: "Hague Blue",
        island: "Custom millwork",
        island_color: "Walnut",
        counters: "Soapstone",
        paint: "Shaded White",
        paint_hex: "#e7e0d0",
      },
    }),
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as { room: { room_id: string; kind: string; details: Record<string, string> } };
  expect(createdBody.room.kind).toBe("kitchen");
  expect(createdBody.room.details.cabinetry).toBe("Hudson Valley Cabinetry");
  expect(createdBody.room.details.cabinetry_color).toBe("Hague Blue");
  expect(createdBody.room.details.island).toBe("Custom millwork");
  expect(createdBody.room.details.island_color).toBe("Walnut");

  const page = await app.request("http://localhost/api/properties/prop_test");
  const pageBody = await page.json() as { property: { rooms: Array<{ kind: string; details: Record<string, string> }> } };
  expect(pageBody.property.rooms).toHaveLength(1);
  expect(pageBody.property.rooms[0]?.kind).toBe("kitchen");

  const patched = await app.request(`http://localhost/api/rooms/${createdBody.room.room_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind: "primary_bathroom", details: { tub_shower: "Cast-iron tub" } }),
  });
  expect(patched.status).toBe(200);
  const patchedBody = await patched.json() as { room: { kind: string; details: Record<string, string> } };
  expect(patchedBody.room.kind).toBe("primary_bathroom");
  expect(patchedBody.room.details.tub_shower).toBe("Cast-iron tub");
  expect(patchedBody.room.details.cabinetry).toBeUndefined();

  const removed = await app.request(`http://localhost/api/rooms/${createdBody.room.room_id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  expect(removed.status).toBe(200);
  const after = await app.request("http://localhost/api/properties/prop_test");
  const afterBody = await after.json() as { property: { rooms: unknown[] } };
  expect(afterBody.property.rooms).toEqual([]);
});

test("room details are validated and only the owner can touch a room", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("roomowner@example.com", "roomowner-desk@example.com");
  const stranger = await signIn("nosy@example.com");
  const post = (body: unknown, who = cookie) => app.request("http://localhost/api/properties/prop_test/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: who },
    body: JSON.stringify(body),
  });

  expect((await post({ kind: "ballroom" })).status).toBe(400);
  expect((await post({ kind: "kitchen", details: { link: "javascript:alert(1)" } })).status).toBe(400);
  expect((await post({ kind: "kitchen", details: { paint_hex: "blue" } })).status).toBe(400);
  expect((await post({ kind: "kitchen", details: { year: "19" } })).status).toBe(400);
  expect((await post({ kind: "kitchen" }, stranger)).status).toBe(403);

  const created = await post({
    kind: "kitchen",
    description: "  Garden-facing, in the later addition.  ",
    details: { link: "hudsonpaint.com/kitchen", paint_hex: "E7E0D0", year: "2019", unknown_key: "dropped", cabinetry: "  Inset  " },
  });
  expect(created.status).toBe(201);
  const { room } = await created.json() as { room: { room_id: string; description: string | null; details: Record<string, string> } };
  expect(room.description).toBe("Garden-facing, in the later addition.");
  expect(room.details).toEqual({ link: "https://hudsonpaint.com/kitchen", paint_hex: "#e7e0d0", year: "2019", cabinetry: "Inset" });

  expect((await post({ kind: "kitchen", description: "x".repeat(2001) })).status).toBe(400);

  const strangerPatch = await app.request(`http://localhost/api/rooms/${room.room_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: stranger },
    body: JSON.stringify({ description: "Mine now" }),
  });
  expect(strangerPatch.status).toBe(403);
  const strangerDelete = await app.request(`http://localhost/api/rooms/${room.room_id}`, { method: "DELETE", headers: { cookie: stranger } });
  expect(strangerDelete.status).toBe(403);
  const anonymousDelete = await app.request(`http://localhost/api/rooms/${room.room_id}`, { method: "DELETE" });
  expect(anonymousDelete.status).toBe(401);

  // Switching the kind without resending details drops keys that no longer apply.
  const rekind = await app.request(`http://localhost/api/rooms/${room.room_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind: "powder_room" }),
  });
  expect(rekind.status).toBe(200);
  const rekindBody = await rekind.json() as { room: { kind: string; details: Record<string, string> } };
  expect(rekindBody.room.kind).toBe("powder_room");
  expect(rekindBody.room.details.cabinetry).toBeUndefined();
  expect(rekindBody.room.details.link).toBe("https://hudsonpaint.com/kitchen");
});

test("room photos stay with the room and follow its visibility", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("roomphotos@example.com", "roomphotos-desk@example.com");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const upload = async (fields: Record<string, string>) => {
    const form = new FormData();
    form.append("file", new File([png], "room.png", { type: "image/png" }));
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return app.request("http://localhost/api/properties/prop_test/documents", { method: "POST", headers: { cookie }, body: form });
  };

  const created = await app.request("http://localhost/api/properties/prop_test/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind: "primary_bathroom", visibility: "private", details: { tile: "Penny" } }),
  });
  const { room } = await created.json() as { room: { room_id: string } };

  expect((await upload({ roomId: "room_nope" })).status).toBe(404);
  const attached = await upload({ roomId: room.room_id, visibility: "private" });
  expect(attached.status).toBe(201);
  const { documentId } = await attached.json() as { documentId: string };

  type Page = { property: { rooms: Array<{ room_id: string; documents: Array<{ document_id: string; room_id: string | null }> }>; documents: Array<{ document_id: string; room_id?: string | null }> } };
  const publicBefore = await (await app.request("http://localhost/api/properties/prop_test")).json() as Page;
  expect(publicBefore.property.rooms).toEqual([]);
  expect(publicBefore.property.documents.map((doc) => doc.document_id)).not.toContain(documentId);

  const ownerPage = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } })).json() as Page;
  expect(ownerPage.property.rooms[0]?.documents.map((doc) => doc.document_id)).toEqual([documentId]);
  expect(ownerPage.property.documents.find((doc) => doc.document_id === documentId)?.room_id).toBe(room.room_id);

  const flip = await app.request(`http://localhost/api/rooms/${room.room_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ visibility: "public" }),
  });
  expect(flip.status).toBe(200);
  const publicAfter = await (await app.request("http://localhost/api/properties/prop_test")).json() as Page;
  expect(publicAfter.property.rooms).toHaveLength(1);
  expect(publicAfter.property.rooms[0]?.documents.map((doc) => doc.document_id)).toEqual([documentId]);

  const removed = await app.request(`http://localhost/api/rooms/${room.room_id}`, { method: "DELETE", headers: { cookie } });
  expect(removed.status).toBe(200);
  const gone = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } })).json() as Page;
  expect(gone.property.rooms).toEqual([]);
  expect(gone.property.documents.map((doc) => doc.document_id)).not.toContain(documentId);
});

test("owner can attach a photo to a topic card", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("topicphotos@example.com", "topicphotos-desk@example.com");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const upload = async (fields: Record<string, string>) => {
    const form = new FormData();
    form.append("file", new File([png], "style.png", { type: "image/png" }));
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return app.request("http://localhost/api/properties/prop_test/documents", { method: "POST", headers: { cookie }, body: form });
  };

  expect((await upload({ topicId: "ballroom" })).status).toBe(400);
  const attached = await upload({ topicId: "style", visibility: "public" });
  expect(attached.status).toBe(201);
  const { documentId } = await attached.json() as { documentId: string };

  const page = await (await app.request("http://localhost/api/properties/prop_test")).json() as {
    property: { documents: Array<{ document_id: string; topic_id?: string | null }> };
  };
  const doc = page.property.documents.find((item) => item.document_id === documentId);
  expect(doc?.topic_id).toBe("style");
});

test("room amount paid stays private unless the owner toggles it public", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("roompaid@example.com", "roompaid-desk@example.com");

  const created = await app.request("http://localhost/api/properties/prop_test/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      kind: "kitchen",
      visibility: "public",
      details: { cabinetry: "Inset Shaker", paid: "125000", paid_public: "0" },
    }),
  });
  expect(created.status).toBe(201);
  const { room } = await created.json() as { room: { room_id: string; details: Record<string, string> } };
  expect(room.details.paid).toBe("125000");
  expect(room.details.paid_public).toBeUndefined();

  type Page = { property: { rooms: Array<{ details: Record<string, string> }> } };
  const publicHidden = await (await app.request("http://localhost/api/properties/prop_test")).json() as Page;
  expect(publicHidden.property.rooms[0]?.details.cabinetry).toBe("Inset Shaker");
  expect(publicHidden.property.rooms[0]?.details.paid).toBeUndefined();
  expect(publicHidden.property.rooms[0]?.details.paid_public).toBeUndefined();

  const ownerHidden = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } })).json() as Page;
  expect(ownerHidden.property.rooms[0]?.details.paid).toBe("125000");

  const shown = await app.request(`http://localhost/api/rooms/${room.room_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ details: { cabinetry: "Inset Shaker", paid: "125000", paid_public: "1" } }),
  });
  expect(shown.status).toBe(200);
  const publicShown = await (await app.request("http://localhost/api/properties/prop_test")).json() as Page;
  expect(publicShown.property.rooms[0]?.details.paid).toBe("125000");
  expect(publicShown.property.rooms[0]?.details.paid_public).toBe("1");
});

test("improvement amount paid stays private unless the owner toggles it public", async () => {
  await seedProperty();
  const cookie = await verifiedOwner("imppaid@example.com", "imppaid-desk@example.com");

  const created = await app.request("http://localhost/api/properties/prop_test/improvements", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "New standing-seam roof",
      category: "roof",
      cost: "18000",
      scope: "  Full tear-off, ice-and-water, standing seam  ",
      visibility: "public",
    }),
  });
  expect(created.status).toBe(201);
  const { improvement } = await created.json() as {
    improvement: { improvement_id: string; cost_cents: number | null; cost_visibility: string; visibility: string; scope: string | null };
  };
  expect(improvement.scope).toBe("Full tear-off, ice-and-water, standing seam");
  expect(improvement.cost_cents).toBe(1_800_000);
  expect(improvement.cost_visibility).toBe("private");
  expect(improvement.visibility).toBe("public");

  type Page = { property: { improvements: Array<{ cost_cents: number | null; cost_visibility?: string; visibility: string }> } };
  const publicHidden = await (await app.request("http://localhost/api/properties/prop_test")).json() as Page;
  expect(publicHidden.property.improvements).toHaveLength(1);
  expect(publicHidden.property.improvements[0]?.visibility).toBe("public");
  expect(publicHidden.property.improvements[0]?.cost_cents).toBeNull();
  expect(publicHidden.property.improvements[0]?.cost_visibility).toBe("private");

  const ownerHidden = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie } })).json() as Page;
  expect(ownerHidden.property.improvements[0]?.cost_cents).toBe(1_800_000);

  const shown = await app.request(`http://localhost/api/improvements/${improvement.improvement_id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ costVisibility: "public" }),
  });
  expect(shown.status).toBe(200);
  const publicShown = await (await app.request("http://localhost/api/properties/prop_test")).json() as Page;
  expect(publicShown.property.improvements[0]?.cost_cents).toBe(1_800_000);
  expect(publicShown.property.improvements[0]?.cost_visibility).toBe("public");
});

test("neighbors: request from a claimed page, then approve on the profile", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const visitorCookie = await signIn("visitor@example.com");
  await sql`UPDATE users SET first_name = 'Sam', last_name = 'Ellison', handle = 'hudsonowner' WHERE primary_email = 'owner@example.com'`;
  await sql`UPDATE users SET first_name = 'Ada', last_name = 'Visitor', handle = 'ada' WHERE primary_email = 'visitor@example.com'`;
  const [visitor] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'visitor@example.com'`;
  if (!visitor) throw new Error("expected visitor");
  await giveHome(visitor.user_id, "prop_home", "12 State Street, Hudson, NY 12534");
  await giveCover("prop_test", "doc_test_cover");
  await giveCover("prop_home", "doc_home_cover");

  const ownerPage = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json();
  expect(ownerPage.viewer.neighbor.status).toBe("hidden");
  expect((await (await app.request("http://localhost/api/properties/prop_test/neighbor", { headers: { cookie: ownerCookie } })).json()).neighbor.status).toBe("hidden");
  expect((await (await app.request("http://localhost/api/properties/prop_test")).json()).viewer.neighbor.status).toBe("hidden");
  expect((await (await app.request("http://localhost/api/properties/prop_test/neighbor")).json()).neighbor.status).toBe("hidden");

  const before = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: visitorCookie } })).json();
  expect(before.viewer.neighbor.status).toBe("none");
  expect(before.property.neighbors).toEqual([]);

  const sent = await app.request("http://localhost/api/properties/prop_test/neighbor", {
    method: "POST",
    headers: { cookie: visitorCookie },
  });
  expect(sent.status).toBe(200);
  expect((await sent.json()).neighbor.status).toBe("pending");
  expect((await (await app.request("http://localhost/api/properties/prop_test")).json()).property.neighbors).toEqual([]);

  const sentList = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: visitorCookie } })).json();
  expect(sentList.outgoing).toHaveLength(1);
  expect(sentList.outgoing[0].label).toBe("441 Warren Street, Hudson, NY 12534");
  expect(sentList.outgoing[0].status).toBe("pending");
  expect(sentList.outgoing[0].photo_url).toBe("/api/documents/doc_test_cover/file?v=12000");
  expect(sentList.outgoing[0].owners).toEqual([expect.objectContaining({ label: "Sam Ellison" })]);

  const inbox = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: ownerCookie } })).json();
  expect(inbox.incoming).toHaveLength(1);
  expect(inbox.incoming[0].label).toBe("12 State Street, Hudson, NY 12534");
  expect(inbox.incoming[0].photo_url).toBe("/api/documents/doc_home_cover/file?v=12000");
  expect(inbox.incoming[0].owners).toEqual([expect.objectContaining({ label: "Ada Visitor" })]);
  expect(inbox.neighbors).toHaveLength(0);

  const ownerInbox = await (await app.request("http://localhost/api/properties/prop_test/inbox", { headers: { cookie: ownerCookie } })).json();
  expect(ownerInbox.items).toEqual([expect.objectContaining({
    kind: "neighbor_request",
    title: "Neighbor request",
    neighborRequestId: inbox.incoming[0].request_id,
    fromPropertyId: "prop_home",
    actions: ["accept", "decline", "view"],
  })]);
  expect(ownerInbox.items[0].body).toContain("Ada Visitor");
  expect(ownerInbox.items[0].body).toContain("12 State Street");
  const ownerWaiting = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json();
  expect(ownerWaiting.viewer.inboxCount).toBe(1);

  const fromHome = await (await app.request("http://localhost/api/properties/prop_home/neighbors", { headers: { cookie: visitorCookie } })).json();
  expect(fromHome.outgoing).toHaveLength(1);
  expect(fromHome.outgoing[0].label).toBe("441 Warren Street, Hudson, NY 12534");
  const onTarget = await (await app.request("http://localhost/api/properties/prop_test/neighbors", { headers: { cookie: ownerCookie } })).json();
  expect(onTarget.incoming).toHaveLength(1);
  expect((await app.request("http://localhost/api/properties/prop_test/neighbors", { headers: { cookie: visitorCookie } })).status).toBe(403);

  const review = await app.request(`http://localhost/api/neighbors/${inbox.incoming[0].request_id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ decision: "accepted" }),
  });
  expect(review.status).toBe(200);

  const ownerList = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: ownerCookie } })).json();
  expect(ownerList.incoming).toHaveLength(0);
  expect((await (await app.request("http://localhost/api/properties/prop_test/inbox", { headers: { cookie: ownerCookie } })).json()).items).toEqual([]);
  expect((await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: ownerCookie } })).json()).viewer.inboxCount).toBe(0);
  expect(ownerList.neighbors[0].label).toBe("12 State Street, Hudson, NY 12534");
  expect(ownerList.neighbors[0].photo_url).toBe("/api/documents/doc_home_cover/file?v=12000");
  expect(ownerList.neighbors[0].owners).toEqual([expect.objectContaining({ label: "Ada Visitor" })]);

  const visitorList = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: visitorCookie } })).json();
  expect(visitorList.neighbors[0].label).toBe("441 Warren Street, Hudson, NY 12534");
  expect(visitorList.neighbors[0].photo_url).toBe("/api/documents/doc_test_cover/file?v=12000");
  expect(visitorList.neighbors[0].owners).toEqual([expect.objectContaining({ label: "Sam Ellison" })]);

  const after = await (await app.request("http://localhost/api/properties/prop_test", { headers: { cookie: visitorCookie } })).json();
  expect(after.viewer.neighbor.status).toBe("accepted");
  expect((await (await app.request("http://localhost/api/properties/prop_home/neighbor", { headers: { cookie: ownerCookie } })).json()).neighbor.status).toBe("accepted");
  expect(after.property.neighbors).toEqual([expect.objectContaining({
    property_id: "prop_home",
    formatted: "12 State Street, Hudson, NY 12534",
  })]);
  const publicPage = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(publicPage.property.neighbors).toHaveLength(1);
  const homePage = await (await app.request("http://localhost/api/properties/prop_home")).json();
  expect(homePage.property.neighbors).toEqual([expect.objectContaining({
    property_id: "prop_test",
    formatted: "441 Warren Street, Hudson, NY 12534",
  })]);
});

test("neighbors: decline clears the request so they can ask again", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const visitorCookie = await signIn("visitor@example.com");
  const [visitor] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'visitor@example.com'`;
  if (!visitor) throw new Error("expected visitor");
  await giveHome(visitor.user_id, "prop_home", "12 State Street, Hudson, NY 12534");

  expect((await app.request("http://localhost/api/properties/prop_test/neighbor", {
    method: "POST",
    headers: { cookie: visitorCookie },
  })).status).toBe(200);
  const inbox = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: ownerCookie } })).json();
  expect((await app.request(`http://localhost/api/neighbors/${inbox.incoming[0].request_id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ decision: "declined" }),
  })).status).toBe(200);
  expect((await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: ownerCookie } })).json()).incoming).toHaveLength(0);

  const again = await app.request("http://localhost/api/properties/prop_test/neighbor", {
    method: "POST",
    headers: { cookie: visitorCookie },
  });
  expect(again.status).toBe(200);
  expect((await again.json()).neighbor.status).toBe("pending");
});

test("neighbors: a connection is only for that address, not every house they own", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const visitorCookie = await signIn("visitor@example.com");
  const [owner] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'owner@example.com'`;
  const [visitor] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'visitor@example.com'`;
  if (!owner || !visitor) throw new Error("expected both users");
  await giveHome(visitor.user_id, "prop_home", "12 State Street, Hudson, NY 12534");

  await sql`INSERT INTO properties (property_id, state, county, municipality) VALUES ('prop_other', 'FL', 'Miami-Dade', 'Miami')`;
  await sql`
    INSERT INTO property_addresses (address_id, property_id, formatted, street_number, street_name, city)
    VALUES ('adr_other', 'prop_other', '200 Ocean Drive, Miami, FL 33139', '200', 'Ocean Drive', 'Miami')
  `;
  await sql`
    INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
    VALUES ('mnt_other', 'prop_other', ${owner.user_id}, 'owner')
  `;

  expect((await app.request("http://localhost/api/properties/prop_test/neighbor", {
    method: "POST",
    headers: { cookie: visitorCookie },
  })).status).toBe(200);
  const inbox = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: ownerCookie } })).json();
  expect((await app.request(`http://localhost/api/neighbors/${inbox.incoming[0].request_id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ decision: "accepted" }),
  })).status).toBe(200);

  expect((await (await app.request("http://localhost/api/properties/prop_test/neighbor", { headers: { cookie: visitorCookie } })).json()).neighbor.status).toBe("accepted");
  expect((await (await app.request("http://localhost/api/properties/prop_other/neighbor", { headers: { cookie: visitorCookie } })).json()).neighbor.status).toBe("none");
  expect((await (await app.request("http://localhost/api/properties/prop_home/neighbor", { headers: { cookie: ownerCookie } })).json()).neighbor.status).toBe("accepted");
  expect((await (await app.request("http://localhost/api/properties/prop_test")).json()).property.neighbors.map((row: { property_id: string }) => row.property_id)).toEqual(["prop_home"]);
  expect((await (await app.request("http://localhost/api/properties/prop_other")).json()).property.neighbors).toEqual([]);
  expect((await (await app.request("http://localhost/api/properties/prop_other/neighbors", { headers: { cookie: ownerCookie } })).json()).neighbors).toEqual([]);
  expect((await (await app.request("http://localhost/api/properties/prop_test/neighbors", { headers: { cookie: ownerCookie } })).json()).neighbors).toHaveLength(1);
});

test("neighbors: requester with two houses must say which one the pair is from", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const visitorCookie = await signIn("visitor@example.com");
  const [visitor] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'visitor@example.com'`;
  if (!visitor) throw new Error("expected visitor");
  await giveHome(visitor.user_id, "prop_home_a", "10 First Street, Hudson, NY 12534");
  await giveHome(visitor.user_id, "prop_home_b", "20 Second Street, Hudson, NY 12534");

  const missing = await app.request("http://localhost/api/properties/prop_test/neighbor", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: visitorCookie },
    body: JSON.stringify({}),
  });
  expect(missing.status).toBe(409);
  expect((await missing.json()).properties).toHaveLength(2);

  expect((await app.request("http://localhost/api/properties/prop_test/neighbor", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: visitorCookie },
    body: JSON.stringify({ fromPropertyId: "prop_home_a" }),
  })).status).toBe(200);
  const inbox = await (await app.request("http://localhost/api/me/neighbors", { headers: { cookie: ownerCookie } })).json();
  expect(inbox.incoming[0].label).toBe("10 First Street, Hudson, NY 12534");
  expect((await app.request(`http://localhost/api/neighbors/${inbox.incoming[0].request_id}/review`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ decision: "accepted" }),
  })).status).toBe(200);

  expect((await (await app.request("http://localhost/api/properties/prop_home_a/neighbor", { headers: { cookie: ownerCookie } })).json()).neighbor.status).toBe("accepted");
  expect((await (await app.request("http://localhost/api/properties/prop_home_b/neighbor", { headers: { cookie: ownerCookie } })).json()).neighbor.status).toBe("none");
  expect((await (await app.request("http://localhost/api/properties/prop_test")).json()).property.neighbors.map((row: { property_id: string }) => row.property_id)).toEqual(["prop_home_a"]);
  expect((await (await app.request("http://localhost/api/properties/prop_home_b")).json()).property.neighbors).toEqual([]);
  expect((await (await app.request("http://localhost/api/properties/prop_home_a/neighbors", { headers: { cookie: visitorCookie } })).json()).neighbors).toHaveLength(1);
  expect((await (await app.request("http://localhost/api/properties/prop_home_b/neighbors", { headers: { cookie: visitorCookie } })).json()).neighbors).toEqual([]);
});

test("neighbors: a property page lists every confirmed house, including past eight", async () => {
  await seedProperty();
  const ownerCookie = await verifiedOwner("owner@example.com");
  const [owner] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = 'owner@example.com'`;
  if (!owner) throw new Error("expected owner");

  for (let i = 0; i < 9; i += 1) {
    const email = `n${i}@example.com`;
    await signIn(email);
    const [person] = await sql<{ user_id: string }[]>`SELECT user_id FROM users WHERE primary_email = ${email}`;
    if (!person) throw new Error("expected neighbor");
    const homeId = `prop_n${i}`;
    await giveHome(person.user_id, homeId, `${10 + i} Neighbor Street, Hudson, NY 12534`);
    await sql`
      INSERT INTO neighbor_requests (request_id, from_user_id, to_user_id, property_id, from_property_id, status, decided_at)
      VALUES (${`nbr_n${i}`}, ${person.user_id}, ${owner.user_id}, 'prop_test', ${homeId}, 'accepted', now())
    `;
  }

  const page = await (await app.request("http://localhost/api/properties/prop_test")).json();
  expect(page.property.neighbors).toHaveLength(9);
  expect(page.property.neighbors[0].formatted).toMatch(/Neighbor Street/);
});

