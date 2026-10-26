# Design reference

## Files and commands

Run from the repository root. `pnpm plan` is a root script. Inside an app folder that has its own `package.json`, pnpm answers `Command "plan" not found`. The root wrapper resolves relative paths from the folder where you typed the command, and absolute paths work too. So `"$D/plan.next.json"` under `/tmp` is fine.

| Command | Exit codes and output |
| --- | --- |
| `pnpm --silent plan validate <plan>` | 0 and `valid`; 1 with issue paths on stderr; 2 for wrong arguments, including `-o` or `--text` |
| `pnpm --silent plan view <plan> --text` | 0 and the text map on stdout; 1 for an invalid plan or a map JSON |
| `pnpm --silent plan view <plan> -o <file>` | 0 and `Wrote <file>` on stderr; 1 as above. Without `-o`, the HTML goes to stdout. `--text -o <file>` writes the text map. |
| `pnpm --silent plan diff <before> <after> --text` | 0 with a text diff, even when it lists changes; 1 if either side is invalid |
| `pnpm --silent plan diff <before> <after> -o <file>` | Same, as an HTML page |

`pnpm -s plan ...` exits 2 with this pnpm (`unexpected argument '-s'`); write `--silent`. Without it, pnpm adds `$ node scripts/plan.mjs ...` to stderr. On failure pnpm adds `[ELIFECYCLE] Command failed with exit code 1.` to stderr, with or without `--silent`. Stdout stays clean, so `> file` works either way.

Booking's map script is `scripts/map.mjs` in the app, run through `pnpm --filter @example/api run map -- <options>`. The [app README](../../examples/booking/apps/api/README.md) explains its options, and `--help` prints them. The script then exits 2, as `node examples/booking/apps/api/scripts/map.mjs --help` shows; the filtered pnpm command reports exit 1. `--diff` with no path uses the app's own `plan.json`. An explicit `--diff <path>` resolves from the folder where you typed the command, so pass the root-relative or absolute path.

## Choose the owner

Use the root [AGENTS.md](../../AGENTS.md), especially "Inside a module", "Modules own data; projections consume views", "Features, operations and execution" and "Kits, wiring and additions".

| Question | Home and reason |
| --- | --- |
| Does it own data, invariants, object access or a separate lifecycle? | A package module. Keep dependent children together when writes, SQL guards and deletion cascades share a boundary. Split by consistency, access and lifecycle, not nouns. |
| Is it one thing a module can do? | An operation owned by that module, with a browser-safe descriptor and a service-capturing binder. Storage answers facts; domain code owns policy. |
| Does a query need published-view SQL? | An optional app projection with read operations. No migrations. Exactly one static SELECT or WITH...SELECT over known views, filtered by person in SQL and tested for A/B privacy. SQL functions are banned, so AVG, COUNT and other aggregates cannot live there. Compute them in a module operation, or in a view the owning module publishes. If the grammar does not fit, keep reads in module operations or compose declared read-only operations in a read model. |
| Is it one thing the person or system can do in the app? | An exposed feature with operation edges, never calls to other features. Reuse goes through capability or process operations. Its handler never imports services or opens a unit. Both feature commands and read-model queries enter ways directly. Neither targets any entry point. |
| Does it fill a caller-owned socket or port? | A plug. Name who owns the port and test removal of the plug and its Layer.provide line. It must leave the rest building and passing. A package may own data as a module and separately supply a plug, such as Party's May. |

Ownership notes must name tables, published views, foreign ids, lifecycle and access checks. Plan has no fields for these. Do not use read models to bypass module data ownership, or plugs to hide domain work.

## Reuse before you build

Party, Identity and CallAudit are the default base of every app, as booking shows. Check this table before cutting a new module. In a consumer, read the installed package's AGENTS.md and README instead.

