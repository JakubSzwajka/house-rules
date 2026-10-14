create table party_person (
  id text primary key,
  display_name text not null,
  created_at timestamptz not null default now()
);
