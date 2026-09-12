import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  AppEnv,
  attachSessionCookie,
  authMiddleware,
  clearSessionCookie,
  createSession,
  hashCode,
  hashesMatch,
  isMaintainer,
  randomCode,
  requireAdmin,
  requireUser,
  upsertUser,
} from "./auth.ts";
import { config, isDevExperience } from "./config.ts";
import { getSql } from "./db.ts";
import { id } from "./ids.ts";
import { insertAssertion } from "./services/assertions.ts";
import { emitEvent } from "./services/events.ts";
import {
  adminClaimEmail,
  authCodeEmail,
  claimReceivedEmail,
  claimReviewedEmail,
  handoffEmail,
  sendMail,
} from "./services/mail.ts";
import { loadPropertyCore, loadPropertyPage, parcelsInBbox, searchProperties } from "./services/properties.ts";
import { documentKey, getDocument, putDocument } from "./services/storage.ts";
import { FIELD_VOCAB } from "./vocab.ts";

export const app = new Hono<AppEnv>();

app.use("*", cors({
  origin: [config.appOrigin, "http://localhost:5173", "http://127.0.0.1:5173"],
  credentials: true,
}));
app.use("/api/*", authMiddleware);

app.onError((error, c) => {
  const status = error instanceof HTTPException
    ? error.status
    : (error as { status?: number }).status ?? 500;
  const message = error instanceof Error ? error.message : "Server error";
  if (status >= 500) console.error(error);
  return c.json({ error: message }, status as 500);
});

app.get("/api/health", (c) => c.json({ ok: true, service: "myplace" }));

app.get("/api/meta", async (c) => {
  const sql = getSql();
  const count = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM properties`;
  return c.json({
    product: "Myplace",
    coverage: "Columbia County, New York",
    propertyCount: count[0]?.n ?? 0,
    demonstration: true,
    ownerVerification: "manual_review",
    devMailbox: isDevExperience(),
    vocab: FIELD_VOCAB,
  });
});

app.post("/api/auth/request-code", async (c) => {
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email.includes("@")) return c.json({ error: "Enter a valid email." }, 400);

  const sql = getSql();
  const recent = await sql`
    SELECT 1 FROM auth_codes
    WHERE email = ${email} AND created_at > now() - interval '30 seconds'
  `;
  if (recent.length) return c.json({ error: "Wait a moment before requesting another code." }, 429);

  const code = randomCode();
  await sql`
    INSERT INTO auth_codes (code_id, email, code_hash, purpose, expires_at)
    VALUES (${id("code")}, ${email}, ${hashCode(email, code)}, 'signin', now() + interval '15 minutes')
  `;
  const template = authCodeEmail(config.appOrigin, email, code);
  await sendMail({
    stream: "auth",
    toEmail: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    templateKey: "auth_code",
  });
  return c.json({
    ok: true,
    email,
    ...(isDevExperience() ? { mailbox: "/dev/mailbox" } : {}),
  });
});

app.post("/api/auth/verify", async (c) => {
  const body = await c.req.json<{ email?: string; code?: string }>();
  const email = body.email?.trim().toLowerCase() ?? "";
  const code = (body.code ?? "").replace(/\s/g, "");
  if (!email || !code) return c.json({ error: "Email and code are required." }, 400);

  const sql = getSql();
  const rows = await sql<{ code_id: string; code_hash: string }[]>`
    SELECT code_id, code_hash FROM auth_codes
    WHERE email = ${email} AND purpose = 'signin' AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const match = rows[0];
  if (!match || !hashesMatch(match.code_hash, hashCode(email, code))) {
    return c.json({ error: "That code is incorrect or has expired." }, 400);
  }
  await sql`UPDATE auth_codes SET consumed_at = now() WHERE code_id = ${match.code_id}`;
  const user = await upsertUser(email);
  const sessionId = await createSession(user.user_id);
  attachSessionCookie(c, sessionId);
  return c.json({ user });
});

app.post("/api/auth/sign-out", async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/auth/me", (c) => c.json({ user: c.get("user") }));

app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  return c.json({ results: await searchProperties(q) });
});

