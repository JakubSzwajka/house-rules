# v2 decisions

The ledger of what the owner has decided about the v2 shape, and what is still open. The spike spec is `docs/v2-spec.md`. The built spike is `examples/booking-v2/`.

## Decided

1. **Move forward.** v2 replaces today's shape. No backward compatibility, no old stuff kept alongside.
2. **Names.** These words carry the model: node, edge, caller context, entry, socket, plug, way in, link, module, read module.
3. **Sockets.** A socket is a level above the Effect slots: a question every app answers. A plug answers it as one bundle.
4. **One node type.** Capability, feature and use-case merge into one node. A node's place is a folder, not a type.
5. **The graph is the feature registry.** It is generated from the code, and a PR shows its diff.
6. **A module is a boundary.** Your own modules are folders. Shared modules are packages.
7. **Misuse is stopped by visibility, not rules.** Other paths, such as a partner booking without payment, are legitimate.
8. **Read modules over published views.** They query the database directly, joining only views other modules publish. There is no second store.
9. **Caller context, not system nodes.** A call runs as a Person or as the System. A node switches to the system for one edge, with a reason.
10. **Two AGENTS.md rules change** together with their checks (see `TODO.md`).
11. **The spike** lives in `examples/booking-v2` on `task/accounts-example`. MCP stays read-only. The read-view exception applies to the spike only.
12. **Read unavailable.** Without `DATABASE_URL`, the read module answers 503 through a named port. It is not a memory adapter.

13. **Kit into the framework (K).** Nodes, edges, caller context, entries, closures, registry, sockets/plugs and step trace move into the framework kits. `implement` becomes node-aware. The `entryContract`/`entryHandler` wrapper, the synthetic `entry:<name>` permission and the `marker` field disappear.
14. **App nodes in the app (A, X).** A node rule replaces the use-case rule: `apps/<app>/src/nodes/` holds one node per file; nodes may call nodes without cycles; a way in exposes only nodes from that folder. The app-nodes package disappears.
15. **Modules as folders** inside `apps/<app>/src/modules/<name>/`, with the same boundary checks a package gets. Packages are for shared modules only.
16. **Read models (R).** The concept is "read model". One `read-models` folder, one read model per screen (`MyBookings`). The migrations check learns published views; a read model only SELECTs from published views, never a private table, never writes. The spike-only exception ends.
17. **Views (V).** Module errors declare a kind (`not_found`, `conflict`, `forbidden`, `unavailable`, `invalid`). The kit maps kind to status by default. Views move into each way in and hold only wording overrides. Kit and plugs map plumbing errors themselves.
18. **Grant scope (G).** A way in's closure check accepts only the entries that way in exposes.
19. **Destructive lifts (F)** from the graph to the entry, the way approval does.
20. **Caller-context details (P1)** stay as the spike built them: the system's own list, a required reason, system mode inherited downward, two closures.
21. **Law and docs** (`AGENTS.md`, `CONTEXT.md`, README, skill, site) are rewritten in v2 words, together with the checks that enforce them.
22. **One example.** `booking-v2` becomes the example: no `v2-` prefixes, no spike framing.
23. **Delete the old stuff (M).** Approved: `examples/booking-platform/` whole (owner's uncommitted web work backed up at `~/.local/state/v2-spike/backup-booking-platform-uncommitted/`), its two `migrations.json` entries, and `packages/rules/src/use-case-is-capability.mjs` with its tests. Further v1-only framework files are listed by exact path for the owner before deletion. `.pi/specs/*` stays as history.
24. **Breaking changes to the public npm packages** are approved; a new version will be released later, with the owner's yes at release time.
25. **Domain modules are packages again** (2026-10-19, replaces 6 and 15). Every domain module is a package, such as `examples/booking/packages/bookings` and `packages/billing`. A part that only makes sense inside one module is a subject folder in that package, not a module of its own. The app holds no `modules/` area, and the rules drop folder-module support: the `modules/` area, `folder` entries in `migrations.json`, and the folder-module door and cycle checks.
26. **App nodes live in `features/`** (2026-10-19). App nodes are the features, the old use-cases. Their folder is `apps/<app>/src/features/<name>/` with `node.ts`, `entry.ts` and `handler.ts`. `defineNode` and the word "node" stay as the technical name for one step in the graph.
27. **Read models stay in the app** (2026-10-19) at `apps/<app>/src/read-models/<name>/`. A read model is one SELECT over published views for one screen, so it is app code, not domain.
28. **Ways import contracts, not domain values** (2026-10-20). A file in `ways-in/` may import values only from the kits, `effect`, any package's `./contract` door, `features/`, `composition/` and its own way folder. From a package's main entry it may import types only. Plugs such as `Identity.who` are built in `composition/` and passed in. This restores the fence that folder modules had.
29. **`examples/rejected-shapes/` is removed** (2026-10-20). The rules' failing fixtures and the rules page cover each shape; the untested v1 snippets go.
30. **Prose and placement rows need no test** (2026-10-20). A reference VERIFICATION.md row that claims only prose (what a README says) or file placement (which file holds a wiring line) is N/A for acceptance item 3. `examples/booking/TESTS.md` lists each such row and where to look. Behavior rows still need an executable test.

## Open, needs the owner

| Id | Question | Leader's lean |
| --- | --- | --- |
| P2 | Who runs the gates: entry only, every node, or entry plus re-check | Entry plus re-check (the spike's default) |
| P4 | Data socket: does storage belong in a pure domain at all? | Pending, in `TODO.md` |
