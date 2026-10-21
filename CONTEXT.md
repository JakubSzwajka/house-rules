# Context

House-rules holds a TypeScript workspace template and ten public packages. [AGENTS.md](AGENTS.md) is the law. This file names the parts; [VISION.md](VISION.md) says why they exist.

## Kits and wiring

The **kits** are domain and application. Domain owns operation descriptors, edges, caller data, error kinds, pure graph checks, closures, modules, policy and units of work. It imports no house-rules package, even for types. Application owns features, operation bindings, execution, sockets, ways, the router, clients, trace and registry.

**Wiring** runs or checks the app. Migrations runs module SQL. Node Host serves a plain fetch handler without Effect. Rules owns the shared presets and checks. Consumer configs stay thin.

**Additions** are reusable modules such as Party, Identity and Comments, or plugs such as auth-jwt and call-audit. Each framework package an app mounts ships an `AGENTS.md` guide. The nine TypeScript packages publish built JavaScript and declarations in `dist/`; workspace imports read `src/`. Rules ships plain JavaScript.

## Features, operations and graphs

A **feature** is one thing the app lets a person or the system do. One folder, `features/<name>/`, contains index.ts and tests/. Its single `defineFeature` call holds schemas, permission, description, edges, flags, optional start and handler. The feature is its own entry. The handler only calls declared edges through call; it never imports module services. The file stays browser-safe.

The **feature registry**, `features/index.ts`, exports Features plus member, partner, agent and system permission lists. Ways, May lists, hooks and schedules accept features only.

An **operation** is one thing a module or read model can do. Domain's defineOperation describes it. A module publishes <Module>Operations through ./contract. Application's bindOperation supplies a handler that captures real services during composition. Only CallerContext may remain as a per-request requirement.

An **edge** declares a call to an operation or feature. A plain edge keeps the caller. asSystem(target, reason) switches downward to system with a nonblank reason, never back to person. A **graph** is all reachable features, operations and edges. It has no cycles; read-only calls reach only read-only work.

An **Actor** is the person a module acts for, identified by ActorId. Domain's **Caller** is PersonCaller with actor and via, or SystemCaller with reason and startedBy. Application's CallerContext holds it per request. Person execution installs CurrentActor from the same Actor. System execution cannot inherit person authority. PerRequest marks services a module constructor cannot capture.

The **runtime**, Runtime, runs features. Each feature has person and system permission closures. The person closure stops at system edges; the system closure includes permissions below them, or the whole graph for a system start. Permissions deduplicate. readOnly lifts with AND; destructive, transactional and needsApproval lift with OR. Types retain literal flags.

Execution records once, checks exposed feature identity and both closures, asks approval once when needed, then opens one unit when transactional. Inner calls add trace steps and repeat none of those gates. The default gate policy, feature-and-recheck, also checks inner own permissions. feature-only skips that recheck. P2 stays open.

Use direct named builder imports from the owning kit. Import renames are allowed; runtime aliases and builder re-exports are not. Non-kit packages may define and bind operations, never features, ways or endpoints. Production app and Effect package source is ESM-only. The law and rule guides give the exact scopes and exceptions.

## Ways and sockets

A **way in** names a protocol, path, exposed features, Who, May, Mean and optional wording overrides. It lives in `ways-in/<name>/`. It imports values only from kits, `effect`, package contract doors, app features, composition and its own folder. Other package main entries and read-model doors allow types only. Ways never import each other.

A **socket** is a question the app answers. A **plug** bundles an answer. The interfaces are `WhoSocket`, `MaySocket`, `MeanSocket` and `RecordSocket`. There is no export named Record.

| Question | Answer |
| --- | --- |
| Who is this? | `Identity.who` joins token source, Authenticator, ActorResolver and FirstSignIn. JWT verifies the token; Identity maps issuer/subject to ActorId. It never links by email. |
| What may they do? | `May.fixed` and `May.system` name exposed features. `May.context` supplies permission lists. Holding another way's permissions does not expose its features. |
| Do they mean it? | `Mean.no` denies approval, `Mean.elicitation` asks the human, `Mean.allow` allows in-process calls. Consent is not permission. |
| What happened? | `CallAudit.record.memory/postgres` fills RecordSocket over CallWatch. It records one row per feature start, including refusals. |

A **slot** or **port** is a service tag owned by its caller. Authenticator, Approval and CallWatch stay separate lower slots. A **cartridge** is a removable plug. Removing it and its `Layer.provide` line must leave the rest building and passing.

The **composition root** mounts modules and read models, links ports, plugs sockets, opens ways and schedules features. It owns `composition({ layer, features, ways, system, gatePolicy? })`. Acquire services and bindings, then Runtime, then hooks that capture it. The root receives ways from `main.ts`; it never imports them. Hooks use `runFeature`, never a second runtime or Who call.

The **router**, `toFetchHandler`, builds dispatch, HTTP routes, MCP tools and metadata paths from ways. A **Host** runs that fetch handler. Dispose the router before the composition. Composition builds lazily, shares a successful build, retries failures and makes disposal final. Next already has a Host.

