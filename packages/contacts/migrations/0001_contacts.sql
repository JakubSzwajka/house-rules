CREATE TABLE contact_points (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'phone', 'postal')),
  value_normalized TEXT,
  details JSONB NOT NULL,
  purposes TEXT[] NOT NULL CHECK (cardinality(purposes) > 0),
  verified_at BIGINT,
  created_at BIGINT NOT NULL,
  token_hash TEXT UNIQUE,
  token_expires_at BIGINT,
  UNIQUE (owner_kind, owner_id, type, value_normalized),
  CHECK ((type = 'postal' AND value_normalized IS NULL) OR
    (type IN ('email', 'phone') AND value_normalized IS NOT NULL AND length(value_normalized) > 0)),
  CHECK ((token_hash IS NULL) = (token_expires_at IS NULL))
);
--> statement-breakpoint
CREATE INDEX contact_points_owner_page ON contact_points (owner_kind, owner_id, created_at, id COLLATE "C");
--> statement-breakpoint
CREATE TABLE contact_primary_claims (
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contact_points(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_kind, owner_id, type, purpose)
);
--> statement-breakpoint
CREATE INDEX contact_primary_claims_contact ON contact_primary_claims(contact_id);
--> statement-breakpoint
CREATE VIEW contacts_view AS
SELECT c.id, c.owner_kind, c.owner_id, c.type, c.value_normalized, c.details,
  c.purposes, c.verified_at, c.created_at
FROM contact_points c;
--> statement-breakpoint
CREATE VIEW contact_primaries_view AS
SELECT owner_kind, owner_id, type, purpose, contact_id
FROM contact_primary_claims;
