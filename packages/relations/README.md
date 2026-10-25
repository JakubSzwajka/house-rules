# @house-rules/relations

Typed structural edges between opaque nodes, with cardinality and cycle checks. The package is publish-ready but is not part of the release workflow. Nothing has been published.

Relations does not check access or node existence. The app must verify both endpoints in its feature before it calls `relate` or `unrelate`. Memberships, roles and other authority-bearing relationships belong in Party.

> if removing an edge changes what someone may DO, it belongs in party; if it only changes what is shown or computed, it belongs in relations.

## Configure and mount

```ts
import { Relations, RelationsMount } from "@house-rules/relations";

const relations = Relations.layerMemory({
  ...Relations.presets.default,
  nodeKinds: ["document", "folder"],
  relationTypes: [
    {
      name: "contains",
      source: ["folder"],
      target: ["folder", "document"],
      directed: true,
      acyclic: true,
      unique: true,
      maxInPerTarget: 1,
    },
  ],
});
```

Composition pairs `RelationsMount` with this layer and a shared `memoryUnitOfWork`. For Postgres, select `Relations.layerPostgres` instead, provide `SqlClient` and `sqlUnitOfWork`, and run the owning module's `migrations/` through `@house-rules/migrations`. This workspace registers it in root `migrations.json`. There are no cross-module foreign keys and no host-access port.

All limits are positive integers. Endpoint kind lists must be nonempty subsets of `nodeKinds`. Duplicate node kinds or type names fail layer acquisition with `RelationsInputInvalid`. Symmetric types cannot be acyclic or use directed cardinality caps. Directed types cannot use `maxDegree`.

## Operations

The browser-safe `@house-rules/relations/contract` door exports `RelationsOperations`, `RelationEvents`, schemas, errors and `RelationsPermissions`. Features declare these descriptors as edges; composition captures the service with `bindRelations` through `RelationsMount`.

| Operation | Input | Result | Permission and flags |
| --- | --- | --- | --- |
| `relate` | `{ type, source: { kind, id }, target: { kind, id } }` | `{ relation, events: [Related] }`; relation has `id` and epoch-millisecond `createdAt` | `relations:write`, transactional |
| `unrelate` | `{ id }` | `{ events: [Unrelated] }` | `relations:write`, transactional, destructive |
| `listRelations` | `{ node, type?, direction, page?: { size?, cursor? } }` | `{ edges, next? }` | `relations:read`, readOnly |
| `subgraph` | `{ root, type, direction, depth? }` | `{ nodes, edges }` | `relations:read`, readOnly |

Facade methods use the same input objects, except `unrelate(id)` takes the id directly. They take no Actor. Person and system bindings behave the same after the app's permission gates.

`RelationEvents.Related` and `RelationEvents.Unrelated` declare `{ kind: "Related" | "Unrelated", type, source: { kind, id }, target: { kind, id } }`. Each successful write returns its fact in stored endpoint order. Unrelate returns the endpoints of the edge it actually deleted. Read results are unchanged. The module returns plain data, never emits, never depends on event-log and never reads `CurrentActor`. Features choose whether to record facts through explicit event-log edges; event-log supplies the envelope.

`removeNode(ref)` is a facade-only cascade hook. Call it inside the same feature unit that deletes a node. It removes every touching edge, across all types, and succeeds when none exist. It accepts any nonempty kind and id, including a kind removed from config. It does not delete or verify the node. It returns void and no events because node deletion is a fact owned by the node's module.

## Graph semantics

Symmetric types store endpoints in deterministic kind-then-id order. Either input orientation is valid if it matches the declared endpoint kind pairing. Reversing the arguments finds the same duplicate when `unique` is true. Set `unique: false` to allow parallel edges with separate ids.

Directions `out` and `in` follow stored source and target columns. Use `both` for symmetric edges. Lists order by `(createdAt, id)` and use an exclusive cursor; requested page size is capped at `maxPageSize`.

Directed caps count edges leaving a source or entering a target, per type. Symmetric `maxDegree` counts touching edges, including a self-edge once. Each parallel edge counts. Checks run inside the write unit. Postgres serializes insertions of one relation type with a transaction-scoped advisory lock; different types can run in parallel. Deletions need no advisory lock. The checks rely on the assumed default READ COMMITTED isolation level. Memory uses the shared unit adapter's serialization.

For an acyclic directed type, `relate(source, target)` searches from target for source before insertion. Self-edges fail `RelationCycle`. Postgres uses a recursive CTE with node deduplication and a demand limit; memory walks the same directed graph. If visited nodes exceed `maxGraphSize`, the write fails `GraphTooLarge` rather than assuming the graph is acyclic.

Subgraph uses BFS. Omitted depth traverses until exhaustion or the bound; depth zero returns the opaque root alone even if it has no edges. Nodes and edges are deduplicated by reference and edge id. Both counts must fit `maxGraphSize`, so parallel edges cannot produce an unbounded result. Exceeding either bound fails `GraphTooLarge` without a partial result.

## Failures and units

Unknown types and invalid endpoints use `RelationTypeUnknown` and `RelationEndpointInvalid`. Duplicate, cardinality and cycle failures are conflicts. Removing an absent id returns `RelationNotFound`. Invalid page/depth/options use `RelationsInputInvalid`; oversized traversal uses `GraphTooLarge`. Store failures use `RelationsStoreUnavailable` with fixed public text and an internal cause.

Every write, including the cascade hook and adapter writes, fails `NoOpenUnit` outside a live unit. The module never opens one. Memory undo runs on rollback; Postgres joins the existing transaction.

## Tests

```sh
docker compose up -d
pnpm --filter @house-rules/relations typecheck
pnpm --filter @house-rules/relations build
pnpm --filter @house-rules/relations test
```

Shared storage and structural suites run on memory and a fresh real Postgres database created through `MigrationsTesting.database`. Runtime tests exercise the mount, bindings and transactional feature execution.
