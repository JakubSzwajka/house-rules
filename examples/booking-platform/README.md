# Booking platform: the example

This folder is a private showcase. It is laid out like a regular project, with its own `apps/` and `packages/`:

```text
examples/booking-platform/
  apps/api/             @example/api       the reference app: delivery, use-cases, composition
  packages/bookings/    @example/bookings  its one domain module
```

The app and its package show each part of the framework once. Read a row of the concept map, then open its file.

Nothing here is published. Both workspaces are `private`. The framework packages in the repository's `packages/` never import them: the `framework-does-not-import-examples` rule in [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) fails the check if one does. The root config lists `examples/*/apps` and `examples/*/packages` as roots, so the same rules check this code as any other app or package.

In a new project made from this template, delete `examples/`. Then remove its traces:

1. [ ] the two `examples/*` globs in `pnpm-workspace.yaml`;
2. [ ] the `examples/*` roots in `.dependency-cruiser.cjs` and `eslint.config.mjs`;
3. [ ] its line in `migrations.json`.

Your own code goes in `apps/` and `packages/`.

## Concept map

### Domain (the domain kit, `@house-rules/domain`)

| Concept | Where |
| --- | --- |
| Root module with `defineModule` | [`packages/bookings/src/facade.ts`](packages/bookings/src/facade.ts) |
| Storage port | [`packages/bookings/src/storage.ts`](packages/bookings/src/storage.ts) (`BookingStore`) |
| Memory and Postgres adapters | [`adapters/memory/`](packages/bookings/src/adapters/memory/memory-booking-store.ts), [`adapters/postgres/`](packages/bookings/src/adapters/postgres/postgres-booking-store.ts) |
| One shared store suite on both adapters | [`adapters/tests/booking-store.test.ts`](packages/bookings/src/adapters/tests/booking-store.test.ts) |
| Module-owned migrations, append-only | [`packages/bookings/migrations/`](packages/bookings/migrations/0003_booking_status.sql) (`0003` adds the status) |
| Actor and relation (`owner`, `none`) | `Bookings.relation` in [`facade.ts`](packages/bookings/src/facade.ts) asks `relationOf` in [`booking/booking-policy.ts`](packages/bookings/src/booking/booking-policy.ts) |
| `definePolicy` with object states (`active`, `cancelled`) | `bookingPolicy` in [`booking/booking-policy.ts`](packages/bookings/src/booking/booking-policy.ts); `Bookings.cancel` checks it |
| "Not yours" looks like "not found" | `Bookings.cancel` fails with `BookingNotFound` for `none` |
| A write joins the open unit of work | `Bookings.create` and `Bookings.cancel` call `UnitOfWork.required` |

### Application (the application kit, `@house-rules/application`)

| Concept | Where |
| --- | --- |
| Contracts, in the browser-safe contract entry | `show_booking`, `book_booking`, `cancel_booking` in [`booking/show-booking.ts`](packages/bookings/src/booking/show-booking.ts), [`book-booking.ts`](packages/bookings/src/booking/book-booking.ts), [`cancel-booking.ts`](packages/bookings/src/booking/cancel-booking.ts), exported by [`contract.ts`](packages/bookings/src/contract.ts) |
| `implement`, `transactional: true` | [`src/use-cases/book-booking.ts`](apps/api/src/use-cases/book-booking.ts), [`src/use-cases/cancel-booking.ts`](apps/api/src/use-cases/cancel-booking.ts) |
| `CurrentActor` | book, cancel, and the four [comment use-cases](apps/api/src/use-cases/comments/) |
| Grant | the visitor Grant in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts); a member Grant in [`booking-lifecycle.test.ts`](apps/api/src/use-cases/tests/booking-lifecycle.test.ts) |
| Approval on a destructive contract | `cancel_booking` sets `needsApproval: true`; the lifecycle test grants and denies it |
| CallWatch | call-audit on the slot in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| HTTP route, typed client, OpenAPI | [`src/delivery/http/`](apps/api/src/delivery/http/routes.ts), [`src/delivery/web/booking-client.ts`](apps/api/src/delivery/web/booking-client.ts), `openApi` in [`src/main.ts`](apps/api/src/main.ts) |
| MCP tools, fail closed | [`src/delivery/mcp/`](apps/api/src/delivery/mcp/route.ts); tests in [`src/delivery/mcp/tests/`](apps/api/src/delivery/mcp/tests/auth.test.ts) |

