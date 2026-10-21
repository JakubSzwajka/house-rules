CREATE TABLE party_organisation (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) > 0)
);
--> statement-breakpoint
CREATE TABLE party_relationship (
  from_kind text NOT NULL CHECK (from_kind IN ('person', 'organisation')),
  from_id text NOT NULL,
  to_kind text NOT NULL CHECK (to_kind IN ('person', 'organisation')),
  to_id text NOT NULL,
  kind text NOT NULL CHECK (length(kind) > 0),
  PRIMARY KEY (from_kind, from_id, to_kind, to_id, kind)
);
--> statement-breakpoint
CREATE TABLE party_role (
  key text PRIMARY KEY,
  name text NOT NULL CHECK (length(name) > 0),
  permissions text[] NOT NULL,
  organisation_id text REFERENCES party_organisation(id)
);
--> statement-breakpoint
CREATE TABLE party_assignment (
  person_id text NOT NULL REFERENCES party_person(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  organisation_id text REFERENCES party_organisation(id),
  UNIQUE NULLS NOT DISTINCT (person_id, role_key, organisation_id)
);
