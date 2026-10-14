# @house-rules/domain: notes for agents

## What it does

The domain kit. A package uses it to define its domain module: `defineModule` for the root service, `Actor` and `ActorId` for the user a method acts for, `Permission` and `definePolicy` for object-level access, and the `UnitOfWork` slot with `memoryUnitOfWork`. It knows nothing about requests, contracts or delivery; that is `@house-rules/application`. Version 0.1.0 peers on exact `effect` 4.0.3 and depends on no other house-rules package. The full guide is `README.md` in this package.

## How an app mounts it

There is no layer of its own. A package declares its module with it, and the app's composition root provides the module's layer and one `UnitOfWork` adapter:

```ts
// packages/<name>/src/facade.ts
export class Bookings extends defineModule<Bookings, Shape>()("@acme/bookings/Bookings", { make }) {}

// apps/<app>/src/composition/app-layer.ts
Layer.mergeAll(Bookings.layer.pipe(Layer.provide(store)), memoryUnitOfWork); // or sqlUnitOfWork from application
```

No `migrations.json` line: this package owns no tables.

| Export | Use |
| --- | --- |
| `defineModule<Self, Shape>()(id, { make })` | A root module. An Effect `make` gives `layer`; `make(options)` gives `layer(options)`. Presets are plain data; adapter statics stay in the class body. |
| `Actor`, `ActorId` | `Actor.make({ id: ActorId.make("u1") })`. A method that acts for a user takes it as an argument. |
| `Permission`, `definePolicy` | `resource:action` strings and the relation × state table a module checks on its own data. |
| `UnitOfWork`, `CurrentUnit`, `NoOpenUnit`, `UnitOfWorkFailed` | `UnitOfWork.required` and `UnitOfWork.onRollback` in a module's store; `UnitOfWork.atomic` in a use-case only. |
| `memoryUnitOfWork` | The memory adapter for tests and scripts. `sqlUnitOfWork` lives in `@house-rules/application`. |
| `PerRequest` | The per-request marker. A per-request service declares it; `defineModule` refuses a `make` that requires one. |
| `./contract` | `Actor`, `ActorId`, `Permission`, `UnitOfWorkFailed`. Browser-safe. |

`UnitOfWorkService` is a support type for adapter authors: the shape `UnitOfWork.make(transaction)` returns.

## Defining a module

1. [ ] Name the module's permissions next to its data, as `resource:action` strings: `export const BookingPermissions = { read: "bookings:read" } as const`. Export them from `src/index.ts`. A contract's `permission` uses them.
2. [ ] If the module has storage, put the data behind a storage port: a `Context.Service` in `storage.ts` with an error the module owns. The port answers facts. It never decides a permission, a standing or a limit.
3. [ ] A module with storage writes two adapters. Memory, in `src/adapters/memory/`, calls `UnitOfWork.onRollback` with an undo before it changes a row. Postgres, in `src/adapters/postgres/`, calls `UnitOfWork.required` on each write, then runs plain SQL on the injected `SqlClient` and decodes each row with a `Schema`. Reads may run outside a unit; only writes need one. Export the port and both adapters from `src/index.ts`.
4. [ ] A method that acts for a user takes an `Actor`. The module reads its own data to decide the relation, such as `relation(actor, id)` returning `"owner"` or `"none"`, so no adapter can skip the check.
5. [ ] A module with storage has one shared store suite in `src/adapters/tests/` runs every case on both adapters: a write with no open unit fails with `NoOpenUnit`, a failure inside the unit leaves no row, and each read and write works. Policy and validation tests may run on memory only.
6. [ ] A module with migrations is listed in `migrations.json` at the repo root, as `{ "workspace": "packages/<name>" }`. A module with no tables has no entry.

## Fixed rules

- It imports no `@house-rules/*` package. `@house-rules/application` depends on it, never the other way.
- It never names `CurrentActor` or any other request concept. The generic `PerRequest` marker is the only link: `CurrentActor` carries it, and `defineModule` fails `tsc` for a `make` that requires a marked service.
- Every Shape member returns `Effect<Success, Failure, never>`. Construction captures long-lived ports, never a request's identity.
- A module never opens a unit of work. Its writes call `UnitOfWork.required` or `UnitOfWork.onRollback` and fail with `NoOpenUnit` without one. `house-rules-migrations` exempts this package only because it defines `UnitOfWork.atomic`.
- Policy is object-level authorization: the module answers it from its own data. Action-level checks (`Grant`) and consent (`Approval`) belong to the application kit.
- `src/contract.ts` is the browser entry. Anything it reaches must stay browser-safe; `contract-entry-is-browser-safe` checks it.
