# Agent instructions

This file is the law for agents and people working in this repo and projects made from its template. Read `VISION.md` for why and `CONTEXT.md` for the words. Vision does not override the law.

Apps are built on Alchemy Domain (`@alchemy.run/domain` 2.0.0-beta.85, Effect 4.1.2). Where Alchemy and older house-rules ideas disagree, Alchemy wins. House rules and tool presets live in `packages/rules` (`@house-rules/rules`); the root uses `workspace:0.21.0`. Keep consumer configs thin: extend presets and set project values, never copy a preset.

## Commands

Use the Node version in `.nvmrc` and the exact pnpm version in `package.json` (Corepack selects it). Never add a second lockfile.

| Command | What it does |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install, patch tsc with `effect-tsgo patch`, install lefthook |
| `pnpm check` | Exact pins, environment, Biome, ESLint, workspace typechecks, Dependency Cruiser, package and folder cycles |
| `pnpm test` | Root Node tests, then workspace tests through Turborepo |
| `pnpm env:check` | Validate `.env.schema` with Varlock |
| `pnpm db:up` / `pnpm db:down` | Start / stop the local Postgres (docker compose, `127.0.0.1:55432`) that tests and the booking server use |
| `pnpm fix` / `pnpm format` | Rewrite files with safe lint fixes / formatting only |
| `pnpm build` | Build `@house-rules/stack` to dist for packing; the workspace still reads src |
| `pnpm run packed-consumer` | Pack rules, stack and domain-postgres, install them in a cold npm consumer, load and typecheck them; needs the registry |
| `pnpm run local-publish` | Publish rules, stack and domain-postgres as `-local` prereleases to the local Verdaccio ([docs/local-registry.md](docs/local-registry.md)); never npm |
| `pnpm acceptance` | Clone HEAD into a temp folder and run frozen install, check and test |
| `pnpm vendor:agent-sources` | Clone the pinned Effect source into `.agent_sources/` |
| `pnpm --filter @house-rules/site generate` | Regenerate the rules page |

CI runs frozen install, `pnpm check`, `pnpm test`, `pnpm run packed-consumer` and the site build, with a Postgres service. Tests that host a model run on real Postgres through `platformForTests` from `@house-rules/domain-postgres`, one schema per test; run `pnpm db:up` first. `DOMAIN_STORE=memory` runs them on `Domain.InMemory` instead. Before calling work ready, `pnpm check` and `pnpm test` must both exit 0. Warnings fail Biome and ESLint; every Dependency Cruiser rule is an error. The rules table in `packages/rules/README.md` is the checked-rule source; do not copy it here.

## The package and its door

- One framework package: `@house-rules/stack` in `packages/stack`. `@house-rules/domain-postgres` (`packages/domain-postgres`) is a Postgres `Platform` for Alchemy Domain, kept separate so it can be deleted when Alchemy ships its own. Each package's only door is `src/index.ts` (`.`); reusable modules are namespace exports from it. No subpaths, no deep imports. `publishConfig.exports` points at dist.
- [packages/stack/DESIGN.md](packages/stack/DESIGN.md) maps every old concept to its replacement and holds the block rules. [packages/stack/AGENTS.md](packages/stack/AGENTS.md) documents mounting, wiring and fixed rules; it ships in the package. Keep both in step with the code.
- Three public packages publish only through `.github/workflows/publish.yml`: `@house-rules/rules`, `@house-rules/stack` and `@house-rules/domain-postgres`. Never publish by hand. A release bumps a package and every workspace pin together, with approval. Tags come only from `pnpm-publish-summary.json`.
- `packages/rules` stays: other apps consume its published versions. Change it only when strictly needed.
- Apps live in `apps/<name>`, shared packages in `packages/<name>`. The example lives in `examples/booking`: a domain package (`packages/domain`) and a server (`apps/server`). New projects remove examples. Packages never import examples or apps; apps never import other apps. Import packages by name with an exact `workspace:<version>` pin. No import cycles.
- No file or folder named utils, helpers or misc.

## Alchemy Domain rules

