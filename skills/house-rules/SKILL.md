---
name: house-rules
description: Build an app on the house-rules framework. Load it to start an app, add a module or a use-case, expose it over HTTP or MCP, sign users in, mount comments, party or call-audit, add a browser client, or fix a failed check. It routes each job to the doc that owns it.
---

# House rules

This skill is a router. It does not re-explain the framework. Every framework package an app mounts ships its own `AGENTS.md` in its npm tarball, versioned with its code. Read that file for the job, not a copy of it here.

## What you get

| Part | Packages | Job |
| --- | --- | --- |
| Kits | `@house-rules/domain`, `@house-rules/application` | define a module; build contracts, gates and delivery on modules |
| Wiring | `@house-rules/migrations`, `@house-rules/node-host`, `@house-rules/rules` | run every module's SQL; serve the app on Node; check the rules |
| Additions | `@house-rules/comments`, `@house-rules/party`, `@house-rules/identity`, `@house-rules/call-audit`, `@house-rules/auth-jwt` | ready modules for comments, people and logins; plug-ins that audit calls and verify tokens |
| The app | `apps/<name>` | its own modules, use-cases, delivery and one composition root |

## Read first

1. `AGENTS.md` in your repo root. It is the law. It wins over this skill.
2. `CONTEXT.md`. Use its words as written.

## Router

A package guide is `node_modules/@house-rules/<pkg>/AGENTS.md` in an app. In the house-rules repo the same file is `packages/<pkg>/AGENTS.md`. Each package's `README.md` has the full API.

| I want to... | Read |
| --- | --- |
| Start an app | The checklist below, then `application` and `node-host` guides |
| Add a module (package) | `domain` guide, "Defining a module"; root `AGENTS.md`, "Inside a package" and "Modules own their data"; `migrations` guide |
| Add an action (use-case) | `application` guide: contract options, "Use-cases and tests". A write sets `transactional: true` on the contract, or calls `UnitOfWork.atomic(...)` in the handler around only the part that must be atomic (root `AGENTS.md`, "Modules own their data"). Object rules go in the module with `definePolicy` (`domain` guide) |
| Expose it over HTTP or MCP | `application` guide: delivery options, `route`, `tool`, `toFetchHandler`, `toMcpHandler`. Root `AGENTS.md`, "Agent adapters" |
| Mount a ready module | `comments` or `call-audit` guide: layer line, host ports, `migrations.json`, deletion hooks |
| Sign users in | `auth-jwt` guide for the token, then `identity` guide for the `Caller`, `FirstSignIn` and `migrations.json` |
| Keep the people an app knows | `party` guide: Person, `createPerson` in `FirstSignIn`, contracts and views |
| Add a browser client | `application` `README.md`, "Single-page apps" (not its `AGENTS.md`): a contract entry (`src/contract.ts`), `endpoint`, `toHttpClient`, `toOpenApi` |
| Serve a web page | `node-host` guide: `staticFiles` before the API handler, one origin (the default). `application` guide: the API list, `toPromiseClient`, and `cors` for a page on another origin. Root `AGENTS.md`, "Web delivery" |
| Fix a failed check | The rules table in `node_modules/@house-rules/rules/README.md` (`packages/rules/README.md` in the house-rules repo). Follow the row's Docs link; the doc is not always named after the rule id. Fix the code |

If your repo still has `examples/booking-platform`, it shows each part as working code. Do not depend on it.

## Start an app

1. [ ] Make `apps/<name>/` with its own `package.json` and `tsconfig.json`. Add each package with `pnpm --filter <name> add <package>`. Pins stay exact.
2. [ ] Put code in `src/delivery/`, `src/use-cases/`, `src/composition/`, and `src/server/` for background loops. Only `src/main.ts` and `src/index.ts` sit directly in `src/`.
3. [ ] In `src/composition/`, provide the module layers, the storage adapters of modules that have storage, one `UnitOfWork` adapter and any `Grant` that is the same for every request. Wrap them: `composition({ layer, caller, views })`. This folder imports packages only.
4. [ ] Write `views`. Every failure tag needs one, including tags the layer can fail with, such as a database that is down. A missing view fails `tsc` and names the tag.
5. [ ] Write the `caller`, or use `Identity.caller` from `@house-rules/identity`. It turns `{ headers, url }` into `CurrentActor` and `Grant`, or fails with `Refused`.
6. [ ] Write use-cases in `src/use-cases/`, and mount them in `src/delivery/` with `route(...)` and `toFetchHandler`, or with `toMcpHandler`.
7. [ ] In `src/main.ts`, call `serve(api, { port, onClose: () => api.dispose().then(() => app.dispose()), handleSignals: true })` from `@house-rules/node-host`. Dispose the fetch handler before the composition. Read `PORT` from Effect Config. Pass `origins` to `toFetchHandler` when a proxy sets the public origin.
8. [ ] For each module that has migrations, add an entry to `migrations.json` at the repo root: `{ "workspace": "packages/<name>" }` for your own, `{ "package": "@house-rules/<name>" }` for an installed one. Run `Migrations.script("migrations.json")` before the app starts.
9. [ ] Declare every environment variable in `.env.schema`. No secret values there.

## Prove it

1. [ ] `pnpm check` exits 0.
2. [ ] `pnpm test` exits 0.
3. [ ] Never weaken a rule, a hook or a pin. Never bypass a hook.
4. [ ] The list of changes that need the owner's yes is in `AGENTS.md`, "Safe vs needs approval". Read it before you add a dependency, a write tool or a public path.