An **endpoint** is a browser-safe descriptor made by `endpoint(feature, at?, options?)`. `defineApi` holds keyed endpoints. Ways export client descriptors from `endpoints.ts`. Clients and OpenAPI use the same descriptors. Cookie writes need CSRF protection, even before a session exists. CORS is not access control.

Remote MCP is an OAuth **resource server**. Every request needs a verified bearer token for this resource, including session requests. Missing or invalid tokens get a metadata challenge. Unset auth fails closed. Tools call features, never databases or services directly. MCP stays read-only without owner approval. User text stays data, not model instructions.

## Modules and data

A **module** is a consistency, access and life-cycle boundary. Every domain module is a package, including app-owned modules. There are no folder modules. Its **doors** are `index.ts` and optional browser-safe `contract.ts`. Other packages import by declared name, never private paths.

`defineModule` declares the root service in `facade.ts`. It captures long-lived ports and returns methods with no Effect requirements. Effect owns lazy build, sharing and scope, not a global cache. **Subject folders** split the module by what it owns. They import in one direction and never import their own index, facade or contract barrel. `storage.ts` stays allowed.

A **storage port** answers facts. Domain code decides permissions, limits and standing. Stored modules ship memory and Postgres adapters with a shared suite. Only adapters and named plumbing packages import SQL/platform dependencies. SQL is plain SqlClient code with decoded rows and real Postgres tests.

A **unit of work** wraps one feature graph. Only the feature runtime opens a production unit. Modules, handlers, read models and composition join it through `UnitOfWork.required`; they never call `UnitOfWork.atomic`. Tests and top-level tooling may open units as the law allows. A nested scripts folder in production source is not tooling. Memory registers undo before mutation; Postgres joins the transaction. Unexpected `NoOpenUnit` is a defect in a transactional feature, typed unavailable otherwise.

A module owns its **tables**, **views** and append-only **migrations**. It publishes views over its own objects. Other modules ask its service, never query its objects or add foreign keys to them.

A **read model** is app code for one screen under `read-models/<name>/`. Its doors are index and optional contract. It runs one static SELECT or WITH...SELECT over known published views. It never names tables, schema-qualified relations or SQL functions, and only scalar parameter values interpolate. Person filtering stays in SQL and needs an A/B test. It has no migrations or required memory adapter. Without a database, a named port returns unavailable.

The **module list**, `migrations.json`, names exactly one workspace or package per migration-list item. Folder locations are rejected. Real module identities, names and history tables are unique. Migrations directories cannot be symlinks or escape the resolved owner. Module-root symlinks work, but SQL files cannot be symlinks. Installed packages declare `houseRules.migrations`. **Adoption** copies selected history ids without changing the old table.

Runner and checker share fixtures for locations and chunk splitting. Breakpoint lines are reserved even in quotes or comments; the driver needs one command per chunk. The runner pins `standard_conforming_strings` on first inside its transaction and before each chunk. Migration and read-model SQL ban that setting name, `backslash_quote`, `set_config` and `pg_settings`, even in strings and comments. Read-model and view-DDL checks use a bounded grammar and fail closed. See [the SQL guide](packages/rules/docs/migrations.md) for the grammar and limits.

The checker does not prove ownership inside PL/pgSQL, DO bodies or dynamic EXECUTE. The legacy scan blanks ordinary strings and scans dollar bodies as best it can, with raw body text as fallback. Review still owns these cases. A SELECT-only database role is planned, not built.

## Errors and proof

An **expected error** is a `Schema.TaggedError` with a kind: `not_found`, `conflict`, `forbidden`, `unavailable` or `invalid`. Application maps these to 404, 409, 403, 503 and 400. User-facing module messages stay intact. Unavailable and plumbing messages are fixed public text. Causes, permissions and reasons stay internal. A way's **wording override** changes only the message. Defects answer generic 500 `internal_error`.

The **step trace** is bounded FIFO memory keyed by request id, default 1000 requests. Inner steps name feature, target, caller, reason, order and outcome. Reads allocate nothing; finishes do not revive evicted buckets. The **registry** is pure rendered Markdown with callers, system edges, reasons, feature closures and way exposures. A script writes `REGISTRY.md`; its freshness test only compares.

The **layout preset** accepts feature, read-model, way and composition areas. Its option keys are `features`, `readModels`, `waysIn` and `composition`. ESLint feature rules use literal `features/`, even with custom layout areas. Browser roots include feature indexes, the feature registry, contracts and way endpoints. Next uses `waysInLayer` for its app folder and keeps its host-owned files.

The **fence** is check/test, exact pins, lefthook and harness rules against bypasses. The [rules table](packages/rules/README.md#rules-and-checks) is the checked-rule source. The site explains the law and generates its rules page from that table and ESLint meta. **Agent sources** in `.agent_sources` are read-only dependency mirrors, never app imports.
