# @house-rules/domain

The domain kit describes what a system can do. It owns operations and their edges, caller data, error kinds and pure graph checks. Modules use the same kit for their root service, object policy and unit of work. Execution belongs to [the application kit](../application/README.md). Domain imports no house-rules package.

## Describe operations

```ts
import { defineOperation, errorKind, NoInput } from "@house-rules/domain/contract";
import { Schema } from "effect";

class ItemNotFound extends Schema.TaggedError<ItemNotFound>()("ItemNotFound", {
  kind: errorKind("not_found"),
  id: Schema.String,
}) {
  override get message(): string { return "Item not found."; }
}

export const showItem = defineOperation("Items.show", {
  description: "Read one item visible to the caller.",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ title: Schema.String }),
  failure: ItemNotFound,
  permission: "items:read",
  readOnly: true,
});
```

`new ItemNotFound({ id })` needs no kind argument. A operation failure schema accepts only errors with `_tag`, `kind` and `message`; a Union with even one unkinded member fails types. `Schema.Never` describes no expected domain failure.

`Callable` is the shared descriptor type for edge targets. `AnyCallable` erases its concrete schemas and flags. `Operation` describes a module or read-model operation.

Each operation has a name, description, optional title and schemas for input, output and failure. Permission is a `resource:action` string or an explicit `null`. Its edges and flags default to `[]` and literal `false`. The flags are independent: `readOnly`, `destructive`, `transactional`, `needsApproval`. Set them directly or in a `flags` object. An explicit top-level flag takes precedence over the same flag in `flags`. Schemas require no services. Input is a Struct, a Union of Structs or `NoInput`. The latter accepts an empty object, not arbitrary fields.

Operation descriptors contain no handlers, services or place markers. Put reusable module descriptors in that module's browser-safe contract door. An app feature lives in `features/<name>/index.ts`. Application’s `defineFeature` includes its handler and makes it directly exposed.

## Edges and callers

A plain edge is the target descriptor. `asSystem(target, reason)` is a system edge:

```ts
const cancel = defineOperation("cancel_booking", {
  description: "Cancel a booking and request its refund.",
  input: NoInput,
  output: Schema.Void,
  failure: Schema.Never,
  permission: null,
  edges: [cancelBooking, asSystem(refundPayment, "refund after cancel")],
});
```

`asSystem` comes from this kit too. It rejects literal `""` in types. Dynamic empty or whitespace-only reasons are plain data until graph validation refuses them. Neither constructor throws.

Caller data has two forms:

```text
Caller
  PersonCaller { kind: "person", actor: Actor, via: string }
  SystemCaller { kind: "system", reason: string, startedBy: string }
```

A system edge switches a person path to system mode for that call and every descendant. A later system edge keeps the original system caller. The application runtime sets `startedBy` to `<feature> · <actor.id>` on the first switch. Hooks and schedules supply their own short start text. `targetOf(edge)`, `Target<E>` and `Targets<N>` recover target descriptors without losing their types.

## Pure graph checks and closures

`buildGraph(roots)` returns a result rather than throwing:

```ts
const result = buildGraph([cancel]);
if (result._tag === "Invalid") console.error(result.reason);
else console.log(result.graph.callables.map((operation) => operation.name));
```

It refuses cycles, distinct descriptors with the same name, repeated target edges in either mode, blank system reasons and read-only operations calling writes. Dispatch uses descriptor identity. Application wraps an invalid result in its typed acquisition error; invalid metadata is never executable.

`permissionClosures(operation, startsAs?)` returns `{ person, system }`. The person closure stops at the first system edge; the system closure includes everything below that edge. A system start puts every reachable permission in the system closure. Permissions are deduplicated within each closure. The walk visits each `(operation, mode)` pair once and terminates even on a forged cycle.

## Modules and policy

A root module is an Effect service declared with one stable id:

```ts
import { type Actor, defineModule } from "@house-rules/domain";
import { Effect } from "effect";

class Greetings extends defineModule<
  Greetings,
  { readonly greet: (actor: Actor) => Effect.Effect<string> }
>()("app/Greetings", {
  make: (options: { readonly prefix: string }) => Effect.succeed({
    greet: (actor: Actor) => Effect.succeed(options.prefix + actor.id),
  }),
}) {
  static readonly presets = { default: { prefix: "Hello " } };
}
```

An Effect `make` gives `layer`; an options function gives `layer(options)`. Acquisition is lazy. Effect owns memoization and scoped cleanup, and the layer retains missing ports and typed acquisition failures. Each declared method returns an Effect with no requirements. Capture long-lived dependencies once, not a request's identity. A service marked `PerRequest` cannot enter a module make.

`Actor` is a schema with `id: ActorId`, a branded non-empty string. Construct it with `Actor.make({ id: ActorId.make("user-1") })`. Methods that act for someone take that Actor explicitly.

Object access stays inside the module:

```ts
const policy = definePolicy({ owner: ["items:read", "items:write"], shared: ["items:read"] });
policy.allows("shared", "items:write"); // false
policy.table();
```

`withStates({ active: [...], frozen: [...] })` adds object state. A permission must be present in the relation list and the state list. `table()` is pure and covers relation, state and permission. A plan or app role belongs in the app's fixed permission lists; a quota needs the module's own data.

## Units of work

A feature owns the unit, not a module. A module write calls `UnitOfWork.required`; a memory adapter calls `UnitOfWork.onRollback(undo)` before changing its records. Without a live unit, both fail with `NoOpenUnit`. The app provides `memoryUnitOfWork` here or `sqlUnitOfWork` from application.

Nested atomic work joins the open unit without a savepoint. Memory units run top-level work one at a time per adapter instance and run every rollback hook newest first. A failed undo does not skip later undo hooks. A detached fiber cannot use a unit after it closes. `UnitOfWorkFailed({ reason })` means opening, committing or rolling back failed; both unit errors have kind `unavailable`.

`UnitOfWork.make(transaction)` is the adapter constructor. `CurrentUnit`, `Atomic`, `OpenUnit`, `UnitOfWorkService` and `UnitOfWork.holdsClosedUnit` support adapter authors. Memory does not model concurrent database transactions.

## Package doors

Install exact `@house-rules/domain` 0.1.0 with `effect` 4.0.3. Published packages load built JavaScript and declarations from `dist/`; this workspace reads `src/`.

The browser door, `@house-rules/domain/contract`, exports operation/edge/schema types and constructors, caller data, kinds, graph/closure functions, `Actor`, `ActorId`, `Permission`, `NoOpenUnit` and `UnitOfWorkFailed`.

The main door adds `defineModule`, its module support types, `PerRequest`, `NoPerRequest`, `definePolicy` and policy support types, `UnitOfWork`, `CurrentUnit`, `memoryUnitOfWork` and unit support types. There is no layer or migration registration for the kit itself. See [AGENTS.md](AGENTS.md) for the API table and module rules.
