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
import { DEBUG_CLAIM_PIN, DEBUG_OWNER_EMAIL, debugEnabled, isFixedSignin, pinMatches } from "./debug.ts";
import { id } from "./ids.ts";
import { insertAssertion, ownerAssertionVisibility, retractOwnerAssertion, setOwnerAssertionVisibility } from "./services/assertions.ts";
import { emitEvent } from "./services/events.ts";
import {
  adminClaimEmail,
  authCodeEmail,
  claimReceivedEmail,
  claimReviewedEmail,
  coOwnerInviteEmail,
  handoffEmail,
  ownershipRevokedEmail,
  sendMail,
} from "./services/mail.ts";
import { COUNTY_PROFILES, DEFAULT_MAP, isGeometryQuality } from "./counties.ts";
import { isRoomKind, normalizeRoomDetails } from "../../shared/rooms.ts";
import {
  DOCUMENT_TYPES,
  IMPROVEMENT_CATEGORIES,
  loadDocuments,
  loadImprovements,
  loadRooms,
  loadInbox,
  loadOpenDisputes,
  loadPendingInvitations,
  loadPreferences,
  openDispute,
  parseCostCents,
  parseDate,
  pendingInvitationFor,
  PREFERENCE_OPTIONS,
  reviewContribution,
  savePreferences,
  setCoverPhoto,
  TRANSFERABLE_TYPES,
} from "./services/owner.ts";
import { addCoMaintainer, grantOwnership, revokeOwnership } from "./services/ownership.ts";
import {
  loadPropertyCore,
  loadPropertyPage,
  parcelsInBbox,
  parcelTile,
  searchProperties,
  TILE_LAYER,
  TILE_MAX_ZOOM,
  TILE_MIN_ZOOM,
} from "./services/properties.ts";
import { storeUpload, type OptimizedPhoto } from "./services/photos.ts";
import { getDocument } from "./services/storage.ts";
import { FIELD_BY_KEY, FIELD_VOCAB, ownerWritable } from "./vocab.ts";

export const app = new Hono<AppEnv>();

