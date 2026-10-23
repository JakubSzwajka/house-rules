# Booking behavior proofs

The read-only spike reference is stored outside this repo under `~/.local/state/v2-spike/reference/`. Its verification map is history, not the current API. This map accounts for all 21 rows of its Acceptance map (A1 through A21) and all 12 rows of Findings and exact changed paths (C1 through C12), in their original order. Counts: 26 covered, 7 N/A by decision 30, 0 not covered. Repeated cleanup rows remain separate. The reference's Public API and wiring table describes the old file locations, not additional acceptance behaviors.

Paths start at the repository root unless stated otherwise. Evidence keys below resolve to a real file and exact test name. A source-location claim is not proved merely because a behavior test passes.

## Browser dashboard

- `apps/api/src/composition/tests/browser-reads.test.ts`: memory/Postgres A/B profile and catalogue reads, admin-wide audit gate, private my_activity filtering, and custom-role deletion.
- `packages/party/src/adapters/tests/my-access.test.ts`: both stores return only the caller's assignments and refuse system reads.
- `packages/call-audit/src/adapters/tests/reader.test.ts`: captured readers on memory/Postgres filter A/B rows before limiting and need no per-call SQL service.
- `apps/api/src/read-models/audit-trail/adapters/service/tests/audit-trail.test.ts`: maps stored recordedAt to epoch-ms `at` and viewerId to nullable `who` for audit entries, with own-actor filtering unchanged. The browser-reads memory/Postgres case checks timestamp bounds, actor ids and equal profile entries through `recent_audit` and `my_activity`.
- `apps/api/src/tests/node-host.test.ts` runs `scripts/host-smoke.mjs`: builds the page, serves GET / as HTML, preserves POST /api/my_profile as 401 JSON, checks unset MCP and production refusal, and closes children.
- `apps/api/src/ways-in/web/page/tests/approval.test.ts`: lifted needsApproval selects cancellation, role revoke and deletion for browser confirmation.
- `packages/rules/tests/dependency-cruiser-ways.test.mjs`: browser UI dependencies work only under a way's page folder, with workspace main, builtin and SQL fences intact.
- Browser layout and dialog interaction still need a manual browser check. The host and HTTP proofs do not verify pixels or focus.

## Organisation bookings

`apps/api/src/composition/tests/org-bookings.test.ts` runs `org bookings check live relations and scoped admin in the module` on memory and Postgres. It proves Acme staff access, Beta/non-member refusal, forbidden creation outside your org, scoped admin cancellation and immediate removal. The Postgres branch calls MyStuff directly and asserts owner-or-staff A/B privacy, including removal. No feature/page filter can hide leaked rows from this assertion. The SELECT uses EXISTS over party_staff_read and a left payment join matching booking owners.

`packages/bookings/src/adapters/tests/booking-store.test.ts` runs both stores and checks rollback, owner/status compare-and-set and the republished booking view. `apps/api/src/composition/tests/postgres.test.ts` checks mismatched payments stay null rather than leaking another owner's payment. The read-adapter suite migrates all three view owners. The seed test runs twice on both stores; org booking ids and payment ids are stable.

## Organisations, invitations and demo seed

- `apps/api/src/composition/tests/organisations.test.ts`, on memory and Postgres: `organisations, invites and people enforce A/B privacy, delegation and approval` proves every new org/invitation/member/people feature. It covers creator-only scoped bootstrap, no-permission 403, org A/B lists and invite refusal, optional role system assignment, single-use and revoked codes, admin delegation limits, scoped people filtering, global-admin visibility, approval flags, member removal with scoped-role revocation and preserved global roles, and last-admin conflict.
- The organisation case also checks `my_organisations` includes the caller's own relation and org roles, `list_people` hides assignments and relations outside the admin's orgs, and `list_members` returns scoped roles while a member, another org's admin and unknown ids all get not_found. Members still get 403 from `list_people`.
- Root `packages/party/src/adapters/tests/people.test.ts`, shared memory/Postgres case `filters people, assignments and relations to administered orgs before returning facts`, checks a person shared across orgs exposes only org A's assignments and relations to admin A, global roles stay hidden, global admins see all scopes, and the storage ports return scoped facts. It also checks own org roles, assignment-only null relation and indistinguishable member-list refusals.
- `apps/api/src/composition/tests/seed.test.ts`: `seed is idempotent, creates scoped demo users and refuses production` runs the seed twice and checks stable ids, Acme membership and production refusal on both stores.
- Root `packages/party/src/adapters/tests/invitations.test.ts` runs the shared memory/Postgres suite: hash-only storage, hidden hashes in lists, org scope and delegation checks, atomic acceptance, expired/revoked/unknown codes, and rollback restoring a claimed code.
- `apps/api/src/ways-in/web/page/tests/activity.test.ts`: dock rows join by request id without duplicates, retain audit-only rows and mark reads for the toggle.
- `apps/api/src/ways-in/web/page/tests/session-history.test.ts`: local person-owned call history clears on sign_in, sign_up, sign_out and a changed my_profile id. Signed-out attempts do not carry into the next person's log; same-person refreshes preserve history.
- The existing call-audit reader test above proves SQL actor filtering before LIMIT. No reader API change was needed.
- Quick sign-in buttons use the build-time Vite development flag, not a new public feature. Browser interaction and production-bundle omission need build/browser checks in addition to unit tests.

