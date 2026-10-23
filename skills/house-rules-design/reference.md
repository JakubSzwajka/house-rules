# Design reference

## Choose the owner

Use the root [AGENTS.md](../../AGENTS.md), especially "Inside a module", "Modules own data; read models consume views", "Features, operations and execution" and "Kits, wiring and additions".

| Question | Home and reason |
| --- | --- |
| Does it own data, invariants, object access or a separate lifecycle? | A package module. Keep dependent children together when writes, SQL guards and deletion cascades share a boundary. Split by consistency/access/lifecycle, not nouns. |
| Is it one thing a module can do? | An operation owned by that module, with a browser-safe descriptor and a service-capturing binder. Storage answers facts; domain code owns policy. |
| Is it a screen query over published views? | An app read model with read operations. No migrations. Exactly one static SELECT or WITH...SELECT over known views, filtered by person in SQL and tested for A/B privacy. If the grammar does not fit, keep reads in module operations or compose them in a feature. |
| Is it one thing the person or system can do in the app? | A feature with declared edges. Its handler orders calls, never imports services or opens a unit. Only features enter ways. |
| Does it fill a caller-owned socket or port? | A plug. Name who owns the port and test removal of the plug and its Layer.provide line. It must leave the rest building and passing. A package may own data as a module and separately supply a plug, such as Party's May. |

Ownership notes must name tables, published views, foreign ids, lifecycle and access checks. Plan does not have fields for these. Do not use read models to bypass module data ownership, or plugs to hide domain work.

## Fix PlanInvalid

`pnpm plan view plan.json -o design.html` decodes the schema and validates the graph. Exit 1 includes issue paths; exit 2 means wrong CLI arguments. Schema/JSON errors happen before PlanInvalid. Cheap graph checks report all their issues together. Later cycle/runtime/way checks may report one issue, sometimes at path `plan`.

| Issue | Fix |
| --- | --- |
| Missing field, bad JSON or wrong field shape | Follow the schema path. Permissions are explicit strings or null; flags sit directly on Plan callables, not inside a `flags` object. Snapshots and plans differ. |
| Duplicate callable, service or way name | Give each callable and mount service a unique identity. Reference the existing callable instead of defining it twice. |
| Unresolved edge or way feature | Correct the exact name or add its real descriptor. Expose a feature, not an operation. |
| Blank system reason or startedBy | Write the actual reason and initiating hook/schedule/public entry. Do not use a fake reason to bypass person access. |
| Invalid public exposure | Keep public names in that HTTP way's features and give each a system start. MCP has no public list. |
| Hook/schedule with person features or wrong feature count | Hook takes one system feature. Schedule takes selector and item system features; the real selector returns an array of item inputs. |
| Cycle | Remove the circular responsibility. Move shared work down to its owner rather than disguising the edge. |
| Conflicting or unknown plug fill | Correct its socket or hook slot and way names. Who requires network ways; May and Record forbid ways. Mean/hook derived twins must match exactly. Do not assign two plugs to one socket on one way or app. |
| Runtime/way error at `plan` | Read its full reason. Check protocol paths, exposures and starts against the package guide; rerun after each fix. |

A valid plan does not prove every required socket is filled. Review Who/May/Mean/Record as a separate census. Named plugs are declarations, not evidence of wiring.

## From a map to an editable plan

Map JSON is accepted by `plan diff` as a baseline, but `plan view` expects Plan. Preserve the raw `current-map.json`. Do not merely rename it to plan.json.

1. Copy `modules` with service, kind, package/path and their nested operations. Preserve exact names and service keys.
2. Copy callable permissions and declared edges. Read descriptors for each callable's own flags: the snapshot's feature `flags` are lifted, and mapped operations omit transactional/needsApproval. Do not flatten lifted flags and call them the original declaration. Put the source's own flags directly on Plan callables. Preserve starts; convert snapshot system-start data to Plan's `{ reason, startedBy }` form.
3. Copy feature paths, ways, sources, exposures and plugs using the compact Plan reference. Convert snapshot edge records to a plain target name when no reason is present, or `{ target, reason }` for system edges. Omit snapshot-only layers, closures, permissions catalogue, feature ways and edge kinds. Keep `public` only on HTTP ways.
4. Run `pnpm plan diff current-map.json plan.json --text`. Require `No changes: both maps describe the same app.` before editing `plan.next.json`. Recover missing source ownership from descriptors and literal source facts rather than guessing.

The [booking plan](../../examples/booking/apps/api/plan.json) and [map guide](../../examples/booking/apps/api/README.md) are the worked pair. Keep source path spelling stable: the diff includes these facts.

## What the plan does not prove

The [application README limits](../../packages/application/README.md#validate-a-plan) define this boundary. Validation creates stub schemas, handlers, bindings and distinct endpoint paths. It proves the declared shape, not the executable app.

The real build and fence still catch bindings and mount layers, schemas and handlers; endpoint methods, paths, collisions, prefixes, statuses, session/CSRF placement; MCP hints and metadata paths, CORS, origins and body limits; hook slot providers and actual cron parsing; layout, browser-safe contracts, SQL ownership and other lint rules. A declaration cannot prove which plug is wired. Review the actual wiring and run the pull-out test.

An empty built-vs-plan diff proves equality of the mapped facts only. In the current snapshot, operations omit transactional/needsApproval; feature flags are lifted rather than their original declarations. Inspect descriptors for those facts, especially for unused operations. Role grants, composition's system permission allowlist, object policy, storage choices, unit behavior, job idempotency and external side effects still need review and tests. Require both `pnpm check` and `pnpm test`, plus the design's named test gates. Never describe a validated plan as a working app.

## Consumer CLI before a bin exists

The installed application version must export `runPlanCommand`; do not assume an older release has it. Read its matching README. Dependency/version changes need owner approval. In a consumer that already has the API, save these five lines as repository-root `scripts/plan.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises";
import { runPlanCommand } from "@house-rules/application";
const result = await runPlanCommand(process.argv.slice(2), (file) => readFile(file, "utf8"));
if (result.output) await writeFile(result.output.path, result.output.content);
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode;
```

Run from that consumer's root, with its pinned Node version:

```sh
node scripts/plan.mjs view plan.json -o design.html
node scripts/plan.mjs diff plan.json plan.next.json -o change.html
node scripts/plan.mjs diff plan.json plan.next.json --text
```

This adapter uses the package main's compiled JavaScript and the existing filesystem. No bin, source loader or new dependency is needed. Paths resolve from the command's working directory. The repo's `pnpm plan` wrapper also supports invocation-directory paths. A successful diff exits 0 even when it lists changes, so inspect the text or assert `diffMaps(...).empty` in an app test.
