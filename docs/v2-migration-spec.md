# v2 migration: spec

Status: revision 5. Revision 5 is the owner's change: the example comes back inside phase 1 instead of phase 2. Revision 4 came after three feasibility reviews (FAIL with 13 findings, FAIL with 5 new ones, then one blocker on node.ts imports; all addressed). Leader: the session that wrote this file. The owner's decisions are in `docs/v2-decisions.md`. The spike that proved the shape is `examples/booking-v2/`, built from `docs/v2-spec.md`. This spec is the real migration: v2 becomes the only shape of the framework. Nothing old is kept beside it.

## 1. Outcome

When the migration is done, all of this is true:

1. The framework kits own the v2 shape: nodes, edges, the caller context, entries, closures, ways in, sockets and plugs, error kinds, the step trace and the registry. The spike's `kit` package is gone.
2. The rules package checks the v2 app layout: nodes, folder modules, read models, ways in and the composition. The use-case rule is gone.
3. `examples/booking/` is the only example. It is the spike rebuilt in the final shape, with no `v2` names and no spike framing. `examples/booking-platform/` and `examples/booking-v2/` are gone.
4. The shared modules (`comments`, `party`, `identity`) and the plugs (`auth-jwt`, `call-audit`) speak the v2 shape.
5. `AGENTS.md`, `CONTEXT.md`, `README.md`, the `house-rules` skill, the docs site, every package `AGENTS.md`, `eslint.config.mjs` and CI describe and check v2 only.
6. From the repo root, with the local Postgres running, these exit 0: `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test` and `pnpm run packed-consumer`.

## 2. The v2 shape

This section is the design. It is self-contained on purpose. Names in `code` are the public API names. A lane may rename an internal helper. It may not rename a public name without asking the leader.

### Nodes and edges

- A **node** is one thing the system can do or read. It has a `name`, a `description`, an optional `title`, an `input`, an `output` and a `failure` schema. It also has its own `permission` or `null`, the flags `readOnly`, `destructive`, `transactional` and `needsApproval`, and its `edges`.
- An **edge** is a node this node may call. A person edge is the target node itself. A system edge is `asSystem(target, reason)`, with a reason that is not blank. The type rejects a literal empty reason, and the runtime rejects a blank one.
- A **handler** gets a scope `{ caller, call }`. `call` accepts only that node's declared edges, enforced by types. An inner call joins the open unit of work, runs under the right caller, and adds one step to the step trace.
- The graph has no cycles. A `readOnly` node has only `readOnly` edges.
- A node's **place** is a folder, never a field. There is no `marker`. A module's nodes live in that module. An app's own nodes live in `apps/<app>/src/nodes/`.

### Caller context

- Every call runs as `Person { actor, via }` or as `System { reason, startedBy }`. `via` names the way in.
- A system edge switches to `System` for that call. Below it, everything runs as the system. It never switches back.
- `startedBy` is short text: `"<entry> · <actorId>"` under a person, `"hook:<name>"` for a hook, `"schedule:<name>"` for a schedule.
- The system has its own permission list, set by the composition.

### Entries

- An **entry** is where a call graph starts. There are three kinds: a node exposed by a way in, a hook (such as first sign-in), and a schedule.
- Only app nodes become entries. A lint rule checks it where the entry is built (section 4, rule 6). Folder import bans alone do not prove it.
- Each entry has two **closures**:
  - The **person closure** is the entry node's own permission plus the permissions of every node reached through person edges, stopping at the first system edge.
  - The **system closure** is every permission at or below a system edge. When the entry starts as the system, it is everything the entry reaches.
  - Both are deduplicated.
- The entry runs the gates once for its whole graph, in this order:
  1. The record opens.
  2. Both closures are checked: the person closure against the way in's list, and the system closure against the system list. A missing permission fails with `Forbidden`, naming the missing permission and the caller kind.
  3. Approval is asked once, if any reachable node has `needsApproval`.
  4. One unit of work opens, if any reachable node is `transactional`.
  5. The nodes run. Inner calls never ask approval, never open a unit, and never write a record row.
