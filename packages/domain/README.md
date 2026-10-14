# @house-rules/domain

The domain kit. A package uses it to define its domain module: one root service, the `Actor` its methods act for, the permissions and policy it checks on its own data, and the unit of work its writes join. It knows nothing about requests, contracts, gates or delivery. Those belong to [`@house-rules/application`](../application/README.md), which depends on this package. This package depends on no other house-rules package.

```text
@house-rules/domain          define domain modules
  module      defineModule
  identity    Actor, ActorId
  access      Permission, definePolicy            object-level authorization
  data        UnitOfWork, CurrentUnit, NoOpenUnit, UnitOfWorkFailed, memoryUnitOfWork
  marker      PerRequest                          defineModule refuses to capture it
  /contract   Actor, ActorId, Permission, UnitOfWorkFailed   browser-safe
```

## Root modules

A package's root module uses `defineModule`. It declares one stable service id and the methods callers may use. It is still an ordinary `Context.Service` class.

```ts
import { type Actor, defineModule } from "@house-rules/domain";
import { Effect } from "effect";

class Greetings extends defineModule<
  Greetings,
  { readonly greet: (actor: Actor) => Effect.Effect<string> }
>()("app/Greetings", {
  make: (options: { readonly prefix: string }) =>
    Effect.succeed({
      greet: (actor: Actor) => Effect.succeed(options.prefix + actor.id),
    }),
}) {
  static readonly presets = { default: { prefix: "Hello " } };
}

const greetings = Greetings.layer(Greetings.presets.default);
```

`Greetings.id` equals its service key. An Effect `make` gives a Layer value; a function `make(options)` gives `layer(options)`. Presets stay plain data. Adapter statics such as `layerPostgres`, `layerMemory` and `fromRecords` belong in the class body, composed with `Layer.provide`.

Every declared method returns `Effect<Success, Failure, never>`. Construction captures long-lived dependencies once within a Layer build. For example, Bookings captures BookingStore; `Bookings.layer` still requires that port until the composition root provides an adapter. Acquisition failures remain in the Layer's error type. Scope requirements are handled by Effect's Layer scope. Construction is lazy, including options functions, and scoped finalizers run when that scope closes. Two `Layer.build` runs build twice. There is no singleton, global registry, private nesting or Entity constructor. One module per package stays the rule.

## Actor and the per-request marker

`Actor` is a schema with one field, `id: ActorId`, a branded non-empty string. Build it with `ActorId.make(id)`, not an arbitrary string. A module method that acts for a user takes the Actor as an explicit argument and checks access itself:

```ts
const actor = Actor.make({ id: ActorId.make("user-1") });
const greeting = Effect.flatMap(Greetings, (greetings) => greetings.greet(actor));
```

A module never stores request identity at build time. `PerRequest` is a generic marker for that rule. A service that holds one request's value declares it, and `defineModule` fails `tsc` for a `make` that requires a marked service, in either form:

```ts
class RequestLocale extends Context.Service<RequestLocale, string>()("app/RequestLocale") {
  declare readonly [PerRequest]: typeof PerRequest;
}
```

The application kit's `CurrentActor` carries this marker. This package never names it, so it stays free of application concepts.

## Permissions and policy

A `Permission` is a `resource:action` string, such as `trips:delete`. The module that owns the resource names its permissions next to its data. A contract in the application kit declares one, and the application's `Grant` checks it before any data is read: that is action-level authorization. Whether this caller may act on this one object is object-level authorization, and the module answers it from its own data.

A relation is how the caller stands to one object, such as owner or shared. `definePolicy` gives the shape:

```ts
import { definePolicy } from "@house-rules/domain";

export const tripPolicy = definePolicy({
  owner: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  shared: ["trips:read", "trips:write"],
});

tripPolicy.allows("shared", "trips:delete"); // false
tripPolicy.table(); // { owner: { "trips:read": true, ... }, shared: { ..., "trips:delete": false } }
```

`table()` is pure, so a test compares the whole who × action table to a literal. A permission no relation holds does not appear in the table.

An object also has a state, such as a Trip that is active or frozen. `withStates` adds that dimension and leaves the relation-only policy as it was:

```ts
export const tripPolicy = definePolicy({
  owner: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  shared: ["trips:read", "trips:write"],
}).withStates({
  active: ["trips:read", "trips:write", "trips:delete", "trips:share"],
  frozen: ["trips:read", "trips:delete"],
});

tripPolicy.allows("owner", "frozen", "trips:write"); // false: the state does not carry it
tripPolicy.allows("owner", "frozen", "trips:delete"); // true: both carry it
```