| Package | Kind | Covers | Operations |
| --- | --- | --- | --- |
| `@house-rules/party` | module, plus the May plug `Party.may()` | people, organisations, relationships, built-in and custom roles, assignments, invitations | 24, `PartyOperations` in its `contract.ts` |
| `@house-rules/identity` | module, plus the Who plug `Identity.who` | password and OIDC logins, login bindings, the `FirstSignIn` hook slot | 4, `IdentityOperations` |
| `@house-rules/comments` | module; needs a `CommentTargets` host port | flat plain-text comments on the app's own targets | 4, `CommentsOperations`, see its AGENTS.md |
| `@house-rules/call-audit` | Record plug `CallAudit.record` | one audit row per feature call, refusals included, with retention | none; booking reads it through its `audit-trail` projection |
| `@house-rules/auth-jwt` | Authenticator slot plug | JWT checks against a JSON Web Key Set | none |

No package owns notifications, outbound messages or contact details. Party stores no email. Identity's `accountByEmail` is a facade method for trusted tooling, not an operation, so a feature cannot reach it. Payments, calendars and slots are app modules; booking's `billing` is an example, not a reusable package.

Copy a mounted package's operations exactly, with permission and flags. For Party and Identity, copy the booking plan's `party` and `identity` modules; they list every operation. For the others, read the descriptors in the package source. This prints the names:

```sh
rg -o --no-filename 'defineOperation\(\s*"[^"]+"' -g '!**/tests/**' packages/party/src
```

If a package adds an operation later, the post-build diff lists it as added. Add it to the plan with the owner's approval.

## Patterns

**Pending approval.** Model "waiting for approval" as a role, not a new table. The first-sign-in hook assigns a low role such as `applicant` through a system edge to `Party.assignRole`. An `approve_member` feature calls `Party.assignRole` with the full role. Party lets a person assign a role only if they hold every permission it grants in that scope; `party:admin` alone is not enough. So the approving role must hold every permission of the role it grants. Invitations (`Party.createInvitation`, `Party.acceptInvitation`) are the invite-only alternative.

**Notifications and contact data.** Decide which module owns contact details. No package does today. The owning module owns an outbound port with a dev adapter that records messages and a real adapter chosen in `composition/modules.ts`. A real sender is usually a new dependency and env vars, so it needs owner approval. A sent message cannot be rolled back with the unit.

**Idempotent schedule items.** The selector returns an array of item inputs, one per unit of work, such as `{ personId, date }`. The item operation writes a claim row keyed by that input in the same unit. If the claim already exists, it does nothing. An outside send cannot join the unit. Sending before commit may repeat a message after a crash; sending after commit may lose one. Pick one and write it in `design-notes.md`.

**Time zones.** `clock` takes `timeZone: "UTC"` only. Turn "every morning at 7" into a UTC cron for one named zone, note the daylight-saving shift, and list the zone as an open choice. Per-person local times need the selector to filter by each person's zone, which a module must store.

**Permission on a system-only operation.** Give it a permission string, such as booking's `billing:expire`. Add that string to the system permission list and to no role, so no person-authority call can reach it without an explicit system edge (`asSystem`). Booking's `cancel_booking` reaches system-only `billing:refund` through `⚙ Billing.refund`. Use null only for an operation any caller may run, such as a read filtered to the caller in SQL.

**Hook slot keys and public starts.** A hook's `slot` is the slot service's key string in the owning package source: `rg -n '"@house-rules/identity/FirstSignIn"' packages/identity/src` finds Identity's. The package AGENTS.md names the slot tag, here `FirstSignIn`, but not the key string. Booking writes a public feature's start as `{ reason: "public sign_in", startedBy: "public sign_in" }`; follow `public <feature>`. A hook start uses `startedBy: "hook:<way>"`, a schedule start `schedule:<way>` and an event start `event:<way>`. Event handlers run as the system. Their causedBy input is the event author's identifier or null, never authority.

## Plan fields

