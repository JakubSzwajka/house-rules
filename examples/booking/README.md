# Booking reference app

This app shows one booking crossing module boundaries without crossing their storage boundaries. Bookings owns the booking and its owner policy. Billing owns payment state and a fake provider. MyStuff reads their published views in Postgres. The app joins their operations into features. It is a runnable reference, not a payment service: the provider records calls but never contacts a bank.

## Reading order

1. Start at `apps/api/src/features/index.ts`. Features holds only feature identities. Composition declares member, partner, org-admin and admin roles in `roles.ts`, plus the system permission list. Admin holds the permissions it delegates to member and partner; `party:admin` alone cannot grant them.
2. Read `apps/api/src/features/make-booking/index.ts`. One defineFeature call includes its handler. Input reuses module fields; the handler calls only its declared booking and payment edges. A feature is its own entry and stays browser-safe.
3. Read `packages/bookings/src/contract.ts` and `packages/billing/src/contract.ts`, then their subject operations and binders. BookingsOperations and BillingOperations describe module work with defineOperation. bindOperation captures services in composition. Each module owns its rules, storage, migrations and memory/Postgres adapters. Writes join the feature's open unit. Their migrations publish booking_read and payment_read; neither module queries the other's tables.
4. Read `apps/api/src/read-models/my-bookings`, starting at contract.ts, then the facade and Postgres adapter. MyStuffOperations publishes the read operation. MyStuff selects booking_read, payment_read and Party's party_staff_read. SQL filters bookings by owner or current org staff through EXISTS. Its left payment join requires the payment owner to match the booking owner; unmatched payments stay null. It has no memory adapter.
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
MIGRATION_DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_dev pnpm --filter @example/api migrate
NODE_ENV=development pnpm --filter @example/api build
STORAGE=postgres DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_dev APP_ORIGIN=http://192.168.1.23:3000 NODE_ENV=development pnpm --filter @example/api seed
cd examples/booking/apps/api
STORAGE=postgres DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_dev APP_ORIGIN=http://192.168.1.23:3000 PORT=3000 NODE_ENV=development pnpm exec varlock run --path ../../../../ -- node dist/main.js
```

Create the database first if it does not exist, for example with `docker exec house-rules-postgres-1 psql -U house_rules -d postgres -c 'create database booking_dev'`. Use a fresh demo database if those emails already belong to accounts with different passwords; the seed preserves existing credentials. Open http://192.168.1.23:3000 or http://localhost:3000 and sign up. The page loads your profile, creating the bound Party person. In another shell at the repo root, grant admin with server access:

```sh
STORAGE=postgres DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/booking_dev APP_ORIGIN=http://192.168.1.23:3000 NODE_ENV=development pnpm --filter @example/api grant-admin admin@example.test
```

Reload the page to see the admin role. Unknown or unbound accounts fail with a message to sign in once first. Ordinary sign-up never grants admin based on email. The explicit development seed below creates a demo admin. The development signing key is ephemeral; restarting requires signing in again.

The dashboard has Overview, Bookings, Organisations, People, Roles, Audit and Framework screens, linked by URL hashes. Data loads when a screen opens and refreshes after mutations. New items use dialog forms; table row menus hold edits and removals. Destructive actions require an AlertDialog confirmation. Notifications include HTTP status, public code, message and a copyable request id. People and Audit appear only with the required permissions. A global admin sees everyone; an org admin sees only people and assignments in their own organisations. These filters run in SQL.

Roles loads the catalogue automatically. Permission checkboxes are grouped by resource and disabled when the person lacks that permission in the chosen scope. Custom roles can be edited or deleted from their row menu; built-in roles cannot. The user menu holds password change and sign-out. The profile API does not expose email, so the menu shows the person's name and roles.

The Audit page is global-admin-only and shows the latest 50 calls across people. The fixed bottom "Under the hood" dock merges this tab's calls with the signed-in person's own audit, linked by request id. It refreshes automatically while open; enable "Include reads" for read-only calls. Expand a row for detail, with JSON available only inside its nested Raw section. The tab log belongs to the signed-in person and clears on sign-in, sign-up, sign-out or a changed profile id. Signed-out attempts do not carry into another person's log. `my_activity` filters by actor in the reader's SQL, not in the page.

## Organisation bookings

In New booking, choose Personal or an organisation in the For select. The table shows an Org column and All/Personal/org filters. Organisation detail has a Bookings tab using the same table. The API list is already filtered in SQL; the page filter only narrows that result.

Sign in as Dave to see both Acme bookings. Carol sees the same rows as Acme staff and can cancel either as org admin. Alice sees her personal booking, not Acme's. Plain staff may view an org colleague's booking but cannot cancel it. Row cancellation appears only for the owner or current org staff with scoped admin permission, and still needs bookings:cancel. Removing staff cuts off read/list access on the next request. Owners retain access to their own bookings.

The module asks Party through declared edges after loading its booking, inside the write unit. Creating for an unrelated org fails forbidden. Unauthorized show/cancel is not_found. Org-admin includes booking read/write/cancel and billing:charge as well as Party management; it grants no authority in another org.

## Seed and organisations walkthrough

`pnpm --filter @example/api seed` is tooling, not a public feature. It refuses `NODE_ENV=production` and uses Identity and Party services in a script-owned unit. Re-running it keeps the same accounts, relations and assignments, and creates no duplicate demo bookings. Dave makes `demo-acme-1` and `demo-acme-2` for Acme. Alice makes `demo-personal-1`. Each has a 100-unit payment. All five accounts use `@example.test` and password `house-rules-demo`:

| Account | Roles and membership |
| --- | --- |
| alice | member |
| bob | partner |
| carol | org-admin scoped to Acme, id `acme` |
| dave | member, Acme staff |
| admin | global admin |

The Demo accounts list appears inside the tabbed sign-in card only when Vite builds with `NODE_ENV=development`, or serves its dev page. They prefill credentials and submit the existing `sign_in` form. A normal production build removes them. There is no new public path, runtime environment endpoint or seed-enabled feature. Setting only the server's NODE_ENV after a production page build cannot enable these buttons.

1. Sign in as Carol. Open Organisations, then Acme. The Members tab loads Carol and Dave, not Alice or Bob.
2. Open Invitations and choose Invite. Select Staff, no role, or Organisation admin to delegate Carol's scoped powers. Copy the one-time code shown in the dialog. The picker excludes roles whose permissions Carol does not hold, including Member.
3. Sign in as Alice and accept the code. Alice becomes Acme staff; an attached role is assigned through a system edge in the same transaction. A reused code fails with generic not_found. Codes expire after seven days; revocation needs confirmation.
4. Alice can also create a separate organisation as a member. Its creator gets only `org-admin` in that org through the system edge with reason `creator of organisation`. Carol cannot invite into or list invitations in Alice's org.
5. Choose Remove member from a member's row menu and confirm. Their org-scoped assignments are revoked, but their global roles stay. Removing the last org admin fails with conflict.

Web uses Mean.allow only after the page's confirm dialog for lifted needsApproval features. The dialog is the person's approval, not a server-verifiable token. Direct authenticated HTTP callers can also invoke these features. Partner remains Mean.no and MCP remains Mean.elicitation. All role and object checks still run. APP_ORIGIN adds the exact LAN origin; localhost:3000 stays allowed. booking_session is HttpOnly/SameSite=Lax and is not Secure over plain HTTP. HTTPS adds Secure. Session writes retain exact-origin CSRF, including sign-up and sign-in.

Use the root's pinned Node and pnpm. Start Postgres with `docker compose up -d`, run `pnpm --filter @example/api build`, then run through the root's validated environment. `composition/modules.ts` exports `modulesLayer({ provider?, log? })`. It selects all storage, including the audit Record plug, from `STORAGE`, defaulting to `memory`. The Postgres plug shares the modules' PgClient; memory uses the supplied `log` or a new audit log. Set `STORAGE=postgres` and `DATABASE_URL` for Postgres; a missing or empty URL fails configuration rather than falling back. Apply module migrations before serving with `pnpm --filter @example/api migrate` and `MIGRATION_DATABASE_URL` set in .env.local. The origin, port and MCP issuer also come from `.env.schema`.

Tests create and drop their own databases. `composition/tests/database.ts` provides a ConfigProvider with `STORAGE=postgres` and that test database URL to the same modules layer. Payment-provider and memory audit-log doubles remain explicit options.

With memory storage MyStuff returns unavailable, never memory rows. Unset MCP auth fails closed. The partner demo JWT issuer refuses production startup. The web way uses Identity's passwords provider, chosen with storage in composition/modules.ts. Identity pairs its signer with an auth-jwt verifier and accepts a bearer token or the booking_session HttpOnly cookie. The demo web issuer remains only for tests that inject their own Who. The Vite/React shadcn dashboard is served by Node Host on the API origin. The build writes dist/web before bundling the API. No timer or real payment integration is supplied.

POST /api/sign_up and /api/sign_in are public system starts, not anonymous people. Both require an exact allowed Origin or Referer for CSRF, even without a cookie. Successful answers set the session and omit token from the body. Invalid credentials return 200 with `{ "_tag": "InvalidCredentials" }` and no cookie; the transactional attempt count commits. POST /api/sign_out clears the session. POST /api/change_password needs the person's identity:update permission and current password.

The app calls IdentityOperations.signUp, signIn and changePassword through its features. Sign-out only clears the cookie. Identity owns the password table in migration 0002; there is no app-owned accounts module.

Set ACCOUNTS_SIGNING_KEY to a private P-256 JWK and optionally ACCOUNTS_ISSUER. These existing environment names configure `Identity.passwords({ issuer, signingKey })`; use `Identity.oidc({ issuer, jwks, audience? })` instead when no local passwords are needed. Without a key, development logs a warning and creates an ephemeral key. Production refuses that fallback. Email never grants admin. The shell-only grant-admin script grants global admin to an existing passwords account after its first authenticated request. Production requires --yes-production. The partner demo still prevents this reference composition from starting in production.

P2 is the open gate-policy decision. Set `gatePolicy` on `createApp` in `apps/api/src/composition/index.ts`. The default, `feature-and-recheck`, checks feature closures and each inner operation's own permission. Switch to `feature-only` to skip inner rechecks. Both are tested; neither removes feature closure checks.
