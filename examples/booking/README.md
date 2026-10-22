# Booking reference app

This app shows one booking crossing module boundaries without crossing their storage boundaries. Bookings owns the booking and its owner policy. Billing owns payment state and a fake provider. MyStuff reads their published views in Postgres. The app joins their operations into features. It is a runnable reference, not a payment service: the provider records calls but never contacts a bank.

## Reading order

1. Start at `apps/api/src/features/index.ts`. Features holds only feature identities. Composition declares member, partner and admin roles in `roles.ts`, plus the system permission list. Admin holds the permissions it delegates to member and partner; `party:admin` alone cannot grant them.
2. Read `apps/api/src/features/make-booking/index.ts`. One defineFeature call includes its handler. Input reuses module fields; the handler calls only its declared booking and payment edges. A feature is its own entry and stays browser-safe.
3. Read `packages/bookings/src/contract.ts` and `packages/billing/src/contract.ts`, then their subject operations and binders. BookingsOperations and BillingOperations describe module work with defineOperation. bindOperation captures services in composition. Each module owns its rules, storage, migrations and memory/Postgres adapters. Writes join the feature's open unit. Their migrations publish booking_read and payment_read; neither module queries the other's tables.
4. Read `apps/api/src/read-models/my-bookings`, starting at contract.ts, then the facade and Postgres adapter. MyStuffOperations publishes the read operation. MyStuff joins booking_read and payment_read, filtering both owners in SQL. It has no memory adapter.
5. Read `apps/api/src/ways-in`. Web exposes real accounts, booking and role-management features at /api; the independently signed partner way exposes booking creation at /partner. Web uses browser confirmation for approval; partner denies it. MCP exposes the two reads and uses human elicitation, not agent consent.
6. Follow `apps/api/src/composition`. Choose adapters in modules.ts, capture services and bind operations, plug sockets, acquire Runtime, then capture it in the first-sign-in hook. First sign-in creates a Party person, assigns the default role as system and binds Identity in one unit. The partner demo issuer gets partner; all other verified issuers get member, including remote MCP. One Party.may() plug resolves roles for every way. PermissionCatalogue reads Runtime.permissions after acquisition. A gate role check precedes the module's object relation check. scheduleFeatures.nightlyCleanup is one Effect, not a timer. Both start Features values as system callers.
7. Finish at `apps/api/src/main.ts`. It passes ways into composition, gives the router's fetch handler to Node Host, and disposes the router before composition.

```text
ways-in -> Features -> module operations -> Bookings and Billing data
                    -> MyStuffOperations -> published views
composition chooses adapters, binds operations and plugs sockets
```

Then follow `apps/api/src/features/cancel-booking`. Its refund edge switches to system with reason `refund after cancel`. One approval and one unit surround cancellation and refund. A failed refund rolls back database writes, not external provider effects. In-process `call` from application allows approval; a handler's scoped `call` only follows declared edges.

Use `apps/api/REGISTRY.md` to navigate callers and closures. `TESTS.md` maps the reference behaviors to exact tests and lists unproved claims. Regenerate with `pnpm --filter @example/api registry`; the freshness test only reads.

## Run and limits

From the repo root, with the pinned Node and pnpm:

```sh
docker compose up -d
MIGRATION_DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_e2e pnpm --filter @example/api migrate
pnpm --filter @example/api build
cd examples/booking/apps/api
STORAGE=postgres DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_e2e APP_ORIGIN=http://192.168.1.23:3000 PORT=3000 NODE_ENV=development pnpm exec varlock run --path ../../../../ -- node dist/main.js
```

Create the database first if it does not exist. Open http://192.168.1.23:3000 or http://localhost:3000 and sign up. The page loads your profile, creating the bound Party person. In another shell at the repo root, grant admin with server access:

```sh
STORAGE=postgres DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_e2e APP_ORIGIN=http://192.168.1.23:3000 NODE_ENV=development pnpm --filter @example/api grant-admin admin@example.test
```

