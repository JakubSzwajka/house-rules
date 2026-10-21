# house-rules

A TypeScript workspace template with shared checks, exact pins and commit hooks. The [rules plugin](packages/rules/README.md) owns the presets. [AGENTS.md](AGENTS.md) is the law; [CONTEXT.md](CONTEXT.md) defines the words. The [docs site](https://stack.kubaszwajka.com) explains the template to people.

## Start

Use the Node version in `.nvmrc` and the exact pnpm version in `package.json`. Corepack selects it.

```sh
gh repo create my-app --private --clone --template JakubSzwajka/house-rules
cd my-app
corepack enable
pnpm install --frozen-lockfile
docker compose up -d
pnpm check
pnpm test
```

Install sets up lefthook and patches `tsc` with `effect-tsgo patch`. Each database suite creates and drops its own database through `TEST_DATABASE_ADMIN_URL`. Local Postgres listens on port 55435.

Write your own `VISION.md`. Remove `examples/` in your new project and remove its roots from the workspace and thin configs. Keep your code in `apps/` and `packages/`. The [booking guide](examples/booking/README.md) shows the framework before you remove it.

## Layout

```text
apps/                        your apps
examples/booking/            private reference app and its domain packages
packages/
  domain/                    descriptors, callers, graphs, modules and units
  application/               features, bindings, execution, ways and clients
  auth-jwt/                  token verification plug
  call-audit/                feature audit plug
  comments/                  comments module
  identity/                  login bindings and Who plug
  migrations/                module migration runner
  node-host/                 plain fetch handler on a Node socket
  party/                     people module
  rules/                     shared checks and presets
site/                        private Astro docs site
skills/house-rules/           agent guide router
tests/                       root wiring and fence tests
```

App source has these areas:

```text
src/
  features/<name>/           index.ts with one feature and handler, tests/
  read-models/<name>/        screen query over published views
  ways-in/<name>/            HTTP or MCP way and client endpoints
  composition/              mount, link, plug, open ways, schedule
  main.ts                   join the root and ways, start the Host
```

Domain modules are packages, including app-owned ones such as `examples/booking/packages/bookings`. A module owns its tables, migrations and object rules. Its public doors are `index.ts` and optional browser-safe `contract.ts`. A read model stays in the app and selects published views, never private tables.

## How a call runs

```text
request -> way (Who, May, Mean) -> app feature
  record -> feature identity -> person/system closures -> approval -> one unit
    handler -> declared edges -> module or read-model operations
               |
            step trace
```

Application's `defineFeature` puts one app action and its handler in `features/<name>/index.ts`. A feature is its own entry. Its handler only calls declared edges, so the file stays browser-safe. `features/index.ts` exports Features and the permission lists.

Domain's `defineOperation` describes module or read-model work. Modules export `<Module>Operations` from `./contract`. Application's `bindOperation` captures their services in composition. Only features can be exposed through ways, May lists, hooks or schedules.

A plain edge keeps the caller. `asSystem(target, reason)` switches that branch to the system and never back. A feature derives its permission closures and flags from the graph. Approval runs once. Only the feature runtime opens a production unit; handlers and modules join it. A failed write rolls back the graph's stored changes, not external provider effects.

The default gate policy, `feature-and-recheck`, also checks each inner operation's own permission. `feature-only` skips that recheck. Both stay while P2 is open.

Ways import values from kits, `effect`, package contract doors, features, composition and their own folder. Other package main entries allow types only. Build concrete plugs in composition and pass them into ways. The root receives ways from `main.ts`; it never imports them.

Expected errors declare a kind. Application maps that kind to a fixed status and code. Ways may change message text only. Unavailable and plumbing errors use fixed public messages; driver details stay internal. Defects answer generic 500.

## Packages and guides

These are workspace versions, not a claim that the changed APIs are already on npm. Release needs owner approval.

| Package | Version | Guide |
| --- | --- | --- |
| `@house-rules/domain` | `0.1.0` | [Domain](packages/domain/README.md) |
| `@house-rules/application` | `0.2.0` | [Application](packages/application/README.md) |
| `@house-rules/rules` | `0.18.0` | [Rules](packages/rules/README.md) |
| `@house-rules/migrations` | `0.3.0` | [Migrations](packages/migrations/README.md) |
| `@house-rules/node-host` | `0.2.0` | [Node Host](packages/node-host/README.md) |
| `@house-rules/comments` | `0.2.0` | [Comments](packages/comments/README.md) |
| `@house-rules/party` | `0.1.0` | [Party](packages/party/README.md) |
| `@house-rules/identity` | `0.1.0` | [Identity](packages/identity/README.md) |
| `@house-rules/auth-jwt` | `0.1.0` | [JWT](packages/auth-jwt/README.md) |
| `@house-rules/call-audit` | `0.7.0` | [Audit](packages/call-audit/README.md) |

Each framework package an app mounts ships `AGENTS.md`. Load the [house-rules skill](skills/house-rules/SKILL.md) to find the right guide.

The nine TypeScript packages publish JavaScript and declarations in `dist/`. Workspace imports still read `src/`. Plain Node and TypeScript consumers need no source loader or Next transpile setting. Rules is plain JavaScript with no build step. Consumer configs extend presets and set project values; they never copy a preset.

## Checks and CI

```text
pnpm check -> pins -> migrations -> environment -> Biome -> ESLint
           -> workspace typechecks -> Dependency Cruiser -> layout/cycles
pnpm test  -> root Node tests -> workspace tests
```

Warnings fail Biome and ESLint. All Dependency Cruiser rules have error severity. See the [rules table](packages/rules/README.md#rules-and-checks) for the checked rules and their limits. Tests of retired names scan live code and docs, with exact exceptions for intentional absence proofs and the old rule anchor.

CI starts Postgres, installs the frozen lockfile, then runs check, test, packed-consumer, the booking API build and the site build. The example has no web page. Its API build bundles `src/main.ts` for Node.

`pnpm run packed-consumer` builds and packs all ten public packages, installs them in a cold npm consumer, and checks Node, TypeScript, browser contracts, layout and migration behavior. It needs the registry. `pnpm acceptance` clones committed HEAD into a temp folder and runs frozen install, check and test. It cannot see uncommitted work.

## Pins and environment

Pin every dependency exactly, including workspace pins. Keep the existing package manager and lockfile. New dependencies and version changes need approval. Install scripts stay denied in `allowBuilds`; release-age exceptions also need approval.

Effect runtime packages share version 4.0.3. A workspace with `@effect/platform-node` also declares `@effect/platform-node-shared` directly at that version. TypeScript is 7.0.2; `@effect/tsgo` is 0.45.0. The ESLint parser still needs the TypeScript 6.0.3 package extension. Dependency Cruiser uses SWC and prints an expected `missing-typescript-transpiler` notice.

Declare every variable in `.env.schema`, without secrets. Store local secrets only in ignored `.env.local` or `.env.*.local` files. `pnpm env:check` validates values. Use `pnpm exec varlock run -- <cmd>` to inject them. Varlock and Turbo telemetry stay off.

## Review and the fence

Lefthook runs check then test before every commit. Pi's interceptor and `scripts/vcs-command-policy.mjs` block hook bypasses. `.agents/settings.json` holds the Claude-format hook, but Claude needs it in `.claude/settings.json` to load it. The fence is adapted from [rat-stack](https://github.com/joelhooks/rat-stack); [NOTICE](NOTICE) keeps the attribution and license.

Checks do not replace review. Review module boundaries, explicit Actor arguments, object policy, fixed public error messages and SQL ownership inside procedural bodies. A plug must pass the pull-out test: removing it and its `Layer.provide` line leaves the rest building and passing. Test each exposed agent tool for A/B access under fake actors. MCP stays read-only unless the owner approves writes.

The reference [booking app](examples/booking/README.md) shows booking and payment writes in one feature, a system refund edge, shared Party/Identity operations and a private read model. [TESTS.md](examples/booking/TESTS.md) names its proof and remaining gaps. Its registry is generated; the freshness test never writes it.

## Change the template

Keep thin configs, CI, hooks, environment checks and wiring tests when you adapt the stack. Match roots in `pnpm-workspace.yaml`, `layout()` and `featuresConfig()`. A Next app uses `host: "next"` and the Next preset; it already has a Host.

For a browser client, export endpoint descriptors from `ways-in/<name>/endpoints.ts`. Both the router and client read those descriptors. Bindings and storage never enter a contract dependency tree. See [clients and endpoints](packages/application/README.md#shared-endpoints-and-clients).

The site has a home page, a handwritten start page and a generated rules page. Ask before adding a page. Change rule docs and the rules README first, then run `pnpm --filter @house-rules/site generate`. Never edit generated rules by hand.

Only `.github/workflows/publish.yml` publishes packages. A release bumps each package and every workspace pin on it together, with approval. Do not publish by hand. See [the release guide](docs/release.md) for the workflow and how to adopt it.

## Commands

```sh
pnpm check
pnpm test
pnpm build
pnpm run packed-consumer
pnpm acceptance
pnpm vendor:agent-sources
pnpm --filter @house-rules/site dev
pnpm --filter @house-rules/site build
```

`pnpm fix` applies safe lint fixes; `pnpm format` rewrites formatting. Run either only when you intend those edits.
