# Metadata repair acceptance

Use pinned Node 24.21.0 and pnpm 12.5.1 in the successor worktree. Save evidence outside git under `~/.pi/agent/proof/house-rules-stack/task-board-read-metadata-afk/`. No live app, credential or data change is needed.

| Step | Action | Expected |
| --- | --- | --- |
| M1 | Compare the public get, getForSystem, list and tree descriptors with their baseline metadata. | Same names, schemas, permissions, failures, empty edges and flags. System read stays system-only. |
| M2 | Lint physical direct read-model consumers through the public WorkItems contract, using recommended plus featuresConfig. | All four read edges resolve statically and lint clean. |
| M3 | Put tree below a declared read-only process operation and lint an exposed read model targeting it. | Transitive read-only proof passes; no wrapper or entry-to-entry edge. |
| M4 | Point a read model at WorkItems.create and at an unresolved edge. | Existing read-edge rule rejects both; no exemption or resolver change. |
| M5 | Build and pack the repaired package, then repeat M1-M4 against an isolated installed public-contract consumer. | Packed descriptor values and lint behavior match workspace results. Record exact tarball hash and resolved package path. |
| M6 | Parent runs full check/test and diff/source-stability checks. Review source independently. | Every exit is 0; no changes outside metadata, focused tests and note. |
| M7 | After normal-hook clean commit, publish the separately approved coherent localhost batch and verify artifacts. | All 21 exact versions/integrities share one new suffix; both previous batches remain. No current Trainer pin change. |

A prover runs direct lint/package/metadata commands, not tests or typecheck/full-check runners. The builder and parent own those checks. If the packed consumer needs a build, use the existing build/package helpers. Do not substitute copied private descriptors for the shipped public contract.