Refresh the profile to see the admin role. Unknown or unbound accounts fail with a message to sign in once first. No email-based admin seed exists. The development signing key is ephemeral; restarting requires signing in again.

The sidebar has Account (Identity passwords), Bookings (Bookings and Billing), People & roles (Party), Audit (call-audit), Framework (features and ways), and Call log. Use a second account for member and hidden-booking demos. The catalogue picker lists operation permissions; role delegation still requires holding each permission in the target scope. Audit is admin-only and shows only the caller's rows. Profile ids can be copied to role assignments; there is no global people directory.

Web uses Mean.allow only after the page's confirm dialog for lifted needsApproval features. The dialog is the person's approval, not a server-verifiable token. Direct authenticated HTTP callers can also invoke these features. Partner remains Mean.no and MCP remains Mean.elicitation. All role and object checks still run. APP_ORIGIN adds the exact LAN origin; localhost:3000 stays allowed. booking_session is HttpOnly/SameSite=Lax and is not Secure over plain HTTP. HTTPS adds Secure. Session writes retain exact-origin CSRF, including sign-up and sign-in.

Use the root's pinned Node and pnpm. Start Postgres with `docker compose up -d`, run `pnpm --filter @example/api build`, then run through the root's validated environment. `composition/modules.ts` exports `modulesLayer({ provider?, log? })`. It selects all storage, including the audit Record plug, from `STORAGE`, defaulting to `memory`. The Postgres plug shares the modules' PgClient; memory uses the supplied `log` or a new audit log. Set `STORAGE=postgres` and `DATABASE_URL` for Postgres; a missing or empty URL fails configuration rather than falling back. Apply module migrations before serving with `pnpm --filter @example/api migrate` and `MIGRATION_DATABASE_URL` set in .env.local. The origin, port and MCP issuer also come from `.env.schema`.

Tests create and drop their own databases. `composition/tests/database.ts` provides a ConfigProvider with `STORAGE=postgres` and that test database URL to the same modules layer. Payment-provider and memory audit-log doubles remain explicit options.

With memory storage MyStuff returns unavailable, never memory rows. Unset MCP auth fails closed. The partner demo JWT issuer refuses production startup. The web way uses Identity's passwords provider, chosen with storage in composition/modules.ts. Identity pairs its signer with an auth-jwt verifier and accepts a bearer token or the booking_session HttpOnly cookie. The demo web issuer remains only for tests that inject their own Who. The Vite/React shadcn dashboard is served by Node Host on the API origin. The build writes dist/web before bundling the API. No timer or real payment integration is supplied.

POST /api/sign_up and /api/sign_in are public system starts, not anonymous people. Both require an exact allowed Origin or Referer for CSRF, even without a cookie. Successful answers set the session and omit token from the body. Invalid credentials return 200 with `{ "_tag": "InvalidCredentials" }` and no cookie; the transactional attempt count commits. POST /api/sign_out clears the session. POST /api/change_password needs the person's identity:update permission and current password.

The app calls IdentityOperations.signUp, signIn and changePassword through its features. Sign-out only clears the cookie. Identity owns the password table in migration 0002; there is no app-owned accounts module.

Set ACCOUNTS_SIGNING_KEY to a private P-256 JWK and optionally ACCOUNTS_ISSUER. These existing environment names configure `Identity.passwords({ issuer, signingKey })`; use `Identity.oidc({ issuer, jwks, audience? })` instead when no local passwords are needed. Without a key, development logs a warning and creates an ephemeral key. Production refuses that fallback. Email never grants admin. The shell-only grant-admin script grants global admin to an existing passwords account after its first authenticated request. Production requires --yes-production. The partner demo still prevents this reference composition from starting in production.

P2 is the open gate-policy decision. Set `gatePolicy` on `createApp` in `apps/api/src/composition/index.ts`. The default, `feature-and-recheck`, checks feature closures and each inner operation's own permission. Switch to `feature-only` to skip inner rechecks. Both are tested; neither removes feature closure checks.
