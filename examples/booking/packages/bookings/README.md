# @example/bookings

Private booking module for the example. [AGENTS.md](AGENTS.md) documents mounting and fixed access rules.

`BookingsOperations` comes from `@example/bookings/contract`. Composition captures the `Bookings` service and registers `bindBookings(service)` plus Party's bindings. Create accepts `{ id, guestName, organisationId? }`; null or omitted organisationId means personal. Returned bookings include ownerId, organisationId and status.

## Organisation access

Creating an org booking requires current staff membership or admin permission in that scope. An unrelated caller gets forbidden. Show permits the owner or current org staff. Cancel permits the owner, or current staff who also administer that org. Other show/cancel attempts return not_found. Removal takes effect on the next call, without cached membership.

The module owns these decisions. Its binder passes callbacks that call declared `Party.isRelated` and `Party.canAdminOrganisation` edges. The module asks inside the write unit, not in the feature handler. Global admin permission alone does not reveal bookings of an org the caller does not staff.

## Published data

Append-only migration `003_organisation_booking.sql` adds nullable organisation_id and republishes booking_read. Existing migrations stay unchanged. MyStuff uses published views only, with an owner-or-staff EXISTS filter in SQL. Payment joins also require matching booking/payment owners; a missing or mismatched payment yields null payment fields, never another person's payment.

Run `pnpm --filter @example/bookings test` for the shared memory/Postgres store suite. Run the API tests for the feature graph, Party relation edges and SQL A/B privacy.
