import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import postgres from "postgres";
import { app } from "./app.ts";
import { closeSql, setSql } from "./db.ts";
import { assembleFacts, type AssertionRow } from "./services/assertions.ts";

const url = process.env.DATABASE_URL ?? "postgres://ubuntu:myplace@localhost:5432/myplace_test";

async function resetDb() {
  const sql = postgres(url, { max: 1 });
  setSql(sql);
  const { readFileSync, readdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
  await sql.unsafe(`
    DROP TABLE IF EXISTS
      field_vocabulary, handoff_invitations, emails, property_relationships,
      contribution_assertions, contributions, documents, property_maintainers,
      ownership_claims, property_events, assertions, property_addresses,
      property_geometries, parcel_identities, source_snapshots, properties,
      sources, auth_codes, sessions, user_emails, users CASCADE;
  `);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    await sql.unsafe(readFileSync(join(dir, file), "utf8"));
  }
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
  await sql`DELETE FROM documents`;
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
  expect(afterBody.property.events.some((e: { event_type: string }) => e.event_type === "ownership.claimed")).toBe(true);
  expect(afterBody.property.events.some((e: { event_type: string }) => e.event_type === "owner_assertion.added")).toBe(true);
});

test("former owner loses maintainer access after a new verified claim", async () => {
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

  const buyerCookie = await signIn("buyer@example.com");
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
