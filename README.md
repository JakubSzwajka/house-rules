# house-rules

A TypeScript workspace template for apps built on [Alchemy Domain](https://alchemy.run/domain), with shared checks, exact pins and commit hooks. Apps model their backend as aggregates, commands, events, views and policies; `@house-rules/stack` adds sign-in, permissions and reusable modules on top. [AGENTS.md](AGENTS.md) is the law; [CONTEXT.md](CONTEXT.md) defines the words. The [docs site](https://stack.kubaszwajka.com) explains the template to people.

## Play with the example

[examples/booking](examples/booking/README.md) is a small booking backend on the stack: bookings, payments with a deadline, policies acting as a system actor, a private view, and one Api served as HTTP, RPC, MCP and a CLI. With Node 24 and pnpm, from the repo root:

```sh
pnpm install --frozen-lockfile
pnpm db:up
DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55432/house_rules pnpm --filter @example/booking-server dev
curl localhost:3000/MakeBooking -H 'authorization: Bearer ann-token' --json '{"target":"b-1","input":{"guestName":"Grace","amount":100}}'
```

The server keeps its data in Postgres on `http://localhost:3000` and keeps it across restarts; `DOMAIN_STORE=memory` runs it in memory with no database. The [example's README](examples/booking/README.md) lists the dev tokens, more calls, the CLI, MCP, Clerk sign-in and the Cloudflare deploy.

## Start a new app

Use the Node version in `.nvmrc` and the exact pnpm version in `package.json`. Corepack selects it.

```sh
gh repo create my-app --private --clone --template JakubSzwajka/house-rules
cd my-app
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Install sets up lefthook and patches `tsc` with `effect-tsgo patch`. Tests that host a model need Postgres: run `pnpm db:up` (Docker) first, or set `DOMAIN_STORE=memory` to run them on `Domain.InMemory`.

Then follow [Start a new app from scratch](packages/stack/README.md#start-a-new-app-from-scratch) in the stack README: permissions, your own aggregate beside a stack module, the model and its Api, roles, stories, sign-in with dev tokens or Clerk, one Api test, and serving it locally the way the booking server does. Its code is a passing test, `packages/stack/src/tests/new-app.test.ts`.

Write your own `VISION.md`. Keep your code in `apps/` and `packages/`. Once your app runs, remove `examples/` and its roots from the workspace and thin configs.

## Layout

```text
apps/                        your apps (servers, web)
packages/
  rules/                     @house-rules/rules: ESLint, Biome, TypeScript and Dependency Cruiser presets and bins
  stack/                     @house-rules/stack: actor, access, auth and reusable domain modules
  domain-postgres/           @house-rules/domain-postgres (private spike): a Postgres Platform for Alchemy Domain
examples/booking/
  packages/domain/           booking reference model: bookings, payments and their rules
  apps/server/               hosts the model on Postgres (or in memory) on Node, on Cloudflare Durable Objects
docs/                        release and local registry guides
site/                        private Astro docs site
skills/house-rules/          agent guide router
tests/                       root wiring and fence tests
```

## The stack package

`@house-rules/stack` is the one framework package. Its door is `src/index.ts`: the core (actor, access, auth with Clerk, JWT and dev-token providers) by name, and the reusable modules as namespaces: `Comments`, `Contacts`, `Delivery`, `Notes`, `Notifications`, `Organisations`, `Projects`, `Relations` and `WorkItems`. An app spreads a module's block lists into its own model, as the stack's new-app test does:

```ts
export class Kitchen extends Domain.Model("Kitchen", {
  aggregates: [...Notes.aggregates, Recipe],
  views: [...Notes.views],
}) {}
```

Every client-sent command lists `middleware: [Session]`, rejects `Forbidden`, and starts its `decide` with `yield* requirePermission(...)`. `SessionLive` resolves the signed-in person through an `AuthProvider` slot and turns roles into permissions with `Roles`. Policies act as system actors with explicit grants. Effect runs the last listed middleware first, so a guard that reads the actor goes before `Session`: `[Guard, Session]`. See the [stack README](packages/stack/README.md), its [AGENTS.md](packages/stack/AGENTS.md) and [DESIGN.md](packages/stack/DESIGN.md), which maps every old house-rules concept to its replacement.

## The example

`examples/booking` shows a full app on the stack: a domain package that imports only `@alchemy.run/domain`, `effect` and `@house-rules/stack`, and a server that hosts it. Use it as a reference, then delete it.

## Checks and CI

```text
pnpm check -> pins -> environment -> Biome -> ESLint
           -> workspace typechecks -> Dependency Cruiser -> layout/cycles
pnpm test  -> root Node tests -> workspace tests
```

Warnings fail Biome and ESLint. All Dependency Cruiser rules have error severity. See the [rules table](packages/rules/README.md#rules-and-checks) for the checked rules and their limits.

CI installs the frozen lockfile, then runs check, test, packed-consumer and the site build. `pnpm run packed-consumer` packs rules and stack, installs them in a cold npm consumer, then loads and typechecks them; it needs the registry. `pnpm acceptance` clones committed HEAD into a temp folder and runs frozen install, check and test.

## Pins and environment

Pin every dependency exactly, including workspace pins. New dependencies and version changes need approval. Install scripts stay denied in `allowBuilds`; release-age exceptions also need approval.

Effect packages share version 4.1.2 and Alchemy packages 2.0.0-beta.85. A workspace with `@effect/platform-node` also declares `@effect/platform-node-shared` at the same version. TypeScript is 7.0.2; `@effect/tsgo` is 0.45.0. The ESLint parser still needs the TypeScript 6.0.3 package extension. Dependency Cruiser uses SWC and prints an expected `missing-typescript-transpiler` notice.

Declare every variable in `.env.schema`, without secrets. Store local secrets only in ignored `.env.local` or `.env.*.local` files. `pnpm env:check` validates values; `pnpm exec varlock run -- <cmd>` injects them.

## Review and the fence

Lefthook runs check then test before every commit. Pi's interceptor and `scripts/vcs-command-policy.mjs` block hook bypasses. `.agents/settings.json` holds the Claude-format hook, but Claude needs it in `.claude/settings.json` to load it. The fence is adapted from [rat-stack](https://github.com/joelhooks/rat-stack); [NOTICE](NOTICE) keeps the attribution and license.

Checks do not replace review. Review object access in aggregate state, system grants, and A/B access tests for every exposed agent tool. MCP stays read-only unless the owner approves writes.

## Releases

Two packages publish, only through `.github/workflows/publish.yml`: `@house-rules/rules` and `@house-rules/stack`. A release bumps a package and every workspace pin on it together, with approval. See [the release guide](docs/release.md) and, for trying changes in another app without npm, [the local registry guide](docs/local-registry.md).

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