app.get("/api/parcels", async (c) => {
  const bbox = (c.req.query("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
    return c.json({ error: "bbox=west,south,east,north is required" }, 400);
  }
  return c.json(await parcelsInBbox(bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!));
});

app.get("/api/geo/county", async (c) => {
  const sql = getSql();
  const rows = await sql<{ geojson: unknown }[]>`
    SELECT ST_AsGeoJSON(ST_ConvexHull(ST_Collect(geom)))::json AS geojson
    FROM property_geometries WHERE is_current
  `;
  return c.json({
    type: "Feature",
    properties: { name: "Columbia County" },
    geometry: rows[0]?.geojson ?? null,
  });
});

app.get("/api/properties/:id", async (c) => {
  const page = await loadPropertyPage(c.req.param("id"));
  if (!page) return c.json({ error: "Property not found" }, 404);
  const user = c.get("user");
  const maintainer = user ? await isMaintainer(user.user_id, page.property_id) : false;
  return c.json({ property: page, viewer: { maintainer, admin: Boolean(user?.is_admin) } });
});

async function addressOf(propertyId: string): Promise<string> {
  const core = await loadPropertyCore(propertyId);
  return core?.formatted ?? "this property";
}

app.post("/api/properties/:id/claims", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  const core = await loadPropertyCore(propertyId);
  if (!core) return c.json({ error: "Property not found" }, 404);

  const body = await c.req.json<{
    method?: string;
    notes?: string;
    attestationAccepted?: boolean;
  }>();
  const method = body.method ?? "";
  if (!["tax_bill", "deed", "utility_and_id"].includes(method)) {
    return c.json({ error: "Choose a verification method." }, 400);
  }
  if (!body.attestationAccepted) {
    return c.json({ error: "You must attest that you are the current owner." }, 400);
  }

  const sql = getSql();
  const existing = await sql`
    SELECT claim_id FROM ownership_claims
    WHERE property_id = ${propertyId} AND user_id = ${user.user_id}
      AND status IN ('draft', 'pending')
  `;
  if (existing[0]) return c.json({ error: "You already have an open claim for this property.", claimId: existing[0].claim_id }, 409);

  const claimId = id("clm");
  await sql`
    INSERT INTO ownership_claims (
      claim_id, property_id, user_id, method, status, attestation_accepted, notes, submitted_at
    ) VALUES (
      ${claimId}, ${propertyId}, ${user.user_id}, ${method}, 'pending', true, ${body.notes ?? null}, now()
    )
  `;
  await emitEvent({
    propertyId,
    eventType: "ownership.claim_submitted",
    actorType: "user",
    actorId: user.user_id,
    payload: { claim_id: claimId, method },
  });

  const address = core.formatted ?? "this property";
  const received = claimReceivedEmail(config.appOrigin, address, claimId, propertyId);
  await sendMail({
    stream: "ownership",
    toEmail: user.primary_email,
    toUserId: user.user_id,
    subject: received.subject,
    html: received.html,
    text: received.text,
    templateKey: "claim_received",
    payload: { claimId, propertyId },
  });

  const admins = await sql<{ primary_email: string; user_id: string }[]>`
    SELECT primary_email, user_id FROM users WHERE is_admin
  `;
  const adminMail = adminClaimEmail(config.appOrigin, address, claimId);
  for (const admin of admins) {
    await sendMail({
      stream: "ownership",
      toEmail: admin.primary_email,
      toUserId: admin.user_id,
      subject: adminMail.subject,
      html: adminMail.html,
      text: adminMail.text,
      templateKey: "admin_claim",
    });
  }

  return c.json({ claimId, status: "pending" }, 201);
});

app.get("/api/claims/:id", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql`
    SELECT c.*, p.municipality, a.formatted
    FROM ownership_claims c
    JOIN properties p ON p.property_id = c.property_id
    LEFT JOIN property_addresses a ON a.property_id = c.property_id AND a.is_current
    WHERE c.claim_id = ${c.req.param("id")}
  `;
  const claim = rows[0];
  if (!claim) return c.json({ error: "Claim not found" }, 404);
  if (claim.user_id !== user.user_id && !user.is_admin) return c.json({ error: "Forbidden" }, 403);
  const documents = await sql`
    SELECT document_id, original_filename, document_type, mime_type, byte_size, created_at
    FROM documents WHERE claim_id = ${claim.claim_id}
  `;
  return c.json({ claim, documents });
});

