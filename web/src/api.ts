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
  const res = await fetch(path, { cache: "no-store", ...init, headers, credentials: "include" }).catch(() => {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  });
  const data = await res.json().catch(() => ({} as { error?: string }));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText || `Request failed (${res.status})`);
  return data as T;
}

export interface Meta {
  product: string;
  coverage: string;
  propertyCount: number;
  demonstration: boolean;
  ownerVerification: string;
  devMailbox: boolean;
  /** Local-development shortcuts are available (PIN claim, debug sheet). Never true in production. */
  debug: boolean;
  counties: CountyMeta[];
  map: { center: [number, number]; zoom: number; tiles: string; tileLayer: string; minZoom: number; maxZoom: number };
  vocab: FieldDef[];
  improvementCategories: string[];
  documentTypes: string[];
  preferenceOptions: Record<string, string[]>;
}

export interface FieldDef {
  key: string;
  label: string;
  group: string;
  layer: "official" | "owner" | "either";
  valueType: "string" | "number" | "money" | "date" | "area" | "acres";
  unit?: string;
}

export const api = {
  meta: () => request<Meta>("/api/meta"),
  me: () => request<{ user: User | null }>("/api/auth/me"),
  requestCode: (email: string) =>
    request<{ ok: boolean }>("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }) }),
  verify: (email: string, code: string, names?: { firstName?: string; lastName?: string }) =>
    request<{ user: User }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code, ...names }) }),
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
  upload: async (propertyId: string, file: File, fields: Record<string, string>) => {
    const { optimizePhotoFile } = await import("./optimize-photo");
    const photo = await optimizePhotoFile(file);
    const form = new FormData();
    form.append("file", photo);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return request<{ documentId: string }>(`/api/properties/${propertyId}/documents`, { method: "POST", body: form });
  },
  documents: (id: string) => request<{ documents: Doc[] }>(`/api/properties/${id}/documents`),
  patchDocument: (id: string, body: { visibility?: string; transferability?: string; documentType?: string; caption?: string | null; cover?: boolean }) =>
    request<{ ok: boolean }>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  replaceDocument: async (id: string, file: File) => {
    const { optimizePhotoFile } = await import("./optimize-photo");
    const photo = await optimizePhotoFile(file);
    const form = new FormData();
    form.append("file", photo);
    return request<{ ok: boolean }>(`/api/documents/${id}/file`, { method: "POST", body: form });
  },
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  saveOwnerFields: (id: string, fields: Record<string, unknown>, visibility?: FieldVisibility) =>
    request<{ contributionId: string | null; updated: number; removed: number }>(`/api/properties/${id}/owner-fields`, {
      method: "POST",
      body: JSON.stringify(visibility ? { fields, visibility } : { fields }),
    }),
  setFieldVisibility: (id: string, fieldKey: string, visibility: FieldVisibility) =>
    request<{ ok: boolean; changed: number; visibility: FieldVisibility }>(`/api/properties/${id}/owner-fields/visibility`, {
      method: "POST",
      body: JSON.stringify({ fieldKey, visibility }),
    }),
  createImprovement: (id: string, body: ImprovementInput) =>
    request<{ improvement: Improvement }>(`/api/properties/${id}/improvements`, { method: "POST", body: JSON.stringify(body) }),
  patchImprovement: (id: string, body: Partial<ImprovementInput>) =>
    request<{ improvement: Improvement }>(`/api/improvements/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteImprovement: (id: string) => request<{ ok: boolean }>(`/api/improvements/${id}`, { method: "DELETE" }),
  createRoom: (id: string, body: RoomInput) =>
    request<{ room: Room }>(`/api/properties/${id}/rooms`, { method: "POST", body: JSON.stringify(body) }),
  patchRoom: (id: string, body: Partial<RoomInput>) =>
    request<{ room: Room }>(`/api/rooms/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRoom: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}`, { method: "DELETE" }),
  dispute: (id: string, body: { fieldKey: string; proposedValue?: string; note?: string }) =>
    request<{ contributionId: string }>(`/api/properties/${id}/disputes`, { method: "POST", body: JSON.stringify(body) }),
  withdrawContribution: (id: string) => request<{ ok: boolean }>(`/api/contributions/${id}`, { method: "DELETE" }),
  inbox: (id: string) => request<{ items: InboxItem[] }>(`/api/properties/${id}/inbox`),
  reviewContribution: (id: string, decision: "accepted" | "rejected") =>
    request<{ ok: boolean; propertyId: string }>(`/api/contributions/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  savePreferences: (id: string, preferences: Record<string, string>) =>
    request<{ preferences: Record<string, string> }>(`/api/properties/${id}/preferences`, {
      method: "PUT",
      body: JSON.stringify({ preferences }),
    }),
  inviteCoOwner: (id: string, email: string) =>
    request<{ invitationId: string }>(`/api/properties/${id}/maintainers/invite`, { method: "POST", body: JSON.stringify({ email }) }),
  acceptInvitation: (id: string) => request<{ ok: boolean; propertyId: string }>(`/api/invitations/${id}/accept`, { method: "POST" }),
  cancelInvitation: (id: string) => request<{ ok: boolean }>(`/api/invitations/${id}`, { method: "DELETE" }),
  removeMaintainer: (propertyId: string, maintainerId: string) =>
    request<{ ok: boolean }>(`/api/properties/${propertyId}/maintainers/${maintainerId}/remove`, { method: "POST" }),
  handoff: (id: string, email: string) =>
    request<{ invitationId: string }>(`/api/properties/${id}/handoff`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  debugState: () => request<DebugState>("/api/dev/debug/state"),
  debugClaim: (id: string, pin: string) =>
    request<DebugClaimResult>(`/api/dev/debug/claim/${id}`, {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  debugRevoke: (id: string, userId?: string) =>
    request<{ ok: boolean }>(`/api/dev/debug/revoke/${id}`, { method: "POST", body: JSON.stringify({ userId }) }),
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
    properties: {
      property_id: string;
      address: string | null;
      county?: string;
      geometryQuality?: string;
    };
    geometry: { type: string; coordinates: number[][][] | number[][][][] };
  }>;
}

export type GeometryQuality = "official" | "approximate" | "demonstration";

export interface CountyMeta {
  id: string;
  name: string;
  geometryPolicy: "public" | "restricted";
  /** Most common stored lot-line quality for this county; null when nothing is loaded. */
  geometryQuality: GeometryQuality | null;
  center: [number, number];
  zoom: number;
  short: string;
  notice: string;
  parcelCount: number;
  shapeCount: number;
}

export interface User {
  user_id: string;
  primary_email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
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
  role: string | null;
  verifiedAt: string | null;
  admin: boolean;
  invitation: { invitation_id: string; role: string; invited_by_name: string | null } | null;
  preferences: Record<string, string> | null;
  openClaim: { claim_id: string; status: string } | null;
  inboxCount?: number;
}

export type InboxAction = "accept" | "decline" | "withdraw" | "view";
export type InboxKind = "contribution_request" | "dispute" | "notice";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  createdAt: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  proposedValue: unknown;
  note: string | null;
  contributionId: string | null;
  actions: InboxAction[];
}