app.use("*", cors({
  origin: (origin) => {
    if (!origin) return origin;
    const allowed = [config.appOrigin, "http://localhost:5173", "http://127.0.0.1:5173"];
    if (allowed.includes(origin)) return origin;
    try {
      const host = new URL(origin).hostname;
      if (host.endsWith(".workers.dev") || host === "localhost" || host === "127.0.0.1") return origin;
    } catch {
      return null;
    }
    return null;
  },
  credentials: true,
}));
app.use("/api/*", authMiddleware);
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/tiles/")) return;
  if (!c.res.headers.has("Cache-Control") && !c.res.headers.has("cache-control")) {
    c.header("Cache-Control", "private, no-store");
  }
});

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
  const totals = await sql<{ county: string; n: number; shapes: number; quality: string | null }[]>`
    SELECT
      p.county,
      count(*)::int AS n,
      count(g.geometry_id)::int AS shapes,
      mode() WITHIN GROUP (ORDER BY g.quality) AS quality
    FROM properties p
    LEFT JOIN property_geometries g ON g.property_id = p.property_id AND g.is_current
    GROUP BY p.county
  `;
  const byCounty = new Map(totals.map((row) => [row.county, row]));
  const counties = COUNTY_PROFILES.map((county) => {
    const row = byCounty.get(county.id);
    const quality = isGeometryQuality(row?.quality) ? row.quality : null;
    return {
      ...county,
      parcelCount: row?.n ?? 0,
      shapeCount: row?.shapes ?? 0,
      geometryQuality: quality,
    };
  });
  return c.json({
    product: "Myplace",
    coverage: "Columbia and Greene counties, New York",
    propertyCount: totals.reduce((sum, row) => sum + row.n, 0),
    demonstration: counties.some((county) => county.parcelCount > 0 && county.geometryQuality === "demonstration"),
    ownerVerification: "manual_review",
    devMailbox: isDevExperience(),
    // Local-only shortcuts (PIN claim, debug sheet). Always false in production.
    debug: debugEnabled(),
    counties,
    map: { ...DEFAULT_MAP, tiles: "/api/tiles/{z}/{x}/{y}.mvt", tileLayer: TILE_LAYER, minZoom: TILE_MIN_ZOOM, maxZoom: TILE_MAX_ZOOM },
    vocab: FIELD_VOCAB,
    improvementCategories: IMPROVEMENT_CATEGORIES,
    documentTypes: DOCUMENT_TYPES,
    preferenceOptions: PREFERENCE_OPTIONS,
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
  if (recent.length && config.isProduction) {
    return c.json({ error: "Wait a moment before requesting another code." }, 429);
  }
  await sql`
    UPDATE auth_codes SET consumed_at = now()
    WHERE email = ${email} AND consumed_at IS NULL AND purpose = 'signin'
  `;

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
  const debugBypass = isFixedSignin(email, code);
  if (!debugBypass) {
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
  }
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

app.get("/api/tiles/:z/:x/:y", async (c) => {
  const z = Number(c.req.param("z"));
  const x = Number(c.req.param("x"));
  const y = Number(c.req.param("y").replace(/\.(mvt|pbf)$/, ""));
  const valid = [z, x, y].every(Number.isInteger) && z >= 0 && z <= 22
    && x >= 0 && x < 2 ** z && y >= 0 && y < 2 ** z;
  if (!valid) return c.json({ error: "Tile path must be /api/tiles/{z}/{x}/{y}.mvt" }, 400);
  const headers = {
    "content-type": "application/vnd.mapbox-vector-tile",
    "cache-control": config.isProduction ? "public, max-age=3600" : "public, max-age=60",
  };
  if (z < TILE_MIN_ZOOM) return new Response(null, { status: 204, headers });
  const tile = await parcelTile(z, x, y);
  if (!tile) return new Response(null, { status: 204, headers });
  // Copy into a fresh ArrayBuffer so MapLibre gets raw protobuf, not a gzip
  // wrapper or a postgres.js view that some mobile browsers fail to parse.
  const body = Uint8Array.from(tile);
  return new Response(body, { status: 200, headers });
});

app.get("/api/geo/counties", async (c) => {
  const sql = getSql();
  const rows = await sql<{ county: string; quality: string | null; geojson: unknown }[]>`
    SELECT
      p.county,
      mode() WITHIN GROUP (ORDER BY g.quality) AS quality,
      ST_AsGeoJSON(ST_ConvexHull(ST_Collect(g.geom)))::json AS geojson
    FROM property_geometries g
    JOIN properties p ON p.property_id = g.property_id
    WHERE g.is_current
    GROUP BY p.county
  `;
  return c.json({
    type: "FeatureCollection",
    features: rows.map((row) => {
      const profile = COUNTY_PROFILES.find((county) => county.id === row.county);
      return {
        type: "Feature",
        properties: {
          name: profile?.name ?? `${row.county} County`,
          county: row.county,
          geometryPolicy: profile?.geometryPolicy ?? null,
          geometryQuality: row.quality,
        },
        geometry: row.geojson,
      };
    }),
  });
});

app.get("/api/geo/county", async (c) => {
  const sql = getSql();
  const requested = c.req.query("name") ?? "Columbia";
  const profile = COUNTY_PROFILES.find((county) => county.id.toLowerCase() === requested.toLowerCase());
  const rows = await sql<{ quality: string | null; geojson: unknown }[]>`
    SELECT
      mode() WITHIN GROUP (ORDER BY g.quality) AS quality,
      ST_AsGeoJSON(ST_ConvexHull(ST_Collect(g.geom)))::json AS geojson
    FROM property_geometries g
    JOIN properties p ON p.property_id = g.property_id
    WHERE g.is_current AND p.county = ${profile?.id ?? requested}
  `;
  return c.json({
    type: "Feature",
    properties: {
      name: profile?.name ?? `${requested} County`,
      county: profile?.id ?? requested,
      geometryPolicy: profile?.geometryPolicy ?? null,
      geometryQuality: rows[0]?.quality ?? null,
    },
    geometry: rows[0]?.geojson ?? null,
  });
});

app.get("/api/properties/:id", async (c) => {
  const propertyId = c.req.param("id");
  const user = c.get("user");
  const sql = getSql();
  const openClaim = user
    ? (await sql<{ claim_id: string; status: string }[]>`
        SELECT claim_id, status FROM ownership_claims
        WHERE property_id = ${propertyId} AND user_id = ${user.user_id} AND status IN ('draft', 'pending')
        ORDER BY created_at DESC LIMIT 1
      `)[0] ?? null
    : null;
  // A claim still under review is not ownership. Admin status is not either.
  const maintainer = Boolean(user && !openClaim && await isMaintainer(user.user_id, propertyId));
  const page = await loadPropertyPage(propertyId, { viewerIsMaintainer: maintainer });
  if (!page) return c.json({ error: "Property not found" }, 404);
  const role = maintainer && user
    ? (await sql<{ role: string; verified_at: string }[]>`
        SELECT role, verified_at FROM property_maintainers
        WHERE property_id = ${page.property_id} AND user_id = ${user.user_id} AND revoked_at IS NULL
      `)[0] ?? null
    : null;
  const disputes = await loadOpenDisputes(page.property_id);
  const facts = page.facts.map((fact) => {
    const dispute = disputes.find((item) => item.fieldKey === fact.fieldKey);
    return dispute ? { ...fact, dispute } : fact;
  });
  const [improvements, rooms, documents, invitations, invitation, preferences, inbox] = await Promise.all([
    loadImprovements(page.property_id, maintainer),
    loadRooms(page.property_id, maintainer),
    loadDocuments(page.property_id, maintainer),
    maintainer ? loadPendingInvitations(page.property_id) : Promise.resolve([]),
    user && !maintainer ? pendingInvitationFor(page.property_id, user.primary_email) : Promise.resolve(null),
    maintainer && user ? loadPreferences(user.user_id, page.property_id) : Promise.resolve(null),
    maintainer ? loadInbox(page.property_id) : Promise.resolve([]),
  ]);
  return c.json({
    property: { ...page, facts, improvements, rooms, documents, invitations, disputes },
    viewer: {
      maintainer,
      role: role?.role ?? null,
      verifiedAt: role?.verified_at ?? null,
      admin: Boolean(user?.is_admin),
      invitation,
      preferences,
      openClaim,
      inboxCount: inbox.length,
    },
  });
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

  const alreadyOwned = await sql`
    SELECT 1 FROM property_maintainers
    WHERE property_id = ${propertyId} AND revoked_at IS NULL
    LIMIT 1
  `;
  if (alreadyOwned[0]) {
    const invite = await pendingInvitationFor(propertyId, user.primary_email);
    if (invite?.role !== "owner") {
      return c.json({ error: "This property already has a verified owner. A transfer starts when they invite you from the handoff section." }, 409);
    }
  }

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
  if (file.size === 0) return c.json({ error: "That file was empty. Try choosing it again." }, 400);
  if (file.size > 20 * 1024 * 1024) return c.json({ error: "Files must be 20 MB or smaller." }, 400);

  const claimId = typeof form.claimId === "string" && form.claimId ? form.claimId : null;
  const improvementId = typeof form.improvementId === "string" && form.improvementId ? form.improvementId : null;
  const roomId = typeof form.roomId === "string" && form.roomId ? form.roomId : null;
  const caption = typeof form.caption === "string" && form.caption.trim() ? form.caption.trim() : null;
  const isImage = file.type.startsWith("image/");
  const asCover = form.cover === "true" && isImage && !claimId;
  const requestedType = typeof form.documentType === "string" && form.documentType ? form.documentType : null;
  const documentType = requestedType ?? (improvementId || roomId ? (isImage ? "photo" : "receipt") : isImage ? "photo" : "other");
  const visibility = typeof form.visibility === "string" && form.visibility
    ? form.visibility
    : (documentType === "photo" || isImage ? "public" : "private");
  const transferability = typeof form.transferability === "string" && form.transferability
    ? form.transferability
    : TRANSFERABLE_TYPES.has(documentType) ? "property_transferable" : "personal";
  if (!["private", "property_transferable", "public"].includes(visibility)) {
    return c.json({ error: "Unknown visibility." }, 400);
  }
  if (!["personal", "property_transferable"].includes(transferability)) {
    return c.json({ error: "Unknown transferability." }, 400);
  }

  if (claimId) {
    const claim = await sql`
      SELECT claim_id FROM ownership_claims
      WHERE claim_id = ${claimId} AND user_id = ${user.user_id} AND property_id = ${propertyId}
    `;
    if (!claim[0]) return c.json({ error: "Claim not found" }, 404);
  } else if (!(await isMaintainer(user.user_id, propertyId))) {
    return c.json({ error: "Only a current maintainer can upload to this record." }, 403);
  }
  if (improvementId) {
    const improvement = await sql`
      SELECT improvement_id FROM property_improvements
      WHERE improvement_id = ${improvementId} AND property_id = ${propertyId} AND removed_at IS NULL
    `;
    if (!improvement[0]) return c.json({ error: "Improvement not found" }, 404);
  }
  if (roomId) {
    const room = await sql`
      SELECT room_id FROM property_rooms
      WHERE room_id = ${roomId} AND property_id = ${propertyId} AND removed_at IS NULL
    `;
    if (!room[0]) return c.json({ error: "Room not found" }, 404);
  }

  const documentId = id("doc");
  const upload = await storeUpload(propertyId, documentId, file);
  const { stored, key } = upload;
  await sql`
    INSERT INTO documents (
      document_id, property_id, claim_id, improvement_id, room_id, uploaded_by, storage_key, original_filename,
      mime_type, byte_size, document_type, visibility, transferability, caption
    ) VALUES (
      ${documentId}, ${propertyId}, ${claimId}, ${improvementId}, ${roomId}, ${user.user_id}, ${key}, ${stored.filename},
      ${stored.mime}, ${stored.bytes.byteLength}, ${documentType}, ${visibility}, ${transferability}, ${caption}
    )
  `;
  upload.commit((optimized, optimizedKey) => recordOptimizedFile(documentId, optimized, optimizedKey));
  if (asCover) await setCoverPhoto(propertyId, documentId);
  if (!claimId) {
    await emitEvent({
      propertyId,
      eventType: isImage ? "photo.added" : "document.added",
      actorType: "verified_owner",
      actorId: user.user_id,
      payload: { document_id: documentId, document_type: documentType, visibility, transferability, improvement_id: improvementId },
    });
  }
  return c.json({ documentId, documentType, visibility, transferability }, 201);
});

app.get("/api/properties/:id/documents", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  const maintainer = await isMaintainer(user.user_id, propertyId);
  if (!maintainer) return c.json({ error: "Forbidden" }, 403);
  return c.json({ documents: await loadDocuments(propertyId, true) });
});

/** Point a document row at the encode that finished after its upload responded. */
async function recordOptimizedFile(documentId: string, stored: OptimizedPhoto, key: string): Promise<void> {
  await getSql()`
    UPDATE documents
    SET storage_key = ${key}, original_filename = ${stored.filename}, mime_type = ${stored.mime}, byte_size = ${stored.bytes.byteLength}
    WHERE document_id = ${documentId}
  `;
}

async function loadOwnedDocument(c: Parameters<typeof requireUser>[0], documentId: string) {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ document_id: string; property_id: string; document_type: string | null }[]>`
    SELECT document_id, property_id, document_type FROM documents WHERE document_id = ${documentId} AND removed_at IS NULL
  `;
  const doc = rows[0];
  if (!doc) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!(await isMaintainer(user.user_id, doc.property_id))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return { user, doc };
}

