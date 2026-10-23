---
name: house-rules-design
description: Design an app before building it on house rules. Use for "design an app", "plan a feature/module", "show me the design", "what would change", or "migrate this app to house rules". Produce a validated plan and HTML approval view, then prove the approved shape against the built map.
---

# House rules design

Turn the owner's brief into `plan.json`. Show the app's shape and stop for approval before building. For an extension, show what changes against the current map. Approval covers the named design. It does not cover dependencies, law changes, commits or publishing.

Read the target app's root `AGENTS.md`, `CONTEXT.md` and [house-rules skill](../house-rules/SKILL.md) first. The law wins. Read the package guides (`packages/<name>/AGENTS.md` and README) of every module you might reuse. Never invent an API for a mounted package.

## Files and commands

Run every command from the repository root. Set these once; the values below are for booking:

```sh
APP=@example/api                            # the app's package name, not a new dependency
PLAN=examples/booking/apps/api/plan.json    # root-relative path to the app's plan
D=/tmp/design-booking                       # scratch folder outside the repo
mkdir -p "$D"
```

| File | Lives | Commit? |
| --- | --- | --- |
| `plan.json`, `design-notes.md` | the app folder, beside its `package.json` | yes, with the code, after commit approval |
| `plan.next.json`, `*.html`, `current-map.json` | `$D` | never |

Never write scratch files in the repo root. The commit tool stages by path, so stray files there become noise. Use `pnpm --silent` to drop the `$ node ...` and `[ELIFECYCLE]` lines that pnpm prints to stderr. Stdout stays clean either way; do not capture `2>&1`. Exit codes, path rules and the map script's options are in [Files and commands](reference.md#files-and-commands).

| Command | Does |
| --- | --- |
| `pnpm --silent plan validate "$PLAN"` | Decodes and validates a plan, prints `valid`. Exit 1 lists issue paths. |
| `pnpm --silent plan view "$PLAN" -o "$D/design.html"` | Validates, then writes the approval page |
| `pnpm --silent plan diff <before> <after> --text` or `-o "$D/change.html"` | Validates both sides, then shows the change. Exit 0 even when it lists changes. |
| `pnpm --silent --filter "$APP" run map -- --json` | The built app's map, without running features |
| `pnpm --filter "$APP" run map -- --diff --text` | Built app against its own `plan.json` |