### Wiring

| Concept | Where |
| --- | --- |
| Composition root | [`src/composition/`](apps/api/src/composition/index.ts): layer, caller, views |
| Memory or Postgres, picked once | `appLayer` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts), from `DATABASE_URL` |
| Migrations runner | [`src/main.ts`](apps/api/src/main.ts) runs `Migrations.script` on the root [`migrations.json`](../../migrations.json) before it serves |
| Host | `serve` from `@house-rules/node-host` in [`src/main.ts`](apps/api/src/main.ts) |
| The Postgres composition, proven | [`src/tests/postgres-composition.test.ts`](apps/api/src/tests/postgres-composition.test.ts) |

### Additions

| Concept | Where |
| --- | --- |
| Comments, a domain addition, with its host port filled from `Bookings.relation` | `commentTargets` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| call-audit, a plug-in on `CallWatch` (`agentAware` preset) | `auditOptions` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |

## Run modes

| `DATABASE_URL` | Stores | Unit of work | Audit |
| --- | --- | --- | --- |
| empty | memory, seeded with one booking, `demo` | `memoryUnitOfWork` | memory |
| set | Postgres | `sqlUnitOfWork` | the `call_audit` table |

## Run it

Build once, then start. `start` runs through varlock, so it reads `.env.schema` and your `.env.local`.

```sh
pnpm --filter @example/api build
PORT=3000 pnpm --filter @example/api start
```

`build` bundles `apps/api/src/main.ts` and the workspace packages into `apps/api/dist/main.js` with esbuild. Effect stays external and loads from `node_modules`.

For Postgres, start the server and point `DATABASE_URL` at it. The app runs every module's migrations before it serves:

```sh
docker compose up -d
DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/house_rules pnpm --filter @example/api start
```

The Postgres database starts empty, so `demo` is a 404 there. Then try:

```sh
curl -i localhost:3000/api/bookings/demo   # 200 in memory mode
curl -i localhost:3000/api/bookings/nobody # 404 not_found
curl -i -X POST localhost:3000/mcp         # 503 not_configured
```

The OpenAPI document is `openApi` in [`src/main.ts`](apps/api/src/main.ts). No route serves it yet; [`src/tests/main.test.ts`](apps/api/src/tests/main.test.ts) reads it.

## MCP

`POST /mcp` serves two read-only tools, `show_booking` and `list_comments`. The bearer check is the `TokenVerifier` slot in [`src/composition/token-verifier.ts`](apps/api/src/composition/token-verifier.ts). The root fills it with `TokenVerifier.none`, so the app fails closed:

1. [ ] `APP_ORIGIN` or `MCP_AUTH_ISSUER` empty: `/mcp` answers 503 `not_configured` with no challenge, and the metadata paths answer GET and HEAD with 503 `not_configured` and other methods with 405, because there is no authorization server to name. This is the fail-closed case in `AGENTS.md`.
2. [ ] Both set: no token gets 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, and any token gets 401 `invalid_token`.

`/.well-known/oauth-protected-resource` (and `…/mcp`) names `<APP_ORIGIN>/mcp` as the resource and `MCP_AUTH_ISSUER` as the authorization server.

## Mounted once identity exists

There is no sign-in yet, so no caller sets `CurrentActor`. These use-cases run only in tests, through the composition with fake actors:

1. [ ] `book_booking` and `cancel_booking`: HTTP routes behind a session or JWT caller. Cancel keeps `needsApproval: true`, so the route fills Approval with a real confirm step.
2. [ ] `add_comment`, `edit_comment`, `remove_comment` and `list_comments`: HTTP routes behind the same caller.
3. [ ] A real `TokenVerifier` layer in the composition root, in place of `TokenVerifier.none`. MCP then serves its two read tools. Write tools wait for owner approval, by name.
