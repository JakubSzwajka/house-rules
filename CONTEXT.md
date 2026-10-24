# Context

House-rules holds a TypeScript workspace template and ten public packages. [AGENTS.md](AGENTS.md) is the law. This file names the parts; [VISION.md](VISION.md) says why they exist.

## Kits and wiring

The **kits** are domain and application. Domain owns operation descriptors, edges, caller data, error kinds, pure graph checks, closures, modules, policy and units of work. It imports no house-rules package, even for types. Application owns features, operation bindings, execution, sockets, ways, the router, clients, trace and app map.

**Wiring** runs or checks the app. Migrations runs module SQL. Node Host serves a plain fetch handler without Effect. Rules owns the shared presets and checks. Consumer configs stay thin.

**Additions** are reusable modules such as Party, Identity and Comments, or plugs such as auth-jwt and call-audit. Identity is one configurable concept with passwords, OIDC and guarded devLocal providers. devLocal uses AuthJwtLocal, allows only normalized development/test NODE_ENV values, refuses other environments with unavailable IdentityProviderInvalid and exposes signing handles through DevLocalIssuers. It owns login bindings and local password records; each configured issuer gets its matching auth-jwt verifier. Party owns roles. Auth-jwt stays a separate pure token-checking plug, including for MCP. Each framework package an app mounts ships an `AGENTS.md` guide. The nine TypeScript packages publish built JavaScript and declarations in `dist/`; workspace imports read `src/`. Rules ships plain JavaScript.

## Features, operations and graphs

A **feature** is an exposed entry point for one thing the app lets a person or the system do. Every feature belongs to an HTTP, MCP, hook, schedule or event way. Features never call other features; reuse goes through module operations. `feature-file` rejects their imports, Runtime/composition rejects their edges with GraphInvalid, and validatePlan names the exact edge path. One folder, `features/<name>/`, contains index.ts and tests/. Its single `defineFeature` call holds schemas, permission, description, edges, flags, optional start and handler. The feature is its own entry. The handler only calls declared edges through call; it never imports module services. The file stays browser-safe.

The **feature registry**, `features/index.ts`, exports only Features. Built-in roles and system permissions live in composition. Ways, including hooks, schedules and events, accept features only.

An **operation** is one thing a module or read model can do. Domain's defineOperation describes it. A module publishes <Module>Operations through ./contract. Application's bindOperation supplies a handler that captures real services during composition. Only CallerContext may remain as a per-request requirement.

An **edge** declares a call to an operation, from a feature or another operation. A plain edge keeps the caller. asSystem(target, reason) switches downward to system with a nonblank reason, never back to person. A **graph** is all reachable features, operations and edges. It has no cycles; read-only calls reach only read-only work.

**Causation** names whose action led to an event reaction, not whose permissions it uses. An event handler is system-started and author-caused. Its **causedBy** input copies the event envelope's actorId as a string or null; trace retains it as data. It grants nothing and is never an Actor. The handler uses composition's explicit system permissions, never the author's roles or a frozen role snapshot.

An **Actor** is the person a module acts for, identified by ActorId. Domain's **Caller** is PersonCaller with actor and via, or SystemCaller with reason and startedBy. Application's CallerContext holds it per request. Person execution installs CurrentActor from the same Actor. System execution cannot inherit person authority. PerRequest marks services a module constructor cannot capture.

The **runtime**, Runtime, runs features. Each feature has person and system permission closures. The person closure stops at system edges; the system closure includes permissions below them, or the whole graph for a system start. Permissions deduplicate. readOnly lifts with AND; destructive, transactional and needsApproval lift with OR. Types retain literal flags.

Execution records once, checks exposed feature identity and both closures, asks approval once when needed, then opens one unit when transactional. Inner calls add trace steps and repeat none of those gates. Every inner call rechecks its own permission against the permissions loaded at feature start.

Use direct named builder imports from the owning kit. Import renames are allowed; runtime aliases and builder re-exports are not. Non-kit packages may define and bind operations, never features, ways or endpoints. Production app and Effect package source is ESM-only. The law and rule guides give the exact scopes and exceptions.

## Access

A **permission** is the `resource:action` an operation declares in code. Application's **PermissionCatalogue** service is available before modules build. Its permissions callback and `Runtime.permissions` expose the same frozen array, derived from every mounted operation, including unused operations.

**Person** and **Organisation** are the parties an app knows. A **relationship** links two parties, such as staff of or partner of. Party owns these facts.