app.patch("/api/documents/:id", async (c) => {
  const { doc } = await loadOwnedDocument(c, c.req.param("id"));
  const sql = getSql();
  const body = await c.req.json<{ visibility?: string; transferability?: string; documentType?: string; caption?: string; cover?: boolean }>();
  if (body.visibility && !["private", "property_transferable", "public"].includes(body.visibility)) {
    return c.json({ error: "Unknown visibility." }, 400);
  }
  if (body.transferability && !["personal", "property_transferable"].includes(body.transferability)) {
    return c.json({ error: "Unknown transferability." }, 400);
  }
  if (body.cover === true) await setCoverPhoto(doc.property_id, doc.document_id);
  if (body.cover === false) await sql`UPDATE documents SET is_cover = FALSE WHERE document_id = ${doc.document_id}`;
  await sql`
    UPDATE documents
    SET
      visibility = COALESCE(${body.visibility ?? null}, visibility),
      transferability = COALESCE(${body.transferability ?? null}, transferability),
      document_type = COALESCE(${body.documentType ?? null}, document_type),
      caption = CASE WHEN ${body.caption === undefined} THEN caption ELSE ${body.caption ?? null} END
    WHERE document_id = ${doc.document_id}
  `;
  return c.json({ ok: true });
});

app.delete("/api/documents/:id", async (c) => {
  const { user, doc } = await loadOwnedDocument(c, c.req.param("id"));
  const sql = getSql();
  await sql`UPDATE documents SET removed_at = now() WHERE document_id = ${doc.document_id}`;
  await emitEvent({
    propertyId: doc.property_id,
    eventType: "document.removed",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { document_id: doc.document_id, document_type: doc.document_type },
  });
  return c.json({ ok: true });
});

