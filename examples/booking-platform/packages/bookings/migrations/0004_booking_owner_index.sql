-- "My bookings" reads by owner, ordered by id.
create index booking_owner_id on booking (owner_id, id);
