# Booking behavior proofs

The read-only spike reference is stored outside this repo under `~/.local/state/v2-spike/reference/`. Its verification map is history, not the current API. This map accounts for all 21 rows of its Acceptance map (A1 through A21) and all 12 rows of Findings and exact changed paths (C1 through C12), in their original order. Counts: 26 covered, 7 N/A by decision 30, 0 not covered. Repeated cleanup rows remain separate. The reference's Public API and wiring table describes the old file locations, not additional acceptance behaviors.

Paths start at the repository root unless stated otherwise. Evidence keys below resolve to a real file and exact test name. A source-location claim is not proved merely because a behavior test passes.

## Covered

| Row | Reference behavior or finding | Evidence |
| --- | --- | --- |
| A1 | Exact app nodes, edges, closures, flags and app ownership | G |
| A2 | Reject module-node entries and way exposures, including forged module exposure | O checks origins; X bypasses lint with public defineEntry(BookingsNodes.get) and proves acquisition fails with typed GraphInvalid for the unregistered entry. No private internals are forged; runtime checks registered identity, not source origin. |
| A3 | Registry lists nodes, both Bookings.book callers, refund reason, closures and exposures | R, RR |
| A4 | Missing billing:charge refuses before booking/provider work over HTTP and in-process | H, E |
| A5 | Cancellation has ordered person/system steps and refund reason | E; W also allows in-process cancellation |
| A6 | Missing system refund permission refuses before approval, unit or steps | E |
| A7 | Web denies cancel approval; in-process allows it | W |
| A8 | Approval once for cancel, never make/show; one unit for writes, none for show/refusal | E |
| A9 | Real PG refund failure rolls back cancellation and leaves payment paid | P |
| A10 | PG A/B isolation, including mismatched booking/payment owners | B; seeds through public services |
| A11 | PG-only adapter queries migrated views | V |
| A12 | SQL source guard rejects private identifiers, non-SELECT, multiple statements and unsafe APIs; mutation controls | S |
| A13 | First sign-in creates person and binding, system steps, no reauthentication | H |
| A14 | Separate partner issuer and only book_for_partner exposed | H |
| A15 | No database read returns 503 | W |
| A16 | Schedule uses Effect Clock and excludes exact 24h boundary | T |
| A17 | One audit row per entry, including refusal; no inner rows | E, H, P |
| A18 | Real MCP both tools, fake A/B callers and readOnlyHint | M |
| A19 | Bearer challenge, GET/HEAD metadata, valid token, wrong audience, unset auth and metadata methods | J |
| A20 | Gate-policy switch, cycles, inherited system caller, reason checks and scoped typed calls | F1 through F5 |
| C1 | Reuse module input fields and preserve decoded input | I, both backends |
| C2 | Same schema finding in graph tests | I now proves field identity instead of the old graph test |
| C3 | Empty ids/guest and nonpositive amounts fail before all work; valid HTTP/in-process input still succeeds | I, both backends |
| C4 | Named approval plugs in the way-opening code | N compares web/partner to exported Mean.no and mcp to Mean.elicitation by identity. |
| C5 | Same named-plug finding in entries.test.ts | N asserts all three app way selections, not just lower Approval behavior. |
| C9 | PG refusal does no provider work or steps; refusal, success and failed refund each get an entry row | P |

## N/A by decision 30 (prose or placement)

[Owner decision 30](../../docs/v2-decisions.md) exempts prose and wiring-placement claims from executable proof for acceptance item 3. These seven rows identify documents, wiring locations or historical reports. Their runtime claims remain covered above: H/P prove shared record state, including the hook, and F1 tests both gate policies. N/A does not waive those behaviors.

| Row | Reference row | Where to look and why N/A |
| --- | --- | --- |
| A21 | Defaults P2/X/P1/H and reading order | Prose and reading order in examples/booking/README.md and examples/booking/apps/api/AGENTS.md. F1 proves the policy behavior, not the prose. |
| C6 | Record belongs in plugSockets: audit-storage.ts | Wiring placement in examples/booking/apps/api/src/composition/audit-storage.ts: AuditStorage carries the chosen memory log or existing SqlClient, not a runtime. H/P cover shared record behavior. |
| C7 | Record belongs in plugSockets: modules.ts | Wiring placement in examples/booking/apps/api/src/composition/modules.ts: mounts select AuditStorage; Record provision is elsewhere. |
| C8 | Record belongs in plugSockets: app-layer.ts | Wiring placement and acquisition order in examples/booking/apps/api/src/composition/app-layer.ts: plugSockets provides Record before NodeRuntime and the hook. Shared runtime/trace/watch behavior is covered by H/P, not exempted. |
| C10 | Named PG timeout alignment | Test configuration placement in examples/booking/apps/api/src/read-models/my-bookings/adapters/tests/my-bookings.test.ts: it.layer(world, { timeout: 30_000 }). The no-assertion-change statement is historical prose in the archived VERIFICATION.md under the read-only reference directory named above, not a timeout-behavior claim. V remains executable proof of the adapter. |
| C11 | File/symbol defaults | Prose in examples/booking/README.md and examples/booking/apps/api/AGENTS.md replaces the reference's separate defaults document. |
| C12 | Cleanup evidence | Historical report in the archived VERIFICATION.md under the read-only reference directory named above, under Accepted-verdict cleanup. Current gate logs are in ~/.local/state/v2-migration/phase2/. |

