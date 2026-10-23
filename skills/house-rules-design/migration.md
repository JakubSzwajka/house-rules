# Migration output pattern

Use the board-app migration's output shape, not its product facts, counts, decisions or old framework versions. Its design index linked a source inventory, capability/entry mapping, alternative plans and a migration order with test gates. Its translation cookbook separated module rules from feature ordering and admission plugs.

## Artifact set

```text
migration-design/
  INDEX.md                     options, recommendation, open owner decisions
  inventory.md                 read-only source census with citations
  mapping.md                   every capability and entry -> target, status
  design-notes.md              ownership, compatibility, law questions, limits
  options/
    A-close-fit/plan.json       smallest compatible shape
    B-shared-additions/plan.json
    C-recut/plan.json           deeper boundary changes, only if justified
  MIGRATION-ORDER.md            slices, test gates, data/history/rollback limits
```

These option names describe possible axes, not a required recommendation. Do not produce three copies of the same design just to fill A/B/C. Each real option gets a validated plan and HTML view. Link generated HTML for review but do not commit it.

## Inventory and mapping

Use source path/line citations. Count entries separately from target ways: many routes can share one way. Keep read-only source findings separate from facts that would need a running app or database.

| Current capability or entry | Source | Caller/admission | Data and unit | Target feature / operation owner / way / plug | Status | Proof or question |
| --- | --- | --- | --- | --- | --- | --- |
| `<job>` | `<path:line>` | `<person/system/public>` | `<owner; writes; unit>` | `<names>` | `<clean/needs-split/unclear>` | `<existing test or missing choice>` |

`clean` means its responsibility has a clear home, not that code moves unchanged. `needs-split` means the current piece spans target responsibilities. `unclear` needs evidence or an owner decision. Map authentication/session resolution to Who, not an automatically public feature. A domain event stream is not the feature-start audit log.

For each rule or write inside a capability:

```text
Protects one module's data, access or invariant?
  yes -> operation in that package, explicit Actor, storage answers facts
  no  -> ordering across operations belongs in an app feature
Screen read across modules?
  static SELECT over published views fits -> read-model operation + feature
  grammar or remote data does not fit     -> module operations + feature
Credential admission?
  Who plug, with transport/session handling kept outside the feature
```

The plan cannot document all compatibility constraints. Record old and proposed URLs, status/code/body changes, credential continuity, role grants, transaction timing and background delivery guarantees in notes. An unsupported law requirement is a question for the owner, not a local lint exemption.

## Compare options

In `INDEX.md`, compare only axes with consequences: module cuts, screen reads, identity/roles and credentials, job drivers, deployable boundaries, migration cost and rollback floor. Label estimates as estimates. State a recommendation and what evidence would change it. List each law exception or dependency/release decision separately for owner approval.

From the target repo root, validate, render and compare candidate paths. Outside the house-rules repo, use `node scripts/plan.mjs` from the [CLI adapter](reference.md#consumer-cli-before-a-bin-exists) in place of `pnpm --silent plan`:

```sh
pnpm --silent plan validate migration-design/options/A-close-fit/plan.json
pnpm --silent plan view migration-design/options/A-close-fit/plan.json -o /tmp/option-a.html
pnpm --silent plan view migration-design/options/B-shared-additions/plan.json -o /tmp/option-b.html
pnpm --silent plan diff migration-design/options/A-close-fit/plan.json migration-design/options/B-shared-additions/plan.json --text
```

Run equivalent commands for C when it is a real option. A plan-vs-plan diff compares designs; it is not evidence that the old non-house-rules app has that shape.

## Migration order with test gates

Write each slice with prerequisites, exact commands for this app, expected output, rollback limit and the owner decision it needs. This is a starting order, not a license to change data:

1. Capture behavior with tests before moving code. Freeze access A/B cases, route/error contracts, credentials and job timing. Do not call missing tests green.
2. Prepare package contract doors, operation descriptors, binders and mounts. Test browser safety and graph closures. Keep migrations append-only and record adoption/history constraints before any schema change.
3. Move domain rules above fact-only storage ports. Require the same store suite against memory and real Postgres, no-unit failures and rollback tests. Test a failed second module write leaves the first unchanged.
4. Assemble features and ways, then Who/May/Mean/Record. Gate on actual admission, public exposure, MCP A/B access, session/CSRF behavior and refusal audit tests. Verify that the declared plugs match wiring and pass the pull-out test.
5. Install hooks and schedules with explicit Mean: `Mean.allow` for trusted provisioning and nightly maintenance, `Mean.no` for the rest unless the owner approves otherwise. Test fresh system context, idempotent items, failure continuation and scoped shutdown. Do not promise a startup tick, catch-up, external-effect rollback or distributed scheduling lease.
6. Run the approved plan against the built map. Require an empty diff, `pnpm check` and `pnpm test`, then any app-specific integration/build gates. An image rollback is not a database rollback; describe the earliest compatible image after each migration.

Return to the main skill's flow A for approval before implementation. Reopen approval when a slice changes the agreed shape or compatibility contract.