- A command is decided by its aggregate. `decide` is pure, or an `Effect.fn` that reads only what its middleware provides. `evolve` and `reply` are total and never fail.
- Every client-sent command lists `middleware: [Session]` and `Forbidden` in `rejects`; its `decide` starts with `yield* requirePermission(<Module>Permissions.x)`. Permissions are `resource:action` strings. `Roles` resolves role names to permissions once per request; roles never reach a `decide`.
- Effect 4.1.2 runs a command's middleware from the last entry to the first, the reverse of Alchemy's beta.85 docs. A guard that reads the actor goes before `Session`: `middleware: [Guard, Session]`.
- Event tags are unique across every module an app composes; prefix generic names (`EdgeRelated`, `NotificationDelivered`).
- Object access (owner, member, holder) lives in the aggregate's state and is checked after the permission, with its own rejection (`httpApiStatus: 403`).
- Views that hold anything private list `middleware: [Session]` and authorize in `validate`.
- Policies and webhooks have no session. They act as a system actor, `system(name, permissions)` provided as `CurrentActor`, holding only explicitly granted permissions. Every system grant is an owner decision. A system actor never borrows the author's roles.
- Events that record a change by someone carry `by: authorOf(actor)`. Time comes from `decide`'s `{ now }`; ids come from the caller. Never `Date.now()`, `Clock` or randomness in a model.
- No storage ports, adapters, units of work, migrations or facades. The platform stores events; one aggregate commits in one transaction. A store outside the model is a Projection plus a port with a memory implementation.
- Rules spanning aggregates get their own aggregate or a policy/saga, never a cross-aggregate transaction.
- Expected failures are rejections or tagged errors. Never `throw`, never global `Error`.
- Files are kebab-case with Alchemy's kind suffix (`.id`, `.aggregate`, `.command`, `.rejection`, `.view`, `.policy`, `.saga`, `.projection`, `.stream`, `.external`, `.context`, `.middleware`). A domain package imports only `@alchemy.run/domain`, `effect` and `@house-rules/stack`; hosting, Cloudflare and auth providers belong to the server.
- Hosting: `@house-rules/domain-postgres` on Node with Postgres, `Domain.InMemory` when `DOMAIN_STORE=memory` or in stories, Cloudflare Durable Objects on Cloudflare. The Postgres platform has no projections, streams, sagas or backfill and runs one replica per schema; see its README. Clients and agents reach the model only through a `Domain.Api` served with `@alchemy.run/domain/Http`, `/Ai` (MCP) or `/Cli`.

Before editing, read Alchemy's installed skill (`packages/stack/node_modules/@alchemy.run/domain/skills/alchemy-domain/SKILL.md` and its references) and the installed `effect/AGENTS.md` and `ai-docs`. Trust the pinned versions over memory and over newer docs on alchemy.run.

## Tests

- Tests sit in a `tests/` folder beside the code they test and use `@effect/vitest` (`it.effect`, `it.live`). Never `Effect.run*` or `ManagedRuntime.make` in tests.
- Each model has a test that `Domain.verify(Model)` is empty. Stories (`@alchemy.run/domain/Story`) cover every command's happy path, every rejection, and each authorization case: permission holder, person without it, wrong owner or non-member, agent, system actor. Every policy reaction and every view's state after the events it folds is tested.
- A client-facing module has one Api test through `SessionLive`, `devTokens` and `Roles`, so authentication runs end to end.
- An agent is its own party: it signs in with its own token, holds its own roles and passes object checks only as itself. Every exposed MCP tool needs an A/B access test.

## Comments and docs

No comments except a one-line non-obvious why; lint rejects doc comments. Document a module in its `README.md`. The docs site (`site/`) explains; this file is law. Ask before adding a site page. Generate the rules page from the plugin README and ESLint meta in the same change; never edit generated output by hand.

## Environment and pins

- Declare every variable code reads in `.env.schema`, without secrets. Secrets live only in `.env.local` or `.env.*.local`, never committed. Varlock and Turbo telemetry stay off.
- Every dependency is exact, including `workspace:<exact>`. Git dependencies pin a full 40-character SHA. Pin all Effect runtime packages together, including `@effect/platform-node-shared` wherever `@effect/platform-node` is installed; `@effect/tsgo` versions separately. Pin Alchemy packages together.
- Keep `saveExact`, `saveWorkspaceProtocol`, `minimumReleaseAge: 1440` and `allowBuilds: false` for every install script. New install scripts must be listed before installing. Never force install, shamefully-hoist, `nodeLinker: hoisted` or broad `publicHoistPattern`. Keep the rules plugin's TypeScript 6.0.3 `packageExtensions` entry.
- Never lower Effect diagnostics below error or override the Effect plugins block.

## Hooks and approval

Lefthook runs check then test before every commit. Fix failures; never bypass or weaken hooks. Never `git --no-verify`, `git commit -n`, `LEFTHOOK=0` or change `core.hooksPath`. Pi's git interceptor and `scripts/vcs-command-policy.mjs` enforce this. `.agents/settings.json` carries the Claude-format hook.

Safe without asking: code and docs edits that keep check and test green, new or tighter tests and rules, declared environment variables, and read-only MCP tools over existing reads with tests.

Ask the owner before: dependencies or runtime/tool version changes; MCP/OAuth dependencies; write or destructive tools or scopes; new public paths; system permission grants; release-age exclusions or `allowBuilds: true`; narrowing lint scope or weakening any thin config, CI, preset or hook; removing the TypeScript package extension; deleting tests; changing secret handling or `VISION.md`; committing, pushing or writing outside this repo. Never publish by hand.
