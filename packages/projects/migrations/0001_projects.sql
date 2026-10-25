CREATE TABLE projects (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL,
  description text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
