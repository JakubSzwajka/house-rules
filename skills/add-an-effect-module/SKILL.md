---
name: add-an-effect-module
description: Add one Effect module as a workspace package and carry it through a use-case and a delivery handler in an app without breaking the workspace or layer rules.
---

# Add an Effect module

Build one capability from the inside out: package, then use-case, then delivery. Each module is its own workspace package under `packages/`. Copy the bookings example in `packages/bookings` and the app in `apps/api`. Do not put business logic in delivery.

Before you start, read `effect/AGENTS.md` in any workspace package's `node_modules`, such as `packages/bookings/node_modules/effect/AGENTS.md`. pnpm does not install `effect` at the repo root. `ls -d packages/*/node_modules/effect` lists the copies. For API shape, read the source mirror at `.agent_sources/github.com/Effect-TS/effect`. If it is missing, run `pnpm vendor:agent-sources`.

## 1. Create the package

Create `packages/<name>/` with these files, copied from `packages/bookings`:

1. `package.json`. Set `name` to `@hosti/<name>`, or your own scope. `exports` names one entry, `"." : "./src/index.ts"`. Add no other `exports` path. Keep the `typecheck` and `test` scripts. Pin `effect`, `@effect/vitest`, `typescript`, and `vitest` to the same exact versions the other workspace packages use. A module that stores data also depends on `@house-rules/capability`, for `UnitOfWork`.
2. `tsconfig.json`, which extends `../../tsconfig.base.json`. A package that imports `@house-rules/capability` or `@house-rules/migrations` sets `allowImportingTsExtensions`, as `packages/bookings/tsconfig.json` does.
3. `vitest.config.ts`.
4. A framework package that apps mount, such as `@house-rules/call-audit`, also gets an `AGENTS.md` in its root, listed in `files` in its `package.json`. It says what the package does, how an app mounts it (the layer line, the `migrations.json` line, the hooks the app must wire), its options and presets, and its fixed rules. Add the package to the list in `tests/framework-agents.test.mjs`. An app's own module needs none.

Then run `pnpm install` so pnpm links the new package and updates `pnpm-lock.yaml`.

## 2. Define the module

Inside `packages/<name>/src/`:

1. Put the data types and the expected errors in `types.ts`. Each expected error is a `Schema.TaggedError` class, such as `BookingNotFound`. Never fail with a global `Error`.
2. Put private code under `internal/`, in files named after what they own. Nothing outside the package imports them. A file or folder named `utils`, `helpers`, or `misc` fails `no-ownerless-files`.
3. Put the service in `facade.ts`. Use a `Context.Service` class. Its methods return `Effect.Effect<Success, TypedError>` with no requirements. A module with no storage gives it a static layer. A module with storage builds the service over its storage port instead, as step 3 of the storage list says.
4. One service per file. A second service, such as a storage port or an owner-standing check, gets its own file named after its job, such as `storage.ts` or `owner-standing.ts`, never a shared `services.ts`. Its Layer sits beside it as a static member built with `Layer.effect`, as `Bookings.layer` does below. A storage port is the exception: its layers are the adapters under `src/adapters/`.
5. Write `index.ts` as the one public entry. Name each export. No `export *`.
6. Give each data type a `Schema`, such as `Booking = Schema.Struct({ ... })`, and export it with its type. A capability's contract names it as its output.

```ts
export class Bookings extends Context.Service<
  Bookings,
  {
    readonly get: (id: string) => Effect.Effect<Booking, BookingNotFound | BookingStoreUnavailable>;
    readonly create: (
      booking: Booking,
    ) => Effect.Effect<Booking, BookingAlreadyExists | BookingStoreUnavailable | NoOpenUnit>;
  }
>()("@hosti/bookings/Bookings") {
  // The facade over any BookingStore. It never imports SQL.
  static readonly layer: Layer.Layer<Bookings, never, BookingStore> = Layer.effect(this, /* ... */);
}
```

If the module stores data, it owns its tables and puts them behind a storage port:

