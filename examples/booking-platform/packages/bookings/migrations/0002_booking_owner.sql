-- Legacy bookings have no known owner; they remain unowned for every actor.
alter table booking add column owner_id text;
