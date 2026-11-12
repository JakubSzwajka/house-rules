# @house-rules/stack design

One publishable package replaces the old kits (`domain`, `application`), the hosts and the plugs. The old reusable modules became copyable examples in `examples/modules`: an app copies a module into its own domain package and owns it, because a module's events are the app's stored data. Apps are built on **Alchemy Domain** (`@alchemy.run/domain` 2.0.0-beta.85). Where Alchemy and the old house-rules disagree, Alchemy wins. Where Alchemy is silent, the house-rules idea stays, in Alchemy's shape.

## What maps to what

| Old house-rules | Now |
| --- | --- |
| `defineFeature`, `defineOperation`, module facades and storage ports | `Domain.Command` decided by a `Domain.Aggregate` |
| `defineReadModel`, projections | `Domain.View` (one key), `Domain.Projection` plus a port (across keys) |
| EventLog, outbox, event ways | built in: events are the record; `Domain.Policy` reacts |
| schedule ways, timer loops | a policy schedules a command (`.schedule(ref, cmd, { after })`) |
| process modules, sagas | `Domain.Saga` |
| ways (HTTP, MCP), router | `Domain.Api` served with `@alchemy.run/domain/Http`, `/Ai` (MCP), `/Cli` |
| Who, identity, auth-jwt | `Session` middleware over the `AuthProvider` slot (Clerk, JWT, dev tokens) |
| May, Party.may, permission closures | `Roles` turns role names into permissions once per request; each `decide` and `validate` calls `requirePermission` |
| object policy inside modules | the aggregate's own state, checked in `decide` |
| `asSystem` | a policy or webhook provides `system(name, permissions)` as `CurrentActor` |
| Party, agent principals | `Agent` in `Actor`: its own `agent:` id, name and roles, working for one `Person` (`actingFor`); it signs in with its own token, is checked as itself, and its events record `for`, its person |
| Approval, Mean | dropped from the stack: an app gates an agent with its own rules |
| UnitOfWork, migrations, Postgres adapters | gone: one aggregate commits in one transaction; the platform stores events (on Node, `@house-rules/domain-postgres` in Postgres) |
| node-host, express-host | gone: `@house-rules/domain-postgres` or `Domain.InMemory` on Node, Cloudflare Durable Objects on Cloudflare |
| call-audit | events carry their author; Domain traces every command |

## Layout

```text
src/
  index.ts            the only public door; modules are namespace exports
  actor/              Actor, person(), system(), CurrentActor
  access/             Permission, can, requirePermission, Forbidden, Roles
  auth/               AuthProvider slot, Session middleware, SessionLive, providers
  target/             Target { kind, id } and targetKey, for blocks that attach to any app object
  delivery/           Email and Push external systems with memory and console adapters

examples/modules/packages/domain/src/
  <module>/           one folder per copyable module
    index.ts          the module's door
    <noun>.id.ts, <noun>.aggregate.ts, <verb>-<noun>.command.ts, <noun>.view.ts, <noun>.policy.ts, ...
    tests/*.test.ts
```

File names are kebab-case with Alchemy's kind suffix: `.id`, `.aggregate`, `.command`, `.event`, `.rejection`, `.view`, `.policy`, `.saga`, `.projection`, `.stream`, `.external`, `.context`, `.middleware`. A command file holds the command, the events only it records and the rejections only it returns. Shared events and rejections get their own file.

## The package door

`src/index.ts` exports the core by name and `Delivery` as a namespace: `import * as Delivery from "./delivery/index.ts"`, then `export { Delivery }`. Biome rejects `export * as`. The copyable modules follow the same pattern in `examples/modules/packages/domain/src/index.ts`.

## A module's door

A copyable module's `index.ts` exports:

- every block an app needs to compose or call: ids, aggregates, commands, events, rejections, views, policies;
- `<Module>Permissions`: a `const` object of the permission strings its commands check, `resource:action`;
- the block lists an app spreads into its `Domain.Model`, named `aggregates`, `views`, `policies`, `projections`, `streams`, `sagas` (only the kinds it has);
- `handlers`: one Layer with every policy, saga and projection implementation and every view `validate` Layer, if it has any;
- ports (`Context.Service`) and a memory implementation for each port, if a projection or external system needs one.