app.post("/api/documents/:id/file", async (c) => {
  const { user, doc } = await loadOwnedDocument(c, c.req.param("id"));
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: "Choose a file to upload." }, 400);
  if (file.size === 0) return c.json({ error: "That file was empty. Try choosing it again." }, 400);
  if (file.size > 20 * 1024 * 1024) return c.json({ error: "Files must be 20 MB or smaller." }, 400);
  const upload = await storeUpload(doc.property_id, doc.document_id, file);
  const { stored, key } = upload;
  const sql = getSql();
  const isImage = stored.mime.startsWith("image/");
  await sql`
    UPDATE documents
    SET
      storage_key = ${key},
      original_filename = ${stored.filename},
      mime_type = ${stored.mime},
      byte_size = ${stored.bytes.byteLength},
      document_type = CASE
        WHEN document_type = 'photo' OR ${isImage} THEN 'photo'
        ELSE document_type
      END
    WHERE document_id = ${doc.document_id}
  `;
  upload.commit((optimized, optimizedKey) => recordOptimizedFile(doc.document_id, optimized, optimizedKey));
  await emitEvent({
    propertyId: doc.property_id,
    eventType: isImage || doc.document_type === "photo" ? "photo.replaced" : "document.replaced",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { document_id: doc.document_id, document_type: doc.document_type },
  });
  return c.json({ ok: true });
});

async function requireMaintainer(c: Parameters<typeof requireUser>[0], propertyId: string) {
  const user = requireUser(c);
  if (!(await isMaintainer(user.user_id, propertyId))) {
    throw Object.assign(new Error("Only a current maintainer can do that."), { status: 403 });
  }
  return user;
}

app.post("/api/properties/:id/improvements", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const body = await c.req.json<{
    title?: string;
    category?: string;
    performedAt?: string;
    cost?: string | number;
    contractor?: string;
    notes?: string;
    visibility?: string;
  }>();
  const title = body.title?.trim() ?? "";
  if (!title) return c.json({ error: "Give the improvement a short title." }, 400);
  const category = (IMPROVEMENT_CATEGORIES as readonly string[]).includes(body.category ?? "") ? body.category! : "other";
  const visibility = body.visibility === "public" ? "public" : "private";
  const sql = getSql();
  const improvementId = id("imp");
  await sql`
    INSERT INTO property_improvements (
      improvement_id, property_id, created_by, title, category, performed_at, cost_cents, contractor, notes, visibility
    ) VALUES (
      ${improvementId}, ${propertyId}, ${user.user_id}, ${title}, ${category}, ${parseDate(body.performedAt)},
      ${parseCostCents(body.cost)}, ${body.contractor?.trim() || null}, ${body.notes?.trim() || null}, ${visibility}
    )
  `;
  await emitEvent({
    propertyId,
    eventType: "improvement.added",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { improvement_id: improvementId, title, category },
    effectiveAt: parseDate(body.performedAt) ?? new Date(),
  });
  const [improvement] = await loadImprovements(propertyId, true).then((list) => list.filter((row) => row.improvement_id === improvementId));
  return c.json({ improvement }, 201);
});

async function loadOwnedImprovement(c: Parameters<typeof requireUser>[0], improvementId: string) {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ improvement_id: string; property_id: string; title: string }[]>`
    SELECT improvement_id, property_id, title FROM property_improvements
    WHERE improvement_id = ${improvementId} AND removed_at IS NULL
  `;
  const improvement = rows[0];
  if (!improvement) throw Object.assign(new Error("Improvement not found"), { status: 404 });
  if (!(await isMaintainer(user.user_id, improvement.property_id))) {
    throw Object.assign(new Error("Only a current maintainer can do that."), { status: 403 });
  }
  return { user, improvement };
}

app.patch("/api/improvements/:id", async (c) => {
  const { user, improvement } = await loadOwnedImprovement(c, c.req.param("id"));
  const body = await c.req.json<{
    title?: string;
    category?: string;
    performedAt?: string | null;
    cost?: string | number | null;
    contractor?: string | null;
    notes?: string | null;
    visibility?: string;
  }>();
  const sql = getSql();
  const title = body.title === undefined ? null : body.title.trim();
  if (title === "") return c.json({ error: "Give the improvement a short title." }, 400);
  const category = body.category !== undefined && (IMPROVEMENT_CATEGORIES as readonly string[]).includes(body.category)
    ? body.category
    : null;
  const visibility = body.visibility === "public" || body.visibility === "private" ? body.visibility : null;
  await sql`
    UPDATE property_improvements
    SET
      title = COALESCE(${title}, title),
      category = COALESCE(${category}, category),
      visibility = COALESCE(${visibility}, visibility),
      performed_at = CASE WHEN ${body.performedAt === undefined} THEN performed_at ELSE ${parseDate(body.performedAt)} END,
      cost_cents = CASE WHEN ${body.cost === undefined} THEN cost_cents ELSE ${parseCostCents(body.cost)} END,
      contractor = CASE WHEN ${body.contractor === undefined} THEN contractor ELSE ${body.contractor?.trim() || null} END,
      notes = CASE WHEN ${body.notes === undefined} THEN notes ELSE ${body.notes?.trim() || null} END
    WHERE improvement_id = ${improvement.improvement_id}
  `;
  await emitEvent({
    propertyId: improvement.property_id,
    eventType: "improvement.updated",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { improvement_id: improvement.improvement_id },
  });
  const [updated] = await loadImprovements(improvement.property_id, true)
    .then((list) => list.filter((row) => row.improvement_id === improvement.improvement_id));
  return c.json({ improvement: updated });
});

