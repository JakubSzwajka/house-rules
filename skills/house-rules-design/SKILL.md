---
name: house-rules-design
description: Design an app before building it on house rules. Use for "design an app", "plan a feature/module", "show me the design", "what would change", or "migrate this app to house rules". Produce a validated plan and HTML approval view, then prove the approved shape against the built map.
---

# House rules design

Turn the owner's brief into `plan.json`. Show the app's shape and stop for approval before building. For an extension, show what changes against the current map. Approval covers the named design, not dependencies, law changes, commits or publishing.

Read the target app's root `AGENTS.md`, `CONTEXT.md` and [house-rules skill](../house-rules/SKILL.md) first. The law wins. Read the package guides before choosing existing operations or plugs. Never invent an API for a mounted package.

Commands below run from the target repository root. `APP` is the target app's actual package name, not a new dependency. The booking commands use `APP=@example/api`; replace it for another app. `plan.json` means the chosen app's design file; use its root-relative path if it lives beside the app. Keep generated HTML out of commits. In an external consumer, use the [CLI adapter](reference.md#consumer-cli-before-a-bin-exists) where this skill says `pnpm plan`.

## A. New design from a brief

1. [ ] Read the law and guides above. Inspect the workspace, existing modules and the [booking plan](../../examples/booking/apps/api/plan.json). Pair it with its [map](../../examples/booking/apps/api/MAP.md) and [commands](../../examples/booking/apps/api/README.md). It demonstrates package modules, read models, a first-sign-in hook, a nightly schedule, public HTTP features and read-only MCP.
2. [ ] Ask the questions below in groups. Record answers and unresolved choices in `design-notes.md`; label assumptions. Ask only questions the brief and source cannot answer.
   - People and access: who uses it, which roles and organisations exist, and which objects may each person see or change? Is an agent acting as that person?
   - Data and ownership: what data persists, which module owns it, and which views must it publish? What comes from another system?
   - Module cuts: which writes, access guards and deletion cascades must stay together? Which things have a separate lifecycle? Use consistency, access and lifecycle, not one module per noun.
   - Background work: what runs on a schedule or hook? Name the caller-owned hook slot, or UTC cron with selector and item. What makes each item idempotent? No startup tick, catch-up or distributed lease is promised.
   - Public access: what must work without identity? Name each public HTTP feature and its system-start reason. Nothing is public by accident; new public session paths need owner approval.
   - Agents and MCP: what read-only features may a tool expose? Plan A/B actor tests. Writes, destructive tools, token scopes and owner-only tools need named owner approval.
   - Approval: which actions are hard to undo? Which operations set `needsApproval`? Separate permission from consent; an agent never approves its own action.
   - Plugs: which Who on each network way, one app-level May from Party, explicit Mean on every way, and which Record? Identify lower Authenticator, ActorResolver, Approval, CallWatch and hook slots separately. Check each plug's pull-out test.
3. [ ] Write `plan.json` section by section, using the compact reference below and the [boundary rules](reference.md#choose-the-owner).
   - `modules`: name package modules and read models, exact service keys and paths. List operations under their owner, including existing mounted operations that no feature calls.
   - Operations: give every callable its real name and explicit permission or null. Set its own flags and declared edges. Put writes and object policy in modules, not feature handlers.
   - `features`: name each app action, its path, own flags, permission and edges. Most use null and inherit operation permissions. Record system starts with reason and startedBy.
   - `ways`: name protocols and feature exposure. Add path for HTTP/MCP, slot for a hook, or UTC clock for a schedule. List selector before item. Only HTTP may list public features.
   - `plugs`: declare Who, May and Record by name; Mean and hook fills derive from ways. List extensions here, not as extra feature folders.
   - Keep data ownership, role grants, system permissions, schemas, endpoint details and test gates in `design-notes.md` where Plan has no field. Never put secrets in either file.
4. [ ] Validate and render. There is no separate `plan validate` subcommand; `view` decodes Plan and calls `validatePlan` before rendering.

   ```sh
   pnpm plan view plan.json -o design.html
   ```

   Fix every issue path, then rerun until exit 0. See [PlanInvalid fixes](reference.md#fix-planinvalid). Do not remove an edge, approval flag or access rule just to pass validation.
5. [ ] Inspect the HTML, including phone width and keyboard selection. Present its path plus this short ASCII list with real names. Include permissions, system edges, public exposure and the choices Plan cannot show.

   ```text
   App layer: <app>
   Modules: <module> [<operations>]; read models: <name> [<operations>]
   Features: <feature> -> <declared targets>
   Ways in: <http/mcp name and path> -> <features>; public: <names or none>
   Hooks: <slot> -> <feature>; schedules: <UTC cron> -> <selector>, <item>
   Extensions/plugs: Who <...>; May <...>; Mean <... per way>; Record <...>
   Approval: <hard-to-undo work>; open choices: <... or none>
   ```

6. [ ] STOP. Ask the owner to approve this design and its explicit choices. No implementation yet. If the owner changes the shape, update the plan and render again. A law exception stays blocked until the owner decides it separately.
7. [ ] After approval, build with [house-rules](../house-rules/SKILL.md) and the live package guides. Build the map script and freshness test too, using the booking script as the pattern. Use reproducible map acquisition with memory storage and a frozen clock. Keep approved plans under version control, not generated HTML.
8. [ ] Compare the built app against the approved plan, then run the fence. For booking's script, an explicit path resolves from the directory where the command was typed:

   ```sh
   APP=@example/api
   pnpm --filter "$APP" run map -- --diff plan.json --text
   pnpm check
   pnpm test
   ```

   Require `No changes: both maps describe the same app.` and both checks exit 0. Diff exit 0 means valid inputs, not equality. Do not rewrite the approved plan to hide drift; fix the build or seek approval for a new diff. Review [limits](reference.md#what-the-plan-does-not-prove) before calling the build ready.

## B. Extend an existing app

1. [ ] Read the same law and guides. Get the current built map without running features. Use the app's reproducible map script, or start from its committed `plan.json` if acquisition is unavailable and mark that baseline unverified.

   ```sh
   APP=@example/api
   pnpm --silent --filter "$APP" run map -- --json > current-map.json
   pnpm plan diff current-map.json plan.json --text
   ```

   Require no changes before planning from an existing committed plan. If no plan exists, translate the snapshot into `plan.json` as [described here](reference.md#from-a-map-to-an-editable-plan), then run that same comparison. Map JSON is a diff input, not an editable Plan. Stop on unexplained baseline drift.
2. [ ] Copy the baseline, then edit only the proposed shape. Answer flow A's questions for the changed area. Identify new ownership, edges, exposure, system authority and plugs. Do not silently change existing capabilities.

   ```sh
   cp plan.json plan.next.json
   ```

3. [ ] Validate both sides and render the change in both formats:

   ```sh
   pnpm plan diff plan.json plan.next.json -o change.html
   pnpm plan diff plan.json plan.next.json --text
   ```

4. [ ] Present `change.html` and a short ASCII diff. Name added, removed and changed modules, operations, features, ways, plugs and permissions. Say "none" where a category did not change. Call out exposure and closure changes, public/system starts, schedules and hook slots. Include data migration and compatibility notes outside the plan.
5. [ ] STOP for explicit approval of the diff. This is the owner's view: new features here, new modules here, new operations here, these ways expose them, these extensions fill these sockets. Rerender after requested changes.
6. [ ] Build the approved diff using [house-rules](../house-rules/SKILL.md). Compare against the candidate before promoting it:

   ```sh
   pnpm --filter "$APP" run map -- --diff plan.next.json --text
   pnpm check
   pnpm test
   ```

   Require the no-changes message and exit 0 for check/test. A valid diff with changes is not acceptance.
7. [ ] Replace the committed plan with the approved candidate, then prove it once more:

   ```sh
   cp plan.next.json plan.json
   pnpm --filter "$APP" run map -- --diff plan.json --text
   ```

   Include `plan.json` alongside code in the same commit, only after separate commit approval and through the available commit tool. Do not commit HTML, raw snapshots or scratch candidates. Without commit approval, leave the matching code and plan ready for review.

## C. Rewrite a non-house-rules app

1. [ ] Inventory first, read-only. Inspect files, manifests, routes, services, SQL/migrations, auth, jobs, tests and deployment entry points. Do not start servers, run migrations or touch live data. Start the source census with:

   ```sh
   git status --short
   rg --files -g '!node_modules' -g '!dist' -g '!.git'
   ```

2. [ ] Write `inventory.md` with one row per capability and per route/entry, source paths, caller/admission, data owner, writes, unit boundary, errors and existing proof. Include scripts, hooks, schedules and clients, not only HTTP routes. Mark source facts separately from runtime unknowns.
3. [ ] Write `mapping.md`: map each capability/route to feature, operation owner, way and plug. Admission becomes Who, not an exposed feature. Move module invariants and object checks into operations; keep cross-operation ordering in features. Mark each row `clean`, `needs-split` or `unclear`. Account for every entry or explicitly retire it with owner approval.
4. [ ] List law and compatibility questions in `design-notes.md`, with options and a recommendation. Ask the owner about identity/roles, credential continuity, public paths, tools/scopes, unit timing, error/URL changes, data moves and job delivery guarantees. Never assume an existing auth provider or event stream is replaced by Identity or call-audit. Never weaken a fence to make the rewrite fit.
5. [ ] Use the [migration output pattern](migration.md). Produce options A/B/C as separate plans only where the trade-offs are real, plus a migration order with test gates and rollback limits. The board-app migration is an example of these artifacts, not a source of product facts or current law.
6. [ ] Follow flow A for each candidate, including its questions and exact `pnpm plan view plan.json -o design.html` command in the candidate's directory. Present options, recommend one, and STOP for approval. Build the selected plan in gated slices, preserving migration history. Finish with flow A's empty built-vs-plan diff, `pnpm check` and `pnpm test`.

## Compact Plan field reference

Full schema and validation: [application README, Validate a plan](../../packages/application/README.md#validate-a-plan). Plug rules: [Plugs](../../packages/application/README.md#plugs). In a consumer use the installed package's matching README. This table is a writing aid, not a second API specification.

| Section | Write |
| --- | --- |
| `modules[]` | `name`, unique `service`, `kind` package/read-model, optional `package`/`path`, nested `operations` |
| Operation | Unique callable `name`, explicit `permission` string or null; optional own `readOnly`, `transactional`, `destructive`, `needsApproval`, `edges` |
| `features[]` | Callable fields plus optional `path`, `start`: person by default or `{ reason, startedBy }` |
| Edge | Callable name, or `{ target, reason }` for a system edge. No authored closures. |
| `ways[]` | `name`, `protocol`, `features`, optional `source`, `mean`: allow/no/elicitation. Network `path`, hook `slot`, schedule `clock: { cron, timeZone: "UTC" }`. HTTP-only `public`. State Mean explicitly. |
| `plugs[]` | Optional list of `{ name, package?, fills, ways? }`. Who/Mean/hook fills name ways; May/Record are app-level. Lower slots follow the README. |

Flags default false and start defaults person. Feature flags lift across edges: readOnly uses AND; transactional, destructive and needsApproval use OR. Derive permissions and closures through validation. `path`/`source` are pass-through facts, so preserve the built map's spelling when extending an app.