An app composes:

```ts
class App extends Domain.Model("App", {
  aggregates: [...Comments.aggregates, Booking],
  views: [...Comments.views, MyBookings],
}) {}
```

## Middleware order

Effect 4.1.2 runs a command's middleware list from the **last** entry to the first, the reverse of what Alchemy's beta.85 docs say. A guard that reads the actor goes before `Session`: `middleware: [OrgOnly, Session]`. `src/auth/tests/middleware-order.test.ts` pins this order, so it fails if Alchemy or Effect change it.

## Rules for every block

- Every command a client sends lists `middleware: [Session]` and `Forbidden` in `rejects`, and its `decide` starts with `yield* requirePermission(<Module>Permissions.x)`. Commands only policies send (system-only) still check a permission; the system actor holds it by explicit grant.
- Object access lives in the aggregate's state: owner, members, holders. Check it in `decide` after the permission. A wrong owner is its own rejection (`NotAuthor`, `NotMember`), usually with `httpApiStatus: 403`; use 404 where even existence must stay hidden, as `Organisations.NotMember` does. An agent passes an object check only as itself, by its own id; only a system actor skips the check (`actor._tag !== "System"`, never `actor._tag === "Person"`).
- Event tags are unique across every module an app composes, so module events carry a module prefix when the bare name is generic (`EdgeRelated`, `NotificationDelivered`, `OrganisationMemberAdded`).
- Events that record a change by someone carry `by: Schema.String` and `for: ActedFor`, from `...attributionOf(actor)`. `for` is the person an agent acted for, else `null`; it decodes as `null` from older events. A policy that passes a change on carries `by` and `for` through.
- Time comes from `decide`'s third argument `{ now }`. Never `Date.now()`, `Clock` or randomness in a model. Ids come from the caller (the command's target).
- `evolve` and `reply` are total and never fail.
- Views that hold anything private list `middleware: [Session]` and check access in `validate`.
- No storage ports, adapters, units, migrations or facades. If a module needs a store outside the model, it is a Projection plus a port with a memory implementation.
- No comments, except a one-line non-obvious why. Lint rejects doc comments. Document the module in `src/<module>/README.md`.
- Expected failures are rejections or tagged errors. Never `throw`, never global `Error`.

## Tests

Each module has `src/<module>/tests/*.test.ts` with `@effect/vitest` (`it.effect`, `it.live`), never `Effect.run*`:

- one test that `Domain.verify(Model)` is empty, for a test-local Model of the module;
- stories (`@alchemy.run/domain/Story`) for every command's happy path, every rejection, and each authorization case: holder of the permission, person without it, wrong owner or non-member, agent, system actor;
- every policy's reaction and every view's state after the events it folds;
- one Api test through `Session` and `devTokens` when the module has a client-facing command, so authentication and `Roles` are exercised end to end.

Tests assert behavior that matters. No tests of trivial constructors.

## Checks

Before reporting done, from the repo root with `export PATH=/opt/node24/bin:$PATH`:

```sh
pnpm exec biome check --write packages/stack/src/<module>
pnpm exec biome check --error-on-warnings packages/stack/src/<module>
pnpm exec eslint --max-warnings 0 packages/stack/src/<module>
pnpm --filter @house-rules/stack typecheck 2>&1 | grep "src/<module>/"   # must print nothing
pnpm --filter @house-rules/stack exec vitest run src/<module>
```

## Reference

- Alchemy Domain as installed (beta.85, the version we pin): `packages/stack/node_modules/@alchemy.run/domain/skills/alchemy-domain/SKILL.md`, its `references/*.md`, and `src/*.ts`. Newer docs on alchemy.run describe APIs this version lacks, such as `Domain.Query`.
- A working example of a guarded command, a Story and an Api test: `packages/stack/src/access/tests/require-permission.test.ts`.
- The old module you replace: `packages/<old>/README.md`, `AGENTS.md` and `src/`. Keep its business rules, drop its machinery.
