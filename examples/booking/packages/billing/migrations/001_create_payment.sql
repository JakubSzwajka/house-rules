CREATE TABLE payment (
  id text CONSTRAINT payment_pkey PRIMARY KEY,
  booking_id text NOT NULL CONSTRAINT payment_booking_key UNIQUE,
  owner_id text NOT NULL,
  amount integer NOT NULL CONSTRAINT payment_amount CHECK (amount > 0),
  status text NOT NULL CONSTRAINT payment_status CHECK (status IN ('pending', 'paid', 'refunded', 'expired')),
  created_at bigint NOT NULL
);
