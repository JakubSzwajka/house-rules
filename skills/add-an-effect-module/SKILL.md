---
name: add-an-effect-module
description: Add one Effect module as a workspace package and carry it through a use-case and a delivery handler in an app without breaking the workspace or layer rules.
---

# Add an Effect module

Build one capability from the inside out: package, then use-case, then delivery. Each module is its own workspace package under `packages/`. Copy the bookings example in `packages/bookings` and the app in `apps/api`. Do not put business logic in delivery.

Before you start, read `effect/AGENTS.md` in any workspace package's `node_modules`, such as `packages/bookings/node_modules/effect/AGENTS.md`. pnpm does not install `effect` at the repo root. `ls -d packages/*/node_modules/effect` lists the copies. For API shape, read the source mirror at `.agent_sources/github.com/Effect-TS/effect`. If it is missing, run `pnpm vendor:agent-sources`.

## 1. Create the package

Create `packages/<name>/` with these files, copied from `packages/bookings`:

1. `package.json`. Set `name` to `@hosti/<name>`, or your own scope. `exports` names one entry, `"." : "./src/index.ts"`. Add no other `exports` path. Keep the `typecheck` and `test` scripts. Pin `effect`, `@effect/vitest`, `typescript`, and `vitest` to the same exact versions the other workspace packages use.
2. `tsconfig.json`, which extends `../../tsconfig.base.json`.
3. `vitest.config.ts`.

Then run `pnpm install` so pnpm links the new package and updates `pnpm-lock.yaml`.

## 2. Define the module

Inside `packages/<name>/src/`:

1. Put the data types and the expected errors in `types.ts`. Each expected error is a `Schema.TaggedError` class, such as `BookingNotFound`. Never fail with a global `Error`.
2. Put private code under `internal/`, in files named after what they own. Nothing outside the package imports them. A file or folder named `utils`, `helpers`, or `misc` fails `no-ownerless-files`.
3. Put the service in `facade.ts`. Use a `Context.Service` class. Its methods return `Effect.Effect<Success, TypedError>` with no requirements. Give it a static layer, such as `Bookings.fromRecords`.
4. Write `index.ts` as the one public entry. Name each export. No `export *`.
5. Give each data type a `Schema`, such as `Booking = Schema.Struct({ ... })`, and export it with its type. A capability's contract names it as its output.

```ts
export class Bookings extends Context.Service<
  Bookings,
  { readonly get: (id: string) => Effect.Effect<Booking, BookingNotFound> }
>()("@hosti/bookings/Bookings") {
  static readonly fromRecords = (records: readonly Booking[]): Layer.Layer<Bookings> =>
    Layer.succeed(this, {
      get: Effect.fn("Bookings.get")(function* get(id: string) {
        const booking = findBooking(records, id);
        if (booking === undefined) {
          return yield* new BookingNotFound({ id });
        }
        return booking;
      }),
    });
}
```

If the module stores data, it owns its tables:

1. Put its migrations in `packages/<name>/migrations/*.sql`. A table belongs to the package whose migration creates it.
2. No foreign key to another package's table. Keep the other module's id as a plain column, and ask that module's service for the record.
3. The module's SQL names only its own tables. To read another module's data, call its service.
4. A service method that writes is one transaction, and the method opens it. A read method may run without one. A use-case never opens one.

`pnpm run migrations` checks the first three with a text scan, and catches a use-case that calls `withTransaction` or sends `begin`. The rest of rule 4 is a review rule. `packages/rules/docs/migrations.md` lists what the scan misses.

The dependency-cruiser rules already cover a new package. `packages-public-entry-only` and `packages-imported-by-name` apply to every folder under `packages/`. If you use a new scope, change the `scope` option passed to `layout()` in `.dependency-cruiser.cjs`.

## 3. Compose it in a use-case

Add the package to the app that uses it:

```sh
pnpm --filter @hosti/api add @hosti/<name>
```

The app also needs `@house-rules/capability`. `apps/api` already has it as `"workspace:0.4.0"`. An app outside this repo installs it from GitHub, as `packages/capability/README.md` shows.