app.get("/api/me/claims", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const claims = await sql`
    SELECT c.claim_id, c.property_id, c.method, c.status, c.submitted_at, a.formatted
    FROM ownership_claims c
    LEFT JOIN property_addresses a ON a.property_id = c.property_id AND a.is_current
    WHERE c.user_id = ${user.user_id}
    ORDER BY c.created_at DESC
  `;
  return c.json({ claims });
});

app.get("/api/me/properties", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const properties = await sql`
    SELECT p.property_id, p.municipality, a.formatted, m.role, m.verified_at
    FROM property_maintainers m
    JOIN properties p ON p.property_id = m.property_id
    LEFT JOIN property_addresses a ON a.property_id = p.property_id AND a.is_current
    WHERE m.user_id = ${user.user_id} AND m.revoked_at IS NULL
    ORDER BY a.formatted
  `;
  return c.json({ properties });
});

app.post("/api/properties/:id/documents", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  const sql = getSql();
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: "Choose a file to upload." }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "Files must be 15 MB or smaller." }, 400);

  const claimId = typeof form.claimId === "string" ? form.claimId : null;
  const visibility = typeof form.visibility === "string" ? form.visibility : "private";
  const transferability = typeof form.transferability === "string" ? form.transferability : "personal";
  const documentType = typeof form.documentType === "string" ? form.documentType : "other";

  if (claimId) {
    const claim = await sql`
      SELECT claim_id FROM ownership_claims
      WHERE claim_id = ${claimId} AND user_id = ${user.user_id} AND property_id = ${propertyId}
    `;
    if (!claim[0]) return c.json({ error: "Claim not found" }, 404);
  } else if (!(await isMaintainer(user.user_id, propertyId)) && !user.is_admin) {
    return c.json({ error: "Only a current maintainer can upload to this record." }, 403);
  }

  const documentId = id("doc");
  const key = documentKey(propertyId, documentId, file.name);
  await putDocument(key, new Uint8Array(await file.arrayBuffer()));
  await sql`
    INSERT INTO documents (
      document_id, property_id, claim_id, uploaded_by, storage_key, original_filename,
      mime_type, byte_size, document_type, visibility, transferability
    ) VALUES (
      ${documentId}, ${propertyId}, ${claimId}, ${user.user_id}, ${key}, ${file.name},
      ${file.type || "application/octet-stream"}, ${file.size}, ${documentType}, ${visibility}, ${transferability}
    )
  `;
  if (!claimId) {
    await emitEvent({
      propertyId,
      eventType: "document.added",
      actorType: "user",
      actorId: user.user_id,
      payload: { document_id: documentId, document_type: documentType, visibility, transferability },
    });
  }
  return c.json({ documentId }, 201);
});

app.get("/api/properties/:id/documents", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  const maintainer = await isMaintainer(user.user_id, propertyId);
  if (!maintainer && !user.is_admin) return c.json({ error: "Forbidden" }, 403);
  const sql = getSql();
  const documents = await sql`
    SELECT document_id, original_filename, document_type, visibility, transferability,
           mime_type, byte_size, created_at, claim_id
    FROM documents
    WHERE property_id = ${propertyId} AND claim_id IS NULL
    ORDER BY created_at DESC
  `;
  return c.json({ documents });
});

app.patch("/api/documents/:id", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ document_id: string; property_id: string }[]>`
    SELECT document_id, property_id FROM documents WHERE document_id = ${c.req.param("id")}
  `;
  const doc = rows[0];
  if (!doc) return c.json({ error: "Not found" }, 404);
  if (!(await isMaintainer(user.user_id, doc.property_id)) && !user.is_admin) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const body = await c.req.json<{ visibility?: string; transferability?: string }>();
  await sql`
    UPDATE documents
    SET
      visibility = COALESCE(${body.visibility ?? null}, visibility),
      transferability = COALESCE(${body.transferability ?? null}, transferability)
    WHERE document_id = ${doc.document_id}
  `;
  return c.json({ ok: true });
});

