export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data as T;
}

export const api = {
  meta: () => request<{
    product: string;
    coverage: string;
    propertyCount: number;
    demonstration: boolean;
    ownerVerification: string;
    devMailbox: boolean;
  }>("/api/meta"),
  me: () => request<{ user: User | null }>("/api/auth/me"),
  requestCode: (email: string) =>
    request<{ ok: boolean }>("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }) }),
  verify: (email: string, code: string) =>
    request<{ user: User }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  signOut: () => request<{ ok: boolean }>("/api/auth/sign-out", { method: "POST" }),
  search: (q: string) => request<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  parcels: (bbox: string) => request<ParcelCollection>(`/api/parcels?bbox=${bbox}`),
  property: (id: string) => request<{ property: PropertyPage; viewer: Viewer }>(`/api/properties/${id}`),
  createClaim: (id: string, body: { method: string; notes?: string; attestationAccepted: boolean }) =>
    request<{ claimId: string; status: string }>(`/api/properties/${id}/claims`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  claim: (id: string) => request<{ claim: Claim; documents: Doc[] }>(`/api/claims/${id}`),
  myClaims: () => request<{ claims: Claim[] }>("/api/me/claims"),
  myProperties: () => request<{ properties: MaintainedProperty[] }>("/api/me/properties"),
  upload: (propertyId: string, file: File, fields: Record<string, string>) => {
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return request<{ documentId: string }>(`/api/properties/${propertyId}/documents`, { method: "POST", body: form });
  },
  documents: (id: string) => request<{ documents: Doc[] }>(`/api/properties/${id}/documents`),
  patchDocument: (id: string, body: { visibility?: string; transferability?: string }) =>
    request<{ ok: boolean }>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  saveOwnerFields: (id: string, fields: Record<string, unknown>) =>
    request<{ contributionId: string }>(`/api/properties/${id}/owner-fields`, {
      method: "POST",
      body: JSON.stringify({ fields }),
    }),
  handoff: (id: string, email: string) =>
    request<{ invitationId: string }>(`/api/properties/${id}/handoff`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  adminClaims: (status = "pending") => request<{ claims: AdminClaim[] }>(`/api/admin/claims?status=${status}`),
  reviewClaim: (id: string, decision: "verified" | "rejected", note?: string) =>
    request<{ ok: boolean }>(`/api/admin/claims/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  mailbox: () => request<{ emails: MailSummary[] }>("/api/dev/mailbox"),
  mailboxEmail: (id: string) => request<{ email: MailMessage }>(`/api/dev/mailbox/${id}`),
};

export interface ParcelCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id: string;
    properties: { property_id: string; address: string | null };
    geometry: { type: string; coordinates: number[][][] };
  }>;
}

export interface User {
  user_id: string;
  primary_email: string;
  display_name: string | null;
  is_admin: boolean;
}

export interface SearchHit {
  property_id: string;
  municipality: string | null;
  county: string;
  formatted: string | null;
  sbl: string | null;
  centroid?: { type: string; coordinates: [number, number] } | null;
}

export interface Viewer {
  maintainer: boolean;
  admin: boolean;
}

export interface Fact {
  fieldKey: string;
  label: string;
  group: string;
  layer: string;
  status: "available" | "unknown" | "conflicting" | "inferred";
  value: unknown;
  display: string | null;
  assertions: Array<{
    assertionId: string;
    display: string | null;
    sourceType: string;
    sourceName: string | null;
    effectiveAt: string | null;
  }>;
}

export interface PropertyPage {
  property_id: string;
  municipality: string | null;
  county: string;
  formatted: string | null;
  sbl: string | null;
  swis: string | null;
  geojson: { type: string; coordinates: number[][][] } | null;
  facts: Fact[];
  events: Array<{
    event_id: string;
    event_type: string;
    payload_json: Record<string, unknown>;
    effective_at: string | null;
    created_at: string;
  }>;
  maintainers: Array<{ role: string; display_name: string | null; primary_email: string }>;
  coverage: Record<string, string>;
  historyNote: string;
}

export interface Claim {
  claim_id: string;
  property_id: string;
  method: string;
  status: string;
  submitted_at: string | null;
  reviewer_note?: string | null;
  formatted?: string | null;
}

export interface AdminClaim extends Claim {
  primary_email: string;
  display_name: string | null;
}

export interface Doc {
  document_id: string;
  original_filename: string;
  document_type: string;
  visibility?: string;
  transferability?: string;
  byte_size: number;
  created_at: string;
}

export interface MaintainedProperty {
  property_id: string;
  formatted: string | null;
  municipality: string | null;
  role: string;
}

export interface MailSummary {
  email_id: string;
  stream: string;
  to_email: string;
  subject: string;
  sent_at: string;
  read_at: string | null;
}

export interface MailMessage extends MailSummary {
  html: string;
  text_body: string;
}
