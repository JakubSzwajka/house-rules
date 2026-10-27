# Framework npm release

## Goal

Publish the accepted framework through its normal PR, CI and npm provenance workflow so Board and Trainer can install it on another machine.

## Authority and scope

The operator approved pushing and releasing through Conductor on 2026-10-27. Relayed approval `9b0c8627-a161-4dcc-8b14-1c22f15c47c8` covers this framework release PR with a merge commit after green CI, then one manual `publish.yml` run on main. Do not manually publish, bypass a credential gate or retry a failed publication without a decision.

The release starts at accepted `6c0dba02f88a4bcd700304b9029e18a1c53c81e9`, including command-kind policy, booking queries, WorkItems literal metadata, Express and the accepted unpublished ancestry. Remote main `40cddb3d18c5a288c60250a81b2cfda9a3786d58` is an ancestor. Preserve the old branches, worktrees, immutable local batches and proof.

## Version decision

Use rules 0.20.0 for the breaking authoring policy and application 0.3.0 for explicit query entry points. Express Host and Push Node receive their first 0.1.0 releases. Patch every other existing public package and move exact internal workspace and peer pins together. This publishes a complete 21-package cohort without reusing an already-published version. Keep external dependency versions and all supply-chain policies unchanged.

## Review constraint

Conductor approved an independent same-family Sol review in message `5c038c14-9dfa-4445-9f9c-8aea92deacb2`. No other-family route is available tonight because Claude's weekly quota is at 95%. Label this constraint in the PR and release record; do not describe it as cross-family review.

## Acceptance criteria

- All 21 public versions are new on npm, with exact compatible internal pins and unchanged external dependency versions.
- Node Host has a new version containing createNodeRequestHandler; Express depends on that exact version, never npm Node Host 0.2.0.
- Full check, test, packed consumer, booking build and site build pass. Review version/pin preparation and prove the cold packages.
- PR CI passes; merge with a merge commit, then run publish.yml on main once with publish=true.
- Verify all 21 exact npm versions, integrity, internal pins, provenance source commit and package tags. Send the actual version JSON to both app owner and Conductor only after verification.
- Missing npm create rights, approval or environment gates stop the release. No manual npm publication, token changes, relaxed policies or partial-cohort consumer handoff.

## Cleanup boundary

Keep Verdaccio running until the app owner confirms both apps install from npm. Stop only resources started for this release. Report exact cleanup candidates to Conductor; delete nothing without relayed approval. Application merging and the Board chat interface are tomorrow's scope.