app.get("/api/documents/:id/file", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{
    storage_key: string;
    mime_type: string | null;
    original_filename: string | null;
    property_id: string;
    claim_id: string | null;
    uploaded_by: string | null;
    visibility: string;
  }[]>`
    SELECT storage_key, mime_type, original_filename, property_id, claim_id, uploaded_by, visibility
    FROM documents WHERE document_id = ${c.req.param("id")}
  `;
  const doc = rows[0];
  if (!doc) return c.json({ error: "Not found" }, 404);
  const allowed = user.is_admin
    || doc.uploaded_by === user.user_id
    || await isMaintainer(user.user_id, doc.property_id);
  if (!allowed) return c.json({ error: "Forbidden" }, 403);
  const bytes = await getDocument(doc.storage_key);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": doc.mime_type || "application/octet-stream",
      "content-disposition": `inline; filename="${doc.original_filename ?? "document"}"`,
    },
  });
});

app.post("/api/properties/:id/owner-fields", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  if (!(await isMaintainer(user.user_id, propertyId))) {
    return c.json({ error: "Only a current maintainer can edit the owner record." }, 403);
  }
  const body = await c.req.json<{ fields?: Record<string, unknown> }>();
  const fields = body.fields ?? {};
  const sql = getSql();
  const contributionId = id("con");
  const entries = Object.entries(fields).filter(([, value]) => value !== "" && value !== null && value !== undefined);
  await sql`
    INSERT INTO contributions (
      contribution_id, property_id, contributor_user_id, contributor_type, status, summary, resolved_at, resolved_by
    ) VALUES (
      ${contributionId}, ${propertyId}, ${user.user_id}, 'verified_owner', 'accepted',
      ${`Owner updated ${entries.length} field${entries.length === 1 ? "" : "s"}`}, now(), ${user.user_id}
    )
  `;
  for (const [fieldKey, value] of entries) {
    await sql`
      INSERT INTO contribution_assertions (contribution_assertion_id, contribution_id, field_key, value_json)
      VALUES (${id("cas")}, ${contributionId}, ${fieldKey}, ${sql.json({ value } as never)})
    `;
    await insertAssertion({
      propertyId,
      fieldKey,
      value,
      sourceType: "verified_owner",
      actorType: "verified_owner",
      actorId: user.user_id,
      eventType: "owner_assertion.added",
    });
  }
  return c.json({ contributionId, updated: entries.length });
});

app.post("/api/properties/:id/handoff", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  if (!(await isMaintainer(user.user_id, propertyId))) {
    return c.json({ error: "Only a current maintainer can start a handoff." }, 403);
  }
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email.includes("@")) return c.json({ error: "Enter the buyer’s email." }, 400);
  const sql = getSql();
  const invitationId = id("inv");
  await sql`
    INSERT INTO handoff_invitations (invitation_id, property_id, invited_email, invited_by)
    VALUES (${invitationId}, ${propertyId}, ${email}, ${user.user_id})
  `;
  const address = await addressOf(propertyId);
  const template = handoffEmail(config.appOrigin, address, propertyId, user.display_name || user.primary_email);
  await sendMail({
    stream: "ownership",
    toEmail: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    templateKey: "handoff",
  });
  await emitEvent({
    propertyId,
    eventType: "ownership.handoff_invited",
    actorType: "user",
    actorId: user.user_id,
    payload: { invitation_id: invitationId, invited_email: email },
  });
  return c.json({ invitationId }, 201);
});

app.get("/api/admin/claims", async (c) => {
  requireAdmin(c);
  const sql = getSql();
  const status = c.req.query("status") ?? "pending";
  const claims = await sql`
    SELECT c.*, a.formatted, u.primary_email, u.display_name
    FROM ownership_claims c
    JOIN users u ON u.user_id = c.user_id
    LEFT JOIN property_addresses a ON a.property_id = c.property_id AND a.is_current
    WHERE ${status === "all" ? sql`TRUE` : sql`c.status = ${status}`}
    ORDER BY c.submitted_at DESC NULLS LAST, c.created_at DESC
  `;
  return c.json({ claims });
});

