# Agent instructions

This file is the law for agents and people working in this repo, and in any project made from its template, the stack. Read `VISION.md` for why. It does not override this file. Read `CONTEXT.md` for the words this repo uses.

The house rules and the tool configs come from the plugin `@house-rules/rules`, which lives in `packages/rules`. The root uses it as `workspace:0.11.0`. This repo keeps thin configs that extend its presets, the project values such as the `@hosti/` scope, and the files no tool can inherit. Change a house rule in `packages/rules`, not by copying a preset into a thin config.

## Commands

This repo is a pnpm workspace run by Turborepo. Use pnpm, at the version `packageManager` in `package.json` pins. Corepack picks it up: run `corepack enable` once per machine. Do not replace pnpm with npm, Yarn, or Bun, and do not add a second lockfile.

| Command | What it does |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install from `pnpm-lock.yaml`. The root `prepare` script then patches `tsc` with the Effect language service (`effect-tsgo patch`) and installs the lefthook pre-commit hook. |
| `pnpm check` | Exact pins in every workspace `package.json` (the plugin's `house-rules-pins` bin), module-owned SQL (its `house-rules-migrations` bin), environment schema, Biome, ESLint, Dependency Cruiser once at the root, production subject-folder and package cycles (the `house-rules-layout` bin), and `typecheck` in each workspace package through Turborepo. |
| `pnpm run layout` | Checks production subject-folder and package cycles from Dependency Cruiser imports; test paths, adapters, and package-root files do not add subject-folder edges. |
| `pnpm env:check` | `varlock load`: resolve and validate every variable in `.env.schema`. |
| `pnpm exec varlock run -- <cmd>` | Run a command with the environment values injected. |
| `pnpm test` | Node test runner over `tests/**/*.test.mjs`, then `test` (Vitest) in each workspace package through Turborepo. |
| `pnpm fix` | Apply Biome formatting and safe lint fixes. |
| `pnpm format` | Apply Biome formatting only. |
| `docker compose up -d` | Start the local Postgres that database tests need. Each test file creates and drops its own database on it, through `TEST_DATABASE_ADMIN_URL` in `.env.schema`. CI runs the same server as a service. |
| `pnpm acceptance` | Clone the committed HEAD into a temp dir and run `pnpm install --frozen-lockfile`, `check`, and `test` there. |
| `pnpm vendor:agent-sources` | Shallow-clone the Effect source at the pinned version into `.agent_sources/`. Not part of `check`. |
| `pnpm --filter <package> add <dep>` | Add a dependency to one workspace package. `saveExact` writes an exact pin. |

Run `pnpm fix` or `pnpm format` only when you mean to rewrite files. Before you call a change ready, `pnpm check` and `pnpm test` must both exit 0.

## What check enforces

The rules table in the house-rules README lists every checked rule, its tool, and its docs. That table is the source. Do not copy it here or into `README.md`. The "What the stack adds" section in `README.md` lists only what this repo adds on top: the fence, the install policy, the environment check, and Turborepo telemetry.

## Workspace, apps, and packages

- An app lives in `apps/<name>`. A package lives in `packages/<name>`. `pnpm-workspace.yaml` lists both folders.
- A package never imports an app. An app never imports another app.
- An app or package imports another package by its name, such as `@hosti/bookings`, and declares it in its own `package.json` as `workspace:<exact version>`. Never import another package by a relative path.
- A package has one public entry, `src/index.ts`, and its `package.json` `exports` names only that entry. Every other file in the package is private: no other workspace imports it, by name or by path.
- Packages may import other packages only through their public entry. The package graph has no cycles and no prescribed levels. A package calls another package's service; it never reads its tables or SQL.
- Each workspace package has its own `tsconfig.json` that extends the root `tsconfig.base.json`, plus `typecheck` and `test` scripts.
- The capability library (`defineContract`, `implement`, `toTool`, the `Grant`, `Approval`, and `CallWatch` slots, `UnitOfWork` with its `sqlUnitOfWork` and `memoryUnitOfWork` adapters, `definePolicy`, and the types) lives in `packages/capability`, `@house-rules/capability`. An app writes its own capabilities in its own code, as its use-cases, and imports the library by name. A capability handler is an Effect: it yields services and lets typed errors flow.
- Every framework package an app mounts, now `@house-rules/capability`, `@house-rules/call-audit`, and `@house-rules/migrations`, has an `AGENTS.md` in its root and lists it in its `package.json` `files`, so it ships into the app's `node_modules`. It says what the package does, how an app mounts it (the layer line, the `migrations.json` line, the hooks the app must wire), its options and presets, and its fixed rules. Keep it short. `tests/framework-agents.test.mjs` checks it.
- `packages/rules` is the exception. It is the plain-JavaScript house plugin, with many entries in `exports`, no `tsconfig.json`, and a `typecheck` script that runs `node --check` over each source file. The layout rules, the `comment-discipline` rule, and Biome on its test fixtures skip it. Its tests run in `pnpm test`.

## Layers inside an app

- An app is cut by layer first, on purpose: delivery, server, use-cases, because the layer rules check the imports between them. A package is one module, and inside it is cut by subject: see "Inside a package".
- Delivery and server never import each other.
- Each entry point has one **composition root**: `src/server/`, or `src/main.ts` when the app has no server folder. Only the root provides services and slots: module layers, storage adapters, cartridges, and a `Grant` or `Approval` that is the same for every request. Delivery provides only per-request values: the `Viewer`, the `CallChannel`, the request id through `withRequestId`, and the `Grant` and `Approval` an adapter fills for this one request. `apps/api/src/server/app-layer.ts` is the example root. It provides `Bookings` and the visitor `Grant`, and the route provides nothing.
- The entry point joins delivery and the root. It runs a delivery handler over the root's layer. When the root needs a delivery value, such as an MCP toolkit, it takes the value as an argument and never imports it.
- Use-cases import packages. They never import delivery, server, or another use-case. Each top-level file or folder under `use-cases/` is one use-case for that import rule, so the files inside one folder may import each other. Each of those files is still one capability, so shared logic that is not a capability goes into a package.
- Group use-cases by feature and delivery by mechanism, such as `delivery/http/` and `delivery/mcp/`.
- Every use-case is a capability. Each non-test file under `use-cases/`, nested folders included, exports exactly one `implement(...)` capability from `@house-rules/capability`, at most one `defineContract(...)` contract, and no other value. Types are fine. Delivery calls the capability through its `handler`. `use-case-is-capability` checks this.
- Surfaces come from contracts. An MCP tool is built with `toTool(capability.contract, ...)`. No app or package calls `Tool.make`, `Rpc.make`, or `HttpApiEndpoint.<method>` by hand; only `packages/capability` may. `no-hand-rolled-surface` checks this. An RPC or HTTP projection gets added to `packages/capability` first.
- App code sits in `src/delivery/`, `src/server/`, or `src/use-cases/`. Only `src/main.ts` and `src/index.ts` sit directly in `src/`.
- Never name a file or folder `utils`, `helpers`, or `misc`. Name it after what it owns.
- No import cycles. No deep package imports. Production code never imports tests.
- A test file sits directly in a `tests/` folder inside the folder it tests, such as `src/use-cases/tests/show-booking.test.ts`. A package's own tests import its `src/index.ts`. Only tests under `src/adapters/` import an adapter directly.

## Inside a package

- Modules are cut by life cycle, not by noun. A module holds one consistency and access boundary: everything that only exists inside it. Trippy's `trips` keeps the trip, its days, its items and its shares, because an item's access is checked in the same SQL statement as the write, deleting a trip cascades in the database, and items change together. A thing with its own life becomes its own module. One module per noun is rejected: it would lose the in-statement guard and the cascades under the module-owns-its-tables rules.
- Use-cases are the app's feature list. Each one is a thin feature exposed by delivery over HTTP, MCP, CLI, or another mechanism. It may call several packages and opens the unit of work.
- Every package lays its code out as subject folders, even a package with one subject, such as `packages/bookings/src/booking/`. A subject folder holds one subject's schema, errors and logic, in files named after what they own.
- A package's `src/` holds only `index.ts`, `facade.ts`, `storage.ts`, `adapters/`, `tests/`, and subject folders. `package-root-files` fails any other loose file.
- No file or folder in a package is named after a mechanism: `types`, `models`, `schemas`, `drafts`, `errors`, `validate`, `validation`, `constants`, `interfaces`, or `internal`, in any letter case, so `Types.ts` and `Errors/` fail too. `no-ownerless-files` checks this next to `utils`, `helpers`, and `misc`. A package needs no `internal/` folder, because every file but `index.ts` is private.
- Only `index.ts` and `facade.ts` import the package's own `src/adapters/`, except tests may import support under `src/adapters/tests/` but never adapter production code; domain files may import neither. `index.ts` exports the adapters, and the facade wires the package's default adapter layers, such as `Bookings.fromRecords`. `domain-does-not-import-adapters` checks this.
- Subject folders import each other in one direction. The root subject, such as Trippy's `trip/`, is the shared kernel for the ids and errors several subjects use. `house-rules-layout` checks `no-subject-folder-cycles` against production imports, even when a cycle crosses different files. It also checks `no-package-cycles` across production imports between packages. Test paths, adapters, and package-root files do not add subject-folder edges; test paths do not add package edges. A file in a subject folder never imports its own package's `index.ts` or `facade.ts`, because that barrel would hide a cycle between two subjects; `subjects-do-not-import-package-root` checks this. `storage.ts` stays importable.
- Adapters mirror the subjects: `adapters/<kind>/<subject>.ts` holds that subject's SQL or memory code. That is a review rule; no check covers it.
- `packages/rules` is exempt from these rules, as it is from the other layout rules.

## Modules own their data

- A module owns its migrations and its tables. Its migrations live in `packages/<name>/migrations/*.sql`. A table belongs to the package whose migration creates it. A `.sql` file anywhere else fails, except test fixtures under a package's own `fixtures/` or `tests/` folder, which own no tables.
- No cross-module foreign keys. Keep another module's id as a plain column, and ask that module's service for the record.
- A module's domain code talks to its **storage port**, a service the module defines, such as `BookingStore` in `packages/bookings/src/storage.ts`. The port answers facts and never decides a permission, a standing, or a limit. Only files under `src/adapters/**`, and the adapter packages the repo names, import `effect/unstable/sql`, a SQL driver (`@effect/sql-*`), or `@effect/platform-*`. `adapter-imports-only-in-adapters` checks it, always at error. A plumbing package, such as a `db` package with the SQL client, can join the fence by name in `adapterImports`.
- Every module with storage ships two adapters, Postgres in `src/adapters/postgres/` and memory in `src/adapters/memory/`, and one shared store suite in `src/adapters/tests/` that runs every case against both. The public entry exports the port and both adapter layers, so an app picks one and the suite imports them from `src/index.ts`. Domain tests (policy, limits, validation) may run on memory only.
- A module's SQL names only its own tables, in migrations and in adapters. To read another module's data, call its service through the package's public entry. A plumbing package, such as a `db` package with the connection, owns no tables a module queries.
- Transactions belong to the use-case, never to a module. A use-case opens one **unit of work**: its contract sets `transactional: true`, and `implement` wraps the handler in `UnitOfWork.atomic` after `Grant` and `Approval`; or its handler calls `UnitOfWork.atomic` around only the part that must be atomic. A module's write method never opens one. It runs inside the open unit and fails with `NoOpenUnit` when none is open (`UnitOfWork.required`). Its adapters join the open unit: Postgres through the transaction, memory by registering an undo with `UnitOfWork.onRollback`. A script or a test opens a unit itself.
- One unit may span several modules, so a failure rolls back all their writes together. Each module's SQL still names only its own tables.
- A module registers its migrations in the module list, `migrations.json` at the repository root: `{ "workspace": "packages/<name>" }`, or `{ "package": "<name>" }` for an installed framework package. A framework package names its folder in its `package.json` as `"houseRules": { "migrations": "migrations" }` and lists that folder in `files`. `@house-rules/migrations` runs every listed module, each into its own history table, `<module>_migrations` by default, in one transaction.
- `pnpm run migrations` (the `house-rules-migrations` bin) checks that a migration sits in its module's `migrations/` folder, that no module holds a cross-module foreign key, and that a module's SQL names only its own tables; it also fails when a module with migrations is missing from the module list, and catches a raw `withTransaction` or `begin` outside an adapter package, and a module that calls `UnitOfWork.atomic`. It does not check storage ports or their imports: Dependency Cruiser's `adapter-imports-only-in-adapters` does. It reads text, so a review still checks that no module opens a unit another way.
- No ORM and no query builder. A module's Postgres adapter writes plain SQL through `SqlClient` from `effect/unstable/sql`, decodes each row with a `Schema`, and is tested against a real Postgres, never a mock: `MigrationsTesting.database` from `@house-rules/migrations` gives each test file a throwaway database.
- A cartridge passes the pull-out test, a review rule. It pushes in with one `Layer.provide` line. Deleting its package and that line leaves the rest building and passing. That holds only when the caller side owns the port: if a use-case imports the cartridge's package, the capability has to go with it.

## Effect

Before you edit Effect code, read `effect/AGENTS.md` and the docs under `effect/ai-docs/` in any workspace package's `node_modules`, such as `packages/bookings/node_modules/effect/AGENTS.md`. pnpm does not install `effect` at the repo root. `ls -d packages/*/node_modules/effect` lists the copies. For API shape and examples, read the source mirror at `.agent_sources/github.com/Effect-TS/effect`. Run `pnpm vendor:agent-sources` if it is missing. Trust the installed version over memory: Effect 4 is a release candidate and its API still moves. To add a package, follow `skills/add-an-effect-module/SKILL.md`.

- Expected errors are typed. Define each one as a `Schema.TaggedError` class and put it in the error channel. Never fail with a global `Error`, and never `throw` inside Effect code.
- A package's service methods return Effects with no requirements. The service captures its own dependencies.
- One service per file. Each `Context.Service` class gets its own file, named after its job, such as `storage.ts` for `BookingStore` or `owner-standing.ts` for `OwnerStanding`. Its Layer sits beside it, as a static member built with `Layer.effect`, the way `Bookings.layer` does in `packages/bookings/src/facade.ts`. A storage port is the exception: its layers are the adapters under `src/adapters/`.
- Delivery maps typed errors to responses once, in the handler. Use-cases let them flow.
- Never run an Effect by hand inside Effect code or tests. No `Effect.run*` and no hand-built runtime. Tests use `it.effect` or `it.layer` from `@effect/vitest`. Only an application entry point runs Effects. `no-hand-run-effect` fails `Effect.run*` and `ManagedRuntime.make` in test files.
- Pin all Effect packages together. `effect`, `@effect/vitest`, and any other `@effect/*` runtime package share one exact version, and a bump moves all of them in the same change. `@effect/tsgo` versions separately and must support the pinned TypeScript.
- Never set an Effect diagnostic below `error` to make a change pass, and never override the plugin's Effect preset in `tsconfig.base.json` or a package's `tsconfig.json`. A `plugins` entry there replaces the whole Effect block. Fix the code.

## Agent adapters (MCP and CLI)

An app can let agents call its use-cases over MCP, and later over a CLI. Write each capability once, in a module and a use-case, and let each adapter reach it. `docs/mcp-adapter.md` records why. To add a tool, follow `skills/add-an-mcp-tool/SKILL.md`.

- A service method that acts for a user takes that user as an explicit `Actor` argument. Rules about one object, such as owner or shared, live inside the module, so no adapter can skip them.
- Every contract declares a `permission`, a `resource:action` string the owning module names, or `"public"` on purpose. The type requires it. `implement` runs the `Grant` check, then `Approval` when the contract sets `needsApproval: true`, then the handler. The gates add `Grant` and `Approval` to the capability's requirements and `Forbidden` and `ApprovalDenied` to its failures.
- A use-case that acts for a user yields the `Viewer` service, which holds the `Actor`, and passes it to the module. `Viewer` lives in a package, because more than one use-case needs it.
- An adapter decides who the `Viewer` is, provides the `Grant` and `Approval` slots for that request, runs one use-case, and maps its typed errors, gate errors included, to its own response. It holds no business logic and no access rule.
- The MCP adapter fills `Approval` with `elicitationApproval`. It asks the human through the client and fails closed when the client declines, cancels, answers no, or cannot elicit. An agent never answers its own approval.
- Each adapter owns its error mapper. The MCP adapter does not reuse the web error view.
- An MCP tool is one entry in the app's tool catalogue, in the delivery layer, such as `src/delivery/mcp/tools.ts`. Build it from the use-case's contract with `toTool`, which takes the name, the description, the input `Schema`, and the `Tool.Readonly` and `Tool.Destructive` annotations from the contract. The entry's options add the title and the `idempotent` and `openWorld` hints. Its handler runs the capability.
- A tool handler calls a use-case. It never calls a module service, the database, or another adapter.
- Every tool has a test that runs it with a fake `Viewer`. The tests include an access test: user B cannot read user A's data through the tool.
- The first tools an app exposes are read-only. Every write or destructive tool is annotated as one and needs owner approval before it ships.
- An agent gets the same access as the user has in the app. The module enforces what the `Viewer` may do, so an agent never gets more than the user has. A token scope is optional and only narrows access.
- Tools that only the owner may run, or that are hard to undo, such as delete, share, and unshare, stay out of the catalogue until the owner approves each one by name. Such a tool's contract sets `needsApproval: true`.
- Keep the catalogue small. Each tool does one specific job and returns structured output. A big record gets a summary tool plus a separate read tool.
- Tool output never carries instructions to the model. Text a user wrote goes out as a data field.
- Use `McpServer`, `Tool`, and `Toolkit` from `effect/unstable/ai` in the pinned `effect` before any other MCP library.
- A remote MCP endpoint is an OAuth resource server under the [MCP authorization spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). It answers a call with no valid token with 401 and a `WWW-Authenticate` header that names `resource_metadata`. It serves `/.well-known/oauth-protected-resource`, naming the authorization server.
- The MCP route checks that the token is valid and was issued for this resource (its audience, RFC 8707) before it builds the `Viewer`. It never passes the token on to another service.
- The identity provider is the authorization server. Prefer Client ID Metadata Documents to Dynamic Client Registration.
- When auth is not configured, the MCP routes refuse every call. They fail closed.
- The session middleware treats the MCP route and the metadata paths as public. The MCP route does its own bearer check.
- The app's canonical public URL is an environment variable declared in `.env.schema`.
- Tests cover the 401 challenge, the metadata document, and the fail-closed path.

## Prose rules

The "Prose rules" section in `README.md` lists what no tool here checks. A green `pnpm check` says nothing about those. Point them out in review instead of claiming a check covers them.

## Environment

- Declare every environment variable the code reads in `.env.schema`. Put no secret values there.
- Secrets live only in `.env.local`. Never commit `.env.local` or any `.env.*.local` file.
- Varlock telemetry stays off through `.varlock/config.json`. Check with `DEBUG=varlock:telemetry pnpm exec varlock load`.
- Turborepo telemetry stays off because every script that runs `turbo` sets `TURBO_TELEMETRY_DISABLED=1`, and so does CI. Run `turbo` only through those scripts, or run `pnpm exec turbo telemetry disable` once per machine.

## Pins

Every dependency in the root `package.json` and in each workspace `package.json` is an exact version. A GitHub dependency is pinned to a full 40-character commit SHA, optionally followed by a pnpm subpath such as `&path:/packages/rules`. A workspace dependency is `workspace:` plus the exact version, such as `workspace:0.0.0`. `packageManager` names an exact pnpm version. `pnpm-workspace.yaml` sets `saveExact: true` and `saveWorkspaceProtocol: true`, so `pnpm add <pkg>` writes an exact pin, and `pnpm add <workspace package>` writes `workspace:<exact version>`. `pnpm check` runs the plugin's `house-rules-pins` bin, which fails on `^`, `~`, ranges, tags, branch names, and `workspace:*`. Node is pinned in `.nvmrc`, and CI reads it from there.

`pnpm-workspace.yaml` also holds the install policy:

- `minimumReleaseAge: 1440` refuses a version younger than one day. Any exact pin younger than that fails `pnpm install`. Either wait a day, or add a `minimumReleaseAgeExclude` entry for that exact version, with owner approval. One entry per version. A bump replaces its entry. Effect release candidates are the usual case: a new RC is often less than a day old.
- `allowBuilds` lists every dependency that has an install script, each set to `false`. No dependency runs a build script. A new dependency with a script fails the install until you add it here.
- `packageExtensions` gives the ESLint comment plugin its own TypeScript 6.0.3.

Never add `shamefully-hoist`, `nodeLinker: hoisted`, or a broad `publicHoistPattern`, and never install with `--force`.

## Hooks

- lefthook runs `pnpm check` and then `pnpm test` before each commit.
- If a hook fails, fix the failure. Never weaken or bypass a hook.
- Never run `git ... --no-verify`, `git commit -n`, `LEFTHOOK=0`, or change `core.hooksPath`.
- Pi (`.pi/extensions/git-interceptor.ts`) blocks those commands through `scripts/vcs-command-policy.mjs`. `.agents/settings.json` holds the same hook in Claude Code format. Claude Code does not load it from there.

## Safe vs needs approval

Safe without asking:

- code changes that keep `pnpm check` and `pnpm test` green;
- new or tighter tests;
- docs edits in `README.md`, `AGENTS.md`, and `CONTEXT.md`;
- tightening a lint or dependency rule;
- adding a variable to `.env.schema`;
- adding a read-only MCP tool that calls an existing use-case, with its test.

Ask the owner first:

- adding any MCP or OAuth dependency;
- exposing a write or destructive MCP tool, or adding a token scope;
- making another path public in the session middleware;
- adding, removing, or bumping a dependency, the TypeScript version, the Node version, pnpm, or Turborepo;
- adding an entry to `minimumReleaseAgeExclude`, or setting an `allowBuilds` entry to `true`;
- removing the TypeScript 6 `packageExtensions` entry for the ESLint plugin, or narrowing the files ESLint checks;
- inlining a copy of a plugin preset into a thin config, or any change to `biome.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `tsconfig*.json`, `turbo.json`, `pnpm-workspace.yaml`, `lefthook.yml`, CI, or the hook policy that loosens a rule;
- deleting tests;
- changing how secrets are handled: `@sensitive`, `.env.local`, the `.gitignore` env lines, or `.varlock/config.json`;
- changing `VISION.md`;
- commit, push, or anything that writes outside this repo.
