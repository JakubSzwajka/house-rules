# Bookings module

Mount `Bookings.layer` with `BookingStore` and the app's shared unit. Composition alone chooses `memoryBookingStore()` or `postgresBookingStore`. Exported BookingsMount carries the service key, all operation descriptors and bindBookings. Add its chosen layer to composition/modules.ts; the runtime captures the service and invokes the binder once. Mount Party too: the booking operations declare `Party.isRelated` and `Party.canAdminOrganisation` edges.

`NewBooking.organisationId` is optional and nullable. Omission means personal; stored and returned bookings always carry string or null. The booking belongs to its creator even when it also belongs to an organisation.

## Access

The feature gate checks operation permissions. Inside the module, a new org booking requires current staff relation or admin permission in that org. Refusal is forbidden with a clear message. Read allows the owner or current org staff. Cancel allows the owner, or current staff holding admin permission in that org. All other reads and cancels return the same not_found. A global admin without a staff relation cannot read or cancel another person's booking.

The binder supplies per-call callbacks backed by declared Party edges. The module invokes them after loading its own object, inside the write unit for book/cancel. Never capture Party or caller context in the module layer, pre-authorize in a feature, or cache membership. Service-only tooling may supply callbacks; absent callbacks grant no org access.

## Data and proof

Register this workspace in root migrations.json. Migrations 001 and 002 are immutable. Append-only 003 adds organisation_id and republishes booking_read. Foreign organisation ids have no cross-module FK. Other modules never read booking tables. The app's MyBookings list selects booking_read, payment_read and party_staff_read, filtering owner or live staff with EXISTS in SQL. No memory list adapter is required.

Writes require UnitOfWork.required; only the runtime opens production units. Memory registers undo before mutation. Postgres joins the shared transaction. Cancellation still compares the loaded owner and active status in storage, including when an org admin initiates it.

Shared store tests cover memory/Postgres. App composition/tests/org-bookings.test.ts covers live Party edges, A/B visibility, scoped cancellation, removal and SQL list privacy against real Postgres.
