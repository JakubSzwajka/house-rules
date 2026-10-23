# Design reference

## Files and commands

Run from the repository root. `pnpm plan` is a root script. Inside an app folder that has its own `package.json`, pnpm answers `Command "plan" not found`. The root wrapper resolves relative paths from the folder where you typed the command, and absolute paths work too. So `"$D/plan.next.json"` under `/tmp` is fine.

| Command | Exit codes and output |
| --- | --- |
| `pnpm --silent plan validate <plan>` | 0 and `valid`; 1 with issue paths on stderr; 2 for wrong arguments, including `-o` or `--text` |
| `pnpm --silent plan view <plan> -o <file>` | 0 and `Wrote <file>` on stderr; 1 for an invalid plan or a map JSON |
| `pnpm --silent plan diff <before> <after> --text` | 0 with a text diff, even when it lists changes; 1 if either side is invalid |
| `pnpm --silent plan diff <before> <after> -o <file>` | Same, as an HTML page |

`pnpm -s plan ...` exits 2 with this pnpm (`unexpected argument '-s'`); write `--silent`. Without `--silent`, pnpm adds `$ node scripts/plan.mjs ...` and, on failure, `[ELIFECYCLE]` lines to stderr. Stdout stays clean, so `> file` works either way.

Booking's map script is `scripts/map.mjs` in the app, run through `pnpm --filter @example/api run map -- <options>`. `--help` prints its options and exits 2. The [app README](../../examples/booking/apps/api/README.md) explains them. `--diff` with no path uses the app's own `plan.json`. An explicit `--diff <path>` resolves from the folder where you typed the command, so pass the root-relative or absolute path.

## Choose the owner

Use the root [AGENTS.md](../../AGENTS.md), especially "Inside a module", "Modules own data; read models consume views", "Features, operations and execution" and "Kits, wiring and additions".

| Question | Home and reason |
| --- | --- |
| Does it own data, invariants, object access or a separate lifecycle? | A package module. Keep dependent children together when writes, SQL guards and deletion cascades share a boundary. Split by consistency, access and lifecycle, not nouns. |
| Is it one thing a module can do? | An operation owned by that module, with a browser-safe descriptor and a service-capturing binder. Storage answers facts; domain code owns policy. |
| Is it a screen query over published views? | An app read model with read operations. No migrations. Exactly one static SELECT or WITH...SELECT over known views, filtered by person in SQL and tested for A/B privacy. SQL functions are banned, so AVG, COUNT and other aggregates cannot live there. Compute them in a module operation, or in a view the owning module publishes. If the grammar does not fit, keep reads in module operations or compose them in a feature. |
| Is it one thing the person or system can do in the app? | A feature with declared edges. Its handler orders calls, never imports services or opens a unit. Only features enter ways. |
| Does it fill a caller-owned socket or port? | A plug. Name who owns the port and test removal of the plug and its Layer.provide line. It must leave the rest building and passing. A package may own data as a module and separately supply a plug, such as Party's May. |

Ownership notes must name tables, published views, foreign ids, lifecycle and access checks. Plan has no fields for these. Do not use read models to bypass module data ownership, or plugs to hide domain work.

## Plan fields