`allows(relation, state, permission)` is true only when the relation's list and the state's list both hold the permission. `table()` covers relation × state × permission. A state can only list permissions the relations name, and an unknown state or permission does not compile. The types are `StatefulPolicy<Relation, State, P>` and `StatefulPolicyTable`. `Policy<Relation, P>` stays the four-field shape (`relations`, `permissions`, `allows`, `table`), so a hand-written one still type-checks. `definePolicy` returns `PolicyBuilder<Relation, P>`, a `Policy` plus `withStates`.

A plan, such as free or paid, is a fact about the caller, so it feeds the application's Grant. The state of an object goes in the stateful policy. A quota, such as five trips at most, needs a count, so the module counts inside the unit of work its write runs in.

## Units of work

A use-case owns the transaction, not the module. `UnitOfWork` is a slot; this package defines it and ships the memory adapter. `sqlUnitOfWork`, the Postgres adapter, lives in the application kit.

| Adapter | Package | Use |
| --- | --- | --- |
| `memoryUnitOfWork` | domain | memory stores: runs the effect, and on failure runs the rollback hooks the stores registered; one unit at a time |
| `sqlUnitOfWork` | application | Postgres: one `SqlClient.withTransaction` per unit |

A module never opens a unit. Its write path checks for one, with no requirement added to the service method:

```ts
// In a module's Postgres store: fails with NoOpenUnit when no unit is open.
put: (booking) => UnitOfWork.required.pipe(Effect.andThen(sql`insert into booking ...`)),

// In a module's memory store: register the undo, then change the map.
put: (booking) =>
  UnitOfWork.onRollback(Effect.sync(() => rows.delete(booking.id))).pipe(
    Effect.andThen(Effect.sync(() => rows.set(booking.id, booking))),
  ),
```

A use-case opens one with `transactional: true` on its contract, or with `UnitOfWork.atomic(effect)` around the part that must be atomic. A nested `atomic` joins the open unit: no new transaction, no savepoint. `UnitOfWorkFailed({ reason })` means the unit could not begin, commit or roll back. The work's own errors and defects pass through unchanged.

`CurrentUnit` is a `Context.Reference` holding the open unit, `undefined` by default, so reading it adds no requirement. Memory stores have no row locks, so `memoryUnitOfWork` runs top-level units one at a time, per layer instance. A nested `atomic` never waits, so it cannot deadlock. A fiber that outlives its unit gets `NoOpenUnit` from `required` and `onRollback`, and should open its own unit. On rollback every undo hook runs, newest first, even when one fails or dies. The memory adapter is for tests and scripts; it does not model concurrent transactions.

`UnitOfWork.make(transaction)` builds another adapter from a function that wraps an effect in a transaction. `UnitOfWork.holdsClosedUnit` lets such an adapter tell a fiber that outlived its unit from a nested call. `UnitOfWorkService`, `OpenUnit` and `Atomic` are the support types for adapter authors.

## Install in another app

```json
{
  "dependencies": {
    "@house-rules/domain": "0.1.0",
    "effect": "4.0.3"
  }
}
```

1. [ ] Pin it and `effect` to exact versions. `effect` is an exact peer.
2. [ ] The package ships built JavaScript and `.d.ts` files in `dist/`. Plain `node` loads it. Browser code imports `@house-rules/domain/contract`.
3. [ ] An app that also uses contracts and delivery installs [`@house-rules/application`](../application/README.md) 0.1.0, which peers on this exact version.

This package and `@house-rules/application` replace `@house-rules/capability`, which stays at 0.16.0 on npm and gets no new versions. See [Upgrading from capability](../application/README.md#upgrading-from-house-rulescapability).

## Exports

Root entry: `defineModule`, `Actor`, `ActorId`, `PerRequest`, `definePolicy`, `UnitOfWork`, `CurrentUnit`, `memoryUnitOfWork`, the `NoOpenUnit` and `UnitOfWorkFailed` errors, and the types `ModuleClass`, `ModuleDeclaration`, `ModuleLayer`, `ModuleMethod`, `ModuleShape`, `NoPerRequest`, `Permission`, `Policy`, `PolicyBuilder`, `PolicyTable`, `StatefulPolicy`, `StatefulPolicyTable`, `Atomic`, `OpenUnit` and `UnitOfWorkService`.

Contract entry, `@house-rules/domain/contract`: `Actor`, `ActorId`, `UnitOfWorkFailed` and the `Permission` type.
