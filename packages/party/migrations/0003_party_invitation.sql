CREATE TABLE party_invitation (
  id text PRIMARY KEY,
  organisation_id text NOT NULL,
  role_key text,
  created_by text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  expires_at double precision NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'used', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX party_invitation_org ON party_invitation (organisation_id);