- The entry's flags come from the graph:
  - `needsApproval`, `transactional` and `destructive` are true when any reachable node has them (decision 19).
  - `readOnly` is true only when every reachable node is read-only.
  - MCP and HTTP read these flags from the entry.
  - Flags keep their literal types where the spike widened them to `boolean`. A read-only entry needs no unit of work, and a system entry needs no `CurrentActor`, in its type. Type tests prove both.
- There is no synthetic `entry:<name>` permission, and no wrapper that turns an entry into an old contract. The entry is the thing delivery serves.

### Gate policy (P2, still open)

`gatePolicy` is a named composition option:
- `"entry-and-recheck"` is the default. Every inner call also re-checks its own node's permission, against the person's list or the system list. A failed re-check fails with `Forbidden` naming the inner permission. This is expected; record it in the docs.
- `"entry-only"` skips the inner re-check.

Both values stay, with tests, until the owner settles P2.

### Modules

- A **module** owns its data and rules and offers nodes. It keeps today's storage port, memory and Postgres adapters, shared store suite, policies and `UnitOfWork.required`. P4 (the data socket) is out of scope.
- A module defines its service with `defineModule`, exports its node descriptors beside it, and binds each node to the service. The binding API lives in the application kit; every module package already depends on it. The spike's `bindBookings(service)` shape is acceptable.
- The app's own modules are folders: `apps/<app>/src/modules/<name>/`. Shared modules are packages under `packages/`. Both follow the same inside rules: one door, subject folders, adapters under `adapters/`, migrations under `migrations/`, no cycles.

### Read models

- A **read model** is one folder per screen under `apps/<app>/src/read-models/<name>/`, such as `my-bookings/`. It holds read-only nodes, a port, and a Postgres adapter. Like a folder module, it has two doors: `index.ts`, and `contract.ts` with its node descriptors only, browser-safe.
- Its SQL selects only from **published views**. It never names a table, never writes, and filters by the calling person in SQL.
- A module publishes a view by creating it in its own migration: `CREATE VIEW <name> AS ...` over its own tables. A view is owned by the module that creates it.
- A read model has no memory adapter. Without `DATABASE_URL`, the composition plugs a named "read unavailable" port, which fails with an `unavailable` error (decision 12).

### Errors and views

- Every expected error declares a **kind**: `not_found`, `conflict`, `forbidden`, `unavailable` or `invalid`. The kit gives one way to declare it on a `Schema.TaggedError` class. A node whose failure schema holds an error with no kind is a type error.
- The application kit maps each kind to a default status and code: `not_found` 404, `conflict` 409, `forbidden` 403, `unavailable` 503, `invalid` 400. The default message comes from the error.
- Gate and plumbing errors carry kinds, set where they are defined: `Forbidden` and `ApprovalDenied` (forbidden), `NoOpenUnit` and `NodeCallInvalid` (unavailable, or a defect where they cannot happen), `SqlError` (unavailable, mapped by the kit), `AuthJwtConfigInvalid` (unavailable, in `auth-jwt`). An app never maps plumbing errors by hand.
- A way in may hold **wording overrides**: a table keyed by error tag that changes the message only. The status and code always come from the kind (decision 17). A different status needs a different kind. Overrides live in that way's folder under `ways-in/`. The composition holds no views.
- 500 stays reserved for defects.

### Ways in, sockets and plugs

- A **way in** is a named value: its name, its path, the entries it exposes, its plugs for "Who is this?", "What may they do?" and "Do they mean it?", and its wording overrides.
- The kit turns the list of ways into one fetch handler. It routes by path and includes the MCP metadata paths. The app writes no `if`-chain and no route table.
- Grant scope (decision 18): a way's closure check accepts only the entries that way exposes. Hooks and schedules use the system plug.
- The four sockets and their plugs:
  - **Who:** token source, authenticator, actor resolver and the new-login hook. The concrete plugs live in `auth-jwt` and `identity`, never in the application kit, which would make an import cycle.
  - **May:** a fixed permission list per way, plus the system list.
  - **Mean:** approval. `no` for plain HTTP, `elicitation` for MCP, `allow` for in-process calls.
  - **Record:** call-audit. One row per entry, a refused entry included. The row carries the entry name as its target. The concrete plug lives in `call-audit`.