app.post("/api/admin/claims/:id/review", async (c) => {
  const admin = requireAdmin(c);
  const body = await c.req.json<{ decision?: string; note?: string }>();
  if (body.decision !== "verified" && body.decision !== "rejected") {
    return c.json({ error: "Decision must be verified or rejected." }, 400);
  }
  const sql = getSql();
  const rows = await sql`
    SELECT c.*, a.formatted, u.primary_email
    FROM ownership_claims c
    JOIN users u ON u.user_id = c.user_id
    LEFT JOIN property_addresses a ON a.property_id = c.property_id AND a.is_current
    WHERE c.claim_id = ${c.req.param("id")}
  `;
  const claim = rows[0];
  if (!claim) return c.json({ error: "Claim not found" }, 404);
  if (claim.status !== "pending") return c.json({ error: "This claim is no longer pending." }, 400);

  if (body.decision === "verified") {
    await sql`
      UPDATE property_maintainers
      SET revoked_at = now()
      WHERE property_id = ${claim.property_id} AND revoked_at IS NULL AND user_id <> ${claim.user_id}
    `;
    await sql`
      INSERT INTO property_maintainers (maintainer_id, property_id, user_id, role)
      VALUES (${id("mnt")}, ${claim.property_id}, ${claim.user_id}, 'owner')
    `;
    await sql`
      UPDATE ownership_claims
      SET status = 'verified', verified_at = now(), reviewed_by = ${admin.user_id}, reviewer_note = ${body.note ?? null}
      WHERE claim_id = ${claim.claim_id}
    `;
    await sql`
      UPDATE ownership_claims
      SET status = 'superseded'
      WHERE property_id = ${claim.property_id}
        AND claim_id <> ${claim.claim_id}
        AND status IN ('verified')
    `;
    await emitEvent({
      propertyId: claim.property_id,
      eventType: "ownership.claimed",
      actorType: "platform_admin",
      actorId: admin.user_id,
      payload: { claim_id: claim.claim_id, user_id: claim.user_id },
    });
  } else {
    await sql`
      UPDATE ownership_claims
      SET status = 'rejected', reviewed_by = ${admin.user_id}, reviewer_note = ${body.note ?? null}
      WHERE claim_id = ${claim.claim_id}
    `;
    await emitEvent({
      propertyId: claim.property_id,
      eventType: "ownership.claim_rejected",
      actorType: "platform_admin",
      actorId: admin.user_id,
      payload: { claim_id: claim.claim_id },
    });
  }

  const template = claimReviewedEmail(
    config.appOrigin,
    claim.formatted ?? "this property",
    claim.property_id,
    body.decision === "verified",
    body.note,
  );
  await sendMail({
    stream: "ownership",
    toEmail: claim.primary_email,
    toUserId: claim.user_id,
    subject: template.subject,
    html: template.html,
    text: template.text,
    templateKey: body.decision === "verified" ? "claim_verified" : "claim_rejected",
  });
  return c.json({ ok: true, status: body.decision });
});

app.get("/api/admin/sources", async (c) => {
  requireAdmin(c);
  const sql = getSql();
  const sources = await sql`SELECT * FROM sources ORDER BY name`;
  return c.json({ sources });
});

app.get("/api/dev/mailbox", async (c) => {
  if (!isDevExperience()) return c.json({ error: "Mailbox is only available in local development." }, 404);
  const sql = getSql();
  const to = c.req.query("to");
  const emails = await sql`
    SELECT email_id, stream, to_email, subject, template_key, sent_at, read_at
    FROM emails
    WHERE ${to ? sql`to_email = ${to}` : sql`TRUE`}
    ORDER BY sent_at DESC
    LIMIT 100
  `;
  return c.json({ emails });
});

app.get("/api/dev/mailbox/:id", async (c) => {
  if (!isDevExperience()) return c.json({ error: "Mailbox is only available in local development." }, 404);
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM emails WHERE email_id = ${c.req.param("id")}
  `;
  const email = rows[0];
  if (!email) return c.json({ error: "Not found" }, 404);
  await sql`UPDATE emails SET read_at = COALESCE(read_at, now()) WHERE email_id = ${email.email_id}`;
  return c.json({ email });
});

export default app;
