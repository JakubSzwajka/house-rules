# Board dependency repair: literal WorkItems read metadata

Make the four published WorkItems read descriptors statically provable by the existing read-edge rule without changing their values or runtime behavior.

## Authority and boundary

Conductor authorized this separate preexisting library repair on 2026-10-27, message `97cb05bd-c9df-4ccd-acd4-eb8fea8ee5f8`. Branch `task/board-read-metadata-afk` starts at accepted clean `0ab41188557843514b34c10d5a01323e2d6038bf`. Worktree: `/home/kuba/.herdr/worktrees/house-rules-stack/task-board-read-metadata-afk`. Original task289 source and its immutable batch stay frozen. This is not a fourth command-kind correction cycle.

LOCAL ONLY. No bapp writes, main merge, push, PR, external publish, release or deployment. Preserve original checkouts, live services, data and all previous registry versions. No rule/resolver widening, bypass, dependency/tool/pin change, operation body or auth change. Stop on findings outside the four metadata equivalences.

## Source facts

Existing `read-entry-edges.mjs` calls `builderOptions(..., false)` and requires literal readOnly true. `builder-options.mjs` rejects spreads. WorkItems operations get, getForSystem, list and tree spread a shared literal read object. These source files were unchanged by task289. Board's seven exposed queries now reach that existing constraint after moving to direct read models. Exact external evidence: `/home/kuba/afk/2026-10-27-unified-express-clerk/board/review-entry-contract-deps.md` and `entry-lint-block.log`.

## Acceptance criteria

- Change only the four read descriptor declarations in `packages/work-items/src/work-item/operations.ts`, plus the now-unused shared read object if necessary. Inline all existing metadata. Adding literal readOnly beside a retained spread does not work.
- Preserve names, descriptions, schemas, permissions, failure variants, edges and flags. getForSystem keeps systemRead and its union failure directly, with no duplicate literal keys. No handlers, adapters, access rules, data or SQL change.
- Add focused public-door descriptor-equivalence coverage. Run existing WorkItems tests against the normal memory and namespaced Postgres setup.
- Physical workspace and packed/installed public-contract consumers accept all four read edges under recommended plus the features preset, including a transitive tree edge. A write-edge negative control still fails closed. No private imports or forged descriptors.
- Independent affected source review, physical/packed proof and parent deterministic full check/test pass before integration. Keep normal commit hooks enabled. A focused note describes the static metadata fix without claiming new runtime behavior.
- Only after a clean verified successor commit, publish at most one new coherent 21-package localhost development batch. Preserve both earlier batches. Record exact source/version/integrity before Board installation. Do not churn current task289 Trainer pins. Board and the separate Trainer auth successor may align later.

## Flow

See [MANUAL_TESTING.md](MANUAL_TESTING.md). Task289 Trainer remains an unaccepted source transfer with failed root verification and missing UI proof, not an app delivery. Its ownership follows Conductor's separate handoff decision.