- The application kit owns the socket interfaces and the generic May and Mean plugs. `node-host` keeps taking a plain fetch handler and imports neither Effect nor the kits.
- The **step trace** keeps one step per inner call: target, caller kind, system reason, outcome and order. It is keyed by request id and kept in memory, with a bound on how many requests it keeps. The bound is an option, and the oldest requests are dropped first. Each step keeps its `entry` name, so a hook and a web entry in one request stay apart. Reading an unknown request id never creates a bucket and never evicts one.

### The registry

- Each app has a generated `REGISTRY.md` beside its `package.json`. It shows every node, who calls whom, every ⚙ system edge with its reason, both closures of every entry, and the ways in that expose each entry.
- The kit has a pure render function. The app has a `registry` script that writes the file, and a test that fails when the file is stale. The test never rewrites the file.

### Graph checks at build time

The composition's runtime layer fails with a typed `GraphInvalid` error, not a thrown exception, when any of these holds:
- the graph has a cycle
- a reachable node has no binding
- a way exposes a node twice

Defining a node never throws.

### The composition

`apps/<app>/src/composition/` reads as five verbs: mount modules and read models, link modules, plug sockets, open ways, and schedule entries. It is the only place that provides services, plugs, lists and the gate policy.

## 3. Where things go in the framework

| Package | Gains | Loses |
| --- | --- | --- |
| `@house-rules/domain` | `defineNode`, `asSystem`, edges, the `Caller` data type (`Person`, `System`), the error-kind declaration, graph building and closures | nothing it needs |
| `@house-rules/application` | the caller context service, the binding API, entries, the node runtime with the gate policy, ways in and the router, the socket interfaces, the May and Mean plugs, kind-to-status views and overrides, the step trace, the registry render, `GraphInvalid` | `defineContract`, `implement`, `toTool` and `route` as app-facing calls, the per-app views table in `composition()` |
| `@house-rules/node-host` | nothing; it serves the router's fetch handler | nothing |
| `@house-rules/migrations` | folder modules in the module list (section 4, rule 5) | nothing |
| `@house-rules/rules` | the checks in section 4 | `use-case-is-capability` |

### The domain and application split

The spike's kit mixed both layers: its node file imports application schema types, its bindings name the caller and application errors, and its graph builder throws `GraphInvalid`. The port splits it like this:

1. The domain kit owns descriptors, edges, `UnitOfWork` with `NoOpenUnit` and its kind (they stay where they are; nothing moves or duplicates them), `asSystem`, the `Caller` data type, error kinds, graph building and closures. Its node schemas use Effect `Schema` types only. Graph building returns a plain result (a valid graph, or the reason it is invalid). It imports no house-rules package and never names `CurrentActor`.
2. The application kit owns everything that runs: the `CallerContext` service, the binding API and the scoped call's failure union (`Forbidden`, `NodeCallInvalid`, and the domain's `NoOpenUnit`), the runtime, and `GraphInvalid`, which wraps the domain's invalid result.
3. Fixtures prove the split: a domain file that imports the application kit fails `pnpm check`.

### Browser-safe descriptors, the client and HTTP metadata

- Node descriptors hold only schemas, names, flags and edges to other descriptors. They load in a browser. A package exports them from its `./contract` entry, a folder module from its `contract.ts`, and an app node from its `node.ts`. Bindings never enter any of these.
- An entry's derived flags and closures are computed from descriptors alone, so a browser can compute them too.
- An **HTTP endpoint descriptor** replaces today's `EndpointShape`: an entry's descriptor plus its method, path, success status, error codes and session option. It is browser-safe and exported from `@house-rules/application/contract`. A way in builds its routes from these descriptors, and the client reads the same ones. Route defaults stay as `route()` has them today.
- Today's client (`packages/application/src/client/`) keeps working against endpoint descriptors. Its tests are ported. The browser proof is the dependency rule in section 4, rule 2, applied to the example's real `nodes/*/node.ts` and web endpoint file.
- OpenAPI marks a destructive operation with `x-house-rules-destructive: true`, and a read-only one with `x-house-rules-read-only: true`. The client reads neither.