app.delete("/api/improvements/:id", async (c) => {
  const { user, improvement } = await loadOwnedImprovement(c, c.req.param("id"));
  const sql = getSql();
  await sql`UPDATE property_improvements SET removed_at = now() WHERE improvement_id = ${improvement.improvement_id}`;
  await sql`UPDATE documents SET removed_at = now() WHERE improvement_id = ${improvement.improvement_id} AND removed_at IS NULL`;
  await emitEvent({
    propertyId: improvement.property_id,
    eventType: "improvement.removed",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { improvement_id: improvement.improvement_id, title: improvement.title },
  });
  return c.json({ ok: true });
});

app.post("/api/properties/:id/rooms", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const body = await c.req.json<{
    kind?: string;
    title?: string | null;
    details?: unknown;
    visibility?: string;
  }>();
  const kind = body.kind ?? "";
  if (!isRoomKind(kind)) return c.json({ error: "Choose a room." }, 400);
  const visibility = body.visibility === "private" ? "private" : "public";
  const details = normalizeRoomDetails(kind, body.details);
  const title = body.title?.trim() || null;
  const sql = getSql();
  const roomId = id("room");
  await sql`
    INSERT INTO property_rooms (room_id, property_id, created_by, kind, title, details, visibility)
    VALUES (${roomId}, ${propertyId}, ${user.user_id}, ${kind}, ${title}, ${sql.json(details)}, ${visibility})
  `;
  await emitEvent({
    propertyId,
    eventType: "room.added",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { room_id: roomId, kind },
  });
  const [room] = await loadRooms(propertyId, true).then((list) => list.filter((row) => row.room_id === roomId));
  return c.json({ room }, 201);
});

async function loadOwnedRoom(c: Parameters<typeof requireUser>[0], roomId: string) {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ room_id: string; property_id: string; kind: string }[]>`
    SELECT room_id, property_id, kind FROM property_rooms
    WHERE room_id = ${roomId} AND removed_at IS NULL
  `;
  const room = rows[0];
  if (!room) throw Object.assign(new Error("Room not found"), { status: 404 });
  if (!(await isMaintainer(user.user_id, room.property_id))) {
    throw Object.assign(new Error("Only a current maintainer can do that."), { status: 403 });
  }
  return { user, room };
}

app.patch("/api/rooms/:id", async (c) => {
  const { user, room } = await loadOwnedRoom(c, c.req.param("id"));
  const body = await c.req.json<{
    kind?: string;
    title?: string | null;
    details?: unknown;
    visibility?: string;
  }>();
  const kind = body.kind !== undefined ? body.kind : room.kind;
  if (!isRoomKind(kind)) return c.json({ error: "Choose a room." }, 400);
  const visibility = body.visibility === "public" || body.visibility === "private" ? body.visibility : null;
  const title = body.title === undefined ? undefined : body.title?.trim() || null;
  const details = body.details === undefined ? undefined : normalizeRoomDetails(kind, body.details);
  const sql = getSql();
  await sql`
    UPDATE property_rooms
    SET
      kind = ${kind},
      title = ${title === undefined ? sql`title` : title},
      details = ${details === undefined ? sql`details` : sql.json(details)},
      visibility = ${visibility ?? sql`visibility`}
    WHERE room_id = ${room.room_id}
  `;
  await emitEvent({
    propertyId: room.property_id,
    eventType: "room.updated",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { room_id: room.room_id, kind },
  });
  const [updated] = await loadRooms(room.property_id, true).then((list) => list.filter((row) => row.room_id === room.room_id));
  return c.json({ room: updated });
});

app.delete("/api/rooms/:id", async (c) => {
  const { user, room } = await loadOwnedRoom(c, c.req.param("id"));
  const sql = getSql();
  await sql`UPDATE property_rooms SET removed_at = now() WHERE room_id = ${room.room_id}`;
  await sql`UPDATE documents SET removed_at = now() WHERE room_id = ${room.room_id} AND removed_at IS NULL`;
  await emitEvent({
    propertyId: room.property_id,
    eventType: "room.removed",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { room_id: room.room_id, kind: room.kind },
  });
  return c.json({ ok: true });
});

app.post("/api/properties/:id/disputes", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const body = await c.req.json<{ fieldKey?: string; proposedValue?: unknown; note?: string }>();
  const field = FIELD_BY_KEY.get(body.fieldKey ?? "");
  if (!field || field.layer === "owner") return c.json({ error: "Only official facts can be disputed." }, 400);
  const note = body.note?.trim() || null;
  const proposed = typeof body.proposedValue === "string" ? body.proposedValue.trim() || null : body.proposedValue ?? null;
  if (!note && proposed === null) return c.json({ error: "Say what you believe is correct or why the fact is wrong." }, 400);
  const contributionId = await openDispute({ propertyId, userId: user.user_id, fieldKey: field.key, proposedValue: proposed, note });
  return c.json({ contributionId }, 201);
});

app.get("/api/properties/:id/inbox", async (c) => {
  const propertyId = c.req.param("id");
  await requireMaintainer(c, propertyId);
  return c.json({ items: await loadInbox(propertyId) });
});

app.post("/api/contributions/:id/review", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ property_id: string }[]>`
    SELECT property_id FROM contributions WHERE contribution_id = ${c.req.param("id")}
  `;
  const row = rows[0];
  if (!row) return c.json({ error: "Not found" }, 404);
  await requireMaintainer(c, row.property_id);
  const body = await c.req.json<{ decision?: string }>().catch(() => ({} as { decision?: string }));
  if (body.decision !== "accepted" && body.decision !== "rejected") {
    return c.json({ error: "Decision must be accepted or rejected." }, 400);
  }
  const result = await reviewContribution({
    contributionId: c.req.param("id"),
    reviewerId: user.user_id,
    decision: body.decision,
  });
  return c.json({ ok: true, propertyId: result.propertyId });
});

