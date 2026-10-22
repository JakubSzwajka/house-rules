ALTER TABLE booking ADD COLUMN organisation_id text;
--> statement-breakpoint
CREATE OR REPLACE VIEW booking_read AS
SELECT id, guest_name, owner_id, status, organisation_id FROM booking;
