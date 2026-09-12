CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ,
  display_name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_emails (
  user_email_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE auth_codes (
  code_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_codes_email_idx ON auth_codes (email, created_at DESC);

CREATE TABLE sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  authority TEXT,
  source_type TEXT NOT NULL,
  jurisdiction TEXT,
  url TEXT,
  license_notes TEXT,
  coverage TEXT,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  schema_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(source_id),
  storage_key TEXT,
  checksum TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  property_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'NY',
  county TEXT NOT NULL,
  municipality TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX properties_place_idx ON properties (state, county, municipality);

CREATE TABLE parcel_identities (
  parcel_identity_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  swis TEXT,
  sbl TEXT,
  print_key TEXT,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  effective_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX parcel_identities_sbl_idx ON parcel_identities (sbl);
CREATE INDEX parcel_identities_property_idx ON parcel_identities (property_id);

CREATE TABLE property_geometries (
  geometry_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  source_id TEXT REFERENCES sources(source_id),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  effective_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX property_geometries_gix ON property_geometries USING GIST (geom);
CREATE INDEX property_geometries_current_idx ON property_geometries (property_id) WHERE is_current;

CREATE TABLE property_addresses (
  address_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  street_number TEXT,
  street_name TEXT,
  unit TEXT,
  city TEXT,
  state TEXT DEFAULT 'NY',
  postal_code TEXT,
  formatted TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  source_id TEXT REFERENCES sources(source_id)
);

CREATE INDEX property_addresses_formatted_trgm ON property_addresses USING GIN (formatted gin_trgm_ops);
CREATE INDEX property_addresses_property_idx ON property_addresses (property_id);

CREATE TABLE assertions (
  assertion_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  source_id TEXT REFERENCES sources(source_id),
  source_type TEXT NOT NULL,
  effective_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ,
  confidence NUMERIC,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_by TEXT
);

CREATE INDEX assertions_property_field_idx ON assertions (property_id, field_key, status);
CREATE INDEX assertions_source_idx ON assertions (source_id);

CREATE TABLE property_events (
  event_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT,
  actor_id TEXT,
  source_id TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX property_events_property_idx ON property_events (property_id, created_at DESC);
CREATE INDEX property_events_type_idx ON property_events (event_type);

CREATE TABLE ownership_claims (
  claim_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  attestation_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  reviewer_note TEXT,
  submitted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  reviewed_by TEXT REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ownership_claims_status_idx ON ownership_claims (status, submitted_at DESC);
CREATE INDEX ownership_claims_user_idx ON ownership_claims (user_id);
CREATE INDEX ownership_claims_property_idx ON ownership_claims (property_id);

CREATE TABLE property_maintainers (
  maintainer_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  role TEXT NOT NULL DEFAULT 'owner',
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX property_maintainers_active_idx
  ON property_maintainers (property_id, user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE documents (
  document_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  claim_id TEXT REFERENCES ownership_claims(claim_id),
  uploaded_by TEXT REFERENCES users(user_id),
  storage_key TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  document_type TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  transferability TEXT NOT NULL DEFAULT 'personal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX documents_property_idx ON documents (property_id);

CREATE TABLE contributions (
  contribution_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  contributor_user_id TEXT REFERENCES users(user_id),
  contributor_type TEXT NOT NULL DEFAULT 'verified_owner',
  status TEXT NOT NULL DEFAULT 'draft',
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE TABLE contribution_assertions (
  contribution_assertion_id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(contribution_id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value_json JSONB NOT NULL
);

CREATE TABLE property_relationships (
  relationship_id TEXT PRIMARY KEY,
  from_property_id TEXT NOT NULL REFERENCES properties(property_id),
  to_property_id TEXT NOT NULL REFERENCES properties(property_id),
  relationship_type TEXT NOT NULL,
  effective_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE emails (
  email_id TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  to_email TEXT NOT NULL,
  to_user_id TEXT,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text_body TEXT,
  template_key TEXT,
  payload_json JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX emails_to_idx ON emails (to_email, sent_at DESC);

CREATE TABLE handoff_invitations (
  invitation_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

CREATE TABLE field_vocabulary (
  field_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  group_key TEXT NOT NULL,
  value_type TEXT NOT NULL,
  layer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