app.delete("/api/contributions/:id", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ contribution_id: string; property_id: string; contributor_user_id: string | null; status: string }[]>`
    SELECT contribution_id, property_id, contributor_user_id, status FROM contributions WHERE contribution_id = ${c.req.param("id")}
  `;
  const contribution = rows[0];
  if (!contribution) return c.json({ error: "Not found" }, 404);
  if (contribution.contributor_user_id !== user.user_id && !user.is_admin) return c.json({ error: "Forbidden" }, 403);
  if (contribution.status !== "needs_review") return c.json({ error: "This contribution is already resolved." }, 400);
  await sql`UPDATE contributions SET status = 'withdrawn', resolved_at = now(), resolved_by = ${user.user_id} WHERE contribution_id = ${contribution.contribution_id}`;
  await emitEvent({
    propertyId: contribution.property_id,
    eventType: "contribution.withdrawn",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { contribution_id: contribution.contribution_id },
  });
  return c.json({ ok: true });
});

app.get("/api/properties/:id/preferences", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  return c.json({ preferences: await loadPreferences(user.user_id, propertyId), options: PREFERENCE_OPTIONS });
});

app.put("/api/properties/:id/preferences", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const body = await c.req.json<{ preferences?: Record<string, unknown> }>();
  const preferences = await savePreferences(user.user_id, propertyId, body.preferences ?? {});
  return c.json({ preferences });
});

app.post("/api/properties/:id/maintainers/invite", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const body = await c.req.json<{ email?: string }>();
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email.includes("@")) return c.json({ error: "Enter the co-owner’s email." }, 400);
  if (email === user.primary_email) return c.json({ error: "You already maintain this record." }, 400);
  const sql = getSql();
  const already = await sql`
    SELECT 1 FROM property_maintainers m JOIN users u ON u.user_id = m.user_id
    WHERE m.property_id = ${propertyId} AND m.revoked_at IS NULL AND u.primary_email = ${email}
  `;
  if (already[0]) return c.json({ error: "That person already maintains this record." }, 409);
  await sql`
    UPDATE handoff_invitations SET status = 'superseded'
    WHERE property_id = ${propertyId} AND invited_email = ${email} AND role = 'co_owner' AND status = 'sent'
  `;
  const invitationId = id("inv");
  await sql`
    INSERT INTO handoff_invitations (invitation_id, property_id, invited_email, invited_by, role)
    VALUES (${invitationId}, ${propertyId}, ${email}, ${user.user_id}, 'co_owner')
  `;
  const address = await addressOf(propertyId);
  const template = coOwnerInviteEmail(config.appOrigin, address, propertyId, user.display_name || user.primary_email);
  await sendMail({
    stream: "ownership",
    toEmail: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    templateKey: "co_owner_invite",
    payload: { invitationId, propertyId },
  });
  await emitEvent({
    propertyId,
    eventType: "ownership.co_maintainer_invited",
    actorType: "verified_owner",
    actorId: user.user_id,
    payload: { invitation_id: invitationId, invited_email: email },
  });
  return c.json({ invitationId }, 201);
});

app.post("/api/invitations/:id/accept", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ invitation_id: string; property_id: string; invited_email: string; role: string; status: string }[]>`
    SELECT invitation_id, property_id, invited_email, role, status FROM handoff_invitations WHERE invitation_id = ${c.req.param("id")}
  `;
  const invitation = rows[0];
  if (!invitation || invitation.invited_email !== user.primary_email) return c.json({ error: "Invitation not found" }, 404);
  if (invitation.status !== "sent") return c.json({ error: "This invitation is no longer open." }, 400);
  if (invitation.role !== "co_owner") {
    return c.json({ error: "Handoff invitations are accepted by completing ownership verification.", claimPath: `/property/${invitation.property_id}/claim` }, 400);
  }
  await addCoMaintainer({ propertyId: invitation.property_id, userId: user.user_id, invitationId: invitation.invitation_id, actorId: user.user_id });
  return c.json({ ok: true, propertyId: invitation.property_id });
});

app.delete("/api/invitations/:id", async (c) => {
  const user = requireUser(c);
  const sql = getSql();
  const rows = await sql<{ invitation_id: string; property_id: string; status: string }[]>`
    SELECT invitation_id, property_id, status FROM handoff_invitations WHERE invitation_id = ${c.req.param("id")}
  `;
  const invitation = rows[0];
  if (!invitation) return c.json({ error: "Invitation not found" }, 404);
  if (!(await isMaintainer(user.user_id, invitation.property_id))) return c.json({ error: "Forbidden" }, 403);
  if (invitation.status !== "sent") return c.json({ error: "This invitation is no longer open." }, 400);
  await sql`UPDATE handoff_invitations SET status = 'cancelled' WHERE invitation_id = ${invitation.invitation_id}`;
  return c.json({ ok: true });
});

app.post("/api/properties/:id/maintainers/:maintainerId/remove", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const sql = getSql();
  const me = await sql<{ role: string }[]>`
    SELECT role FROM property_maintainers WHERE property_id = ${propertyId} AND user_id = ${user.user_id} AND revoked_at IS NULL
  `;
  if (me[0]?.role !== "owner") return c.json({ error: "Only an owner can remove a co-maintainer." }, 403);
  const target = await sql<{ user_id: string; role: string; primary_email: string }[]>`
    SELECT m.user_id, m.role, u.primary_email FROM property_maintainers m JOIN users u ON u.user_id = m.user_id
    WHERE m.maintainer_id = ${c.req.param("maintainerId")} AND m.property_id = ${propertyId} AND m.revoked_at IS NULL
  `;
  const row = target[0];
  if (!row) return c.json({ error: "Maintainer not found" }, 404);
  if (row.user_id === user.user_id) return c.json({ error: "Use a handoff to end your own maintainer role." }, 400);
  if (row.role === "owner") return c.json({ error: "Another owner can only be replaced through a verified claim." }, 400);
  await revokeOwnership({ propertyId, userId: row.user_id, actorType: "verified_owner", actorId: user.user_id, reason: "removed_by_owner" });
  const address = await addressOf(propertyId);
  const template = ownershipRevokedEmail(config.appOrigin, address, propertyId);
  await sendMail({
    stream: "ownership",
    toEmail: row.primary_email,
    toUserId: row.user_id,
    subject: template.subject,
    html: template.html,
    text: template.text,
    templateKey: "maintainer_removed",
  });
  return c.json({ ok: true });
});