Full schema: [application README, Validate a plan](../../packages/application/README.md#validate-a-plan). Plug rules: [Plugs](../../packages/application/README.md#plugs). In a consumer, read the installed package's README. This table is a writing aid, not a second specification.

| Section | Write |
| --- | --- |
| `modules[]` | `name`, unique `service`, `kind` package or read-model, optional `package` and `path`, nested `operations` |
| Operation | Unique callable `name`, explicit `permission` string or null; optional own `readOnly`, `transactional`, `destructive`, `needsApproval`, `edges` |
| `features[]` | Callable fields plus optional `path`, `start`: person by default or `{ reason, startedBy }` |
| Edge | Callable name, or `{ target, reason }` for a system edge. No authored closures. |
| `ways[]` | `name`, `protocol`, `features`, optional `source`, `mean`: allow, no or elicitation. Network `path`, hook `slot`, schedule `clock: { cron, timeZone: "UTC" }`. HTTP-only `public`. |
| `plugs[]` | Optional `{ name, package?, fills, ways? }`. Who, Mean and hook fills name ways; May and Record are app-level. |

Flags default false and start defaults to person. Plan rejects unknown keys at every depth and names their path, so a stray `flags`, `closures`, `layers` or `permissions` key fails validation.

## Write new items

Copy the spelling of the nearest existing sibling. `path`, `source` and `service` are pass-through facts: validation accepts any string, but the post-build diff compares them with the built map and flags a mismatch. In booking:

| New item | Spelling |
| --- | --- |
| Package module | `service: "@example/<pkg>/<Module>"`, `package: "@example/<pkg>"`, `path: "examples/booking/packages/<pkg>"` (root-relative) |
| Read model | `service: "@example/api/read-models/<kebab>/<Pascal>"`, `package: "@example/api"`, `path: "src/read-models/<kebab>"` (app-relative) |
| Operation | `<Module>.<verb>`, permission `<module>:<action>` |
| Feature | snake_case name, `path: "src/features/<kebab>/index.ts"` |
| Way | HTTP and MCP `source: "src/ways-in/<way>/way.ts"`; hook `src/ways-in/hooks/<name>.ts`; schedule `src/ways-in/schedules/<name>.ts` |

Flags. Set an operation's own flags as its descriptor will declare them: readOnly for reads, transactional for writes, destructive and needsApproval for hard-to-undo work. A feature lifts flags across its graph. readOnly uses AND and includes the feature's own flag, so a read feature must set `readOnly: true` itself; without it the feature reads as a write. transactional, destructive and needsApproval use OR, so omit them on a feature unless its own `defineFeature` call declares them. The diff compares lifted feature flags: it catches a missing readOnly, but not a redundant OR flag. The descriptor in code is the source of truth.

## Fix PlanInvalid

`pnpm --silent plan validate <plan>` decodes the schema and validates the graph. Schema and JSON errors come before graph checks. Cheap graph checks report all their issues together, plug issues included. A cycle, runtime or way check then reports one issue, sometimes at path `plan`.

| Issue | Fix |
| --- | --- |
| Missing field, bad JSON, wrong shape or unknown key | Follow the schema path. Permissions are explicit strings or null. Flags sit directly on callables, never in a `flags` object. Remove snapshot-only keys. |
| Duplicate callable, service or way name | Give each callable and mount service a unique identity. Reference the existing callable instead of defining it twice. |
| Unresolved edge or way feature | Correct the exact name or add its real descriptor. Expose a feature, not an operation. |
| Blank system reason or startedBy | Write the actual reason and initiating hook, schedule or public entry. Do not use a fake reason to bypass person access. |
| Invalid public exposure | Keep public names in that HTTP way's features and give each a system start. MCP has no public list. |
| Hook or schedule with person features or wrong count | Hook takes one system feature. Schedule takes selector and item system features; the real selector returns an array of item inputs. |
| Cycle | Remove the circular responsibility. Move shared work down to its owner rather than disguising the edge. |
| Conflicting or unknown plug fill | Correct its socket or hook slot and way names. Who needs network ways; May and Record take no ways. Mean and hook twins must match the derived plug exactly. One plug per socket per way or app. |
| Runtime or way error at `plan` | Read the full reason. Check protocol paths, exposures and starts against the package guide; rerun after each fix. |

A valid plan does not prove every required socket is filled. Review Who, May, Mean and Record as a separate census. Named plugs are declarations, not evidence of wiring.

## From a map to an editable plan

`plan diff` accepts map JSON as a side. It detects a map by the presence of both `layers` and `permissions`. `plan validate` and `plan view` reject map JSON. Keep the raw `current-map.json` and build a plan beside it:

1. Copy `modules` with service, kind, package, path and nested operations. Map operations carry all four of their own flags as top-level booleans. Keep the true ones and drop the false ones.
2. Copy feature names, permissions, paths and edges. A map feature's `flags` object holds lifted values. Write `readOnly: true` where it is true. Read each feature's `defineFeature` call for literal OR flags and write only those. Convert `{ kind: "system", reason, startedBy }` starts to `{ reason, startedBy }`; drop `"person"`.
3. An edge record with no reason becomes its target name; one with a reason becomes `{ target, reason }`. Copy ways, sources, exposures and plugs. Map `mean` holds words: `allow` is allow, `deny approval` is no, `ask the human` is elicitation. Keep `public` only on HTTP ways that list features. Remove `layers`, `permissions`, feature `flags`, `closures` and `ways`, and edge and start `kind`; strict decoding rejects them.
4. Run `pnpm --silent plan validate <plan>`, then `pnpm --silent plan diff "$D/current-map.json" <plan> --text`. Require `No changes: both maps describe the same app.` before you edit a candidate.

The [booking plan](../../examples/booking/apps/api/plan.json) and [map guide](../../examples/booking/apps/api/README.md) are the worked pair.

## What the plan does not prove

The [application README limits](../../packages/application/README.md#validate-a-plan) define this boundary. Validation creates stub schemas, handlers, bindings and distinct endpoint paths. It proves the declared shape, not the executable app.

The real build and fence still catch bindings and mount layers, schemas and handlers; endpoint methods, paths, collisions, prefixes, statuses, session and CSRF placement; MCP hints and metadata paths, CORS, origins and body limits; hook slot providers and cron parsing; layout, browser-safe contracts, SQL ownership and other lint rules. A declaration cannot prove which plug is wired. Review the wiring and run the pull-out test.

An empty built-vs-plan diff proves equality of the mapped facts only. It compares operation flags from descriptors and lifted feature flags, not a feature's own declaration. Role grants, the system permission list, object policy, storage choices, unit behavior, job idempotency and external side effects still need review and tests. Require `pnpm check`, `pnpm test` and the design's named test gates. Never describe a validated plan as a working app.

## Consumer CLI before a bin exists

The installed `@house-rules/application` must export `runPlanCommand`; an older release may not. Read its matching README. Adding or upgrading the package is a dependency change and needs owner approval first. Once it is installed, save these five lines as repository-root `scripts/plan.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises";
import { runPlanCommand } from "@house-rules/application";
const result = await runPlanCommand(process.argv.slice(2), (file) => readFile(file, "utf8"));
if (result.output) await writeFile(result.output.path, result.output.content);
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;
```

Run from that consumer's root with its pinned Node version:

```sh
node scripts/plan.mjs validate plan.json
node scripts/plan.mjs view plan.json -o "$D/design.html"
node scripts/plan.mjs diff plan.json "$D/plan.next.json" -o "$D/change.html"
node scripts/plan.mjs diff plan.json "$D/plan.next.json" --text
```

The adapter uses the package main's compiled JavaScript. It needs no bin, source loader or extra dependency. Paths resolve from the working directory. A diff exits 0 even when it lists changes, so read the text or assert `diffMaps(...).empty` in an app test.