A **role** names a set of catalogue permissions. Composition declares built-in roles; Party stores custom roles. A **role assignment** gives a person a role globally or within one organisation. A person defining or assigning a role must hold all its permissions in that same scope, even with `party:admin`. Trusted system assignment is exempt. Org-scoped role reads hide other organisations' custom roles and global custom roles. Revocation and relationship removal need approval. The **May plug**, `Party.may()`, answers which permissions the caller holds. Composition plugs it once.

An **invitation** is a one-time, expiring code for joining an organisation as staff, with an optional role. Party stores only its hash. The inviter must administer that org and hold every attached permission there. Acceptance consumes the code and relates the person; an app feature assigns the role through an explicit system edge in the same unit. Removing staff revokes that person's org-scoped assignments, preserves global roles and refuses removal of the last org admin.

A **system read** is a separate system-only operation for person-owned data, with its own permission. For example, WorkItems.getForSystem requires work_items:system-read and refuses person callers; ordinary WorkItems reads still hide objects from the wrong person and refuse system callers. The system permission list in composition is explicit authority, with each grant owned by the app owner and visible in plan review. causedBy cannot supply it.

The gate checks roles at feature start and fails 403 when a closure permission is missing. A **relation check** runs inside the module's operation against the loaded object, in the write's unit. It may return not_found to hide the object. Lists filter relations in SQL. An agent is the user: MCP gets the same roles as HTTP, but exposes read features only.

## Ways and sockets

A **way in** names one of five protocols and exposed features. HTTP/MCP ways have a path, Who, Mean and optional wording overrides. Hook ways name a caller-owned slot, one system feature, input/failure mapping and explicit Mean. Schedule ways name a UTC cron, selector/item system features, selector input and explicit Mean. The selector returns an array of item inputs. An **event way** names one consumer, its on kinds, one system-start handler feature and explicit Mean. Its name and kinds exactly match the source consumer, including no extra kinds. System ways live in ways-in/hooks, ways-in/schedules and ways-in/events, with no network path. Every way lives in `ways-in/<name>/`. It imports values only from kits, `effect`, package contract doors, app features, composition and its own folder. Other package main entries and read-model doors allow types only. Browser code under `ways-in/<name>/page/**` may also import third-party UI packages, never workspace mains, Node builtins or SQL/platform adapters. Ways never import each other.

The booking example exposes web HTTP at `/api` and read-only MCP at `/mcp`. Its first-sign-in hook assigns member to every new login.

A **public feature** is a system-start feature listed in an HTTP way's `public` and `features`. Its requests skip Who, even with a token, and use only composition's system permissions. Other features still require Who. MCP refuses public features.

A **socket** is a question the app answers. A **plug** bundles an answer. The interfaces are `WhoSocket`, `MaySocket`, `MeanSocket` and `RecordSocket`. There is no export named Record.

| Question | Answer |
| --- | --- |
| Who is this? | `Identity.who` joins token source, Authenticator, ActorResolver and FirstSignIn. Identity's configured passwords or OIDC provider verifies through auth-jwt; Identity maps issuer/subject to ActorId. It never links by email. |
| What may they do? | One app-level `Party.may()` plug resolves the caller's held roles on every feature start. Ways narrow exposure only. `May.context` supplies that plug and features for in-process calls; `May.system` supplies system permissions only. |
| Do they mean it? | `Mean.no` denies approval, `Mean.elicitation` asks the human, `Mean.allow` allows in-process calls. Consent is not permission. |
| What happened? | `CallAudit.record.memory/postgres` fills RecordSocket over CallWatch. It records one row per feature start, including refusals. |

A **slot** or **port** is a service tag owned by its caller. Authenticator, Approval and CallWatch stay separate lower slots. A **cartridge** is a removable plug. Removing it and its `Layer.provide` line must leave the rest building and passing.

The **composition root** answers four questions once: modules.ts chooses mounts, adapters and infrastructure; sign-in.ts chooses providers and each way's Who; access.ts declares roles, system permissions and May; app.ts owns startup config and createApp. These filenames are a review convention, not a lint requirement. The root mounts modules and read models, links ports, plugs sockets, opens ways and schedules features. It owns `composition({ modules: ModulePlan, features, ways, may, system })`. A **mount** is a package-owned plain value containing a service key, operation descriptors and binder. The package main or read-model index exports it; modules.ts adds the chosen layer. A **module plan** pairs that single mount list with shared infrastructure. Composition derives PermissionCatalogue from mounts, acquires modules and infrastructure, captures mount bindings once, acquires Runtime and resolves the effectful May, installs hook slots, then starts scoped schedule and event drivers. The root receives ways from `main.ts`; it never imports them. Hooks, schedules and events use a fresh allowlist context built only from composition-captured Runtime, StepTrace, UnitOfWork, CallWatch, the way's Approval, CallPermissions from May.system and CallChannel. Each execution adds a fresh request id, fresh log annotations and a new root span, without caller services or network request context. Hooks use `runFeature` and hook:<name>; schedules use schedule:<name>; events use event:<name>. None builds a second runtime, calls Who or inherits person authority. Duplicate slot providers fail acquisition. Schedules first wait for the next tick, run the selector, then run each item sequentially in its own feature unit. They log failures and continue, never catch up missed ticks, and stop on disposal. Multiple processes may run the same tick, so item operations must be idempotent.

