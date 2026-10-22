-- One row per account: credentials only. The profile lives in Party, the login binding in Identity.
create table identity_password_account (
  id text primary key,
  email text not null unique,
  display_name text not null,
  password_algorithm text not null,
  password_iterations integer not null,
  password_salt text not null,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
