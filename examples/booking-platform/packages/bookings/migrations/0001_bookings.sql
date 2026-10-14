-- One row per booking. The id is the caller's own text id, so there is no sequence.
create table booking (
  id text primary key,
  guest_name text not null
);
