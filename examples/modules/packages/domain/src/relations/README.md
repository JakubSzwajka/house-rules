# Relations

Typed, directed edges between opaque nodes, such as `folder:1 contains doc:7`. A node is any string the app chooses; relations never checks that it exists.

## Compose

```ts
import * as Relations from "./relations/index.ts";

class App extends Domain.Model("App", {
  aggregates: [...Relations.aggregates],
  views: [...Relations.views],
}) {}
```

## Blocks

- `Edge` is keyed by `edgeId(from, type, to)`, so one edge exists per triple. `Relate` records `EdgeRelated` once; relating again records nothing. `Unrelate` records `EdgeUnrelated`, and nothing when the edge is absent. A target that is not the `edgeId` of the command's endpoints is `EdgeIdMismatch`.
- `NodeEdges` is keyed by node and holds its `out` and `in` links, each `{ type, node }`. A self edge shows in both.
- `Relate` and `Unrelate` check `relations:write`; reading `NodeEdges` checks `relations:read`. An agent with the grant relates as itself (`by` is its id, `for` its person).

## Relations are not authority

If removing an edge changes what someone may do, it does not belong here. Memberships, roles and owners live in the aggregate that guards the action, and its `decide` checks them. Never read `NodeEdges` to authorize a command.

Holding `relations:write` lets an actor link any two nodes, and `relations:read` reveals every node id in the graph. So an app should:

- grant `relations:write` only to a system actor, and relate from a policy that reacts to its own events, after its own aggregate checked access to both endpoints;
- grant `relations:read` only to audiences that may see the whole graph, and otherwise answer through its own views;
- unrelate a deleted node's edges from the policy that handles the deletion, reading `NodeEdges` for the list.

## Dropped from the old module

Configured node kinds and relation types, symmetric edges, parallel edges, cardinality caps, cycle checks, paging and subgraph traversal. Caps and cycle checks span many edges, so they cannot hold inside one `Edge`; a structure that needs them is the app's own aggregate. Clients walk the graph through `NodeEdges`.