1. Put its migrations in `packages/<name>/migrations/*.sql`. A table belongs to the package whose migration creates it. Name each file `<id>_<name>.sql`, such as `0001_bookings.sql`, and never edit one after it ran: the runner checks each file's SHA-256.
2. No foreign key to another package's table. Keep the other module's id as a plain column, and ask that module's service for the record. The module's SQL names only its own tables.
3. **The port.** Define the storage port in `src/storage.ts` as a `Context.Service`, in the module's own words, such as `BookingStore`, and give it a module-owned error, such as `BookingStoreUnavailable`. The port answers facts and never decides a permission, a standing, or a limit. The facade, `Bookings`, talks only to the port. Domain code imports no SQL, no driver, and no platform package.
4. **The memory adapter.** Put it in `src/adapters/memory/`, such as `memoryBookingStore(records)`. It keeps plain data. Its write calls `UnitOfWork.required`, then registers an undo with `UnitOfWork.onRollback`, so a failed unit leaves no row. Build `<Service>.fromRecords` or an equivalent from it for the tests of apps.
5. **The Postgres adapter.** Put it in `src/adapters/postgres/`, such as `postgresBookingStore`, a `Layer` that needs `SqlClient` from `effect/unstable/sql`. Write plain SQL, no ORM and no query builder, and decode each row with a `Schema` (`SqlSchema`) before it leaves the adapter. A write calls `UnitOfWork.required` first and then runs its statement on the injected client, which joins the open transaction. Only files under `src/adapters/**` may import `effect/unstable/sql`, `@effect/sql-*`, or `@effect/platform-*`.
6. **No transaction in the module.** A write method never opens a unit of work and never calls `withTransaction`. It runs inside the unit the use-case opened and fails with `NoOpenUnit` when none is open. One unit may span several modules. Section 3, "Compose it in a use-case", says how the use-case opens it.
7. **Export both adapters** from `src/index.ts`, next to the port, so an app picks one and the suite imports them from the public entry.
8. **The shared suite.** Write one test file in `src/adapters/tests/` that loops over both adapters and runs every case on each, as `packages/bookings/src/adapters/tests/booking-store.test.ts` does: a write with no open unit fails with `NoOpenUnit`, a failure inside the unit leaves no row, and each read and write works. Postgres comes from `MigrationsTesting.database` from `@house-rules/migrations` plus `Migrations.run` over the module's own folder, with `sqlUnitOfWork`; memory comes with `memoryUnitOfWork`. Run `docker compose up -d` once. The package's `test` script runs `varlock run --path ../../ -- vitest run`, so the suite reads `TEST_DATABASE_ADMIN_URL` from the root `.env.schema`. Test SQL against a real Postgres, never a fake client. Domain tests (policy, limits, validation) may run on memory only. The Postgres driver (`@effect/sql-pg`), `@effect/platform-node`, and `@house-rules/migrations` are devDependencies there; adding them to a new package is a dependency change, so ask the owner first.
9. Register the module in `migrations.json` at the repository root: add `{ "workspace": "packages/<name>" }` to `"modules"`. `@house-rules/migrations` then runs its files into its own history table, `<name>_migrations`.

`pnpm run migrations` checks the module's own tables and foreign keys with a text scan, fails when a package with a `migrations/` folder is missing from `migrations.json`, and catches a raw `withTransaction` or `begin` outside an adapter package and a module that calls `UnitOfWork.atomic`. `adapter-imports-only-in-adapters` fails on SQL, driver, or platform imports outside `src/adapters/`. `packages/rules/docs/migrations.md` lists what the scan misses.

The dependency-cruiser rules already cover a new package. `packages-public-entry-only` and `packages-imported-by-name` apply to every folder under `packages/`. If you use a new scope, change the `scope` option passed to `layout()` in `.dependency-cruiser.cjs`.

## 3. Compose it in a use-case

Add the package to the app that uses it:

```sh
pnpm --filter @hosti/api add @hosti/<name>
```

The app also needs `@house-rules/capability`. `apps/api` already has it as `"workspace:0.10.0"`. An app outside this repo installs it from GitHub, as `packages/capability/README.md` shows.

`saveWorkspaceProtocol: true` and `saveExact: true` in `pnpm-workspace.yaml` make pnpm write `"@hosti/<name>": "workspace:0.0.0"` into the app's `package.json`. Do not name a spec such as `@workspace:0.0.0` on the command line: pnpm then writes `workspace:*`, which the pin check rejects.

Create `apps/<app>/src/use-cases/<action>.ts`. Import the module by its package name, never by a relative path into `packages/`. Do not import another use-case: `use-cases-do-not-import-use-cases` fails it. A folder under `use-cases/` counts as one use-case, so the files in `use-cases/<module>/` may import each other. Group use-cases by the module they mostly call. Each file is still one capability, so move shared logic that is not a capability into the package.

Every use-case is a capability. The file exports one contract and one capability, and nothing else but types:

```ts
import {
  Booking,
  BookingNotFound,
  BookingPermissions,
  Bookings,
  BookingStoreUnavailable,
} from "@hosti/bookings";
import { defineContract, implement } from "@house-rules/capability";
import { Effect, Schema } from "effect";

export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id.",
  input: Schema.Struct({ id: Schema.String }),
  output: Booking,
  failure: Schema.Union([BookingNotFound, BookingStoreUnavailable]),
  permission: BookingPermissions.read,
  annotations: { readOnly: true },
});

export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    return yield* bookings.get(id);
  }),
);
```

The handler yields the service and calls its methods. Let typed errors flow through the error channel. Do not catch them here. To make the writes atomic, set `transactional: true` on the contract: `implement` then wraps the handler in a unit of work after the gates. When only a part must be atomic, call `UnitOfWork.atomic(...)` around that part instead. Either way the use-case opens the transaction, and the module never does. One unit may cover writes in several modules. Set `readOnly` when the action only reads, and `destructive` when it deletes or overwrites. Every contract names a `permission`, a `resource:action` string the module exports, such as `BookingPermissions.read`. Write `permission: "public"` only for an action any caller may run. Set `needsApproval: true` when a human must confirm each call. The package names its permissions next to its data, as `packages/bookings/src/permissions.ts` does. An action with no input uses `NoInput` from `@house-rules/capability`. `use-case-is-capability` fails a use-case file that exports anything else.

## 4. Map errors once in delivery

Create the handler under `apps/<app>/src/delivery/`. It calls the use-case through its handler, such as `showBooking.handler({ id })`, and maps every typed error to a response in one place, with `Effect.catchTag` or `Effect.catchTags`. That includes the gate errors: `Forbidden` when the contract names a permission, and `ApprovalDenied` when it needs approval. The handler's error channel ends as `never`. Group delivery by mechanism, such as `delivery/http/` and `delivery/mcp/`.

Delivery provides only per-request values: the `Viewer`, the `CallChannel`, the request id through `withRequestId`, and the `Grant` and `Approval` an adapter fills for this request, such as a Grant built from the signed-in user. Everything else comes from the app's one composition root, `src/server/` or `src/main.ts`. Provide the module's layer there, its storage adapter, and any Grant that is the same for every request. `apps/api/src/server/app-layer.ts` provides `Bookings` and the visitor Grant, and `apps/api/src/delivery/http/get-booking-route.ts` provides nothing.

Delivery returns an Effect. The entry point that owns the runtime runs it over the root's layer. Do not call `Effect.run*` inside Effect code.

## 5. Test it

Put each test in a `tests/` folder inside the folder it tests, as `<file>.test.ts`: `packages/<name>/src/tests/`, `apps/<app>/src/use-cases/tests/`, `apps/<app>/src/delivery/<kind>/tests/`, `apps/<app>/src/server/tests/`. A package's own tests import `../index.js`, never `../internal/`. `pnpm check` fails on a test anywhere else, and on a test that imports `src/internal/`. Use `@effect/vitest`:

- `it.layer(<Service>.<layer>)` to provide the service;
- `it.effect` for each case;
- `Effect.flip` to inspect an expected error.

Do not call `Effect.run*` or build a runtime by hand in tests. `no-hand-run-effect` fails `Effect.run*` and `ManagedRuntime.make` in any test file.

## 6. Prove it

```sh
pnpm check
pnpm test
```

| Check | What it proves |
| --- | --- |
| `pnpm run pins` | Every `package.json` in the workspace pins exact versions, including `workspace:0.0.0`. The plugin's `house-rules-pins` bin runs the check. |
| `pnpm run typecheck` | Effect diagnostics in every workspace package: no floating Effects, no global `Error` in the failure channel, no `Effect.run*` inside Effect code, no leaked requirements. |
| `pnpm run migrations` | Each module's migrations sit in `packages/<name>/migrations/`, `migrations.json` lists every module that has them, and no foreign key or SQL string the scan can read names another package's table. No code outside an adapter package calls `withTransaction` or sends `begin`, and no module calls `UnitOfWork.atomic`. It is a text scan, so a review still checks that every write runs inside a unit the use-case opened. |
| `pnpm run deps` | Packages do not import apps, apps import packages only by name and only through `src/index.ts`, use-cases do not import delivery, server, or each other, app code sits in a layer, and no file is named `utils`, `helpers`, or `misc`. |
| `pnpm run lint` | No comments that restate the code. Each use-case file exports one capability. No MCP tool, RPC, or HTTP endpoint is built by hand. No test runs an Effect by hand. |
| `pnpm run biome` | Named barrel exports and file names. |
| `pnpm test` | The package, use-case, and delivery tests pass under Vitest in each workspace package. |

Fix failures. Do not loosen a rule, a hook, or a pinned version.
