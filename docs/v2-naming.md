# v2 naming and layers

This page fixes the words for decisions 32 to 35 in [v2-decisions.md](v2-decisions.md). Code, rules and docs use these words and no others.

## The layers

```text
ways-in         how the outside reaches the app: HTTP, MCP, a hook, a schedule
  │ start
features        what a user or the system can do; one feature per folder
  │ call (edges)
operations      what a domain module can do; declared by the module
  │ run
modules         packages that own data: tables, views, rules, adapters

read models     exposed queries, defineReadModel, declared read-only operation edges
projections     optional SELECT over published views; publish read operations
composition     picks adapters, binds operations, plugs sockets, opens ways
```

## The words

| Word | What it is | Where it lives | Builder |
| --- | --- | --- | --- |
| Feature | One thing the app lets someone do. It is its own entry: ways, hooks and schedules start it. | `apps/<app>/src/features/<name>/index.ts` | `defineFeature` |
| Feature registry | Every feature as one `Features` object | `apps/<app>/src/features/index.ts` | plain object |
| Operation | One thing a module can do, such as `Bookings.cancel` | the module package, exported from `./contract` as `<Module>Operations` | `defineOperation` |
| Operation binding | The code behind an operation; it captures the module's services | the module package, wired in composition | `bindOperation` |
| Edge | A declared call from a feature or operation to an operation only | the `edges` field | plain list, `asSystem(target, reason)` |
| Graph | All features, operations and edges together | built by the runtime | none |
| Runtime | Runs both entry kinds: shared gates, approval, one unit of work, trace | application kit | `Runtime.layer` |
| Way in | One door: HTTP API, MCP server | `apps/<app>/src/ways-in/<name>/` | `defineWay`, `endpoint` |
| Module | A package that owns data and its operations | `packages/<name>` or `examples/*/packages/<name>` | `defineModule` |
| Read model | Exposed query composing declared read-only operations | `apps/<app>/src/read-models/<name>/index.ts` | `defineReadModel` |
| Projection | Optional published-view SQL/service mount | `apps/<app>/src/projections/<name>/` | `defineOperation` and bindOperation |
| Composition | The root that wires everything | `apps/<app>/src/composition/` | `composition(...)` |

## Access words

| Word | What it is | Where it lives |
| --- | --- | --- |
| Permission | `resource:action` an operation needs, such as `bookings:cancel` | the operation, in code |
| Permission catalogue | Every permission the app's operations declare | built by the runtime |
| Person, Organisation | The parties an app knows | party |
| Relationship | A link between two parties, such as staff of or partner of | party |
| Role | A name plus a set of permissions from the catalogue | built-in: composition code; custom: party tables |
| Role assignment | A person holds a role, globally or within one organisation | party tables |
| May plug | Answers which permissions a caller holds; the gate checks them | `Party.may(...)`, plugged once in composition |
| Relation check | Whether this caller may touch this one object | inside the module's operation |

The gate checks roles at feature start. The module checks relations on the object.

## Rules of thumb

1. A feature handler only calls its declared edges through `call`. It never imports a module service, so the feature file stays browser-safe.
2. An operation handler gets real services. That is why it is bound in composition, not declared with its handler.
3. Features and read models are exposed directly. Ways, May lists, hooks and schedules accept their branded AnyEntryPoint union, never operations. Explicit kind distinguishes them; readOnly does not classify commands.
4. "Node" is gone from the API. "Edge" and "graph" stay.
