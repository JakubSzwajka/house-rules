# Task 289 combined feedback, round 1 of 2

All initial builder, source-review and prover lanes are accepted and closed on passing authentic receipts. Acceptance means lane delivery, not whole-task readiness. No localhost batch or Trainer adoption has happened.

## Inputs

- Early shared contract review: `/home/kuba/.pi/agent/delegate/01a17c6d-86fc-71d6-badf-9e7394537183/shared-contract-fixed.md`.
- Final rule/docs review: `/home/kuba/.pi/agent/delegate/01a17c6d-86fc-71d6-badf-9e7394537183/framework-rule-review.md`.
- Booking review: `/home/kuba/.pi/agent/delegate/01a17c6d-86fc-71d6-badf-9e7394537183/booking-migration-review.md`.
- Independent proof: `/home/kuba/.pi/agent/proof/house-rules-stack/task-289-house-rules-stack/independent-framework-r0/F1-F4.md`.
- Parent deterministic suite: `/home/kuba/.pi/agent/proof/house-rules-stack/task-289-house-rules-stack/full-r0/{steps.tsv,check.log,test.log}`. Check 0; test 1; diff check 0. Test failure is site redirect for /rules/eslint/command-kind/. Turbo stopped at that failure; do not claim unexecuted packages passed.

## Shared rule and docs corrections

1. Fix recommended-only fail-open builder forms. Add named regression coverage for call/apply/bind/Reflect.apply, sequence callee, destructured namespace and dynamic import. Existing builder-style prohibitions may report these at the builder value reference, but command-kind must not depend on featuresConfig to reject the wrong command.
2. Reject options-level plain and quoted __proto__ keys that supply inherited readOnly:true, including .js/.mjs.
3. Close or explicitly demonstrate the safe existing fence for a production feature invoking a defineFeature wrapper imported from an exempt test/tooling source. Preserve legitimate kit/test/tooling exceptions themselves. No forged descriptor bypass and no optional preset dependency.
4. Handle real workspace roots outside packages/ and ESLint cwd inside src. Keep named foreign APIs and shadowed bindings clean. Test feature folder names test/tests without creating a policy hole; owning-src test exemptions are not permission for a production entry-point folder to bypass authoring.
5. Restore Trainer's two-rule wrong-kind assertion parity for both directions. Methods/diagnostics and lazy graph work are notes, not permission to weaken policy. Address useful low-risk notes or list them honestly.
6. Add the exact site/Caddyfile redirect for the new rule. Keep the existing redirect tests, no weakening.
7. Remove staged-authoring teaching from skills/house-rules/SKILL.md, skills/house-rules-design/{SKILL.md,reference.md}, docs/v2-migration-spec.md and other granted current v2 docs where relevant. Runtime compatibility may remain; authoring lint forbids it. Explain direct defineReadModel, no readOnly flag, separate ReadModels registry, projections distinct. Fix application README schedule reference to ReadModels.duePayments and migration instruction to remove readOnly. Clarify AGENTS runtime versus lint wording. Generate the existing rules page if source docs metadata changes. Do not change VISION.

## Booking corrections

1. BLOCKER: Framework panel imports/maps only Features and drops the ten migrated queries. Render all 29 entry points via Features plus ReadModels; show kind if it fits the existing panel. Add regression coverage for all 29 including my_profile with the web badge. Preserve existing UI behavior and wire names.
2. Add wrong-person refusal on a migrated query to the prove flow: Alice creates an organisation through the real command, Bob list_members for its id returns 404 without private data. Do not grant admin or widen MCP. Existing two MCP queries remain unchanged.
3. Update examples/booking/README.md wording for due_payments as a system-start read model.
4. Typecheck the new prove-host script explicitly with repo patterns. Tighten fileURLToPath/inside-worktree path handling noted by review if safe. No lint/TS gate weakening.

## Proof deviations and follow-up

Independent real HTTP/MCP run matched its documented subset and stopped listener 36375/PID399880 with exit0; post-stop ECONNREFUSED. F3 did not cover all aliases/computed/kit exceptions, and F2 did not exercise the full app preset. After fixes, repeat affected lint scenarios with transcripts for all new bypass regressions, recommended-only and valid full-app-preset query. Repeat migrated-query wrong-person flow and show UI panel regression through the focused test. No browser claim for the non-UI booking fixture.

The approved MCP scope is deliberate: migrated queries are HTTP-only except due_payments schedule, and existing show_booking proves the MCP query pipeline. Preserve exact exposure. Record this boundary, not a new migrated MCP tool.

## Process

This is one consolidated corrective brief, round 1 of 2 total. Same Sol builders get new disjoint lanes. Run focused checks and leave edits uncommitted for integration. Parent reruns deterministic full suite after this round and revisits affected review/proof. No new independent per-finding lanes. Any remaining correction after cross-repo adoption uses round 2; unresolved failures after that remain a local blocked delivery, not hidden waivers.
