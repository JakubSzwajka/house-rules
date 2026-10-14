# house-rules

house-rules is the home of the house plugin and of a TypeScript monorepo template, the stack. The stack holds [`@house-rules/rules`](packages/rules/README.md) in `packages/rules` and shows it wired into a real [pnpm](https://pnpm.io) workspace run by [Turborepo](https://turborepo.com), with example code in [Effect 4](https://effect.website). It also holds the prose rules I want in every project, the ones no tool can check.

Every lint rule, preset, and check in `pnpm check` comes from the house plugin for deterministic feedback, and [its README lists them](packages/rules/README.md#rules-and-checks).

The docs site, [stack.kubaszwajka.com](https://stack.kubaszwajka.com), is for people deciding on the template: a start page and a table of every rule, where `/rules/#<rule id>` links to one rule. Agents read `AGENTS.md` instead, and `/llms.txt` tells them so. Its source is [`site/`](site/README.md).

It is a GitHub template. Create a repo from it with `gh repo create my-app --private --clone --template JakubSzwajka/house-rules`. It also carries the reference copy of the release workflow. See [`docs/release.md`](docs/release.md) to adopt it.

## Layout

```text
.
├── apps/                   your apps go here; empty in the template
├── examples/               the showcase, never published; delete it in a new project
│   ├── booking-platform/   a regular app workspace: apps/api (@example/api) and packages/bookings (@example/bookings)
│   └── rejected-shapes/   code that fails the checks, as Markdown snippets
├── packages/               your packages go here; in this repo, the framework packages:
├── packages/application/   @house-rules/application: the application kit: contracts, CurrentActor, gates, delivery, a typed HTTP client and OpenAPI
├── packages/auth-jwt/      @house-rules/auth-jwt: a plug-in that verifies JWTs against a key set, with a Clerk preset
├── packages/call-audit/    @house-rules/call-audit: a plug-in that audits capability calls, as log lines or table rows
├── packages/comments/      @house-rules/comments: a domain addition for flat comments, with a host port for target access
├── packages/domain/        @house-rules/domain: the domain kit: defineModule, Actor, permissions and policy, the unit of work
├── packages/identity/      @house-rules/identity: binds a verified login to an ActorId and fills the Caller
├── packages/migrations/    @house-rules/migrations: runs the migrations of every listed module
├── packages/node-host/     @house-rules/node-host: streams a Web fetch handler on a Node socket
├── packages/party/         @house-rules/party: a domain addition for the people an app knows
├── packages/rules/         @house-rules/rules: the house rules, presets, and bins
├── site/                   @house-rules/site: the docs site (Astro + Starlight)
├── skills/                 the `house-rules` agent skill, a router to the package guides
├── tests/                  fence and thin-config wiring tests
├── .dependency-cruiser.cjs layout() from house-rules, with the example roots and scope "@example/"
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

Root tools run once over the whole repo. Biome and ESLint warnings fail the check (`biome` runs with `--error-on-warnings`, `lint` with `--max-warnings 0`), so fix the code instead of leaving a warning. Every Dependency Cruiser rule is severity `error`; its `missing-typescript-transpiler` notice is a tool message, not a finding. The layout bin checks production subject-folder and package cycles after Dependency Cruiser; test paths, adapters and package-root files do not add subject-folder edges. Turborepo runs `typecheck` and `test` in each workspace package, in dependency order. Packages export TypeScript source, so there is no build step. Caching is off, so a gate always runs. CI runs `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm test`, nothing else.

## What the stack adds

House-rules cannot ship these, because they live in files a package cannot hand down. The root uses the in-repo copy through `workspace:0.18.0`. Biome skips `packages/rules/tests/fixtures` and the git-ignored prototype folder `.pi/specs`, ESLint turns `comment-discipline` off in `packages/rules`, and Dependency Cruiser skips `packages/rules`: the plugin defines those rules, and its fixtures break them on purpose. For the docs site, Biome and ESLint skip only its build output (`site/dist`, `site/.astro`), and Dependency Cruiser lets files under `site/` import Astro's virtual `astro:*` modules, which exist on no disk.

- **The fence.** lefthook runs `pnpm check` and then `pnpm test` before each commit. The agent harnesses block `git ... --no-verify` and friends. See [Fence](#fence).
- **Install policy** in `pnpm-workspace.yaml`. `saveExact` and `saveWorkspaceProtocol` make `pnpm add` write exact pins. `engineStrict` enforces engines. `minimumReleaseAge: 1440` refuses a version younger than a day. `allowBuilds` sets every install script to `false`. `packageExtensions` gives the ESLint plugin TypeScript 6.0.3.
- **Environment.** varlock checks `.env.schema` inside `pnpm check`. Its telemetry is off.
- **Turborepo telemetry off.** Every script that calls `turbo` sets `TURBO_TELEMETRY_DISABLED=1`, and so does CI.
- **The module list**, `migrations.json`. It names every module whose migrations the app runs, for `@house-rules/migrations` and for the migrations bin, which fails when a module with migrations is missing from it.
- **A test Postgres.** `docker compose up -d` starts it on `127.0.0.1:55435`, and CI runs the same server as a service. Database tests create and drop their own database on it through `TEST_DATABASE_ADMIN_URL`. The test scripts that need it run under `varlock run --path` with the repository root, such as `../../` in `packages/<name>`, so they read the root `.env.schema`.
- **Wiring tests** in `tests/`. They prove each thin config still extends its preset, and that the fence behaves.

## TypeScript 7 and Effect

TypeScript is pinned to 7.0.2 everywhere. The root `prepare` script runs `effect-tsgo patch`, which swaps the installed `tsc` for the Effect build. If `tsc` stops reporting Effect errors, run `pnpm exec effect-tsgo patch` again.

Two tools do not speak TypeScript 7 yet:

- Dependency Cruiser parses with SWC, so this repo pins `@swc/core`. Each run prints a `missing-typescript-transpiler` warning. That warning is expected.
- `@typescript-eslint/parser` needs TypeScript below 6.1. `packageExtensions` gives it 6.0.3. Drop that entry when the parser accepts 7.

Effect is pinned to stable 4.0.3. `effect`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/sql-pg` and `@effect/vitest` move together. Workspaces that install `@effect/platform-node` also pin `@effect/platform-node-shared` directly to 4.0.3. These releases are over a day old, so no release-age exception is needed. `@effect/tsgo` stays at 0.45.0 with TypeScript 7.0.2. Its patch and Effect diagnostics are tested on stable Effect. `pnpm vendor:agent-sources` clones the matching source into `.agent_sources/` for agents to read.

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
- Only the composition root, `src/composition/`, provides services and slots. Delivery provides only per-request values: the CurrentActor, the call channel, the request id, and a Grant or Approval it fills for this request.
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
3. [ ] The root `package.json` `scripts`, `devDependencies`, `engines`, and `packageManager`. Replace the `workspace:` house-rules dependency with the exact npm version in [Using the rules in another app](#using-the-rules-in-another-app).
4. [ ] The fence: `.nvmrc`, `lefthook.yml`, `scripts/`, `tests/`, `.agents/settings.json`, `.pi/extensions/git-interceptor.ts`, `NOTICE`. Add `skills/house-rules/` if your agents should use it.
5. [ ] `AGENTS.md`, rewritten for your project. Write your own `VISION.md`.
6. [ ] Delete `examples/` and remove its traces, as [its README](examples/booking-platform/README.md) lists. Pass your own `scope` to `layout()` in place of `@example/`. Your own code goes in `apps/` and `packages/`.
7. [ ] If your folders differ, pass `layout()` options such as `appsDir`, `packagesDir`, `layers`, `publicEntry`, `internalDir`, `appEntryFiles`, `ownerlessNames`, `mechanismNames`, `packageRootFiles`, `facadeFile`, or `testsDir`. The house-rules docs explain each one.
8. [ ] Run `pnpm install`, then `pnpm check` and `pnpm test`.

### Installing

The publish workflow includes ten public packages under the `@house-rules` scope, in four parts: the kits, the wiring, the additions, and the app you write. These are the release-ready workspace versions; application 0.2.0, auth-jwt 0.1.0, identity 0.1.0, party 0.1.0, call-audit 0.7.0, comments 0.2.0 and node-host 0.2.0 are prepared here, not yet published:

| Part | Package | What it is | Version |
| --- | --- | --- | --- |
| kit | [`@house-rules/domain`](packages/domain/README.md) | Define domain modules: `defineModule`, Actor, permissions and policy, the unit of work | `0.1.0` |
| kit | [`@house-rules/application`](packages/application/README.md) | Build the application layer: contracts, CurrentActor, gates, composition, delivery, the `Authenticator` slot | `0.2.0` |
| wiring | [`@house-rules/migrations`](packages/migrations/README.md) | Run every module's SQL migrations | `0.3.0` |
| wiring | [`@house-rules/node-host`](packages/node-host/README.md) | Host for a Web fetch handler on a Node socket | `0.2.0` |
| wiring | [`@house-rules/rules`](packages/rules/README.md) | The house plugin: rules, presets, bins. Plain JavaScript, dev only. | `0.18.0` |
| addition | [`@house-rules/comments`](packages/comments/README.md) | A domain addition: flat comments with host-owned target access | `0.2.0` |
| addition | `@house-rules/party` | A domain addition: Person records keyed by ActorId, self-only rename | `0.1.0` |
| addition | `@house-rules/identity` | A domain addition: binds a verified login to an ActorId and fills the `Caller` | `0.1.0` |
| addition | `@house-rules/auth-jwt` | A plug-in: fills `Authenticator` by verifying JWTs, with a Clerk preset | `0.1.0` |
| addition | [`@house-rules/call-audit`](packages/call-audit/README.md) | A plug-in: one audit line or row per capability call | `0.7.0` |

The two kits replace `@house-rules/capability`, which stays at 0.16.0 on npm and gets no new versions. Its [upgrade notes](packages/application/README.md#upgrading-from-house-rulescapability) say which kit each name moved to.

1. [ ] Pin each one to an exact version, like every other dependency: `"@house-rules/application": "0.2.0"`. `house-rules-pins` fails `^` and `~`.
2. [ ] Pin `effect` to the version their `peerDependencies` name, now `4.0.3`. If the app installs `@effect/platform-node`, also declare `@effect/platform-node-shared` as an exact direct dependency at that same version. `application` peers on the exact `domain` version, `call-audit` on the exact `application` version, and `comments`, `auth-jwt`, `identity` and `party` on both.
3. [ ] If your `pnpm-workspace.yaml` sets `minimumReleaseAge`, a version younger than that fails the install. This repo requires 24 hours after publication. Wait; a release-age exception needs separate owner approval.

`domain`, `application`, `auth-jwt`, `identity`, `party`, `migrations`, `call-audit`, `comments`, and `node-host` ship built JavaScript and declarations in `dist/`. Plain `node` loads them, any bundler takes them as is, and `tsc` reads their `.d.ts` files. An app needs no `transpilePackages`, no type-stripping loader, and no `allowImportingTsExtensions` for them. In this repo they stay source: `exports` points at `src/`, and pnpm swaps in `publishConfig.exports`, which points at `dist/`, only when it packs. `pnpm run packed-consumer` packs all ten and installs them with `@effect/platform-node` and an exact direct `@effect/platform-node-shared` pin into a fresh app with no lockfile. It checks the resolved shared Node package, runs the Node Host on a real socket, the rules plugin, Node services, a transactional capability, memory comments use-cases with Actor, CurrentActor and denied access, and a sign-in: auth-jwt verifies a locally signed token, identity resolves the actor and refuses bad tokens, and party serves that person. It type-checks a consumer that declares a module with `defineModule`, reads `CurrentActor` in a use-case and mounts comments, with the Effect and web presets. It checks that the comments, party, application and domain contract entries stay browser-safe, and runs the layout and installed-package migration checks. CI runs it on every pull request.

#### Upgrading from a Git SHA pin

Up to rules 0.14.0 and capability 0.13.0, apps pinned a commit: `github:JakubSzwajka/house-rules#<sha>&path:/packages/<name>`. Those pins keep working, because the commits stay in this repo's history. To move to npm:

1. [ ] Replace each Git spec with the exact version from the table above.
2. [ ] Delete `@house-rules/*` from Next's `transpilePackages`, and any loader that strips types under `node_modules`.
3. [ ] Drop `allowImportingTsExtensions` if only these packages needed it. Your own `.ts` imports may still need it.
4. [ ] Run `pnpm install`, then `pnpm check` and `pnpm test`.

The layout rules accept the built contract entry, `dist/contract.js`, wherever they accepted `src/contract.ts`. Apps on rules 0.14.0 or older fail `contract-entry-is-browser-safe` on capability from npm, so move the rules first or together.

#### Publishing

`.github/workflows/publish.yml` publishes. Every run starts with the `verify` job, which has `contents: read` only: no token and no OIDC. It runs `pnpm check`, `pnpm test`, `pnpm build`, `pnpm run packed-consumer`, and a `pnpm publish --dry-run`. Pull requests that touch a package stop there. Pushing a tag such as `@house-rules/application@0.1.0`, or running the workflow on `main` with `publish` ticked, then runs the `publish` job, the only one with `id-token: write` and `NPM_TOKEN`. There `pnpm publish -r --access public --provenance --report-summary` publishes every public package whose version is not on npm yet. After success, the job creates and pushes one `@house-rules/<pkg>@<version>` tag for each package in that report. Only this job has `contents: write`. Its pushes use `GITHUB_TOKEN`, so they do not start another publish run. To release, bump the version in the package's `package.json`, and every `workspace:` pin on it, in one pull request.

The workflow reads `NPM_TOKEN`, an npm granular access token with publish rights on the `@house-rules` scope. It lives only as a GitHub Actions repository secret on this repo. Never print it, commit it, or put it in `.env.schema` or `.env.local`. Provenance needs no token: the `publish` job's `id-token: write` permission lets npm sign each package with this workflow's identity, and only the `publish` job has it. `tests/published-packages.test.mjs` parses the workflow and fails if a job a pull request can trigger gets that permission or reads the secret.

### Using the rules in another app

An app outside this repo installs the rules from npm at an exact version:

```json
{
  "devDependencies": {
    "@house-rules/rules": "0.18.0"
  }
}
```

1. [ ] Use Node `>=24.21.0` and pnpm.
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

5. [ ] To upgrade, change the version and run `pnpm install`.

#### Migrating from @jakubszwajka/house-rules

The package used to be called `@jakubszwajka/house-rules`. Version 0.5.0 is the first under the new name, `@house-rules/rules`. To move an app:

1. [ ] In `package.json`, replace the dependency key with `@house-rules/rules` and the spec with the one above.
2. [ ] In `eslint.config.mjs`, `biome.json`, `tsconfig.json`, and `.dependency-cruiser.cjs`, replace each `@jakubszwajka/house-rules` import or `extends` with `@house-rules/rules`. Subpaths such as `/markdown` and `/tsconfig/effect.json` keep their names.
3. [ ] In `pnpm-workspace.yaml`, rename the `packageExtensions` key to `@house-rules/rules`.
4. [ ] Run `pnpm install`, then your checks.

An old pin keeps working until you move it. The old commits are in this repo's history, so a pin to one of them still resolves.

### Using the kits in another app

[`@house-rules/domain`](packages/domain/README.md) defines a package's module: `defineModule`, the Actor, permissions and policy, and the unit of work. [`@house-rules/application`](packages/application/README.md) defines a capability, one named action with a contract and one handler, and delivers it over HTTP and MCP. An app installs both the same way, and pins `effect` to the version the packages name:

```json
{
  "dependencies": {
    "@house-rules/application": "0.2.0",
    "@house-rules/domain": "0.1.0",
    "effect": "4.0.3"
  }
}
```

Their READMEs list the install steps, the permission and approval gates, and what they do not do yet.

### Host a Node app

A Host listens for HTTP and runs a fetch handler. Node apps use `serve` from `@house-rules/node-host` in `src/main.ts`, never `node:http`. The reference API reads `PORT` through Effect Config, defaulting to 3000, and closes its fetch handler before its composition on SIGTERM or SIGINT. Importing its entry in a test does not start a listener. The Host streams bodies and drains for up to five seconds before disposal. Behind a TLS proxy, set optional `APP_ORIGIN` to the public origin, such as `https://public.example`, so cookie writes do not fail with 403 `cross_origin`. Set explicit `origins` for local and internal apps too, and restrict Host at their proxy or listener to guard against DNS rebinding. See [the Node Host README](packages/node-host/README.md) for the options. A Next app already has a Host and needs no Node Host package.

### Add an app

1. Create `apps/<name>/` from `examples/booking-platform/apps/api`: `package.json` with a new `name`, `tsconfig.json`, and `vitest.config.ts`.
2. Put code under `src/delivery/`, `src/use-cases/`, `src/composition/`, and `src/server/` when the app has a background loop. Only `src/main.ts` and `src/index.ts` sit directly in `src/`. The services, slots, callers and views go in one composition root, `src/composition/`, as `examples/booking-platform/apps/api/src/composition/` shows. A Next.js app sets `host: "next"` in `layout()` and extends `tsconfig/next.json`; see the [house plugin README](packages/rules/README.md#a-web-app).
3. Add each package with `pnpm --filter <app name> add <package name>`.
4. Run `pnpm install`, `pnpm check`, and `pnpm test`.

### Add a package

Load the `house-rules` skill (`skills/house-rules/SKILL.md`); its router points at the [domain kit guide](packages/domain/AGENTS.md). In short: copy `examples/booking-platform/packages/bookings` into `packages/<name>`, keep `exports` to `"." : "./src/index.ts"`, plus `"./contract": "./src/contract.ts"` only when a browser needs the package's contracts, lay the code out in subject folders such as `src/booking/`, and run `pnpm install`.

### Add a docs page

Read [`site/README.md`](site/README.md) and the "Docs site" section of [`AGENTS.md`](AGENTS.md). In short: the site has one hand-written page, `site/src/content/docs/start/index.md`, and one generated page, the rules table. To change the table, change `packages/rules`, then run `pnpm --filter @house-rules/site generate` and commit the result.

### Single-page apps

A single-page app calls the HTTP routes through a typed client built from the same contracts. It must not bundle SQL, so it imports only contract entries: `@house-rules/application/contract`, `@house-rules/domain/contract` and a package's `src/contract.ts`, such as `@example/bookings/contract`. `contract-entry-is-browser-safe` fails the check when a contract entry reaches an adapter, a facade, a `node:` module, a driver, an `effect` module off its allowlist, or an installed contract entry no one vouched for. In the example app, `examples/booking-platform/apps/api`:

```text
@example/bookings/contract ──> showBookingContract (schemas, errors, permission)
delivery/http/endpoints.ts   endpoint(showBookingContract, "GET /bookings/:id")
  ├─> delivery/http/routes.ts      route(showBooking, endpoint)  -> toFetchHandler  (server)
  ├─> delivery/web/booking-client.ts toHttpClient([endpoint])     -> the SPA        (browser)
  └─> main.ts                      toOpenApi(routes, { views })   -> OpenAPI 3.1
```

The route and the client read one `endpoint`, so the path, the method and the status cannot drift. `src/tests/browser-bundle.test.ts` bundles the contract entries and the client with esbuild for the browser and fails on server code. It also bundles every `effect` module the rule trusts, because the rule cannot look inside `node_modules`. The [application kit's README](packages/application/README.md#single-page-apps) covers failures, cookies, CSRF and OpenAPI.

### Let agents call a use-case

Load the `house-rules` skill (`skills/house-rules/SKILL.md`); its router points at the [application kit guide](packages/application/AGENTS.md) and the "Agent adapters" section of [`AGENTS.md`](AGENTS.md). `docs/mcp-adapter.md` records why an MCP tool only runs an existing use-case.

## Example

[`examples/rejected-shapes`](examples/rejected-shapes/README.md) holds code that fails the checks, as Markdown snippets so this repo stays green.

[`examples/booking-platform`](examples/booking-platform/README.md) is real code that passes, laid out like a regular project. Its README maps each framework concept to the file that shows it, and says how to run it. Dependencies point inward:

```text
examples/booking-platform/apps/api
  delivery    ───> use-cases ───> @example/bookings  (packages/bookings/src/index.ts)
      └─────────────────────────> @example/bookings  (Bookings type)
  composition ──────────────────> @example/bookings  (Bookings layer, BookingPermissions, error types)
  main.ts     ───> delivery routes + composition  (toFetchHandler)
```

The package declares its root `Bookings` service with `defineModule` from `@house-rules/domain`. Its stable id is the service key; its make Effect captures BookingStore, never a request's CurrentActor. Effect owns lazy build, sharing within one build and scoped cleanup. Adapter statics stay on the class. An options make gives `layer(options)` with presets as plain data; there is no registry or private nesting. One module per package stays the rule.

`Actor` and its branded `ActorId` come from the domain kit, and `CurrentActor` from the application kit. Delivery provides CurrentActor per request, a use-case yields the Actor directly, and module methods take it explicitly. `Bookings.create(actor, input)` stores ownerId. `Bookings.relation(actor, id)` decides `"owner"` or `"none"` from stored facts. New migration 0002 adds nullable owner_id; 0001 is unchanged, so legacy rows remain unowned and answer `"none"` for everyone. The visitor Grant and public reads stay as they were. The HTTP output omits ownerId.

The package exports the `Booking`, `NewBooking` and `PublicBooking` schemas, and typed `BookingNotFound`, `BookingAlreadyExists`, `BookingAlreadyCancelled` and `BookingStoreUnavailable` errors. It names three permissions: `bookings:read`, `bookings:write` and `bookings:cancel`. `Bookings` talks only to its storage port, `BookingStore`. The package ships two adapters for it: a memory adapter (`memoryBookingStore`, behind `Bookings.fromRecords`) and a Postgres adapter in plain SQL (`postgresBookingStore`, with its migration in `examples/booking-platform/packages/bookings/migrations/`). One shared suite in `src/adapters/tests/` runs every store case on both. `Bookings.create` is the write path: it runs inside an open unit of work and fails with `NoOpenUnit` without one, and the memory adapter registers an undo with `UnitOfWork.onRollback` so a rollback leaves no row. The module's contract entry holds three contracts. `show_booking` needs `bookings:read` and outputs `PublicBooking`: the id, the guest name and the status, never the owner. `book_booking` and `cancel_booking` are transactional writes, and cancel also needs Approval. [The example README](examples/booking-platform/README.md) maps each concept to its file. The HTTP handler calls `showBooking.handler({ id })`, maps `BookingNotFound` to a 404, `BookingStoreUnavailable` to a 503, and `Forbidden` to a 403 once, so its error channel is `never`. It provides nothing. The composition root, `src/composition/`, provides `Bookings` and the `Grant` in `app-layer.ts`: the example has no sign-in, so every visitor holds `bookings:read`, and a Grant that is the same for every request belongs in the root. The entry point, `src/main.ts`, mounts the same use-case as a Web fetch handler with `toFetchHandler`. `src/composition/index.ts` wraps the root layer with `composition(...)` and the views table in `views.ts`, which maps `BookingNotFound` to 404 and `BookingStoreUnavailable` to 503, and `src/delivery/http/routes.ts` lists `route(showBooking, bookingEndpoints.showBooking)`, the endpoint the SPA client shares. Leave out a view and `tsc` fails. Tests sit in a `tests/` folder beside the code they test and run under `it.effect`.

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
pnpm build
pnpm run packed-consumer
pnpm vendor:agent-sources
pnpm --filter @house-rules/site dev
```