The phase 1 lane writes the final API in `packages/application/AGENTS.md` and `packages/domain/AGENTS.md`. The orchestrator sends the leader that API before phase 2 starts.

## 4. The rules

These replace the v1 app layout rules. Each new rule gets a row in the rules table of `packages/rules/README.md`, docs, and tests with passing and failing fixtures.

App layout:

```
apps/<app>/src/
  nodes/<name>/     one app node: node.ts (descriptor) and handler.ts (binding)
  modules/<name>/   the app's own modules
  read-models/<name>/
  ways-in/<name>/   one folder per way: the way value, overrides, a web page if any
  composition/      the one composition root
  main.ts           the Host call
  index.ts          optional
```

1. **`app-folders`** replaces the v1 layer list. App code sits only in the folders above, plus `main.ts` and `index.ts`. `delivery/`, `server/` and `use-cases/` stop being layers. Wherever a rule or preset says "delivery" today, it now says "ways in".
   - **Next host.** `layout({ host: "next" })` keeps `src/app/` as Next's own way-in folder (`deliveryLayer: "app"` becomes the way-in layer). It keeps every other host-owned file in `packages/rules/src/hosts.cjs`: `proxy.ts`, `instrumentation.ts`, `next-env.d.ts`, `.next/` and the shell-free `global-error`. `src/app/` follows the same import rules as a `ways-in/` folder. `scripts/packed-next-host.mjs` moves to this layout, with its positive and negative cases.
2. **`node-file`** replaces `use-case-is-capability`. Each app node is a folder `nodes/<name>/` with two files:
   - `node.ts` exports exactly one node descriptor and no other value. It may import only: `effect` for `Schema`, the domain kit's contract entry (`defineNode`, `asSystem`, error kinds), other nodes' `node.ts`, a module's `contract.ts`, a read model's `contract.ts`, and a package's `./contract` entry. It must load in a browser.
   - `handler.ts` exports exactly one binding, for the descriptor in its own `node.ts`, and no other value.
   - Types are fine in both. A `tests/` folder is allowed.
   - `contract-entry-is-browser-safe` extends to every `nodes/*/node.ts`, every module and read-model `contract.ts`, and the endpoint file a way in exports for a client. Passing fixtures: a `make_booking`-shaped node that builds its input and failure with `Schema.Struct` and `Schema.Union`, and a `my_bookings`-shaped node with a read-model edge. Failing fixture: a `node.ts` that imports a `handler.ts`. That rule is the browser proof; add no bundler.
3. **Import directions** (Dependency Cruiser, severity error):
   - `nodes/` may import other nodes (no cycles), any module's or read model's `index.ts` or `contract.ts`, packages and kits. `node.ts` stays inside the browser-safe set above. Never `ways-in/` or `composition/`.
   - `modules/<x>/` may import packages and kits, and another module only through `modules/<y>/index.ts`, with no module cycles. Never `nodes/`, `read-models/`, `ways-in/` or `composition/`.
   - `read-models/<x>/` may import packages and kits only. From outside, only its `index.ts` and `contract.ts` are importable.
   - `ways-in/` may import `nodes/` and `composition/`. It may import `modules/` and `read-models/` for types only.
   - `composition/` may import `nodes/`, `modules/`, `read-models/`, packages and kits. Never `ways-in/`.
   - `main.ts` may import `composition/` and `ways-in/`.
   - Ways in never import each other.
