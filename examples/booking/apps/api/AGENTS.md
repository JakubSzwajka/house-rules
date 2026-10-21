# Booking app

Read the root AGENTS.md and ../../README.md first. This private reference mounts domain/application, Party, Identity, call-audit, auth-jwt, migrations and Node Host.

## Wiring

- Seven app feature folders under src/features/ each hold node.ts, handler.ts and one optional entry.ts. Construct each Entry once there. Endpoints, ways, composition, registry, hook and schedule use those same identities.
- Composition owns member, partner, agent and system permission lists. Web/partner use Mean.no; MCP uses Mean.elicitation. In-process call supplies approval. MCP stays read-only.
- Use modulesLayer({ provider?, log? }) from composition/modules.ts. It alone selects adapters from STORAGE, default memory, and requires DATABASE_URL for postgres. Main, ways, features and tests use this one layer. Mount modules, one unit, trace and record; capture services in binders; acquire NodeRuntime; then capture it in FirstSignIn. Never authenticate twice or open a production unit in a handler, hook or module.
- Bookings and Billing own migrations and publish booking_read/payment_read. They live in @example/bookings and @example/billing workspace packages. Register those packages in root migrations.json. Shared Party/Identity/call-audit migrations remain registered separately. MyStuff has PG only and an unavailable port without a database.
- STORAGE, DATABASE_URL, MCP_AUTH_ISSUER, NODE_ENV, APP_ORIGIN and PORT are the existing environment options. Local issuers refuse production. Remote MCP verifies this resource's audience on every request, including existing sessions.

## Proofs

Run the app typecheck and validated test script from the root. PG tests use MigrationsTesting.database per test. composition/tests/database.ts installs a ConfigProvider with STORAGE=postgres and the throwaway database URL; provide databaseTesting to modulesLayer(), never select adapters in test callers. scripts/host-smoke.mjs builds and starts the real Node Host, verifies fail-closed MCP and production refusal, and waits for its own children to exit. It writes ignored dist/main.js, never a source file.

scripts/registry.mjs renders REGISTRY.md without starting the app or reading auth settings. The freshness test never rewrites it. Keep ../../TESTS.md aligned with actual test names and paths. No fake-provider test promises external rollback. P2 stays open. createApp defaults gatePolicy to entry-and-recheck; entry-only skips inner permission rechecks, never entry closures.
