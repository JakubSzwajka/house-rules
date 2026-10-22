# Booking app

Read the root AGENTS.md and ../../README.md first. This private reference mounts domain/application, Party, Identity, call-audit, auth-jwt, migrations and Node Host.

## Wiring

- App feature folders under src/features/ each hold only index.ts and tests/. Each index exports one defineFeature with its handler. The handler calls only declared edges. features/index.ts exports only Features. Endpoints, ways, composition, registry, hook and schedule use those identities.
- composition/roles.ts declares member, partner and admin built-in roles plus systemPermissions. Party mounts with { builtInRoles } in the STORAGE switch. Composition plugs Party.may() once. PermissionCatalogue is filled from Runtime.permissions after acquisition. The gate checks role permissions; module operations check object relations. MCP is the person and exposes only the two reads. Web alone exposes define_role, list_roles, assign_role and revoke_role. Web/partner use Mean.no; MCP uses Mean.elicitation. In-process call supplies approval.
- First sign-in assigns partner for https://partner.invalid, otherwise member, through a system edge. The verified remote MCP issuer therefore defaults to member. Identity stores no roles.
- Use modulesLayer({ provider?, log? }) from composition/modules.ts. It alone selects adapters from STORAGE, default memory, and requires DATABASE_URL for postgres. Each branch builds the audit Record plug and provides CallWatch with the modules. Postgres shares their PgClient; memory uses log when supplied. plugSockets consumes that watch without selecting storage. Main, ways, features and tests use this one layer. Mount modules, one unit, trace and record; capture services with bindOperation in module/read-model binders; acquire Runtime; then capture it in FirstSignIn. Never authenticate twice or open a production unit in a handler, hook or module.
- Bookings and Billing own migrations and publish booking_read/payment_read. They live in @example/bookings and @example/billing workspace packages. Register those packages in root migrations.json. Shared Party/Identity/call-audit migrations remain registered separately. BookingsOperations, BillingOperations and MyStuffOperations are exported through their contract doors. MyStuff has PG only and an unavailable port without a database.
- STORAGE, DATABASE_URL, MCP_AUTH_ISSUER, NODE_ENV, APP_ORIGIN and PORT are the existing environment options. Local issuers refuse production. Remote MCP verifies this resource's audience on every request, including existing sessions.

## Proofs

Run the app typecheck and validated test script from the root. PG tests use MigrationsTesting.database per test. composition/tests/database.ts installs a ConfigProvider with STORAGE=postgres and the throwaway database URL; provide databaseTesting to modulesLayer(), never select adapters in test callers. scripts/host-smoke.mjs builds and starts the real Node Host, verifies fail-closed MCP and production refusal, and waits for its own children to exit. It writes ignored dist/main.js, never a source file.

scripts/registry.mjs renders REGISTRY.md without starting the app or reading auth settings. The freshness test never rewrites it. Keep ../../TESTS.md aligned with actual test names and paths. No fake-provider test promises external rollback. P2 stays open. createApp defaults gatePolicy to feature-and-recheck; feature-only skips inner permission rechecks, never feature closures.