Full schema: [application README, Validate a plan](../../packages/application/README.md#validate-a-plan). Plug rules: [Plugs](../../packages/application/README.md#plugs). In a consumer, read the installed package's README. This table is a writing aid, not a second specification.

| Section | Write |
| --- | --- |
| `modules[]` | `name`, unique `service`, `kind` package or projection (read-model is a legacy projection kind), optional `role` capability or process (default capability), `package` and `path`, nested `operations` |
| Operation | Unique callable `name`, explicit `permission` string or null; optional own `readOnly`, `transactional`, `destructive`, `needsApproval`, `edges` |
| `features[]` | Callable fields plus explicit `kind: "feature" | "read-model"`, optional `path`, `start`: person by default or `{ reason, startedBy }` |
| Edge | Operation name, or `{ target, reason }` targeting an operation for a system edge. Entry points never target entry points. No authored closures. |
| `ways[]` | `name`, `protocol`, `features`, optional `source`, `mean`: allow, no or elicitation. Network `path`, hook `slot`, schedule `clock: { cron, timeZone: "UTC" }`, event `on: [kinds]`. Event ways require exactly one system-start feature and explicit mean, normally no. HTTP-only `public`. |
| `plugs[]` | Optional `{ name, package?, fills, ways? }`. Who, Mean and hook fills name ways; May, Record and EventSource are app-level. |

Set `role: "process"` on a module that composes modules through operation edges, whether stateless or durable. Capabilities own their state, computation or outside effect and their rules. Capability operations never call process operations; validation names the offending edge path. Processes may call capabilities or other processes without cycles. Built mounts declare the same role in `map: { name, kind, role, package? }`. Text, HTML and Mermaid show process modules separately, and built-vs-plan diffs compare role.

For example, an event way is `{ "name": "notifications", "protocol": "event", "on": ["task_moved"], "features": ["notify_task_moved"], "mean": "no" }`. Its name equals the EventLog consumer name, and on kinds must match that consumer's kinds exactly at acquisition. The handler uses EventInput from application/contract, `{ event: fullStoredEnvelope, causedBy: actorIdOrNull }`. The kit's EventSource port is filled by EventLog.source beside its mount layer; declare that plug with fills EventSource and no ways. Source coverage and retry behavior need executable tests, not only plan validation. Retries run on the next source wake or periodic sweep at or after the retry deadline.

Flags default false and start defaults to person. Plan rejects unknown keys at every depth and names their path, so a stray `flags`, `closures`, `layers` or `permissions` key fails validation.

## Write new items

Copy the spelling of the nearest existing sibling. `path` and `source` are pass-through facts and `service` is any nonempty string. Validation accepts them, but the post-build diff compares them with the built map and flags a mismatch. In booking:

| New item | Spelling |
| --- | --- |
| Package module | `service: "@example/<pkg>/<Module>"`, `package: "@example/<pkg>"`, `path: "examples/booking/packages/<pkg>"` (root-relative) |
| Projection | Service identity stays stable; new path `src/projections/<kebab>` (app-relative), kind projection |
| Read model | kind read-model, path `src/read-models/<kebab>/index.ts`, defineReadModel with schemas and handler |
| Operation | `<Module>.<verb>`, permission `<module>:<action>` |
| Feature | snake_case name, `path: "src/features/<kebab>/index.ts"` |
| Way | HTTP and MCP `source: "src/ways-in/<way>/way.ts"`; hook `src/ways-in/hooks/<name>.ts`; schedule `src/ways-in/schedules/<name>.ts`; event `src/ways-in/events/<name>.ts` |

A new app in this repo lives in `apps/<app>` with package `@<scope>/<app>`; agree the scope with the owner, since booking's `@example` marks examples. Its modules are `packages/<pkg>` with package `@<scope>/<pkg>`. Module `path` is root-relative; feature, read-model and way paths are app-relative, as in booking.

Flags. Write each flag as the code will declare it. Operations: readOnly for reads, transactional for writes, destructive and needsApproval for hard-to-undo work. A defineReadModel query fixes its own readOnly true. Existing defineFeature reads stay feature-kind and still set readOnly true explicitly. The other three lift with OR from the graph, so a new feature may omit them. Booking's `sign_in`, `change_password` and other features declare `flags: { transactional: true }` in code, so its plan repeats it. Both forms are valid, and the diff cannot see a redundant OR flag.

## Fix PlanInvalid

`pnpm --silent plan validate <plan>` decodes the schema and validates the graph. Schema and JSON errors come before graph checks. Cheap graph checks report all their issues together, plug issues included. A cycle, runtime or way check then reports one issue, sometimes at path `plan`.

| Issue | Fix |
| --- | --- |
| Missing field, bad JSON, wrong shape or unknown key | Follow the schema path. Permissions are explicit strings or null. Flags sit directly on callables, never in a `flags` object. Remove snapshot-only keys. |
| Duplicate callable, service or way name | Give each callable and mount service a unique identity. Reference the existing callable instead of defining it twice. |
| Unresolved edge or way feature | Correct the exact name or add its real descriptor. Expose a feature, not an operation. |
| Blank system reason or startedBy | Write the actual reason and initiating hook, schedule or public entry. Do not use a fake reason to bypass person access. |
| Invalid public exposure | Keep public names in that HTTP way's features and give each a system start. MCP has no public list. |
| System way with person features or wrong count | Hook and event take one system feature. Schedule takes selector and item system features; the real selector returns an array of item inputs. Event ways name on kinds and have no network/public fields. |
| Edge targets a feature | Call the owning module's operation instead. Put shared sequences in a process operation. validatePlan names the exact edge path; Runtime/composition rejects the edge with GraphInvalid. |
| Capability calls process | Move the composition to a process module or feature. Keep the capability's own rules in the capability; do not relabel it just to pass. |
| Cycle | Remove the circular responsibility. Move shared work down to its owner rather than disguising the edge. |
| Conflicting or unknown plug fill | Correct its socket or hook slot and way names. Who needs network ways; May and Record take no ways. Mean and hook twins must match the derived plug exactly. One plug per socket per way or app. |
| Runtime or way error at `plan` | Read the full reason. Check protocol paths, exposures and starts against the package guide; rerun after each fix. |

A valid plan does not prove every required socket is filled. Review Who, May, Mean and Record as a separate census. Named plugs are declarations, not evidence of wiring.

## From a map to an editable plan

`plan diff` accepts map JSON as a side. It detects a map by the presence of both `layers` and `permissions`. `plan validate` and `plan view` reject map JSON. Keep the raw `current-map.json` and build a plan beside it:

1. Copy `modules` with service, kind, role, package, path and nested operations. A missing role means capability. Map operations carry all four of their own flags as top-level booleans. Keep the true ones and drop the false ones. Query graph validation trusts readOnly declarations; keep handler effects and SQL ownership in review.
2. Copy entry names, explicit kind, permissions, paths and edges. A map feature's `flags` object holds lifted values. Write `readOnly: true` where it is true. Read each entry's defineFeature/defineReadModel call for literal OR flags and write only those. Convert `{ kind: "system", reason, startedBy }` starts to `{ reason, startedBy }`; drop `"person"`.
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
node scripts/plan.mjs view plan.json --text
node scripts/plan.mjs view plan.json -o "$D/design.html"
node scripts/plan.mjs diff plan.json "$D/plan.next.json" -o "$D/change.html"
node scripts/plan.mjs diff plan.json "$D/plan.next.json" --text
```

The adapter uses the package main's compiled JavaScript. It needs no bin, source loader or extra dependency. Paths resolve from the working directory. A release without `view --text` exits 2 for it; read the HTML page instead. A diff exits 0 even when it lists changes, so read the text or assert `diffMaps(...).empty` in an app test.
