# house-rules

house-rules is the home of the house plugin and of a TypeScript monorepo template, the stack. The stack holds [`@house-rules/rules`](packages/rules/README.md) in `packages/rules` and shows it wired into a real [pnpm](https://pnpm.io) workspace run by [Turborepo](https://turborepo.com), with example code in [Effect 4](https://effect.website). It also holds the prose rules I want in every project, the ones no tool can check.

Every lint rule, preset, and check in `pnpm check` comes from the house plugin for deterministic feedback, and [its README lists them](packages/rules/README.md#rules-and-checks).

It is a GitHub template. Create a repo from it with `gh repo create <name> --template JakubSzwajka/house-rules`. It also carries the reference copy of the release workflow. See [`docs/release.md`](docs/release.md) to adopt it.

## Layout

```text
.
├── apps/api/               @hosti/api: delivery, server, use-cases
├── packages/bookings/      @hosti/bookings: one Effect module with a storage port and two adapters, src/index.ts is its only export
├── packages/call-audit/    @house-rules/call-audit: an audit trail of capability calls, as log lines or table rows
├── packages/capability/    @house-rules/capability: contracts, handlers, and toTool
├── packages/migrations/    @house-rules/migrations: runs the migrations of every listed module
├── packages/rules/         @house-rules/rules: the house rules, presets, and bins
├── tests/                  fence and thin-config wiring tests
├── .dependency-cruiser.cjs layout({ scope: "@hosti/" }) from house-rules
├── biome.json              extends the house-rules Biome preset, plus excludes
├── docker-compose.yml      the local Postgres that database tests use
├── eslint.config.mjs       the house-rules ESLint configs
├── migrations.json         the module list: every module whose migrations the app runs
├── tsconfig.base.json      extends the house-rules Effect preset
├── pnpm-workspace.yaml     workspace folders and install policy
└── turbo.json              typecheck and test order
```

```text
pnpm check ─> pins ─> migrations ─> env:check ─> biome ─> lint ─> turbo run typecheck ─> deps ─> layout
pnpm test  ─> node --test tests/ ─> turbo run test
```

Root tools run once over the whole repo. The layout bin checks production subject-folder and package cycles after Dependency Cruiser; test paths, adapters and package-root files do not add subject-folder edges. Turborepo runs `typecheck` and `test` in each workspace package, in dependency order. Packages export TypeScript source, so there is no build step. Caching is off, so a gate always runs. CI runs `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm test`, nothing else.

## What the stack adds

House-rules cannot ship these, because they live in files a package cannot hand down. The root uses the in-repo copy through `workspace:0.11.0`. Biome skips `packages/rules/tests/fixtures`, ESLint turns `comment-discipline` off in `packages/rules`, and Dependency Cruiser skips `packages/rules`: the plugin defines those rules, and its fixtures break them on purpose.

- **The fence.** lefthook runs `pnpm check` and then `pnpm test` before each commit. The agent harnesses block `git ... --no-verify` and friends. See [Fence](#fence).
- **Install policy** in `pnpm-workspace.yaml`. `saveExact` and `saveWorkspaceProtocol` make `pnpm add` write exact pins. `engineStrict` enforces engines. `minimumReleaseAge: 1440` refuses a version younger than a day. `allowBuilds` sets every install script to `false`. `packageExtensions` gives the ESLint plugin TypeScript 6.0.3.
- **Environment.** varlock checks `.env.schema` inside `pnpm check`. Its telemetry is off.
- **Turborepo telemetry off.** Every script that calls `turbo` sets `TURBO_TELEMETRY_DISABLED=1`, and so does CI.
- **The module list**, `migrations.json`. It names every module whose migrations the app runs, for `@house-rules/migrations` and for the migrations bin, which fails when a module with migrations is missing from it.
- **A test Postgres.** `docker compose up -d` starts it on `127.0.0.1:55435`, and CI runs the same server as a service. Database tests create and drop their own database on it through `TEST_DATABASE_ADMIN_URL`. The test scripts that need it run under `varlock run --path ../../`, so they read the root `.env.schema`.
- **Wiring tests** in `tests/`. They prove each thin config still extends its preset, and that the fence behaves.

## TypeScript 7 and Effect

TypeScript is pinned to 7.0.2 everywhere. The root `prepare` script runs `effect-tsgo patch`, which swaps the installed `tsc` for the Effect build. If `tsc` stops reporting Effect errors, run `pnpm exec effect-tsgo patch` again.

Two tools do not speak TypeScript 7 yet:

- Dependency Cruiser parses with SWC, so this repo pins `@swc/core`. Each run prints a `missing-typescript-transpiler` warning. That warning is expected.
- `@typescript-eslint/parser` needs TypeScript below 6.1. `packageExtensions` gives it 6.0.3. Drop that entry when the parser accepts 7.

Effect 4 is a release candidate. `effect` and `@effect/vitest` share one exact version and move together. A new RC is often less than a day old, so it usually needs a `minimumReleaseAgeExclude` entry. `pnpm vendor:agent-sources` clones the matching Effect source into `.agent_sources/` for agents to read.

Turborepo is pinned to 2.11.2, because 2.11.3 was under a day old when this was set up.

## Environment

`.env.schema` declares every variable the code reads, with no secret values. Local values go in `.env.local`, which git ignores. `pnpm env:check` runs `varlock load`. Run a command with the values injected:

```sh
pnpm exec varlock run -- <cmd>
```

Every variable starts optional and sensitive. CI has no `.env.local`, so a required variable needs a default or a CI value. To confirm telemetry is off, run `DEBUG=varlock:telemetry pnpm exec varlock load`.

## Prose rules

These are what a reviewer checks. A green `pnpm check` says nothing about them.

- A one-line comment gives a real reason. It does not restate the code.
- Errors are designed, not just typed. Delivery maps them in one place.
- Every Effect package shares one version across the workspace.
- A cast has a stated intent.
- Folders are named after what they own. Seams sit where callers need them. A new module that stands alone gets its own package.
- A module's own tests use only its public entry, not a file beside it.
- A frontend library solves a named pain.
- React code follows React semantics, not only the filename rule.
- Nobody loosens a compiler option in a `tsconfig.json`. TypeScript accepts `strict: true` next to `strictNullChecks: false`.
- Nobody switches off or weakens a preset rule in a thin config. The wiring test only checks that each preset is still extended.
- A cartridge passes the pull-out test. Delete its package and its one `Layer.provide` line, and the rest still builds and passes. A reviewer runs the test in their head for each new cartridge.
- A module opens no transaction. The use-case opens the unit of work (`transactional: true`, or `UnitOfWork.atomic` in its handler), and a module's write runs inside it. The migrations bin catches a raw `withTransaction` or `begin` outside an adapter package and a module that calls `UnitOfWork.atomic`; it cannot see a unit opened through an alias.
- Domain code decides, the store answers. A module's port never decides a permission, a standing, or a limit.
- Only the composition root, `src/server/` or `src/main.ts`, provides services and slots. Delivery provides only per-request values: the Viewer, the call channel, the request id, and a Grant or Approval it fills for this request.
- One service per file, named after its job, with its Layer beside it as a static member. A storage port is the exception: its layers are the adapters under `src/adapters/`.
- Modules are cut by life cycle, not by noun. A package holds one module around a consistency and access boundary. A thing with its own life gets its own module.
- Packages may use other packages through their public entries. The package graph has no cycles or fixed levels, enforced by `no-package-cycles`. A package calls another package's service, never its tables or SQL.
- Use-cases are the app's feature list: each is a thin feature exposed by delivery over HTTP, MCP, CLI, or another mechanism. A use-case may call several packages and opens the unit of work.
- Adapters mirror the subjects: `adapters/<kind>/<subject>.ts` holds that subject's SQL or memory code.

## Fence

```text
git commit ──> lefthook pre-commit ──> pnpm check ──> pnpm test

agent bash call
  Claude Code  .agents/settings.json PreToolUse ─> scripts/hooks/block-git-no-verify.mjs ─┐
  Pi           .pi/extensions/git-interceptor.ts tool_call ──────────────────────────────┤
                                                                                        v
                                                          scripts/vcs-command-policy.mjs
                                                            bypass    ─> deny, with reason
                                                            git or jj ─> allow
```

The policy blocks a `git` command that contains `--no-verify` or `core.hooksPath`, a `git commit` with `-n`, and any command that sets `LEFTHOOK=0`. It matches `--no-verify` anywhere, even inside a commit message, so reword the message. `tests/` holds the full case list.

In Pi, the extension also sets no-op editors on every allowed `git` or `jj` call, so a rebase never waits on an editor nobody sees. Claude Code reads hooks only from `.claude/settings.json`. To turn its block on, copy or link `.agents/settings.json` there.

This raises the floor. An agent can still write the command into a script and run that.

`pnpm acceptance` clones the committed HEAD into a temp dir and runs install, check, and test there. It proves a cold clone works. It does not see uncommitted changes.

The fence is adapted from [rat-stack](https://github.com/joelhooks/rat-stack) by Joel Hooks, MIT. See `NOTICE`.

## Adapt it

Start from the template, or copy these into an existing pnpm workspace:

1. [ ] The thin configs: `biome.json`, `eslint.config.mjs`, `tsconfig.base.json`, `.dependency-cruiser.cjs`.
2. [ ] The stack files: `turbo.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `.env.schema`, `.varlock/config.json`, `docker-compose.yml`, `migrations.json`, and the `.env` lines from `.gitignore`.
3. [ ] The root `package.json` `scripts`, `devDependencies`, `engines`, and `packageManager`. Replace the `workspace:` house-rules dependency with the Git spec in [Using the rules in another app](#using-the-rules-in-another-app).
4. [ ] The fence: `.nvmrc`, `lefthook.yml`, `scripts/`, `tests/`, `.agents/settings.json`, `.pi/extensions/git-interceptor.ts`, `NOTICE`. Add `skills/` if your agents should use them.
5. [ ] `AGENTS.md`, rewritten for your project. Write your own `VISION.md`.
6. [ ] Rename `@hosti/` everywhere: package names, dependencies, imports, `Context.Service` keys, and the `scope` passed to `layout()`.
7. [ ] If your folders differ, pass `layout()` options such as `appsDir`, `packagesDir`, `layers`, `publicEntry`, `internalDir`, `appEntryFiles`, `ownerlessNames`, `mechanismNames`, `packageRootFiles`, `facadeFile`, or `testsDir`. The house-rules docs explain each one.
8. [ ] Run `pnpm install`, then `pnpm check` and `pnpm test`.

### Using the rules in another app

An app outside this repo installs the rules from GitHub, pinned to a full 40-character commit of this repo, with a pnpm subpath:

```json
{
  "devDependencies": {
    "@house-rules/rules": "github:JakubSzwajka/house-rules#<full-40-char-sha>&path:/packages/rules"
  }
}
```

1. [ ] Use Node `>=24.21.0` and pnpm. npm and Yarn do not read the `&path:` subpath.
2. [ ] Keep a `pnpm-workspace.yaml` with a `packages:` list at the app root. The `house-rules-pins` bin reads it to find every manifest.
3. [ ] Keep the `packageExtensions` entry that gives the plugin TypeScript 6.0.3, as this repo's `pnpm-workspace.yaml` does.
4. [ ] Install the peer dependencies of each entry point you import. `@eslint/css`, `@eslint/markdown`, `@shadcn/lint`, and `dependency-cruiser` are optional peers, so pnpm does not install them for you. Importing `/design` without `@eslint/css`, or `/shadcn` without `@shadcn/lint`, fails with `ERR_MODULE_NOT_FOUND`. Pin each one exactly, like every other dependency:

| Entry point | Install in the app, exact pin |
| --- | --- |
| `@house-rules/rules` | `eslint` `10.11.0` |
| `@house-rules/rules/markdown` | `@eslint/markdown` `8.0.3` |
| `@house-rules/rules/design` | `@eslint/css` `2.0.0` |
| `@house-rules/rules/shadcn` | `@shadcn/lint` `0.2.0`. In a TypeScript 7 app, keep its optional `oxc-parser`; see `packages/rules/docs/shadcn.md` |
| `@house-rules/rules/dependency-cruiser` | `dependency-cruiser` `18.4.0` |
| `@house-rules/rules/biome` | `@biomejs/biome` `2.5.14` |
| `@house-rules/rules/tsconfig/*.json` | `typescript`, nothing else |

5. [ ] To upgrade, change the SHA and run `pnpm install`.

#### Migrating from @jakubszwajka/house-rules

The package used to be called `@jakubszwajka/house-rules`. Version 0.5.0 is the first under the new name, `@house-rules/rules`. To move an app:

1. [ ] In `package.json`, replace the dependency key with `@house-rules/rules` and the spec with the one above.
2. [ ] In `eslint.config.mjs`, `biome.json`, `tsconfig.json`, and `.dependency-cruiser.cjs`, replace each `@jakubszwajka/house-rules` import or `extends` with `@house-rules/rules`. Subpaths such as `/markdown` and `/tsconfig/effect.json` keep their names.
3. [ ] In `pnpm-workspace.yaml`, rename the `packageExtensions` key to `@house-rules/rules`.
4. [ ] Run `pnpm install`, then your checks.

An old pin keeps working until you move it. The old commits are in this repo's history, so a pin to one of them still resolves.

### Using capabilities in another app

[`@house-rules/capability`](packages/capability/README.md) defines a capability: one named action with a contract and one handler. An app installs it the same way, with its own subpath, and pins `effect` to the version the package names:

```json
{
  "dependencies": {
    "@house-rules/capability": "github:JakubSzwajka/house-rules#<full-40-char-sha>&path:/packages/capability"
  }
}
```

Its README lists the install steps, the permission and approval gates, and what it does not do yet.

### Add an app

1. Create `apps/<name>/` from `apps/api`: `package.json` with a new `name`, `tsconfig.json`, and `vitest.config.ts`.
2. Put code under `src/delivery/`, `src/server/`, and `src/use-cases/`. Only `src/main.ts` and `src/index.ts` sit directly in `src/`. The services and slots go in one composition root, `src/server/`, as `apps/api/src/server/app-layer.ts` shows.
3. Add each package with `pnpm --filter <app name> add <package name>`.
4. Run `pnpm install`, `pnpm check`, and `pnpm test`.

### Add a package

Follow [`skills/add-an-effect-module/SKILL.md`](skills/add-an-effect-module/SKILL.md). In short: copy `packages/bookings`, keep `exports` to `"." : "./src/index.ts"`, lay the code out in subject folders such as `src/booking/`, and run `pnpm install`.

### Let agents call a use-case

Follow `skills/add-an-mcp-tool/SKILL.md`. `docs/mcp-adapter.md` records why an MCP tool only runs an existing use-case.

## Example

[`examples/hosti-before`](examples/hosti-before/README.md) holds code that fails the checks, as Markdown snippets so this repo stays green.

[`packages/bookings`](packages/bookings) and [`apps/api`](apps/api) are real code that passes. Dependencies point inward:

```text
apps/api
  delivery ───> use-cases ───> @hosti/bookings  (packages/bookings/src/index.ts)
      └──────────────────────> @hosti/bookings  (Bookings type)
  server   ──────────────────> @hosti/bookings  (Bookings layer, BookingPermissions value)
```

The package exposes a `Bookings` service, a `Booking` schema, and typed `BookingNotFound`, `BookingAlreadyExists`, and `BookingStoreUnavailable` errors. The package also names its permission, `bookings:read`. `Bookings` talks only to its storage port, `BookingStore`. The package ships two adapters for it: a memory adapter (`memoryBookingStore`, behind `Bookings.fromRecords`) and a Postgres adapter in plain SQL (`postgresBookingStore`, with its migration in `packages/bookings/migrations/`). One shared suite in `src/adapters/tests/` runs every store case on both. `Bookings.create` is the write path: it runs inside an open unit of work and fails with `NoOpenUnit` without one, and the memory adapter registers an undo with `UnitOfWork.onRollback` so a rollback leaves no row. The `showBooking` use-case is a capability: a contract that names `Booking` as its output, `BookingNotFound` and `BookingStoreUnavailable` as its failures, and `bookings:read` as its permission, plus a handler that yields the service. The HTTP handler calls `showBooking.handler({ id })`, maps `BookingNotFound` to a 404, `BookingStoreUnavailable` to a 503, and `Forbidden` to a 403 once, so its error channel is `never`. It provides nothing. The composition root, `src/server/app-layer.ts`, provides `Bookings` and the `Grant`: the example has no sign-in, so every visitor holds `bookings:read`, and a Grant that is the same for every request belongs in the root. Tests sit in a `tests/` folder beside the code they test and run under `it.effect`.

## Commands

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm env:check
pnpm test
pnpm fix
pnpm format
pnpm acceptance
pnpm vendor:agent-sources
```