**EventSource** is the application-owned delivery port. **EventLog.source** fills it from event-log's static consumers, claims, settlement and wake stream. Event ways replace app-written wake/sweep driver features. Composition commits each claim in its own unit, then takes, runs the system feature with EventInput `{ event, causedBy }` and settles success in one unit per event. Failure rolls back handler writes before separate failure bookkeeping; the committed attempt survives for retry and dead-lettering. Source wakes and a periodic sweep drive delivery. Retries run on the next wake or sweep at or after the source's retry deadline. Handlers must be idempotent: delivery is at least once and cursor locks are not a distributed lease. Removing event-log, its source plug and event ways leaves unrelated app work independent. A side effect that needs the acting person's authority stays in their request and unit; a later reaction uses system authority and records that person as the cause.

The **router**, `toFetchHandler`, builds dispatch, HTTP routes, MCP tools and metadata paths from ways. A **Host** runs that fetch handler. Dispose the router before the composition. Composition builds lazily, shares a successful build, retries failures and makes disposal final. Next already has a Host.

An **endpoint** is a browser-safe descriptor made by `endpoint(feature, at?, options?)`. `defineApi` holds keyed endpoints. Ways export client descriptors from `endpoints.ts`. Clients and OpenAPI use the same descriptors. Cookie writes need CSRF protection, even before a session exists. CORS is not access control.

Remote MCP is an OAuth **resource server**. Every request needs a verified bearer token for this resource, including session requests. Missing or invalid tokens get a metadata challenge. Unset auth fails closed. Tools call features, never databases or services directly. MCP stays read-only without owner approval. User text stays data, not model instructions.

## Modules and data

A **module** is a consistency, access and life-cycle boundary. Every domain module is a package, including app-owned modules. There are no folder modules. Its **doors** are `index.ts` and optional browser-safe `contract.ts`. Other packages import by declared name, never private paths.

A **capability module** owns state, a computation or an outside effect and its rules. A computation takes inputs as data; fetching those inputs belongs in a feature or process module. A **process module** composes capabilities through operation edges. It may be a stateless sequence or a durable saga. Process modules may call other process modules without cycles; capabilities never call processes. Invariants stay with the capability that owns the data or computation. A short sequence used by one feature may stay there until a second feature needs it or it gains state. Process edges share the calling feature's gates, approval, unit and trace.

An **event fact** belongs to the module whose data changed. Its schema lives in that module's contract and its operation returns the fact with its result. The **composing layer**, a feature or process operation, chooses which facts to record through an EventLog.record edge in the writes' unit. Not every write must become an event. The binding stamps caller, clock and request data into the **event envelope**; system callers have no person actor. Capability modules never emit or depend on event-log. App-wide facts belong in an app-owned package contract. An app that records every write may exempt personal UI state, such as read markers, notification preferences, quiet hours or time zone. Event-log carries these facts and reactions; call-audit remains the separate feature-start record.

`defineModule` declares the root service in `facade.ts`. It captures long-lived ports and returns methods with no Effect requirements. Effect owns lazy build, sharing and scope, not a global cache. **Subject folders** split the module by what it owns. They import in one direction and never import their own index, facade or contract barrel. `storage.ts` stays allowed.

A **storage port** answers facts. Domain code decides permissions, limits and standing. Stored modules ship memory and Postgres adapters with a shared suite. Only adapters and named plumbing packages import SQL/platform dependencies. SQL is plain SqlClient code with decoded rows and real Postgres tests.

A **unit of work** wraps one feature graph. Only the feature runtime and kit-owned event driver open production units. Modules, handlers, read models and composition join it through `UnitOfWork.required`; they never call `UnitOfWork.atomic`. Tests and top-level tooling may open units as the law allows. A nested scripts folder in production source is not tooling. Memory registers undo before mutation; Postgres joins the transaction. Unexpected `NoOpenUnit` is a defect in a transactional feature, typed unavailable otherwise.

