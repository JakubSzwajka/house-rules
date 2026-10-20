# @house-rules/domain: notes for agents

Domain modules are packages, never app folders. App areas are features, read-models, ways-in and composition. App node files live in features/<name>/; node.ts, entry.ts, handler.ts and defineNode keep their names.

## What it does

The domain kit owns node descriptors, edges, caller data, error kinds, pure graph checks and permission closures. It also owns modules, object policy and the unit of work. It imports no house-rules package. Version 0.1.0 peers on exact `effect` 4.0.3. Read `README.md` for examples.

## Public API and doors

`@house-rules/domain/contract` is browser-safe. The main entry exports these same domain-owned names:

| Names | Contract |
| --- | --- |
| `defineNode`, `Node`, `AnyNode` | `defineNode(name, { description, title?, input, output, failure, permission, edges?, readOnly?, destructive?, transactional?, needsApproval? })`. Permission is `resource:action` or `null`; omitted flags are literal `false`. |
| `asSystem`, `SystemEdge`, `Edge`, `Target`, `Targets`, `targetOf` | A plain edge is its target descriptor. `asSystem(target, reason)` switches the caller downward. Literal empty reasons fail types; blank dynamic reasons fail graph validation. |
| `PersonCaller`, `SystemCaller`, `Caller` | `{ kind: "person", actor, via }` or `{ kind: "system", reason, startedBy }`. These are data, not services. |
| `ErrorKind`, `KindedError`, `errorKind`, `NodeFailureSchema` | Kinds are `not_found`, `conflict`, `forbidden`, `unavailable`, `invalid`. Use `kind: errorKind("not_found")` in a `Schema.TaggedError` field. Its constructor supplies the kind. Every node failure member must have a kind, tag and message. `Schema.Never` is valid. |
| `PlainSchema`, `InputSchema`, `StructInput`, `UnionInput`, `NoInput` | Schemas need no encoding/decoding services. Input is a Struct, a Union of Structs, or `NoInput`, the empty string-keyed record. |
| `buildGraph`, `Graph`, `GraphResult` | Returns `{ _tag: "Valid", graph: { nodes } }` or `{ _tag: "Invalid", reason }`, never throws. Rejects cycles, conflicting names, repeated targets, blank system reasons and read-only edges into writes. |
| `permissionClosures`, `Closures` | Returns deduplicated `person` and `system` permission arrays. Optional start mode is `"person"` or `"system"`. A system path never returns to person mode. Forged cycles terminate. |
| `Actor`, `ActorId`, `Permission`, `NoOpenUnit`, `UnitOfWorkFailed` | Shared identity, permission and unit errors. Both unit errors have kind `unavailable`. |

Main-only exports are `defineModule` and its support types, `PerRequest`/`NoPerRequest`, `definePolicy` and its policy types, `UnitOfWork`, `CurrentUnit`, `memoryUnitOfWork`, `Atomic`, `OpenUnit` and `UnitOfWorkService`. Application owns bindings, entries and execution. Never add an application import here, including a type-only import.

## Mounting modules and storage

There is no kit-wide layer or `migrations.json` entry. Declare a module with `defineModule<Self, Shape>()(id, { make })`. An Effect make gives `layer`; an options function gives `layer(options)`. The app root provides its ports and one unit adapter:

```ts
Layer.mergeAll(Bookings.layer.pipe(Layer.provide(store)), memoryUnitOfWork);
```

1. [ ] Keep each module method's requirements `never`. Capture long-lived ports during layer acquisition, never a service marked `PerRequest`.
2. [ ] Pass an explicit `Actor` into a method that acts for a person. Object access belongs inside the module, next to its data.
3. [ ] Stored modules ship memory and Postgres adapters plus a shared store suite. Memory registers undo before changing state; Postgres checks `UnitOfWork.required` before writing.
4. [ ] Modules never open units. An application entry lifts transactional flags and opens one unit around its graph. Tests and tooling in repository-root scripts/ or the workspace's own top-level scripts/ beside package.json may call `UnitOfWork.atomic`. Nested production scripts have no exception.
5. [ ] Register a stored module's own migrations in the app's module list. This kit owns no tables.

`UnitOfWork.required` and `onRollback` fail with `NoOpenUnit` outside a live unit. Nested atomic work joins its unit. A fiber that outlives a unit cannot keep using it. Memory rollback runs every undo newest first, including after a failed undo. `definePolicy` checks object relations; `withStates` intersects relation permissions with object-state permissions.

## Fixed rules

Descriptors are browser-safe data. Defining a node or edge never throws. Descriptor identity, not just its name, identifies a target. There is no location marker or permission invented for an entry. Module construction stays lazy and scoped through Effect Layers, with no global module cache. Run tests through `@effect/vitest`.
