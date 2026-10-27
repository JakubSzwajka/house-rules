# Task 289 combined feedback, round 2 of 2

This is the final corrective brief. No publication or Trainer adoption has happened. Do not open serial per-finding correction lanes after this round.

## Collected results

- Parent `full-r1`: check 0, test 0, booking map diff 0, diff check 0, tracked and untracked source stability 0. Fifty Turbo tasks succeeded, zero cached. Booking: 69 tests in 35 files. Evidence: `/home/kuba/.pi/agent/proof/house-rules-stack/task-289-house-rules-stack/full-r1/`.
- Booking affected source review found no BLOCKER or SHOULD FIX. Notes remain on the source/dist relative-depth assumption and the pre-existing hardcoded MCP badges. Keep these as notes, not a new booking rewrite.
- Independent `independent-framework-r1/F1-F4.md` confirms actual default ERROR, clean direct query under default/full features preset, named indirect/prototype cases, real migrated-query Bob refusal and unchanged MCP catalogue. Its physical imported-wrapper case was not proved because the wrapper file did not exist. The fixture is stopped. Parent owns typecheck, which passed through regular check.
- Shared affected source review found earlier named cases fixed, plus the issues below. Full report: `/home/kuba/.pi/agent/delegate/01a17c6d-86fc-71d6-badf-9e7394537183/shared-r1-review.md`. These are source findings, not executed reproductions. The builder must add physical regressions that fail before the fix.

## Required shared corrections

1. Fix tooling scope when a repository sits below an ancestor named `src`. `command-kind.mjs:35-38` falls back to the absolute filename when the workspace-relative path has no src. Test a real consumer rooted below a src directory: top-level and app-level scripts stay exempt, real production src remains checked. Preserve actual cwd-inside-src and custom workspace-root coverage.
2. Detect defineFeature reachability rather than relying on whichever builder `builderOrigin` returns first. A wrapper in exempt tests/tooling may call both defineFeature and defineOperation. It must not resolve only to defineOperation and let production call it with readOnly true. Test both visitation/source orders with physical files.
3. Fence finished descriptors created in exempt tests/tooling and then used by production features/registries. A plain `export const forged = defineFeature(...readOnly:true...)` in an exempt source is currently not followed at its production reference. Cover src/tests and top-level scripts, plus re-exported descriptors. Keep legitimate standalone kit/test/tooling authoring exempt. Do not rely on Dependency Cruiser or featuresConfig to supply default-preset protection.
4. Close no-expression template-literal dynamic imports, CommonJS require/createRequire and TS import-equals builder loading in production. Reuse established source-graph/loader identity where possible. Cover .js/.mjs/.cjs/.ts/.cts as applicable, renamed/destructured builders, correct shadowed/foreign APIs and literal false/direct-query positives. No dynamic loader can hide a kit builder. Do not ban unrelated foreign APIs by name.
5. Keep current docs accurate about which indirect forms are forbidden. Explain existing conservative namespace/dynamic-import fencing if it also rejects non-builder application namespace value use. Do not solve policy holes by documenting optional preset reliance or authoring exceptions.

Address the low-risk ways-in folder named tests scope note in the same pass if it is a real production escape, with a regression that distinguishes a way named tests from a real test folder. Preserve established genuine kit/test/tooling exemptions and no global blanket suppression.

Performance and nested non-pnpm workspace-root priority are retained notes unless a small safe change is needed for correctness. Do not claim a benchmark. No runtime/schema edits, dependency/pin changes, test deletion, scope narrowing or hook weakening.

## Verification and follow-up

The same shared builder gets one new lane with the prior grants. Run focused actual recommended-only and packed-consumer regressions, including physical source graphs for mixed wrappers, finished descriptors and loaders. Keep both placement-rule assertion families, false/direct-query positives and all existing rules tests. Regenerate the existing rules page only through its generator if source metadata changes. Leave uncommitted for integration.

After acceptance the parent revisits affected shared source review, independent lint proof with real physical graph fixtures, and the deterministic full framework suite. There are no corrective rounds after this. Remaining acceptance failures mean a blocked local delivery. If green, commit with hooks and publish at most the one approved coherent localhost batch before Trainer's initial adoption. Trainer's initial adoption is still required, with no allowance to hide later failures.