## Exact test cases

In this table, app-relative paths start at `examples/booking/apps/api/`.

| Key | File | Exact test name |
| --- | --- | --- |
| G | app-relative `src/composition/tests/graph.test.ts` | `seven app entries retain exact closures, starts, edges and lifted flags` |
| X | app-relative `src/ways-in/web/tests/module-entry.test.ts` | `composition refuses a way exposing a forged Bookings.get module entry` |
| N | app-relative `src/ways-in/web/tests/mean-plugs.test.ts` | `ways select Mean.no for web and partner and Mean.elicitation for mcp` |
| O | `packages/rules/tests/entry-from-app-node.test.mjs` | `follows app descriptors and entry barrels for ways, hooks, schedules and endpoints` |
| R | app-relative `src/composition/tests/registry.test.ts` | `REGISTRY.md matches pure output without rewriting` |
| RR | `packages/application/src/tests/registry.test.ts` | `renders reverse callers, reasons, closures and way exposure without running anything` |
| H | app-relative `src/ways-in/web/tests/http.test.ts` | `shared entries, one authenticated hook, HTTP closure refusal, approval and independent partner issuer` |
| E | app-relative `src/composition/tests/entries.test.ts` | `checks closures before work, asks once, transacts once, traces only two inner steps, and audits entries` |
| W | app-relative `src/ways-in/web/tests/http.test.ts` | `web denies cancel, in-process allows it, and missing database reads are unavailable` |
| P | app-relative `src/composition/tests/postgres.test.ts` | `real PG refund failure rolls back cancel across modules and produces one failed entry record` |
| B | app-relative `src/composition/tests/postgres.test.ts` | `MyStuff filters A/B ownership in SQL including mismatched payment owners` |
| V | app-relative `src/read-models/my-bookings/adapters/tests/my-bookings.test.ts` | `runs the Postgres adapter against both migrated views` (suite `published views`) |
| S | app-relative `src/read-models/my-bookings/adapters/tests/my-bookings.test.ts` | `guards every adapter SQL template against private tables and writes` |
| T | app-relative `src/composition/tests/entries.test.ts` | `runs the schedule once using Effect Clock, expires only pending older than 24h` |
| M | app-relative `src/ways-in/mcp/tests/auth.test.ts` | `real PG MCP both read-only tools enforce fake A/B privacy; cancel is absent` |
| J | app-relative `src/ways-in/mcp/tests/auth.test.ts` | `signed MCP admission checks challenge, metadata, signature, issuer, audience, expiry and existing sessions` |
| I | app-relative `src/features/make-booking/tests/input-boundary.test.ts` | `memory: reused schemas reject invalid HTTP and in-process inputs before all work`; `postgres: reused schemas reject invalid HTTP and in-process inputs before all work` |
| Q | `packages/application/src/tests/elicitation-approval.test.ts` | `an accept with no content approves and runs the handler`; `a declined form fails with ApprovalDenied`; `a cancelled form fails with ApprovalDenied`; `a client without elicitation is refused without being asked` |
| F1 | `packages/application/src/tests/gate-policy.test.ts` | `entry-and-recheck: keeps the forged closure backstop policy explicit`; `entry-only: keeps the forged closure backstop policy explicit` |
| F2 | `packages/application/src/tests/node-runtime.test.ts` | `fails acquisition for cycles, unbound nodes, duplicate bindings and duplicate exposures`; `inherits the original system caller and removes ambient person authority`; `refuses forged undeclared calls by descriptor identity` |
| F3 | `packages/domain/src/tests/graph.test.ts` | `does not throw while defining a dynamic blank reason; graph validation refuses it`; `dedupes each closure and never switches a system path back to person` |
| F4 | `packages/domain/src/tests/node-types.test.ts` | `keeps literal flags and edge targets`; the same file's compiler-negative assertions reject an empty reason and undeclared call |
| F5 | `packages/application/src/tests/entry-types.test.ts` | `keeps concrete flags and erases only the AnyEntry container`; compiler-negative assertions prove the requirement types |

## Additional current proofs

The reference rows do not exhaust the current suite. First-sign-in atomicity is proved by `memory: first sign-in person and login binding share one entry unit` and `postgres: first sign-in person and login binding share one entry unit` in app-relative `src/composition/tests/first-sign-in.test.ts`.

App-relative `src/tests/node-host.test.ts` runs `built Node Host fails MCP closed, shuts down, and refuses production demo JWT`. It builds and starts real child processes and waits for shutdown. The fake provider never contacts a bank; rollback tests assert database state, not compensation of external effects.

All 14 example-owned node descriptors have concrete descriptions. MCP exposes two titled read tools, `Show your booking` and `List your bookings and payments`, in app-relative `src/ways-in/mcp/way.ts`. This metadata was inspected, not asserted by a dedicated metadata test.