4. **Folder modules follow the package rules.** The rules that hold inside a package also hold inside `modules/<name>/`: root files (`package-root-files`), subject folders and their cycles, adapters only in `adapters/` and imported only by the door and the facade, no ownerless names, tests in `tests/`, and the adapter-import fence. Only `modules/<name>/index.ts` and the optional `modules/<name>/contract.ts` (descriptors only, browser-safe) are importable from outside the folder. Today's subject-folder code assumes `packages/<x>/src`; extend it to find folder modules too, and add a module-cycle check between folder modules.
5. **Migrations: the runner and the check.**
   - `migrations.json` gains a folder entry: `{ "folder": "<path to a folder module>" }`, with optional `name` and `table`. Its SQL is `<folder>/migrations/*.sql`, found without a `package.json`. `name` defaults to the folder name, and the history table to `<name>_migrations`.
   - `@house-rules/migrations` runs folder entries the same as workspace entries. A test runs a real folder module against Postgres.
   - `house-rules-migrations` checks folder modules like packages. `CREATE VIEW` gives the view an owner, like `CREATE TABLE`. A module's SQL still names only its own tables and views.
   - Read-model SQL, under `read-models/*/adapters/`, may name only views that some module owns, and every statement must be a `SELECT`. The check fails closed: SQL it cannot read as static text fails, as does an unknown name. Fixtures cover a table name, a write, a dynamic string, and a view that no module owns.
   - A read model has no `migrations/` folder. The transaction checks stay.
   - The runner and the check stay in step: one test runs both over the same `migrations.json` fixtures.
6. **`entry-from-app-node`** (ESLint). The node given to the entry or way builder must be imported from the app's own `nodes/` folder. Barrels and re-exports are followed. A node imported from `modules/`, `read-models/`, the composition, or any package fails. Fixtures cover a way, a hook and a schedule.
7. **Retired names.** Landed in phase 3, when the prose is rewritten. A test fails when a live file names a retired v1 thing in code shape: `defineContract`, `implement(`, `toTool`, `use-case-is-capability`, a `use-cases/` or `delivery/` path, `booking-platform` or `booking-v2`. Plain English words such as "implement" or "delivery" in prose do not match. It scans these places: `packages/*/src`, `packages/*/bin`, `packages/*/package.json`, `packages/*/AGENTS.md`, `packages/*/README.md`, `packages/*/CONTEXT.md`, `packages/rules/docs`, `examples/`, `scripts/`, `tests/`, `site/src`, `skills/`, `.github/workflows/`, the root config files (`eslint.config.mjs`, `.dependency-cruiser.cjs`, `biome.json`, `turbo.json`, `pnpm-workspace.yaml`, `package.json`, `migrations.json`), `AGENTS.md`, `CONTEXT.md` and `README.md`. It skips `node_modules`, `dist`, build output, its own source file by exact path, and fixtures that test a retired name on purpose, which sit in an allowlist inside the test. A separate case feeds the matcher known bad lines and proves it catches them. History is out of its scope: `.pi/specs/`, `docs/v2-*.md` and `TODO.md`. A separate test checks that no public `index.ts` exports a retired name.
8. Rules that stay as they are: package rules, pins, the comment rule, design rules, `no-hand-run-effect`, `testing-exports-only-in-tests`, the adapter fence, `framework-does-not-import-examples`, `no-hand-rolled-surface`. `no-hand-rolled-surface` now names the router, not `toTool`.

The `AGENTS.md` sections that describe these rules change in the same phase as the checks. The law never disagrees with `pnpm check`.

## 5. The example

`examples/booking/` is the spike's behaviour in the final layout:

```
examples/booking/
  README.md                          reading order, about 400 words
  TESTS.md                           requirement → test map
  apps/api/                          @example/api
    REGISTRY.md                      generated
    src/nodes/                       make-booking/, book-for-partner/, cancel-booking/,
                                     show-booking/, my-bookings/, first-sign-in/,
                                     nightly-cleanup/  (each: node.ts + handler.ts)
    src/modules/bookings/            table booking, view booking_read
    src/modules/billing/             table payment, view payment_read, fake PaymentProvider
    src/read-models/my-bookings/     joins booking_read and payment_read
    src/ways-in/web/                 /api
    src/ways-in/partner/             /partner
    src/ways-in/mcp/                 /mcp, read-only tools
    src/composition/                 five verbs, lists, gate policy, first sign-in hook, schedule
    src/main.ts
```