## Identity passwords provider

- `apps/api/src/ways-in/web/tests/accounts.test.ts`: "real account cookies, CSRF, generic refusals, password change and A/B booking privacy" covers public issuance with exact-origin CSRF, token omission, generic 200 refusals without cookies, password change, booking access, Alice/Bob isolation and session clearing.
- `apps/api/src/composition/tests/admin-seed.test.ts`: former admin email sign-up gets only member; the shell grant adds admin. Unknown account and unapproved production grants fail clearly.
- Root `packages/identity/src/adapters/tests/accounts-on-store.test.ts`: shared memory/Postgres tests cover committed refusal counts, lock/admit races and hash upgrades. `account-store.test.ts` checks storage rollback and conditional updates. Postgres uses MigrationsTesting and Identity's own migrations.
- Root `packages/identity/src/tests/accounts.test.ts` and `accounts-issuer.test.ts` retain password policy, dummy work, password changes, rollback, key validation, reserved claims and ES256 verification tests. `contracts.test.ts` checks identity operation permissions and transactions. `providers.test.ts` proves OIDC-only acquisition with typed password refusal, issuer/key pairing, audience checks, duplicate issuer rejection and ephemeral production refusal.
- The migrate command bundles `apps/api/scripts/migrate.ts` and reads MIGRATION_DATABASE_URL. It has no production-database execution test. The dashboard is built in phase B.

## Covered

| Row | Reference behavior or finding | Evidence |
| --- | --- | --- |
| A1 | Exact app features, edges, closures, flags and app ownership | G |
| A2 | Reject module operations as features and way exposures, including forged module exposure | O fences feature construction and operation builders; X constructs an unregistered feature over BookingsOperations.get and proves acquisition fails with typed GraphInvalid. Runtime checks registered identity, not source origin. Feature types reject exposing operations directly. |
| A3 | Registry lists features and operations, both Bookings.book callers, refund reason, closures and exposures | R, RR |
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
| C6 | Record placement, superseded by decision 31 | examples/booking/apps/api/src/composition/modules.ts now builds the Record plug in each STORAGE branch. H/P cover shared record behavior. |
| C7 | Record adapter selection in modules.ts | Under [decision 31](../../docs/v2-decisions.md), modulePlan selects the Record adapter with all other storage. Postgres shares the modules' PgClient; memory accepts an inspectable log. |
| C8 | Record acquisition before Runtime and hook | examples/booking/apps/api/src/composition/modules.ts: the module plan builds CallWatch before composition acquires Runtime and the hook. Shared runtime/trace/watch behavior is covered by H/P, not exempted. |
| C10 | Named PG timeout alignment | Test configuration placement in examples/booking/apps/api/src/read-models/my-bookings/adapters/tests/my-bookings.test.ts: it.layer(world, { timeout: 30_000 }). The no-assertion-change statement is historical prose in the archived VERIFICATION.md under the read-only reference directory named above, not a timeout-behavior claim. V remains executable proof of the adapter. |
| C11 | File/symbol defaults | Prose in examples/booking/README.md and examples/booking/apps/api/AGENTS.md replaces the reference's separate defaults document. |
| C12 | Cleanup evidence | Historical report in the archived VERIFICATION.md under the read-only reference directory named above, under Accepted-verdict cleanup. Current gate logs are in ~/.local/state/v2-migration/phase2/. |

## Exact test cases

In this table, app-relative paths start at `examples/booking/apps/api/`.

