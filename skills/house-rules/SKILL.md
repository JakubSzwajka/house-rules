---
name: house-rules
description: Build an app on house-rules. Load it to add capability or process modules, features, HTTP/MCP or system ways, event reactions, sign-in, additions or a browser client, or to fix a check. It routes each job to its package guide.
---

# House rules

Every framework package an app mounts ships its own `AGENTS.md`, versioned with its code. Read that guide for the job. This skill points to it; it does not copy the API.

Read the root `AGENTS.md` first. It is the law and wins over this skill. Then read `CONTEXT.md` and use its words.

## Find the guide

In an app, guides live at `node_modules/@house-rules/<pkg>/AGENTS.md`. In this repo, use `packages/<pkg>/AGENTS.md`. Each package's `README.md` gives more detail.

| Job | Read |
| --- | --- |
| Design or change an app's shape | [Processes and events](references/processes-and-events.md), then [house-rules-design](../house-rules-design/SKILL.md) for a plan, approval view and built-map proof. Declare module roles and show owner-approved system grants. |
| Start an app | The checklist below, then application and node-host guides |
| Add a domain module | [Processes and events](references/processes-and-events.md) for capability/process roles and dependency direction, then Domain guide, root law's "Inside a module" and "Modules own data; read models consume views", then migrations guide |
| Add a feature | [Processes and events](references/processes-and-events.md), then Application guide for `defineFeature` and tests. Every feature is exposed on a way. Keep one feature and handler in features/<name>/index.ts. Call operation edges only, never features or services. Set flags.transactional on writes, or inherit it from operations. Only the runtime and kit event driver open production units; handlers and modules never call `UnitOfWork.atomic`. Keep object policy in the module. |
| Expose HTTP or MCP | Application guide for `defineWay`, `endpoint` and `toFetchHandler`. Read root "Ways, web and agent access" before adding tools. |
| Record facts or handle events | [Processes and events](references/processes-and-events.md), then Application and EventLog guides. Read the producing module's guide, including WorkItems for explicit system reads. Do not build app wake/sweep driver features. |
| Mount a module or plug | The mounted package's guide for operations, binders, layers, ports and migrations. EventLog.source fills application-owned EventSource. |
| Sign users in | Auth-jwt guide for token checks, then Identity guide for `Identity.who`, ActorResolver and FirstSignIn |
| Add a browser client | Application README, "Shared endpoints and clients". Use contract doors and shared endpoint descriptors. |
| Serve a page | Node Host guide for `staticFiles`; application guide for CORS on a separate origin. Cookie writes still need CSRF. |
| Generate an app map | Application guide for appMap/renderMap, then rules README for literal source facts. The map script writes MAP.md; its freshness test compares without writing. |
| Fix a check | Rules README table, then the row's Docs link. Fix the code, not the rule. |

The kits are domain and application. Migrations, Node Host and rules are wiring. Comments, Party and Identity are modules; auth-jwt and call-audit supply plugs. A plug must pass the pull-out test. Removing it and its `Layer.provide` line leaves the rest building and passing.

`examples/booking/` shows the current shape. Read it, but never depend on it from a framework package.

## Start an app

1. [ ] Create `apps/<name>/` with a package manifest, its own tsconfig and typecheck/test scripts. Ask before adding dependencies. Keep exact pins and the repo's package manager.
2. [ ] Put one defineFeature with its handler in `src/features/<name>/index.ts`, plus tests/. Export only Features from `src/features/index.ts`. Put read models, ways and wiring in `src/read-models/`, `src/ways-in/` and `src/composition/`. Domain modules are packages, never app folders.
3. [ ] Import builders by name from their owning kit. Do not wrap, alias at runtime or re-export builders. A feature is its own entry. A reusable module exports <Module>Operations through ./contract using defineOperation, plus service-capturing binders using bindOperation. Read models publish read operations the same way. Only features enter HTTP, MCP, hook, schedule and event ways. Features never call features; a shared sequence is a process operation.
4. [ ] In composition, mount module layers, storage, one unit adapter, trace and record. Capture services and bind operations. Declare mount map roles and package identity. Acquire Runtime, then hooks that capture it, then scoped schedule and event drivers. Use `composition({ modules, features, ways, may, system })`.
5. [ ] Build Who/Mean plugs in composition and pass them to ways. Declare built-in roles and owner-approved system permissions in composition, mount Party with those roles, and plug Party.may() once at app level. Derive PermissionCatalogue from mounts before modules build; Runtime.permissions exposes the same catalogue. Ways carry no permission lists. MCP gets the person's roles and exposes read features only. Ways import values only from kits, effect, package contract doors, features, composition and their own folder. Other package main entries allow types only. The root receives ways from main; it never imports them.
6. [ ] Declare error kinds where errors are defined. Ways may override message text only. Keep driver details and other private values out of public messages.
7. [ ] In `src/main.ts`, pass `toFetchHandler(app)` to Node Host's `serve`. Dispose the router before the composition. Next already has a Host. Under host next, `src/app` is one way area; only Next convention files and files inside `_`-prefixed folders get the third-party npm allowance. Hooks, schedules and events use the kit's Effect-returning `runFeature` with captured services, never a second runtime or Who call.
8. [ ] List modules with migrations in root `migrations.json`, using workspace or package entries. Folder entries are rejected. Run the migration runner before startup. Read models select published views, filter by person in SQL and need an A/B privacy test.
9. [ ] Declare every variable in `.env.schema`, without secrets. Store local secret values only in ignored local env files.

## Prove it

Prove the role, event-kind coverage, system-only reads and causation boundaries listed in [Processes and events](references/processes-and-events.md). Run `pnpm check` and `pnpm test`; both must exit 0. Use `it.effect` or `it.layer` for Effect tests, not `Effect.run*` or `ManagedRuntime.make`. Test every exposed tool for A/B access under fake actors. Start with read-only MCP tools.

Never weaken a rule, pin or hook, and never bypass a hook. Root `AGENTS.md`, "Hooks and approval", lists acts that need the owner's yes. Read it before adding a dependency, a write tool or a public path.