- Nodes, permissions, lists, ways and behaviour are those of `docs/v2-spec.md` section 4, with two changes:
  - `first_sign_in` calls `Party.createPerson` and `Identity.bindLogin`, the nodes the shared packages gain in phase 1. The app's `People` wrappers are gone.
  - `cancel_booking` is destructive, by the lift.
- Table and view names lose the `v2_` prefix: `booking`, `booking_read`, `payment`, `payment_read`. Migration history tables use the defaults. Nothing else owns those names by then, because phase 0 removes both old examples.
- `TESTS.md` maps every behaviour in the spike's verification map to its new test. The reference copy sits at `~/.local/state/v2-spike/reference/booking-v2/VERIFICATION.md`. A test may live in a framework package when the behaviour belongs there, such as graph cycles, type tests and the gate policy. `TESTS.md` names its path either way.
- The read-model privacy test (B cannot see A's rows) stays at app level, seeding through the modules' public services. The read model's own tests cover its adapter on real Postgres.
- The example drops `DEFAULTS.md` and `DEVIATIONS.md`. The README names the one open default, P2, and where its switch is.
- The example has no web page. The design rules keep their own fixtures in `packages/rules/tests`.
- Keep the node descriptions and MCP titles meaningful, not the node name repeated. Declare `@effect/sql-pg` once, in the app.

## 6. Phases

The owner chose "no old stuff kept". So the plan does not run v1 and v2 side by side: the old examples go first, and the framework moves in one cutover. Running both at once would break the checks, clash on names such as `@example/api` and the `booking` table, and need a compatibility layer. There are no aliases.

Each phase ends at a gate. At the gate, `pnpm check` and `pnpm test` exit 0 from the repo root, with Postgres running, and a verifier from the other model family reads the phase's diff against this spec. The next phase starts only after the gate passes. Inside phase 1, single lanes may be red until the phase ends; each lane runs its own package's typecheck and tests.

| Phase | Work | Owns |
| --- | --- | --- |
| 0. Clear | Copy `examples/booking-v2/` whole to `~/.local/state/v2-spike/reference/booking-v2/` as the read-only reference. Delete `examples/booking-platform/` and `examples/booking-v2/` and their four `migrations.json` entries. Make every root file that names them pass without them: `eslint.config.mjs` loses the example roots and `tokenFiles`, `.dependency-cruiser.cjs` loses the example roots, and the root tests (`tests/thin-configs.test.mjs`, `tests/node-host-policy.test.mjs`, `tests/rules-bin-no-computed-import.test.mjs`) use fixtures or the framework packages instead. Run `pnpm install` once so the lockfile drops the old workspaces. | those paths, `migrations.json`, `pnpm-lock.yaml`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, the three named root tests, `.github/workflows/ci.yml` |
| 1. Framework and rules | One phase with one gate, because the kits, the shared packages, the rules and the root assertions on them change together. Lanes inside it: (a) a read-only lane maps the API change list from the spike reference and the current kits, and the orchestrator sends it to the leader and to every writer lane before writers start; (b) the kits, section 2 and section 3, with unit tests ported from the spike kit; (c) the shared packages on top of (b): `comments`, `party`, `identity`, `call-audit` and `auth-jwt` move to nodes and kinds, `Party.createPerson` and `Identity.bindLogin` become nodes, the Who and Record plugs land in their packages, and the record carries its target; (d) the rules, section 4 rules 1 to 6: checks, the migrations runner, docs, fixtures, tests, `packages/rules/CONTEXT.md`, and removing `use-case-is-capability` from the plugin's source, index, presets, tests and fixtures; (f) the example, built last in this phase: section 5 in full, on the new kits and under the new rules, from the spike reference copy. Register its modules in `migrations.json`, point the example roots in `eslint.config.mjs` and `.dependency-cruiser.cjs` at it, and restore the real-app tsconfig assertion from the phase 0 note. The phase 1 gate needs the example green, so the example proves the cutover; (e) the cutover of the root assertions on rules and layout (`tests/thin-configs.test.mjs` and any other root test that pins a rule) and the `scripts/packed-*.mjs` consumers, whose temp apps use the section 4 layout. Remove the v1 API outright. Update each package's `AGENTS.md` and README. Rewrite the `AGENTS.md` sections on app layout, use-cases, modules and data, the matching `CONTEXT.md` words, and regenerate the site rules page. Lanes (b), (c) and (d) may be red until the phase ends; each runs its own package's typecheck and tests. At the gate, `pnpm run packed-consumer` exits 0 too. | `packages/**`, `scripts/packed-*.mjs`, `tests/**`, `AGENTS.md`, `CONTEXT.md`, `site/src/content/docs/rules/index.md`, `examples/booking/**`, `migrations.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `pnpm-lock.yaml`; lanes inside split this with no overlap |
| 2. Example polish | Finish what phase 1 (f) left: `TESTS.md` complete against the reference `VERIFICATION.md`, the README reading order, meaningful descriptions and titles, a fresh `REGISTRY.md`, and the example's `AGENTS.md` lines. | `examples/booking/**`, `migrations.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `pnpm-lock.yaml` |
| 3. Law and docs | Add the retired-names test (section 4, rule 7) as `tests/retired-names.test.mjs`. Rewrite the rest in v2 words: `AGENTS.md` whole, `CONTEXT.md`, `README.md`, `NOTICE`, `TODO.md`, `skills/house-rules/SKILL.md`, `site/src/content/docs/start/index.md`, `packages/rules/docs/**`, `packages/application/README.md`, and CI. | those files, `tests/retired-names.test.mjs` |

Only one lane at a time runs `pnpm install` and writes `pnpm-lock.yaml`.

## 7. Deletions

Approved by the owner (decisions 22 and 23):
- `examples/booking-platform/`, whole. The owner's uncommitted work there is backed up at `~/.local/state/v2-spike/backup-booking-platform-uncommitted/`.
- `examples/booking-v2/`, whole, after its reference copy exists outside the repo.
- Their four `migrations.json` entries.
- `packages/rules/src/use-case-is-capability.mjs`, with its tests, fixtures, index entry and preset entries.
- Removing the v1 API from the framework packages: `defineContract`, `implement`, `toTool`, the app-facing `route` and the views table in `composition()`. This approves changing exports and code. It does not approve deleting whole files.

Needs a listed yes first: every whole file under `packages/`, `scripts/`, `tests/`, `site/` or `skills/` that the migration would delete, beyond the list above. That includes files that only served the v1 API. The orchestrator collects them into one deletion manifest of exact paths. The orchestrator sends the leader the exact paths through intercom and waits. The leader asks the owner.

Never delete `.pi/specs/*`. They are history.

## 8. Out of scope

1. The data socket (P4). Modules keep today's storage ports, adapters and unit of work.
2. Settling P2. Both gate policies stay, with the default as above.
3. Publishing, version bumps and tags. A release later bumps versions and pins together, with the owner's yes.
4. Commits, pushes and pull requests. The work stays uncommitted on `task/accounts-example`.
5. Write or destructive MCP tools. MCP stays read-only.
6. A web page in the example.
7. Persisting the step trace.
8. Any new dependency, or a bump of one. Ask the leader first.

## 9. Constraints

1. Follow `AGENTS.md` as it stands at each phase, and the house rules in it. Never loosen a check to pass. Never use `--no-verify`, never skip the hooks, and never lower an Effect diagnostic.
2. Change an `AGENTS.md` rule only in the same phase as its check. Removing the example roots in phase 0 is not a loosening: no code remains under them. Between phase 0 and phase 3, `AGENTS.md` may still name the deleted example as an illustration; phase 2 or 3 replaces those lines.
3. Do not touch the owner's or the leader's files outside the phase's ownership. The git status at the start is in `~/.local/state/v2-migration/baseline-status.txt`. `~/.local/state/v2-migration/baseline-hashes.txt` holds hashes of the leader's design records, which must still match at the end. This spec is the leader's too, and is never edited by the migration.
4. Read `effect/AGENTS.md` and `.agent_sources/` before editing Effect code. Effect is pinned at 4.0.3.
5. Use no long comments; the comment rule is on. Explain in markdown.
6. Keep `pnpm-lock.yaml` changes to plain `pnpm install` results.

## 10. Running it

The orchestrator follows `~/.agents/ORCHESTRATION.md`:

1. One lane per phase, or per package within a phase when ownership splits cleanly. Writers on Codex models, verifiers on Claude.
2. Phase 1 starts with lane (a), the read-only API map. The orchestrator sends that list to the leader and to every writer lane before writers start.
3. A verifier from the other model family reads each phase against this spec before the next phase starts.
4. The orchestrator rings the leader through intercom at each gate, at the deletion gate in section 7, and when blocked. It never edits this spec.

## 11. Acceptance

The final verifier checks each item and reruns each command.

1. With Postgres running, from the repo root, these exit 0: `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test` and `pnpm run packed-consumer`.
2. `examples/booking/apps/api/REGISTRY.md` is fresh, and shows everything in section 2 "The registry".
3. Every row of `examples/booking/TESTS.md` names a test that exists and passes, and the rows cover every behaviour in the reference `VERIFICATION.md`.
4. The web way's OpenAPI marks `cancel_booking` with `x-house-rules-destructive: true`. MCP's `tools/list` does not list it.
5. A way's closure check refuses an entry that the way does not expose, even when the entry is registered elsewhere.
6. The fixtures under `packages/rules/tests` show each section 4 rule failing on a bad layout and passing on a good one, including: a module imported past its door, a way importing a module value, a read model naming a table or writing or using dynamic SQL, a node file with two exports, a cycle between nodes, a folder module with a loose root file, a domain file importing the application kit, and an entry built from a module node, a package node and a barrel.
7. A folder module's migrations run on a real Postgres through `@house-rules/migrations`.
8. Every module error in the example and the shared packages declares a kind. A type test rejects a node whose failure holds an error with no kind.
9. Type tests show literal flags: a read-only entry needs no unit of work, and a system entry needs no `CurrentActor`.
10. The runtime layer fails with `GraphInvalid` for a cycle, a reachable node with no binding, and a way that exposes a node twice. Defining a node never throws.
11. The step trace drops the oldest request once over its bound. Reading an unknown request id creates nothing and evicts nothing. Each step names its entry.
12. The client tests pass against endpoint descriptors, and `contract-entry-is-browser-safe` covers the example's `nodes/*/node.ts`, module `contract.ts` files and web endpoint file, with a failing fixture for a `node.ts` that imports a handler.
13. The retired-names test from section 4, rule 7, passes.
14. `AGENTS.md` describes only checks that exist, and every new check has a row in the rules table.
15. `sha256sum -c ~/.local/state/v2-migration/baseline-hashes.txt` passes, and this spec is unchanged. Nothing is staged or committed.

## 12. Addendum: where entries live (owner-approved 2026-10-19)

Rev 5 did not say where a shared entry value lives. Ways and the composition both need the same entry, and no allowed file could hold it. The owner approved this fix:

- A node folder may hold one optional `entry.ts` beside `node.ts`. It exports exactly one direct `defineEntry` of its own node, as a `const`. Type exports are allowed.
- `entry.ts` imports only its own `node.ts` and the application contract door. It is a browser root, like `node.ts`.
- Ways and the composition import the entry from there. A node that no way and no hook exposes needs no `entry.ts`.
- `node-file` checks the file. `contract-entry-is-browser-safe` treats it as a root. No public API changes, because `defineEntry` is already on the application contract door.

## 13. Addendum: packages, features and the ways fence (owner-approved 2026-10-19/20)

The owner replaced the folder-module shape. See decisions 25 to 29 in `docs/v2-decisions.md`.

- Domain modules are packages, such as `examples/booking/packages/bookings`. There are no folder modules and no `folder` entries in `migrations.json`.
- App nodes live in `apps/<app>/src/features/<name>/`. Read models stay in `apps/<app>/src/read-models/`.
- A way may import values only from the kits, `effect`, package `./contract` doors, `features/`, `composition/` and its own folder. From a package main entry it imports types only.
- `examples/rejected-shapes/` is removed, not rewritten.