In an external consumer, use the [CLI adapter](reference.md#consumer-cli-before-a-bin-exists) where this skill says `pnpm plan`.

## Questions to ask

Ask in groups. Record answers, assumptions and open choices in `design-notes.md`. Ask only what the brief and source cannot answer.

- People and access: who uses it, which roles and organisations exist, and which objects may each person see or change? Is an agent acting as that person?
- Data and ownership: what data persists, which module owns it, and which views must it publish? What comes from another system?
- Module cuts: which writes, access guards and deletion cascades must stay together? Which things have a separate lifecycle? Cut by consistency, access and lifecycle, not one module per noun.
- Ways in: which does the app need, an HTTP API, a page served with it, MCP for agents? Name each way's path.
- Background work: what runs on a schedule or hook? Name the caller-owned hook slot, or UTC cron with selector and item. What makes each item idempotent? No startup tick, catch-up or distributed lease exists. Mean: trusted provisioning and nightly maintenance use `Mean.allow`; every other system way uses `Mean.no` unless the owner approves otherwise. Raise every system way's Mean as an owner choice, and flag any that departs from this rule.
- Public access: what must work without identity? Name each public HTTP feature and its system-start reason. New public session paths need owner approval.
- Agents and MCP: which read-only features may a tool expose? Plan A/B actor tests. Writes, destructive tools, token scopes and owner-only tools need named owner approval.
- Approval: which actions are hard to undo? Which operations set `needsApproval`? Permission is not consent; an agent never approves its own action.
- Plugs: which Who on each network way, one app-level May from Party, explicit Mean on every way, and which Record? Name lower Authenticator, ActorResolver, Approval, CallWatch and hook slots separately. Check each plug's pull-out test.

When the brief cannot answer a question, ask before writing the plan if the answer changes who may act, what is public, which module owns data or what runs without a person. Otherwise write your recommendation into the plan and list the question under open choices.

## A. New design from a brief

1. [ ] Read the law and guides. Inspect the workspace, existing modules and the [booking plan](../../examples/booking/apps/api/plan.json) with its [map](../../examples/booking/apps/api/MAP.md) and [commands](../../examples/booking/apps/api/README.md). Booking shows package modules, read models, a first-sign-in hook, a nightly schedule, public HTTP features and read-only MCP.
2. [ ] Ask the questions above.
3. [ ] Write `plan.json` section by section with the [field reference](reference.md#plan-fields) and the [boundary rules](reference.md#choose-the-owner). For new names, paths and flags follow [Write new items](reference.md#write-new-items).
   - `modules`: package modules and read models with exact service keys and paths. List every operation under its owner, including mounted operations no feature calls. Writes and object policy belong in operations.
   - `features`: each app action with its path, permission (usually null), edges and system start if any.
   - `ways`: protocol, exposure, path, hook slot or UTC clock, and explicit Mean. Selector before item.
   - `plugs`: Who, May and Record by name. Mean and hook fills derive from ways.
4. [ ] List what the plan cannot show, as in [Outside the plan](#outside-the-plan).
5. [ ] Validate, then render:

   ```sh
   pnpm --silent plan validate "$PLAN"
   pnpm --silent plan view "$PLAN" -o "$D/design.html"
   ```

   Fix every issue path and rerun until exit 0. See [PlanInvalid fixes](reference.md#fix-planinvalid). Do not remove an edge, approval flag or access rule just to pass.
6. [ ] Open the HTML if you have a browser. Check phone width and keyboard selection. Without a browser, say the render is unchecked. Give the owner the absolute HTML path and this list with real names:

   ```text
   App: <app>
   Modules: <module> [<operations>]; read models: <name> [<operations>]
   Features: <feature> -> <edges>; needs <person closure>; system needs <...>
   Ways in: <protocol name path> Mean <...> -> <features>; public: <names or none>
   Hooks: <slot> -> <feature>; schedules: <UTC cron> -> <selector>, <item>
   Plugs: Who <...>; May <...>; Record <...>
   Permissions: <permission> -> <roles that hold it>
   Approval: <hard-to-undo work>
   Outside the plan: <... or none>
   Open choices: <question> (recommend: <answer>), or none
   ```

   Closures come from the HTML: each feature shows "Needs" (person) and "System needs".
7. [ ] STOP. Ask the owner to approve this design and its open choices. No implementation yet. If the owner changes the shape, update the plan and render again. A law exception stays blocked until the owner decides it separately.
8. [ ] After approval, build with [house-rules](../house-rules/SKILL.md) and the live package guides. Add a map script and freshness test on the booking pattern: memory storage and a frozen clock.
9. [ ] Compare the built app with the approved plan, then run the fence:

   ```sh
   pnpm --filter "$APP" run map -- --diff --text
   pnpm check
   pnpm test
   ```

   Require `No changes: both maps describe the same app.` and exit 0 from both checks. Do not edit the approved plan to hide drift. Fix the build or ask approval for a new diff. Read [what the plan does not prove](reference.md#what-the-plan-does-not-prove) before calling the build ready.

## B. Extend an existing app

1. [ ] Read the law and guides. Prove the committed plan matches the built app:

   ```sh
   pnpm --silent --filter "$APP" run map -- --json > "$D/current-map.json"
   pnpm --silent plan diff "$D/current-map.json" "$PLAN" --text
   ```

   Require no changes. Stop on drift you cannot explain. If the app has no plan, [translate the map](reference.md#from-a-map-to-an-editable-plan). If the map script is missing, start from `plan.json` and mark the baseline unverified.
2. [ ] Check reuse. Read the guides of modules that might already do the job, and note which you rejected and why.
3. [ ] Copy the baseline and edit only the change:

   ```sh
   cp "$PLAN" "$D/plan.next.json"
   ```

   Ask the questions above for the changed area. Do not quietly change existing capabilities.
4. [ ] List what the plan cannot show, as in [Outside the plan](#outside-the-plan).
5. [ ] Validate and render the change:

   ```sh
   pnpm --silent plan validate "$D/plan.next.json"
   pnpm --silent plan diff "$PLAN" "$D/plan.next.json" --text
   pnpm --silent plan diff "$PLAN" "$D/plan.next.json" -o "$D/change.html"
   pnpm --silent plan view "$D/plan.next.json" -o "$D/design-next.html"
   ```

6. [ ] Check both pages as in flow A step 6. Send the owner the absolute paths of `change.html` and `plan.next.json`, with this message. Write "none" for an empty row.

   ```text
   Change: <brief in one line>. Baseline matches the built app: <yes | unverified>
   Reuse checked: <module> (rejected: <why>)
   Modules and operations:
     + <module> (<package | read-model>): <Op.name> <permission>, ...
     ~ <module>: + <Op.name> <permission>
   Features:
     + <feature> -> <edges>; needs <...>; system needs <...>; <flags>
   Ways and their features:
     ~ <way> (<path>, Mean <...>): + <feature>
   Schedules and hooks:
     + <way> <UTC cron | slot>, Mean <...>: <selector> -> <item>; idempotent by <...>
   Plugs: <+ or - name fills socket>
   Permissions: + <permission> held by <roles>
   Removed: <items>
   Outside the plan: <migrations, schema changes, role grants, ...>
   Open choices: <question> (recommend: <answer>)
   ```

   Read "needs" and "system needs" from the feature cards in `design-next.html`, or `change.html` for changed features. Read Mean from each way's `mean` in the plan; the diff's PLUGS section names Mean changes.
7. [ ] STOP for explicit approval of the change. Rerender after any requested edit.
8. [ ] Build the approved change with [house-rules](../house-rules/SKILL.md), then compare:

   ```sh
   pnpm --filter "$APP" run map -- --diff "$D/plan.next.json" --text
   pnpm check
   pnpm test
   ```

   Require the no-changes line and exit 0 from both checks. A diff that lists changes is not acceptance.
9. [ ] Promote the candidate and prove it once more:

   ```sh
   cp "$D/plan.next.json" "$PLAN"
   pnpm --filter "$APP" run map -- --diff --text
   ```

   Commit `plan.json` with the code only after commit approval, through the commit tool. Without approval, leave code and plan ready for review.

## Outside the plan

Plan has no field for these. Write each in `design-notes.md`, put it in the owner message under "Outside the plan", and add an open choice where the owner must decide.

- New or changed migrations and table columns, with backfill. Add new modules with migrations to `migrations.json`. Applied migrations are append-only.
- Changed schemas of existing operations, such as a new field on a returned record. The diff does not show them.
- Role grants: which built-in role holds each new permission (`composition/access.ts` in booking), and the system permission list there.
- Published views, foreign ids, object policy and relation checks.
- Aggregates. Read-model SQL allows no SQL functions, so an average or count lives in a module operation or a view its owning module publishes.
- Endpoint paths and methods, page screens, wording overrides and test gates.

Never put secrets in either file.

## C. Rewrite a non-house-rules app

1. [ ] Inventory first, read-only. Inspect files, manifests, routes, services, SQL and migrations, auth, jobs, tests and deployment entry points. Do not start servers, run migrations or touch live data. Start the census with:

   ```sh
   git status --short
   rg --files -g '!node_modules' -g '!dist' -g '!.git'
   ```

2. [ ] Write `inventory.md` with one row per capability and per route or entry: source paths, caller and admission, data owner, writes, unit boundary, errors and existing proof. Include scripts, hooks, schedules and clients. Mark source facts apart from runtime unknowns.
3. [ ] Write `mapping.md`: map each capability to feature, operation owner, way and plug. Admission becomes Who, not an exposed feature. Module invariants and object checks move into operations; cross-operation order stays in features. Mark each row `clean`, `needs-split` or `unclear`. Account for every entry, or retire it with owner approval.
4. [ ] List law and compatibility questions in `design-notes.md` with options and a recommendation: identity and roles, credential continuity, public paths, tools and scopes, unit timing, error and URL changes, data moves and job delivery. Never assume Identity or call-audit replaces an existing provider or event stream. Never weaken a fence to fit the rewrite.
5. [ ] Use the [migration output pattern](migration.md). Write options A/B/C as separate plans only where trade-offs are real, plus a migration order with test gates and rollback limits.
6. [ ] To validate plans, the repo needs `@house-rules/application` with `runPlanCommand`. Installing it is a dependency change: ask the owner first, then add the [CLI adapter](reference.md#consumer-cli-before-a-bin-exists). Inside the house-rules repo, run `pnpm plan` from the repo root with each candidate's path instead.
7. [ ] Follow flow A steps 4 to 7 for each candidate, writing HTML to `$D/<option>.html`. Recommend one and STOP for approval. Build the chosen plan in gated slices, keeping migration history. Finish with flow A step 9.