/**
 * Serve a stored file. Public photos and documents on the profile are readable
 * by anyone; everything else needs the uploader, a maintainer, or an admin.
 */
app.get("/api/documents/:id/file", async (c) => {
  const sql = getSql();
  const rows = await sql<{
    storage_key: string;
    mime_type: string | null;
    original_filename: string | null;
    property_id: string;
    claim_id: string | null;
    uploaded_by: string | null;
    visibility: string;
    removed_at: string | null;
  }[]>`
    SELECT storage_key, mime_type, original_filename, property_id, claim_id, uploaded_by, visibility, removed_at
    FROM documents WHERE document_id = ${c.req.param("id")}
  `;
  const doc = rows[0];
  if (!doc) return c.json({ error: "Not found" }, 404);
  // The property page lists public photos and documents to every visitor, so the
  // file behind them must be readable without a session too. Everything else stays
  // behind the maintainer / uploader / admin check.
  const isPublic = doc.visibility === "public" && !doc.claim_id && !doc.removed_at;
  if (!isPublic) {
    const user = requireUser(c);
    const allowed = user.is_admin
      || doc.uploaded_by === user.user_id
      || await isMaintainer(user.user_id, doc.property_id);
    if (!allowed) return c.json({ error: "Forbidden" }, 403);
  }
  const bytes = await getDocument(doc.storage_key);
  const body = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes);
  const filename = (doc.original_filename ?? "document").replace(/["\r\n]/g, "_");
  return new Response(body as BodyInit, {
    headers: {
      "content-type": doc.mime_type || "application/octet-stream",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(body.byteLength),
      "cache-control": isPublic ? "private, max-age=300" : "private, no-store",
    },
  });
});

app.post("/api/properties/:id/owner-fields", async (c) => {
  const user = requireUser(c);
  const propertyId = c.req.param("id");
  if (!(await isMaintainer(user.user_id, propertyId))) {
    return c.json({ error: "Only a current maintainer can edit the owner record." }, 403);
  }
  const body = await c.req.json<{ fields?: Record<string, unknown>; visibility?: string }>();
  const fields = body.fields ?? {};
  const sql = getSql();
  const unknown = Object.keys(fields).find((key) => !ownerWritable(FIELD_BY_KEY.get(key)));
  if (unknown) return c.json({ error: `${unknown} is not an owner-maintained field.` }, 400);
  if (body.visibility !== undefined && body.visibility !== "public" && body.visibility !== "private") {
    return c.json({ error: "Visibility must be public or private." }, 400);
  }

  const cleared: string[] = [];
  const entries: Array<[string, unknown]> = [];
  for (const [fieldKey, raw] of Object.entries(fields)) {
    if (raw === "" || raw === null || raw === undefined) {
      cleared.push(fieldKey);
      continue;
    }
    const field = FIELD_BY_KEY.get(fieldKey)!;
    let value: unknown = typeof raw === "string" ? raw.trim() : raw;
    if (field.valueType === "number" || field.valueType === "money" || field.valueType === "acres" || field.valueType === "area") {
      const n = Number(String(value).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n)) return c.json({ error: `${field.label} must be a number.` }, 400);
      value = n;
    }
    if (field.valueType === "date") {
      const parsed = parseDate(value);
      if (!parsed) return c.json({ error: `${field.label} must be a date.` }, 400);
      value = parsed;
    }
    entries.push([fieldKey, value]);
  }

  let removed = 0;
  for (const fieldKey of cleared) removed += await retractOwnerAssertion(propertyId, fieldKey, user.user_id);

  let contributionId: string | null = null;
  if (entries.length) {
    contributionId = id("con");
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
      // Editing a value keeps whatever the owner already decided about sharing it.
      const visibility = body.visibility === "private" || body.visibility === "public"
        ? body.visibility
        : await ownerAssertionVisibility(propertyId, fieldKey);
      await insertAssertion({
        propertyId,
        fieldKey,
        value,
        sourceType: "verified_owner",
        visibility,
        actorType: "verified_owner",
        actorId: user.user_id,
        eventType: "owner_assertion.added",
      });
    }
  }
  return c.json({ contributionId, updated: entries.length, removed });
});

