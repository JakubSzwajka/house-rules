CREATE TABLE identity_api_token (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL,
  lookup text NOT NULL UNIQUE,
  secret_hmac text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);
