# CallWatch: one hook around every capability call

Asked by the owner on 2026-10-07: take the "Capability hook" item from `TODO.md`, build it in the framework, then use it in Trippy. Work in iterations: framework first, Trippy pinned to the local framework, both left uncommitted for the owner's review. After approval: release the framework, pin Trippy to the released commit (no code change), release Trippy.

## Outcome

1. `@house-rules/capability` 0.7.0 has a `CallWatch` slot. `implement` runs every call through `CallWatch.around(contract, input, run)`, where `run` is Grant → Approval → handler. So the hook sees every call on every surface, gate failures included.
2. With no `CallWatch` provided, nothing changes: the default passes the call through, and no capability gets a new requirement.
3. Trippy fills the slot with an audit cartridge: one structured log line per call in production, a memory log in tests.

## Decisions

1. C1. `CallWatch` is a `Context.Reference` with a pass-through default, as in rat-stack (`~/.local/state/house-rules-viz/rat-stack/packages/capability/src/call-watch.ts`). Additive, so 0.7.0 is a minor bump.
2. C2. The hook wraps the gates, not just the handler: a `Forbidden` or `ApprovalDenied` call is still a call worth seeing.
3. C3. Trippy's cartridge is its own package, `@trippy/audit`, pushed in with one `Layer.provide` line. Pull-out test: delete the package and that line, and Trippy still builds and passes.
4. C4. The audit line holds: capability name, permission, viewer id (read with `Effect.serviceOption(Viewer)`, so the hook adds no requirement), outcome (`success`, the failure `_tag`, `defect`, or `interrupted`), and duration in ms. It never logs input values: Trip names and notes are user data.
6. C6. (owner, 2026-10-07, after the first review) The log cartridge moves into the framework as `@house-rules/call-audit`: `CallAudit.layerLog({ who })` and `CallAudit.layerMemory`. The app passes `who`, an Effect that yields the caller id or null, because the framework does not know an app's `Viewer`. Trippy uses it and `@trippy/audit` goes away. The stored version (`layerTable`) comes after the many-module migration runner, in a later round.
5. C5. For review, Trippy points at the local framework checkout. At release time that becomes the GitHub commit SHA pin. The temporary local pin may fail the pins check; that is expected and must not be "fixed" by weakening the check.

## Acceptance

1. house-rules: `pnpm check` and `pnpm test` exit 0. Tests cover: the default passes through; a provided watch sees success, a handler failure, `Forbidden` and `ApprovalDenied`, with the contract and input.
2. Trippy: `pnpm test` exits 0, and `pnpm check` exits 0 except for the pins rule on the temporary local pin. A test shows one web call and one MCP tool call both land in the memory log.
3. The "Capability hook" item is gone from both `TODO.md` files.

## Non-goals

- A persistent audit table, an audit UI, or a devtools package like rat-stack's.
- Logging input values.
- Commit, push, PR or release before the owner approves.