/** Show or hide one owner-maintained field on the public profile. */
app.post("/api/properties/:id/owner-fields/visibility", async (c) => {
  const propertyId = c.req.param("id");
  const user = await requireMaintainer(c, propertyId);
  const body = await c.req.json<{ fieldKey?: string; visibility?: string }>();
  const field = FIELD_BY_KEY.get(body.fieldKey ?? "");
  if (!ownerWritable(field)) return c.json({ error: "Only owner-maintained fields can be made private." }, 400);
  if (body.visibility !== "public" && body.visibility !== "private") {
    return c.json({ error: "Visibility must be public or private." }, 400);
  }
  const changed = await setOwnerAssertionVisibility({ propertyId, fieldKey: field.key, visibility: body.visibility, actorId: user.user_id });
  return c.json({ ok: true, changed, visibility: body.visibility });
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
    await grantOwnership({
      propertyId: claim.property_id,
      userId: claim.user_id,
      claimId: claim.claim_id,
      actorType: "platform_admin",
      actorId: admin.user_id,
      reviewerNote: body.note ?? null,
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

// ---------------------------------------------------------------------------
// Debug shortcuts. Local development only: every route below returns 404 when
// `debugEnabled()` is false, which is the case for every production build.
// ---------------------------------------------------------------------------

app.use("/api/dev/debug/*", async (c, next) => {
  if (!debugEnabled()) return c.json({ error: "Not found" }, 404);
  await next();
});

app.get("/api/dev/debug/state", async (c) => {
  const sql = getSql();
  const user = c.get("user");
  const maintainers = await sql`
    SELECT m.maintainer_id, m.property_id, m.role, m.verified_at, m.user_id,
           u.primary_email, u.display_name, a.formatted, p.municipality, p.county,
           (SELECT c.method FROM ownership_claims c
             WHERE c.property_id = m.property_id AND c.user_id = m.user_id AND c.status = 'verified'
             ORDER BY c.verified_at DESC NULLS LAST LIMIT 1) AS method
    FROM property_maintainers m
    JOIN users u ON u.user_id = m.user_id
    JOIN properties p ON p.property_id = m.property_id
    LEFT JOIN property_addresses a ON a.property_id = m.property_id AND a.is_current
    WHERE m.revoked_at IS NULL
    ORDER BY m.verified_at DESC
  `;
  return c.json({
    pin: DEBUG_CLAIM_PIN,
    debugOwnerEmail: DEBUG_OWNER_EMAIL,
    user,
    maintainers: maintainers.map((row) => ({ ...row, mine: user ? row.user_id === user.user_id : false })),
  });
});

/**
 * Fake-claim a parcel with the hardcoded PIN. Produces exactly the rows the
 * production review desk would: a verified claim, a maintainer role, the
 * `ownership.claimed` event, and the "ownership verified" email.
 */
app.post("/api/dev/debug/claim/:id", async (c) => {
  const propertyId = c.req.param("id");
  const core = await loadPropertyCore(propertyId);
  if (!core) return c.json({ error: "Property not found" }, 404);
  const body = await c.req.json<{ pin?: string }>().catch(() => ({} as { pin?: string }));
  if (!pinMatches(body.pin)) return c.json({ error: "That PIN is not correct." }, 400);

  let user = c.get("user");
  let signedIn = false;
  if (!user) {
    user = await upsertUser(DEBUG_OWNER_EMAIL);
    attachSessionCookie(c, await createSession(user.user_id));
    signedIn = true;
  }
  if (await isMaintainer(user.user_id, propertyId)) {
    return c.json({ ok: true, alreadyMaintainer: true, user, signedIn });
  }

  const sql = getSql();
  const existingOwner = await sql<{ primary_email: string }[]>`
    SELECT u.primary_email
    FROM property_maintainers m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.property_id = ${propertyId} AND m.revoked_at IS NULL
    LIMIT 1
  `;
  if (existingOwner[0]) {
    return c.json({
      error: `This property already has a verified owner (${existingOwner[0].primary_email}). Debug claim will not displace them.`,
    }, 409);
  }

  await sql`
    UPDATE ownership_claims SET status = 'superseded'
    WHERE property_id = ${propertyId} AND user_id = ${user.user_id} AND status IN ('draft', 'pending')
  `;
  const claimId = id("clm");
  await sql`
    INSERT INTO ownership_claims (
      claim_id, property_id, user_id, method, status, attestation_accepted, notes, submitted_at
    ) VALUES (
      ${claimId}, ${propertyId}, ${user.user_id}, 'debug_pin', 'pending', true, 'Debug PIN claim (local development)', now()
    )
  `;
  await emitEvent({
    propertyId,
    eventType: "ownership.claim_submitted",
    actorType: "user",
    actorId: user.user_id,
    payload: { claim_id: claimId, method: "debug_pin" },
  });
  await grantOwnership({
    propertyId,
    userId: user.user_id,
    claimId,
    actorType: "debug",
    actorId: user.user_id,
    reviewerNote: "Verified by debug PIN. Local development only.",
  });
  const template = claimReviewedEmail(config.appOrigin, core.formatted ?? "this property", propertyId, true);
  void sendMail({
    stream: "ownership",
    toEmail: user.primary_email,
    toUserId: user.user_id,
    subject: template.subject,
    html: template.html,
    text: template.text,
    templateKey: "claim_verified",
    payload: { claimId, propertyId, debug: true },
  }).catch((err) => console.error("claim_verified email failed", err));
  return c.json({ ok: true, claimId, user, signedIn }, 201);
});

/** Give up a maintainer role. Defaults to the signed-in user; the debug sheet may name another. */
app.post("/api/dev/debug/revoke/:id", async (c) => {
  const propertyId = c.req.param("id");
  const body = await c.req.json<{ userId?: string }>().catch(() => ({} as { userId?: string }));
  const current = c.get("user");
  const userId = body.userId ?? current?.user_id;
  if (!userId) return c.json({ error: "Nobody to revoke. Sign in or name a user." }, 400);
  const revoked = await revokeOwnership({
    propertyId,
    userId,
    actorType: "debug",
    actorId: current?.user_id ?? null,
    reason: "debug_revoke",
  });
  if (!revoked) return c.json({ error: "That user does not maintain this property." }, 404);
  const sql = getSql();
  const target = await sql<{ primary_email: string }[]>`SELECT primary_email FROM users WHERE user_id = ${userId}`;
  if (target[0]) {
    const template = ownershipRevokedEmail(config.appOrigin, await addressOf(propertyId), propertyId);
    await sendMail({
      stream: "ownership",
      toEmail: target[0].primary_email,
      toUserId: userId,
      subject: template.subject,
      html: template.html,
      text: template.text,
      templateKey: "maintainer_removed",
      payload: { propertyId, debug: true },
    });
  }
  return c.json({ ok: true });
});

export default app;
