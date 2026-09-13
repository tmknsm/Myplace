import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import postgres from "postgres";
import { isHostedDatabase } from "../../db/safety.ts";
import { applyMigrations, dropSql } from "../../db/schema.ts";
import { app } from "./app.ts";
import { closeSql, setSql } from "./db.ts";
import { assembleFacts, type AssertionRow } from "./services/assertions.ts";
import { DEBUG_CLAIM_PIN } from "./debug.ts";

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
  await sql`DELETE FROM notification_preferences`;
  await sql`DELETE FROM handoff_invitations`;
  await sql`DELETE FROM contribution_assertions`;
  await sql`DELETE FROM contributions`;
  await sql`DELETE FROM documents`;
  await sql`DELETE FROM property_improvements`;
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

  // Official facts cannot be toggled.
  const official = await app.request("http://localhost/api/properties/prop_test/owner-fields/visibility", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ fieldKey: "assessment.total", visibility: "private" }),
  });
  expect(official.status).toBe(400);
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