A module owns its **tables**, **views** and append-only **migrations**. It publishes views over its own objects. Other modules ask its service, never query its objects or add foreign keys to them.

A **read model** is app code for one screen under `read-models/<name>/`. Its doors are index and optional contract. It runs one static SELECT or WITH...SELECT over known published views. It never names tables, schema-qualified relations or SQL functions, and only scalar parameter values interpolate. Person filtering stays in SQL and needs an A/B test. It has no migrations or required memory adapter. Without a database, a named port returns unavailable.

The **module list**, `migrations.json`, names exactly one workspace or package per migration-list item. Folder locations are rejected. Real module identities, names and history tables are unique. Migrations directories cannot be symlinks or escape the resolved owner. Module-root symlinks work, but SQL files cannot be symlinks. Installed packages declare `houseRules.migrations`. **Adoption** copies selected history ids without changing the old table.

Runner and checker share fixtures for locations and chunk splitting. Breakpoint lines are reserved even in quotes or comments; the driver needs one command per chunk. The runner pins `standard_conforming_strings` on first inside its transaction and before each chunk. Migration and read-model SQL ban that setting name, `backslash_quote`, `set_config` and `pg_settings`, even in strings and comments. Read-model and view-DDL checks use a bounded grammar and fail closed. See [the SQL guide](packages/rules/docs/migrations.md) for the grammar and limits.

The checker does not prove ownership inside PL/pgSQL, DO bodies or dynamic EXECUTE. The legacy scan blanks ordinary strings and scans dollar bodies as best it can, with raw body text as fallback. Review still owns these cases. A SELECT-only database role is planned, not built.

## Errors and proof

An **expected error** is a `Schema.TaggedError` with a kind: `not_found`, `conflict`, `forbidden`, `unavailable` or `invalid`. Application maps these to 404, 409, 403, 503 and 400. User-facing module messages stay intact. Unavailable and plumbing messages are fixed public text. Causes, permissions and reasons stay internal. A way's **wording override** changes only the message. Defects answer generic 500 `internal_error`.

The **step trace** is bounded FIFO memory keyed by request id, default 1000 requests. Inner steps name feature, target, caller, reason, order and outcome. Reads allocate nothing; finishes do not revive evicted buckets.

A **plan**, stored as `plan.json`, describes the intended modules, operations, features, ways and plugs before building. Authors declare each module's role as capability or process; the API defaults omitted roles to capability for older inputs. Validation rejects capability-to-process operation edges, plain or system. Event ways declare on kinds, one features entry and mandatory mean; validation checks system starts, while real acquisition checks exact source coverage. `Plan` decodes it and `validatePlan` derives an app map with stub schemas and handlers. It does not prove executable wiring, endpoints or storage. The [design skill](skills/house-rules-design/SKILL.md) stops for owner approval before implementation.

The **app map**, or **map**, is a plain serialisable snapshot from `appMap(app)`, using the app's validated mounts, features and actual ways. Pure `renderMap(snapshot, format)` emits sorted text, JSON, Mermaid or self-contained HTML with operation owners, feature closures, system reasons and way exposures. Maps show process modules in their own layer with real operation edges and mark modules as framework (@house-rules/*) or app-owned. Event kinds appear beside their handler feature in every rendering, including MAP.md. Mount map.role and package metadata supply those module facts. Tooling adds literal source paths from registry imports, builder calls and package manifests. It fails on missing or ambiguous ownership. The booking script uses memory storage and a frozen clock and writes `MAP.md`; its freshness test only compares. Its layers header is fixed, not extracted from layout rules.

A **map diff** compares two maps, including maps derived from plans, by modules, operations, features, ways, plugs and permissions. `diffMaps` returns structured changes; `renderMapDiff` shows text or HTML. An empty built-vs-plan diff proves equality of mapped facts, not all behavior. Named Who, May and Record plugs are declared review facts, not proof of wiring. `pnpm plan validate|view|diff` checks a plan and renders approval pages without building an app.

The **layout preset** accepts feature, read-model, way and composition areas. Its option keys are `features`, `readModels`, `waysIn` and `composition`. ESLint feature rules use literal `features/`, even with custom layout areas. Browser roots include feature indexes, the feature registry, contracts and way endpoints. Next uses `waysInLayer` for its app folder and keeps its host-owned files.

The **fence** is check/test, exact pins, lefthook and harness rules against bypasses. The [rules table](packages/rules/README.md#rules-and-checks) is the checked-rule source. The site explains the law and generates its rules page from that table and ESLint meta. **Agent sources** in `.agent_sources` are read-only dependency mirrors, never app imports.