| Key | File | Exact test name |
| --- | --- | --- |
| G | app-relative `src/composition/tests/graph.test.ts` | `app features retain exact closures, starts, edges and lifted flags` |
| X | app-relative `src/ways-in/web/tests/module-entry.test.ts` | `composition refuses a way exposing a forged Bookings.get module entry` |
| N | app-relative `src/ways-in/web/tests/mean-plugs.test.ts` | `ways select Mean.no for web and partner and Mean.elicitation for mcp` |
| O | `packages/rules/tests/feature-builders.test.mjs` | `defines features only in their own feature index` |
| R | app-relative `src/composition/tests/registry.test.ts` | `REGISTRY.md matches pure output without rewriting` |
| RR | `packages/application/src/tests/registry.test.ts` | `renders reverse callers, reasons, closures and way exposure without running anything` |
| H | app-relative `src/ways-in/web/tests/http.test.ts` | `shared features, one authenticated hook, HTTP closure refusal, approval and independent partner issuer` |
| E | app-relative `src/composition/tests/entries.test.ts` | `checks closures before work, asks once, transacts once, traces only two inner steps, and audits features` |
| W | app-relative `src/ways-in/web/tests/http.test.ts` | `web denies cancel, in-process allows it, and missing database reads are unavailable` |
| P | app-relative `src/composition/tests/postgres.test.ts` | `real PG refund failure rolls back cancel across modules and produces one failed entry record` |
| B | app-relative `src/composition/tests/postgres.test.ts` | `MyStuff filters A/B ownership in SQL including mismatched payment owners` |
| V | app-relative `src/read-models/my-bookings/adapters/tests/my-bookings.test.ts` | `runs the Postgres adapter against both migrated views` (suite `published views`) |
| S | app-relative `src/read-models/my-bookings/adapters/tests/my-bookings.test.ts` | `guards every adapter SQL template against private tables and writes` |
| T | app-relative `src/composition/tests/entries.test.ts` | `runs the schedule once using Effect Clock, expires only pending older than 24h` |
| T | root `packages/application/src/tests/system-ways.test.ts` | Hook slot mapping, fresh ids and no ambient actor; next-tick schedule, per-item rollback, disposal, duplicate slots and invalid cron |
| T | root `packages/identity/src/tests/providers.test.ts` | devLocal signing handles, key isolation and typed production refusal |
| T | billing `src/adapters/tests/payment-store.test.ts` and `src/tests/billing.test.ts` | Read-only due selector, conditional expire-one, strict cutoff, rollback and repeated expiry |
| M | app-relative `src/ways-in/mcp/tests/auth.test.ts` | `real PG MCP both read-only tools enforce fake A/B privacy; cancel is absent` |
| J | app-relative `src/ways-in/mcp/tests/auth.test.ts` | `signed MCP admission checks challenge, metadata, signature, issuer, audience, expiry and existing sessions` |
| I | app-relative `src/features/make-booking/tests/input-boundary.test.ts` | `memory: reused schemas reject invalid HTTP and in-process inputs before all work`; `postgres: reused schemas reject invalid HTTP and in-process inputs before all work` |
| Q | `packages/application/src/tests/elicitation-approval.test.ts` | `an accept with no content approves and runs the handler`; `a declined form fails with ApprovalDenied`; `a cancelled form fails with ApprovalDenied`; `a client without elicitation is refused without being asked` |
| F1 | `packages/application/src/tests/gate-policy.test.ts` | `feature-and-recheck: keeps the forged closure backstop policy explicit`; `feature-only: keeps the forged closure backstop policy explicit` |
| F2 | `packages/application/src/tests/runtime.test.ts` | `fails acquisition for cycles, unbound operations, duplicate bindings and duplicate exposures`; `inherits the original system caller and removes ambient person authority`; `refuses forged undeclared calls by descriptor identity` |
| F3 | `packages/domain/src/tests/graph.test.ts` | `does not throw while defining a dynamic blank reason; graph validation refuses it`; `dedupes each closure and never switches a system path back to person` |
| F4 | `packages/domain/src/tests/operation-types.test.ts` | `keeps literal flags and edge targets`; the same file's compiler-negative assertions reject an empty reason and undeclared call |
| F5 | `packages/application/src/tests/feature-types.test.ts` | `keeps concrete flags and erases only the AnyFeature container`; compiler-negative assertions prove the requirement types |

## Access proofs

`src/tests/access.test.ts` runs `memory: roles grant and revoke access, MCP is the user, and org admins stay scoped` and the same `postgres:` case. It proves a person without a role is refused, custom role definition/assignment grants the next call, revocation with explicit in-process approval removes it, the built-in admin can delegate member and partner, an organisation admin cannot assign in another organisation, and a member can read through MCP but cannot cancel there. Role management is web-only. `tests/retired-names.test.mjs` rejects the removed permission-list names. First-sign-in tests run both backends and retain atomic rollback assertions.

## Additional current proofs

The reference rows do not exhaust the current suite. First-sign-in atomicity is proved by `memory: first sign-in person and login binding share one entry unit` and `postgres: first sign-in person and login binding share one entry unit` in app-relative `src/composition/tests/first-sign-in.test.ts`.

App-relative `src/tests/node-host.test.ts` runs `built Node Host fails MCP closed, shuts down, and refuses production demo JWT`. It builds and starts real child processes and waits for shutdown. The fake provider never contacts a bank; rollback tests assert database state, not compensation of external effects.

The example-owned feature and operation descriptors have concrete descriptions. MCP exposes two titled read tools, `Show your booking` and `List your bookings and payments`, in app-relative `src/ways-in/mcp/way.ts`. This metadata was inspected, not asserted by a dedicated metadata test.
