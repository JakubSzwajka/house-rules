CREATE TABLE booking (
  id text CONSTRAINT booking_pkey PRIMARY KEY,
  guest_name text NOT NULL,
  owner_id text NOT NULL,
  status text NOT NULL CONSTRAINT booking_status CHECK (status IN ('active', 'cancelled'))
);
