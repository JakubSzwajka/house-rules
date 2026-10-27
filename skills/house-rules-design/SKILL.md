---
name: house-rules-design
description: Design an app before building it on house rules. Use for "design an app", "plan a feature/module", "show me the design", "what would change", or "migrate this app to house rules". Produce a validated plan and HTML approval view, then prove the approved shape against the built map.
---

# House rules design

Turn the owner's brief into `plan.json`. Show the app's shape and stop for approval before building. For an extension, show what changes against the current map. Approval covers the named design. It does not cover dependencies, law changes, commits or publishing.

Read the target app's root `AGENTS.md`, `CONTEXT.md` and [house-rules skill](../house-rules/SKILL.md) first. The law wins. Party, Identity and CallAudit are the default base of every app, as in booking. [Reuse before you build](reference.md#reuse-before-you-build) lists each reusable package, what it covers and where its operation list lives. Read the guide (`packages/<name>/AGENTS.md` and README) of every package you reuse. Never invent an API for a mounted package.

## Files and commands

Run every command from the repository root. Set these once; the values below are for booking:

```sh
APP=@example/api                            # the app's package name, not a new dependency
PLAN=examples/booking/apps/api/plan.json    # root-relative path to the app's plan
D=/tmp/design-booking                       # scratch folder outside the repo
mkdir -p "$D"
```

A new app has no folder yet. Agree its name with the owner, set `PLAN="$D/plan.json"` and leave `APP` unset until flow A step 8 creates `apps/<name>`.

| File | Lives | Commit? |
| --- | --- | --- |
| `plan.json`, `design-notes.md` | `$D` while a new app is designed, then the app folder beside its `package.json` | yes, with the code, after commit approval |
| `plan.next.json`, `*.html`, `current-map.json` | `$D` | never |

Never write scratch files in the repo root. The commit tool stages by path, so stray files there become noise. `pnpm --silent` drops the `$ node ...` line pnpm prints to stderr; a failing command still ends with an `[ELIFECYCLE]` line there. Stdout stays clean either way; do not capture `2>&1`. Exit codes, path rules and the map script's options are in [Files and commands](reference.md#files-and-commands).

| Command | Does |
| --- | --- |
| `pnpm --silent plan validate "$PLAN"` | Decodes and validates a plan, prints `valid`. Exit 1 lists issue paths. |
| `pnpm --silent plan view "$PLAN" --text` | Validates, then prints the text map: ways with Mean, each feature's `needs` and `system needs`, modules, PLUGS and PERMISSIONS |
| `pnpm --silent plan view "$PLAN" -o "$D/design.html"` | Validates, then writes the approval page |
| `pnpm --silent plan diff <before> <after> --text` or `-o "$D/change.html"` | Validates both sides, then shows the change. Exit 0 even when it lists changes. |
| `pnpm --silent --filter "$APP" run map -- --json` | The built app's map, without running features |
| `pnpm --filter "$APP" run map -- --diff --text` | Built app against its own `plan.json` |

