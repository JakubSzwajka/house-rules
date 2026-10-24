# @house-rules/relations: notes for agents

Relations stores typed edges between opaque `(kind, id)` nodes. It owns structural validation and graph traversal, not authority. This workspace package is private and is not part of a release.

## Boundary

Relations takes NO host port and performs NO access checks and NO node-existence checks. It validates only STRUCTURE from its config. The consuming app verifies endpoint existence and access in its feature BEFORE calling relate/unrelate. Authority-bearing relationships, including memberships and roles, belong to `@house-rules/party`, never here.

if removing an edge changes what someone may DO, it belongs in party; if it only changes what is shown or computed, it belongs in relations.

Do not add a target-access port, caller parameter, role lookup or endpoint-existence lookup. Reads also return structural facts without filtering. Apps must guard graph reads and avoid exposing edges or node ids the caller cannot see.

## Mounting

Import `Relations` and `RelationsMount` from the main door. Composition selects `Relations.layerMemory(options)` or `Relations.layerPostgres(options)`, and pairs the mount with that layer. Provide one shared unit adapter. Postgres also needs `SqlClient` and the module's migrations, registered as `{ "workspace": "packages/relations" }` in this workspace or by package in an installed app.

There is no host port. `RelationStore` is the module-owned storage port; adapters answer facts, while domain code checks structural limits. `bindRelations` captures the service once and supports person and system execution equally. The browser-safe contract door exports schemas, errors, permissions and `RelationsOperations`, never layers or bindings.

## Options and operations

Pass `nodeKinds`, `relationTypes`, `maxGraphSize` and `maxPageSize`. Each relation type declares `name`, allowed `source`/`target` kinds, `directed`, `acyclic`, `unique` and optional cardinality caps. Kind sets must be nonempty subsets of `nodeKinds`; type names and node kinds must be unique. Caps are positive integers. Directed types accept `maxOutPerSource` and `maxInPerTarget`; symmetric types accept `maxDegree` and cannot be acyclic.

`Relations.presets.default` supplies only graph/page limits. Add app-specific kinds and types in code. See [README.md](README.md) for an example and traversal semantics.

- `Relations.relate` and `Relations.unrelate` declare `relations:write` and are transactional. Unrelate is destructive.
- `Relations.listRelations` and `Relations.subgraph` declare `relations:read` and are read-only.
- `removeNode(ref)` is an idempotent facade hook, not an operation. Call it inside the node-deletion feature's unit.

## Fixed rules

Writes require `UnitOfWork.required`. The module never opens a unit. Memory registers undo before mutation and uses the shared `memoryUnitOfWork` to serialize units. Postgres joins the open transaction and takes a table-level writer lock before structural checks, holding it through commit or rollback. Use the same module config for every process sharing a database.

Node references are plain kind/id columns with no cross-module foreign keys. Symmetric edges use deterministic endpoint order, including when the allowed endpoint kinds differ. A self-edge counts once toward `maxDegree`; directed acyclic types reject it.

Cycle traversal uses a bounded memory walk or a recursive Postgres CTE. `maxGraphSize` bounds visited nodes during cycle checks, and bounds both nodes and edges returned by subgraph BFS. Crossing a bound fails `GraphTooLarge`, never returns a partial graph. Parallel edges count separately. Depth zero returns only the root. Direction follows stored order; use `both` for symmetric traversal.

Unavailable errors use fixed public text and retain causes internally. Test changes against both memory and real Postgres with `MigrationsTesting.database`. Run `pnpm check` and `pnpm test` before calling work ready.
