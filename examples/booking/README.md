# Booking reference app

This app shows one booking crossing module boundaries without crossing their storage boundaries. Bookings owns the booking and its owner policy. Billing owns payment state and a fake provider. MyStuff reads their published views in Postgres. The app joins their nodes into seven entries. It is a runnable reference, not a payment service: the provider records calls but never contacts a bank.

## Reading order

1. Start with `apps/api/src/features/make-booking/node.ts`. Its input reuses module fields, and its two edges declare booking creation and payment charging. Then read its `entry.ts` and `handler.ts`. A descriptor describes, an entry chooses a graph start, and a binding runs it. Each optional per-node entry file constructs one shared object.
2. Read `packages/bookings/src` and `packages/billing/src`. Each has a public door, a facade, subjects, a storage port and memory/Postgres adapters. Writes require the entry's open unit. Their migrations publish `booking_read` and `payment_read`; neither module queries the other's tables.
3. Read `apps/api/src/read-models/my-bookings`, starting at `contract.ts`, then the facade and Postgres adapter. MyStuff joins `booking_read` and `payment_read`, filtering both owners in SQL. It has no memory adapter.
4. Read `apps/api/src/ways-in`. Web exposes four entries at `/api`; the independently signed partner way exposes only booking creation at `/partner`. HTTP denies approval. MCP exposes only the two reads and uses human elicitation, not agent consent.
5. Follow `apps/api/src/composition`: mount modules, capture services and bind nodes, plug sockets, acquire one runtime, then capture it in the first-sign-in hook. Permission lists live here. First sign-in creates a Party person and Identity binding in one entry unit. `scheduleEntries.nightlyCleanup` is a single Effect, not a timer.
6. Finish at `apps/api/src/main.ts`. It passes the ways into the composition, gives the router's fetch handler to Node Host, and disposes the router before the composition.

Then follow `apps/api/src/features/cancel-booking`. Its refund edge switches to system with reason `refund after cancel`. One approval and one unit surround cancellation and refund. A failed refund rolls back database writes, not external provider effects. In-process `call` from application allows approval; a handler's scoped `call` only follows declared edges.

Use `apps/api/REGISTRY.md` to navigate callers and closures. `TESTS.md` maps the reference behaviors to exact tests and lists unproved claims. Regenerate with `pnpm --filter @example/api registry`; the freshness test only reads.

## Run and limits

Use the root's pinned Node and pnpm. Start Postgres with `docker compose up -d`, run `pnpm --filter @example/api build`, then run through the root's validated environment. `composition/modules.ts` exports `modulesLayer({ provider?, log? })`. It selects all storage from `STORAGE`, defaulting to `memory`. Set `STORAGE=postgres` and `DATABASE_URL` for Postgres; a missing or empty URL fails configuration rather than falling back. Apply module migrations before serving. The origin, port and MCP issuer also come from `.env.schema`.

Tests create and drop their own databases. `composition/tests/database.ts` provides a ConfigProvider with `STORAGE=postgres` and that test database URL to the same modules layer. Payment-provider and memory audit-log doubles remain explicit options.

With memory storage MyStuff returns unavailable, never memory rows. Unset MCP auth fails closed. Local demo JWT issuers refuse production startup. No UI, timer or real payment integration is supplied.

P2 is the open gate-policy decision. Set `gatePolicy` on `createApp` in `apps/api/src/composition/index.ts`. The default, `entry-and-recheck`, checks entry closures and each inner node's own permission. Switch to `entry-only` to skip inner rechecks. Both are tested; neither removes entry closure checks.