export interface Dispute {
  contributionId: string;
  fieldKey: string;
  label: string;
  proposedValue: unknown;
  note: string | null;
  createdAt: string;
  contributorUserId: string | null;
}

export type FactStatus = "available" | "unknown" | "conflicting" | "inferred" | "owner_reported";
export type FieldVisibility = "public" | "private";

export interface Fact {
  fieldKey: string;
  label: string;
  group: string;
  layer: "official" | "owner" | "either";
  status: FactStatus;
  value: unknown;
  display: string | null;
  /** How the owner's current value is shared. Null when the owner has not written one. */
  visibility?: FieldVisibility | null;
  assertions: Array<{
    assertionId: string;
    value: unknown;
    display: string | null;
    sourceType: string;
    sourceName: string | null;
    effectiveAt: string | null;
  }>;
  dispute?: Dispute;
}

export interface ImprovementInput {
  title: string;
  category: string;
  performedAt?: string | null;
  cost?: string | number | null;
  costVisibility?: string;
  contractor?: string | null;
  scope?: string | null;
  notes?: string | null;
  visibility?: string;
}

export interface RoomInput {
  kind: string;
  description?: string | null;
  details?: Record<string, string>;
  visibility?: string;
}

export interface Room {
  room_id: string;
  property_id: string;
  created_by: string | null;
  kind: string;
  title: string | null;
  description: string | null;
  details: Record<string, string>;
  visibility: string;
  created_at: string;
  documents: Doc[];
}

export interface Improvement {
  improvement_id: string;
  property_id: string;
  created_by: string | null;
  title: string;
  category: string;
  performed_at: string | null;
  cost_cents: number | null;
  cost_visibility?: string;
  contractor: string | null;
  scope: string | null;
  notes: string | null;
  visibility: string;
  transferability: string;
  created_at: string;
  documents: Doc[];
}

export interface Invitation {
  invitation_id: string;
  invited_email: string;
  role: string;
  created_at: string;
}

export interface DebugClaimResult {
  ok: boolean;
  claimId?: string;
  alreadyMaintainer?: boolean;
  signedIn: boolean;
  user: User;
}

export interface DebugState {
  pin: string;
  debugOwnerEmail: string;
  user: User | null;
  maintainers: Array<{
    maintainer_id: string;
    property_id: string;
    role: string;
    verified_at: string;
    user_id: string;
    primary_email: string;
    display_name: string | null;
    formatted: string | null;
    municipality: string | null;
    county: string;
    method: string | null;
    mine: boolean;
  }>;
}

export interface PropertyPage {
  property_id: string;
  municipality: string | null;
  county: string;
  formatted: string | null;
  sbl: string | null;
  swis: string | null;
  geojson: { type: string; coordinates: number[][][] | number[][][][] } | null;
  geometryQuality?: string | null;
  geometryNotice?: string | null;
  facts: Fact[];
  events: Array<{
    event_id: string;
    event_type: string;
    actor_type?: string | null;
    payload_json: Record<string, unknown>;
    effective_at: string | null;
    created_at: string;
  }>;
  maintainers: Array<{ maintainer_id: string; user_id: string; role: string; verified_at: string; display_name: string | null; primary_email: string }>;
  coverage: Record<string, string>;
  historyNote: string;
  improvements: Improvement[];
  rooms: Room[];
  documents: Doc[];
  invitations: Invitation[];
  disputes: Dispute[];
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
  mime_type?: string | null;
  visibility?: string;
  transferability?: string;
  caption?: string | null;
  improvement_id?: string | null;
  room_id?: string | null;
  topic_id?: string | null;
  is_cover?: boolean;
  has_file?: boolean;
  byte_size: number;
  created_at: string;
}

export type PageRefresh = (patch?: (property: PropertyPage) => PropertyPage) => Promise<void> | void;

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