`saveWorkspaceProtocol: true` and `saveExact: true` in `pnpm-workspace.yaml` make pnpm write `"@hosti/<name>": "workspace:0.0.0"` into the app's `package.json`. Do not name a spec such as `@workspace:0.0.0` on the command line: pnpm then writes `workspace:*`, which the pin check rejects.

Create `apps/<app>/src/use-cases/<action>.ts`. Import the module by its package name, never by a relative path into `packages/`. Do not import another use-case: `use-cases-do-not-import-use-cases` fails it. Move shared logic into the package.

Every use-case is a capability. The file exports one contract and one capability, and nothing else but types:

```ts
import { Booking, BookingNotFound, BookingPermissions, Bookings } from "@hosti/bookings";
import { defineContract, implement } from "@house-rules/capability";
import { Effect, Schema } from "effect";

export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id.",
  input: Schema.Struct({ id: Schema.String }),
  output: Booking,
  failure: BookingNotFound,
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

The handler yields the service and calls its methods. Let typed errors flow through the error channel. Do not catch them here, and do not open a transaction. Set `readOnly` when the action only reads, and `destructive` when it deletes or overwrites. Every contract names a `permission`, a `resource:action` string the module exports, such as `BookingPermissions.read`. Write `permission: "public"` only for an action any caller may run. Set `needsApproval: true` when a human must confirm each call. The package names its permissions next to its data, as `packages/bookings/src/permissions.ts` does. An action with no input uses `NoInput` from `@house-rules/capability`. `use-case-is-capability` fails a use-case file that exports anything else.

## 4. Map errors once in delivery

Create the handler under `apps/<app>/src/delivery/`. It calls the use-case through its handler, such as `showBooking.handler({ id })`, and maps every typed error to a response in one place, with `Effect.catchTag` or `Effect.catchTags`. That includes the gate errors: `Forbidden` when the contract names a permission, and `ApprovalDenied` when it needs approval. Delivery also provides the `Grant` and, when needed, the `Approval` slot for each request, as `apps/api/src/delivery/http/get-booking-route.ts` does with its visitor grant. The handler's error channel ends as `never`.

Delivery returns an Effect. The entry point that owns the runtime runs it. Do not call `Effect.run*` inside Effect code.

## 5. Test it

Put each test in a `tests/` folder inside the folder it tests, as `<file>.test.ts`: `packages/<name>/src/tests/`, `apps/<app>/src/use-cases/tests/`, `apps/<app>/src/delivery/<kind>/tests/`. A package's own tests import `../index.js`, never `../internal/`. `pnpm check` fails on a test anywhere else, and on a test that imports `src/internal/`. Use `@effect/vitest`:

- `it.layer(<Service>.<layer>)` to provide the service;
- `it.effect` for each case;
- `Effect.flip` to inspect an expected error.

Do not call `Effect.run*` or build a runtime by hand in tests.

## 6. Prove it

```sh
pnpm check
pnpm test
```

| Check | What it proves |
| --- | --- |
| `pnpm run pins` | Every `package.json` in the workspace pins exact versions, including `workspace:0.0.0`. The plugin's `house-rules-pins` bin runs the check. |
| `pnpm run typecheck` | Effect diagnostics in every workspace package: no floating Effects, no global `Error` in the failure channel, no `Effect.run*` inside Effect code, no leaked requirements. |
| `pnpm run migrations` | Each module's migrations sit in `packages/<name>/migrations/`, and no foreign key or SQL string the scan can read names another package's table. No use-case calls `withTransaction` or sends `begin`. It is a text scan, so a review still checks that each write method opens its own transaction. |
| `pnpm run deps` | Packages do not import apps, apps import packages only by name and only through `src/index.ts`, use-cases do not import delivery, server, or each other, app code sits in a layer, and no file is named `utils`, `helpers`, or `misc`. |
| `pnpm run lint` | No comments that restate the code. Each use-case file exports one capability. No MCP tool, RPC, or HTTP endpoint is built by hand. |
| `pnpm run biome` | Named barrel exports and file names. |
| `pnpm test` | The package, use-case, and delivery tests pass under Vitest in each workspace package. |

Fix failures. Do not loosen a rule, a hook, or a pinned version.