In an external consumer, use the [CLI adapter](reference.md#consumer-cli-before-a-bin-exists) where this skill says `pnpm plan`.

## Questions to ask

Ask in groups, and only what the brief and source cannot answer. [Patterns](reference.md#patterns) has worked answers for pending approval, notifications, idempotent items and time zones.

- People and access: who uses it, which roles and organisations exist, and which objects may each person see or change? Does anyone wait for approval before they may act? Is an agent acting as that person?
- Data and ownership: what data persists, which module owns it, and which views must it publish? What comes from another system? Where do contact details live? No package owns them today.
- Module cuts: which writes, access guards and deletion cascades must stay together? Which things have a separate lifecycle? Cut by consistency, access and lifecycle, not one module per noun.
- Ways in: which does the app need, an HTTP API, a page served with it, MCP for agents? Name each way's path.
- Background work: what runs on a schedule, hook or event way? Name the caller-owned hook slot, cron with selector and item, or event consumer with exact on kinds and one system-start handler. Cron is UTC only, so "every morning" needs a time-zone choice. What makes each item idempotent? No startup tick, catch-up or distributed lease exists. Mean: trusted provisioning and nightly maintenance use `Mean.allow`; every other system way uses `Mean.no` unless the owner approves otherwise. Raise every system way's Mean as an owner choice.
- Public access: what must work without identity? Name each public HTTP feature and its system-start reason. New public session paths need owner approval.
- Agents and MCP: which direct defineReadModel queries may a tool expose? Plan A/B actor tests. Writes, destructive tools, token scopes and owner-only tools need named owner approval.
- Approval: which actions are hard to undo? Which operations set `needsApproval`? Permission is not consent; an agent never approves its own action.
- Plugs: which Who on each network way, one app-level May from Party, explicit Mean on every way, and which Record? Name lower Authenticator, ActorResolver, Approval, CallWatch and hook slots separately. Check each plug's pull-out test.

Ask before writing the plan if the answer changes who may act, what is public, which module owns data or what runs without a person. If the owner cannot answer now, write your recommendation into the plan, mark it assumed in `design-notes.md` and list it under open choices. The STOP asks for each one.

## A. New design from a brief

1. [ ] Read the law and guides. Read the [booking plan](../../examples/booking/apps/api/plan.json) with its [map](../../examples/booking/apps/api/MAP.md) and [commands](../../examples/booking/apps/api/README.md). Booking shows package modules, read models, a first-sign-in hook, a nightly schedule, public HTTP features and read-only MCP. It is also the setup to copy at step 8.
2. [ ] Ask the questions above. Write `design-notes.md` beside the plan: answers and assumptions, proposed roles with their permissions, the system permission list, [Outside the plan](#outside-the-plan) items and open choices.
3. [ ] Write `plan.json` section by section with the [field reference](reference.md#plan-fields) and the [boundary rules](reference.md#choose-the-owner). For new names, paths and flags follow [Write new items](reference.md#write-new-items).
   - `modules`: package modules and projections with exact service keys and paths. Set `role: "process"` for composition through module operation edges; omitted role means capability. Capabilities never call processes; processes may call capabilities or other processes without cycles. List every operation under its owner. Copy a mounted package's operations exactly, including those no feature calls. Writes and object policy belong in operations.
   - `features`: each exposed entry with explicit kind feature or read-model, its path, permission (usually null), operation edges and system start if any. Queries use defineReadModel in read-models/<name>/index.ts, without an own readOnly flag, and a separate ReadModels registry. Do not plan legacy readOnly:true defineFeature authoring. Keep SQL/service projections in projections/. Entry points never call entry points; shared sequences belong in process operations.
   - `ways`: protocol, exposure, path, hook slot, UTC clock or event on kinds, and explicit Mean. Selector before item. Event plans take exactly one system-start feature in features; the builder uses singular feature.
   - `plugs`: Who, May and Record by name. Mean and hook plugs derive from ways. You may list them as booking does; a declared plug identical to a derived one merges.
4. [ ] Validate, then read and render:

   ```sh
   pnpm --silent plan validate "$PLAN"
   pnpm --silent plan view "$PLAN" --text
   pnpm --silent plan view "$PLAN" -o "$D/design.html"
   ```

   Fix every issue path and rerun until exit 0. See [PlanInvalid fixes](reference.md#fix-planinvalid). Do not remove an edge, approval flag or access rule just to pass.
5. [ ] Check the page. With headless Chromium, `chromium --headless --window-size=390,844 --screenshot="$D/phone.png" "file://$D/design.html"` shows the top of the page at phone width. Keyboard selection needs an interactive browser. Report what you checked and call the rest unchecked.
6. [ ] Send the owner the absolute HTML and plan paths with this message, in real names. Read `needs` and `system needs` from `plan view "$PLAN" --text`. Write "none" for an empty row. Aim for 20 to 30 lines: wrap a long row onto indented lines and leave detail in `design-notes.md`.

   ```text
   App: <app> (apps/<name>). Page render: <what you checked>
   Modules: <module> [<operations>]; mounted as is: <packages>; projections: <name> [<operations>]
   Features: <feature> -> <edges>; needs <person closure>; system needs <...>
   Ways in: <protocol name path> Mean <...> -> <features>; public: <names or none>
   Hooks: <slot> -> <feature>; schedules: <UTC cron> -> <selector>, <item>; idempotent by <...>
   Mean on system ways: <way> <allow | no> (<rule it follows, or the departure>)
   Plugs: Who <...>; May <...>; Record <...>
   Roles (proposal, outside the plan): <role>: <permissions>; system list: <permissions>
   Approval: <hard-to-undo work>
   Needs your yes: public paths <...>; dependencies <...>; env vars <...>
   Outside the plan: <... or none>
   Open choices: <n> <question> (recommend: <answer>)
   ```

7. [ ] STOP. Ask the owner to approve this design and its open choices. No implementation yet. If the owner changes the shape, update the plan and render again. A law exception stays blocked until the owner decides it separately. If the owner is unreachable, leave the message and files as they are and stop.
8. [ ] After approval, a new app gets its folder: create `apps/<name>` from the booking app's `package.json` scripts, `tsconfig.json`, `vitest.config.ts` and `scripts/map.mjs`, move `plan.json` and `design-notes.md` there, and set `APP` and `PLAN`. Build with [house-rules](../house-rules/SKILL.md) and the live package guides. Keep the map script's freshness test on the booking pattern: memory storage and a frozen clock.
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
2. [ ] Check [reuse](reference.md#reuse-before-you-build). Note which packages you rejected and why.
3. [ ] Copy the baseline with `cp "$PLAN" "$D/plan.next.json"` and edit only the change. Ask the questions above for the changed area. Do not quietly change existing capabilities. Add the change's [Outside the plan](#outside-the-plan) items to `design-notes.md`.
4. [ ] Validate and render the change:

   ```sh
   pnpm --silent plan validate "$D/plan.next.json"
   pnpm --silent plan diff "$PLAN" "$D/plan.next.json" --text
   pnpm --silent plan diff "$PLAN" "$D/plan.next.json" -o "$D/change.html"
   pnpm --silent plan view "$D/plan.next.json" --text
   pnpm --silent plan view "$D/plan.next.json" -o "$D/design-next.html"
   ```

5. [ ] Check both pages as in flow A step 5. Send the owner the absolute paths of `change.html` and `plan.next.json` with this message. Read `needs` and each way's Mean from `plan view --text`; the diff's PLUGS section names Mean changes. Same length guidance as flow A.

   ```text
   Change: <brief in one line>. Baseline matches the built app: <yes | unverified>
   Reuse checked: <module> (rejected: <why>)
   Modules and operations:
     + <module> (<package | projection>): <Op.name> <permission>, ...
     ~ <module>: + <Op.name> <permission>
   Features:
     + <feature> -> <edges>; needs <...>; system needs <...>; <flags>
   Ways and their features:
     ~ <way> (<path>, Mean <...>): + <feature>
   Schedules and hooks:
     + <way> <UTC cron | slot>, Mean <allow | no> (<rule or departure>): <selector> -> <item>; idempotent by <...>
   Plugs: <+ or - name fills socket>
   Roles (proposal, outside the plan): + <permission> to <roles>; system list + <...>
   Needs your yes: public paths <...>; dependencies <...>; env vars <...>
   Removed: <items>
   Outside the plan: <migrations, schema changes, ...>
   Open choices: <question> (recommend: <answer>)
   ```

6. [ ] STOP for explicit approval of the change. Rerender after any requested edit.
7. [ ] Build the approved change with [house-rules](../house-rules/SKILL.md), then compare:

   ```sh
   pnpm --filter "$APP" run map -- --diff "$D/plan.next.json" --text
   pnpm check
   pnpm test
   ```

   Require the no-changes line and exit 0 from both checks. A diff that lists changes is not acceptance.
8. [ ] Promote the candidate with `cp "$D/plan.next.json" "$PLAN"`, then prove it once more with `pnpm --filter "$APP" run map -- --diff --text`. Commit `plan.json` with the code only after commit approval, through the commit tool. Without approval, leave code and plan ready for review.

## Outside the plan

Plan has no field for these. Write each in `design-notes.md`, put it in the owner message, and add an open choice where the owner must decide.

- New or changed migrations and table columns, with backfill. Add new modules with migrations to `migrations.json`. Applied migrations are append-only.
- Changed schemas of existing operations, such as a new field on a returned record. The diff does not show them.
- Roles: which built-in role holds each permission, and the system permission list (`composition/access.ts` in booking). The owner message shows them as a proposal under Roles.
- First admin: who holds the first admin role, and how. Booking runs its `grant-admin` script.
- Published views, foreign ids, object policy and relation checks.
- Aggregates. Projection SQL allows no SQL functions, so an average or count lives in a module operation or a view its owning module publishes.
- New env vars for `.env.schema`, outbound adapters and new dependencies. Dependencies need owner approval.
- Time-zone config, and external side effects such as sent email that a unit rollback cannot undo.
- Endpoint paths and methods, page screens, wording overrides and test gates.

Never put secrets in either file.

## C. Rewrite a non-house-rules app

1. [ ] Inventory first, read-only. Inspect files, manifests, routes, services, SQL and migrations, auth, jobs, tests and deployment entry points. Do not start servers, run migrations or touch live data. Start the census with `git status --short` and `rg --files -g '!node_modules' -g '!dist' -g '!.git'`.
2. [ ] Write `inventory.md` with one row per capability and per route or entry: source paths, caller and admission, data owner, writes, unit boundary, errors and existing proof. Include scripts, hooks, schedules and clients. Mark source facts apart from runtime unknowns.
3. [ ] Write `mapping.md`: map each capability to feature, operation owner, way and plug. Admission becomes Who, not an exposed feature. Module invariants and object checks move into operations; one-off cross-operation order stays in features; shared sequences belong in process modules. Mark each row `clean`, `needs-split` or `unclear`. Account for every entry, or retire it with owner approval.
4. [ ] List law and compatibility questions in `design-notes.md` with options and a recommendation: identity and roles, credential continuity, public paths, tools and scopes, unit timing, error and URL changes, data moves and job delivery. Never assume Identity or call-audit replaces an existing provider or event stream. Never weaken a fence to fit the rewrite.
5. [ ] Use the [migration output pattern](migration.md). Write options A/B/C as separate plans only where trade-offs are real, plus a migration order with test gates and rollback limits.
6. [ ] To validate plans, the repo needs `@house-rules/application` with `runPlanCommand`. Installing it is a dependency change: ask the owner first, then add the [CLI adapter](reference.md#consumer-cli-before-a-bin-exists). Inside the house-rules repo, run `pnpm plan` from the repo root with each candidate's path instead.
7. [ ] Follow flow A steps 4 to 7 for each candidate, writing HTML to `$D/<option>.html`. Recommend one and STOP for approval. Build the chosen plan in gated slices, keeping migration history. Finish with flow A step 9.
